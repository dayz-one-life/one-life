import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getNewsArticle, getNewsFeed, getPlayerLife } from "@/lib/api";
import { buildTimeline } from "@/lib/life-timeline";
import { NewsArticleView, NEWS_TIMELINE_LIMIT, type NewsTimeline } from "@/components/news/news-article";
import { EditorialArticleView } from "@/components/news/editorial-article";
import { newsLd, absoluteUrl, ldScript } from "@/lib/seo";
import { newsArticleHref } from "@/lib/news-format";
import { playerSlug } from "@/lib/slug";
import type { NewsArticle, NewsSubjectRef } from "@/lib/types";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ preview?: string }> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { preview } = await searchParams;
  const a = await getNewsArticle(slug, preview).catch(() => null);
  if (!a) return { title: "News — One Life" };
  const title = `${a.headline} — One Life`;
  const canonical = absoluteUrl(newsArticleHref(slug));
  return {
    title,
    description: a.lede,
    // A RETRACTED feature keeps its URL — a reader who followed a shared link deserves the
    // correction rather than a 404 — but it must leave the index. It is already absent from the
    // feed and from the related rail, both of which read the published-only feed query.
    // A draft is never indexable either — it exists at its real URL only behind the preview token.
    ...(a.status === "draft" || a.retracted ? { robots: { index: false, follow: false } } : {}),
    alternates: { canonical },
    openGraph: { title, description: a.lede, url: canonical, type: "article" },
    twitter: { card: "summary_large_image", title, description: a.lede },
  };
}

/**
 * Which records to embed. A Standing Dead piece has one subject — the article's own primary. A
 * Long Form piece embeds up to NEWS_TIMELINE_LIMIT subjects, in facts order (gamertag ascending),
 * fetched in parallel.
 *
 * Every ref guards on `mapSlug !== null` (an un-slugged server has no life-timeline URL) and every
 * fetch is individually caught, so one unavailable record degrades to the ones that loaded rather
 * than taking down the page — the same graceful degradation the obituary interior already does.
 */
async function loadTimelines(a: NewsArticle, now: Date): Promise<NewsTimeline[]> {
  const refs: NewsSubjectRef[] = a.trigger === "long_form"
    ? a.subjects.slice(0, NEWS_TIMELINE_LIMIT)
    : a.gamertag && a.lifeNumber != null
      ? [{ gamertag: a.gamertag, mapSlug: a.mapSlug, lifeNumber: a.lifeNumber }]
      : [];

  const loaded = await Promise.all(refs.map(async (r) => {
    if (!r.mapSlug) return null;
    const life = await getPlayerLife(playerSlug(r.gamertag), r.mapSlug, r.lifeNumber).catch(() => null);
    return life ? { gamertag: r.gamertag, view: buildTimeline(life, now) } : null;
  }));

  return loaded.filter((t): t is NewsTimeline => t !== null);
}

export default async function NewsArticlePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { preview } = await searchParams;
  const article = await getNewsArticle(slug, preview);
  if (!article) notFound();
  const now = new Date();

  const feed = await getNewsFeed(1).catch(() => ({ rows: [], total: 0, page: 1, pageSize: 20 }));
  // The feed is published-only, so a retracted feature can never be recommended here.
  const more = feed.rows.filter((r) => r.slug !== article.slug).slice(0, 4);

  const ld = newsLd(article, absoluteUrl(newsArticleHref(slug)));

  if (article.format === "editorial") {
    return (
      <>
        {/* ldScript(), never raw JSON.stringify: an LLM-authored headline can contain </script>. */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldScript(ld) }} />
        <EditorialArticleView article={article} more={more} now={now} />
      </>
    );
  }

  const timelines = await loadTimelines(article, now);
  return (
    <>
      {/* ldScript(), never raw JSON.stringify: an LLM-authored headline can contain </script>. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldScript(ld) }} />
      <NewsArticleView article={article} more={more} timelines={timelines} now={now} />
    </>
  );
}
