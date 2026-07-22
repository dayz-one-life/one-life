import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  user, gamertagLinks, servers, players, lives, sessions, positions,
  friendships, userPreferences,
} from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { eq } from "drizzle-orm";
import { getFriendPositions } from "../src/friend-positions.js";

const { db, sql } = getTestDb();
const NOW = new Date("2026-07-22T12:00:00Z");

let serverId = 0;

/** Viewer "va" and friend "vb" (va < vb, so va is side A). */
async function seed(o: {
  masterShare?: boolean; pairShare?: boolean; status?: string;
  online?: boolean; positionAt?: Date; friendVerified?: boolean;
} = {}) {
  await sql`truncate table user_preferences, friendships, positions, sessions, lives, players, servers, gamertag_links, "user" restart identity cascade`;
  await db.insert(user).values([
    { id: "va", name: "VA", email: "va@x.com" },
    { id: "vb", name: "VB", email: "vb@x.com" },
  ]);
  await db.insert(gamertagLinks).values([
    { userId: "va", gamertag: "ViewerAlpha", status: "verified", verifiedAt: NOW },
    { userId: "vb", gamertag: "FriendBravo", status: o.friendVerified === false ? "pending" : "verified",
      verifiedAt: o.friendVerified === false ? null : NOW },
  ]);
  const [srv] = await db.insert(servers)
    .values({ nitradoServiceId: 995001, name: "Sakhal", map: "sakhal", slug: "fp-sakhal" })
    .returning();
  serverId = srv!.id;

  for (const [gamertag, uid] of [["ViewerAlpha", "va"], ["FriendBravo", "vb"]] as const) {
    const [p] = await db.insert(players).values({ gamertag, lastSeenAt: NOW }).returning();
    const [life] = await db.insert(lives)
      .values({ serverId: srv!.id, playerId: p!.id, lifeNumber: 1, startedAt: new Date("2026-07-22T10:00:00Z") })
      .returning();
    const isFriend = uid === "vb";
    const open = isFriend ? (o.online ?? true) : true;
    await db.insert(sessions).values({
      serverId: srv!.id, playerId: p!.id, lifeId: life!.id,
      connectedAt: new Date("2026-07-22T11:00:00Z"),
      disconnectedAt: open ? null : new Date("2026-07-22T11:50:00Z"),
    });
    await db.insert(positions).values({
      serverId: srv!.id, playerId: p!.id, gamertag,
      x: isFriend ? 2000 : 1000, y: isFriend ? 2500 : 1500,
      recordedAt: isFriend ? (o.positionAt ?? new Date("2026-07-22T11:58:00Z")) : new Date("2026-07-22T11:58:00Z"),
    });
  }

  await db.insert(friendships).values({
    userA: "va", userB: "vb", status: o.status ?? "accepted", requestedBy: "va",
    bSharesLocation: o.pairShare ?? true,
  });
  await db.insert(userPreferences).values({ userId: "vb", shareLocation: o.masterShare ?? true });
}

const call = () => getFriendPositions(db, { viewerUserId: "va", serverId, now: NOW });

beforeEach(() => seed());
afterAll(async () => { await sql.end(); });

describe("getFriendPositions", () => {
  it("returns the viewer's own dot and a sharing friend's", async () => {
    const out = await call();
    expect(out.map((p) => p.gamertag).sort()).toEqual(["FriendBravo", "ViewerAlpha"]);
    expect(out.find((p) => p.gamertag === "ViewerAlpha")!.self).toBe(true);
    expect(out.find((p) => p.gamertag === "FriendBravo")!.self).toBe(false);
    expect(out.find((p) => p.gamertag === "FriendBravo")!.x).toBe(2000);
  });

  it("omits a friend whose master switch is off", async () => {
    await seed({ masterShare: false });
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  it("omits a friend who has hidden from the viewer specifically", async () => {
    await seed({ pairShare: false });
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  it("omits a non-accepted pair", async () => {
    await seed({ status: "pending" });
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  it("omits an offline friend", async () => {
    await seed({ online: false });
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  it("omits a friend whose last position is older than the staleness cap", async () => {
    await seed({ positionAt: new Date("2026-07-22T11:40:00Z") }); // 20 min old
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  // ⚠️ F1's deferred prerequisite. A released verified link leaves the friendship row and its
  // sharing flags intact; without the inner join on a VERIFIED link, coordinates keep flowing.
  it("omits a friend whose verified gamertag link was released, despite live flags", async () => {
    await seed({ friendVerified: false });
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  it("returns the viewer's own dot regardless of their own sharing flags", async () => {
    await db.insert(userPreferences).values({ userId: "va", shareLocation: false })
      .onConflictDoUpdate({ target: userPreferences.userId, set: { shareLocation: false } });
    await db.update(friendships).set({ aSharesLocation: false }).where(eq(friendships.userA, "va"));
    expect((await call()).map((p) => p.gamertag)).toContain("ViewerAlpha");
  });
});
