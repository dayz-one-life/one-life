import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getObituaryCached, getObituariesFeedCached, getPlayerLifeCached } from "@/lib/api";
import { buildTimeline, type LifeTimelineView } from "@/lib/life-timeline";
import { ObituaryArticleView } from "@/components/obituaries/obituary-article";
import { articleLd, absoluteUrl, ldScript, OG_DEFAULTS } from "@/lib/seo";
import { obituaryHref } from "@/lib/obituary-format";
import { playerSlug } from "@/lib/slug";

type Props = { params: Promise<{ slug: string }> };

/**
 * ⚠️ This page exists to be unfurled by social crawlers, so it must be CACHEABLE. Every read here
 * goes through the cookie-free `*Cached` helpers for that reason — a single `apiGet` anywhere in
 * this file (or in `generateMetadata`) awaits `cookies()`, drops the route back to dynamic, and
 * Next emits `cache-control: private, no-cache, no-store`. That is how this page shipped, and it
 * made every scrape a cold origin render; Facebook's crawler intermittently timed out and
 * published posts with a blank card.
 *
 * The `[slug]` segment means `next build` does NOT prerender this (no `generateStaticParams`), so
 * the sitemap/`opengraph-image` build-time trap — a route with no dynamic segment baking its
 * failure-path output into the build — does not apply here.
 *
 * Kept in sync BY HAND with `OBITUARY_REVALIDATE_SECONDS` in `@/lib/api` and with the sibling
 * `opengraph-image.tsx`; Next requires this to be a statically analysable literal, so it cannot
 * import the constant. The window is short because the page carries relative timestamps ("2 hours
 * ago") rendered against a server-side `now` that freezes at generation time — the obituary text
 * itself never changes.
 */
export const revalidate = 300;

/**
 * ⚠️ THIS EMPTY LIST IS THE WHOLE FIX — do not delete it as dead code. `export const revalidate`
 * alone does NOT make a `[slug]` route cacheable: without `generateStaticParams`, Next treats a
 * dynamic segment as fully dynamic and serves
 * `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`, which no CDN may
 * store. Declaring it — even empty — marks the route static-capable, so unknown slugs are
 * generated on demand and then cached (`s-maxage=300, stale-while-revalidate`, `x-nextjs-cache:
 * MISS` then `HIT`). Verified against `next build` + `next start`, not inferred.
 *
 * It returns `[]` deliberately: prerendering real slugs at build would fetch the API during
 * `next build`, which is the exact hang that `sitemap.ts` and `apiGetCached`'s timeout document.
 * Nothing is built ahead of time; the first visitor (usually a crawler) warms each slug.
 *
 * `dynamicParams` is left at its default `true` — an explicit `false` would 404 every obituary,
 * since this list is empty.
 */
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const a = await getObituaryCached(slug).catch(() => null);
  if (!a) return { title: { absolute: "Obituary — One Life" } };
  const title = `${a.headline} — ${a.gamertag} — One Life`;
  return {
    title: { absolute: title },
    description: a.lede,
    alternates: { canonical: absoluteUrl(obituaryHref(slug)) },
    openGraph: { ...OG_DEFAULTS, title, description: a.lede, url: absoluteUrl(obituaryHref(slug)), type: "article", publishedTime: a.deathAt },
    twitter: { card: "summary_large_image", title, description: a.lede },
  };
}

async function loadFinalReload(a: { gamertag: string; mapSlug: string | null; lifeNumber: number }, now: Date): Promise<LifeTimelineView | null> {
  if (!a.mapSlug) return null; // un-slugged server: omit the Final Reload gracefully
  const life = await getPlayerLifeCached(playerSlug(a.gamertag), a.mapSlug, a.lifeNumber).catch(() => null);
  return life ? buildTimeline(life, now) : null;
}

export default async function ObituaryPage({ params }: Props) {
  const { slug } = await params;
  const article = await getObituaryCached(slug);
  if (!article) notFound();
  const now = new Date();
  const [finalReload, feed] = await Promise.all([
    loadFinalReload(article, now),
    getObituariesFeedCached(1).catch(() => ({ rows: [], total: 0, page: 1, pageSize: 20 })),
  ]);
  const more = feed.rows.filter((r) => r.slug !== article.slug).slice(0, 4);
  const ld = articleLd(article, absoluteUrl(obituaryHref(slug)));

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldScript(ld) }} />
      <ObituaryArticleView article={article} more={more} finalReload={finalReload} now={now} />
    </>
  );
}
