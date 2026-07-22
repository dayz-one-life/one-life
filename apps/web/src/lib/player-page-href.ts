import { playerSlug } from "./slug";

/**
 * Pure href builder for `/players/[slug]` — the page carries TWO independent paginations
 * (`page` for past lives, `ap` for In The Paper) that must never move together. A link that
 * changes one param must preserve whatever the other one currently is. A value of `1` (or
 * omitted) is dropped from the URL entirely, matching how `page=1` was already omitted before
 * this second param existed.
 */
export function playerPageHref(slug: string, params: { page?: number; ap?: number }): string {
  const sp = new URLSearchParams();
  if (params.page && params.page > 1) sp.set("page", String(params.page));
  if (params.ap && params.ap > 1) sp.set("ap", String(params.ap));
  const qs = sp.toString();
  return `/players/${slug}${qs ? `?${qs}` : ""}`;
}

/**
 * True when the URL's slug does not name the player's CURRENT gamertag — i.e. it came from a
 * former name and the page should permanently redirect. Casing is not a difference: playerSlug
 * lower-cases, so /players/TDS-Maverick12 is already canonical.
 */
export function shouldRedirectSlug(currentSlug: string, canonicalGamertag: string): boolean {
  return playerSlug(currentSlug) !== playerSlug(canonicalGamertag);
}
