import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { avatars, avatarReports, blockedAvatarHashes, gamertagLinks, user } from "@onelife/db";
import { createAuth, type Mailer } from "@onelife/auth";
import { buildApp } from "../src/app.js";
import { getAvatarByHash } from "../src/lib/avatar-store.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();

const svc = Math.floor(Math.random() * 1e8) + 3e8;
const reporterEmail = `rptr${svc}@example.com`;
const HASH = "dddd4444dddd4444dddd4444dddd4444dddd4444dddd4444dddd4444dddd4444";
const BYTES = Buffer.from([7, 7, 7, 7]);
const subjectUserId = `rsubject${svc}`;

let lastLink = "";
const captureMailer: Mailer = { async send(msg) { lastLink = msg.url; } };
const auth = createAuth(db, {
  secret: "s".repeat(32), baseURL: "http://localhost", trustedOrigins: ["http://localhost"],
  providers: {}, mailer: captureMailer,
});
const app = buildApp(db, { auth, corsOrigins: ["http://localhost"] });

let reporterCookie = "";

function cookieHeader(setCookie: string | string[] | undefined): string {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr.map((c) => c.split(";")[0]).join("; ");
}

beforeAll(async () => {
  await app.ready();
  await app.inject({
    method: "POST", url: "/api/auth/sign-in/magic-link",
    headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost" },
    payload: { email: reporterEmail },
  });
  const verify = await app.inject({
    method: "GET", url: lastLink.replace(/^https?:\/\/[^/]+/, ""), headers: { host: "localhost" },
  });
  reporterCookie = cookieHeader(verify.headers["set-cookie"] as string | string[] | undefined);

  const [r] = await db.select({ id: user.id }).from(user).where(eq(user.email, reporterEmail.toLowerCase()));
  await db.insert(gamertagLinks).values({
    userId: r!.id, gamertag: `Rpt${svc}`, status: "verified", verifiedAt: new Date(),
  });

  await db.insert(user).values({
    id: subjectUserId, name: subjectUserId, email: `${subjectUserId}@example.test`, emailVerified: true,
    createdAt: new Date(), updatedAt: new Date(),
  });
  await db.insert(avatars).values({ userId: subjectUserId, image: BYTES, hash: HASH, source: "upload", updatedAt: new Date() });
});

afterAll(async () => {
  await app.close();
  await db.delete(avatarReports);
  await db.delete(blockedAvatarHashes);
  await db.delete(avatars);
  await db.delete(gamertagLinks);
  await db.delete(user).where(eq(user.id, subjectUserId));
  await sql`DELETE FROM "session" WHERE user_id IN (SELECT id FROM "user" WHERE email = ${reporterEmail})`;
  await sql`DELETE FROM "account" WHERE user_id IN (SELECT id FROM "user" WHERE email = ${reporterEmail})`;
  await sql`DELETE FROM "verification" WHERE identifier LIKE ${"%" + svc + "%"}`;
  await sql`DELETE FROM "user" WHERE email = ${reporterEmail}`;
  await sql.end();
});

const report = (payload: Record<string, unknown>) =>
  app.inject({
    method: "POST", url: "/me/reports/avatar", payload,
    headers: { "content-type": "application/json", cookie: reporterCookie },
  });

describe("POST /me/reports/avatar", () => {
  it("400s without a subjectHash", async () => {
    const res = await report({ reason: "hate" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "bad_request" });
  });

  it("404s when no live avatar holds the named hash", async () => {
    const res = await report({ subjectHash: "nosuchhash".padEnd(64, "0"), reason: "hate" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "unknown_hash" });
  });

  it("201s and auto-hides when a live avatar holds the named hash", async () => {
    const res = await report({ subjectHash: HASH, reason: "hate" });
    expect(res.statusCode).toBe(201);
    expect(await getAvatarByHash(db, HASH)).toBeNull();
  });

  it("401s when signed out", async () => {
    const res = await app.inject({
      method: "POST", url: "/me/reports/avatar", payload: { subjectHash: HASH, reason: "hate" },
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(401);
  });
});
