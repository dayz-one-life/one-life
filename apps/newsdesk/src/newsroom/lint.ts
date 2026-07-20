/**
 * Brand bible §9, BAN Tier 1 — vendored VERBATIM. Source of truth: ../brand/brand-bible.md.
 * Change the brand repo first, then re-vendor (the IMAGE_STYLE rule).
 *
 * TIER 2 IS DELIBERATELY ABSENT. Punching down and the Fog Rule are judgment calls; a lint that
 * claims to check ethics manufactures false confidence. The session ritual and the human review
 * gate own Tier 2.
 */
const BANNED: { pattern: RegExp; why: string }[] = [
  { pattern: /\brip\b|gone too soon|rest in peace|taken from us|in a better place/i,
    why: "sincere grief cliché (§9 Tier 1) — the paper mourns in deadpan" },
  { pattern: /just a game|\bjk\b|\blol\b|obviously we'?re kidding/i,
    why: "wink/meta phrase (§9 Tier 1) — never explain or apologise for the joke" },
  { pattern: /\busers\b|\bengagement\b|content pipeline|our data shows|\bleverage\b|\butilize\b/i,
    why: "corporate/data-speak (§9 Tier 1)" },
  { pattern: /\bbased\b|poggers|\bgg ez\b|\brekt\b/i, why: "dated meme slang (§9 Tier 1)" },
  { pattern: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, why: "emoji (§9 Tier 1)" },
  { pattern: /!/, why: "exclamation point — loudness lives in the layout, never the prose (§6.1)" },
  { pattern: /\b[A-Z]{4,}\b/, why: "ALL-CAPS in prose (§9 Tier 1)" },
];

/** Each hit names the matched phrase, not just the rule — the author must be able to find and fix
 *  the exact words without re-deriving which of several alternates in a pattern fired. */
export function lintProse(text: string): string[] {
  return BANNED.flatMap((b) => {
    const m = b.pattern.exec(text);
    return m ? [`"${m[0]}" — ${b.why}`] : [];
  });
}
