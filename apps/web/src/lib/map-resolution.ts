import { SESSION_MAP_COOKIE } from "@onelife/client-logic/map-resolution";

export * from "@onelife/client-logic/map-resolution";

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
