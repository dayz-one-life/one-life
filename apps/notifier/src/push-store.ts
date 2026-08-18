import type { Database } from "@onelife/db";
import { devicePushTokens, notifications, pushSubscriptions } from "@onelife/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

export type UnpushedNotification = {
  id: number; userId: string; kind: string; title: string; body: string; href: string; createdAt: Date;
};

/** ⚠️ `kind` is not decoration. `push_subscriptions` and `device_push_tokens` have INDEPENDENT
 *  bigserial sequences, so the same `id` exists in both. Every store function that acts on a
 *  subscription must dispatch on `kind` — retiring a dead FCM token by id alone would delete
 *  whichever browser subscription happened to share that number. */
export type ActiveSubscription =
  | { kind: "webpush"; id: number; endpoint: string; p256dh: string; auth: string }
  | { kind: "device"; id: number; token: string; platform: "ios" | "android" };

const MAX_FAILURES = 5;

export async function findUnpushed(db: Database, opts: { limit: number }): Promise<UnpushedNotification[]> {
  return db
    .select({
      id: notifications.id, userId: notifications.userId, kind: notifications.kind,
      title: notifications.title, body: notifications.body, href: notifications.href,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(isNull(notifications.pushedAt))
    .orderBy(asc(notifications.createdAt))
    .limit(opts.limit);
}

/** Two selects concatenated, not a SQL UNION: the columns do not line up, and forcing them to
 *  means padding both sides with nulls and narrowing them back apart in TypeScript. */
export async function activeSubscriptionsFor(db: Database, userId: string): Promise<ActiveSubscription[]> {
  const [web, device] = await Promise.all([
    db
      .select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth })
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), isNull(pushSubscriptions.disabledAt))),
    db
      .select({ id: devicePushTokens.id, token: devicePushTokens.token, platform: devicePushTokens.platform })
      .from(devicePushTokens)
      .where(and(eq(devicePushTokens.userId, userId), isNull(devicePushTokens.disabledAt))),
  ]);
  return [
    ...web.map((r) => ({ kind: "webpush" as const, ...r })),
    ...device.map((r) => ({ kind: "device" as const, ...r })),
  ];
}

export async function markPushed(db: Database, id: number, now: Date): Promise<void> {
  await db.update(notifications).set({ pushedAt: now }).where(eq(notifications.id, id));
}

export async function deleteSubscription(db: Database, sub: ActiveSubscription): Promise<void> {
  if (sub.kind === "webpush") {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
  } else {
    await db.delete(devicePushTokens).where(eq(devicePushTokens.id, sub.id));
  }
}

/** Count a delivery failure and retire the subscription once it has failed MAX_FAILURES times,
 *  so a permanently broken endpoint stops costing a request every tick.
 *
 *  The two branches are spelled out rather than selecting a table into a variable: drizzle's
 *  update builder is generic over the table, and a union-typed table collapses `set()` to never. */
export async function recordFailure(db: Database, sub: ActiveSubscription, now: Date): Promise<void> {
  if (sub.kind === "webpush") {
    await db
      .update(pushSubscriptions)
      .set({
        failureCount: sql`${pushSubscriptions.failureCount} + 1`,
        disabledAt: sql`CASE WHEN ${pushSubscriptions.failureCount} + 1 >= ${MAX_FAILURES} THEN ${now.toISOString()}::timestamptz ELSE ${pushSubscriptions.disabledAt} END`,
      })
      .where(eq(pushSubscriptions.id, sub.id));
  } else {
    await db
      .update(devicePushTokens)
      .set({
        failureCount: sql`${devicePushTokens.failureCount} + 1`,
        disabledAt: sql`CASE WHEN ${devicePushTokens.failureCount} + 1 >= ${MAX_FAILURES} THEN ${now.toISOString()}::timestamptz ELSE ${devicePushTokens.disabledAt} END`,
      })
      .where(eq(devicePushTokens.id, sub.id));
  }
}
