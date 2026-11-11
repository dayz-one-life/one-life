import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, players, lives, kills, sessions } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";
import { getLeaderboard } from "../src/leaderboards.js";

// A kill belongs to the player whose id is on the row, not to whoever holds the name on it.
// Invented data. Every life is under five minutes with no PvP death, so a kill is the only thing
// that can qualify it.
//
//   KB Newname  (was "KB Oldname")  ended life 10:00-10:03, two kills logged under the old name
//   KB Oldname  (took the name)     open life from 10:01, no kill of his own
//   KB Fresh    (was "KB Stale")    open life from 10:01, one kill logged under the old name
//   KB Ghost                        ended life 10:00-10:03, one kill with his id, one row with
//                                   NO id that carries his name in another casing
//   "KB Nobody"                     a row with no id and a name no player holds
const { db, sql } = getTestDb();
const T = (hms: string) => new Date(`2026-07-11T${hms}Z`);
const now = T("10:03:00");
let serverId: number;
const playerIds: number[] = [];

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: 555311, name: "lb-renamed-killer" }).returning();
  serverId = s!.id;
  const mk = async (gamertag: string) => {
    const [p] = await db.insert(players).values({ gamertag, firstSeenAt: T("10:00:00"), lastSeenAt: now }).returning();
    playerIds.push(Number(p!.id));
    return p!;
  };
  const renamed = await mk("KB Newname");
  const taker = await mk("KB Oldname");
  const fresh = await mk("KB Fresh");
  const ghost = await mk("KB Ghost");
  await db.insert(lives).values([
    { serverId, playerId: renamed.id, lifeNumber: 1, startedAt: T("10:00:00"), endedAt: T("10:03:00"), deathCause: "infected", playtimeSeconds: 180 },
    { serverId, playerId: ghost.id, lifeNumber: 1, startedAt: T("10:00:00"), endedAt: T("10:03:00"), deathCause: "infected", playtimeSeconds: 100 },
  ]);
  for (const p of [taker, fresh]) {
    const [l] = await db.insert(lives).values({ serverId, playerId: p.id, lifeNumber: 1, startedAt: T("10:01:00"), playtimeSeconds: 0 }).returning();
    await db.insert(sessions).values({ serverId, playerId: p.id, lifeId: l!.id, connectedAt: T("10:01:00") });
  }
  await db.insert(kills).values([
    { serverId, killerGamertag: "KB Oldname", killerPlayerId: renamed.id, victimGamertag: "one", occurredAt: T("10:02:00") },
    { serverId, killerGamertag: "KB Oldname", killerPlayerId: renamed.id, victimGamertag: "two", weapon: "Mosin", distance: 300, occurredAt: T("10:02:30") },
    { serverId, killerGamertag: "KB Stale", killerPlayerId: fresh.id, victimGamertag: "three", occurredAt: T("10:02:00") },
    { serverId, killerGamertag: "KB Ghost", killerPlayerId: ghost.id, victimGamertag: "four", occurredAt: T("10:01:00") },
    { serverId, killerGamertag: "kb ghost", killerPlayerId: null, victimGamertag: "five", occurredAt: T("10:02:00") },
    { serverId, killerGamertag: "KB Nobody", killerPlayerId: null, victimGamertag: "six", weapon: "SVD", distance: 120, occurredAt: T("10:02:00") },
  ]);
});
afterAll(async () => {
  await db.delete(kills).where(eq(kills.serverId, serverId));
  await db.delete(sessions).where(eq(sessions.serverId, serverId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(players).where(inArray(players.id, playerIds));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("leaderboards — a renamed killer's kill still counts on each board", () => {
  it("most-kills counts by player and prints the current name", async () => {
    const rows = await getLeaderboard(db, serverId, "most-kills", now, 10);
    expect(rows).toEqual([
      { gamertag: "KB Ghost", value: 2 },   // his own row plus the id-less row under his name
      { gamertag: "KB Newname", value: 2 }, // both logged under the old name
      { gamertag: "KB Fresh", value: 1 },
      { gamertag: "KB Nobody", value: 1 },  // no id, no holder: listed under the stored name
    ]);
  });
  it("most-kills applies the limit after merging", async () => {
    const rows = await getLeaderboard(db, serverId, "most-kills", now, 2);
    expect(rows.map((r) => r.gamertag)).toEqual(["KB Ghost", "KB Newname"]);
  });
  it("longest-kills prints the killer's current name, and the stored name on a row with no id", async () => {
    const rows = await getLeaderboard(db, serverId, "longest-kills", now, 10);
    expect(rows).toEqual([
      { gamertag: "KB Newname", value: 300, detail: { victim: "two", weapon: "Mosin" } }, // logged as "KB Oldname"
      { gamertag: "KB Nobody", value: 120, detail: { victim: "six", weapon: "SVD" } },
    ]);
  });
  it("longest-killstreak gives the streak to the renamed killer, not to the name's new holder", async () => {
    const rows = await getLeaderboard(db, serverId, "longest-killstreak", now, 10);
    // This board does not order level players, so compare without their order.
    expect(rows.map((r) => r.value)).toEqual([2, 2, 1]);
    expect(Object.fromEntries(rows.map((r) => [r.gamertag, r.value]))).toEqual({
      "KB Ghost": 2,   // his own kill plus the id-less row under his name
      "KB Newname": 2, // both logged under the old name
      "KB Fresh": 1,
    });
  });
  it("alltime-longest qualifies the renamed killer's short life by his kill", async () => {
    const rows = await getLeaderboard(db, serverId, "alltime-longest", now, 10);
    expect(rows).toEqual([
      { gamertag: "KB Newname", value: 180 },
      { gamertag: "KB Ghost", value: 100 },
      { gamertag: "KB Fresh", value: 0 }, // stored playtime; qualified by the kill
    ]);
  });
  it("alive-longest qualifies the renamed killer's open life and not the name's new holder's", async () => {
    const rows = await getLeaderboard(db, serverId, "alive-longest", now, 10);
    expect(rows).toEqual([{ gamertag: "KB Fresh", value: 120 }]);
  });
});
