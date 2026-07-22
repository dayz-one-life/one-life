import type { Database } from "@onelife/db";
import {
  friendships, gamertagLinks, players, positions, sessions, userPreferences,
} from "@onelife/db";
import { shouldShareLocation } from "@onelife/friends";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { MARKER_MAX_AGE_SECONDS } from "./life-track-shape.js";

export interface FriendPosition {
  gamertag: string;
  x: number;
  y: number;
  recordedAt: Date;
  self: boolean;
}

/**
 * Everyone the viewer may see on one server: themselves, plus each friend sharing with them.
 *
 * ⚠️ The viewer is identified by SESSION-DERIVED user id only. This read model is reached from
 * a /me route that takes no player identifier, so a caller cannot name a subject — the subject
 * set is computed here from the viewer's own friendships. Do not add a "which player" parameter.
 *
 * The join to `gamertag_links` is INNER and requires `verified`: a released link means no
 * coordinates, unconditionally, even though the friendship row and its sharing flags survive.
 * That is the structural half of F1's deferred prerequisite (F2 spec §4).
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
  // never used as a bare directory lookup. It can nonetheless match MORE THAN ONE row —
  // `players_gamertag_uniq` is case-SENSITIVE, so "Sasha" and "sasha" are two rows — hence
  // the ordering below: most-recently-seen wins, deterministically, and `limit(1)` keeps one
  // identity to one dot. See the same reasoning applied per-friend further down.
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

  // Candidate friends with both sides' flags plus the FRIEND's master switch. Eligibility is
  // decided in TypeScript by shouldShareLocation so the rule lives in exactly one place.
  //
  // ⚠️ The viewer restriction lives entirely in the `gamertagLinks` join's ON clause (the
  // `or(...)` below), not a WHERE — this IS the scope, restricting the joined rows to the
  // OTHER side of a friendship the viewer belongs to. Moving it into a WHERE would need both
  // halves of the `or` repeated there or it silently drops the case where the friend is side A.
  const friendRows = await db
    .select({
      userA: friendships.userA,
      userB: friendships.userB,
      status: friendships.status,
      aShares: friendships.aSharesLocation,
      bShares: friendships.bSharesLocation,
      friendUserId: gamertagLinks.userId,
      gamertag: gamertagLinks.gamertag,
      playerId: players.id,
      lastSeenAt: players.lastSeenAt,
      masterShare: userPreferences.shareLocation,
    })
    .from(friendships)
    .innerJoin(gamertagLinks, and(
      eq(gamertagLinks.status, "verified"),
      or(
        and(eq(friendships.userA, a.viewerUserId), eq(gamertagLinks.userId, friendships.userB)),
        and(eq(friendships.userB, a.viewerUserId), eq(gamertagLinks.userId, friendships.userA)),
      ),
    ))
    .innerJoin(players, sql`lower(${players.gamertag}) = lower(${gamertagLinks.gamertag})`)
    .leftJoin(userPreferences, eq(userPreferences.userId, gamertagLinks.userId))
    // Ordered so the per-friend collapse below is DETERMINISTIC, matching the viewer's own
    // lookup. Without it this query has no ORDER BY at all, the collapse's strict `>` keeps
    // whichever duplicate Postgres happened to return first, and two case-variant rows with
    // equal — or both NULL, the column is nullable — `lastSeenAt` could swap the rendered dot
    // between two locations on successive 30s polls. That is the very failure the collapse
    // exists to remove, just at a lower frequency.
    .orderBy(sql`${players.lastSeenAt} desc nulls last`, sql`${players.id} asc`);

  const visible = friendRows.filter((r) =>
    shouldShareLocation({
      status: r.status,
      // Absent preferences row ⇒ false. Never permissive.
      masterShare: r.masterShare ?? false,
      // The FRIEND's own per-pair flag: theirs is the A column when they are side A.
      pairShare: r.userA === r.friendUserId ? r.aShares : r.bShares,
    }),
  );

  // ⚠️ One friend, one dot. The lower(gamertag) join above can match several `players` rows
  // for a single link, because `players_gamertag_uniq` is case-SENSITIVE and the ingest can
  // therefore hold "Sasha" and "sasha" as distinct rows for what is really one Xbox identity.
  // Left as-is that renders TWO markers, both labelled with the same callsign, in two different
  // places — a friend appearing to be in two locations at once is worse than being absent.
  // Collapse to the FIRST row per friend, which the `orderBy` above has already made the
  // most-recently-seen one. Deliberately one rule rather than an ORDER BY plus a comparator
  // that must agree with it.
  //
  // Note the collapse key (`lastSeenAt`, global) is not the criterion the position query then
  // applies (this server, open session, fresh fix). Those agree today only because the fold
  // treats a position dump as a presence heartbeat, so the row with the freshest position is
  // necessarily the row with the freshest `lastSeenAt`. If that ever stops holding, collapse
  // AFTER the position query instead — otherwise picking the wrong row renders no dot at all.
  const bestByFriend = new Map<string, (typeof visible)[number]>();
  for (const r of visible) {
    if (!bestByFriend.has(r.friendUserId)) bestByFriend.set(r.friendUserId, r);
  }

  // ⚠️ Also one PLAYER ROW to one subject. `gamertag_links_verified_uniq` is case-sensitive
  // too, so two different users can hold verified links to "Sasha" and "sasha" and resolve to
  // the same `players` row. Keying the reverse map by player id would then silently relabel
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
  for (const r of bestByFriend.values()) claim(r.gamertag, r.playerId);

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

  return rows
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
}
