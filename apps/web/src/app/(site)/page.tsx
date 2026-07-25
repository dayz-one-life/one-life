import { getSurvivors } from "@/lib/api";
import { settleFeed } from "@/lib/settle-feed";
import { Hero } from "@/components/front-page/hero";
import { TopSurvivors } from "@/components/front-page/top-survivors";
import { SignInCta } from "@/components/front-page/signin-cta";

/** A REJECTED fetch degrades to the same empty board as a genuinely quiet one, so this banner
 *  keeps the two distinguishable instead of collapsing "we don't know" into "nothing happened"
 *  (live-data honesty §5). */
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
  const survivors = await settleFeed(getSurvivors({ sort: "time", page: 1 }));

  return (
    <main className="mx-auto w-full max-w-5xl">
      <Hero />
      {survivors.failed && (
        <FeedFailedBanner>The survivors board is temporarily unreachable.</FeedFailedBanner>
      )}
      <TopSurvivors rows={survivors.data?.rows.slice(0, 5) ?? []} />
      <SignInCta />
    </main>
  );
}
