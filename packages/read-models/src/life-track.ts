import type { Database } from "@onelife/db";
import { servers, players, lives, sessions, kills, positions } from "@onelife/db";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import {
  thinTrackWithMeta, segmentBySession, markerAt,
  type TrackPoint, type TrackSegment, type TrackMarker,
} from "./life-track-shape.js";

export interface LifeTrack {
  mapCodename: string;
  segments: TrackSegment[];
  markers: TrackMarker[];
  /** Pre-thinning count, so the UI can honestly say a trail was truncated. */
  sampleCount: number;
  truncated: boolean;
  alive: boolean;
}

/**
 * The owner-only position track for one life.
 *
 * `gamertag` is a WHERE-clause predicate on the life lookup and the kills query, never a
 * post-filter — a life belonging to another player produces no rows and a null return, so
 * there is no intermediate state holding someone else's coordinates that a later bug could
 * leak. Positions are filtered indirectly, by the `player_id` resolved from that
 * gamertag-scoped life lookup (see the note at the positions query below for why) — which
 * is strictly NARROWER than filtering by gamertag directly: a life row only exists at all
 * once the gamertag predicate has already matched, so the resolved `player_id` can only
 * ever be that same player's. The caller (the /me route) derives that gamertag from the
 * session cookie alone.
 */
export async function getLifeTrack(
  db: Database, serverId: number, gamertag: string, lifeNumber: number,
): Promise<LifeTrack | null> {
  const [row] = await db
    .select({
      lifeId: lives.id,
      playerId: players.id,
      startedAt: lives.startedAt,
      endedAt: lives.endedAt,
      map: servers.map,
      lastSeenAt: players.lastSeenAt,
    })
    .from(lives)
    .innerJoin(players, eq(players.id, lives.playerId))
    .innerJoin(servers, eq(servers.id, lives.serverId))
    .where(and(
      eq(lives.serverId, serverId),
      eq(lives.lifeNumber, lifeNumber),
      sql`lower(${players.gamertag}) = lower(${gamertag})`,
    ))
    .orderBy(asc(lives.id))
    .limit(1);
  if (!row) return null;

  // An open life's window ends at the presence cap — `lastSeenAt ?? connectedAt`, with NO
  // Math.min(now, …) clamp. `servers.clockOffsetMs` means a real lastSeenAt can land a few
  // seconds ahead of request-time now, and clamping would diverge from survivors.ts's
  // livePlaytime cap and the dossier's cap in queries.ts.
  const sessionRows = await db
    .select({ id: sessions.id, connectedAt: sessions.connectedAt, disconnectedAt: sessions.disconnectedAt })
    .from(sessions)
    .where(and(eq(sessions.serverId, serverId), eq(sessions.lifeId, row.lifeId)))
    .orderBy(asc(sessions.connectedAt));

  const cap = row.endedAt ?? row.lastSeenAt ?? row.startedAt;
  const windows = sessionRows.map((s) => ({
    id: s.id,
    connectedAt: s.connectedAt,
    endedAt: s.disconnectedAt ?? (cap > s.connectedAt ? cap : s.connectedAt),
  }));

  const windowEnd = row.endedAt ?? cap;
  // Filtered by `player_id`, not `lower(gamertag)` — this is the ONLY predicate shape
  // that can use `positions_player_idx` (server_id, player_id, recorded_at) end-to-end.
  // A `lower(gamertag) = lower($1)` predicate defeats that index past its `server_id`
  // prefix and forces Postgres to scan and filter every position ever recorded on the
  // server — on the highest-volume, never-truncated table in the system, on a 60s poll.
  // Correctness is not at stake either way: this query keys on the already-resolved numeric
  // `row.playerId`, not on the gamertag, so it cannot merge two players' fixes regardless of
  // how many rows currently share a name — migration 0025 dropped `players_gamertag_uniq`
  // (gamertag is a current label now, not an identity), so more than one row legitimately can.
  // Keying on the resolved player id is purely the index decision above, and stays correct
  // regardless of how the gamertag uniqueness story changes.
  const posRows = await db
    .select({ x: positions.x, y: positions.y, recordedAt: positions.recordedAt })
    .from(positions)
    .where(and(
      eq(positions.serverId, serverId),
      eq(positions.playerId, row.playerId),
      gte(positions.recordedAt, row.startedAt),
      lte(positions.recordedAt, windowEnd),
    ))
    .orderBy(asc(positions.recordedAt));

  const raw: TrackPoint[] = posRows.map((p) => ({ x: p.x, y: p.y, at: p.recordedAt }));
  const { points: thinned, truncated } = thinTrackWithMeta(raw);
  const segments = segmentBySession(thinned, windows);

  // Match on the player FK (the identity), keyed on the already-resolved numeric `row.playerId`
  // — a kill scored under a former gamertag still counts, and this uses `kills_killer_player_idx`
  // (server_id, killer_player_id) end-to-end. `killer_player_id` is nullable (the fold leaves it
  // null when the killer had no players row); `eq` never matches null, which is exactly right.
  const killRows = await db
    .select({ victimGamertag: kills.victimGamertag, occurredAt: kills.occurredAt })
    .from(kills)
    .where(and(
      eq(kills.serverId, serverId),
      eq(kills.killerPlayerId, row.playerId),
      gte(kills.occurredAt, row.startedAt),
      lte(kills.occurredAt, windowEnd),
    ))
    .orderBy(asc(kills.occurredAt));

  // Markers are matched against the RAW fixes, never `thinned` (spec §4.3). Thinning
  // keeps only the first sample within THIN_MIN_METERS of the last kept one — a
  // stationary player parked in a base for hours produces a dense run of raw fixes that
  // collapses to a single ancient kept sample, which would push every marker for that
  // whole span past MARKER_MAX_AGE_SECONDS and suppress it. `thinned` is for the drawn
  // polylines only; the marker's whole claim is "this is where the last KNOWN fix put
  // you," and the most recent raw fix is always the best-known one.
  const markers: TrackMarker[] = [];
  for (const k of killRows) {
    const m = markerAt(raw, "kill", k.occurredAt, k.victimGamertag);
    if (m) markers.push(m);
  }
  // The `now` marker IS the last fix, so its sampleAgeSeconds is legitimately 0 — the
  // fix is the event. Its real staleness ("last fix 4m ago", spec §4.5) is how old that
  // fix is *right now*, which only the client can know; it is computed there from
  // `sampleAt` so it keeps ticking between the 60s polls. Deliberately no request-time
  // `now` on this read model — see the presence-cap note above.
  const terminal = row.endedAt
    ? markerAt(raw, "death", row.endedAt, null)
    : raw.length > 0
      ? markerAt(raw, "now", raw[raw.length - 1]!.at, null)
      : null;
  if (terminal) markers.push(terminal);

  return {
    mapCodename: row.map,
    segments,
    markers,
    sampleCount: raw.length,
    truncated,
    alive: row.endedAt === null,
  };
}
