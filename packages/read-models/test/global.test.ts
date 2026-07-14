import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, players, lives, sessions, kills } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getGlobalRoster, getGlobalBoard } from "../src/index.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svcChern = Math.floor(Math.random() * 1e8) + 16e7;
const svcSakh = Math.floor(Math.random() * 1e8) + 17e7;
let chernId: number;
let sakhId: number;

beforeAll(async () => {
  const [c] = await db.insert(servers).values({ nitradoServiceId: svcChern, name: "Global-Chernarus", map: "chernarusplus", slug: "g-chern", active: true }).returning();
  const [s] = await db.insert(servers).values({ nitradoServiceId: svcSakh, name: "Global-Sakhal", map: "sakhal", slug: "g-sakh", active: true }).returning();
  chernId = c!.id;
  sakhId = s!.id;

  // Roster: one online player per map.
  const [roamer] = await db.insert(players).values({ serverId: chernId, gamertag: "Roamer", firstSeenAt: new Date("2026-07-06T12:00:00Z"), lastSeenAt: new Date("2026-07-06T12:00:00Z") }).returning();
  const [roamerLife] = await db.insert(lives).values({ serverId: chernId, playerId: roamer!.id, lifeNumber: 1, startedAt: new Date("2026-07-06T12:00:00Z"), playtimeSeconds: 300 }).returning();
  await db.insert(sessions).values({ serverId: chernId, playerId: roamer!.id, lifeId: roamerLife!.id, connectedAt: new Date("2026-07-06T12:00:00Z") });

  const [wanderer] = await db.insert(players).values({ serverId: sakhId, gamertag: "Wanderer", firstSeenAt: new Date("2026-07-06T12:00:00Z"), lastSeenAt: new Date("2026-07-06T12:00:00Z") }).returning();
  const [wandererLife] = await db.insert(lives).values({ serverId: sakhId, playerId: wanderer!.id, lifeNumber: 1, startedAt: new Date("2026-07-06T12:00:00Z"), playtimeSeconds: 300 }).returning();
  await db.insert(sessions).values({ serverId: sakhId, playerId: wanderer!.id, lifeId: wandererLife!.id, connectedAt: new Date("2026-07-06T12:00:00Z") });

  // most-kills board: BigKiller on Sakhal has more kills than SmallKiller on Chernarus.
  const [bigKiller] = await db.insert(players).values({ serverId: sakhId, gamertag: "BigKiller", firstSeenAt: new Date(), lastSeenAt: new Date() }).returning();
  const [smallKiller] = await db.insert(players).values({ serverId: chernId, gamertag: "SmallKiller", firstSeenAt: new Date(), lastSeenAt: new Date() }).returning();
  for (let i = 0; i < 3; i++) {
    await db.insert(kills).values({
      serverId: sakhId, killerGamertag: "BigKiller", killerPlayerId: bigKiller!.id,
      victimGamertag: `Victim${i}`, weapon: "M4A1", occurredAt: new Date(`2026-07-06T12:0${i}:00Z`),
    });
  }
  await db.insert(kills).values({
    serverId: chernId, killerGamertag: "SmallKiller", killerPlayerId: smallKiller!.id,
    victimGamertag: "Victim9", weapon: "M4A1", occurredAt: new Date("2026-07-06T12:00:00Z"),
  });
});

afterAll(async () => {
  await db.delete(kills).where(eq(kills.serverId, chernId));
  await db.delete(kills).where(eq(kills.serverId, sakhId));
  await db.delete(sessions).where(eq(sessions.serverId, chernId));
  await db.delete(sessions).where(eq(sessions.serverId, sakhId));
  await db.delete(lives).where(eq(lives.serverId, chernId));
  await db.delete(lives).where(eq(lives.serverId, sakhId));
  await db.delete(players).where(eq(players.serverId, chernId));
  await db.delete(players).where(eq(players.serverId, sakhId));
  await sql.end();
});

describe("getGlobalRoster", () => {
  it("merges online players from both maps, tagged with their map + slug", async () => {
    const now = new Date("2026-07-06T12:05:00Z");
    const roster = await getGlobalRoster(db, now);
    const roamer = roster.find((r) => r.gamertag === "Roamer");
    const wanderer = roster.find((r) => r.gamertag === "Wanderer");
    expect(roamer).toMatchObject({ map: "chernarusplus", slug: "g-chern" });
    expect(wanderer).toMatchObject({ map: "sakhal", slug: "g-sakh" });
    expect(roster.map((r) => r.slug)).toEqual(expect.arrayContaining(["g-chern", "g-sakh"]));
  });
});

describe("getGlobalBoard", () => {
  it("merges most-kills across servers and sorts by value desc, tagging the winner's map", async () => {
    const now = new Date("2026-07-06T13:00:00Z");
    const board = await getGlobalBoard(db, "most-kills", now, 10);
    expect(board[0]).toMatchObject({ gamertag: "BigKiller", value: 3, map: "sakhal", slug: "g-sakh" });
    const smallEntry = board.find((r) => r.gamertag === "SmallKiller");
    expect(smallEntry).toMatchObject({ value: 1, map: "chernarusplus", slug: "g-chern" });
  });
});
