import { mapLabel } from "@/components/player/format";

/**
 * ONE resolution rule, shared by `/maps` and `/survivors`.
 *
 *     last map viewed THIS SESSION  →  last map PLAYED  →  alphabetical by display label
 *
 * Both bare paths resolve through this, so a player who opens one and then the other lands on the
 * same map. Before sub-project D they disagreed: `/maps` read a year-long cookie with a hardcoded
 * `chernarusplus` default, and `/survivors` had no notion of "where am I" at all (it opened a
 * combined board across every server).
 */

/**
 * ⚠️ Every cookie this app sets is enumerated in `apps/web/src/content/legal/privacy.tsx` §8
 * (Cookies). Adding another cookie here without updating that page makes the published privacy
 * policy false.
 */

/**
 * ⚠️ A SESSION cookie — no `max-age`, so it dies with the browser session. The retired
 * `ol_last_map` lived a year, which is the wrong memory for "where was I?": it let a map you
 * opened once last spring outrank the one you have been playing all week. A session is exactly
 * the window in which the question is meaningful.
 */
export const SESSION_MAP_COOKIE = "ol_map_session";

export type SluggedServer = { map: string; slug: string | null };

/**
 * ⚠️ Tier 3 sorts by DISPLAY LABEL, never by slug or mission codename.
 *
 * `enoch` is labelled "Livonia" and therefore sorts under L, not E. Sorting by codename would put
 * Livonia first on any fleet without a Chernarus, which is not what "alphabetical" means to anyone
 * reading the page. This is also why the old `DEFAULT_MAP_CODENAME = "chernarusplus"` is retired:
 * with today's three servers it happens to come first anyway, so the hardcode bought nothing and
 * cost a silent wrong answer the day the fleet changes.
 */
export function alphabeticalMapSlug(servers: readonly SluggedServer[]): string | null {
  const usable = servers.filter((s): s is SluggedServer & { slug: string } => Boolean(s.slug));
  if (usable.length === 0) return null;
  return [...usable].sort((a, b) => mapLabel(a.map).localeCompare(mapLabel(b.map)))[0]!.slug;
}

/**
 * Resolve the map a bare `/maps` or `/survivors` should send this viewer to.
 *
 * ⚠️ Neither remembered value is trusted without the live list to check it against. `GET /servers`
 * returns ACTIVE servers only, so a slug that has since been retired or re-slugged falls through
 * to the next tier rather than redirecting someone to a 404. This applies to `lastPlayed` too,
 * even though `getLastPlayedMapSlug` already inner-joins an active slugged server — two
 * independent checks of "is this server still real?" are cheap, and the alternative is a rule
 * whose correctness depends on a guarantee made in another package.
 *
 * Returns `null` only when there is no slugged server at all. The caller renders an honest
 * failure; it must NOT guess a path.
 */
export function resolveMapDestination(
  servers: readonly SluggedServer[],
  memory: { session: string | null; lastPlayed: string | null },
): string | null {
  const slugs = new Set(
    servers.filter((s) => s.slug).map((s) => s.slug as string),
  );
  if (memory.session && slugs.has(memory.session)) return memory.session;
  if (memory.lastPlayed && slugs.has(memory.lastPlayed)) return memory.lastPlayed;
  return alphabeticalMapSlug(servers);
}

/**
 * Client-side: remember the map being viewed, for this browser session only.
 *
 * Not sensitive — which map you looked at, in your own browser, sent only to our origin — so it is
 * readable by JS (that is what writes it) and `lax` rather than `strict`, since arriving from an
 * external link should still be remembered.
 */
export function rememberMap(slug: string): void {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; secure" : "";
  // No `max-age`/`expires` ⇒ a session cookie. See the ⚠️ on SESSION_MAP_COOKIE.
  document.cookie = `${SESSION_MAP_COOKIE}=${encodeURIComponent(slug)}; path=/; samesite=lax${secure}`;
}
