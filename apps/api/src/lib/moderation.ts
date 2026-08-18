import { and, eq, gte, isNotNull, or, sql } from "drizzle-orm";
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
  | { error: "not_verified" | "unknown_hash" | "already_reported" | "rate_limited" | "self" };

/**
 * Record a report against IMAGE BYTES and ban them immediately.
 *
 * ⚠️ Keyed on the hash, not the owner. Several accounts can hold the same bytes, so there is no
 * single "subject" — and because the reporter names the bytes they saw, a reported user cannot
 * swap avatars to redirect the ban onto someone else's image.
 */
export async function reportAvatar(
  db: Database,
  reporterUserId: string,
  subjectHash: string,
  reason: string,
): Promise<ReportOutcome> {
  const [verified] = await db
    .select({ id: gamertagLinks.id })
    .from(gamertagLinks)
    .where(and(eq(gamertagLinks.userId, reporterUserId), eq(gamertagLinks.status, "verified")));
  if (!verified) return { error: "not_verified" };

  // Resolve holders of these bytes. Also proves the hash is real — without this, anyone could
  // ban arbitrary strings and fill the queue with hashes no avatar ever had.
  const holders = await db
    .select({ userId: avatars.userId })
    .from(avatars)
    .where(and(eq(avatars.hash, subjectHash), isNotNull(avatars.image)));
  if (holders.length === 0) return { error: "unknown_hash" };
  if (holders.some((h) => h.userId === reporterUserId)) return { error: "self" };

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(avatarReports)
    .where(and(eq(avatarReports.reporterUserId, reporterUserId), gte(avatarReports.createdAt, since)));
  const count = rows[0]?.count ?? 0;
  if (count >= REPORTS_PER_DAY) return { error: "rate_limited" };

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(avatarReports)
      // subjectUserId is CONTEXT for the moderator, not the key. With several holders we record
      // the first; the ban covers all of them regardless.
      .values({ reporterUserId, subjectUserId: holders[0]?.userId ?? null, subjectHash, reason })
      .onConflictDoNothing({ target: [avatarReports.reporterUserId, avatarReports.subjectHash] })
      .returning({ id: avatarReports.id });
    if (inserted.length === 0) return { error: "already_reported" as const };
    await banAvatarHash(tx as unknown as Database, subjectHash);
    return { ok: true as const };
  });
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
