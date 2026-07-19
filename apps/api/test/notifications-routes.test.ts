import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, notifications, pushSubscriptions } from "@onelife/db";
import { eq } from "drizzle-orm";
import { createAuth, type Mailer } from "@onelife/auth";
import { buildApp } from "../src/app.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 6e8;
const email = `ntf${svc}@example.com`;

let lastLink = "";
const captureMailer: Mailer = { async send(msg) { lastLink = msg.url; } };
const auth = createAuth(db, {
  secret: "s".repeat(32), baseURL: "http://localhost", trustedOrigins: ["http://localhost"],
  providers: {}, mailer: captureMailer,
});
const app = buildApp(db, { auth, corsOrigins: ["http://localhost"], vapidPublicKey: "TEST_PUBLIC_KEY" });

function cookieHeader(setCookie: string | string[] | undefined): string {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr.map((c) => c.split(";")[0]).join("; ");
}

let cookie = "";
let userId = "";
let otherUserId = "";

async function signIn(): Promise<void> {
  await app.inject({
    method: "POST", url: "/api/auth/sign-in/magic-link",
    headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost" },
    payload: { email },
  });
  const verifyPath = lastLink.replace(/^https?:\/\/[^/]+/, "");
  const verify = await app.inject({ method: "GET", url: verifyPath, headers: { host: "localhost" } });
  cookie = cookieHeader(verify.headers["set-cookie"] as string | string[] | undefined);
}

beforeAll(async () => {
  await app.ready();
  await signIn();
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  userId = u!.id;

  const [other] = await db.insert(user)
    .values({ id: `ntf-other-${svc}`, name: "Other", email: `other${svc}@example.com` })
    .returning();
  otherUserId = other!.id;

  // Explicitly dated older than the bulk backlog seeded further down, so page boundaries
  // are deterministic instead of depending on defaultNow() vs. hardcoded timestamps.
  const old = new Date("2026-07-01T00:00:00Z");
  await db.insert(notifications).values([
    { userId, kind: "ban_applied", naturalKey: `ntf:${svc}:1`, title: "Mine unread", body: "b", href: "/h", createdAt: old },
    { userId, kind: "tokens_granted", naturalKey: `ntf:${svc}:2`, title: "Mine read", body: "b", href: "/h", createdAt: old, readAt: new Date() },
    { userId: otherUserId, kind: "ban_applied", naturalKey: `ntf:${svc}:3`, title: "Theirs", body: "b", href: "/h", createdAt: old },
  ]);
});

afterAll(async () => {
  await sql`DELETE FROM notifications WHERE user_id IN (${userId}, ${otherUserId})`;
  await sql`DELETE FROM push_subscriptions WHERE user_id IN (${userId}, ${otherUserId})`;
  await sql`DELETE FROM "session" WHERE user_id = ${userId}`;
  await sql`DELETE FROM "account" WHERE user_id = ${userId}`;
  await sql`DELETE FROM "user" WHERE id IN (${userId}, ${otherUserId})`;
  await sql.end();
});

const authed = () => ({ host: "localhost", cookie, "content-type": "application/json" });

describe("notification routes", () => {
  it("401 without a session", async () => {
    const res = await app.inject({ method: "GET", url: "/me/notifications", headers: { host: "localhost" } });
    expect(res.statusCode).toBe(401);
  });

  it("returns only the caller's notifications with an unread count", async () => {
    const res = await app.inject({ method: "GET", url: "/me/notifications", headers: authed() });
    expect(res.statusCode).toBe(200);
    const bodyJson = res.json();
    expect(bodyJson.items.map((i: { title: string }) => i.title).sort()).toEqual(["Mine read", "Mine unread"]);
    expect(bodyJson.unreadCount).toBe(1);
  });

  it("marks the listed notifications read", async () => {
    const before = await app.inject({ method: "GET", url: "/me/notifications", headers: authed() });
    const ids = before.json().items.map((i: { id: number }) => i.id);
    const post = await app.inject({
      method: "POST", url: "/me/notifications/read", headers: authed(), payload: { ids },
    });
    expect(post.statusCode).toBe(200);
    const res = await app.inject({ method: "GET", url: "/me/notifications", headers: authed() });
    expect(res.json().unreadCount).toBe(0);
  });

  it("never marks another user's notifications read", async () => {
    const rows = await db.select().from(notifications).where(eq(notifications.userId, otherUserId));
    expect(rows[0]!.readAt).toBeNull();
  });

  it("401 on subscribing without a session", async () => {
    const res = await app.inject({
      method: "POST", url: "/me/push-subscriptions",
      headers: { host: "localhost", "content-type": "application/json" },
      payload: { endpoint: "e", keys: { p256dh: "p", auth: "a" } },
    });
    expect(res.statusCode).toBe(401);
  });

  it("upserts a push subscription instead of duplicating it", async () => {
    const payload = { endpoint: `ep-${svc}`, keys: { p256dh: "p1", auth: "a1" } };
    await app.inject({ method: "POST", url: "/me/push-subscriptions", headers: authed(), payload });
    await app.inject({
      method: "POST", url: "/me/push-subscriptions", headers: authed(),
      payload: { ...payload, keys: { p256dh: "p2", auth: "a2" } },
    });
    const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.p256dh).toBe("p2");
  });

  it("transfers ownership of a push subscription owned by another user", async () => {
    const endpoint = `ep-other-${svc}`;
    await db.insert(pushSubscriptions).values({
      userId: otherUserId, endpoint, p256dh: "op1", auth: "oa1",
      failureCount: 3, disabledAt: new Date(),
    });

    const res = await app.inject({
      method: "POST", url: "/me/push-subscriptions", headers: authed(),
      payload: { endpoint, keys: { p256dh: "p3", auth: "a3" } },
    });
    expect(res.statusCode).toBe(200);

    const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(userId);
    expect(rows[0]!.failureCount).toBe(0);
    expect(rows[0]!.disabledAt).toBeNull();

    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  });

  it("deletes a push subscription", async () => {
    const res = await app.inject({
      method: "DELETE", url: "/me/push-subscriptions", headers: authed(),
      payload: { endpoint: `ep-${svc}` },
    });
    expect(res.statusCode).toBe(200);
    const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    expect(rows).toHaveLength(0);
  });

  // The browser's PushSubscription object survives sign-out, account switches and the
  // notifier retiring a row after repeated delivery failures. The toggle therefore cannot
  // trust it alone — this route is the server's side of that reconciliation.
  describe("GET /me/push-subscriptions", () => {
    const endpoint = `ep-status-${svc}`;

    it("401 without a session", async () => {
      const res = await app.inject({
        method: "GET", url: `/me/push-subscriptions?endpoint=${endpoint}`,
        headers: { host: "localhost" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("400 without an endpoint", async () => {
      const res = await app.inject({ method: "GET", url: "/me/push-subscriptions", headers: authed() });
      expect(res.statusCode).toBe(400);
    });

    it("reports inactive when the caller has no row for the endpoint", async () => {
      const res = await app.inject({
        method: "GET", url: `/me/push-subscriptions?endpoint=${endpoint}`, headers: authed(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().active).toBe(false);
    });

    it("reports active for the caller's live subscription", async () => {
      await db.insert(pushSubscriptions).values({ userId, endpoint, p256dh: "p", auth: "a" });
      const res = await app.inject({
        method: "GET", url: `/me/push-subscriptions?endpoint=${endpoint}`, headers: authed(),
      });
      expect(res.json().active).toBe(true);
    });

    // The notifier retires a subscription after 5 failed deliveries. The browser object is
    // untouched, so without this the rail would keep claiming push is on forever.
    it("reports inactive once the notifier has disabled the row", async () => {
      await db.update(pushSubscriptions)
        .set({ disabledAt: new Date() })
        .where(eq(pushSubscriptions.endpoint, endpoint));
      const res = await app.inject({
        method: "GET", url: `/me/push-subscriptions?endpoint=${endpoint}`, headers: authed(),
      });
      expect(res.json().active).toBe(false);
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    });

    // The shared-browser case: A signs out leaving the row behind, B signs in. B must be
    // told push is off for them, not shown A's subscription as if it were theirs.
    it("reports inactive when the row belongs to another user", async () => {
      const shared = `ep-shared-${svc}`;
      await db.insert(pushSubscriptions).values({ userId: otherUserId, endpoint: shared, p256dh: "p", auth: "a" });
      const res = await app.inject({
        method: "GET", url: `/me/push-subscriptions?endpoint=${shared}`, headers: authed(),
      });
      expect(res.json().active).toBe(false);
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, shared));
    });
  });

  it("serves the vapid public key without a session", async () => {
    const res = await app.inject({ method: "GET", url: "/push/vapid-key", headers: { host: "localhost" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().publicKey).toBe("TEST_PUBLIC_KEY");
  });
});

// A backlog deeper than one page is the whole point of the ids-scoped read: the feed shows
// FEED_LIMIT rows, so anything the caller never saw must still be unread afterwards.
describe("notification backlog deeper than one page", () => {
  const BULK = 25;

  beforeAll(async () => {
    const base = Date.UTC(2026, 6, 19, 0, 0, 0);
    await db.insert(notifications).values(
      Array.from({ length: BULK }, (_, i) => ({
        userId, kind: "tokens_granted", naturalKey: `ntf:${svc}:bulk:${i}`,
        title: `Bulk ${i}`, body: "b", href: "/h",
        // Ascending, so the highest index is newest and lands on page 1.
        createdAt: new Date(base + i * 60_000),
      })),
    );
  });

  it("leaves unseen notifications unread when the caller marks only the page it saw", async () => {
    const page1 = await app.inject({ method: "GET", url: "/me/notifications", headers: authed() });
    const body1 = page1.json();
    expect(body1.items).toHaveLength(20);
    expect(body1.unreadCount).toBe(BULK);

    const seen = body1.items.map((i: { id: number }) => i.id);
    await app.inject({ method: "POST", url: "/me/notifications/read", headers: authed(), payload: { ids: seen } });

    const after = await app.inject({ method: "GET", url: "/me/notifications", headers: authed() });
    expect(after.json().unreadCount).toBe(BULK - 20);
  });

  it("serves the older slice on page 2 and lets it be drained", async () => {
    const page2 = await app.inject({ method: "GET", url: "/me/notifications?page=2", headers: authed() });
    expect(page2.statusCode).toBe(200);
    const body2 = page2.json();
    // 25 bulk + the 2 rows seeded in the outer suite = 27 total.
    expect(body2.items).toHaveLength(7);
    expect(body2.page).toBe(2);
    const ids = body2.items.map((i: { id: number }) => i.id);
    expect(ids).not.toContain(undefined);

    await app.inject({ method: "POST", url: "/me/notifications/read", headers: authed(), payload: { ids } });
    const after = await app.inject({ method: "GET", url: "/me/notifications", headers: authed() });
    expect(after.json().unreadCount).toBe(0);
  });

  it("returns an empty page rather than an error when the page is out of range", async () => {
    const res = await app.inject({ method: "GET", url: "/me/notifications?page=99", headers: authed() });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);
  });

  it("falls back to page 1 for a junk page value", async () => {
    const res = await app.inject({ method: "GET", url: "/me/notifications?page=banana", headers: authed() });
    expect(res.statusCode).toBe(200);
    expect(res.json().page).toBe(1);
  });

  it("cannot mark another user's notification read even when its id is named explicitly", async () => {
    const [theirs] = await db.select({ id: notifications.id })
      .from(notifications).where(eq(notifications.userId, otherUserId));

    const res = await app.inject({
      method: "POST", url: "/me/notifications/read", headers: authed(), payload: { ids: [theirs!.id] },
    });
    expect(res.statusCode).toBe(200);

    const [row] = await db.select({ readAt: notifications.readAt })
      .from(notifications).where(eq(notifications.id, theirs!.id));
    expect(row!.readAt).toBeNull();
  });

  it("accepts an empty id list as a no-op", async () => {
    const res = await app.inject({
      method: "POST", url: "/me/notifications/read", headers: authed(), payload: { ids: [] },
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejects an over-long id list", async () => {
    const res = await app.inject({
      method: "POST", url: "/me/notifications/read", headers: authed(),
      payload: { ids: Array.from({ length: 501 }, (_, i) => i + 1) },
    });
    expect(res.statusCode).toBe(400);
  });
});
