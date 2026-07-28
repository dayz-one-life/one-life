import type { Metadata } from "next";
import { getObituariesFeed } from "@/lib/api";
import { Kicker } from "@/components/tabloid/kicker";
import { ObituaryCard } from "@/components/obituaries/obituary-card";
import { ObituariesPagination } from "@/components/obituaries/obituaries-pagination";
import { obituariesHref } from "@/lib/obituary-format";
import { absoluteUrl } from "@/lib/seo";
import { parsePage } from "@/lib/board-params";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const page = parsePage((await searchParams).page);
  const title = page > 1 ? `Obituaries · Page ${page}` : "Obituaries";
  const description = "The dead of One Life, written up by the morgue desk — every qualified death gets its obituary.";
  const canonical = absoluteUrl(obituariesHref(page));
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

export default async function ObituariesPage({ searchParams }: Props) {
  const page = parsePage((await searchParams).page);
  const feed = await getObituariesFeed(page);
  const now = new Date();

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10">
      <div className="border-b-[3px] border-ink pb-4">
        <Kicker>The Morgue</Kicker>
        <h1 className="mt-2 font-display text-5xl font-bold uppercase leading-[.95] text-ink md:text-6xl">Obituaries</h1>
      </div>

      {feed.rows.length === 0 ? (
        <p className="py-16 font-mono text-sm uppercase tracking-[.05em] text-ink-muted">
          The morgue desk is quiet. Give it time — everyone dies here.
        </p>
      ) : (
        <>
          {feed.rows.map((card) => (
            <ObituaryCard key={card.slug} card={card} now={now} />
          ))}
          <ObituariesPagination page={feed.page} total={feed.total} pageSize={feed.pageSize} />
        </>
      )}
    </main>
  );
}
