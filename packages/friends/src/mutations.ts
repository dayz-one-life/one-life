import type { Database } from "@onelife/db";
import { friendships, gamertagLinks, notifications } from "@onelife/db";
import { and, eq, gte, like, or, sql as dsql } from "drizzle-orm";
import { FriendError } from "./errors.js";
import { cooldownEnd, orderPair, FRIEND_REQUEST_DAILY_LIMIT } from "./pair.js";
import { acceptedNotification, requestNotification, writeNotification } from "./notify.js";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** The verified gamertag for a user, or null. Doubles as the verification check: the
 *  identity boundary and the notification body come from the same row. */
async function verifiedGamertag(tx: Tx, userId: string): Promise<string | null> {
  const [row] = await tx
    .select({ gamertag: gamertagLinks.gamertag })
    .from(gamertagLinks)
    .where(and(eq(gamertagLinks.userId, userId), eq(gamertagLinks.status, "verified")))
    .limit(1);
  return row?.gamertag ?? null;
}

/** The row for a pair, locked for update so concurrent requests serialize. */
async function lockPair(tx: Tx, userA: string, userB: string) {
  const [row] = await tx
    .select()
    .from(friendships)
    .where(and(eq(friendships.userA, userA), eq(friendships.userB, userB)))
    .for("update")
    .limit(1);
  return row ?? null;
}

/** A row the caller is a party to, locked. Throws not_found otherwise — a non-party must
 *  not be able to distinguish "not yours" from "does not exist". Used by cancel/remove,
 *  which are ownership operations with no separate "recipient" concept. */
async function lockOwn(tx: Tx, friendshipId: number, userId: string) {
  const [row] = await tx
    .select()
    .from(friendships)
    .where(and(
      eq(friendships.id, friendshipId),
      or(eq(friendships.userA, userId), eq(friendships.userB, userId)),
    ))
    .for("update")
    .limit(1);
  if (!row) throw new FriendError("not_found");
  return row;
}

/** A row by id, locked, with no party restriction. Throws not_found only when the row
 *  truly does not exist. Used by accept/decline, whose authorization question is "are you
 *  the recipient" — not_recipient covers the sender AND any non-party alike, since both
 *  are equally "not the recipient" of this request. */
async function lockById(tx: Tx, friendshipId: number) {
  const [row] = await tx
    .select()
    .from(friendships)
    .where(eq(friendships.id, friendshipId))
    .for("update")
    .limit(1);
  if (!row) throw new FriendError("not_found");
  return row;
}

/** The party who did not send the request. */
function recipientOf(row: { userA: string; userB: string; requestedBy: string }): string {
  return row.requestedBy === row.userA ? row.userB : row.userA;
}

/**
 * Send a friend request, or accept an inverse pending one.
 *
 * Both the state change and its notification happen in one transaction: a request that
 * exists with no notification is a request the recipient never learns about.
 */
export async function request(
  db: Database,
  a: { fromUserId: string; toUserId: string; now?: Date },
): Promise<{ id: number; status: "pending" | "accepted" }> {
  if (a.fromUserId === a.toUserId) throw new FriendError("self_request");
  const now = a.now ?? new Date();
  const { userA, userB } = orderPair(a.fromUserId, a.toUserId);

  return db.transaction(async (tx) => {
    const fromTag = await verifiedGamertag(tx, a.fromUserId);
    const toTag = await verifiedGamertag(tx, a.toUserId);
    if (!fromTag || !toTag) throw new FriendError("not_verified");

    const existing = await lockPair(tx, userA, userB);

    if (existing?.status === "accepted") throw new FriendError("already_friends");

    if (existing?.status === "pending") {
      if (existing.requestedBy === a.fromUserId) throw new FriendError("already_pending");
      // The recipient requesting back IS an acceptance — erroring here would refuse an
      // unambiguous intent (spec §5.2).
      await tx.update(friendships)
        .set({ status: "accepted", respondedAt: now })
        .where(eq(friendships.id, existing.id));
      await writeNotification(tx, acceptedNotification({
        friendshipId: existing.id,
        seq: existing.requestSeq,
        senderId: existing.requestedBy,
        accepterGamertag: fromTag,
      }));
      return { id: existing.id, status: "accepted" as const };
    }

    if (existing?.status === "declined") {
      const until = cooldownEnd(existing);
      if (until && until > now) {
        throw new FriendError("cooldown_active", { until: until.toISOString() });
      }
    }

    // Rolling 24h cap on outgoing requests. Counted off notifications actually SENT, not
    // friendships rows — cancel() hard-deletes the friendship row but never the
    // notification it already wrote, so counting friendships is trivially evaded by
    // request → cancel → request … against fresh targets. Notification rows are durable,
    // so this measures the thing the limit exists to bound.
    const since = new Date(now.getTime() - 86_400_000);
    const keyPrefix = `friend_request:${a.fromUserId}:`;
    const [countRow] = await tx
      .select({ count: dsql<number>`count(*)::int` })
      .from(notifications)
      .where(and(
        like(notifications.naturalKey, `${keyPrefix}%`),
        gte(notifications.createdAt, since),
      ));
    if (countRow!.count >= FRIEND_REQUEST_DAILY_LIMIT) throw new FriendError("rate_limited");

    if (existing) {
      // Re-request after a decline reuses the row — the unique index leaves no choice —
      // and bumps request_seq so the notification key is fresh (spec §4.2).
      const seq = existing.requestSeq + 1;
      await tx.update(friendships)
        .set({ status: "pending", requestedBy: a.fromUserId, requestSeq: seq, respondedAt: null, createdAt: now })
        .where(eq(friendships.id, existing.id));
      await writeNotification(tx, requestNotification({
        friendshipId: existing.id, seq, recipientId: a.toUserId, senderId: a.fromUserId, senderGamertag: fromTag,
      }));
      return { id: existing.id, status: "pending" as const };
    }

    const [created] = await tx.insert(friendships)
      .values({ userA, userB, status: "pending", requestedBy: a.fromUserId, createdAt: now })
      .returning({ id: friendships.id, requestSeq: friendships.requestSeq });
    // insert().values(single row) always returns exactly one row.
    await writeNotification(tx, requestNotification({
      friendshipId: created!.id, seq: created!.requestSeq, recipientId: a.toUserId, senderId: a.fromUserId, senderGamertag: fromTag,
    }));
    return { id: created!.id, status: "pending" as const };
  });
}

/** Withdraw your own pending request. Deletes the row — a withdrawn request leaves no
 *  cooldown, because the recipient never chose anything. */
export async function cancel(db: Database, a: { userId: string; friendshipId: number }): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await lockOwn(tx, a.friendshipId, a.userId);
    if (row.status !== "pending" || row.requestedBy !== a.userId) throw new FriendError("not_found");
    await tx.delete(friendships).where(eq(friendships.id, row.id));
  });
}

export async function accept(
  db: Database,
  a: { userId: string; friendshipId: number; now?: Date },
): Promise<void> {
  const now = a.now ?? new Date();
  await db.transaction(async (tx) => {
    const row = await lockById(tx, a.friendshipId);
    if (row.status !== "pending" || a.userId !== recipientOf(row)) throw new FriendError("not_recipient");
    const tag = await verifiedGamertag(tx, a.userId);
    if (!tag) throw new FriendError("not_verified");
    await tx.update(friendships)
      .set({ status: "accepted", respondedAt: now })
      .where(eq(friendships.id, row.id));
    await writeNotification(tx, acceptedNotification({
      friendshipId: row.id, seq: row.requestSeq, senderId: row.requestedBy, accepterGamertag: tag,
    }));
  });
}

/** Decline is recorded, never deleted: responded_at IS the cooldown clock. The sender is
 *  deliberately not notified — "X declined you" is a hostile message with no action. */
export async function decline(
  db: Database,
  a: { userId: string; friendshipId: number; now?: Date },
): Promise<void> {
  const now = a.now ?? new Date();
  await db.transaction(async (tx) => {
    const row = await lockById(tx, a.friendshipId);
    if (row.status !== "pending" || a.userId !== recipientOf(row)) throw new FriendError("not_recipient");
    await tx.update(friendships)
      .set({ status: "declined", respondedAt: now })
      .where(eq(friendships.id, row.id));
  });
}

/** Remove an accepted friendship. DELETEs, because a retained row is a retained
 *  *_shares_location flag, and after "remove friend" no consent may survive (spec §3). */
export async function remove(db: Database, a: { userId: string; friendshipId: number }): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await lockOwn(tx, a.friendshipId, a.userId);
    if (row.status !== "accepted") throw new FriendError("not_found");
    await tx.delete(friendships).where(eq(friendships.id, row.id));
  });
}
