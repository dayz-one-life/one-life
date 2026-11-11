import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, players, lives, kills } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";
import { findEndedUnbannedLives } from "../src/pg-store.js";
import { planBans } from "../src/decide.js";

// ⚠️ BAN EFFECT of the two-second posthumous-kill grace, through the enforcer's real query.
// Invented data. Every life here is under five minutes and ended in a non-player death, so a kill
// is the only thing that can get it banned.
//
//   KG Bomber  life 1  10:00:00 - 10:03:00   kill logged 10:03:01  -> banned "by kill" (new)
//              life 2  10:03:01 - 10:04:00   no kill of its own     -> not banned
//   KG Late    life 1  10:00:00 - 10:03:00   kill logged 10:03:03  -> not banned
//   KG Instant life 1  10:00:03 - 10:00:03   kill logged 10:00:05  -> banned "by kill"
//              life 2  10:00:03 - 10:00:07   same start as life 1  -> not banned
//
// This file only reads; it writes no ban rows, and removes its own rows so the counts tick.test.ts
// asserts are untouched.
const { db, sql } = getTestDb();
const T = (hms: string) => new Date(`2026-07-11T${hms}Z`);
let serverId: number;
const playerIds: number[] = [];

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: 555077, name: "enf-kill-grace" }).returning();
  serverId = s!.id;
  const [bomber] = await db.insert(players).values({ gamertag: "KG Bomber" }).returning();
  const [late] = await db.insert(players).values({ gamertag: "KG Late" }).returning();
  const [instant] = await db.insert(players).values({ gamertag: "KG Instant" }).returning();
  playerIds.push(Number(bomber!.id), Number(late!.id), Number(instant!.id));
  await db.insert(lives).values([
    { serverId, playerId: bomber!.id, lifeNumber: 1, startedAt: T("10:00:00"), endedAt: T("10:03:00"), deathCause: "explosion", playtimeSeconds: 180 },
    { serverId, playerId: bomber!.id, lifeNumber: 2, startedAt: T("10:03:01"), endedAt: T("10:04:00"), deathCause: "infected", playtimeSeconds: 59 },
    { serverId, playerId: late!.id, lifeNumber: 1, startedAt: T("10:00:00"), endedAt: T("10:03:00"), deathCause: "explosion", playtimeSeconds: 180 },
    { serverId, playerId: instant!.id, lifeNumber: 1, startedAt: T("10:00:03"), endedAt: T("10:00:03"), deathCause: "explosion", playtimeSeconds: 0 },
    { serverId, playerId: instant!.id, lifeNumber: 2, startedAt: T("10:00:03"), endedAt: T("10:00:07"), deathCause: "infected", playtimeSeconds: 4 },
  ]);
  await db.insert(kills).values([
    { serverId, killerGamertag: "KG Bomber", killerPlayerId: bomber!.id, victimGamertag: "one", occurredAt: T("10:03:01") },
    { serverId, killerGamertag: "KG Late", killerPlayerId: late!.id, victimGamertag: "two", occurredAt: T("10:03:03") },
    { serverId, killerGamertag: "KG Instant", killerPlayerId: instant!.id, victimGamertag: "three", occurredAt: T("10:00:05") },
  ]);
});
afterAll(async () => {
  await db.delete(kills).where(eq(kills.serverId, serverId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(players).where(inArray(players.id, playerIds));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("findEndedUnbannedLives + planBans — a kill logged just after the killer's own death", () => {
  it("bans only the life that ended a second or two before the kill line", async () => {
    const mine = (await findEndedUnbannedLives(db)).filter((l) => l.serverId === serverId);
    expect(mine.filter((l) => l.gamertag !== "KG Instant")).toHaveLength(3);

    const bomber1 = mine.find((l) => l.gamertag === "KG Bomber" && l.startedAt.getTime() === T("10:00:00").getTime())!;
    const bomber2 = mine.find((l) => l.gamertag === "KG Bomber" && l.startedAt.getTime() === T("10:03:01").getTime())!;
    const late1 = mine.find((l) => l.gamertag === "KG Late")!;
    expect(bomber1.playerKills).toEqual([{ occurredAt: T("10:03:01") }]);
    expect(bomber1.previousLifeEndedAt).toBeNull();
    expect(bomber2.playerKills).toEqual([]);                 // the kill is the previous life's
    expect(bomber2.previousLifeEndedAt).toEqual(T("10:03:00"));
    expect(late1.playerKills).toEqual([]);                   // three seconds: outside the grace

    const plans = planBans(mine.filter((l) => l.gamertag !== "KG Instant"), 24, T("10:10:00"));
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      gamertag: "KG Bomber", qualifiedBy: "kill", lifeStartedAt: T("10:00:00"), bannedAt: T("10:03:00"),
    });
  });

  // Connect, death and reconnect in one logged second: the kill in the zero-length life's two
  // seconds must draw one ban, not one for each of the two lives that share the start.
  it("bans one life, not both, when two lives share a start", async () => {
    const mine = (await findEndedUnbannedLives(db)).filter((l) => l.serverId === serverId && l.gamertag === "KG Instant");
    expect(mine).toHaveLength(2);
    const first = mine.find((l) => l.endedAt.getTime() === T("10:00:03").getTime())!;
    const second = mine.find((l) => l.endedAt.getTime() === T("10:00:07").getTime())!;
    expect(first.playerKills).toEqual([{ occurredAt: T("10:00:05") }]);
    expect(first.previousLifeEndedAt).toBeNull();
    expect(second.playerKills).toEqual([]);
    expect(second.previousLifeEndedAt).toEqual(T("10:00:03"));
    const plans = planBans(mine, 24, T("10:10:00"));
    expect(plans.map((p) => p.bannedAt)).toEqual([T("10:00:03")]);
    expect(plans[0]!.qualifiedBy).toBe("kill");
  });
});
