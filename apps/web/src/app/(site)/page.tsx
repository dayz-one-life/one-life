import { getServers, getSurvivors } from "@/lib/api";
import { settleFeed } from "@/lib/settle-feed";
import { Hero } from "@/components/front-page/hero";
import { TopSurvivors } from "@/components/front-page/top-survivors";
import { ColdFork } from "@/components/front-page/cold-fork";
import { serversView } from "@/components/servers/how-to-connect";
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
  // Fetched here rather than through `useControls`, whose servers query is `enabled: signedIn` —
  // the cold fork's How to connect panel is shown to signed-OUT visitors, who would otherwise
  // never get a list. Independent of the survivors fetch: losing one must not cost the other.
  const [survivors, servers] = await Promise.all([
    settleFeed(getSurvivors({ sort: "time", page: 1 })),
    settleFeed(getServers()),
  ]);

  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_380px]">
      <main className="mx-auto w-full min-w-0 max-w-5xl xl:border-r xl:border-ink xl:pr-8">
        <Hero />
        {survivors.failed && (
          <FeedFailedBanner>The survivors board is temporarily unreachable.</FeedFailedBanner>
        )}
        <TopSurvivors rows={survivors.data?.rows.slice(0, 5) ?? []} />
        <ColdFork servers={serversView(servers.data, { failed: servers.failed })} />
        <div className="px-6 py-8 md:px-10">
          <AccountPanels />
        </div>
      </main>
      <HomeSidebar />
    </div>
  );
}
