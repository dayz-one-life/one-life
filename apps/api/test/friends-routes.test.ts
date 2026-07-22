import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, gamertagLinks } from "@onelife/db";
import { eq } from "drizzle-orm";
import { createAuth, type Mailer } from "@onelife/auth";
import { buildApp } from "../src/app.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
// Unique per run so repeated local runs don't collide on the email/gamertag unique indexes.
const svc = Math.floor(Math.random() * 1e8) + 7e8;
const emailA = `frA${svc}@example.com`;
const emailB = `frB${svc}@example.com`;
const tagA = `FriendAlpha${svc}`;
const tagB = `FriendBravo${svc}`;

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

/** Drive a real magic-link sign-in and return that session's cookie. */
async function signIn(email: string): Promise<string> {
  await app.inject({
    method: "POST", url: "/api/auth/sign-in/magic-link",
    headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost" },
    payload: { email },
  });
  const verifyPath = lastLink.replace(/^https?:\/\/[^/]+/, "");
  const verify = await app.inject({ method: "GET", url: verifyPath, headers: { host: "localhost" } });
  return cookieHeader(verify.headers["set-cookie"] as string | string[] | undefined);
}

let cookieA = "";
let cookieB = "";

const get = (cookie: string, url: string) => app.inject({ method: "GET", url, headers: { cookie } });
const post = (cookie: string, url: string, payload?: unknown) =>
  app.inject({
    method: "POST", url,
    headers: { cookie, ...(payload ? { "content-type": "application/json" } : {}) },
    payload: payload as never,
  });
const del = (cookie: string, url: string) => app.inject({ method: "DELETE", url, headers: { cookie } });

beforeAll(async () => {
  await app.ready();
  cookieA = await signIn(emailA);
  cookieB = await signIn(emailB);
  const [ua] = await db.select({ id: user.id }).from(user).where(eq(user.email, emailA.toLowerCase()));
  const [ub] = await db.select({ id: user.id }).from(user).where(eq(user.email, emailB.toLowerCase()));
  await db.insert(gamertagLinks).values([
    { userId: ua!.id, gamertag: tagA, status: "verified", verifiedAt: new Date() },
    { userId: ub!.id, gamertag: tagB, status: "verified", verifiedAt: new Date() },
  ]);
});
afterAll(async () => { await app.close(); await sql.end(); });

describe("friend routes", () => {
  it("401s every route when signed out", async () => {
    expect((await app.inject({ method: "GET", url: "/me/friends" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `/me/friends/status?gamertag=${tagB}` })).statusCode).toBe(401);
    expect((await app.inject({ method: "DELETE", url: "/me/friends/1" })).statusCode).toBe(401);
  });

  it("400s not_verified for a gamertag nobody has verified", async () => {
    const res = await post(cookieA, "/me/friends/requests", { toGamertag: "NoSuchPlayerAnywhere" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("not_verified");
  });

  // Ordered: this creates the request the remaining cases operate on.
  it("creates a request addressed by gamertag, case-insensitively", async () => {
    const res = await post(cookieA, "/me/friends/requests", { toGamertag: tagB.toLowerCase() });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("pending");
  });

  it("serves the viewer's relationship status from both sides", async () => {
    expect((await get(cookieA, `/me/friends/status?gamertag=${tagB}`)).json().status).toBe("outgoing");
    expect((await get(cookieB, `/me/friends/status?gamertag=${tagA}`)).json().status).toBe("incoming");
  });

  it("403s when the sender tries to accept their own request", async () => {
    const id = (await get(cookieB, "/me/friends")).json().incoming[0].id;
    expect((await post(cookieA, `/me/friends/${id}/accept`)).statusCode).toBe(403);
  });

  it("404s a mutation on a friendship that does not exist", async () => {
    expect((await del(cookieA, "/me/friends/99999999")).statusCode).toBe(404);
  });

  it("lets the recipient accept, after which both sides see a friend", async () => {
    const id = (await get(cookieB, "/me/friends")).json().incoming[0].id;
    expect((await post(cookieB, `/me/friends/${id}/accept`)).statusCode).toBe(200);
    expect((await get(cookieA, "/me/friends")).json().friends).toHaveLength(1);
    expect((await get(cookieB, "/me/friends")).json().friends).toHaveLength(1);
  });

  it("429s with the expiry when the cooldown is active", async () => {
    // Tear the pair down, then re-request and decline to arm the cooldown.
    const id = (await get(cookieA, "/me/friends")).json().friends[0].id;
    expect((await del(cookieA, `/me/friends/${id}`)).statusCode).toBe(200);
    await post(cookieA, "/me/friends/requests", { toGamertag: tagB });
    const pendingId = (await get(cookieB, "/me/friends")).json().incoming[0].id;
    expect((await post(cookieB, `/me/friends/${pendingId}/decline`)).statusCode).toBe(200);

    const res = await post(cookieA, "/me/friends/requests", { toGamertag: tagB });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe("cooldown_active");
    expect(typeof res.json().until).toBe("string");
  });
});
