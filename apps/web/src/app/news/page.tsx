import type { Metadata } from "next";
import { getNewsFeed } from "@/lib/api";
import { Kicker } from "@/components/tabloid/kicker";
import { NewsCard } from "@/components/news/news-card";
import { NewsPagination } from "@/components/news/news-pagination";
import { newsHref } from "@/lib/news-format";
import { absoluteUrl } from "@/lib/seo";
import { parsePage } from "@/lib/board-params";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// The static teaser is retired as of R5d PR-C3, so `robots: { index: false }` is GONE — the
// voice-first rule holds that a teaser stays up until its content-engine slice ships, and it has.
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const page = parsePage((await searchParams).page);
  const title = page > 1 ? `News · Page ${page}` : "News";
  const description = "Features from the One Life desk — the survivors who stopped, and the ones who ended together.";
  const canonical = absoluteUrl(newsHref(page));
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

export default async function NewsPage({ searchParams }: Props) {
  const page = parsePage((await searchParams).page);
  const feed = await getNewsFeed(page);
  const now = new Date();

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10">
      <div className="border-b-[3px] border-ink pb-4">
        <Kicker color="ink">The Desk</Kicker>
        <h1 className="mt-2 font-display text-5xl font-bold uppercase leading-[.95] text-ink md:text-6xl">News</h1>
      </div>

      {feed.rows.length === 0 ? (
        <p className="py-16 font-mono text-sm uppercase tracking-[.05em] text-ink-muted">
          Nothing filed this week. The desk does not pad — a slow week gets a shorter paper.
        </p>
      ) : (
        <>
          {feed.rows.map((card) => (
            <NewsCard key={card.slug} card={card} now={now} />
          ))}
          <NewsPagination page={feed.page} total={feed.total} pageSize={feed.pageSize} />
        </>
      )}
    </main>
  );
}
