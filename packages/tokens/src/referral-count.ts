import { and, eq, countDistinct } from "drizzle-orm";
import { type Database, referrals, gamertagLinks } from "@onelife/db";

/**
 * How many people this user referred who went on to verify.
 *
 * ⚠️ `verified` is the boundary and it is a WHERE-clause predicate via the join, never a
 * post-filter — a `pending` link is not a joined survivor. countDistinct guards a referee who
 * somehow holds two verified links from counting twice.
 */
export async function countVerifiedReferees(db: Database, referrerUserId: string): Promise<number> {
  const [row] = await db
    .select({ n: countDistinct(referrals.userId) })
    .from(referrals)
    .innerJoin(
      gamertagLinks,
      and(eq(gamertagLinks.userId, referrals.userId), eq(gamertagLinks.status, "verified")),
    )
    .where(eq(referrals.referrerUserId, referrerUserId));
  return Number(row?.n ?? 0);
}
