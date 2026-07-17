import { playerSlug } from "./slug";

/** Pure href builder for a single life's timeline page. */
export function lifeHref(gamertag: string, mapSlug: string, lifeNumber: number): string {
  return `/players/${playerSlug(gamertag)}/${encodeURIComponent(mapSlug)}/lives/${lifeNumber}`;
}
