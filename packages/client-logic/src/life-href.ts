import { playerSlug } from "./slug";

/** Pure href builder for a single life's timeline page, from an ALREADY-slugified callsign.
 *  The controls rail and sheet hold `ownSlug`, not the raw gamertag — this is their entry point. */
export function lifeHrefBySlug(playerSlugValue: string, mapSlug: string, lifeNumber: number): string {
  return `/players/${playerSlugValue}/${encodeURIComponent(mapSlug)}/lives/${lifeNumber}`;
}

/** Pure href builder for a single life's timeline page, from a raw gamertag. */
export function lifeHref(gamertag: string, mapSlug: string, lifeNumber: number): string {
  return lifeHrefBySlug(playerSlug(gamertag), mapSlug, lifeNumber);
}
