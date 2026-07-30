import { type Database, referrals } from "@onelife/db";
import { TokenError, verifiedOf } from "./internal.js";

/**
 * Record a referral claim from an invite link. Distinct from `setReferrer`, deliberately:
 *
 * ⚠️ Only the REFERRER must be verified. The referee is claiming at sign-in, before they have
 * verified anything — and that is safe because `grantReferral` inner-joins `gamertag_links` on
 * `status = 'verified'`, so the row pays nothing until the referee verifies, and pays
 * automatically once they do.
 *
 * ⚠️ A repeat claim is a silent "noop", never a throw and never an overwrite: the claim island
 * may fire more than once, and a second invite link must not reassign an existing referrer.
 *
 * Throws TokenError('self_referral' | 'not_verified').
 */
export async function claimReferrer(
  db: Database,
  a: { userId: string; referrerUserId: string },
): Promise<"claimed" | "noop"> {
  if (a.userId === a.referrerUserId) throw new TokenError("self_referral");
  if (!(await verifiedOf(db, a.referrerUserId))) throw new TokenError("not_verified");
  const inserted = await db
    .insert(referrals)
    .values({ userId: a.userId, referrerUserId: a.referrerUserId })
    .onConflictDoNothing({ target: referrals.userId })
    .returning({ userId: referrals.userId });
  return inserted.length > 0 ? "claimed" : "noop";
}
