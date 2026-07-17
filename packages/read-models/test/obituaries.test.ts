import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, kills } from "@onelife/db";
import { inArray } from "drizzle-orm";
import { getObituaries } from "../src/obituaries.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 52e7;
const t0 = new Date("2026-07-10T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
let serverId: number;
const pids: number[] = [];

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "ob", map: "chernarusplus", slug: `ob-${svc}`, active: true }).returning();
  serverId = s!.id;
  const mk = async (tag: string) => {
    const [p] = await db.insert(players).values({ gamertag: tag, lastSeenAt: hrs(100) }).returning();
    pids.push(p!.id);
    return p!.id;
  };
  const pvp = await mk(`ob-pvp-${svc}`);      // qualified: pvp death
  const long = await mk(`ob-long-${svc}`);    // qualified: 5min+ playtime
  const short = await mk(`ob-short-${svc}`);  // NOT qualified: 60s, environment death, no kills
  await db.insert(lives).values([
    { serverId, playerId: pvp, lifeNumber: 1, startedAt: hrs(1), endedAt: hrs(2), deathCause: "pvp", deathByGamertag: "Killer", deathWeapon: "M4", deathDistance: 90, playtimeSeconds: 200, energyAtDeath: null, waterAtDeath: null, bleedSourcesAtDeath: null },
    { serverId, playerId: long, lifeNumber: 1, startedAt: hrs(3), endedAt: hrs(4), deathCause: "bled_out", deathByGamertag: null, deathWeapon: null, deathDistance: null, playtimeSeconds: 3600, energyAtDeath: null, waterAtDeath: null, bleedSourcesAtDeath: null },
    { serverId, playerId: short, lifeNumber: 1, startedAt: hrs(5), endedAt: hrs(5.1), deathCause: "environment", deathByGamertag: null, deathWeapon: null, deathDistance: null, playtimeSeconds: 60, energyAtDeath: null, waterAtDeath: null, bleedSourcesAtDeath: null },
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

describe("getObituaries", () => {
  it("returns only qualified dead lives, newest death first", async () => {
    const res = await getObituaries(db, { page: 1, pageSize: 50 });
    const mine = res.rows.filter((r) => r.slug === `ob-${svc}`);
    expect(mine.map((r) => r.gamertag)).toEqual([`ob-long-${svc}`, `ob-pvp-${svc}`]); // long died @4h > pvp @2h; short excluded
    expect(mine[1]!.cause).toBe("pvp");
    expect(mine[1]!.byGamertag).toBe("Killer");
  });

  it("paginates", async () => {
    const res = await getObituaries(db, { page: 1, pageSize: 1 });
    expect(res.pageSize).toBe(1);
    expect(res.rows).toHaveLength(1);
    expect(res.total).toBeGreaterThanOrEqual(2);
  });
});
