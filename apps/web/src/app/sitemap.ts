import type { MetadataRoute } from "next";
import { getServersCached, getSitemapData } from "@/lib/api";
import { absoluteUrl, SITE_URL } from "@/lib/seo";
import { playerSlug } from "@/lib/slug";
import { boardHref } from "@/components/survivors/links";

/**
 * Rendered per request; the hourly window lives on the FETCH (`apiGetCached`'s
 * `next: { revalidate }`), not on the route.
 *
 * ⚠️ Do not "restore" `export const revalidate` here. Statically generating this route makes
 * `next build` fetch the API at build time — and the build does not run alongside a serving API,
 * so the fetch times out and **the build fails** (verified: three 60s attempts, then
 * `Export encountered an error on /sitemap.xml/route`). Adding a fetch timeout only converts that
 * into a worse failure: the sitemap gets baked with the static + board entries alone and ISR
 * serves that gutted version — missing every player and life URL — until it revalidates.
 * Per-request rendering costs nothing here (~476 URLs, three indexed queries) and cannot bake a
 * bad snapshot.
 */
export const dynamic = "force-dynamic";

/** Static pages carry no `lastmod` — they change constantly or not at all, and a fabricated
 *  value trains crawlers to ignore the field. */
const STATIC_PATHS = ["/", "/about"];

/**
 * `new Date(garbage)` yields an Invalid Date, and Next's sitemap serializer calls
 * `.toISOString()` on `lastModified`, which throws `RangeError: Invalid time value` — that
 * would 500 the whole route from a single bad timestamp, defeating the try/catch degradation
 * around the fetches (they guard the fetch, not the parse). Omit `lastModified` entirely rather
 * than throw; the URL itself is still worth keeping.
 */
function toLastModified(raw: string): { lastModified: Date } | Record<string, never> {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? {} : { lastModified: d };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.map((p) => ({
    url: p === "/" ? SITE_URL : absoluteUrl(p),
  }));

  // Boards: one per slugged server. ⚠️ NOT the bare `/survivors`, which is a per-viewer REDIRECT
  // and must never be advertised — the sitemap may only carry URLs that resolve directly. The
  // sort paths and the combined board are gone entirely (sub-project D).
  try {
    const servers = await getServersCached();
    for (const s of servers) {
      if (s.slug !== null) entries.push({ url: absoluteUrl(boardHref(s.slug, 1)) });
    }
  } catch {
    // A partial sitemap beats no sitemap: an API blip must never look like a site with no pages.
  }

  // NOTE on <loc> safety: Next's sitemap serializer interpolates `url` into `<loc>` WITHOUT
  // XML-escaping it. A URL containing a raw `&` or `<` would emit a byte that breaks the XML
  // parse for the ENTIRE sitemap, not just this one entry. Unreachable today — `playerSlug` and
  // hand-set `servers.slug` both produce `[a-z0-9-]+` — but if
  // a future slug/segment source can emit arbitrary characters, escape or reject it before it
  // reaches `absoluteUrl(...)` here.
  try {
    const data = await getSitemapData();
    for (const p of data.players) {
      entries.push({
        url: absoluteUrl(`/players/${playerSlug(p.gamertag)}`),
        ...toLastModified(p.lastmod),
      });
    }
    for (const l of data.lives) {
      entries.push({
        url: absoluteUrl(`/players/${playerSlug(l.gamertag)}/${l.mapSlug}/lives/${l.n}`),
        ...toLastModified(l.lastmod),
      });
    }
  } catch {
    // Same reasoning as above.
  }

  return entries;
}
