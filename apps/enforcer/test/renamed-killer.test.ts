import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, players, lives, kills } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";
import { findEndedUnbannedLives } from "../src/pg-store.js";
import { planBans } from "../src/decide.js";

// ⚠️ BAN EFFECT of matching a kill to its killer by player id, through the enforcer's real query.
// Invented data. Every life is 10:00:00 - 10:03:00, under five minutes, ended by a non-player
// death, so a kill is the only thing that can get it banned.
//
//   RK Newname  (was "RK Oldname")  kill logged under the old name, his id   -> banned "by kill"
//   RK Oldname  (took the name)     no kill of his own                        -> not banned
//   RK Ghost                        a row with NO id, his name in other case  -> banned "by kill"
//
// This file only reads; it writes no ban rows, and removes its own rows so the counts tick.test.ts
// asserts are untouched.
const { db, sql } = getTestDb();
const T = (hms: string) => new Date(`2026-07-11T${hms}Z`);
let serverId: number;
const playerIds: number[] = [];

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: 555312, name: "enf-renamed-killer" }).returning();
  serverId = s!.id;
  const [renamed] = await db.insert(players).values({ gamertag: "RK Newname" }).returning();
  const [taker] = await db.insert(players).values({ gamertag: "RK Oldname" }).returning();
  const [ghost] = await db.insert(players).values({ gamertag: "RK Ghost" }).returning();
  playerIds.push(Number(renamed!.id), Number(taker!.id), Number(ghost!.id));
  await db.insert(lives).values([renamed!, taker!, ghost!].map((p) => ({
    serverId, playerId: p.id, lifeNumber: 1, startedAt: T("10:00:00"), endedAt: T("10:03:00"),
    deathCause: "infected", playtimeSeconds: 180,
  })));
  await db.insert(kills).values([
    { serverId, killerGamertag: "RK Oldname", killerPlayerId: renamed!.id, victimGamertag: "one", occurredAt: T("10:02:00") },
    { serverId, killerGamertag: "rk ghost", killerPlayerId: null, victimGamertag: "two", occurredAt: T("10:02:30") },
  ]);
});
afterAll(async () => {
  await db.delete(kills).where(eq(kills.serverId, serverId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(players).where(inArray(players.id, playerIds));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("findEndedUnbannedLives + planBans — kills matched by player id", () => {
  it("a renamed killer's kill still qualifies his life in planBans", async () => {
    const mine = (await findEndedUnbannedLives(db)).filter((l) => l.serverId === serverId);
    expect(mine.find((l) => l.gamertag === "RK Newname")!.playerKills).toEqual([{ occurredAt: T("10:02:00") }]);
    const plans = planBans(mine, 24, T("10:10:00"));
    expect(plans.find((p) => p.gamertag === "RK Newname")).toMatchObject({ qualifiedBy: "kill", bannedAt: T("10:03:00") });
  });
  it("the player who now holds the old name is not banned for a kill he did not score", async () => {
    const mine = (await findEndedUnbannedLives(db)).filter((l) => l.serverId === serverId);
    expect(mine.find((l) => l.gamertag === "RK Oldname")!.playerKills).toEqual([]);
    expect(planBans(mine, 24, T("10:10:00")).map((p) => p.gamertag).sort()).toEqual(["RK Ghost", "RK Newname"]);
  });
  it("a kill row with no player id still counts by name, ignoring case", async () => {
    const mine = (await findEndedUnbannedLives(db)).filter((l) => l.serverId === serverId);
    expect(mine.find((l) => l.gamertag === "RK Ghost")!.playerKills).toEqual([{ occurredAt: T("10:02:30") }]);
  });
});
