import type { LifeTimeline, OrdealSummary, PlayerPriors } from "@onelife/read-models";
import type { ObituaryTarget } from "./pg-store.js";

export const LEGEND_KILLS = 20;
export const LEGEND_SECONDS = 604800; // 7 days
export const FRESH_SPAWN_SECONDS = 1800; // 30 min
/** Under this, a self-inflicted death is a spawn reroll (a bad beach, a broken leg on landing),
 *  not the end of a run. Published suicides span 15s–5381s; the prompt must not read them alike. */
export const SUICIDE_RESET_SECONDS = 300; // 5 min

export interface ObituaryFacts {
  gamertag: string;
  map: string;
  mapSlug: string | null;
  lifeNumber: number;
  timeAliveSeconds: number;
  timeAliveLabel: string;
  kills: number;
  longestKillMeters: number | null;
  sessions: number;
  cause: string | null;
  // "suicide" is its own category: a deliberate self-inflicted end is neither a player kill nor
  // an act of the environment, and the two read completely differently in prose and imagery.
  causeCategory: "pvp" | "suicide" | "environment" | "unknown";
  killerGamertag: string | null;
  weapon: string | null;
  isLegend: boolean;
  freshSpawnVictim: boolean;
  endedAt: string;
  deathDistance: number | null;
  verdict: { cause: string; confidence: "high" | "low"; conditions: string[] } | null;
  ordeals: { infected: OrdealSummary; fire: OrdealSummary; pvp: OrdealSummary; buildsPlaced: number } | null;
  hpLow: number | null;
  priors: PlayerPriors;        // the player's global reputation before this life
  isKnownQuantity: boolean;    // priors.livesLived > 0
}

/** Human duration: days once past 24h, else "Hh Mm", else "Mm". */
export function timeAliveLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const days = Math.floor(s / 86400);
  if (days >= 1) {
    const h = Math.floor((s % 86400) / 3600);
    return h ? `${days}d ${h}h` : `${days}d`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** Compose the factual snapshot the obituary prompt and Rap Sheet are built from. */
export function buildObituaryFacts(
  target: ObituaryTarget,
  timeline: LifeTimeline,
  priors: PlayerPriors,
): ObituaryFacts {
  const life = timeline.life;
  const kills = timeline.kills.length;
  const longestKillMeters = timeline.kills.reduce<number | null>((max, k) => {
    if (k.distanceMeters == null) return max;
    return max == null || k.distanceMeters > max ? k.distanceMeters : max;
  }, null);
  const timeAliveSeconds = life.playtimeSeconds ?? 0;
  const cause = life.deathCause;
  const killerGamertag = life.deathByGamertag ?? null;
  // Order matters: a killer name outranks everything (a player did it), then the explicit suicide
  // token, then any other stated cause, then nothing at all.
  const causeCategory: ObituaryFacts["causeCategory"] =
    cause === "pvp" || killerGamertag
      ? "pvp"
      : cause === "suicide"
        ? "suicide"
        : cause
          ? "environment"
          : "unknown";

  return {
    gamertag: target.gamertag,
    map: target.map,
    mapSlug: target.mapSlug,
    lifeNumber: target.lifeNumber,
    timeAliveSeconds,
    timeAliveLabel: timeAliveLabel(timeAliveSeconds),
    kills,
    longestKillMeters,
    sessions: timeline.sessions.length,
    cause,
    causeCategory,
    killerGamertag,
    weapon: life.deathWeapon ?? null,
    isLegend: kills >= LEGEND_KILLS || timeAliveSeconds >= LEGEND_SECONDS,
    // Deliberately pvp-only: the flag exists to protect a victim from being mocked for being
    // preyed upon. A short suicide has no predator — it must never trip the protective branch,
    // which would make the prompt hunt for a killer that does not exist.
    freshSpawnVictim: causeCategory === "pvp" && timeAliveSeconds < FRESH_SPAWN_SECONDS,
    endedAt: target.endedAt.toISOString(),
    deathDistance: life.deathDistance ?? null,
    // basis is auditing detail — keep the frozen facts snapshot lean.
    verdict: timeline.verdict
      ? { cause: timeline.verdict.cause, confidence: timeline.verdict.confidence, conditions: timeline.verdict.conditions }
      : null,
    ordeals: timeline.ordeals ?? null,
    hpLow: timeline.hpLow ?? null,
    priors,
    isKnownQuantity: priors.livesLived > 0,
  };
}
