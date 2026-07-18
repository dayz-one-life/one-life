export interface DeathRawFacts {
  mechanism: string | null;      // lives.death_cause: pvp|suicide|bled_out|drowned|died|environment|unknown
  energy: number | null;
  water: number | null;
  bleedSources: number | null;
  weapon: string | null;         // part of input contract; reserved for future melee/firearm distinction; not read by classifyDeath today
}

export interface RecentHit {
  attackerType: string;          // "player" | "infected" | "environment"
  attackerLabel: string | null;  // e.g. "Fireplace", "Infected"
  secondsBeforeDeath: number;
}

export type DeathConfidence = "high" | "low";

export interface DeathVerdict {
  cause: "pvp" | "suicide" | "starvation" | "dehydration" | "bled_out" | "mauled" | "environmental" | "unknown"
    // Stage 2 — named non-player mechanisms pass through as themselves.
    | "wolf" | "bear" | "animal" | "infected" | "fall" | "vehicle" | "explosion";
  confidence: DeathConfidence;
  conditions: string[];          // "starving" | "dehydrated" | "bleeding" | "hunted" | "drowned" | "healthy"
  basis: Record<string, unknown>;
}

export const STARVE_ENERGY_MAX = 1;     // Energy ≈ 0 (game reports 0 when out of food)
export const DEHYDRATE_WATER_MAX = 1;   // Water ≈ 0
export const RECENT_HIT_WINDOW_S = 120; // "recent" damage window feeding cause inference

const ENTITY_MECHANISM_LIST = ["wolf", "bear", "animal", "infected", "fall", "vehicle", "explosion"] as const satisfies readonly DeathVerdict["cause"][];
/** Stage-2 mechanism tokens from the parser's entity dict — stated causes, never inferred over. */
export const ENTITY_MECHANISMS: ReadonlySet<string> = new Set(ENTITY_MECHANISM_LIST);

/**
 * Cause family for aggregation (the priors mode): the finer stage-2 vocabulary must not fragment
 * "usual end" — wolf x2 + bear x1 should still beat pvp x2 as "animal". Display labels stay
 * specific; only aggregation groups.
 */
export function causeFamily(cause: string): string {
  if (cause === "wolf" || cause === "bear" || cause === "animal") return "animal";
  return cause;
}

/**
 * Mechanism-first ladder. A mechanism explains its own side-effects: a suicide-by-blade's bleed and a
 * PvP kill's low HP are NOT read as underlying conditions. Underlying cause is inferred only for a
 * plain `died`/`unknown` mechanism. Pure — recentHits is supplied by the caller.
 */
export function classifyDeath(facts: DeathRawFacts, recentHits: RecentHit[]): DeathVerdict {
  const recent = recentHits.filter((h) => h.secondsBeforeDeath <= RECENT_HIT_WINDOW_S);
  const starving = facts.energy != null && facts.energy <= STARVE_ENERGY_MAX;
  const dehydrated = facts.water != null && facts.water <= DEHYDRATE_WATER_MAX;
  const hunted = recent.some((h) => h.attackerType === "infected");

  const baseConditions: string[] = [];
  if (starving) baseConditions.push("starving");
  if (dehydrated) baseConditions.push("dehydrated");
  if (hunted) baseConditions.push("hunted");
  const withHealthy = (c: string[]) => (c.length ? c : ["healthy"]);
  const basis = { mechanism: facts.mechanism, energy: facts.energy, water: facts.water,
    bleedSources: facts.bleedSources, recentInfectedHits: recent.filter((h) => h.attackerType === "infected").length };

  // Mechanism-first: these explain their own bleed/HP; do not add "bleeding".
  if (facts.mechanism === "pvp") return { cause: "pvp", confidence: "high", conditions: withHealthy(baseConditions), basis };
  if (facts.mechanism === "suicide") return { cause: "suicide", confidence: "high", conditions: withHealthy(baseConditions), basis };
  if (facts.mechanism === "bled_out") return { cause: "bled_out", confidence: "high", conditions: [...baseConditions, "bleeding"], basis };
  if (facts.mechanism === "drowned") return { cause: "environmental", confidence: "high", conditions: [...baseConditions, "drowned"], basis };
  if (facts.mechanism === "environment") return { cause: "environmental", confidence: "high", conditions: withHealthy(baseConditions), basis }; // STATED mechanism is high-confidence; only INFERRED causes below are graded down by competing hits

  if (facts.mechanism && ENTITY_MECHANISMS.has(facts.mechanism)) {
    // A named killer explains its own bleed/HP damage — same side-effect subtraction as above.
    return { cause: facts.mechanism as DeathVerdict["cause"], confidence: "high", conditions: withHealthy(baseConditions), basis };
  }

  // No explaining mechanism (died/unknown/null): infer the underlying cause.
  if (starving) return { cause: "starvation", confidence: recent.length ? "low" : "high", conditions: baseConditions, basis };
  if (dehydrated) return { cause: "dehydration", confidence: recent.length ? "low" : "high", conditions: baseConditions, basis };
  if (facts.bleedSources != null && facts.bleedSources > 0 && recent.length > 0) {
    return { cause: hunted ? "mauled" : "bled_out", confidence: "high", conditions: [...baseConditions, "bleeding"], basis };
  }
  return { cause: "unknown", confidence: "low", conditions: withHealthy(baseConditions), basis };
}
