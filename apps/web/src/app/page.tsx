import { getSurvivors, getObituariesFeed, getBirthNoticesFeed } from "@/lib/api";
import { Hero } from "@/components/front-page/hero";
import { TopSurvivors } from "@/components/front-page/top-survivors";
import { LatestObituaries } from "@/components/front-page/latest-obituaries";
import { LatestFreshSpawns } from "@/components/front-page/latest-fresh-spawns";
import { SignInCta } from "@/components/front-page/signin-cta";

export default async function Home() {
  const [survivors, obituaries, freshSpawns] = await Promise.all([
    getSurvivors({ sort: "time", page: 1 }).catch(() => null),
    getObituariesFeed(1).catch(() => null),
    getBirthNoticesFeed(1).catch(() => null),
  ]);
  return (
    <main className="mx-auto w-full max-w-5xl">
      <Hero />
      <TopSurvivors rows={survivors?.rows.slice(0, 5) ?? []} />
      <LatestObituaries rows={obituaries?.rows.slice(0, 3) ?? []} />
      <LatestFreshSpawns rows={freshSpawns?.rows.slice(0, 3) ?? []} />
      <SignInCta />
    </main>
  );
}
