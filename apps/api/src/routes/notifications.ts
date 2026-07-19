import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import type { Auth } from "@onelife/auth";
import { notifications, pushSubscriptions } from "@onelife/db";
import { and, desc, eq, inArray, isNull, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { getSession } from "../auth-plugin.js";

const FEED_LIMIT = 20;
/** A client may only ever have rendered what the feed served it, so this cap is far above
 *  any honest call. It exists so a hostile caller can't hand us an unbounded IN list. */
const MAX_READ_IDS = 500;

// House style, matching /obituaries, /news and the survivors board: a page cursor, not a
// keyset one. The feed is small, per-user and ordered by a stable created_at, so offset
// paging has no drift problem worth a keyset cursor's extra surface.
const feedQuery = z.object({ page: z.coerce.number().int().positive().catch(1) });

/** Empty list is a legal no-op (the panel opened with nothing unread); over the cap is a
 *  400 rather than a silent truncation, so a client bug is loud. */
const readBody = z.object({
  ids: z.array(z.coerce.number().int().positive()).max(MAX_READ_IDS),
});

const subscribeBody = z.object({
  endpoint: z.string().min(1),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
const unsubscribeBody = z.object({ endpoint: z.string().min(1) });
const statusQuery = z.object({ endpoint: z.string().min(1) });

export function registerNotificationRoutes(
  app: FastifyInstance, db: Database, auth: Auth, vapidPublicKey: string,
): void {
  app.get("/me/notifications", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const userId = session.user.id;
    const { page } = feedQuery.parse(req.query);

    const [items, [counted]] = await Promise.all([
      db
        .select({
          id: notifications.id, kind: notifications.kind, title: notifications.title,
          body: notifications.body, href: notifications.href,
          createdAt: notifications.createdAt, readAt: notifications.readAt,
        })
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(FEED_LIMIT)
        .offset((page - 1) * FEED_LIMIT),
      db
        .select({ n: dsql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
    ]);

    return { items, unreadCount: counted?.n ?? 0, page, pageSize: FEED_LIMIT };
  });

  // Scoped to the ids the client actually rendered: marking the whole inbox read would
  // destroy the unread state of everything past the first page, which no UI can reach.
  app.post("/me/notifications/read", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const parsed = readBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    const { ids } = parsed.data;
    if (ids.length === 0) return { ok: true };
    // The ownership predicate stays in the WHERE clause — never a read-then-check — so a
    // caller naming someone else's id updates zero rows.
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(
        eq(notifications.userId, session.user.id),
        isNull(notifications.readAt),
        inArray(notifications.id, ids),
      ));
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

  // The browser's PushSubscription object outlives everything the server knows about it: it
  // survives sign-out, it survives an account switch on a shared machine, and it is untouched
  // when the notifier retires the row after repeated delivery failures. A toggle that reads
  // only browser state therefore says "on" in exactly the cases where no push will arrive.
  // The ownership predicate is in the WHERE clause, so another user's row reads as inactive
  // rather than leaking that it exists.
  app.get("/me/push-subscriptions", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const parsed = statusQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    const [row] = await db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(and(
        eq(pushSubscriptions.userId, session.user.id),
        eq(pushSubscriptions.endpoint, parsed.data.endpoint),
        isNull(pushSubscriptions.disabledAt),
      ))
      .limit(1);
    return { active: row !== undefined };
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
