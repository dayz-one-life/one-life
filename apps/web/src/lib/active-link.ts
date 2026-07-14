import type { GamertagLink } from "./types";

/**
 * The user's single active gamertag link (status pending|verified), or null when none.
 * One-active-link is enforced by the API + DB; this returns the first active link found.
 */
export function activeLink(links: GamertagLink[] | undefined): GamertagLink | null {
  return links?.find((l) => l.status === "pending" || l.status === "verified") ?? null;
}
