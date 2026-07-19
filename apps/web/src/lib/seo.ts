import type { PlayerAggregate } from "./types";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://dayzonelife.com").replace(/\/$/, "");
export const absoluteUrl = (path: string) => `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;

/**
 * Serialize a JSON-LD object for embedding in a `<script type="application/ld+json">` tag.
 * `JSON.stringify` alone does NOT escape `<`, so a value containing `</script>` (e.g. an
 * LLM-authored obituary headline) could break out of the script element. Escaping `<`, `>`,
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

export function birthNoticeLd(
  a: { headline: string; lede: string; gamertag: string; bornAt: string },
  url: string,
) {
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: a.headline,
    description: a.lede,
    url,
    datePublished: a.bornAt,
    about: { "@type": "Person", name: a.gamertag },
    isPartOf: { "@type": "CollectionPage", name: "Fresh Spawns", url: absoluteUrl("/fresh-spawns") },
  };
}

/** The news feature's JSON-LD. `datePublished` is created_at: a Standing Dead feature has no
 *  death and its subject is alive, so there is no other honest date. `about` lists EVERY subject —
 *  a Long Form piece is about a shared ending, not about its primary. Must be emitted through
 *  ldScript(), like every other JSON-LD sink here.
 *
 *  A RETRACTED feature is QUALIFIED, never emitted bare. The interior is noindexed, but the block
 *  is still read by anything that parses the page directly, and an unqualified `NewsArticle` there
 *  asserts a headline the desk has withdrawn. `creativeWorkStatus` is schema.org's term for it. */
export function newsLd(
  a: {
    headline: string; lede: string; createdAt: string;
    subjects: { gamertag: string }[]; imageUrl: string | null; retracted: boolean;
  },
  url: string,
) {
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: a.headline,
    description: a.lede,
    url,
    datePublished: a.createdAt,
    ...(a.retracted ? { creativeWorkStatus: "Retracted" } : {}),
    // A retracted feature's hero bytes 404 behind the media route's published-only filter, so a
    // retracted piece never advertises an image it cannot serve.
    ...(a.imageUrl && !a.retracted ? { image: absoluteUrl(a.imageUrl) } : {}),
    about: a.subjects.map((s) => ({ "@type": "Person", name: s.gamertag })),
    isPartOf: { "@type": "CollectionPage", name: "News", url: absoluteUrl("/news") },
  };
}
