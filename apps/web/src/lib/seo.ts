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
 * The site-wide share card rendered by `app/opengraph-image.tsx`, restated as explicit metadata.
 *
 * ⚠️ Next.js attaches a file-convention `opengraph-image` ONLY to routes that do not declare
 * their own `openGraph` block — declaring one replaces the whole object, images included, and
 * the file image is never merged back in. So a page with an `openGraph` block and no colocated
 * `opengraph-image.tsx` unfurls with NO card at all. That shipped in v0.73.0: home, `/about`,
 * `/terms` and `/privacy` were all imageless in production while every content page had a card.
 * Those pages must name this explicitly, in `twitter` as well as `openGraph` (the root layout
 * declares `twitter: { card: "summary_large_image" }` and nothing else, so twitter images do not
 * come along for free either).
 *
 * ⚠️ Do NOT fold this into `OG_DEFAULTS`. Every page spreads those defaults — including the
 * obituary, player, life and survivors-board pages, which render their OWN colocated card — and
 * an explicit `images` key overrides the file convention, replacing each bespoke card with this
 * generic one. `alt` is kept in step with the `alt` export in `app/opengraph-image.tsx` by hand;
 * importing it here would drag `next/og` into every page's metadata module.
 */
export const SITE_CARD_IMAGES = [
  { url: absoluteUrl("/opengraph-image"), width: 1200, height: 630, alt: "One Life — hardcore permadeath DayZ" },
];

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

