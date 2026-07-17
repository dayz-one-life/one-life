import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getObituary, getObituariesFeed, getPlayerLife } from "@/lib/api";
import { buildTimeline, type LifeTimelineView } from "@/lib/life-timeline";
import { ObituaryArticleView } from "@/components/obituaries/obituary-article";
import { articleLd, absoluteUrl, ldScript } from "@/lib/seo";
import { obituaryHref } from "@/lib/obituary-format";
import { playerSlug } from "@/lib/slug";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const a = await getObituary(slug).catch(() => null);
  if (!a) return { title: "Obituary — One Life" };
  const title = `${a.headline} — ${a.gamertag} — One Life`;
  return {
    title,
    description: a.lede,
    alternates: { canonical: absoluteUrl(obituaryHref(slug)) },
    openGraph: { title, description: a.lede, url: absoluteUrl(obituaryHref(slug)), type: "article" },
    twitter: { card: "summary_large_image", title, description: a.lede },
  };
}

async function loadFinalReload(a: { gamertag: string; mapSlug: string | null; lifeNumber: number }, now: Date): Promise<LifeTimelineView | null> {
  if (!a.mapSlug) return null; // un-slugged server: omit the Final Reload gracefully
  const life = await getPlayerLife(playerSlug(a.gamertag), a.mapSlug, a.lifeNumber).catch(() => null);
  return life ? buildTimeline(life, now) : null;
}

export default async function ObituaryPage({ params }: Props) {
  const { slug } = await params;
  const article = await getObituary(slug);
  if (!article) notFound();
  const now = new Date();
  const [finalReload, feed] = await Promise.all([
    loadFinalReload(article, now),
    getObituariesFeed(1).catch(() => ({ rows: [], total: 0, page: 1, pageSize: 20 })),
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
