/**
 * The words a client prints for a trap kill (death-verdict spec 2.4). The web and the mobile app
 * cannot import `@onelife/death-verdict`, so the strings are repeated here; `trap-kill.test.ts`
 * fails if they drift from that package's vocabulary.
 *
 * ⚠️ The log never says whose device fired. A trap kill is credited from where the trap was
 * placed, so no string may say the placer killed the victim as a logged fact, or call it "their"
 * tripwire. "Credited" and "by trap" are the only words.
 */
import type { DeathVerdictDto } from "@onelife/api-client";

/** Beside a trap kill in a kill list or a life timeline: "VICTIM · Tripwire · by trap". */
export const TRAP_LIST_LABEL = "by trap";
/** Under a kill list that holds at least one trap kill. */
export const TRAP_LIST_FOOTNOTE = "By trap: credited from where the trap was placed. The log names no killer.";
/** The qualifying line of a life that a trap kill qualified (instead of "First blood drawn."). */
export const TRAP_QUALIFIED_LINE = "A trap kill credited. The life counts from here.";

/** The words before the credited name; a renderer links the name after them. */
export const CREDIT_PREFIX = "Kill credited to";

/** The suffix the server appends to a credited trap death's sentence. */
export function creditSuffix(gamertag: string): string {
  return `${CREDIT_PREFIX} ${gamertag}.`;
}

/**
 * A credited death's sentence without its "Kill credited to NAME." suffix, so a renderer can print
 * that part itself with the name linked. Anything that does not end in exactly that suffix is
 * returned as it is.
 */
export function creditSentenceBody(sentence: string, credit: DeathVerdictDto["credit"] | null | undefined): string {
  if (!credit) return sentence;
  const suffix = ` ${creditSuffix(credit.gamertag)}`;
  return sentence.endsWith(suffix) ? sentence.slice(0, -suffix.length) : sentence;
}
