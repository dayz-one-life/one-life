import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, players, lives, kills } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";
import { getPlayerProfile, getPlayerLives } from "../src/queries.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 4e8;
const now = new Date("2026-07-12T00:00:00Z");
const start = new Date("2026-07-11T00:00:00Z");
let sid: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "Q", map: "chernarusplus" }).returning();
  sid = s!.id;
  const [p] = await db.insert(players).values({ gamertag: "Qualia", firstSeenAt: start, lastSeenAt: now }).returning();
  const pid = Number(p!.id);
  await db.insert(lives).values([
    { serverId: sid, playerId: pid, lifeNumber: 1, startedAt: start, endedAt: new Date(start.getTime() + 9000e3), deathCause: "bled out", playtimeSeconds: 9000 },
    { serverId: sid, playerId: pid, lifeNumber: 2, startedAt: start, endedAt: new Date(start.getTime() + 60e3), deathCause: "suicide", playtimeSeconds: 60 },
    { serverId: sid, playerId: pid, lifeNumber: 3, startedAt: start, endedAt: new Date(start.getTime() + 90e3), deathCause: "pvp", deathByGamertag: "Sniper", playtimeSeconds: 90 },
  ]);

  // Killer-side qualification: a life that's short + non-PvP, so it qualifies only because the
  // player scored a kill during it (isLifeQualified's kill branch, driven through the DB path).
  const [kp] = await db.insert(players).values({ gamertag: "Killaqual", firstSeenAt: start, lastSeenAt: now }).returning();
  const kpid = Number(kp!.id);
  const killLifeStart = start;
  const killLifeEnd = new Date(start.getTime() + 120e3);
  await db.insert(lives).values({
    serverId: sid, playerId: kpid, lifeNumber: 1, startedAt: killLifeStart, endedAt: killLifeEnd,
    deathCause: "bled out", playtimeSeconds: 120,
  });
  await db.insert(kills).values({
    serverId: sid, killerGamertag: "Killaqual", killerPlayerId: kpid, victimGamertag: "SomeoneElse",
    occurredAt: new Date(killLifeStart.getTime() + 30e3), // inside [startedAt, endedAt]
  });
});
afterAll(async () => {
  await db.delete(kills).where(eq(kills.serverId, sid));
  await db.delete(lives).where(eq(lives.serverId, sid));
  await db.delete(players).where(inArray(players.gamertag, ["Qualia", "Killaqual"]));
  await db.delete(servers).where(eq(servers.id, sid));
  await sql.end();
});

describe("qualified filtering in queries", () => {
  it("profile counts only qualified lives (excludes the suicide-reroll)", async () => {
    const prof = (await getPlayerProfile(db, sid, "Qualia", now))!;
    expect(prof.lives).toBe(2);   // 9000s + pvp; the 60s suicide is discarded
    expect(prof.deaths).toBe(2);
  });
  it("getPlayerLives returns only qualified lives", async () => {
    const ls = (await getPlayerLives(db, sid, "Qualia"))!;
    expect(ls.map((l) => l.lifeNumber).sort()).toEqual([1, 3]);
  });
  it("getPlayerLives includes a short non-PvP life qualified only via a scored kill", async () => {
    const ls = (await getPlayerLives(db, sid, "Killaqual"))!;
    expect(ls.map((l) => l.lifeNumber)).toEqual([1]);
  });
});
