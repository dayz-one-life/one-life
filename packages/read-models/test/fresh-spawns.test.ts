import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, kills } from "@onelife/db";
import { inArray } from "drizzle-orm";
import { getFreshSpawns } from "../src/fresh-spawns.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 53e7;
const t0 = new Date("2026-07-11T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
let serverId: number;
const pids: number[] = [];

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "fs", map: "sakhal", slug: `fs-${svc}`, active: true }).returning();
  serverId = s!.id;
  const mk = async (tag: string) => {
    const [p] = await db.insert(players).values({ gamertag: tag, lastSeenAt: hrs(100) }).returning();
    pids.push(p!.id);
    return p!.id;
  };
  const early = await mk(`fs-early-${svc}`);  // born @1h, qualified (playtime)
  const late = await mk(`fs-late-${svc}`);    // born @6h, qualified (playtime)
  const short = await mk(`fs-short-${svc}`);  // born @3h, NOT qualified
  await db.insert(lives).values([
    { serverId, playerId: early, lifeNumber: 1, startedAt: hrs(1), endedAt: hrs(2), deathCause: "bled_out", playtimeSeconds: 3600 },
    { serverId, playerId: late, lifeNumber: 1, startedAt: hrs(6), endedAt: null, deathCause: null, playtimeSeconds: 1800 },
    { serverId, playerId: short, lifeNumber: 1, startedAt: hrs(3), endedAt: hrs(3.05), deathCause: "environment", playtimeSeconds: 30 },
  ]);
  async function lifeId(pid: number) {
    const r = await db.select({ id: lives.id }).from(lives).where(inArray(lives.playerId, [pid]));
    return r[0]!.id;
  }
  await db.insert(sessions).values([
    { serverId, playerId: early, lifeId: (await lifeId(early)), connectedAt: hrs(1), disconnectedAt: hrs(2), durationSeconds: 3600, closeReason: "death" },
  ]);
});

afterAll(async () => {
  await db.delete(kills).where(inArray(kills.serverId, [serverId]));
  await db.delete(sessions).where(inArray(sessions.serverId, [serverId]));
  await db.delete(lives).where(inArray(lives.serverId, [serverId]));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(inArray(servers.id, [serverId]));
  await sql.end();
});

describe("getFreshSpawns", () => {
  it("returns only qualified lives, newest birth first", async () => {
    const res = await getFreshSpawns(db, { page: 1, pageSize: 50 });
    const mine = res.rows.filter((r) => r.slug === `fs-${svc}`);
    expect(mine.map((r) => r.gamertag)).toEqual([`fs-late-${svc}`, `fs-early-${svc}`]); // late born @6h > early @1h; short excluded
  });

  it("enriches qualifiedAt on the page slice", async () => {
    const res = await getFreshSpawns(db, { page: 1, pageSize: 50 });
    const early = res.rows.find((r) => r.gamertag === `fs-early-${svc}`);
    expect(early?.qualifiedAt).toBeInstanceOf(Date); // qualified by 5min playtime
  });
});
