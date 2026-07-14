import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, players, lives, sessions } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";
import { getLeaderboard } from "../src/leaderboards.js";
import { getRoster } from "../src/queries.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 55e7; // disjoint from qualified-queries.test.ts's +4e8 range
const now = new Date("2026-07-12T00:00:00Z");
const start = new Date("2026-07-11T00:00:00Z");
let sid: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "QB", map: "chernarusplus" }).returning();
  sid = s!.id;
  // A: provisional (open, connected 2 min before `now`, last_seen == now, no kills/PvP)
  const twoMinAgo = new Date(now.getTime() - 120e3);
  const [a] = await db.insert(players).values({ serverId: sid, gamertag: "Provi", firstSeenAt: start, lastSeenAt: now }).returning();
  const [al] = await db.insert(lives).values({ serverId: sid, playerId: Number(a!.id), lifeNumber: 1, startedAt: twoMinAgo, playtimeSeconds: 0 }).returning();
  await db.insert(sessions).values({ serverId: sid, playerId: Number(a!.id), lifeId: Number(al!.id), connectedAt: twoMinAgo });
  // B: qualified 2h ended life
  const [b] = await db.insert(players).values({ serverId: sid, gamertag: "Vet", firstSeenAt: start, lastSeenAt: now }).returning();
  await db.insert(lives).values({ serverId: sid, playerId: Number(b!.id), lifeNumber: 1, startedAt: start, endedAt: new Date(start.getTime() + 7200e3), deathCause: "bled out", playtimeSeconds: 7200 });
  // C: only a 60s suicide (discarded)
  const [c] = await db.insert(players).values({ serverId: sid, gamertag: "Rerollr", firstSeenAt: start, lastSeenAt: now }).returning();
  await db.insert(lives).values({ serverId: sid, playerId: Number(c!.id), lifeNumber: 1, startedAt: start, endedAt: new Date(start.getTime() + 60e3), deathCause: "suicide", playtimeSeconds: 60 });
});
afterAll(async () => {
  await db.delete(sessions).where(eq(sessions.serverId, sid));
  await db.delete(lives).where(eq(lives.serverId, sid));
  await db.delete(players).where(eq(players.serverId, sid));
  await db.delete(servers).where(eq(servers.id, sid));
  await sql.end();
});

describe("qualified filtering on duration boards", () => {
  it("alive-longest excludes a provisional life but the roster still shows the player", async () => {
    const board = await getLeaderboard(db, sid, "alive-longest", now, 50);
    expect(board.map((r) => r.gamertag)).not.toContain("Provi");
    const roster = await getRoster(db, sid, now);
    expect(roster.map((r) => r.gamertag)).toContain("Provi"); // presence unaffected
  });
  it("alltime-longest excludes a sub-5-min suicide-only player", async () => {
    const board = await getLeaderboard(db, sid, "alltime-longest", now, 50);
    expect(board.map((r) => r.gamertag)).toContain("Vet");
    expect(board.map((r) => r.gamertag)).not.toContain("Rerollr");
  });
});
