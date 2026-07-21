import type { MetadataRoute } from "next";
import { getServersCached, getSitemapData } from "@/lib/api";
import { absoluteUrl, SITE_URL } from "@/lib/seo";
import { playerSlug } from "@/lib/slug";
import { boardHref } from "@/components/survivors/links";
import { SORTS } from "@/lib/board-params";

/** One enumeration query per hour regardless of crawler traffic; a new obituary appears within
 *  the hour. Crawlers re-fetch sitemaps far less often than that. */
export const revalidate = 3600;

/** Static pages carry no `lastmod` — they change constantly or not at all, and a fabricated
 *  value trains crawlers to ignore the field. */
const STATIC_PATHS = ["/", "/about", "/obituaries", "/fresh-spawns", "/news"];

const ARTICLE_PATHS: Record<string, string> = {
  obituary: "/obituaries",
  birth_notice: "/fresh-spawns",
  news: "/news",
};

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

  // Boards. `boardHref` collapses the default sort to the bare path, so mapping every SORT through
  // it yields the canonical set and never `/survivors/time`, which redirects.
  try {
    const servers = await getServersCached();
    const slugs: (string | null)[] = [
      null,
      ...servers.filter((s) => s.slug !== null).map((s) => s.slug as string),
    ];
    for (const slug of slugs) {
      for (const sort of SORTS) entries.push({ url: absoluteUrl(boardHref(slug, sort, 1)) });
    }
  } catch {
    // A partial sitemap beats no sitemap: an API blip must never look like a site with no pages.
  }

  // NOTE on <loc> safety: Next's sitemap serializer interpolates `url` into `<loc>` WITHOUT
  // XML-escaping it. A URL containing a raw `&` or `<` would emit a byte that breaks the XML
  // parse for the ENTIRE sitemap, not just this one entry. Unreachable today — `playerSlug`,
  // every article-slug generator, and hand-set `servers.slug` all produce `[a-z0-9-]+` — but if
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
    for (const a of data.articles) {
      const base = ARTICLE_PATHS[a.kind];
      if (!base) continue; // an unknown kind has no interior route — never guess one
      entries.push({ url: absoluteUrl(`${base}/${a.slug}`), ...toLastModified(a.lastmod) });
    }
  } catch {
    // Same reasoning as above.
  }

  return entries;
}
