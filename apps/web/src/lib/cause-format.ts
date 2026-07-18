import type { DeathVerdictDto } from "./types";

/** Mechanism token -> display label. The single shared copy (obituary/birth formats import it). */
export function causeLabel(cause: string | null): string {
  if (cause === "pvp") return "Killed";
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
 * Display phrase for a death: the classified verdict when present, the mechanism label otherwise.
 * Environmental/unknown verdicts fall back to the mechanism (keeps "Drowned"/"Environment"
 * specificity); low-confidence inferred nouns hedge with "Likely".
 */
export function verdictPhrase(verdict: DeathVerdictDto | null | undefined, cause: string | null): string {
  if (!verdict) return causeLabel(cause);
  if (verdict.cause === "pvp") return "Killed";
  const noun = VERDICT_NOUN[verdict.cause];
  if (!noun) return causeLabel(cause);
  if (verdict.cause === "suicide") {
    const conds = verdict.conditions.filter((c) => c !== "healthy");
    if (conds.length) return `Suicide (${conds.join(", ")})`;
    if (verdict.conditions.includes("healthy")) return "Suicide (in good health)";
    return "Suicide";
  }
  return verdict.confidence === "low" ? `Likely ${noun.toLowerCase()}` : noun;
}
