import type { DeathVerdictDto } from "./types";

/** Mechanism token -> display label. The single shared copy (obituary/birth formats import it). */
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
 * Stage-2 mechanism tokens (mirrors ENTITY_MECHANISMS in @onelife/domain — apps/web has no
 * dependency on that package, so the list is duplicated deliberately rather than imported).
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
 */
export function verdictPhrase(verdict: DeathVerdictDto | null | undefined, cause: string | null): string {
  if (!verdict) return causeLabel(cause);
  if (verdict.cause === "pvp") return "Killed";
  const noun = VERDICT_NOUN[verdict.cause];
  // A verdict that names a mechanism outranks a raw cause that does not.
  if (!noun) return causeLabel(ENTITY_VERDICTS.has(verdict.cause) ? verdict.cause : cause);
  if (verdict.cause === "suicide") {
    const conds = verdict.conditions.filter((c) => c !== "healthy");
    if (conds.length) return `Suicide (${conds.join(", ")})`;
    if (verdict.conditions.includes("healthy")) return "Suicide (in good health)";
    return "Suicide";
  }
  return verdict.confidence === "low" ? `Likely ${noun.toLowerCase()}` : noun;
}
