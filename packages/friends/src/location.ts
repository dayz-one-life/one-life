import type { Database } from "@onelife/db";
import { friendships, userPreferences } from "@onelife/db";
import { and, eq, or } from "drizzle-orm";
import { FriendError } from "./errors.js";

/**
 * Whether subject S's location is visible to observer O. Pure.
 *
 * Effective sharing is `master AND per-pair` — the master switch (default false) is the
 * deliberate opt-in, the per-pair flag (default true) means "not individually hidden".
 *
 * Unlike presence there is no observer-side flag: a location you can see is one you asked
 * to see by opening the map, not something pushed at you.
 */
export function shouldShareLocation(a: {
  status: string; masterShare: boolean; pairShare: boolean;
}): boolean {
  return a.status === "accepted" && a.masterShare && a.pairShare;
}

/** Set this caller's own location flag on one friendship. Which physical column that is
 *  depends on which side of the canonically-ordered pair the caller is. A non-party gets
 *  `not_found`, matching cancel/remove: they must not learn the row exists. */
export async function setLocationFlag(
  db: Database,
  a: { userId: string; friendshipId: number; share: boolean },
): Promise<void> {
  const [row] = await db
    .select({ id: friendships.id, userA: friendships.userA })
    .from(friendships)
    .where(and(
      eq(friendships.id, a.friendshipId),
      or(eq(friendships.userA, a.userId), eq(friendships.userB, a.userId)),
    ))
    .limit(1);
  if (!row) throw new FriendError("not_found");

  const isA = row.userA === a.userId;
  await db.update(friendships)
    .set(isA ? { aSharesLocation: a.share } : { bSharesLocation: a.share })
    .where(eq(friendships.id, row.id));
}

/** An absent row means defaults, so "no row" is false, never an error. */
export async function getShareLocation(db: Database, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ shareLocation: userPreferences.shareLocation })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  return row?.shareLocation ?? false;
}

export async function setShareLocation(
  db: Database,
  a: { userId: string; shareLocation: boolean },
): Promise<void> {
  await db
    .insert(userPreferences)
    .values({ userId: a.userId, shareLocation: a.shareLocation, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { shareLocation: a.shareLocation, updatedAt: new Date() },
    });
}
