import type { Database } from "@onelife/db";
import { notifications, pushSubscriptions } from "@onelife/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

export type UnpushedNotification = {
  id: number; userId: string; kind: string; title: string; body: string; href: string; createdAt: Date;
};
export type ActiveSubscription = { id: number; endpoint: string; p256dh: string; auth: string };

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

export async function activeSubscriptionsFor(db: Database, userId: string): Promise<ActiveSubscription[]> {
  return db
    .select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), isNull(pushSubscriptions.disabledAt)));
}

export async function markPushed(db: Database, id: number, now: Date): Promise<void> {
  await db.update(notifications).set({ pushedAt: now }).where(eq(notifications.id, id));
}

export async function deleteSubscription(db: Database, id: number): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
}

/** Count a delivery failure and retire the subscription once it has failed MAX_FAILURES
 *  times, so a permanently broken endpoint stops costing a request every tick. */
export async function recordFailure(db: Database, id: number, now: Date): Promise<void> {
  await db
    .update(pushSubscriptions)
    .set({
      failureCount: sql`${pushSubscriptions.failureCount} + 1`,
      disabledAt: sql`CASE WHEN ${pushSubscriptions.failureCount} + 1 >= ${MAX_FAILURES} THEN ${now.toISOString()}::timestamptz ELSE ${pushSubscriptions.disabledAt} END`,
    })
    .where(eq(pushSubscriptions.id, id));
}
