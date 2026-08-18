import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  user, gamertagLinks, servers, players, lives, sessions, locationShares, userBlocks,
} from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { createAuth, type Mailer } from "@onelife/auth";
import { buildApp } from "../src/app.js";
import { getTestDb } from "@onelife/test-support";
import { blockUser } from "../src/lib/moderation.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 7e8;
const granterEmail = `blkgranter${svc}@example.com`;
const granteeEmail = `blkgrantee${svc}@example.com`;
const granterGamertag = `BlkGranter${svc}`;
const granteeGamertag = `BlkGrantee${svc}`;

let lastLink = "";
const captureMailer: Mailer = { async send(msg) { lastLink = msg.url; } };
const auth = createAuth(db, {
  secret: "s".repeat(32), baseURL: "http://localhost", trustedOrigins: ["http://localhost"],
  providers: {}, mailer: captureMailer,
});
const app = buildApp(db, { auth, corsOrigins: ["http://localhost"], vapidPublicKey: "TEST" });

function cookieHeader(setCookie: string | string[] | undefined): string {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr.map((c) => c.split(";")[0]).join("; ");
}
async function signIn(addr: string): Promise<string> {
  await app.inject({
    method: "POST", url: "/api/auth/sign-in/magic-link",
    headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost" },
    payload: { email: addr },
  });
  const verify = await app.inject({
    method: "GET", url: lastLink.replace(/^https?:\/\/[^/]+/, ""), headers: { host: "localhost" },
  });
  return cookieHeader(verify.headers["set-cookie"] as string | string[] | undefined);
}

let granterCookie = "";
let granterUserId = "";
let granteeUserId = "";
let serverId = 0;
const mapSlug = `sakhal-blk-${svc}`;

beforeAll(async () => {
  await app.ready();
  granterCookie = await signIn(granterEmail);
  await signIn(granteeEmail);

  const [s] = await db.insert(servers)
    .values({ nitradoServiceId: svc, name: "Sakhal", map: "sakhal", slug: mapSlug }).returning();
  serverId = s!.id;

  const [granter] = await db.select({ id: user.id }).from(user)
    .where(eq(user.email, granterEmail.toLowerCase()));
  const [grantee] = await db.select({ id: user.id }).from(user)
    .where(eq(user.email, granteeEmail.toLowerCase()));
  granterUserId = granter!.id;
  granteeUserId = grantee!.id;

  await db.insert(gamertagLinks)
    .values({ userId: granterUserId, gamertag: granterGamertag, status: "verified", verifiedAt: new Date() });
  await db.insert(gamertagLinks)
    .values({ userId: granteeUserId, gamertag: granteeGamertag, status: "verified", verifiedAt: new Date() });

  // The granter must be online (an open session) for grantLocation to succeed at all —
  // otherwise every case in this file would 409 not_online regardless of the block check.
  const now = new Date();
  const [p] = await db.insert(players).values({ gamertag: granterGamertag, lastSeenAt: now }).returning();
  const [life] = await db.insert(lives)
    .values({ serverId, playerId: p!.id, lifeNumber: 1, startedAt: now }).returning();
  await db.insert(sessions).values({
    serverId, playerId: p!.id, lifeId: life!.id, connectedAt: now, disconnectedAt: null,
  });
});

afterAll(async () => {
  await db.delete(locationShares).where(inArray(locationShares.granterUserId, [granterUserId, granteeUserId]));
  await db.delete(userBlocks).where(inArray(userBlocks.blockerUserId, [granterUserId, granteeUserId]));
  await db.delete(sessions).where(eq(sessions.serverId, serverId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(players).where(inArray(players.gamertag, [granterGamertag, granteeGamertag]));
  await db.delete(gamertagLinks).where(inArray(gamertagLinks.gamertag, [granterGamertag, granteeGamertag]));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql`DELETE FROM "session" WHERE user_id IN (SELECT id FROM "user" WHERE email IN (${granterEmail}, ${granteeEmail}))`;
  await sql`DELETE FROM "account" WHERE user_id IN (SELECT id FROM "user" WHERE email IN (${granterEmail}, ${granteeEmail}))`;
  await sql`DELETE FROM "verification" WHERE identifier LIKE ${"%" + svc + "%"}`;
  await sql`DELETE FROM "user" WHERE email IN (${granterEmail}, ${granteeEmail})`;
  await app.close();
  await sql.end();
});

const shareUrl = () => `/me/maps/${mapSlug}/shares`;
const post = (payload: Record<string, unknown>) =>
  app.inject({
    method: "POST", url: shareUrl(), payload,
    headers: { "content-type": "application/json", cookie: granterCookie },
  });

describe("location share grants — blocks sever sharing both ways", () => {
  it("refuses a location share to someone the granter has blocked", async () => {
    await blockUser(db, granterUserId, granteeUserId);
    const res = await post({ gamertag: granteeGamertag });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "blocked" });
    await db.delete(userBlocks).where(eq(userBlocks.blockerUserId, granterUserId));
  });

  // A one-way block severs the connection both ways: being blocked also stops you sharing.
  it("refuses a location share to someone who has blocked the granter", async () => {
    await blockUser(db, granteeUserId, granterUserId);
    const res = await post({ gamertag: granteeGamertag });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "blocked" });
    await db.delete(userBlocks).where(eq(userBlocks.blockerUserId, granteeUserId));
  });

  it("still allows a share between users with no block", async () => {
    const res = await post({ gamertag: granteeGamertag });
    expect(res.statusCode).toBeLessThan(300);
  });
});

/**
 * ⚠️ The grant-time guard above only stops NEW shares. Blocking mid-harassment is worthless if
 * the harasser keeps watching your dot for the rest of the session, so blockUser must revoke
 * what already exists — in BOTH directions, matching isBlockedEitherWay.
 */
describe("blocking severs an EXISTING location share", () => {
  async function existingShare(): Promise<number> {
    await db.delete(userBlocks).where(inArray(userBlocks.blockerUserId, [granterUserId, granteeUserId]));
    await db.delete(locationShares).where(inArray(locationShares.granterUserId, [granterUserId, granteeUserId]));
    const res = await post({ gamertag: granteeGamertag });
    expect(res.statusCode).toBeLessThan(300);
    const rows = await db.select().from(locationShares)
      .where(inArray(locationShares.granterUserId, [granterUserId, granteeUserId]));
    expect(rows).toHaveLength(1);
    return rows.length;
  }

  it("revokes the share when the GRANTER blocks the grantee", async () => {
    await existingShare();
    await blockUser(db, granterUserId, granteeUserId);
    const rows = await db.select().from(locationShares)
      .where(inArray(locationShares.granterUserId, [granterUserId, granteeUserId]));
    expect(rows).toEqual([]);
  });

  it("revokes the share when the GRANTEE blocks the granter", async () => {
    await existingShare();
    await blockUser(db, granteeUserId, granterUserId);
    const rows = await db.select().from(locationShares)
      .where(inArray(locationShares.granterUserId, [granterUserId, granteeUserId]));
    expect(rows).toEqual([]);
  });

  it("leaves an unrelated share alone", async () => {
    await existingShare();
    // A block that involves neither party of this share must not touch it.
    await db.insert(user).values({
      id: `bystander${svc}`, name: "bystander", email: `bystander${svc}@example.test`,
      emailVerified: true, createdAt: new Date(), updatedAt: new Date(),
    });
    await blockUser(db, granterUserId, `bystander${svc}`);
    const rows = await db.select().from(locationShares)
      .where(inArray(locationShares.granterUserId, [granterUserId, granteeUserId]));
    expect(rows).toHaveLength(1);
    await db.delete(userBlocks).where(eq(userBlocks.blockedUserId, `bystander${svc}`));
    await db.delete(user).where(eq(user.id, `bystander${svc}`));
  });
});
