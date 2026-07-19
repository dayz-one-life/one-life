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

  await db.insert(notifications).values([
    { userId, kind: "ban_applied", naturalKey: `ntf:${svc}:1`, title: "Mine unread", body: "b", href: "/h" },
    { userId, kind: "tokens_granted", naturalKey: `ntf:${svc}:2`, title: "Mine read", body: "b", href: "/h", readAt: new Date() },
    { userId: otherUserId, kind: "ban_applied", naturalKey: `ntf:${svc}:3`, title: "Theirs", body: "b", href: "/h" },
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

  it("marks all unread notifications read", async () => {
    const post = await app.inject({ method: "POST", url: "/me/notifications/read", headers: authed(), payload: {} });
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

  it("deletes a push subscription", async () => {
    const res = await app.inject({
      method: "DELETE", url: "/me/push-subscriptions", headers: authed(),
      payload: { endpoint: `ep-${svc}` },
    });
    expect(res.statusCode).toBe(200);
    const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    expect(rows).toHaveLength(0);
  });

  it("serves the vapid public key without a session", async () => {
    const res = await app.inject({ method: "GET", url: "/push/vapid-key", headers: { host: "localhost" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().publicKey).toBe("TEST_PUBLIC_KEY");
  });
});
