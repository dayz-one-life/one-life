/**
 * Which map `/maps` sends you to.
 *
 * The nav item is a static `/maps` link; the route resolves a real `servers.slug` and redirects.
 * The "last opened" memory is therefore a COOKIE, not localStorage: the resolution happens on
 * the server, and localStorage would mean shipping a page that renders and then bounces.
 */
export const LAST_MAP_COOKIE = "ol_last_map";

/** The fallback map for a visitor who has never opened one. A mission codename, NOT a slug —
 *  slugs are hand-set per server row, so the default has to be resolved against the live list
 *  rather than hardcoded as a path. */
export const DEFAULT_MAP_CODENAME = "chernarusplus";

export type SluggedServer = { map: string; slug: string | null };

/**
 * ⚠️ A remembered slug is honoured only if it is still in the list. `GET /servers` returns
 * active servers only, so a server that was deactivated (or re-slugged) since the visitor last
 * looked falls back to the default instead of redirecting them to a 404.
 *
 * Returns null only when there is no slugged server at all — see the caller for that path.
 */
export function resolveMapSlug(
  servers: readonly SluggedServer[],
  remembered: string | null,
): string | null {
  const usable = servers.filter((s): s is SluggedServer & { slug: string } => Boolean(s.slug));
  if (remembered && usable.some((s) => s.slug === remembered)) return remembered;
  return (
    usable.find((s) => s.map === DEFAULT_MAP_CODENAME)?.slug ?? usable[0]?.slug ?? null
  );
}

/** Client-side: remember the map being viewed. Not sensitive — which map you looked at, in your
 *  own browser, sent only to our origin — so it is readable by JS (that is what writes it) and
 *  `lax` rather than `strict`, since arriving from an external link should still be remembered. */
export function rememberMap(slug: string): void {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${LAST_MAP_COOKIE}=${encodeURIComponent(slug)}; path=/; max-age=31536000; samesite=lax${secure}`;
}
