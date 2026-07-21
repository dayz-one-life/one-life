import type { ReactNode } from "react";
import { GamertagLink } from "@/components/gamertag-link";

/** In-prose links need a non-hover affordance — colour alone fails WCAG 1.4.1. `red-deep` is the
 *  light-surface red; every article interior is paper, and it must never be used on a dark one. */
export const PROSE_LINK_CLASS = "text-red-deep underline decoration-dotted underline-offset-2";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `\w` is [A-Za-z0-9_]. A gamertag glued to one of these is a different token. */
const isWordChar = (c: string | undefined) => c !== undefined && /\w/.test(c);

/**
 * Trims, drops non-strings/empties, and dedupes a roster case-insensitively, PRESERVING INPUT
 * ORDER. Sorting is `linkifyGamertags`'s own concern (longest-first, for its alternation), not
 * this helper's — other callers need the roster's original order intact.
 */
export function dedupeRoster(names: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * Splits prose into plain strings and `/players/{slug}` links for the gamertags in `roster`.
 *
 * The roster is always the ARTICLE'S OWN subjects — never the global player list, whose failure
 * mode is a link on a word that is not a person.
 *
 * Boundaries are checked by inspecting the characters either side of the match rather than with
 * a lookbehind: Safari below 16.4 throws a syntax error when a lookbehind regex is CONSTRUCTED,
 * which would crash every article page rather than degrade.
 */
export function linkifyGamertags(text: string, roster: string[]): ReactNode[] {
  const names = dedupeRoster(roster)
    // Longest first: JS alternation is leftmost-FIRST, not leftmost-longest, so a short gamertag
    // listed earlier would otherwise shadow a longer one that contains it.
    .sort((a, b) => b.length - a.length);

  if (!text || names.length === 0) return [text];

  const re = new RegExp(names.map(escapeRe).join("|"), "gi");
  const out: ReactNode[] = [];
  let last = 0;

  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (isWordChar(text[start - 1]) || isWordChar(text[end])) continue;
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <GamertagLink key={`${start}-${m[0]}`} gamertag={m[0]} className={PROSE_LINK_CLASS} />,
    );
    last = end;
  }

  if (last === 0) return [text];
  if (last < text.length) out.push(text.slice(last));
  return out;
}
