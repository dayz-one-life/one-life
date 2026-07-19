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
  // "environment" means a mechanism was actually NAMED (bled_out/starvation/wolf/fall/...);
  // a bare `died` with no verdict is "unknown", never environment — see the derivation below.
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

/**
 * D4 — cause tokens that name no real mechanism. `died` is what the ADM parser writes when the
 * log line carries no killer and no entity; `environment`/`environmental` are the parser's and
 * classifier's catch-alls. Handing any of these to the model as a bare word invited invention
 * (a bare "environment" was published as the headline word "Terrain" for a death actually
 * recorded as infected). Treat them as an explicit unknown instead — the absence IS the story.
 *
 * Lives here rather than in prompt.ts because the causeCategory derivation below is its first
 * consumer: the tag and the prose must agree on one vocabulary of "no mechanism named".
 */
const UNRECORDED_CAUSES = new Set(["", "died", "environment", "environmental", "unknown"]);

/** True when the cause token names no mechanism (null/empty/died/environment/unknown). */
export function isUnrecordedCause(cause: string | null | undefined): boolean {
  return UNRECORDED_CAUSES.has((cause ?? "").trim().toLowerCase());
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
  // A cause token only counts as "environment" if it NAMES a mechanism. A bare `died` (and the
  // parser's `environment`/`environmental` catch-alls) name nothing — a truthiness test used to
  // file them as Environment, which published an "Environment" tag over prose that correctly
  // said no cause was recorded. Mirrors causeUnrecorded(): the verdict can rescue the category
  // when classifyDeath inferred a real mechanism (e.g. starvation) from a bare log line, so
  // causeCategory === "unknown" <=> causeUnrecorded(facts) outside the pvp short-circuit.
  // The rescue only asks whether a mechanism was named, not which; a verdict of `pvp`/`suicide`
  // over a bare cause still lands on `environment`, unchanged from before — narrowing that is
  // out of scope.
  // Order matters: a killer name outranks everything (a player did it), then the explicit
  // suicide token, then a named mechanism, then nothing at all.
  const mechanismNamed = !isUnrecordedCause(cause) || !isUnrecordedCause(timeline.verdict?.cause ?? null);
  const causeCategory: ObituaryFacts["causeCategory"] =
    cause === "pvp" || killerGamertag
      ? "pvp"
      : cause === "suicide"
        ? "suicide"
        : mechanismNamed
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
