import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPlayerPage } from "@/lib/api";
import { absoluteUrl } from "@/lib/seo";
import { PlayerProfile } from "@/components/player/player-profile";
import { formatDuration } from "@/components/player/format";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPlayerPage(slug).catch(() => null);
  if (!page) return { title: "Survivor not found — One Life" };
  const desc = `${page.totals.kills} kills · ${page.totals.lives} lives · longest life ${formatDuration(page.totals.longestLifeSeconds)}.`;
  const url = absoluteUrl(`/players/${slug}`);
  return {
    title: `${page.gamertag} — One Life DayZ survivor`,
    description: desc,
    alternates: { canonical: url },
    openGraph: { title: page.gamertag, description: desc, url, type: "profile" },
    twitter: { card: "summary_large_image", title: page.gamertag, description: desc },
  };
}

export default async function PlayerPageRoute({ params }: Props) {
  const { slug } = await params;
  const page = await getPlayerPage(slug);
  if (!page) notFound();
  return <PlayerProfile page={page} now={new Date()} />;
}
