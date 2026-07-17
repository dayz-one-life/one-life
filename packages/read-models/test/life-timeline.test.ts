import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, kills } from "@onelife/db";
import { inArray } from "drizzle-orm";
import { getLifeTimeline } from "../src/life-timeline.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 51e7;
const start = new Date("2026-07-14T00:00:00Z");
const mins = (m: number) => new Date(start.getTime() + m * 60_000);
let serverId: number;
let pid: number;
let deadLifeId: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "lt", map: "sakhal", slug: `lt-${svc}`, active: true }).returning();
  serverId = s!.id;
  const [p] = await db.insert(players).values({ gamertag: `LtHero-${svc}`, lastSeenAt: mins(400) }).returning();
  pid = p!.id;
  const [dl] = await db.insert(lives).values({
    serverId, playerId: pid, lifeNumber: 1, startedAt: start, endedAt: mins(360),
    deathCause: "pvp", deathByGamertag: "SomeKiller", deathWeapon: "VSD", deathDistance: 126,
    energyAtDeath: 42, waterAtDeath: 18, bleedSourcesAtDeath: 2, playtimeSeconds: 21600,
  }).returning();
  deadLifeId = dl!.id;
  await db.insert(sessions).values([
    { serverId, playerId: pid, lifeId: deadLifeId, connectedAt: start, disconnectedAt: mins(180), durationSeconds: 10800, closeReason: "disconnect" },
    { serverId, playerId: pid, lifeId: deadLifeId, connectedAt: mins(200), disconnectedAt: mins(360), durationSeconds: 9600, closeReason: "death" },
  ]);
  await db.insert(kills).values({
    serverId, killerGamertag: `LtHero-${svc}`, victimGamertag: "Victim1", weapon: "KAS-74U", distance: 25, occurredAt: mins(120),
  });
});

afterAll(async () => {
  await db.delete(kills).where(inArray(kills.serverId, [serverId]));
  await db.delete(sessions).where(inArray(sessions.serverId, [serverId]));
  await db.delete(lives).where(inArray(lives.serverId, [serverId]));
  await db.delete(players).where(inArray(players.id, [pid]));
  await db.delete(servers).where(inArray(servers.id, [serverId]));
  await sql.end();
});

describe("getLifeTimeline", () => {
  it("returns life + ordered sessions + kills + qualifiedAt", async () => {
    const t = await getLifeTimeline(db, serverId, `LtHero-${svc}`, deadLifeId);
    expect(t).not.toBeNull();
    expect(t!.life.lifeNumber).toBe(1);
    expect(t!.sessions).toHaveLength(2);
    expect(t!.kills).toHaveLength(1);
    expect(t!.kills[0]!.victimGamertag).toBe("Victim1");
    // qualified: candidates are {playtime crossing @+5m into the first 180m session,
    // kill @120m, pvp-death @360m} → earliest is the playtime crossing (verified against
    // packages/read-models/test/qualified-at.test.ts, which asserts the identical
    // "crosses 5 minutes into a long session" behavior of lifeQualifiedAt).
    expect(t!.qualifiedAt?.by).toBe("playtime");
  });

  it("returns null for an unknown life", async () => {
    expect(await getLifeTimeline(db, serverId, `LtHero-${svc}`, 9_999_999)).toBeNull();
  });
});
