import { dedupeRoster } from "@/lib/linkify-gamertags";

/**
 * The gamertags an article is allowed to linkify — always ITS OWN subjects, drawn from fields
 * already on the DTO. There is no `article_subjects` table (PR-2 research killed it) and there is
 * deliberately no global-roster fallback: matching frozen prose against every gamertag on the
 * server produces false positives on short or common names.
 */
export function obituaryRoster(a: { gamertag: string; killerGamertag: string | null }): string[] {
  return dedupeRoster([a.gamertag, a.killerGamertag]);
}

export function birthNoticeRoster(a: { gamertag: string }): string[] {
  return dedupeRoster([a.gamertag]);
}

export function newsRoster(a: {
  gamertag: string | null;
  subjects: { gamertag: string; mapSlug: string | null; lifeNumber: number }[];
}): string[] {
  return dedupeRoster([a.gamertag, ...a.subjects.map((s) => s.gamertag)]);
}
