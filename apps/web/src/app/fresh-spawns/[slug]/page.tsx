import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBirthNotice, getBirthNoticesFeed } from "@/lib/api";
import { BirthNoticeArticleView } from "@/components/birth-notices/birth-notice-article";
import { birthNoticeLd, absoluteUrl, ldScript } from "@/lib/seo";
import { birthNoticeHref } from "@/lib/birth-format";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const a = await getBirthNotice(slug).catch(() => null);
  if (!a) return { title: "Birth Notice — One Life" };
  const title = `${a.headline} — ${a.gamertag} — One Life`;
  return {
    title,
    description: a.lede,
    alternates: { canonical: absoluteUrl(birthNoticeHref(slug)) },
    openGraph: { title, description: a.lede, url: absoluteUrl(birthNoticeHref(slug)), type: "article" },
    twitter: { card: "summary_large_image", title, description: a.lede },
  };
}

export default async function BirthNoticePage({ params }: Props) {
  const { slug } = await params;
  const article = await getBirthNotice(slug);
  if (!article) notFound();
  const now = new Date();
  const feed = await getBirthNoticesFeed(1).catch(() => ({ rows: [], total: 0, page: 1, pageSize: 20 }));
  const more = feed.rows.filter((r) => r.slug !== article.slug).slice(0, 4);
  const ldImage = article.imageUrl ? absoluteUrl(article.imageUrl) : undefined;
  const ld = birthNoticeLd(article, absoluteUrl(birthNoticeHref(slug)), ldImage);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldScript(ld) }} />
      <BirthNoticeArticleView article={article} more={more} now={now} />
    </>
  );
}
