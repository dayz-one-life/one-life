import { and, eq, gte, sql } from "drizzle-orm";
import type { Database } from "@onelife/db";
import { avatars, avatarReports, gamertagLinks } from "@onelife/db";
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
  | { error: "not_verified" | "no_avatar" | "already_reported" | "rate_limited" | "self" };

/**
 * Record a report and ban the reported bytes immediately.
 *
 * ⚠️ Auto-hide is what makes App Store guideline 1.2's "timely response" survivable for a solo
 * operator: the MACHINE meets the 24 hours, so review can lag without objectionable content
 * staying up. It is only safe because reporting requires a verified gamertag — an Xbox identity
 * proven by in-game emote — so a reporter cannot be a throwaway signup.
 */
export async function reportAvatar(
  db: Database,
  reporterUserId: string,
  subjectUserId: string,
  reason: string,
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

  const inserted = await db
    .insert(avatarReports)
    .values({ reporterUserId, subjectUserId, subjectHash: subject.hash, reason })
    .onConflictDoNothing({ target: [avatarReports.reporterUserId, avatarReports.subjectUserId] })
    .returning({ id: avatarReports.id });
  if (inserted.length === 0) return { error: "already_reported" };

  // Idempotent: a second reporter on the same hash records their report without creating a
  // duplicate ban row, and never downgrades a moderator-confirmed ban.
  await banAvatarHash(db, subject.hash);
  return { ok: true };
}
