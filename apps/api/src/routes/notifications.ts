import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import type { Auth } from "@onelife/auth";
import { notifications, pushSubscriptions } from "@onelife/db";
import { and, desc, eq, isNull, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { getSession } from "../auth-plugin.js";

const FEED_LIMIT = 20;

const subscribeBody = z.object({
  endpoint: z.string().min(1),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
const unsubscribeBody = z.object({ endpoint: z.string().min(1) });

export function registerNotificationRoutes(
  app: FastifyInstance, db: Database, auth: Auth, vapidPublicKey: string,
): void {
  app.get("/me/notifications", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const userId = session.user.id;

    const [items, [counted]] = await Promise.all([
      db
        .select({
          id: notifications.id, kind: notifications.kind, title: notifications.title,
          body: notifications.body, href: notifications.href,
          createdAt: notifications.createdAt, readAt: notifications.readAt,
        })
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt))
        .limit(FEED_LIMIT),
      db
        .select({ n: dsql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
    ]);

    return { items, unreadCount: counted?.n ?? 0 };
  });

  app.post("/me/notifications/read", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, session.user.id), isNull(notifications.readAt)));
    return { ok: true };
  });

  app.post("/me/push-subscriptions", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const body = subscribeBody.parse(req.body);
    const now = new Date();
    // Upsert on endpoint: re-subscribing the same browser must move the row to the
    // current user and clear any prior failure state, not create a duplicate.
    await db
      .insert(pushSubscriptions)
      .values({
        userId: session.user.id, endpoint: body.endpoint,
        p256dh: body.keys.p256dh, auth: body.keys.auth,
        userAgent: String(req.headers["user-agent"] ?? "").slice(0, 300),
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId: session.user.id, p256dh: body.keys.p256dh, auth: body.keys.auth,
          lastSeenAt: now, failureCount: 0, disabledAt: null,
        },
      });
    return { ok: true };
  });

  app.delete("/me/push-subscriptions", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const body = unsubscribeBody.parse(req.body);
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, session.user.id), eq(pushSubscriptions.endpoint, body.endpoint)));
    return { ok: true };
  });

  // Public: the browser needs this before it can call pushManager.subscribe().
  app.get("/push/vapid-key", async () => ({ publicKey: vapidPublicKey }));
}
