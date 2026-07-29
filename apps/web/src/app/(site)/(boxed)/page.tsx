import { cookies } from "next/headers";
import { getServers, getSurvivors, getSiteStatsCached, getObituariesFeedCached } from "@/lib/api";
import { settleFeed } from "@/lib/settle-feed";
import { Hero } from "@/components/front-page/hero";
import { Fallen } from "@/components/front-page/fallen";
import { Rules } from "@/components/front-page/rules";
import { CtaSlab } from "@/components/front-page/cta-slab";
import { ConnectSection } from "@/components/front-page/connect-section";
import { UnverifiedPitch } from "@/components/front-page/unverified-pitch";
import { serversView } from "@/components/servers/how-to-connect";
import { resolveDestinationFrom } from "@/lib/resolve-destination";
import { AccountPanels } from "@/components/account/account-panels";
import { HomeShell } from "@/components/account/home-shell";

/**
 * The home page (cold-home-relaunch spec). ⚠️ THE PITCH IS FOR COLD VISITORS ONLY: signed-in
 * detection is session-COOKIE PRESENCE (zero latency, no hydration flash); a stale cookie
 * over-detects and `AccountPanels`' signInFallback covers it.
 *
 * Fetch gating (each its own settleFeed — feeds degrade independently):
 * - stats + obituaries feed the home pitch and are now fetched UNCONDITIONALLY, cold AND
 *   signed-in — superseded the old "signed-in must skip this fetch" rule (see
 *   docs/superpowers/specs/2026-07-28-home-polish-discord-design.md §3): a later task adds an
 *   unverified pitch to the signed-in branch that needs this same data, and the two fetches now
 *   go through `getSiteStatsCached`/`getObituariesFeedCached` — cookie-free, shared 60s fetch
 *   cache — instead of the cookie-forwarding `getSiteStats`/`getObituariesFeed`, so fetching them
 *   on every render no longer costs a per-request fleet-wide COUNT/kills-table scan.
 * - survivors + board resolution feed ONLY the verified sidebar → fetched ONLY when signed in.
 * All promises are kicked off before the servers await so they run concurrently;
 * settleFeed never rejects, so un-awaited promises cannot produce unhandled rejections.
 */
export default async function Home() {
  const cookieStore = await cookies();
  const signedIn = cookieStore.getAll().some((c) => c.name.includes("session_token"));

  const statsPromise = settleFeed(getSiteStatsCached());
  const obitsPromise = settleFeed(getObituariesFeedCached(1));

  const servers = await settleFeed(getServers());

  // Sidebar board (verified xl glance) — its only remaining consumer is signed-in.
  const boardSlug = signedIn ? await resolveDestinationFrom(servers.data) : null;
  const boardServer = boardSlug ? servers.data?.find((s) => s.slug === boardSlug) ?? null : null;
  const survivors = boardSlug
    ? await settleFeed(getSurvivors({ slug: boardSlug, page: 1 }))
    : { data: null, failed: false };

  const stats = await statsPromise;
  const obits = await obitsPromise;

  return (
    <HomeShell
      board={
        boardSlug && boardServer
          ? { slug: boardSlug, map: boardServer.map, rows: survivors.data?.rows.slice(0, 3) ?? [], failed: survivors.failed }
          : null
      }
    >
      {!signedIn && (
        <>
          <Hero stats={stats.data} />
          <Rules />
          {/* Failed OR empty → [] → Fallen renders nothing (absent proof is silence). */}
          <Fallen rows={obits.data?.rows ?? []} />
          <CtaSlab />
          <ConnectSection servers={serversView(servers.data, { failed: servers.failed })} />
        </>
      )}
      {signedIn && (
        <UnverifiedPitch
          stats={stats.data}
          obits={obits.data?.rows ?? []}
          servers={serversView(servers.data, { failed: servers.failed })}
        />
      )}
      {signedIn && (
        <div id="claim" className="px-6 py-8 md:px-10">
          <AccountPanels signInFallback={signedIn} />
        </div>
      )}
    </HomeShell>
  );
}
