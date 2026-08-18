import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { avatars, avatarReports, blockedAvatarHashes, gamertagLinks, user } from "@onelife/db";
import { createAuth, type Mailer } from "@onelife/auth";
import { buildApp } from "../src/app.js";
import { getAvatarByHash } from "../src/lib/avatar-store.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();

const HASH = "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222";
const BYTES = Buffer.from([9, 9, 9, 9]);

const svc = Math.floor(Math.random() * 1e8) + 5e8;
const moderatorEmail = `modr${svc}@example.com`;
const ordinaryEmail = `ordu${svc}@example.com`;
const subjectUserId = `subject${svc}`;
const reporterUserId = `reporter${svc}`;

let lastLink = "";
const captureMailer: Mailer = { async send(msg) { lastLink = msg.url; } };
const auth = createAuth(db, {
  secret: "s".repeat(32), baseURL: "http://localhost", trustedOrigins: ["http://localhost"],
  providers: {}, mailer: captureMailer,
});

let moderatorUserId = "";
let ordinaryUserId = "";
let moderatorCookie = "";
let ordinaryCookie = "";

function cookieHeader(setCookie: string | string[] | undefined): string {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr.map((c) => c.split(";")[0]).join("; ");
}

async function signIn(tmpApp: ReturnType<typeof buildApp>, email: string): Promise<string> {
  await tmpApp.inject({
    method: "POST", url: "/api/auth/sign-in/magic-link",
    headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost" },
    payload: { email },
  });
  const verifyPath = lastLink.replace(/^https?:\/\/[^/]+/, "");
  const verify = await tmpApp.inject({ method: "GET", url: verifyPath, headers: { host: "localhost" } });
  return cookieHeader(verify.headers["set-cookie"] as string | string[] | undefined);
}

function authHeaders(cookie: string): Record<string, string> {
  return { host: "localhost", cookie };
}

let app: ReturnType<typeof buildApp>;

async function seedAvatarAndReport() {
  await db.insert(user).values({
    id: subjectUserId, name: "subject", email: `${subjectUserId}@example.test`, emailVerified: true,
    createdAt: new Date(), updatedAt: new Date(),
  });
  await db.insert(user).values({
    id: reporterUserId, name: "reporter", email: `${reporterUserId}@example.test`, emailVerified: true,
    createdAt: new Date(), updatedAt: new Date(),
  });
  await db.insert(gamertagLinks).values({
    userId: reporterUserId, gamertag: `Rep${svc}`, status: "verified", verifiedAt: new Date(), createdAt: new Date(),
  });
  await db.insert(avatars).values({ userId: subjectUserId, image: BYTES, hash: HASH, source: "upload", updatedAt: new Date() });
  await db.insert(blockedAvatarHashes).values({ hash: HASH, state: "auto" });
  await db.insert(avatarReports).values({
    reporterUserId, subjectUserId, subjectHash: HASH, reason: "hate", createdAt: new Date(),
  });
}

beforeAll(async () => {
  await seedAvatarAndReport();

  app = buildApp(db, { auth, corsOrigins: ["http://localhost"], moderatorUserIds: [] });
  await app.ready();
  moderatorCookie = await signIn(app, moderatorEmail);
  const [mu] = await db.select({ id: user.id }).from(user).where(eq(user.email, moderatorEmail));
  moderatorUserId = mu!.id;
  await app.close();

  const other = buildApp(db, { auth, corsOrigins: ["http://localhost"], moderatorUserIds: [] });
  await other.ready();
  ordinaryCookie = await signIn(other, ordinaryEmail);
  const [ou] = await db.select({ id: user.id }).from(user).where(eq(user.email, ordinaryEmail));
  ordinaryUserId = ou!.id;
  await other.close();

  app = buildApp(db, { auth, corsOrigins: ["http://localhost"], moderatorUserIds: [moderatorUserId] });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await sql`DELETE FROM "session" WHERE user_id IN (SELECT id FROM "user" WHERE email IN (${moderatorEmail}, ${ordinaryEmail}))`;
  await sql`DELETE FROM "account" WHERE user_id IN (SELECT id FROM "user" WHERE email IN (${moderatorEmail}, ${ordinaryEmail}))`;
  await sql`DELETE FROM "verification" WHERE identifier LIKE ${"%example.com"}`;
  await db.delete(avatarReports);
  await db.delete(blockedAvatarHashes);
  await db.delete(avatars);
  await db.delete(gamertagLinks);
  await sql`DELETE FROM "user" WHERE email IN (${moderatorEmail}, ${ordinaryEmail})`;
  await db.delete(user).where(eq(user.id, subjectUserId));
  await db.delete(user).where(eq(user.id, reporterUserId));
  await sql.end();
});

describe("moderation routes", () => {
  // ⚠️ The fail-safe direction. An unset env var must lock moderation, not open it.
  it("403s for everyone when no moderators are configured", async () => {
    const bare = buildApp(db, { auth, corsOrigins: ["http://localhost"], moderatorUserIds: [] });
    await bare.ready();
    const res = await bare.inject({ method: "GET", url: "/moderation/queue", headers: authHeaders(moderatorCookie) });
    expect(res.statusCode).toBe(403);
    await bare.close();
  });

  it("401s when signed out", async () => {
    const res = await app.inject({ method: "GET", url: "/moderation/queue" });
    expect(res.statusCode).toBe(401);
  });

  it("403s for a signed-in non-moderator", async () => {
    const res = await app.inject({ method: "GET", url: "/moderation/queue", headers: authHeaders(ordinaryCookie) });
    expect(res.statusCode).toBe(403);
  });

  it("returns the queue for a moderator, newest first, with report context", async () => {
    const res = await app.inject({ method: "GET", url: "/moderation/queue", headers: authHeaders(moderatorCookie) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entries[0]).toMatchObject({ hash: HASH, state: "auto", reportCount: 1 });
    expect(body.entries[0].reasons).toEqual(["hate"]);
  });

  // ⚠️ The moderator must be able to SEE what they are judging. The ban is exactly what makes
  // GET /avatars/:hash.webp 404, so without this route Restore/Confirm are decided blind.
  it("serves the banned image to a moderator, bypassing the ban filter", async () => {
    // The public byte path refuses these bytes precisely BECAUSE the hash is banned.
    expect(await getAvatarByHash(db, HASH)).toBeNull();

    const res = await app.inject({
      method: "GET", url: `/moderation/hashes/${HASH}/image`, headers: authHeaders(moderatorCookie),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/webp");
    // Moderation data must never sit in a cache.
    expect(String(res.headers["cache-control"])).toContain("no-store");
    expect(Buffer.from(res.rawPayload).equals(BYTES)).toBe(true);
  });

  it("403s a signed-in non-moderator asking for the image", async () => {
    const res = await app.inject({
      method: "GET", url: `/moderation/hashes/${HASH}/image`, headers: authHeaders(ordinaryCookie),
    });
    expect(res.statusCode).toBe(403);
  });

  it("401s a signed-out caller asking for the image", async () => {
    const res = await app.inject({ method: "GET", url: `/moderation/hashes/${HASH}/image` });
    expect(res.statusCode).toBe(401);
  });

  it("404s the image for a hash no row holds", async () => {
    const res = await app.inject({
      method: "GET", url: `/moderation/hashes/${"f".repeat(64)}/image`, headers: authHeaders(moderatorCookie),
    });
    expect(res.statusCode).toBe(404);
  });

  it("403s a non-moderator attempting to restore", async () => {
    const res = await app.inject({
      method: "POST", url: `/moderation/hashes/${HASH}/restore`, headers: authHeaders(ordinaryCookie),
    });
    expect(res.statusCode).toBe(403);
    expect(await getAvatarByHash(db, HASH)).toBeNull();
  });

  it("restores a banned hash", async () => {
    const res = await app.inject({
      method: "POST", url: `/moderation/hashes/${HASH}/restore`, headers: authHeaders(moderatorCookie),
    });
    expect(res.statusCode).toBe(200);
    expect(await getAvatarByHash(db, HASH)).not.toBeNull();
  });

  // The queue is a list of things still awaiting a decision. A restored hash keeps a durable
  // 'allowed' row so a later report cannot silently re-hide it — but it is not pending review.
  it("omits a restored hash from the queue", async () => {
    const res = await app.inject({ method: "GET", url: "/moderation/queue", headers: authHeaders(moderatorCookie) });
    expect(res.statusCode).toBe(200);
    expect(res.json().entries.map((e: { hash: string }) => e.hash)).not.toContain(HASH);
    // The row is still there — that is what makes the restore durable.
    const [row] = await db.select().from(blockedAvatarHashes).where(eq(blockedAvatarHashes.hash, HASH));
    expect(row?.state).toBe("allowed");
    expect(row?.blockedByUserId).toBe(moderatorUserId);
  });

  // ⚠️ Confirm is the DESTRUCTIVE half — it NULLs the bytes for every row holding this hash.
  // It needs the auth test at least as much as restore does.
  it("403s a signed-in non-moderator attempting to confirm", async () => {
    const res = await app.inject({
      method: "POST", url: `/moderation/hashes/${HASH}/confirm`, headers: authHeaders(ordinaryCookie),
    });
    expect(res.statusCode).toBe(403);
    const [row] = await db.select({ image: avatars.image }).from(avatars).where(eq(avatars.userId, subjectUserId));
    expect(row?.image).not.toBeNull();
  });

  it("401s a signed-out caller attempting to confirm", async () => {
    const res = await app.inject({ method: "POST", url: `/moderation/hashes/${HASH}/confirm` });
    expect(res.statusCode).toBe(401);
    const [row] = await db.select({ image: avatars.image }).from(avatars).where(eq(avatars.userId, subjectUserId));
    expect(row?.image).not.toBeNull();
  });

  it("404s the image once a confirm has destroyed the bytes", async () => {
    await app.inject({
      method: "POST", url: `/moderation/hashes/${HASH}/confirm`, headers: authHeaders(moderatorCookie),
    });
    const res = await app.inject({
      method: "GET", url: `/moderation/hashes/${HASH}/image`, headers: authHeaders(moderatorCookie),
    });
    expect(res.statusCode).toBe(404);
  });

  it("confirms a ban, destroying the bytes", async () => {
    // The previous test's confirm already NULLed these bytes — re-seed them so this
    // test genuinely exercises confirm's destructive effect rather than finding an
    // already-null row.
    await db.update(avatars).set({ image: BYTES, hash: HASH }).where(eq(avatars.userId, subjectUserId));
    // Re-ban first since the previous test lifted it.
    await db.insert(blockedAvatarHashes).values({ hash: HASH, state: "auto" }).onConflictDoNothing();
    const res = await app.inject({
      method: "POST", url: `/moderation/hashes/${HASH}/confirm`, headers: authHeaders(moderatorCookie),
    });
    expect(res.statusCode).toBe(200);
    const [row] = await db.select({ image: avatars.image }).from(avatars).where(eq(avatars.userId, subjectUserId));
    expect(row?.image).toBeNull();
  });
});
