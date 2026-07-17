import type { Database } from "@onelife/db";
import { players, gamertagLinks } from "@onelife/db";
import { and, eq, ilike, notExists, asc } from "drizzle-orm";

/** Gamertags observed on any server that do not yet have a verified claim (autocomplete source). */
export async function searchClaimableGamertags(db: Database, prefix: string, limit: number): Promise<string[]> {
  const rows = await db.select({ g: players.gamertag }).from(players)
    .where(and(
      ilike(players.gamertag, `${prefix}%`),
      notExists(db.select().from(gamertagLinks).where(and(
        eq(gamertagLinks.gamertag, players.gamertag), eq(gamertagLinks.status, "verified")))),
    ))
    .orderBy(asc(players.gamertag)).limit(limit);
  return rows.map((r) => r.g);
}

/** Verified gamertags (autocomplete source for token transfer + referral). */
export async function searchVerifiedGamertags(db: Database, prefix: string, limit: number): Promise<string[]> {
  const rows = await db.select({ g: gamertagLinks.gamertag }).from(gamertagLinks)
    .where(and(ilike(gamertagLinks.gamertag, `${prefix}%`), eq(gamertagLinks.status, "verified")))
    .orderBy(asc(gamertagLinks.gamertag)).limit(limit);
  return rows.map((r) => r.g);
}
