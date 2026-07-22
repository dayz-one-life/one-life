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
  // route also checks, but this keeps the read model safe on its own). The join to `players`
  // is by lower(gamertag) — gamertag_links and players are independently-cased text columns
  // for the same identity — and is safe to fold case on precisely because it is scoped by a
  // verified link, never used as a bare directory lookup.
  const [viewer] = await db
    .select({ gamertag: gamertagLinks.gamertag, playerId: players.id })
    .from(gamertagLinks)
    .innerJoin(players, sql`lower(${players.gamertag}) = lower(${gamertagLinks.gamertag})`)
    .where(and(
      eq(gamertagLinks.userId, a.viewerUserId),
      eq(gamertagLinks.status, "verified"),
    ))
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
    .leftJoin(userPreferences, eq(userPreferences.userId, gamertagLinks.userId));

  const visible = friendRows.filter((r) =>
    shouldShareLocation({
      status: r.status,
      // Absent preferences row ⇒ false. Never permissive.
      masterShare: r.masterShare ?? false,
      // The FRIEND's own per-pair flag: theirs is the A column when they are side A.
      pairShare: r.userA === r.friendUserId ? r.aShares : r.bShares,
    }),
  );

  const subjects = [
    { gamertag: viewer.gamertag, playerId: viewer.playerId },
    ...visible.map((r) => ({ gamertag: r.gamertag, playerId: r.playerId })),
  ];
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
