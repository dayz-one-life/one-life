import { eq } from "drizzle-orm";
import { type Database, referrals } from "@onelife/db";
import { TokenError, verifiedOf } from "./internal.js";

/**
 * Set the user's (one-time) referrer — another verified player. Throws
 * TokenError('self_referral'|'not_verified'|'already_set').
 */
export async function setReferrer(db: Database, a: { userId: string; referrerUserId: string }): Promise<void> {
  if (a.userId === a.referrerUserId) throw new TokenError("self_referral");
  await db.transaction(async (tx) => {
    if (!(await verifiedOf(tx, a.userId)) || !(await verifiedOf(tx, a.referrerUserId))) {
      throw new TokenError("not_verified");
    }
    const [existing] = await tx.select({ u: referrals.userId }).from(referrals).where(eq(referrals.userId, a.userId)).limit(1);
    if (existing) throw new TokenError("already_set");
    await tx.insert(referrals).values({ userId: a.userId, referrerUserId: a.referrerUserId });
  });
}
