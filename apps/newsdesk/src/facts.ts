import type { LifeTimeline, OrdealSummary } from "@onelife/read-models";
import type { ObituaryTarget } from "./pg-store.js";

export const LEGEND_KILLS = 20;
export const LEGEND_SECONDS = 604800; // 7 days
export const FRESH_SPAWN_SECONDS = 1800; // 30 min

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
  causeCategory: "pvp" | "environment" | "unknown";
  killerGamertag: string | null;
  weapon: string | null;
  isLegend: boolean;
  freshSpawnVictim: boolean;
  endedAt: string;
  deathDistance: number | null;
  verdict: { cause: string; confidence: "high" | "low"; conditions: string[] } | null;
  ordeals: { infected: OrdealSummary; fire: OrdealSummary; pvp: OrdealSummary; buildsPlaced: number } | null;
  hpLow: number | null;
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
export function buildObituaryFacts(target: ObituaryTarget, timeline: LifeTimeline): ObituaryFacts {
  const life = timeline.life;
  const kills = timeline.kills.length;
  const longestKillMeters = timeline.kills.reduce<number | null>((max, k) => {
    if (k.distanceMeters == null) return max;
    return max == null || k.distanceMeters > max ? k.distanceMeters : max;
  }, null);
  const timeAliveSeconds = life.playtimeSeconds ?? 0;
  const cause = life.deathCause;
  const killerGamertag = life.deathByGamertag ?? null;
  const causeCategory: ObituaryFacts["causeCategory"] =
    cause === "pvp" || killerGamertag ? "pvp" : cause ? "environment" : "unknown";

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
    freshSpawnVictim: causeCategory === "pvp" && timeAliveSeconds < FRESH_SPAWN_SECONDS,
    endedAt: target.endedAt.toISOString(),
    deathDistance: life.deathDistance ?? null,
    // basis is auditing detail — keep the frozen facts snapshot lean.
    verdict: timeline.verdict
      ? { cause: timeline.verdict.cause, confidence: timeline.verdict.confidence, conditions: timeline.verdict.conditions }
      : null,
    ordeals: timeline.ordeals ?? null,
    hpLow: timeline.hpLow ?? null,
  };
}
