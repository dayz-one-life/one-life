import { cookies } from "next/headers";
import { getServers, getSurvivors, getSiteStats } from "@/lib/api";
import { settleFeed } from "@/lib/settle-feed";
import { Hero } from "@/components/front-page/hero";
import { TopSurvivors } from "@/components/front-page/top-survivors";
import { ColdFork } from "@/components/front-page/cold-fork";
import { serversView } from "@/components/servers/how-to-connect";
import { resolveDestinationFrom } from "@/lib/resolve-destination";
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
  // ⚠️ THE PITCH IS FOR COLD VISITORS ONLY (home-is-the-app spec / verified-desktop mock): a
  // signed-in player's home STARTS with their own standing, never with marketing they must
  // scroll past. Detected server-side by session-COOKIE PRESENCE (Better Auth's
  // `…session_token`, `__Secure-`-prefixed on HTTPS) rather than a session API call — zero
  // extra latency and no hydration flash. A stale cookie over-detects; `AccountPanels`'
  // `signInFallback` covers that with a sign-in link instead of a blank page.
  const cookieStore = await cookies();
  const signedIn = cookieStore.getAll().some((c) => c.name.includes("session_token"));

  // Fetched here rather than through `useControls`, whose servers query is `enabled: signedIn` —
  // the cold fork's How to connect panel is shown to signed-OUT visitors, who would otherwise
  // never get a list.
  const servers = await settleFeed(getServers());

  // ⚠️ The board strip is now ONE map's — there is no combined board (sub-project D) — resolved
  // through the same rule `/maps` and `/survivors` use, against the list we already have.
  const boardSlug = await resolveDestinationFrom(servers.data);
  const boardServer = boardSlug ? servers.data?.find((s) => s.slug === boardSlug) ?? null : null;

  // Only fetch a board once we know which one. A failed SERVERS fetch therefore costs the strip
  // too — unavoidable, since there is no map to ask about — but it is reported as a failure
  // rather than as an empty coast.
  const survivors = boardSlug
    ? await settleFeed(getSurvivors({ slug: boardSlug, page: 1 }))
    : { data: null, failed: servers.failed };

  // The ledger's numbers. Its OWN settleFeed: a failed stats fetch costs only the ledger (the
  // hero falls back to the evergreen headline) — never the board strip or the cold fork.
  const stats = await settleFeed(getSiteStats());

  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_380px]">
      <main className="mx-auto w-full min-w-0 max-w-5xl xl:border-r xl:border-ink xl:pr-8">
        {!signedIn && (
          <>
            <Hero stats={stats.data} />
            {survivors.failed && (
              <FeedFailedBanner>The survivors board is temporarily unreachable.</FeedFailedBanner>
            )}
            {boardSlug && boardServer && (
              <TopSurvivors
                rows={survivors.data?.rows.slice(0, 5) ?? []}
                slug={boardSlug}
                map={boardServer.map}
              />
            )}
            <ColdFork servers={serversView(servers.data, { failed: servers.failed })} />
          </>
        )}
        <div className="px-6 py-8 md:px-10">
          <AccountPanels signInFallback={signedIn} />
        </div>
      </main>
      <HomeSidebar
        board={
          boardSlug && boardServer
            ? {
                slug: boardSlug,
                map: boardServer.map,
                rows: survivors.data?.rows.slice(0, 3) ?? [],
                failed: survivors.failed,
              }
            : null
        }
      />
    </div>
  );
}
