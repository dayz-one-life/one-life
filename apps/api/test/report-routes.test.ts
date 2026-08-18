import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { avatars, avatarReports, blockedAvatarHashes, gamertagLinks, user } from "@onelife/db";
import { createAuth, type Mailer } from "@onelife/auth";
import { buildApp } from "../src/app.js";
import { getAvatarByHash, unbanAvatarHash } from "../src/lib/avatar-store.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();

const svc = Math.floor(Math.random() * 1e8) + 3e8;
const reporterEmail = `rptr${svc}@example.com`;
// A SECOND verified reporter, needed because `already_reported` (the reporter's own history)
// is more specific than `already_reviewed` (the moderator's restore) and wins when both
// apply — so only a reporter who has never touched this hash can exercise the latter.
const reporter2Email = `rptr2${svc}@example.com`;
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
let reporter2Cookie = "";

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

  await app.inject({
    method: "POST", url: "/api/auth/sign-in/magic-link",
    headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost" },
    payload: { email: reporter2Email },
  });
  const verify2 = await app.inject({
    method: "GET", url: lastLink.replace(/^https?:\/\/[^/]+/, ""), headers: { host: "localhost" },
  });
  reporter2Cookie = cookieHeader(verify2.headers["set-cookie"] as string | string[] | undefined);
  const [r2] = await db.select({ id: user.id }).from(user).where(eq(user.email, reporter2Email.toLowerCase()));
  await db.insert(gamertagLinks).values({
    userId: r2!.id, gamertag: `Rpt2${svc}`, status: "verified", verifiedAt: new Date(),
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
  await sql`DELETE FROM "session" WHERE user_id IN (SELECT id FROM "user" WHERE email IN (${reporterEmail}, ${reporter2Email}))`;
  await sql`DELETE FROM "account" WHERE user_id IN (SELECT id FROM "user" WHERE email IN (${reporterEmail}, ${reporter2Email}))`;
  await sql`DELETE FROM "verification" WHERE identifier LIKE ${"%" + svc + "%"}`;
  await sql`DELETE FROM "user" WHERE email IN (${reporterEmail}, ${reporter2Email})`;
  await sql.end();
});

const report = (payload: Record<string, unknown>, cookie = reporterCookie) =>
  app.inject({
    method: "POST", url: "/me/reports/avatar", payload,
    headers: { "content-type": "application/json", cookie },
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

  // ⚠️ Runs AFTER the 201 above, so the hash is banned; restoring it puts the row in the
  // durable `allowed` state. A further report must not answer 201 — the client renders "hidden
  // straight away" on 201, and the queue excludes `allowed` rows, so a 201 here would be a
  // false success on a report no moderator can ever see. 409 shares its status with
  // `already_reported`; the CODE is what the client switches on.
  //
  // ⚠️ Reported by the SECOND reporter: the first already has a row for this hash, and
  // `already_reported` is the more specific answer for them (see the sibling test below).
  it("409s already_reviewed once a moderator has restored the hash", async () => {
    await unbanAvatarHash(db, HASH, "route-test-moderator");
    const res = await report({ subjectHash: HASH, reason: "sexual" }, reporter2Cookie);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "already_reviewed" });
    // Still visible: the moderator's decision stood...
    expect(await getAvatarByHash(db, HASH)).not.toBeNull();
    // ...but the objection is on record rather than silently dropped, so a restored image can
    // still accumulate evidence and find its way back to a human.
    expect(await db.select().from(avatarReports)).toHaveLength(2);
  });

  it("409s already_reported when the SAME reporter files again against a restored hash", async () => {
    const res = await report({ subjectHash: HASH, reason: "sexual" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "already_reported" });
  });

  it("401s when signed out", async () => {
    const res = await app.inject({
      method: "POST", url: "/me/reports/avatar", payload: { subjectHash: HASH, reason: "hate" },
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(401);
  });
});
