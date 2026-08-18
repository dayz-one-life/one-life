import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { avatars, gamertagLinks, lives, players, servers, user, userBlocks } from "@onelife/db";
import { createAuth, type Mailer } from "@onelife/auth";
import { buildApp } from "../src/app.js";
import { getTestDb } from "@onelife/test-support";

/**
 * The block dialog promises "Blocking hides their avatar from you". These are the two PUBLIC
 * read surfaces that promise has to hold on, exercised over HTTP so the session-threading in
 * the routes is covered, not just the read-model predicate:
 *
 *   • GET /players/:gamertag  (the dossier)
 *   • GET /survivors/:slug    (the board)
 *
 * ⚠️ A block is VIEWER-SCOPED, a hash ban is GLOBAL. The third-party cases below are the ones
 * that tell the two apart; without them this feature is indistinguishable from handing every
 * user a unilateral takedown button. `GET /players/:gamertag/:map/lives/:n` (the life timeline)
 * is DELIBERATELY not viewer-scoped — apps/web fetches it through the cookie-free, shared
 * `getOrNullCached`, so a viewer's block list threaded through it would leak between viewers.
 */
const { db, sql } = getTestDb();

const svc = Math.floor(Math.random() * 1e8) + 81e7;
const SUBJECT_TAG = `BlockVis${svc}`;
const SLUG = `blockvis-${svc}`;
const HASH = `blockvishash${svc}`;
const subjectUserId = `bv-subject-${svc}`;
const strangerEmail = `bvstranger${svc}@example.com`;
const blockerEmail = `bvblocker${svc}@example.com`;

let lastLink = "";
const captureMailer: Mailer = { async send(msg) { lastLink = msg.url; } };
const auth = createAuth(db, {
  secret: "s".repeat(32), baseURL: "http://localhost", trustedOrigins: ["http://localhost"],
  providers: {}, mailer: captureMailer,
});
const app = buildApp(db, { auth, corsOrigins: ["http://localhost"] });

let blockerCookie = "";
let strangerCookie = "";
let blockerUserId = "";
let strangerUserId = "";
let serverId = 0;
let playerId = 0;

function cookieHeader(setCookie: string | string[] | undefined): string {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr.map((c) => c.split(";")[0]).join("; ");
}

/** Sign in by magic link and return { cookie, userId }. */
async function signIn(email: string): Promise<{ cookie: string; userId: string }> {
  await app.inject({
    method: "POST", url: "/api/auth/sign-in/magic-link",
    headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost" },
    payload: { email },
  });
  const verify = await app.inject({
    method: "GET", url: lastLink.replace(/^https?:\/\/[^/]+/, ""), headers: { host: "localhost" },
  });
  const cookie = cookieHeader(verify.headers["set-cookie"] as string | string[] | undefined);
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase()));
  return { cookie, userId: u!.id };
}

/** The dossier's avatarHash for the subject, as `cookie` sees it (omit for signed-out). */
async function dossierHash(cookie?: string): Promise<string | null> {
  const res = await app.inject({
    method: "GET", url: `/players/${SUBJECT_TAG}`,
    ...(cookie ? { headers: { cookie, host: "localhost" } } : { headers: { host: "localhost" } }),
  });
  expect(res.statusCode).toBe(200);
  return res.json().avatarHash;
}

/** The board's avatarHash for the subject's row, as `cookie` sees it. */
async function boardHash(cookie?: string): Promise<string | null> {
  const res = await app.inject({
    method: "GET", url: `/survivors/${SLUG}`,
    ...(cookie ? { headers: { cookie, host: "localhost" } } : { headers: { host: "localhost" } }),
  });
  expect(res.statusCode).toBe(200);
  const row = res.json().rows.find((r: { gamertag: string }) => r.gamertag === SUBJECT_TAG);
  expect(row, "the subject must be ON the board — a block hides the face, never the row").toBeTruthy();
  return row.avatarHash;
}

beforeAll(async () => {
  await app.ready();

  const [s] = await db.insert(servers).values({
    nitradoServiceId: svc, name: `BlockVis${svc}`, map: "chernarusplus", slug: SLUG, active: true,
  }).returning();
  serverId = s!.id;

  const startedAt = new Date(Date.now() - 2 * 3600_000);
  const [p] = await db.insert(players).values({
    gamertag: SUBJECT_TAG, firstSeenAt: startedAt, lastSeenAt: new Date(),
  }).returning();
  playerId = p!.id;
  // OPEN (alive) and qualified — this is what puts the subject on the survivors board.
  await db.insert(lives).values({
    serverId, playerId, lifeNumber: 1, startedAt, endedAt: null, playtimeSeconds: 3600,
  });

  await db.insert(user).values({
    id: subjectUserId, name: subjectUserId, email: `${subjectUserId}@example.test`, emailVerified: true,
    createdAt: new Date(), updatedAt: new Date(),
  });
  await db.insert(gamertagLinks).values({
    userId: subjectUserId, gamertag: SUBJECT_TAG, status: "verified", verifiedAt: new Date(),
  });
  await db.insert(avatars).values({
    userId: subjectUserId, image: Buffer.from([1, 2, 3, 4]), hash: HASH, source: "upload", updatedAt: new Date(),
  });

  ({ cookie: blockerCookie, userId: blockerUserId } = await signIn(blockerEmail));
  ({ cookie: strangerCookie, userId: strangerUserId } = await signIn(strangerEmail));

  await db.insert(userBlocks).values({
    blockerUserId, blockedUserId: subjectUserId, blockedGamertag: SUBJECT_TAG,
  });
});

afterAll(async () => {
  await app.close();
  // ⚠️ FK-safe order, and `afterAll` as well as any per-test cleanup: this file shares one
  // database with every other api test file (fileParallelism: false), so rows left behind here
  // break a later file's `db.delete(user)` with an FK violation.
  await db.delete(userBlocks);
  await db.delete(avatars).where(eq(avatars.userId, subjectUserId));
  await db.delete(gamertagLinks).where(eq(gamertagLinks.userId, subjectUserId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(players).where(eq(players.id, playerId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await db.delete(user).where(inArray(user.id, [subjectUserId, blockerUserId, strangerUserId]));
  await sql.end();
});

describe("a block hides the blocked player's avatar from the blocker — dossier", () => {
  it("hides it from the blocker", async () => {
    expect(await dossierHash(blockerCookie)).toBeNull();
  });

  // ⚠️ THE assertion the whole design rests on.
  it("still shows it to an unrelated THIRD PARTY", async () => {
    expect(await dossierHash(strangerCookie)).toBe(HASH);
  });

  it("still shows it to a signed-out visitor", async () => {
    expect(await dossierHash()).toBe(HASH);
  });
});

describe("a block hides the blocked player's avatar from the blocker — survivors board", () => {
  it("hides it from the blocker", async () => {
    expect(await boardHash(blockerCookie)).toBeNull();
  });

  it("still shows it to an unrelated THIRD PARTY", async () => {
    expect(await boardHash(strangerCookie)).toBe(HASH);
  });

  it("still shows it to a signed-out visitor", async () => {
    expect(await boardHash()).toBe(HASH);
  });
});

describe("unblocking restores the avatar for the blocker", () => {
  it("brings it back on both surfaces", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/me/blocks/${SUBJECT_TAG}`,
      headers: { cookie: blockerCookie, host: "localhost" },
    });
    expect(res.statusCode).toBe(200);
    try {
      expect(await dossierHash(blockerCookie)).toBe(HASH);
      expect(await boardHash(blockerCookie)).toBe(HASH);
    } finally {
      await db.insert(userBlocks).values({
        blockerUserId, blockedUserId: subjectUserId, blockedGamertag: SUBJECT_TAG,
      });
    }
  });
});
