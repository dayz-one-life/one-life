import { cookies } from "next/headers";
import { getSiteStatsCached, getObituariesFeedCached } from "@/lib/api";
import { settleFeed } from "@/lib/settle-feed";
import { Hero } from "@/components/front-page/hero";
import { Fallen } from "@/components/front-page/fallen";
import { Rules } from "@/components/front-page/rules";
import { CtaSlab } from "@/components/front-page/cta-slab";
import { JoinServers } from "@/components/front-page/join-servers";
import { UnverifiedPitch } from "@/components/front-page/unverified-pitch";
import { PendingSupport } from "@/components/front-page/pending-support";
import { PendingHero } from "@/components/front-page/pending-hero";
import { AccountPanels } from "@/components/account/account-panels";
import { ClaimModal } from "@/components/account/claim-modal";
import { ReferralClaim } from "@/components/account/referral-claim";
import type { Metadata } from "next";
import { absoluteUrl, OG_DEFAULTS, SITE_DESCRIPTION } from "@/lib/seo";

const HOME_TITLE = "One Life — hardcore permadeath DayZ";
export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: SITE_DESCRIPTION,
  alternates: { canonical: absoluteUrl("/") },
  openGraph: { ...OG_DEFAULTS, title: HOME_TITLE, description: SITE_DESCRIPTION, url: absoluteUrl("/"), type: "website" },
};

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
 *
 * ⚠️ THE HOME PAGE IS ONE COLUMN, at every width. The `xl` glance sidebar and its `HomeShell`
 * wrapper are gone: the verified home is the ticket stage, the controls slab and the morgue,
 * full-bleed and edge to edge, and a 380px rail beside them fought that. Nothing was lost that
 * was reachable only there — the board and notification glances already had `/survivors`,
 * `/notifications` and the masthead bell (the sidebar's friends glance has no replacement to
 * point at: the friends feature itself was removed whole, later in the same update round).
 * Removing it also deleted three per-request server fetches — `getServers`, the board resolution
 * and `getSurvivors` existed ONLY to fill that rail.
 *
 * Both remaining promises are kicked off before their awaits so they run concurrently;
 * settleFeed never rejects, so un-awaited promises cannot produce unhandled rejections.
 */
export default async function Home() {
  const cookieStore = await cookies();
  const signedIn = cookieStore.getAll().some((c) => c.name.includes("session_token"));

  const statsPromise = settleFeed(getSiteStatsCached());
  const obitsPromise = settleFeed(getObituariesFeedCached(1));

  const stats = await statsPromise;
  const obits = await obitsPromise;

  return (
    <main className="w-full min-w-0">
      {!signedIn && (
        <>
          <Hero stats={stats.data} />
          <Rules />
          <JoinServers />
          <CtaSlab />
          {/* Failed OR empty → [] → Fallen renders nothing (absent proof is silence). */}
          <Fallen rows={obits.data?.rows ?? []} />
        </>
      )}
      {signedIn && <UnverifiedPitch stats={stats.data} obits={obits.data?.rows ?? []} />}
      {signedIn && (
        <>
          {/* #claim lives on PendingHero's section (pending scroll anchor) and, for unlinked, on
           * the hash-driven ClaimModal — there is no inline claim section anymore. */}
          <PendingHero />
          <ClaimModal />
          {/* Renders nothing. Consumes the 30-day invite cookie once, after sign-in — this is
           *  the page every post-login hop lands on, and /welcome only redirects. */}
          <ReferralClaim />
          <AccountPanels signInFallback={signedIn} />
        </>
      )}
      {signedIn && <PendingSupport obits={obits.data?.rows ?? []} />}
    </main>
  );
}
