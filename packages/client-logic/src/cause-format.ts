import type { LegacyVerdictDto } from "@onelife/api-client";

/** Mechanism token -> display label. Shared by the life timeline and the funeral cards. */
export function causeLabel(cause: string | null): string {
  if (cause === "pvp") return "Killed";
  if (cause === "fall") return "Fell";
  if (cause === "died") return "Unknown"; // a bare "died" mechanism says nothing — read it as unknown
  if (!cause) return "Unknown";
  return cause.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const VERDICT_NOUN: Record<string, string> = {
  suicide: "Suicide",
  starvation: "Starvation",
  dehydration: "Dehydration",
  bled_out: "Bled out",
  mauled: "Mauled",
};

/**
 * Stage-2 mechanism tokens (a frozen copy of ENTITY_MECHANISMS, which lived beside the stage-1
 * classifier in @onelife/domain until death-verdict plan step 10 deleted both; legacy verdicts
 * still carry these tokens, so the list stays while the token branches do).
 *
 * These get no VERDICT_NOUN entry because causeLabel already words them, and for most of them the
 * verdict and the raw mechanism agree, so the fallback below reaches the same word either way.
 * `fall` is the exception that makes this set necessary: DayZ's death line for a fatal fall names
 * no killer, so the raw cause is a bare "died" while the verdict says "fall". Deferring to the raw
 * cause there prints "Unknown" and silently discards the classification.
 */
const ENTITY_VERDICTS = new Set(["wolf", "bear", "animal", "infected", "fall", "vehicle", "explosion"]);

/**
 * Display phrase for a death: the classified verdict when present, the mechanism label otherwise.
 * Environmental/unknown verdicts fall back to the mechanism (keeps "Drowned"/"Environment"
 * specificity); low-confidence inferred nouns hedge with "Likely".
 *
 * A public death (stage 4) carries its own `label`, already hedged on the server, and that wins.
 * Everything below it is the legacy path, for a payload that has only the legacy triple (an
 * article's frozen `facts.verdict`, an old API). It stays until the mobile minimum-version gate is
 * raised past the last build that reads those fields (death-verdict spec 7).
 */
export function verdictPhrase(verdict: (LegacyVerdictDto & { label?: string | null }) | null | undefined, cause: string | null): string {
  if (verdict?.label) return verdict.label;
  if (!verdict) return causeLabel(cause);
  if (verdict.cause === "pvp") return "Killed";
  const noun = VERDICT_NOUN[verdict.cause];
  // A verdict that names a mechanism outranks a raw cause that does not.
  if (!noun) {
    if (ENTITY_VERDICTS.has(verdict.cause)) return causeLabel(verdict.cause);
    const raw = causeLabel(cause);
    // ⚠️ `environmental` is reachable by INFERENCE (the knockout rung), not just from a stated
    // `drowned`/`environment` mechanism — and an inferred one sits on a death line that names
    // nothing, so the raw cause is a bare `died`. Deferring to it would print "Unknown" and throw
    // the verdict away. Prefer the raw cause while it is specific; degrade to the verdict, never
    // past it.
    if (verdict.cause === "environmental" && raw === "Unknown") return "Environment";
    return raw;
  }
  if (verdict.cause === "suicide") {
    const conds = verdict.conditions.filter((c) => c !== "healthy");
    if (conds.length) return `Suicide (${conds.join(", ")})`;
    if (verdict.conditions.includes("healthy")) return "Suicide (in good health)";
    return "Suicide";
  }
  return verdict.confidence === "low" ? `Likely ${noun.toLowerCase()}` : noun;
}
