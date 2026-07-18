import type { Metadata } from "next";
import { getBirthNoticesFeed } from "@/lib/api";
import { Kicker } from "@/components/tabloid/kicker";
import { BirthNoticeCard } from "@/components/birth-notices/birth-notice-card";
import { BirthNoticesPagination } from "@/components/birth-notices/birth-notices-pagination";
import { freshSpawnsHref } from "@/lib/birth-format";
import { absoluteUrl } from "@/lib/seo";
import { parsePage } from "@/lib/board-params";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const page = parsePage((await searchParams).page);
  const title = page > 1 ? `Fresh Spawns · Page ${page}` : "Fresh Spawns";
  const description = "The newest fools to wash ashore in One Life — a birth notice from the nursery desk for every qualified life.";
  const canonical = absoluteUrl(freshSpawnsHref(page));
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

export default async function FreshSpawnsPage({ searchParams }: Props) {
  const page = parsePage((await searchParams).page);
  const feed = await getBirthNoticesFeed(page);
  const now = new Date();

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10">
      <div className="border-b-[3px] border-ink pb-4">
        <Kicker color="blue">The Nursery</Kicker>
        <h1 className="mt-2 font-display text-5xl font-bold uppercase leading-[.95] text-ink md:text-6xl">Fresh Spawns</h1>
      </div>

      {feed.rows.length === 0 ? (
        <p className="py-16 font-mono text-sm uppercase tracking-[.05em] text-ink-muted">
          The nursery is empty. No fool has washed ashore yet — give it time.
        </p>
      ) : (
        <>
          {feed.rows.map((card) => (
            <BirthNoticeCard key={card.slug} card={card} now={now} />
          ))}
          <BirthNoticesPagination page={feed.page} total={feed.total} pageSize={feed.pageSize} />
        </>
      )}
    </main>
  );
}
