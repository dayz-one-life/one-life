import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPlayerPage } from "@/lib/api";
import { absoluteUrl } from "@/lib/seo";
import { playerSlug } from "@/lib/slug";
import { PlayerProfile } from "@/components/player/player-profile";
import { formatDuration } from "@/components/player/format";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> };

function parsePage(raw?: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 1;
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
  const pageNum = parsePage((await searchParams).page);
  const page = await getPlayerPage(slug, pageNum);
  if (!page) notFound();
  return <PlayerProfile page={page} now={new Date()} />;
}
