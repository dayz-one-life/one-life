import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, hitEvents, buildEvents } from "@onelife/db";
import { inArray, eq } from "drizzle-orm";
import { getLifeDossier, dossierVerdict } from "../src/life-dossier.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 61e7;
const start = new Date("2026-07-15T00:00:00Z");
const mins = (m: number) => new Date(start.getTime() + m * 60_000);
const gt = `Dossier-${svc}`;
let serverId: number;
let pid: number;
let lifeId: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "ld", map: "sakhal", slug: `ld-${svc}`, active: true }).returning();
  serverId = s!.id;
  const [p] = await db.insert(players).values({ gamertag: gt, lastSeenAt: mins(400) }).returning();
  pid = p!.id;
  // Died at +360m: mechanism "died", starving, one bleed source — the flaminx0r shape.
  const [l] = await db.insert(lives).values({
    serverId, playerId: pid, lifeNumber: 1, startedAt: start, endedAt: mins(360),
    deathCause: "died", deathWeapon: null,
    energyAtDeath: 0, waterAtDeath: 620.083, bleedSourcesAtDeath: 1, playtimeSeconds: 21600,
  }).returning();
  lifeId = l!.id;
  await db.insert(sessions).values([
    { serverId, playerId: pid, lifeId, connectedAt: start, disconnectedAt: mins(180), durationSeconds: 10800, closeReason: "disconnect" },
    { serverId, playerId: pid, lifeId, connectedAt: mins(200), disconnectedAt: mins(360), durationSeconds: 9600, closeReason: "death" },
  ]);
  await db.insert(buildEvents).values({ serverId, gamertag: gt, playerId: pid, lifeId, action: "placed", object: "Fireplace", occurredAt: mins(30) });
  await db.insert(hitEvents).values([
    // Encounter 1: two infected ticks 10s apart at +100m.
    { serverId, victimGamertag: gt, attackerType: "infected", attackerLabel: "Infected", victimHp: 62, occurredAt: mins(100) },
    { serverId, victimGamertag: gt, attackerType: "infected", attackerLabel: "Infected", victimHp: 47, occurredAt: new Date(mins(100).getTime() + 10_000) },
    // Encounter 2 (gap > 120s): one infected tick 30s before death — inside the recent window.
    { serverId, victimGamertag: gt, attackerType: "infected", attackerLabel: "Infected", victimHp: 12, occurredAt: new Date(mins(360).getTime() - 30_000) },
    // A fire tick (attackerType environment, label Fireplace) at +50m.
    { serverId, victimGamertag: gt, attackerType: "environment", attackerLabel: "Fireplace", victimHp: 80, occurredAt: mins(50) },
    // Outside the life window entirely (before birth) — must be ignored.
    { serverId, victimGamertag: gt, attackerType: "player", attackerGamertag: "Someone", victimHp: 90, occurredAt: mins(-10) },
  ]);
});

afterAll(async () => {
  await db.delete(hitEvents).where(inArray(hitEvents.serverId, [serverId]));
  await db.delete(buildEvents).where(inArray(buildEvents.serverId, [serverId]));
  await db.delete(sessions).where(inArray(sessions.serverId, [serverId]));
  await db.delete(lives).where(inArray(lives.serverId, [serverId]));
  await db.delete(players).where(inArray(players.id, [pid]));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("getLifeDossier", () => {
  it("collapses hit ticks into encounters, splits fire from infected, windows recentHits", async () => {
    const d = await getLifeDossier(db, serverId, lifeId);
    expect(d).not.toBeNull();
    expect(d!.sessionCount).toBe(2);
    expect(d!.ordeals.buildsPlaced).toBe(1);
    // Two infected encounters (ticks 10s apart merge; the pre-death tick is its own).
    expect(d!.ordeals.infected).toEqual({ encounters: 2, hits: 3, worstEncounterHits: 2 });
    expect(d!.ordeals.fire).toEqual({ encounters: 1, hits: 1, worstEncounterHits: 1 });
    // The pre-birth player hit is outside the window: pvp ordeal empty.
    expect(d!.ordeals.pvp).toEqual({ encounters: 0, hits: 0, worstEncounterHits: 0 });
    expect(d!.hpLow).toBe(12);
    // Only the tick 30s before death is "recent".
    expect(d!.recentHits).toHaveLength(1);
    expect(d!.recentHits[0]!.attackerType).toBe("infected");
    expect(d!.recentHits[0]!.secondsBeforeDeath).toBe(30);
    expect(d!.death).toEqual({ mechanism: "died", energy: 0, water: 620.083, bleedSources: 1, weapon: null });
  });

  it("dossierVerdict: starving + recent infected hit => starvation, low confidence, hunted", async () => {
    const d = await getLifeDossier(db, serverId, lifeId);
    const v = dossierVerdict(d!);
    expect(v.cause).toBe("starvation");
    expect(v.confidence).toBe("low"); // the recent infected hit is a competing explanation
    expect(v.conditions).toEqual(expect.arrayContaining(["starving", "hunted"]));
  });

  it("returns null for an unknown life", async () => {
    expect(await getLifeDossier(db, serverId, 999_999_999)).toBeNull();
  });
});
