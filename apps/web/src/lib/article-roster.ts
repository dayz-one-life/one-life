import { dedupeRoster } from "@/lib/linkify-gamertags";

/**
 * The gamertags an article is allowed to linkify — always ITS OWN subjects, drawn from fields
 * already on the DTO. There is no `article_subjects` table (PR-2 research killed it) and there is
 * deliberately no global-roster fallback: matching frozen prose against every gamertag on the
 * server produces false positives on short or common names.
 */
/**
 * A gamertag shorter than this is never linkified. Xbox allows 3-character callsigns, so a player
 * named Fox, Ash, Doc or Ace would otherwise put a link on every ordinary occurrence of that word
 * in their own obituary — every occurrence, since §6.3 links them all. The per-article roster
 * bounds WHO can be linked but not WHAT the word means, and this is the cheap half of that.
 * A short-named player is still reachable from the byline, In The Paper, and the boards.
 */
export const MIN_LINKIFY_LENGTH = 4;

const roster = (names: (string | null | undefined)[]): string[] =>
  dedupeRoster(names).filter((n) => n.length >= MIN_LINKIFY_LENGTH);

export function obituaryRoster(a: { gamertag: string; killerGamertag: string | null }): string[] {
  return roster([a.gamertag, a.killerGamertag]);
}

export function birthNoticeRoster(a: { gamertag: string }): string[] {
  return roster([a.gamertag]);
}

export function newsRoster(a: {
  gamertag: string | null;
  subjects: { gamertag: string; mapSlug: string | null; lifeNumber: number }[];
}): string[] {
  return roster([a.gamertag, ...a.subjects.map((s) => s.gamertag)]);
}
