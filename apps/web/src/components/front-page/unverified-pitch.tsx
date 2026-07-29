"use client";
import { useAccountStatus } from "@/lib/use-account-status";
import type { SiteStats, ObituaryCard } from "@/lib/types";
import type { ServersView } from "@/components/servers/how-to-connect";
import { Hero } from "./hero";
import { Rules } from "./rules";
import { Fallen } from "./fallen";
import { CtaSlab } from "./cta-slab";
import { ConnectSection } from "./connect-section";

/**
 * The pitch for signed-in-but-unverified visitors (home-polish spec §3): same beats as the cold
 * home, CTAs pointed at the on-page claim ladder (#claim) instead of /login. The beat count is
 * audience-dependent, not a fixed four: `pending`'s claim-ladder step (`AccountPanels`) has no
 * "how to connect" content of its own, so this pitch supplies `ConnectSection`; `unlinked`'s
 * ladder step already renders `HowToConnect` in its empty state, so `ConnectSection` is omitted
 * there — rendering it for both would duplicate the same landmark and instructions on one page.
 * Renders NOTHING until accountStatus resolves to unlinked/pending — a verified player must never
 * see a pitch flash (SSR renders nothing here; appearing beats vanishing for the unverified).
 */
export function UnverifiedPitch({ stats, obits, servers }: {
  stats: SiteStats | null;
  obits: ObituaryCard[];
  servers: ServersView;
}) {
  const status = useAccountStatus();
  if (status.kind !== "unlinked" && status.kind !== "pending") return null;
  return (
    <>
      <Hero stats={stats} audience="unverified" />
      <Rules />
      <Fallen rows={obits} />
      <CtaSlab audience="unverified" />
      {/* Only `pending` needs this here — `unlinked`'s claim-ladder empty state already renders
       *  HowToConnect (see the docstring above). Rendering it unconditionally duplicated the
       *  "How to connect" landmark and its instructions for `unlinked` visitors. */}
      {status.kind === "pending" && <ConnectSection servers={servers} />}
    </>
  );
}
