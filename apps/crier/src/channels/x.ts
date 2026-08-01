import type { ObituaryPost } from "../post.js";

/** ⚠️ X counts EVERY url as 23 characters, whatever its actual length (t.co wrapping), so the
 *  budget is fixed and does not vary with the slug. 280 - 23 - 4 (two "\n\n") = 253 for the
 *  headline and lede together. */
const TEXT_BUDGET = 280 - 23 - 4;

/** Below this, a trimmed lede says nothing worth the characters — drop it and let the OG card
 *  carry the story rather than posting a headline followed by a near-bare ellipsis. */
const MIN_LEDE = 24;

/** Code points, not X's weighted count (which charges 2 for CJK and emoji). The copy is English
 *  and the budget carries margin — a deliberate simplification, not an oversight. */
const len = (s: string): number => Array.from(s).length;
const cut = (s: string, n: number): string => Array.from(s).slice(0, n).join("");

/** Trim to `budget` code points INCLUDING the ellipsis, cutting at the last whole word. */
function trimToWord(s: string, budget: number): string {
  const slice = cut(s, budget - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const body = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${body.replace(/[\s,;:.!?-]+$/u, "")}…`;
}

/** Unlike Facebook — where the url rides in a separate `link` field and length never binds —
 *  on X the url must be in the post text, so the body has to be made to fit 280. */
export function buildXText(post: ObituaryPost): string {
  const join = (...parts: string[]): string => parts.join("\n\n");
  if (len(post.headline) > TEXT_BUDGET) return join(trimToWord(post.headline, TEXT_BUDGET), post.url);

  const ledeBudget = TEXT_BUDGET - len(post.headline);
  if (len(post.lede) <= ledeBudget) return join(post.headline, post.lede, post.url);
  if (ledeBudget < MIN_LEDE) return join(post.headline, post.url);
  return join(post.headline, trimToWord(post.lede, ledeBudget), post.url);
}
