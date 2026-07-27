import type { Database } from "@onelife/db";
import {
  gamertagLinks, lives, locationShares, players, positions, sessions,
} from "@onelife/db";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { MARKER_MAX_AGE_SECONDS } from "./life-track-shape.js";

export interface FriendPosition {
  gamertag: string;
  x: number;
  y: number;
  recordedAt: Date;
  self: boolean;
}

/**
 * Everyone the viewer may see on one server: themselves, plus everyone whose SESSION-SCOPED grant
 * to them is still effective (sub-project E — friendship is not a factor).
 *
 * ⚠️ The viewer is identified by SESSION-DERIVED user id only. This read model is reached from
 * a /me route that takes no player identifier, so a caller cannot name a subject — the subject
 * set is computed here from the grants made TO the viewer. Do not add a "which player" parameter.
 *
 * The join to `gamertag_links` is INNER and requires `verified`: a released link means no
 * coordinates, unconditionally, even though the grant row survives. Retained from F2.
 */
export async function getFriendPositions(
  db: Database,
  a: { viewerUserId: string; serverId: number; now: Date },
): Promise<FriendPosition[]> {
  const freshest = new Date(a.now.getTime() - MARKER_MAX_AGE_SECONDS * 1000);

  // The viewer's own gamertag + resolved player id. No verified link ⇒ no map at all (the
  // route also checks, but this keeps the read model safe on its own).
  //
  // ⚠️ The join to `players` is LEFT, not INNER. A verified link whose gamertag has no
  // `players` row yet — verified before the projector has ever folded a session for them —
  // used to fail the inner join, return [], and blank the WHOLE map: the viewer lost every
  // friend's dot as collateral for their own missing one. The viewer's own dot is the only
  // thing that may be absent here.
  //
  // The join folds case because `gamertag_links` and `players` are independently-cased text
  // columns for one identity; that is safe precisely because it is scoped by a verified link,
  // never used as a bare directory lookup. Migration 0024 put `players_gamertag_uniq` on
  // lower(gamertag), so "Sasha" and "sasha" could no longer be two rows for the SAME identity —
  // but migration 0025 dropped that index entirely (gamertag is a current label now; identity is
  // dayz_id), so two DIFFERENT identities can once again hold the same name. The ordering below
  // (most-recently-seen wins, deterministically) and the `limit(1)` are load-bearing, not merely
  // defensive, and match the two per-friend guards further down.
  const [viewer] = await db
    .select({
      gamertag: gamertagLinks.gamertag,
      playerId: players.id,
      lastSeenAt: players.lastSeenAt,
    })
    .from(gamertagLinks)
    .leftJoin(players, sql`lower(${players.gamertag}) = lower(${gamertagLinks.gamertag})`)
    .where(and(
      eq(gamertagLinks.userId, a.viewerUserId),
      eq(gamertagLinks.status, "verified"),
    ))
    .orderBy(sql`${players.lastSeenAt} desc nulls last`, sql`${players.id} asc`)
    .limit(1);
  if (!viewer) return [];

  // ⚠️ THE PREDICATE, and it is a JOIN, never a post-filter (sub-project E).
  //
  // Everyone who has granted THIS VIEWER their position on THIS server, and whose grant is still
  // effective. A grant is effective only while the granter is still in the session it was made
  // in, which is expressed by the last join condition: the stored snapshot must equal the
  // `connected_at` of an OPEN session on this server.
  //
  // Because that is a join condition, an expired grant produces NO ROW — no intermediate value in
  // this call path ever holds a lapsed subject's coordinates for a later bug to leak. Do not
  // "simplify" this into a fetch-then-filter.
  //
  // ⚠️ Equality against the session, not `granted_at >= connected_at`. The two would come from
  // different clocks (API wall clock vs an ADM timestamp with `servers.clock_offset_ms` applied),
  // which differ by seconds — see the ⚠️ on `isShareEffective` in packages/friends.
  //
  // ⚠️ The `gamertag_links` join is INNER and requires `verified`: a released link means no
  // coordinates, unconditionally, even though the grant row survives. Retained from F2.
  //
  // ⚠️ There is no friendship join and no master switch. Sub-project E replaced the standing
  // consent model with per-session grants; strangers may grant, friends have no implicit access.
  const grantRows = await db
    .select({
      granterUserId: locationShares.granterUserId,
      gamertag: gamertagLinks.gamertag,
      playerId: players.id,
      lastSeenAt: players.lastSeenAt,
    })
    .from(locationShares)
    .innerJoin(gamertagLinks, and(
      eq(gamertagLinks.userId, locationShares.granterUserId),
      eq(gamertagLinks.status, "verified"),
    ))
    .innerJoin(players, sql`lower(${players.gamertag}) = lower(${gamertagLinks.gamertag})`)
    .innerJoin(sessions, and(
      eq(sessions.playerId, players.id),
      eq(sessions.serverId, locationShares.serverId),
      isNull(sessions.disconnectedAt),
      eq(sessions.connectedAt, locationShares.granterSessionConnectedAt),
    ))
    .where(and(
      eq(locationShares.granteeUserId, a.viewerUserId),
      eq(locationShares.serverId, a.serverId),
    ))
    // Ordered so the per-granter collapse below is DETERMINISTIC, matching the viewer's own
    // lookup. Without it this query has no ORDER BY at all and two case-variant `players` rows
    // could swap the rendered dot between two locations on successive 30s polls.
    .orderBy(sql`${players.lastSeenAt} desc nulls last`, sql`${players.id} asc`);

  // ⚠️ One granter, one dot. The lower(gamertag) join above can match several `players` rows for
  // a single link whenever the ingest holds "Sasha" and "sasha" as distinct rows for what is
  // really one Xbox identity — or, since migration 0025 dropped `players_gamertag_uniq`
  // altogether (gamertag is a current LABEL now; identity is dayz_id), for two genuinely
  // different identities that have held the same name. The database permits that state again,
  // so this collapse is load-bearing and not merely defensive. The failure mode without it is
  // TWO markers, both labelled with the same callsign, in two different places — a friend
  // appearing to be in two locations at once is worse than being absent, and it throws nothing.
  // Collapse to the FIRST row per granter, which the `orderBy` above has already made the
  // most-recently-seen one. Deliberately one rule rather than an ORDER BY plus a comparator
  // that must agree with it.
  //
  // Note the collapse key (`lastSeenAt`, global) is not the criterion the position query then
  // applies (this server, open session, fresh fix). Those agree today only because the fold
  // treats a position dump as a presence heartbeat, so the row with the freshest position is
  // necessarily the row with the freshest `lastSeenAt`. If that ever stops holding, collapse
  // AFTER the position query instead — otherwise picking the wrong row renders no dot at all.
  const bestByGranter = new Map<string, (typeof grantRows)[number]>();
  for (const r of grantRows) {
    if (!bestByGranter.has(r.granterUserId)) bestByGranter.set(r.granterUserId, r);
  }

  // ⚠️ Also one PLAYER ROW to one subject. Two different users holding verified links to "Sasha"
  // and "sasha" would resolve to the same `players` row; migration 0024 put
  // `gamertag_links_verified_uniq` on lower(gamertag) as well, so that pair is now rejected at
  // write time and this guard, like the collapse above, is retained as defence in depth rather
  // than as a live code path. Keying the reverse map by player id would silently relabel
  // that position with whichever callsign was inserted last — a marker attributed to the wrong
  // friend. First claim wins, deterministically, and the viewer is added first so their own
  // dot is never relabelled as someone else's.
  const subjects: { gamertag: string; playerId: number }[] = [];
  const claimed = new Set<number>();
  const claim = (gamertag: string, playerId: number) => {
    if (claimed.has(playerId)) return;
    claimed.add(playerId);
    subjects.push({ gamertag, playerId });
  };
  // `playerId` is null when the viewer has a verified link but no folded `players` row — they
  // contribute no subject and simply have no dot of their own. Friends are unaffected.
  if (viewer.playerId !== null) claim(viewer.gamertag, viewer.playerId);
  for (const r of bestByGranter.values()) claim(r.gamertag, r.playerId);

  if (subjects.length === 0) return [];
  const playerIds = subjects.map((s) => s.playerId);
  const gamertagByPlayerId = new Map(subjects.map((s) => [s.playerId, s.gamertag]));

  // Latest fresh position per subject on this server, for players with an OPEN session there.
  // DISTINCT ON is the shape Drizzle cannot express, hence raw SQL — but the subject set is
  // passed through `inArray` as bind parameters, never interpolated into the query text.
  //
  // Filtered by `p.player_id`, not `lower(p.gamertag)` — this is the ONLY predicate shape that
  // can use `positions_player_idx` (server_id, player_id, recorded_at) end-to-end. A
  // `lower(gamertag) IN (...)` predicate defeats that index past its `server_id` prefix and
  // forces Postgres to scan and filter every position ever recorded on the server — on the
  // highest-volume table in the system, on a 30s poll per viewer. The player ids above are
  // already resolved case-insensitively via the `players` joins, so this loses no matching
  // behaviour versus the old lower(gamertag) predicate.
  const rows = await db.execute<{
    player_id: number; x: number; y: number; recorded_at: Date;
  }>(sql`
    SELECT DISTINCT ON (p.player_id)
           p.player_id, p.x, p.y, p.recorded_at
    FROM ${positions} p
    JOIN ${players} pl ON pl.id = p.player_id
    JOIN ${sessions} s ON s.player_id = pl.id
                      AND s.server_id = ${a.serverId}
                      AND s.disconnected_at IS NULL
    WHERE p.server_id = ${a.serverId}
      -- .toISOString(), not the raw Date: drizzle-orm/postgres-js's driver.js REPLACES
      -- postgres-js's own timestamptz serializer with an identity function. A raw SQL
      -- template tag bypasses the query builder's column mapping, so a bare Date param
      -- here crashes inside postgres-js's wire encoder the moment the server describes
      -- the placeholder as timestamptz.
      AND p.recorded_at >= ${freshest.toISOString()}
      AND ${inArray(sql`p.player_id`, playerIds)}
    ORDER BY p.player_id, p.recorded_at DESC
  `);

  const out = rows
    .map((r) => {
      const gamertag = gamertagByPlayerId.get(Number(r.player_id));
      if (!gamertag) return null;
      return {
        gamertag,
        x: Number(r.x),
        y: Number(r.y),
        recordedAt: new Date(r.recorded_at),
        self: Number(r.player_id) === viewer.playerId,
      };
    })
    .filter((r): r is FriendPosition => r !== null);

  // ⚠️ THE ONE exception to "no open session + fresh fix, no dot" — and it is SELF-ONLY, by
  // design and not by accident. The no-position-after-logout rule exists because where a DayZ
  // player logs out is where their stash is; the viewer's OWN logout spot is their own
  // information, and losing your bearings between sessions is exactly when you want your map.
  // While the viewer has an OPEN life on this server, their latest fix FROM THAT LIFE stays on
  // their map, however old — with its real `recordedAt`, never clamped, so the UI reports the
  // age of what it shows. Death ends the life and the dot with it (a respawn's position is a
  // different life's information); a fix from before the life started is likewise excluded,
  // because it is where a PREVIOUS life ended, not where this one stands.
  //
  // Do not widen this to granting subjects: their dots stay bounded by the open-session join
  // and MARKER_MAX_AGE_SECONDS above, unconditionally.
  if (viewer.playerId !== null && !out.some((r) => r.self)) {
    const [openLife] = await db
      .select({ startedAt: lives.startedAt })
      .from(lives)
      .where(and(
        eq(lives.playerId, viewer.playerId),
        eq(lives.serverId, a.serverId),
        isNull(lives.endedAt),
      ))
      .orderBy(desc(lives.startedAt))
      .limit(1);
    if (openLife) {
      const [fix] = await db
        .select({ x: positions.x, y: positions.y, recordedAt: positions.recordedAt })
        .from(positions)
        .where(and(
          eq(positions.serverId, a.serverId),
          eq(positions.playerId, viewer.playerId),
          gte(positions.recordedAt, openLife.startedAt),
        ))
        .orderBy(desc(positions.recordedAt))
        .limit(1);
      if (fix) {
        out.unshift({
          gamertag: viewer.gamertag,
          x: Number(fix.x),
          y: Number(fix.y),
          recordedAt: fix.recordedAt,
          self: true,
        });
      }
    }
  }

  return out;
}
