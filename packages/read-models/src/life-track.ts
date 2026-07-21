import type { Database } from "@onelife/db";
import { servers, players, lives, sessions, kills, positions } from "@onelife/db";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import {
  thinTrack, segmentBySession, markerAt, TRACK_POINT_CAP,
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
 * `gamertag` is a WHERE-clause predicate on every query, never a post-filter — a life
 * belonging to another player produces no rows and a null return, so there is no
 * intermediate state holding someone else's coordinates that a later bug could leak.
 * The caller (the /me route) derives that gamertag from the session cookie alone.
 */
export async function getLifeTrack(
  db: Database, serverId: number, gamertag: string, lifeNumber: number,
): Promise<LifeTrack | null> {
  const [row] = await db
    .select({
      lifeId: lives.id,
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
    ));
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
  const posRows = await db
    .select({ x: positions.x, y: positions.y, recordedAt: positions.recordedAt })
    .from(positions)
    .where(and(
      eq(positions.serverId, serverId),
      sql`lower(${positions.gamertag}) = lower(${gamertag})`,
      gte(positions.recordedAt, row.startedAt),
      lte(positions.recordedAt, windowEnd),
    ))
    .orderBy(asc(positions.recordedAt));

  const raw: TrackPoint[] = posRows.map((p) => ({ x: p.x, y: p.y, at: p.recordedAt }));
  const thinned = thinTrack(raw);
  const segments = segmentBySession(thinned, windows);

  const killRows = await db
    .select({ victimGamertag: kills.victimGamertag, occurredAt: kills.occurredAt })
    .from(kills)
    .where(and(
      eq(kills.serverId, serverId),
      sql`lower(${kills.killerGamertag}) = lower(${gamertag})`,
      gte(kills.occurredAt, row.startedAt),
      lte(kills.occurredAt, windowEnd),
    ))
    .orderBy(asc(kills.occurredAt));

  const markers: TrackMarker[] = [];
  for (const k of killRows) {
    const m = markerAt(thinned, "kill", k.occurredAt, k.victimGamertag);
    if (m) markers.push(m);
  }
  // The `now` marker IS the last fix, so its sampleAgeSeconds is legitimately 0 — the
  // fix is the event. Its real staleness ("last fix 4m ago", spec §4.5) is how old that
  // fix is *right now*, which only the client can know; it is computed there from
  // `sampleAt` so it keeps ticking between the 60s polls. Deliberately no request-time
  // `now` on this read model — see the presence-cap note above.
  const terminal = row.endedAt
    ? markerAt(thinned, "death", row.endedAt, null)
    : thinned.length > 0
      ? markerAt(thinned, "now", thinned[thinned.length - 1]!.at, null)
      : null;
  if (terminal) markers.push(terminal);

  return {
    mapCodename: row.map,
    segments,
    markers,
    sampleCount: raw.length,
    truncated: thinned.length >= TRACK_POINT_CAP,
    alive: row.endedAt === null,
  };
}
