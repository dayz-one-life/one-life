import { getSurvivors } from "@/lib/api";
import { settleFeed } from "@/lib/settle-feed";
import { Hero } from "@/components/front-page/hero";
import { TopSurvivors } from "@/components/front-page/top-survivors";
import { SignInCta } from "@/components/front-page/signin-cta";
import { AccountPanels } from "@/components/account/account-panels";
import { HomeSidebar } from "@/components/account/home-sidebar";

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

/**
 * Home owns the two-column grid — it is the only page with a sidebar. The grid used to live in
 * `(site)/layout.tsx` and applied to every page in the group.
 *
 * `AccountPanels` is a client component rendered from this async server component, which composes
 * fine. It sits in the MAIN column, not the sidebar: everything in it is actionable and the
 * sidebar does not render below `xl`.
 *
 * Sub-project C replaces the hero / board / CTA arrangement with the three-mode home.
 */
export default async function Home() {
  const survivors = await settleFeed(getSurvivors({ sort: "time", page: 1 }));

  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_380px]">
      <main className="mx-auto w-full min-w-0 max-w-5xl xl:border-r xl:border-ink xl:pr-8">
        <Hero />
        {survivors.failed && (
          <FeedFailedBanner>The survivors board is temporarily unreachable.</FeedFailedBanner>
        )}
        <TopSurvivors rows={survivors.data?.rows.slice(0, 5) ?? []} />
        <div className="px-6 py-8 md:px-10">
          <AccountPanels />
        </div>
        <SignInCta />
      </main>
      <HomeSidebar />
    </div>
  );
}
