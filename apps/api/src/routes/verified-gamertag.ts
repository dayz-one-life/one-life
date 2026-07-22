import type { Database } from "@onelife/db";
import { gamertagLinks } from "@onelife/db";
import { and, eq, sql as dsql } from "drizzle-orm";

/** Resolve a gamertag to its verified owner's userId; null when nobody verified holds it. */
export async function verifiedUserIdByGamertag(db: Database, gamertag: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: gamertagLinks.userId })
    .from(gamertagLinks)
    .where(and(eq(gamertagLinks.status, "verified"), dsql`lower(${gamertagLinks.gamertag}) = lower(${gamertag})`))
    .limit(1);
  return row?.userId ?? null;
}
