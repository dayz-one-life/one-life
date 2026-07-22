import type { Database } from "@onelife/db";
import { friendships, gamertagLinks, notifications } from "@onelife/db";
import { and, eq, gte, or, sql as dsql } from "drizzle-orm";
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

/** The row for a pair, locked for update — but ONLY when a row already exists. A
 *  `FOR UPDATE` that matches zero rows locks nothing, so this alone does not serialize two
 *  concurrent FIRST-TIME requests aimed at the same pair (there is no row yet for either to
 *  lock): see lockSender for the per-sender serialization that actually closes the rate
 *  limit, and the unique-violation catch in request()'s insert path for the cross-sender
 *  reciprocal race this function cannot prevent. */
async function lockPair(tx: Tx, userA: string, userB: string) {
  const [row] = await tx
    .select()
    .from(friendships)
    .where(and(eq(friendships.userA, userA), eq(friendships.userB, userB)))
    .for("update")
    .limit(1);
  return row ?? null;
}

/** Postgres error shape from the `postgres` driver for a unique-violation (23505),
 *  narrowed to a specific constraint so we don't swallow an unrelated one. */
function isUniqueViolation(err: unknown, constraintName: string): boolean {
  const e = err as { code?: string; constraint_name?: string } | null;
  return !!e && e.code === "23505" && e.constraint_name === constraintName;
}

/** Escapes a Postgres LIKE pattern's special characters (`%`, `_`, `\`) so a literal value
 *  — here, a user id — can be safely used as a LIKE prefix. Without this, `_`/`%` in the id
 *  act as single-character/any-length wildcards and can match a DIFFERENT user's
 *  notification keys (see the ab_cd / abXcd regression test), silently under- or
 *  over-counting that user's rate limit. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/** Transaction-scoped advisory lock keyed on the sender, taken before the rate-limit count
 *  so concurrent request() calls from the SAME sender queue up rather than all reading the
 *  same pre-commit count and all passing the `>= limit` check together (finding #1). Released
 *  automatically at commit or rollback — never needs an explicit unlock.
 *  `hashtext()` returns int4; `pg_advisory_xact_lock` only has a bigint overload, so the cast
 *  is required rather than relying on an implicit conversion (there isn't one). */
async function lockSender(tx: Tx, userId: string): Promise<void> {
  await tx.execute(dsql`select pg_advisory_xact_lock(hashtext(${userId})::bigint)`);
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

/** Shared by both paths that can discover "the other party already has a pending request
 *  aimed at you": the ordinary case (an existing pending row found under lockPair) and the
 *  race case (request()'s insert loses a unique-violation to a concurrent reciprocal
 *  first-request, finding #1/#4). The recipient requesting back IS an acceptance — erroring
 *  here would refuse an unambiguous intent (spec §5.2); this is also the only sound outcome
 *  for the race, since by construction the two colliding inserts came from the two different
 *  members of the pair. */
async function acceptReciprocalOrThrow(
  tx: Tx,
  existing: { id: number; requestedBy: string; requestSeq: number },
  fromUserId: string,
  now: Date,
  fromTag: string,
): Promise<{ id: number; status: "pending" | "accepted" }> {
  if (existing.requestedBy === fromUserId) throw new FriendError("already_pending");
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
    // Must come before the count query below (finding #1): it serializes concurrent
    // request() calls from this SAME sender so they can't all read the pre-commit count and
    // all pass the `>= limit` check together. It does NOT serialize two different senders
    // racing to first-request the same pair — see the insert's catch block for that case.
    await lockSender(tx, a.fromUserId);

    const fromTag = await verifiedGamertag(tx, a.fromUserId);
    const toTag = await verifiedGamertag(tx, a.toUserId);
    if (!fromTag || !toTag) throw new FriendError("not_verified");

    const existing = await lockPair(tx, userA, userB);

    if (existing?.status === "accepted") throw new FriendError("already_friends");

    if (existing?.status === "pending") {
      return acceptReciprocalOrThrow(tx, existing, a.fromUserId, now, fromTag);
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
    // `starts_with()` cannot use a btree index (it's an ordinary function call), and this
    // query runs on every friend request against a table with no bound (finding #2). LIKE
    // with a `text_pattern_ops` index (migration 0019) supports a prefix range scan. The
    // prefix must be escaped — see escapeLikePattern.
    const likePrefix = escapeLikePattern(keyPrefix);
    const [countRow] = await tx
      .select({ count: dsql<number>`count(*)::int` })
      .from(notifications)
      .where(and(
        dsql`${notifications.naturalKey} LIKE ${likePrefix} || '%'`,
        gte(notifications.createdAt, since),
      ));
    if (countRow!.count >= FRIEND_REQUEST_DAILY_LIMIT) throw new FriendError("rate_limited");

    if (existing) {
      // Re-request after a decline reuses the row — the unique index leaves no choice — and
      // bumps request_seq so the notification key is fresh (spec §4.2). NOTE: created_at is
      // overwritten here too, so on a re-used row it means "this pending request's created
      // at", not "when this pair's row was first created" — cooldownEnd/ordering rely on that.
      const seq = existing.requestSeq + 1;
      await tx.update(friendships)
        .set({ status: "pending", requestedBy: a.fromUserId, requestSeq: seq, respondedAt: null, createdAt: now })
        .where(eq(friendships.id, existing.id));
      await writeNotification(tx, requestNotification({
        friendshipId: existing.id, seq, recipientId: a.toUserId, senderId: a.fromUserId, senderGamertag: fromTag,
      }));
      return { id: existing.id, status: "pending" as const };
    }

    try {
      const [created] = await tx.insert(friendships)
        .values({ userA, userB, status: "pending", requestedBy: a.fromUserId, createdAt: now })
        .returning({ id: friendships.id, requestSeq: friendships.requestSeq });
      // insert().values(single row) always returns exactly one row.
      await writeNotification(tx, requestNotification({
        friendshipId: created!.id, seq: created!.requestSeq, recipientId: a.toUserId, senderId: a.fromUserId, senderGamertag: fromTag,
      }));
      return { id: created!.id, status: "pending" as const };
    } catch (err) {
      if (!isUniqueViolation(err, "friendships_pair_uniq")) throw err;
      // `existing` was null under lockPair, so there was no row for FOR UPDATE to lock and
      // no per-pair serialization happened — only lockSender's per-SENDER lock did, and A and
      // B are different senders. Both A→B and B→A can reach this INSERT concurrently; only
      // one wins, the other lands here. Recover instead of surfacing a raw 500: re-read the
      // row the winner just committed (now locked, since it exists) and resolve it the same
      // way the ordinary "recipient requests back" branch above does.
      const race = await lockPair(tx, userA, userB);
      if (race?.status === "pending") return acceptReciprocalOrThrow(tx, race, a.fromUserId, now, fromTag);
      throw err;
    }
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
