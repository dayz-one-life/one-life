import { cookies } from "next/headers";
import { getServers, getSurvivors, getSiteStats, getObituariesFeed } from "@/lib/api";
import { settleFeed } from "@/lib/settle-feed";
import { Hero } from "@/components/front-page/hero";
import { Fallen } from "@/components/front-page/fallen";
import { Rules } from "@/components/front-page/rules";
import { CtaSlab } from "@/components/front-page/cta-slab";
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
 * - stats + obituaries feed ONLY the cold pitch → fetched ONLY when signed out. Do NOT make
 *   either unconditional: getSiteStats runs a fleet-wide COUNT + getAliveSurvivors (whole kills
 *   table), and the obituaries feed is another page-1 query nobody signed-in sees.
 * - survivors + board resolution feed ONLY the verified sidebar → fetched ONLY when signed in.
 * Both promise sets are kicked off before the servers await so they run concurrently;
 * settleFeed never rejects, so un-awaited promises cannot produce unhandled rejections.
 */
export default async function Home() {
  const cookieStore = await cookies();
  const signedIn = cookieStore.getAll().some((c) => c.name.includes("session_token"));

  const statsPromise = signedIn ? null : settleFeed(getSiteStats());
  const obitsPromise = signedIn ? null : settleFeed(getObituariesFeed(1));

  const servers = await settleFeed(getServers());

  // Sidebar board (verified xl glance) — its only remaining consumer is signed-in.
  const boardSlug = signedIn ? await resolveDestinationFrom(servers.data) : null;
  const boardServer = boardSlug ? servers.data?.find((s) => s.slug === boardSlug) ?? null : null;
  const survivors = boardSlug
    ? await settleFeed(getSurvivors({ slug: boardSlug, page: 1 }))
    : { data: null, failed: false };

  const stats = statsPromise ? await statsPromise : { data: null, failed: false };
  const obits = obitsPromise ? await obitsPromise : { data: null, failed: false };

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
          <CtaSlab servers={serversView(servers.data, { failed: servers.failed })} />
        </>
      )}
      <div className="px-6 py-8 md:px-10">
        <AccountPanels signInFallback={signedIn} />
      </div>
    </HomeShell>
  );
}
