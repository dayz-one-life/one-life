import { notifications } from "@onelife/db";

/**
 * Structurally identical to apps/notifier/src/types.ts NotificationDraft. Duplicated
 * deliberately: a package must not depend on an app. Same precedent as playerSlug, which
 * the notifier duplicates out of apps/web for exactly this reason. Both copies must stay
 * in step with the notifications table's column set.
 */
export type FriendNotificationDraft = {
  userId: string;
  kind: string;
  naturalKey: string;
  title: string;
  body: string;
  href: string;
};

/** Mirror of apps/web/src/lib/slug.ts playerSlug. Out of step ⇒ notification links 404. */
export function playerSlug(gamertag: string): string {
  return gamertag.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Accepts a drizzle db OR transaction executor — both expose the same query builder, but
// Database and PgTransaction are distinct TS types. Same loose-typing precedent as
// packages/tokens/src/internal.ts's Executor.
type Executor = { insert: (table: any) => any };

/**
 * Insert one notification.
 *
 * onConflictDoNothing targets a PLAIN unique index, so it takes NO targetWhere — do not
 * copy the targetWhere argument from apps/newsdesk/src/pg-store.ts, whose index is partial.
 * request_seq already makes a collision impossible; this is belt and braces, so a
 * duplicate key can never turn a friend request into a 500.
 */
export async function writeNotification(tx: Executor, draft: FriendNotificationDraft): Promise<void> {
  await tx.insert(notifications).values(draft).onConflictDoNothing({ target: notifications.naturalKey });
}

export function requestNotification(a: {
  friendshipId: number; seq: number; recipientId: string; senderGamertag: string;
}): FriendNotificationDraft {
  return {
    userId: a.recipientId,
    kind: "friend_request_received",
    naturalKey: `friend_request:${a.friendshipId}:${a.seq}`,
    title: "Friend request",
    body: `${a.senderGamertag} wants to be friends.`,
    href: "/friends",
  };
}

export function acceptedNotification(a: {
  friendshipId: number; seq: number; senderId: string; accepterGamertag: string;
}): FriendNotificationDraft {
  return {
    userId: a.senderId,
    kind: "friend_request_accepted",
    naturalKey: `friend_accepted:${a.friendshipId}:${a.seq}`,
    title: "Friend request accepted",
    body: `${a.accepterGamertag} accepted your friend request.`,
    href: `/players/${playerSlug(a.accepterGamertag)}`,
  };
}
