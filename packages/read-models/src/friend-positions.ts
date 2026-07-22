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

  // The viewer's own gamertag. No verified link ⇒ no map at all (the route also checks, but
  // this keeps the read model safe on its own).
  const [viewer] = await db
    .select({ gamertag: gamertagLinks.gamertag })
    .from(gamertagLinks)
    .where(and(
      eq(gamertagLinks.userId, a.viewerUserId),
      eq(gamertagLinks.status, "verified"),
    ))
    .limit(1);
  if (!viewer) return [];

  // Candidate friends with both sides' flags plus the FRIEND's master switch. Eligibility is
  // decided in TypeScript by shouldShareLocation so the rule lives in exactly one place.
  const friendRows = await db
    .select({
      userA: friendships.userA,
      userB: friendships.userB,
      status: friendships.status,
      aShares: friendships.aSharesLocation,
      bShares: friendships.bSharesLocation,
      friendUserId: gamertagLinks.userId,
      gamertag: gamertagLinks.gamertag,
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

  const gamertags = [viewer.gamertag, ...visible.map((r) => r.gamertag)];
  if (gamertags.length === 0) return [];
  const lowered = gamertags.map((g) => g.toLowerCase());

  // Latest fresh position per gamertag on this server, for players with an OPEN session there.
  // DISTINCT ON is the shape Drizzle cannot express, hence raw SQL — but the gamertag set is
  // passed through `inArray` as bind parameters, never interpolated into the query text.
  const rows = await db.execute<{
    gamertag: string; x: number; y: number; recorded_at: Date;
  }>(sql`
    SELECT DISTINCT ON (lower(p.gamertag))
           p.gamertag, p.x, p.y, p.recorded_at
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
      AND ${inArray(sql`lower(p.gamertag)`, lowered)}
    ORDER BY lower(p.gamertag), p.recorded_at DESC
  `);

  return rows.map((r) => ({
    gamertag: r.gamertag,
    x: Number(r.x),
    y: Number(r.y),
    recordedAt: new Date(r.recorded_at),
    self: r.gamertag.toLowerCase() === viewer.gamertag.toLowerCase(),
  }));
}
