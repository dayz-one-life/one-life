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
const gt2 = `DossierGap-${svc}`;
let pid2: number;
let lifeId2: number;
const gt3 = `DossierFall-${svc}`;
let pid3: number;
let lifeId3: number;

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

  // A second player + life, isolated from the assertions above, dedicated to the
  // ENCOUNTER_GAP_S = 120 boundary: hits exactly 120s apart must merge (gap must be
  // STRICTLY > 120 to split); a hit 121s after that must start a new encounter.
  const [p2] = await db.insert(players).values({ gamertag: gt2, lastSeenAt: mins(400) }).returning();
  pid2 = p2!.id;
  const [l2] = await db.insert(lives).values({
    serverId, playerId: pid2, lifeNumber: 1, startedAt: start, endedAt: mins(360),
    deathCause: "died", deathWeapon: null,
    energyAtDeath: 500, waterAtDeath: 500, bleedSourcesAtDeath: 0, playtimeSeconds: 21600,
  }).returning();
  lifeId2 = l2!.id;
  const gapT0 = mins(10);
  const gapT1 = new Date(gapT0.getTime() + 120_000); // exactly 120s after t0 — same encounter
  const gapT2 = new Date(gapT1.getTime() + 121_000); // 121s after t1 — new encounter
  await db.insert(hitEvents).values([
    { serverId, victimGamertag: gt2, attackerType: "infected", attackerLabel: "Infected", victimHp: 70, occurredAt: gapT0 },
    { serverId, victimGamertag: gt2, attackerType: "infected", attackerLabel: "Infected", victimHp: 55, occurredAt: gapT1 },
    { serverId, victimGamertag: gt2, attackerType: "infected", attackerLabel: "Infected", victimHp: 40, occurredAt: gapT2 },
  ]);

  // A third life: the RonaldRaygun552 shape (Sakhal, 2026-07-20). DayZ logged the fall as a hit
  // line at HP 0 and a death line with NO killer clause, so death_cause is a bare "died". The
  // verdict must still be "fall" — and it only can be if victimHp survives the row mapping.
  const [p3] = await db.insert(players).values({ gamertag: gt3, lastSeenAt: mins(400) }).returning();
  pid3 = p3!.id;
  const [l3] = await db.insert(lives).values({
    serverId, playerId: pid3, lifeNumber: 1, startedAt: start, endedAt: mins(360),
    deathCause: "died", deathWeapon: null,
    energyAtDeath: 1373.79, waterAtDeath: 672.959, bleedSourcesAtDeath: 0, playtimeSeconds: 21600,
  }).returning();
  lifeId3 = l3!.id;
  await db.insert(hitEvents).values({
    serverId, victimGamertag: gt3, attackerType: "environment", attackerLabel: "FallDamageHealth",
    victimHp: 0, occurredAt: mins(360),
  });
});

afterAll(async () => {
  await db.delete(hitEvents).where(inArray(hitEvents.serverId, [serverId]));
  await db.delete(buildEvents).where(inArray(buildEvents.serverId, [serverId]));
  await db.delete(sessions).where(inArray(sessions.serverId, [serverId]));
  await db.delete(lives).where(inArray(lives.serverId, [serverId]));
  await db.delete(players).where(inArray(players.id, [pid, pid2, pid3]));
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

  it("encounter gap boundary: exactly 120s apart is ONE encounter, 121s apart splits a new one", async () => {
    const d = await getLifeDossier(db, serverId, lifeId2);
    expect(d).not.toBeNull();
    expect(d!.ordeals.infected).toEqual({ encounters: 2, hits: 3, worstEncounterHits: 2 });
  });

  // This is the ONLY test that fails if `victimHp` is dropped from the row mapping — the domain
  // tests are pure-function tests and structurally cannot see a field lost in the read-model.
  // A silently dropped field in a mapping is precisely the defect being fixed here, so it gets
  // a guard of its own rather than relying on the classifier's own coverage.
  it("carries victimHp through the mapping so an unnamed fatal fall classifies as a fall", async () => {
    const d = await getLifeDossier(db, serverId, lifeId3);
    expect(d).not.toBeNull();
    expect(d!.death.mechanism).toBe("died"); // the death line named no killer
    expect(d!.recentHits).toHaveLength(1);
    expect(d!.recentHits[0]!.victimHp).toBe(0); // the evidence survived the mapping
    const v = dossierVerdict(d!);
    expect(v.cause).toBe("fall");
    expect(v.confidence).toBe("high");
  });
});
