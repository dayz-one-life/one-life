import type { LifeTimeline, PlayerPriors } from "@onelife/read-models";
import { writerDeathOf } from "@onelife/read-models";
import { CLASSIFIER_VERSION, type LifeDeathFacts, type StoredVerdict, type TrapCredit } from "@onelife/death-verdict";
import { buildObituaryFacts, type ObituaryFacts } from "../src/facts.js";
import type { ObituaryTarget } from "../src/pg-store.js";

/** ⚠️ Invented values only. */
export const noPriors: PlayerPriors = {
  livesLived: 0, longestLifeSeconds: 0, totalKills: 0, trapKills: 0,
  usualDeathCause: null, lastDeathCause: null, bestLifeMap: null,
};

export const target: ObituaryTarget = {
  lifeId: 1, serverId: 1, gamertag: "Victim One", map: "chernarusplus",
  mapSlug: "chernarus", lifeNumber: 3, lifeStartedAt: new Date("2031-07-09T02:00:00Z"), endedAt: new Date("2031-07-10T02:00:00Z"),
};

export function stored(over: Partial<StoredVerdict> = {}): StoredVerdict {
  return {
    cause: "fall", confidence: "definitive", mechanismStated: true, objectKey: null, upstream: null,
    attrBasis: null, ownerlessFirearm: false, conditions: [], ...over,
  };
}

const ORDEALS_NONE = {
  infected: { encounters: 0, hits: 0, worstEncounterHits: 0 },
  fire: { encounters: 0, hits: 0, worstEncounterHits: 0 },
  pvp: { encounters: 0, hits: 0, worstEncounterHits: 0 },
  buildsPlaced: 0,
};

export interface FactsInput {
  verdict?: Partial<StoredVerdict>;
  life?: Partial<LifeDeathFacts> & { playtimeSeconds?: number };
  credit?: TrapCredit | null;
  kills?: { distanceMeters: number | null; basis?: "kill_line" | "trap_placement" }[];
  priors?: Partial<PlayerPriors>;
  ordeals?: Partial<typeof ORDEALS_NONE> | null;
  sessions?: number;
  hpLow?: number | null;
}

/** Facts built through the real path: stored verdict → writerDeathOf → buildObituaryFacts. */
export function factsFor(i: FactsInput = {}): ObituaryFacts {
  const life = {
    deathCause: "died", deathByGamertag: null, deathWeapon: null, deathDistance: null, playtimeSeconds: 7200, ...(i.life ?? {}),
  };
  const priors = { ...noPriors, ...(i.priors ?? {}) };
  const timeline = {
    life,
    sessions: Array.from({ length: i.sessions ?? 2 }, () => ({})),
    kills: (i.kills ?? []).map((k) => ({ victimGamertag: "Someone", weapon: null, occurredAt: new Date(), basis: "kill_line", ...k })),
    qualifiedAt: null,
    verdict: null,
    ordeals: i.ordeals === null ? null : { ...ORDEALS_NONE, ...(i.ordeals ?? {}) },
    hpLow: i.hpLow ?? null,
  } as unknown as LifeTimeline;
  const writer = writerDeathOf(stored(i.verdict), life, i.credit ?? null, CLASSIFIER_VERSION);
  return buildObituaryFacts(target, timeline, priors, writer);
}
