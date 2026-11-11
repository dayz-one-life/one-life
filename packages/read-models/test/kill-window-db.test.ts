import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, kills } from "@onelife/db";
import { and, eq, inArray } from "drizzle-orm";
import { getLifeKills } from "../src/player-kills.js";
import { qualifiedLifeCondition } from "../src/qualified-lives.js";
import { previousLifeEndedAt, loadPreviousLifeEnds } from "../src/kill-window-db.js";
import { getLeaderboard } from "../src/leaderboards.js";
import { getPlayerLives } from "../src/queries.js";

// The two-second posthumous-kill grace (src/kill-window.ts), against real rows. Invented data.
//
//   Bomber   life 1  10:00:00 - 10:03:00  explosion, 180 s   kill of "one" logged 10:03:01
//            life 2  10:03:01 - 10:04:00  infected,   59 s   (back inside the grace; no kill of its own)
//   Late     life 1  10:00:00 - 10:03:00  explosion, 180 s   kill of "two" logged 10:03:03
//   Trader   life 1  10:00:00 - 10:03:00  pvp                kill of "three" logged 10:03:02
//   Respawn  life 1  10:00:00 - 10:03:00  explosion, 180 s   kill of "four" logged 10:03:02
//            life 2  10:03:01 - (open)                 0 s   (back inside the grace; no kill of its own)
const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 47e7;
const T = (hms: string) => new Date(`2026-07-11T${hms}Z`);
let serverId: number;
const ids: Record<string, number> = {};
const lifeIds: Record<string, number> = {};

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "rm-kill-window" }).returning();
  serverId = s!.id;
  for (const gamertag of ["KW Bomber", "KW Late", "KW Trader", "KW Respawn"]) {
    const [p] = await db.insert(players).values({ gamertag, firstSeenAt: T("10:00:00"), lastSeenAt: T("10:04:00") }).returning();
    ids[gamertag] = Number(p!.id);
  }
  const life = async (key: string, gamertag: string, lifeNumber: number, startedAt: Date, endedAt: Date | null, deathCause: string | null, playtimeSeconds: number) => {
    const [l] = await db.insert(lives).values({ serverId, playerId: ids[gamertag]!, lifeNumber, startedAt, endedAt, deathCause, playtimeSeconds }).returning();
    lifeIds[key] = Number(l!.id);
  };
  await life("bomber1", "KW Bomber", 1, T("10:00:00"), T("10:03:00"), "explosion", 180);
  await life("bomber2", "KW Bomber", 2, T("10:03:01"), T("10:04:00"), "infected", 59);
  await life("late1", "KW Late", 1, T("10:00:00"), T("10:03:00"), "explosion", 180);
  await life("trader1", "KW Trader", 1, T("10:00:00"), T("10:03:00"), "pvp", 180);
  await life("respawn1", "KW Respawn", 1, T("10:00:00"), T("10:03:00"), "explosion", 180);
  await life("respawn2", "KW Respawn", 2, T("10:03:01"), null, null, 0);
  await db.insert(kills).values([
    { serverId, killerGamertag: "KW Bomber", killerPlayerId: ids["KW Bomber"]!, victimGamertag: "one", weapon: "Grenade", distance: 4, occurredAt: T("10:03:01") },
    { serverId, killerGamertag: "KW Late", killerPlayerId: ids["KW Late"]!, victimGamertag: "two", weapon: "Grenade", distance: 4, occurredAt: T("10:03:03") },
    { serverId, killerGamertag: "KW Trader", killerPlayerId: ids["KW Trader"]!, victimGamertag: "three", weapon: "M4-A1", distance: 9, occurredAt: T("10:03:02") },
    { serverId, killerGamertag: "KW Respawn", killerPlayerId: ids["KW Respawn"]!, victimGamertag: "four", weapon: "Grenade", distance: 4, occurredAt: T("10:03:02") },
  ]);
});
afterAll(async () => {
  await db.delete(kills).where(eq(kills.serverId, serverId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(players).where(inArray(players.id, Object.values(ids)));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("getLifeKills — the two-second grace", () => {
  it("includes a kill logged a second after the killer's death", async () => {
    const rows = await getLifeKills(db, serverId, "KW Bomber", T("10:00:00"), T("10:03:00"));
    expect(rows.map((r) => r.victimGamertag)).toEqual(["one"]);
  });
  it("includes a kill logged exactly two seconds after", async () => {
    const rows = await getLifeKills(db, serverId, "KW Trader", T("10:00:00"), T("10:03:00"));
    expect(rows.map((r) => r.victimGamertag)).toEqual(["three"]);
  });
  it("excludes a kill logged three seconds after", async () => {
    expect(await getLifeKills(db, serverId, "KW Late", T("10:00:00"), T("10:03:00"))).toEqual([]);
  });
  it("does not also count the kill toward the life the killer started inside the grace", async () => {
    expect(await getLifeKills(db, serverId, "KW Bomber", T("10:03:01"), T("10:04:00"))).toEqual([]);
    expect(await getLifeKills(db, serverId, "KW Bomber", T("10:03:01"), null)).toEqual([]);
  });
});

describe("previous life lookups", () => {
  it("previousLifeEndedAt finds the life before, and null for a first life", async () => {
    expect(await previousLifeEndedAt(db, serverId, ids["KW Bomber"]!, T("10:03:01"))).toEqual(T("10:03:00"));
    expect(await previousLifeEndedAt(db, serverId, ids["KW Bomber"]!, T("10:00:00"))).toBeNull();
  });
  it("loadPreviousLifeEnds answers the same for a whole server", async () => {
    const previousEnd = await loadPreviousLifeEnds(db, [serverId]);
    expect(previousEnd(serverId, ids["KW Bomber"]!, T("10:03:01"))).toEqual(T("10:03:00"));
    expect(previousEnd(serverId, ids["KW Bomber"]!, T("10:00:00"))).toBeNull();
    expect(previousEnd(serverId, ids["KW Late"]!, T("10:00:00"))).toBeNull();
    expect((await loadPreviousLifeEnds(db, []))(serverId, ids["KW Bomber"]!, T("10:03:01"))).toBeNull();
  });
});

describe("qualifiedLifeCondition — the two-second grace", () => {
  it("qualifies exactly the lives the pure rule does", async () => {
    const rows = await db
      .select({ id: lives.id })
      .from(lives)
      .innerJoin(players, eq(players.id, lives.playerId))
      .where(and(eq(lives.serverId, serverId), qualifiedLifeCondition(db)));
    const qualified = new Set(rows.map((r) => Number(r.id)));
    expect(qualified.has(lifeIds.bomber1!)).toBe(true);   // short, non-pvp, kill one second late
    expect(qualified.has(lifeIds.bomber2!)).toBe(false);  // the kill is the previous life's
    expect(qualified.has(lifeIds.late1!)).toBe(false);    // three seconds is outside the grace
    expect(qualified.has(lifeIds.trader1!)).toBe(true);   // pvp death, qualified regardless
    expect(qualified.has(lifeIds.respawn1!)).toBe(true);
    expect(qualified.has(lifeIds.respawn2!)).toBe(false); // open, and the kill is the previous life's
  });
});

describe("longest-killstreak — the two-second grace", () => {
  it("counts the posthumous kill once, in the life that ended", async () => {
    const rows = await getLeaderboard(db, serverId, "longest-killstreak", T("10:10:00"), 10);
    const by = new Map(rows.map((r) => [r.gamertag, r.value]));
    expect(by.get("KW Bomber")).toBe(1);
    expect(by.get("KW Trader")).toBe(1);
    expect(by.has("KW Late")).toBe(false);
    expect(by.get("KW Respawn")).toBe(1);
  });
});

describe("the boards that qualify lives in TypeScript — the two-second grace", () => {
  it("getPlayerLives counts the life the kill belongs to, and not the one after it", async () => {
    const numbers = async (gamertag: string) => ((await getPlayerLives(db, serverId, gamertag)) ?? []).map((l) => l.lifeNumber).sort();
    expect(await numbers("KW Bomber")).toEqual([1]);
    expect(await numbers("KW Late")).toEqual([]);
    expect(await numbers("KW Trader")).toEqual([1]);
    expect(await numbers("KW Respawn")).toEqual([1]);
  });
  it("alive-longest does not list an open life on the strength of the previous life's kill", async () => {
    const rows = await getLeaderboard(db, serverId, "alive-longest", T("10:10:00"), 10);
    expect(rows.map((r) => r.gamertag)).not.toContain("KW Respawn");
  });
  it("alltime-longest ranks the short life that the posthumous kill qualified", async () => {
    const rows = await getLeaderboard(db, serverId, "alltime-longest", T("10:10:00"), 10);
    const by = new Map(rows.map((r) => [r.gamertag, r.value]));
    expect(by.get("KW Bomber")).toBe(180);
    expect(by.has("KW Late")).toBe(false);
  });
});
