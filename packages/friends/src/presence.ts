import type { Database } from "@onelife/db";
import { friendships, userPreferences } from "@onelife/db";
import { and, eq, or } from "drizzle-orm";
import { FriendError } from "./errors.js";

export const FRIEND_ONLINE_COOLDOWN_HOURS = 4;

/** Skip a connect older than this even when it is inside the generator's window: a
 *  "came online" delivered hours late is worse than silence, so a worker that has been
 *  down drops the backlog rather than delivering archaeology. */
export const FRIEND_ONLINE_MAX_AGE_MINUTES = 15;

/**
 * Whether a connect by the subject should notify the observer. Pure, and the single place
 * the four-way AND is expressed.
 *
 * `masterShare` is the SUBJECT's per-user switch (user_preferences.share_presence, default
 * false); `pairShare` is the subject's per-friend flag (default true, i.e. "not individually
 * hidden"); `pairNotify` is the OBSERVER's per-friend flag (default true, i.e. not muted).
 * Effective sharing is master AND pair — which is what makes the default usable: one switch
 * makes you visible to everyone, with per-friend exceptions.
 */
export function shouldNotifyPresence(a: {
  status: string;
  masterShare: boolean;
  pairShare: boolean;
  pairNotify: boolean;
}): boolean {
  return a.status === "accepted" && a.masterShare && a.pairShare && a.pairNotify;
}

/**
 * Set this caller's own presence flags on one friendship. Which physical column each flag
 * lands in depends on which side of the canonically-ordered pair the caller is — the only
 * place outside orderPair/viewOf that needs to know.
 *
 * A non-party gets `not_found`, matching cancel/remove: they must not be able to distinguish
 * "not yours" from "does not exist".
 */
export async function setPresenceFlags(
  db: Database,
  a: { userId: string; friendshipId: number; share?: boolean; notify?: boolean },
): Promise<void> {
  if (a.share === undefined && a.notify === undefined) return;

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
  const patch: Record<string, boolean> = {};
  if (a.share !== undefined) patch[isA ? "aSharesPresence" : "bSharesPresence"] = a.share;
  if (a.notify !== undefined) patch[isA ? "aNotifyPresence" : "bNotifyPresence"] = a.notify;

  await db.update(friendships).set(patch).where(eq(friendships.id, row.id));
}

/** The master switch. An absent row means defaults, so "no row" is false, never an error. */
export async function getSharePresence(db: Database, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ sharePresence: userPreferences.sharePresence })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  return row?.sharePresence ?? false;
}

export async function setSharePresence(
  db: Database,
  a: { userId: string; sharePresence: boolean },
): Promise<void> {
  await db
    .insert(userPreferences)
    .values({ userId: a.userId, sharePresence: a.sharePresence, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { sharePresence: a.sharePresence, updatedAt: new Date() },
    });
}
