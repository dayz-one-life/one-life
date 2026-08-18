import type { Database } from "@onelife/db";
import { gamertagLinks } from "@onelife/db";
import { and, eq, sql as dsql } from "drizzle-orm";

/**
 * Resolve a gamertag to its verified owner: the userId and the CANONICAL casing on record.
 * Matching is case-insensitive (like every other gamertag lookup), but callers that persist a
 * snapshot of the gamertag must store this canonical value, not whatever casing the caller sent
 * — otherwise the same player ends up spelled differently on different rows across the product.
 */
export async function verifiedOwnerByGamertag(
  db: Database,
  gamertag: string,
): Promise<{ userId: string; gamertag: string } | null> {
  const [row] = await db
    .select({ userId: gamertagLinks.userId, gamertag: gamertagLinks.gamertag })
    .from(gamertagLinks)
    .where(and(eq(gamertagLinks.status, "verified"), dsql`lower(${gamertagLinks.gamertag}) = lower(${gamertag})`))
    .limit(1);
  return row ?? null;
}

/** Resolve a gamertag to its verified owner's userId; null when nobody verified holds it. */
export async function verifiedUserIdByGamertag(db: Database, gamertag: string): Promise<string | null> {
  const owner = await verifiedOwnerByGamertag(db, gamertag);
  return owner?.userId ?? null;
}
