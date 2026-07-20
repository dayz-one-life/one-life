import { getSurvivors, getObituariesFeed, getBirthNoticesFeed, getNewsFeed } from "@/lib/api";
import { Hero } from "@/components/front-page/hero";
import { TopSurvivors } from "@/components/front-page/top-survivors";
import { NewsLead } from "@/components/front-page/news-lead";
import { LatestObituaries } from "@/components/front-page/latest-obituaries";
import { LatestFreshSpawns } from "@/components/front-page/latest-fresh-spawns";
import { SignInCta } from "@/components/front-page/signin-cta";

export default async function Home() {
  const [news, survivors, obituaries, freshSpawns] = await Promise.all([
    getNewsFeed(1).catch(() => null),
    getSurvivors({ sort: "time", page: 1 }).catch(() => null),
    getObituariesFeed(1).catch(() => null),
    getBirthNoticesFeed(1).catch(() => null),
  ]);
  const [lead, ...secondary] = news?.rows.slice(0, 3) ?? [];

  return (
    <main className="mx-auto w-full max-w-5xl">
      {/* News leads when the desk has printed; an empty newsroom falls back to the manifesto
          hero + the top-5 board rather than an empty box (voice-first: no fake fronts). */}
      {lead ? (
        <NewsLead lead={lead} secondary={secondary} now={new Date()} />
      ) : (
        <>
          <Hero />
          <TopSurvivors rows={survivors?.rows.slice(0, 5) ?? []} />
        </>
      )}
      <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-hairline">
        <LatestObituaries rows={obituaries?.rows.slice(0, 3) ?? []} />
        <LatestFreshSpawns rows={freshSpawns?.rows.slice(0, 3) ?? []} />
      </div>
      <SignInCta />
    </main>
  );
}
