import { getSurvivors, getObituariesFeed, getBirthNoticesFeed, getNewsFeed } from "@/lib/api";
import { settleFeed } from "@/lib/settle-feed";
import { Hero } from "@/components/front-page/hero";
import { TopSurvivors } from "@/components/front-page/top-survivors";
import { NewsLead } from "@/components/front-page/news-lead";
import { LatestObituaries } from "@/components/front-page/latest-obituaries";
import { LatestFreshSpawns } from "@/components/front-page/latest-fresh-spawns";
import { SignInCta } from "@/components/front-page/signin-cta";

/** The same honest-fallback banner `news.failed` already used — reused verbatim (not a new
 *  error UI) for the other three home feeds below (live-data honesty §5, fix round 1). A
 *  REJECTED fetch degrades to the same fallback copy as a genuinely-empty one, but this banner
 *  makes the two distinguishable instead of collapsing "we don't know" into "nothing happened." */
function FeedFailedBanner({ children }: { children: string }) {
  return (
    <p
      role="status"
      className="border-b border-hairline bg-bone px-4 py-2 text-center font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted"
    >
      {children}
    </p>
  );
}

export default async function Home() {
  // `settleFeed` distinguishes "resolved" (even to a genuinely empty feed) from "the request
  // itself failed" — the old `.catch(() => null)` collapsed both into the same `[]` shape, so
  // an API outage rendered identically to "the desk hasn't published yet" (live-data honesty
  // spec §5).
  const [news, survivors, obituaries, freshSpawns] = await Promise.all([
    settleFeed(getNewsFeed(1)),
    settleFeed(getSurvivors({ sort: "time", page: 1 })),
    settleFeed(getObituariesFeed(1)),
    settleFeed(getBirthNoticesFeed(1)),
  ]);
  const [lead, ...secondary] = news.data?.rows.slice(0, 3) ?? [];

  return (
    <main className="mx-auto w-full max-w-5xl">
      {/* A genuinely quiet desk (a resolved, empty feed) renders no banner here — the byte-
          identical manifesto/top-5 fallback below IS the honest "nothing published yet" state.
          A FAILED news fetch gets the same visual fallback (never a broken page) but is
          flagged, so an outage doesn't read as editorial silence. */}
      {news.failed && (
        <FeedFailedBanner>
          The news desk is temporarily unreachable — showing the standing board instead.
        </FeedFailedBanner>
      )}
      {/* News leads when the desk has printed; an empty newsroom falls back to the manifesto
          hero + the top-5 board rather than an empty box (voice-first: no fake fronts). Same
          honesty rule as news: survivors.failed gets a banner, the quiet-coast copy underneath
          renders unchanged either way. */}
      {lead ? (
        <NewsLead lead={lead} secondary={secondary} now={new Date()} />
      ) : (
        <>
          <Hero />
          {survivors.failed && (
            <FeedFailedBanner>The survivors board is temporarily unreachable.</FeedFailedBanner>
          )}
          <TopSurvivors rows={survivors.data?.rows.slice(0, 5) ?? []} />
        </>
      )}
      <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-hairline">
        <div>
          {obituaries.failed && (
            <FeedFailedBanner>The morgue desk is temporarily unreachable.</FeedFailedBanner>
          )}
          <LatestObituaries rows={obituaries.data?.rows.slice(0, 3) ?? []} />
        </div>
        <div>
          {freshSpawns.failed && (
            <FeedFailedBanner>The nursery feed is temporarily unreachable.</FeedFailedBanner>
          )}
          <LatestFreshSpawns rows={freshSpawns.data?.rows.slice(0, 3) ?? []} />
        </div>
      </div>
      <SignInCta />
    </main>
  );
}
