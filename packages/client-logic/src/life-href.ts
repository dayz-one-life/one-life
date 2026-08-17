// `playerSlug` is duplicated from `apps/web/src/lib/slug.ts` rather than imported: packages
// cannot depend back on the app, and this package must not depend on apps/web at all.
function playerSlug(gamertag: string): string {
  return gamertag
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Pure href builder for a single life's timeline page, from an ALREADY-slugified callsign.
 *  The controls rail and sheet hold `ownSlug`, not the raw gamertag — this is their entry point. */
export function lifeHrefBySlug(playerSlugValue: string, mapSlug: string, lifeNumber: number): string {
  return `/players/${playerSlugValue}/${encodeURIComponent(mapSlug)}/lives/${lifeNumber}`;
}

/** Pure href builder for a single life's timeline page, from a raw gamertag. */
export function lifeHref(gamertag: string, mapSlug: string, lifeNumber: number): string {
  return lifeHrefBySlug(playerSlug(gamertag), mapSlug, lifeNumber);
}
