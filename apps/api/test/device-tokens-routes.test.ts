import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, devicePushTokens } from "@onelife/db";
import { eq } from "drizzle-orm";
import { createAuth, type Mailer } from "@onelife/auth";
import { buildApp } from "../src/app.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 6e8;
const email = `dvt${svc}@example.com`;

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
    .values({ id: `dvt-other-${svc}`, name: "Other", email: `other${svc}@example.com` })
    .returning();
  otherUserId = other!.id;
});

afterAll(async () => {
  await sql`DELETE FROM device_push_tokens WHERE user_id IN (${userId}, ${otherUserId})`;
  await sql`DELETE FROM "session" WHERE user_id = ${userId}`;
  await sql`DELETE FROM "account" WHERE user_id = ${userId}`;
  await sql`DELETE FROM "user" WHERE id IN (${userId}, ${otherUserId})`;
  await sql.end();
});

const authed = () => ({ host: "localhost", cookie, "content-type": "application/json" });

describe("device token routes", () => {
  it("401s without a session", async () => {
    for (const [method, url] of [["POST", "/me/device-tokens"], ["GET", "/me/device-tokens?token=t"], ["DELETE", "/me/device-tokens"]] as const) {
      const res = await app.inject({ method, url, headers: { host: "localhost" } });
      expect(res.statusCode).toBe(401);
    }
  });

  it("400s on an unknown platform", async () => {
    const res = await app.inject({
      method: "POST", url: "/me/device-tokens", headers: authed(),
      payload: { token: "t1", platform: "windows", deviceId: "d1" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("registers a token and reports it active", async () => {
    const res = await app.inject({
      method: "POST", url: "/me/device-tokens", headers: authed(),
      payload: { token: "t-active", platform: "ios", deviceId: "d1" },
    });
    expect(res.statusCode).toBe(200);
    const status = await app.inject({
      method: "GET", url: "/me/device-tokens?token=t-active", headers: authed(),
    });
    expect(status.json()).toEqual({ active: true });
  });

  it("revives a token the notifier had retired", async () => {
    await db.insert(devicePushTokens).values({
      userId, token: "t-dead", platform: "ios", deviceId: "d-dead",
      failureCount: 5, disabledAt: new Date(),
    });
    await app.inject({
      method: "POST", url: "/me/device-tokens", headers: authed(),
      payload: { token: "t-dead", platform: "ios", deviceId: "d-dead" },
    });
    const [row] = await db.select().from(devicePushTokens).where(eq(devicePushTokens.token, "t-dead"));
    expect(row!.disabledAt).toBeNull();
    expect(row!.failureCount).toBe(0);
  });

  // FCM rotates tokens. Without the reap, every rotation leaves a dead row behind that the
  // notifier keeps paying a failed request for until it retires five ticks later.
  it("reaps the device's previous token when a rotated one registers", async () => {
    await app.inject({
      method: "POST", url: "/me/device-tokens", headers: authed(),
      payload: { token: "t-old", platform: "android", deviceId: "d-rot" },
    });
    await app.inject({
      method: "POST", url: "/me/device-tokens", headers: authed(),
      payload: { token: "t-new", platform: "android", deviceId: "d-rot" },
    });
    const rows = await db.select().from(devicePushTokens).where(eq(devicePushTokens.deviceId, "d-rot"));
    expect(rows.map((r) => r.token)).toEqual(["t-new"]);
  });

  // The client is supposed to unregister at sign-out, but a client that crashed, was force-quit,
  // or was reinstalled never got to. Because `token` is unique and the upsert overwrites the
  // owner, the next sign-in moves the row with no client cooperation at all.
  it("moves a token to the new owner when a second account registers it", async () => {
    await db.insert(devicePushTokens).values({
      userId: otherUserId, token: "t-shared", platform: "ios", deviceId: "d-shared",
    });
    await app.inject({
      method: "POST", url: "/me/device-tokens", headers: authed(),
      payload: { token: "t-shared", platform: "ios", deviceId: "d-shared" },
    });
    const rows = await db.select().from(devicePushTokens).where(eq(devicePushTokens.token, "t-shared"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(userId);
  });

  it("does not delete another user's token, and does not admit it exists", async () => {
    await db.insert(devicePushTokens).values({
      userId: otherUserId, token: "t-theirs", platform: "ios", deviceId: "d-theirs",
    });
    const del = await app.inject({
      method: "DELETE", url: "/me/device-tokens", headers: authed(), payload: { token: "t-theirs" },
    });
    expect(del.statusCode).toBe(200);
    expect(await db.select().from(devicePushTokens).where(eq(devicePushTokens.token, "t-theirs"))).toHaveLength(1);

    const status = await app.inject({
      method: "GET", url: "/me/device-tokens?token=t-theirs", headers: authed(),
    });
    expect(status.json()).toEqual({ active: false });
  });

  it("deletes the caller's own token", async () => {
    await app.inject({
      method: "POST", url: "/me/device-tokens", headers: authed(),
      payload: { token: "t-mine", platform: "ios", deviceId: "d-mine" },
    });
    await app.inject({
      method: "DELETE", url: "/me/device-tokens", headers: authed(), payload: { token: "t-mine" },
    });
    const status = await app.inject({
      method: "GET", url: "/me/device-tokens?token=t-mine", headers: authed(),
    });
    expect(status.json()).toEqual({ active: false });
  });
});
