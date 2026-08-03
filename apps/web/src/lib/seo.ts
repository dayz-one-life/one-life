import type { PlayerAggregate } from "./types";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://dayzonelife.com").replace(/\/$/, "");
export const absoluteUrl = (path: string) => `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;

export const SITE_DESCRIPTION =
  "One Life is a hardcore permadeath DayZ community — one life per server, a 24-hour ban when it ends, and a record that stands forever.";

/**
 * ⚠️ Spread into EVERY page-level `openGraph` block. Next.js replaces — does not deep-merge —
 * nested metadata objects, so a page that defines `openGraph` at all wipes the root layout's
 * `siteName`/`locale` and must restate them.
 */
export const OG_DEFAULTS = { siteName: "One Life", locale: "en_US" } as const;

/**
 * Serialize a JSON-LD object for embedding in a `<script type="application/ld+json">` tag.
 * `JSON.stringify` alone does NOT escape `<`, so a value containing `</script>` (e.g. an
 * player-supplied gamertag) could break out of the script element. Escaping `<`, `>`,
 * and `&` to their `\uXXXX` forms keeps the payload inert while staying valid JSON. Use this
 * for every JSON-LD sink — never raw `JSON.stringify` in `dangerouslySetInnerHTML`.
 */
export function ldScript(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

export function profileLd(agg: Pick<PlayerAggregate, "gamertag">, url: string) {
  return {
    "@context": "https://schema.org", "@type": "ProfilePage",
    mainEntity: { "@type": "Person", name: agg.gamertag }, url,
  };
}

export function breadcrumbLd(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: absoluteUrl(it.url) })),
  };
}

export function articleLd(
  a: { headline: string; lede: string; gamertag: string; deathAt: string },
  url: string,
) {
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: a.headline,
    description: a.lede,
    url,
    datePublished: a.deathAt,
    about: { "@type": "Person", name: a.gamertag },
    isPartOf: { "@type": "CollectionPage", name: "Obituaries", url: absoluteUrl("/obituaries") },
  };
}

