import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  user, gamertagLinks, servers, players, lives, sessions, friendships,
} from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { getOnlinePlayers, ONLINE_MAX_AGE_SECONDS } from "../src/online-players.js";
import type { FriendPosition } from "../src/friend-positions.js";

const { db, sql } = getTestDb();
const NOW = new Date("2026-07-22T12:00:00Z");

let serverId = 0;

/**
 * Viewer "va" (gamertag ViewerAlpha) plus three other players:
 * - "vb" (FriendBravo): an accepted friend, online by default.
 * - a plain unlinked player "OtherCharlie": online, not a friend.
 * - a plain unlinked player "OtherDelta": online, not a friend.
 *
 * Each of the four gets its own player/life/session row so per-player online-ness
 * (session open/closed, last_seen_at) can be tuned independently by the options.
 */
async function seed(o: {
  friendOnline?: boolean;
  friendLastSeenAt?: Date;
  friendDisconnectedAt?: Date | null;
} = {}) {
  await sql`truncate table friendships, sessions, lives, players, servers, gamertag_links, "user" restart identity cascade`;

  await db.insert(user).values([
    { id: "va", name: "VA", email: "va@x.com" },
    { id: "vb", name: "VB", email: "vb@x.com" },
  ]);
  await db.insert(gamertagLinks).values([
    { userId: "va", gamertag: "ViewerAlpha", status: "verified", verifiedAt: NOW },
    { userId: "vb", gamertag: "FriendBravo", status: "verified", verifiedAt: NOW },
  ]);

  const [srv] = await db.insert(servers)
    .values({ nitradoServiceId: 996001, name: "Sakhal", map: "sakhal", slug: "op-sakhal" })
    .returning();
  serverId = srv!.id;

  const friendOnline = o.friendOnline ?? true;
  const rows: {
    gamertag: string;
    lastSeenAt: Date;
    disconnectedAt: Date | null;
  }[] = [
    { gamertag: "ViewerAlpha", lastSeenAt: NOW, disconnectedAt: null },
    {
      gamertag: "FriendBravo",
      lastSeenAt: o.friendLastSeenAt ?? NOW,
      disconnectedAt: o.friendDisconnectedAt !== undefined
        ? o.friendDisconnectedAt
        : (friendOnline ? null : new Date("2026-07-22T11:50:00Z")),
    },
    { gamertag: "OtherCharlie", lastSeenAt: NOW, disconnectedAt: null },
    { gamertag: "OtherDelta", lastSeenAt: NOW, disconnectedAt: null },
  ];

  for (const r of rows) {
    const [p] = await db.insert(players).values({ gamertag: r.gamertag, lastSeenAt: r.lastSeenAt }).returning();
    const [life] = await db.insert(lives)
      .values({ serverId: srv!.id, playerId: p!.id, lifeNumber: 1, startedAt: new Date("2026-07-22T10:00:00Z") })
      .returning();
    await db.insert(sessions).values({
      serverId: srv!.id, playerId: p!.id, lifeId: life!.id,
      connectedAt: new Date("2026-07-22T11:00:00Z"),
      disconnectedAt: r.disconnectedAt,
    });
  }

  await db.insert(friendships).values({
    userA: "va", userB: "vb", status: "accepted", requestedBy: "va",
  });
}

const call = (positions: FriendPosition[] = []) =>
  getOnlinePlayers(db, { viewerUserId: "va", serverId, now: NOW, positions });

beforeEach(() => seed());
afterAll(async () => { await sql.end(); });

describe("getOnlinePlayers", () => {
  it("lists a player with an open session seen just now", async () => {
    const out = await call();
    const other = out.find((p) => p.gamertag === "OtherCharlie");
    expect(other).toBeDefined();
    expect(other!.self).toBe(false);
    expect(other!.friend).toBe(false);
    expect(other!.sharing).toBe(false);
  });

  it("EXCLUDES an open session whose player has not been seen for 15 minutes", async () => {
    await seed({ friendLastSeenAt: new Date(NOW.getTime() - (ONLINE_MAX_AGE_SECONDS + 60) * 1000) });
    const out = await call();
    expect(out.map((p) => p.gamertag)).not.toContain("FriendBravo");
  });

  it("excludes a closed session even when last_seen_at is recent", async () => {
    await seed({ friendDisconnectedAt: new Date("2026-07-22T11:59:00Z"), friendLastSeenAt: NOW });
    const out = await call();
    expect(out.map((p) => p.gamertag)).not.toContain("FriendBravo");
  });

  it("orders self, then friends sharing, then friends, then sharers, then the rest", async () => {
    // FriendBravo is a friend and shares; OtherCharlie merely shares; OtherDelta is neither.
    const out = await call([
      { gamertag: "FriendBravo", x: 1, y: 1, recordedAt: NOW, self: false },
      { gamertag: "OtherCharlie", x: 2, y: 2, recordedAt: NOW, self: false },
    ]);
    expect(out.map((p) => p.gamertag)).toEqual([
      "ViewerAlpha", "FriendBravo", "OtherCharlie", "OtherDelta",
    ]);
  });

  it("marks `sharing` from the positions passed in, not from a fresh consent lookup", async () => {
    const out = await call([
      { gamertag: "OtherDelta", x: 1, y: 1, recordedAt: NOW, self: false },
    ]);
    expect(out.find((p) => p.gamertag === "OtherDelta")!.sharing).toBe(true);
    expect(out.find((p) => p.gamertag === "FriendBravo")!.sharing).toBe(false);
    expect(out.find((p) => p.gamertag === "OtherCharlie")!.sharing).toBe(false);
    expect(out.find((p) => p.gamertag === "ViewerAlpha")!.sharing).toBe(false);
  });

  it("marks the viewer's own row `self`", async () => {
    const out = await call();
    const mine = out.find((p) => p.gamertag === "ViewerAlpha");
    expect(mine).toBeDefined();
    expect(mine!.self).toBe(true);
    for (const p of out) {
      if (p.gamertag !== "ViewerAlpha") expect(p.self).toBe(false);
    }
  });
});
