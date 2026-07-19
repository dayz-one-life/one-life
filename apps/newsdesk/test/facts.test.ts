import { describe, it, expect } from "vitest";
import { buildObituaryFacts, timeAliveLabel, isUnrecordedCause } from "../src/facts.js";
import type { ObituaryTarget } from "../src/pg-store.js";
import type { PlayerPriors } from "@onelife/read-models";

const noPriors: PlayerPriors = {
  livesLived: 0, longestLifeSeconds: 0, totalKills: 0,
  usualDeathCause: null, lastDeathCause: null, bestLifeMap: null,
};
const vetPriors: PlayerPriors = {
  livesLived: 15, longestLifeSeconds: 259200, totalKills: 48,
  usualDeathCause: "animal", lastDeathCause: "bled_out", bestLifeMap: "sakhal",
};

const target: ObituaryTarget = {
  lifeId: 1, serverId: 1, gamertag: "Boots", map: "chernarusplus",
  mapSlug: "chernarus", lifeNumber: 3, lifeStartedAt: new Date("2026-07-09T02:00:00Z"), endedAt: new Date("2026-07-10T02:00:00Z"),
};

function timeline(over: Partial<{ life: Record<string, unknown>; kills: unknown[]; sessions: unknown[]; verdict: unknown; ordeals: unknown; hpLow: unknown }> = {}) {
  return {
    life: { deathCause: "pvp", deathByGamertag: "Sn1per", deathWeapon: "M4", deathDistance: null, playtimeSeconds: 7200, ...(over.life ?? {}) },
    sessions: over.sessions ?? [{}, {}],
    kills: over.kills ?? [{ distanceMeters: 120 }, { distanceMeters: 300 }, { distanceMeters: null }],
    character: null,
    qualifiedAt: null,
    verdict: over.verdict ?? null,
    ordeals: over.ordeals ?? {
      infected: { encounters: 0, hits: 0, worstEncounterHits: 0 },
      fire: { encounters: 0, hits: 0, worstEncounterHits: 0 },
      pvp: { encounters: 0, hits: 0, worstEncounterHits: 0 },
      buildsPlaced: 0,
    },
    hpLow: over.hpLow ?? null,
  } as unknown as import("@onelife/read-models").LifeTimeline;
}

describe("timeAliveLabel", () => {
  it("uses days over 24h, else h/m", () => {
    expect(timeAliveLabel(7200)).toBe("2h 0m");
    expect(timeAliveLabel(90000)).toBe("1d 1h");
    expect(timeAliveLabel(90)).toBe("1m");
  });
});

describe("buildObituaryFacts", () => {
  it("derives kills, longest kill, sessions, cause category, killer, weapon", () => {
    const f = buildObituaryFacts(target, timeline(), noPriors);
    expect(f.kills).toBe(3);
    expect(f.longestKillMeters).toBe(300);
    expect(f.sessions).toBe(2);
    expect(f.causeCategory).toBe("pvp");
    expect(f.killerGamertag).toBe("Sn1per");
    expect(f.weapon).toBe("M4");
    expect(f.timeAliveSeconds).toBe(7200);
    expect(f.endedAt).toBe("2026-07-10T02:00:00.000Z");
  });

  it("flags a legend by kills", () => {
    const f = buildObituaryFacts(target, timeline({ kills: Array.from({ length: 25 }, () => ({ distanceMeters: 10 })) }), noPriors);
    expect(f.isLegend).toBe(true);
  });

  it("flags a fresh-spawn victim (short pvp life) and NOT a legend", () => {
    const f = buildObituaryFacts(target, timeline({ life: { deathCause: "pvp", deathByGamertag: "Camper", deathWeapon: "SKS", playtimeSeconds: 600 }, kills: [] }), noPriors);
    expect(f.freshSpawnVictim).toBe(true);
    expect(f.isLegend).toBe(false);
  });

  it("classifies a non-pvp death as environment, killer null", () => {
    const f = buildObituaryFacts(target, timeline({ life: { deathCause: "bled_out", deathByGamertag: null, deathWeapon: null, playtimeSeconds: 3600 }, kills: [] }), noPriors);
    expect(f.causeCategory).toBe("environment");
    expect(f.killerGamertag).toBeNull();
    expect(f.freshSpawnVictim).toBe(false);
  });

  it("classifies a suicide as its own category, never environment", () => {
    const f = buildObituaryFacts(target, timeline({ life: { deathCause: "suicide", deathByGamertag: null, deathWeapon: null, playtimeSeconds: 5381 }, kills: [] }), noPriors);
    expect(f.causeCategory).toBe("suicide");
    expect(f.killerGamertag).toBeNull();
  });

  it("a very short suicide is NOT a fresh-spawn victim (that flag is pvp-only)", () => {
    const f = buildObituaryFacts(target, timeline({ life: { deathCause: "suicide", deathByGamertag: null, deathWeapon: null, playtimeSeconds: 15 }, kills: [] }), noPriors);
    expect(f.causeCategory).toBe("suicide");
    expect(f.freshSpawnVictim).toBe(false);
  });

  it("classifies a missing cause as unknown", () => {
    const f = buildObituaryFacts(target, timeline({ life: { deathCause: null, deathByGamertag: null, deathWeapon: null, playtimeSeconds: 3600 }, kills: [] }), noPriors);
    expect(f.causeCategory).toBe("unknown");
  });

  it("carries verdict, ordeals, hpLow, and deathDistance into the facts", () => {
    const t = timeline({
      life: { deathCause: "pvp", deathByGamertag: "Camper", deathWeapon: "SKS", deathDistance: 153.4, playtimeSeconds: 600 },
      kills: [],
      verdict: { cause: "pvp", confidence: "high", conditions: ["healthy"], basis: {} },
      ordeals: { infected: { encounters: 2, hits: 3, worstEncounterHits: 2 }, fire: { encounters: 1, hits: 1, worstEncounterHits: 1 }, pvp: { encounters: 0, hits: 0, worstEncounterHits: 0 }, buildsPlaced: 1 },
      hpLow: 12,
    });
    const f = buildObituaryFacts(target, t, noPriors);
    expect(f.verdict).toEqual({ cause: "pvp", confidence: "high", conditions: ["healthy"] }); // basis stripped
    expect(f.ordeals!.infected.encounters).toBe(2);
    expect(f.hpLow).toBe(12);
    expect(f.deathDistance).toBe(153.4);
  });

  it("carries priors through and flags a known quantity", () => {
    const f = buildObituaryFacts(target, timeline(), vetPriors);
    expect(f.priors).toEqual(vetPriors);
    expect(f.isKnownQuantity).toBe(true);
  });

  it("a first-lifer is not a known quantity", () => {
    const f = buildObituaryFacts(target, timeline(), noPriors);
    expect(f.priors.livesLived).toBe(0);
    expect(f.isKnownQuantity).toBe(false);
  });
});

describe("isUnrecordedCause", () => {
  it("covers the unknown set, case- and whitespace-insensitively", () => {
    for (const c of [null, undefined, "", "  ", "died", "Died", " ENVIRONMENT ", "environmental", "unknown"]) {
      expect(isUnrecordedCause(c)).toBe(true);
    }
    for (const c of ["infected", "wolf", "bear", "animal", "fall", "pvp", "bled_out", "starvation", "suicide"]) {
      expect(isUnrecordedCause(c)).toBe(false);
    }
  });
});
