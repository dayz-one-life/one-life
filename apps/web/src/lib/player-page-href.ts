import { playerSlug } from "./slug";

/**
 * Pure href builder for `/players/[slug]` — a value of `1` (or omitted) is dropped from the URL
 * entirely, so canonical URLs stay stable.
 */
export function playerPageHref(slug: string, page?: number): string {
  const qs = page && page > 1 ? `?page=${page}` : "";
  return `/players/${slug}${qs}`;
}

/**
 * True when the URL's slug does not name the player's CURRENT gamertag — i.e. it came from a
 * former name and the page should permanently redirect. Casing is not a difference: playerSlug
 * lower-cases, so /players/TDS-Maverick12 is already canonical.
 */
export function shouldRedirectSlug(currentSlug: string, canonicalGamertag: string): boolean {
  return playerSlug(currentSlug) !== playerSlug(canonicalGamertag);
}
