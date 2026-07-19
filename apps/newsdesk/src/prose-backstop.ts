import type { RecentProse } from "./prose-pg-store.js";

/** Deterministic last line of defence behind the prompt block: if the model handed back an
 *  attribution the desk has already printed recently, the quote loses its byline rather than
 *  re-seeding the phrase. A null pullQuote is a valid, schema-legal outcome — the article still
 *  publishes. Generic over Obituary | BirthNotice (identical shapes). */
export function dedupePullQuote<T extends { pullQuote: { text: string; attribution: string } | null }>(
  article: T,
  recent: RecentProse[],
): T {
  const attribution = article.pullQuote?.attribution?.trim().toLowerCase();
  if (!attribution) return article;
  const used = new Set(
    recent.map((r) => (r.attribution ?? "").trim().toLowerCase()).filter(Boolean),
  );
  return used.has(attribution) ? { ...article, pullQuote: null } : article;
}
