import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getPlayerAcrossServers } from "../src/player-aggregate.js";

const { db } = getTestDb();

describe("getPlayerAcrossServers", () => {
  beforeAll(async () => {
    const [c] = await db.insert(servers).values({ nitradoServiceId: 201, name: "Chernarus", map: "chernarusplus", slug: "chernarus" }).returning();
    const [s] = await db.insert(servers).values({ nitradoServiceId: 202, name: "Sakhal", map: "sakhal", slug: "sakhal" }).returning();
    const [pc] = await db.insert(players).values({ serverId: c!.id, gamertag: "Steveo12491" }).returning();
    const [ps] = await db.insert(players).values({ serverId: s!.id, gamertag: "Steveo12491" }).returning();
    await db.insert(lives).values({ serverId: c!.id, playerId: pc!.id, lifeNumber: 1, startedAt: new Date("2026-07-09T00:00:00Z"), playtimeSeconds: 28800 });
    await db.insert(lives).values({ serverId: s!.id, playerId: ps!.id, lifeNumber: 1, startedAt: new Date("2026-07-11T18:00:00Z"), playtimeSeconds: 3600 });
  });
  it("resolves a gamertag by its lowercase slug across both servers", async () => {
    const agg = await getPlayerAcrossServers(db, "steveo12491", new Date("2026-07-11T20:00:00Z"));
    expect(agg?.gamertag).toBe("Steveo12491");           // real stored casing, not the slug
    expect(agg?.perMap.map((m) => m.slug).sort()).toEqual(["chernarus", "sakhal"]);
    expect(agg?.totals.longestLifeSeconds).toBe(28800);
  });
  it("returns null for an unknown gamertag", async () => {
    expect(await getPlayerAcrossServers(db, "nobody", new Date())).toBeNull();
  });
});

describe("getPlayerAcrossServers — longestLifeSeconds uses QUALIFIED lives", () => {
  const svc = Math.floor(Math.random() * 1e8) + 9e8; // unique nitrado service id, disjoint from other read-models test files
  let sid: number;

  beforeAll(async () => {
    const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "QLife", map: "chernarusplus", slug: "qlife-chernarus" }).returning();
    sid = s!.id;
    const [p] = await db.insert(players).values({ serverId: sid, gamertag: "Rerollqualtest" }).returning();
    const pid = Number(p!.id);
    await db.insert(lives).values([
      // Longest life by raw duration, but a discarded non-PvP, sub-5-min-free... actually 200s
      // non-PvP suicide with no kills — a discarded reroll despite being the longer of the two.
      { serverId: sid, playerId: pid, lifeNumber: 1, startedAt: new Date("2026-07-10T00:00:00Z"), endedAt: new Date("2026-07-10T00:03:20Z"), deathCause: "suicide", playtimeSeconds: 200 },
      // Shorter life, but qualified via a PvP death.
      { serverId: sid, playerId: pid, lifeNumber: 2, startedAt: new Date("2026-07-10T01:00:00Z"), endedAt: new Date("2026-07-10T01:01:40Z"), deathCause: "pvp", playtimeSeconds: 100 },
    ]);
  });

  afterAll(async () => {
    await db.delete(lives).where(eq(lives.serverId, sid));
    await db.delete(players).where(eq(players.serverId, sid));
    await db.delete(servers).where(eq(servers.id, sid));
  });

  it("reports the qualified (100s pvp) life, not the discarded 200s reroll", async () => {
    const agg = await getPlayerAcrossServers(db, "Rerollqualtest", new Date("2026-07-10T02:00:00Z"));
    expect(agg?.totals.longestLifeSeconds).toBe(100);
    expect(agg?.perMap[0]?.longestLifeSeconds).toBe(100);
  });
});
