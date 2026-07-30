import { and, eq } from "drizzle-orm";
import { type Database, gamertagLinks, referrals } from "@onelife/db";
import { grant } from "./grant.js";
import { verifiedUserIds } from "./verified.js";

/** One token per verified gamertag link (item 13). Idempotent on the link id. */
export async function grantVerification(db: Database): Promise<number> {
  const links = await db
    .select({ id: gamertagLinks.id, userId: gamertagLinks.userId })
    .from(gamertagLinks)
    .where(eq(gamertagLinks.status, "verified"));
  let n = 0;
  for (const l of links) {
    if (await grant(db, { userId: l.userId, kind: "verification", idempotencyKey: `verify:${l.id}` })) n++;
  }
  return n;
}

/** One token per verified user per calendar month (item 14). */
export async function grantMonthly(db: Database, yyyymm: string): Promise<number> {
  let n = 0;
  for (const uid of await verifiedUserIds(db)) {
    if (await grant(db, { userId: uid, kind: "monthly", idempotencyKey: `monthly:${uid}:${yyyymm}` })) n++;
  }
  return n;
}

/**
 * One token to a referrer per verified referee — ONCE, EVER (item 16).
 *
 * ⚠️ `yyyymm` is deliberately NOT in the idempotency key. It used to be, which made this an
 * annuity: a referrer earned a token per referee every month forever, against a 1/month base
 * grant. Ten referees minted 11 tokens a month. The parameter stays for caller compatibility.
 */
export async function grantReferral(db: Database, _yyyymm: string): Promise<number> {
  const rows = await db
    .select({ referee: referrals.userId, referrer: referrals.referrerUserId })
    .from(referrals)
    .innerJoin(gamertagLinks, and(eq(gamertagLinks.userId, referrals.userId), eq(gamertagLinks.status, "verified")));
  const seen = new Set<string>();
  let n = 0;
  for (const r of rows) {
    const key = `${r.referrer}:${r.referee}`;
    if (seen.has(key)) continue; // referee with multiple verified links → count once
    seen.add(key);
    if (await grant(db, { userId: r.referrer, kind: "referral", idempotencyKey: `referral:${r.referrer}:${r.referee}` })) n++;
  }
  return n;
}
