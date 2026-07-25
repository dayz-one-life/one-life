/**
 * Pure href builder for the survivors board — the single source of board URLs, so the tabs,
 * pagination, canonical/OG/JSON-LD and the sitemap can never disagree.
 *
 * - `/survivors/<slug>`, always slugged: there is no combined board (sub-project D).
 * - `?page` only when > 1, so page 1 has exactly one URL.
 *
 * ⚠️ The sitemap must never advertise a URL that 404s or redirects, which is why it builds board
 * URLs through here rather than assembling strings. Hand-building used to risk emitting
 * `/survivors/time`, a redirect; that path no longer exists at all.
 */
export function boardHref(slug: string, page: number): string {
  return page > 1 ? `/survivors/${slug}?page=${page}` : `/survivors/${slug}`;
}
