import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, servers, gamertagLinks, bans, players, playerGamertags } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";
import { grant } from "../src/grant.js";
import { redeem } from "../src/redeem.js";
import { getBalance } from "../src/balance.js";
import { TokenError } from "../src/internal.js";

const { db, sql } = getTestDb();
let serverId: number;
let serverId2: number;
const LIFE1 = new Date("2026-07-11T10:00:00Z");
const LIFE2 = new Date("2026-07-12T10:00:00Z");
const LIFE2B = new Date("2026-07-12T14:00:00Z");
const LIFE3 = new Date("2026-07-13T10:00:00Z");

beforeAll(async () => {
  await db.insert(user).values({ id: "rd1", name: "RD1", email: "rd1@x.com" });
  const [s] = await db.insert(servers).values({ nitradoServiceId: 772001, name: "rd" }).returning();
  serverId = s!.id;
  const [s2] = await db.insert(servers).values({ nitradoServiceId: 772002, name: "rd2" }).returning();
  serverId2 = s2!.id;
  // Global-player model: verified gamertag links carry no serverId — owning a gamertag
  // means owning it everywhere, not on one server.
  await db.insert(gamertagLinks).values({ userId: "rd1", gamertag: "RG1", status: "verified" });
  // Ownership now compares IDENTITY, not name strings — "RG1" needs a players row to resolve to.
  await db.insert(players).values({ gamertag: "RG1" });
});
afterAll(async () => { await sql.end(); });

describe("redeem", () => {
  it("throws insufficient_tokens: active ban but no token", async () => {
    await db.insert(bans).values({ serverId, gamertag: "RG1", lifeStartedAt: LIFE1, reason: "qualified_death", bannedAt: LIFE1, status: "applied", dryRun: false });
    await expect(redeem(db, { userId: "rd1" })).rejects.toThrow(TokenError);
    expect(await getBalance(db, "rd1")).toBe(0);
  });

  it("spends a token and sets an APPLIED ban to lift_pending", async () => {
    await grant(db, { userId: "rd1", kind: "verification", idempotencyKey: "verify:rd1" });
    const r = await redeem(db, { userId: "rd1" });
    expect(r.gamertag).toBe("RG1");
    expect(await getBalance(db, "rd1")).toBe(0);
    const [b] = await db.select().from(bans).where(eq(bans.id, r.banId));
    expect(b!.status).toBe("lift_pending");
  });

  it("throws no_active_ban when nothing is liftable", async () => {
    await expect(redeem(db, { userId: "rd1" })).rejects.toThrow(/no_active_ban/);
  });

  it("does NOT redeem a dry-run ban — throws no_active_ban and spends no token (phantom ban)", async () => {
    await db.insert(bans).values({ serverId, gamertag: "RG1", lifeStartedAt: LIFE2, reason: "qualified_death", bannedAt: LIFE2, status: "pending", dryRun: true });
    await grant(db, { userId: "rd1", kind: "monthly", idempotencyKey: "monthly:rd1" });
    const before = await getBalance(db, "rd1");
    expect(before).toBe(1);
    await expect(redeem(db, { userId: "rd1" })).rejects.toThrow(/no_active_ban/);
    // The token must NOT have been spent on a ban that was never actually placed.
    expect(await getBalance(db, "rd1")).toBe(before);
  });

  it("positive control: still lifts a real (dry_run=false) PENDING ban straight to lifted", async () => {
    await db.insert(bans).values({ serverId, gamertag: "RG1", lifeStartedAt: LIFE2B, reason: "qualified_death", bannedAt: LIFE2B, status: "pending", dryRun: false });
    const before = await getBalance(db, "rd1");
    const r = await redeem(db, { userId: "rd1" });
    const [b] = await db.select().from(bans).where(eq(bans.id, r.banId));
    expect(b!.status).toBe("lifted");
    expect(await getBalance(db, "rd1")).toBe(before - 1);
  });

  it("owns a ban on a DIFFERENT server than any prior activity — gamertag ownership is global, not per-server", async () => {
    // rd1's verified link for "RG1" has no server association at all. A ban for "RG1"
    // shows up on serverId2 (a server rd1 has never touched via a link row), and redeem
    // must still recognize rd1 as the owner purely by gamertag match.
    const [ban] = await db
      .insert(bans)
      .values({ serverId: serverId2, gamertag: "RG1", lifeStartedAt: LIFE3, reason: "qualified_death", bannedAt: LIFE3, status: "applied", dryRun: false })
      .returning();
    await grant(db, { userId: "rd1", kind: "referral", idempotencyKey: "referral:rd1" });
    const r = await redeem(db, { userId: "rd1", banId: ban!.id });
    expect(r.banId).toBe(ban!.id);
    expect(r.gamertag).toBe("RG1");
    const [b] = await db.select().from(bans).where(eq(bans.id, ban!.id));
    expect(b!.status).toBe("lift_pending");
  });

  it("throws not_owner when the caller has no verified link for the ban's gamertag", async () => {
    await db.insert(user).values({ id: "rd2", name: "RD2", email: "rd2@x.com" });
    await db.insert(gamertagLinks).values({ userId: "rd2", gamertag: "OtherGT", status: "verified" });
    await grant(db, { userId: "rd2", kind: "verification", idempotencyKey: "verify:rd2" });
    const [ban] = await db
      .insert(bans)
      .values({ serverId, gamertag: "RG1", lifeStartedAt: LIFE3, reason: "qualified_death", bannedAt: LIFE3, status: "applied", dryRun: false })
      .returning();
    await expect(redeem(db, { userId: "rd2", banId: ban!.id })).rejects.toThrow(/not_owner/);
  });

  it("lets a RENAMED verified player redeem against a ban under their new name", async () => {
    // The link still names the callsign they claimed; the ban names who they are now.
    // Matching those as raw strings silently denies them their own unban.
    await db.insert(user).values({ id: "rn1", name: "RN1", email: "rn1@x.com" });
    const [pl] = await db.insert(players).values({ gamertag: "CurrentName" }).returning();
    const playerId = pl!.id;
    await db.insert(playerGamertags).values([
      { playerId, gamertag: "FormerName", firstSeenAt: new Date("2026-06-01T00:00:00Z"), lastSeenAt: new Date("2026-06-02T00:00:00Z") },
      { playerId, gamertag: "CurrentName", firstSeenAt: new Date("2026-07-01T00:00:00Z"), lastSeenAt: new Date("2026-07-02T00:00:00Z") },
    ]);
    // The verified link still names the OLD callsign the user claimed and emote-verified.
    await db.insert(gamertagLinks).values({ userId: "rn1", gamertag: "FormerName", status: "verified" });
    await grant(db, { userId: "rn1", kind: "verification", idempotencyKey: "verify:rn1" });
    // The ban was written under who they are NOW.
    await db.insert(bans).values({ serverId, gamertag: "CurrentName", lifeStartedAt: LIFE3, reason: "qualified_death", bannedAt: LIFE3, status: "applied", dryRun: false });

    const r = await redeem(db, { userId: "rn1" });
    expect(r.gamertag).toBe("CurrentName");
  });
});
