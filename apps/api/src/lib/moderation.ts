import { and, eq, gte, or, sql } from "drizzle-orm";
import type { Database } from "@onelife/db";
import { avatars, avatarReports, gamertagLinks, locationShares, userBlocks } from "@onelife/db";
import { banAvatarHash } from "./avatar-store.js";

/**
 * ⚠️ A FIXED list, deliberately not free text. A free-text reason field would itself be a UGC
 * surface — adding one to the moderation feature would be self-defeating.
 */
export const REPORT_REASONS = ["sexual", "violent", "hate", "illegal", "impersonation", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** A runaway-abuse backstop, not a usage limit. A good-faith reporter should never meet it. */
const REPORTS_PER_DAY = 10;

export type ReportOutcome =
  | { ok: true }
  | { error: "not_verified" | "no_avatar" | "already_reported" | "rate_limited" | "self" | "hash_mismatch" };

/**
 * Record a report and ban the reported bytes immediately.
 *
 * ⚠️ Auto-hide is what makes App Store guideline 1.2's "timely response" survivable for a solo
 * operator: the MACHINE meets the 24 hours, so review can lag without objectionable content
 * staying up. It is only safe because reporting requires a verified gamertag — an Xbox identity
 * proven by in-game emote — so a reporter cannot be a throwaway signup.
 *
 * ⚠️ `observedHash` is REQUIRED and is the hash the reporter actually saw. Trusting the subject's
 * current hash instead let a reported user swap to a widely-shared image (two Discord accounts
 * legitimately share default provider bytes) and turn one report into a global ban on bytes the
 * reporter never looked at, stripping the avatar from every innocent user holding them. A
 * mismatch is a 409, not a silent ban of whatever happens to be there now.
 */
export async function reportAvatar(
  db: Database,
  reporterUserId: string,
  subjectUserId: string,
  reason: string,
  observedHash: string,
): Promise<ReportOutcome> {
  if (reporterUserId === subjectUserId) return { error: "self" };

  const [verified] = await db
    .select({ id: gamertagLinks.id })
    .from(gamertagLinks)
    .where(and(eq(gamertagLinks.userId, reporterUserId), eq(gamertagLinks.status, "verified")));
  if (!verified) return { error: "not_verified" };

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(avatarReports)
    .where(and(eq(avatarReports.reporterUserId, reporterUserId), gte(avatarReports.createdAt, since)));
  const count = rows[0]?.count ?? 0;
  if (count >= REPORTS_PER_DAY) return { error: "rate_limited" };

  // Snapshot the hash NOW: the subject can swap their avatar the instant they are reported,
  // and the report must still name what was actually seen.
  const [subject] = await db
    .select({ hash: avatars.hash })
    .from(avatars)
    .where(eq(avatars.userId, subjectUserId));
  if (!subject?.hash) return { error: "no_avatar" };
  // The subject swapped their avatar between the reporter seeing it and the report arriving.
  // Banning the CURRENT bytes here is the bug this guard exists for.
  if (subject.hash !== observedHash) return { error: "hash_mismatch" };

  // ⚠️ ONE transaction. Split, a failed ban left the report row behind — and the unique
  // (reporter, subject) index then means that reporter can NEVER retry, so the avatar stays
  // visible and auto-hide silently did not happen. Either both land or neither does.
  const banned = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(avatarReports)
      .values({ reporterUserId, subjectUserId, subjectHash: subject.hash as string, reason })
      .onConflictDoNothing({ target: [avatarReports.reporterUserId, avatarReports.subjectUserId] })
      .returning({ id: avatarReports.id });
    if (inserted.length === 0) return false;

    // Idempotent: a second reporter on the same hash records their report without creating a
    // duplicate ban row, never downgrades a moderator-confirmed ban, and never overrides a
    // moderator's 'allowed' restore.
    await banAvatarHash(tx as unknown as Database, subject.hash as string);
    return true;
  });
  if (!banned) return { error: "already_reported" };
  return { ok: true };
}

/**
 * Block another user. ⚠️ VIEWER-SCOPED: this hides the blocked user's avatar from the blocker
 * and severs location shares both ways. It must NEVER stop those bytes serving globally —
 * that is what a hash ban is for, and confusing the two would hand every user a unilateral
 * takedown button.
 *
 * Not symmetric and not notified: a block that notifies is a block that invites retaliation.
 */
export async function blockUser(
  db: Database,
  blockerUserId: string,
  blockedUserId: string,
): Promise<{ ok: true } | { error: "self" }> {
  if (blockerUserId === blockedUserId) return { error: "self" };
  await db.transaction(async (tx) => {
    await tx
      .insert(userBlocks)
      .values({ blockerUserId, blockedUserId })
      .onConflictDoNothing({ target: [userBlocks.blockerUserId, userBlocks.blockedUserId] });

    // ⚠️ Severing EXISTING shares is the whole point of blocking mid-harassment. The grant-time
    // guard in map-share.ts only stops NEW shares; without this, blocking someone who is already
    // watching your dot leaves them watching it for the rest of the session. Both directions,
    // matching isBlockedEitherWay: deleting the row is exactly how revokeLocation revokes.
    await tx.delete(locationShares).where(or(
      and(eq(locationShares.granterUserId, blockerUserId), eq(locationShares.granteeUserId, blockedUserId)),
      and(eq(locationShares.granterUserId, blockedUserId), eq(locationShares.granteeUserId, blockerUserId)),
    ));
  });
  return { ok: true };
}

export async function unblockUser(db: Database, blockerUserId: string, blockedUserId: string): Promise<void> {
  await db
    .delete(userBlocks)
    .where(and(eq(userBlocks.blockerUserId, blockerUserId), eq(userBlocks.blockedUserId, blockedUserId)));
}

export async function listBlockedUserIds(db: Database, blockerUserId: string): Promise<string[]> {
  const rows = await db
    .select({ id: userBlocks.blockedUserId })
    .from(userBlocks)
    .where(eq(userBlocks.blockerUserId, blockerUserId));
  return rows.map((r) => r.id);
}

/**
 * Does a block exist in EITHER direction? Location sharing uses this: a one-way block severs
 * the connection both ways, so blocking someone also stops you seeing them.
 */
export async function isBlockedEitherWay(db: Database, a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ blocker: userBlocks.blockerUserId })
    .from(userBlocks)
    .where(or(
      and(eq(userBlocks.blockerUserId, a), eq(userBlocks.blockedUserId, b)),
      and(eq(userBlocks.blockerUserId, b), eq(userBlocks.blockedUserId, a)),
    ));
  return Boolean(row);
}
