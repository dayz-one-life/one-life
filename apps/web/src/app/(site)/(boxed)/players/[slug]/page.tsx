import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect, RedirectType } from "next/navigation";
import { getPlayerPage } from "@/lib/api";
import { absoluteUrl, OG_DEFAULTS } from "@/lib/seo";
import { playerSlug } from "@/lib/slug";
import { playerPageHref, shouldRedirectSlug } from "@/lib/player-page-href";
import { ownVerifiedSlug } from "@/lib/own-slug";
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
  if (!page) return { title: { absolute: "Survivor not found — One Life" }, robots: { index: false } };
  const desc = `${page.totals.kills} kills · ${page.totals.lives} lives · longest life ${formatDuration(page.totals.longestLifeSeconds)}.`;
  const canonicalBase = absoluteUrl(`/players/${playerSlug(page.gamertag)}`);
  const url = page.pastLivesPage > 1 ? `${canonicalBase}?page=${page.pastLivesPage}` : canonicalBase;
  return {
    title: { absolute: `${page.gamertag} — One Life DayZ survivor` },
    description: desc,
    alternates: { canonical: url },
    openGraph: { ...OG_DEFAULTS, title: page.gamertag, description: desc, url, type: "profile" },
    twitter: { card: "summary_large_image", title: page.gamertag, description: desc },
  };
}

export default async function PlayerPageRoute({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const pageNum = parsePage(sp.page);
  const page = await getPlayerPage(slug, pageNum);
  if (!page) notFound();

  // ⚠️ 307, NEVER 308. Whether this URL redirects depends on WHO is asking, so a permanent
  // redirect would be cached by browsers and crawlers against a session-dependent decision and
  // would follow the user after sign-out. The rename redirect below is a different case: a
  // rename is permanent for everyone, so it stays 308.
  //
  // ⚠️ Cache-safe only because `getPlayerPage` awaits `cookies()` and sets `cache: "no-store"`,
  // which forces this route dynamic. Do not "optimize" either away.
  if ((await ownVerifiedSlug()) === playerSlug(page.gamertag)) redirect("/", RedirectType.replace);

  if (shouldRedirectSlug(slug, page.gamertag)) {
    // 308, not 307: a rename is permanent, and shared links / crawlers should consolidate onto
    // the current dossier. playerPageHref preserves ?page= so pagination survives the bounce.
    permanentRedirect(playerPageHref(playerSlug(page.gamertag), pageNum));
  }
  return <PlayerProfile page={page} now={new Date()} />;
}
