import { classifyEntityLabel } from "./entities.js";

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
  /** Victim HP AFTER this hit. Optional: pre-stage-2 callers omit it. A hit that took HP to 0
   *  is the killing blow, which is what lets an unnamed death be attributed to it. */
  victimHp?: number | null;
}

/** A knockout in the death window. Infected deal SHOCK, which never appears in the ADM `[HP: …]`
 *  field — a player is knocked out at near-full health and DayZ then kills them for logging out
 *  unconscious. `disconnecting` records the combat-log form; the rule treats both alike. */
export interface RecentUnconscious {
  secondsBeforeDeath: number;
  disconnecting: boolean;
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

/** HP at or below this counts as "left at effectively zero health". Distinct from the fall
 *  rung's `<= 0` (a fall lands its own killing blow; infected stop just short). */
export const TERMINAL_HP_MAX = 1;

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
 * The cause a knockout-inflicting hit names. Mirrors the parser's entity dict in spirit, but reads
 * HIT labels, which are display names (`Wolf`, `Infected`, `FallDamageHealth`) rather than the
 * class names (`Animal_CanisLupus`) a death line carries — so the shared `classifyEntityLabel` is
 * tried first and the display forms are matched exactly. Anything unrecognised degrades to
 * `environmental`, the same fallback the parser uses for an unmapped death entity.
 */
function knockoutCause(hit: RecentHit): DeathVerdict["cause"] {
  if (hit.attackerType === "player") return "pvp";
  if (hit.attackerType === "infected") return "mauled";
  const label = hit.attackerLabel ?? "";
  if (label.startsWith("FallDamage")) return "fall";
  const animal = classifyEntityLabel(label);
  if (animal) return animal;
  // ⚠️ Anchored, not prefixed: `BearTrap` is a trap, not a bear.
  if (/^wolf$/iu.test(label)) return "wolf";
  if (/^bear$/iu.test(label)) return "bear";
  if (/^explosion$/iu.test(label)) return "explosion";
  return "environmental";
}

/**
 * Mechanism-first ladder. A mechanism explains its own side-effects: a suicide-by-blade's bleed and a
 * PvP kill's low HP are NOT read as underlying conditions. Underlying cause is inferred only for a
 * plain `died`/`unknown` mechanism. Pure — recentHits is supplied by the caller.
 */
export function classifyDeath(
  facts: DeathRawFacts,
  recentHits: RecentHit[],
  recentUnconscious: RecentUnconscious[],
): DeathVerdict {
  // Both evidence streams share ONE window, lower bound included: a "hit" logged after the death
  // instant is post-death noise, never evidence for it. The read-model already applies `>= 0` to
  // both, so this only makes the pure function agree with the contract the spec states.
  const recent = recentHits.filter((h) => h.secondsBeforeDeath >= 0 && h.secondsBeforeDeath <= RECENT_HIT_WINDOW_S);
  const starving = facts.energy != null && facts.energy <= STARVE_ENERGY_MAX;
  const dehydrated = facts.water != null && facts.water <= DEHYDRATE_WATER_MAX;
  const hunted = recent.some((h) => h.attackerType === "infected");
  const recentUnconsciousInWindow = recentUnconscious.filter(
    (u) => u.secondsBeforeDeath >= 0 && u.secondsBeforeDeath <= RECENT_HIT_WINDOW_S,
  );

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

  // A fall is logged TWICE and inconsistently: as a "hit by FallDamageHealth" line, and as a
  // death line that — unlike an animal or infected kill — carries no killer clause at all. The
  // parser's entity dict only reads the killer clause, so a fatal fall arrives here as a bare
  // `died`. The terminal hit is the evidence: HP 0 by FallDamage IS the killing blow, so this
  // rung sits ABOVE the condition inferences — a starving man who falls off a roof died of the
  // fall, and his hunger stays where it belongs, in conditions.
  const fatalFall = recent.find(
    (h) => (h.attackerLabel ?? "").startsWith("FallDamage") && h.victimHp != null && h.victimHp <= 0,
  );
  if (fatalFall) {
    return { cause: "fall", confidence: "high", conditions: withHealthy(baseConditions),
      basis: { ...basis, fallHitSecondsBeforeDeath: fatalFall.secondsBeforeDeath } };
  }

  if (starving) return { cause: "starvation", confidence: recent.length ? "low" : "high", conditions: baseConditions, basis };
  if (dehydrated) return { cause: "dehydration", confidence: recent.length ? "low" : "high", conditions: baseConditions, basis };

  // A player knocked unconscious does not get up: he either picks "respawn" or logs out, and the
  // SERVER kills the character — so the ADM writes a clauseless `died.` line naming nothing at
  // all. The knockout is what actually ended the life, so the death belongs to whatever caused
  // the knockout. Confirmed in production: every one of the 8 `choosing to respawn` lines follows
  // an `is unconscious` line, each with hits behind it (infected ×5, another player ×2, a fall ×1).
  //
  // ⚠️ Only hits at or BEFORE the knockout count. Infected keep chewing on a body after it drops,
  // and those later hits did not cause the knockout — attributing to them is how a fall death
  // becomes a mauling. The LOWEST victim HP among the pre-knockout hits names the source, because
  // that hit is the one that took them down; a stray scratch at 98 HP must never outvote the
  // player hits that did the work (real case: Cee Lo GREEN 96, 2026-07-13).
  //
  // Sits BELOW starvation/dehydration deliberately — that ordering predates this rung and is
  // pinned by its own test — and ABOVE the infected `mauled` rung below, which it subsumes for
  // knockout cases while that rung keeps the bleeding/terminal-HP evidence paths it owns.
  const lastKnockout = recentUnconsciousInWindow.reduce<RecentUnconscious | null>(
    (a, b) => (a == null || b.secondsBeforeDeath < a.secondsBeforeDeath ? b : a), null);
  if (lastKnockout) {
    const preKnockout = recent.filter(
      (h) => h.secondsBeforeDeath >= lastKnockout.secondsBeforeDeath && h.victimHp != null);
    const downedBy = preKnockout.reduce<RecentHit | null>(
      (a, b) => (a == null || b.victimHp! < a.victimHp! ? b : a), null);
    if (downedBy) {
      const cause = knockoutCause(downedBy);
      const bleedingNow = facts.bleedSources != null && facts.bleedSources > 0;
      return { cause, confidence: "high",
        conditions: bleedingNow ? [...baseConditions, "bleeding"] : withHealthy(baseConditions),
        basis: { ...basis, knockoutSecondsBeforeDeath: lastKnockout.secondsBeforeDeath,
          downedByLabel: downedBy.attackerLabel, downedByType: downedBy.attackerType,
          downedAtHp: downedBy.victimHp } };
    }
  }

  // Infected deaths systematically evade both proxies the old gate relied on: bleeding closes
  // before death, and shock never shows in HP. `hunted` is the gate; the three corroborations
  // are interchangeable. Verified against all 31 bare-`died` lives in production: fixes 5,
  // regresses none. Do NOT collapse this back to a bleedSources-only test.
  const bleeding = facts.bleedSources != null && facts.bleedSources > 0;
  const wentUnconscious = recentUnconsciousInWindow.length > 0;
  // ⚠️ INFECTED HITS ONLY. `hunted` and `terminal` must rest on the SAME hits, or a fire tick or
  // a player's shot that left the victim at ~0 HP is corroborated by an unrelated infected scratch
  // elsewhere in the 120s window — three such misattributions were reproduced, all previously
  // `unknown`, all promoted to `mauled` at HIGH confidence, and the verdict is frozen into
  // never-regenerated obituary prose. Coverage-neutral: life 313's 0.392 and life 119's 0.00 are
  // both infected hits.
  const hps = recent.filter((h) => h.attackerType === "infected").map((h) => h.victimHp).filter((n): n is number => n != null);
  const terminalHp = hps.length ? Math.min(...hps) : null;   // MIN, not the last hit — hits arrive with jitter
  const terminal = terminalHp != null && terminalHp <= TERMINAL_HP_MAX;

  if (hunted && (bleeding || wentUnconscious || terminal)) {
    return { cause: "mauled", confidence: "high",
      conditions: bleeding ? [...baseConditions, "bleeding"] : withHealthy(baseConditions),
      basis: { ...basis, wentUnconscious, terminalHp } };
  }
  if (bleeding && recent.length > 0) {
    return { cause: "bled_out", confidence: "high", conditions: [...baseConditions, "bleeding"], basis };
  }
  return { cause: "unknown", confidence: "low", conditions: withHealthy(baseConditions), basis };
}
