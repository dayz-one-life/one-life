import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, user, gamertagLinks, bans } from "@onelife/db";
import { eq } from "drizzle-orm";
import { createAuth, type Mailer } from "@onelife/auth";
import { buildApp } from "../src/app.js";
import { getTestDb } from "@onelife/test-support";
import { grant } from "@onelife/tokens";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 5e8;
const email = `tok${svc}@example.com`;
const GT = `TokUser${svc}`;

let lastLink = "";
const captureMailer: Mailer = { async send(msg) { lastLink = msg.url; } };
const auth = createAuth(db, {
  secret: "s".repeat(32), baseURL: "http://localhost", trustedOrigins: ["http://localhost"],
  providers: {}, mailer: captureMailer,
});
const app = buildApp(db, { auth, corsOrigins: ["http://localhost"] });

function cookieHeader(setCookie: string | string[] | undefined): string {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr.map((c) => c.split(";")[0]).join("; ");
}
let cookie = "";
let userId = "";
let serverId: number;

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
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "tok-test" }).returning();
  serverId = s!.id;
  await db.insert(gamertagLinks).values({ userId, gamertag: GT, status: "verified" });
  await grant(db, { userId, kind: "verification", idempotencyKey: `verify:tokroute:${svc}` });
});

afterAll(async () => {
  await db.delete(bans).where(eq(bans.serverId, serverId));
  await db.delete(gamertagLinks).where(eq(gamertagLinks.userId, userId));
  await sql`DELETE FROM token_transactions WHERE user_id = ${userId}`;
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql`DELETE FROM "session" WHERE user_id = ${userId}`;
  await sql`DELETE FROM "account" WHERE user_id = ${userId}`;
  await sql`DELETE FROM "user" WHERE id = ${userId}`;
  await sql.end();
});

const authed = () => ({ host: "localhost", cookie, "content-type": "application/json" });

describe("token routes", () => {
  it("401 without a session", async () => {
    const res = await app.inject({ method: "GET", url: "/me/tokens", headers: { host: "localhost" } });
    expect(res.statusCode).toBe(401);
  });

  it("GET /me/tokens returns the balance", async () => {
    const res = await app.inject({ method: "GET", url: "/me/tokens", headers: authed() });
    expect(res.statusCode).toBe(200);
    expect(res.json().balance).toBe(1);
  });

  it("redeem lifts the user's active ban (→ lift_pending) and spends the token", async () => {
    const L = new Date("2026-07-11T10:00:00Z");
    await db.insert(bans).values({ serverId, gamertag: GT, lifeStartedAt: L, reason: "qualified_death", bannedAt: L, status: "applied", dryRun: false });
    const res = await app.inject({ method: "POST", url: "/me/tokens/redeem", headers: authed(), payload: {} });
    expect(res.statusCode).toBe(200);
    const [b] = await db.select().from(bans).where(eq(bans.serverId, serverId));
    expect(b!.status).toBe("lift_pending");
  });

  it("redeem 400s when nothing is liftable / no token remains", async () => {
    const res = await app.inject({ method: "POST", url: "/me/tokens/redeem", headers: authed(), payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("set-referrer 400s (not_verified) for an unknown referrer", async () => {
    const res = await app.inject({ method: "POST", url: "/me/referrer", headers: authed(), payload: { referrerUserId: "ghost-user" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("not_verified");
  });
});
