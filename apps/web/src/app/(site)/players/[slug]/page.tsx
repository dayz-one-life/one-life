import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { getPlayerPage, getPlayerArticles } from "@/lib/api";
import { settleFeed } from "@/lib/settle-feed";
import { absoluteUrl } from "@/lib/seo";
import { playerSlug } from "@/lib/slug";
import { playerPageHref, shouldRedirectSlug } from "@/lib/player-page-href";
import { PlayerProfile } from "@/components/player/player-profile";
import { formatDuration } from "@/components/player/format";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string; ap?: string }> };

function parsePage(raw?: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 1;
}

// A second, independent page parser for the In The Paper section's own `?ap=` param — it must
// never share `page`, or clicking either section's pagination would silently move both.
function parseAp(raw?: string): number {
  return parsePage(raw);
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const pageNum = parsePage((await searchParams).page);
  const page = await getPlayerPage(slug, pageNum).catch(() => null);
  if (!page) return { title: "Survivor not found — One Life" };
  const desc = `${page.totals.kills} kills · ${page.totals.lives} lives · longest life ${formatDuration(page.totals.longestLifeSeconds)}.`;
  const canonicalBase = absoluteUrl(`/players/${playerSlug(page.gamertag)}`);
  const url = page.pastLivesPage > 1 ? `${canonicalBase}?page=${page.pastLivesPage}` : canonicalBase;
  return {
    title: `${page.gamertag} — One Life DayZ survivor`,
    description: desc,
    alternates: { canonical: url },
    openGraph: { title: page.gamertag, description: desc, url, type: "profile" },
    twitter: { card: "summary_large_image", title: page.gamertag, description: desc },
  };
}

export default async function PlayerPageRoute({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const pageNum = parsePage(sp.page);
  const apNum = parseAp(sp.ap);
  const [page, articles] = await Promise.all([
    getPlayerPage(slug, pageNum),
    settleFeed(getPlayerArticles(slug, apNum)),
  ]);
  if (!page) notFound();
  if (shouldRedirectSlug(slug, page.gamertag)) {
    // 308, not 307: a rename is permanent, and shared links / crawlers should consolidate onto
    // the current dossier. playerPageHref preserves ?page=/?ap= so pagination survives the bounce.
    permanentRedirect(playerPageHref(playerSlug(page.gamertag), { page: pageNum, ap: apNum }));
  }
  return (
    <PlayerProfile
      page={page}
      now={new Date()}
      articles={articles.data}
      articlesFailed={articles.failed}
      articlesPage={apNum}
    />
  );
}
