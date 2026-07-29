"use client";
import { useAccountStatus } from "@/lib/use-account-status";
import type { SiteStats, ObituaryCard } from "@/lib/types";
import { Hero } from "./hero";
import { Rules } from "./rules";
import { Fallen } from "./fallen";
import { CtaSlab } from "./cta-slab";
import { JoinServers } from "./join-servers";

/**
 * The pitch for signed-in-but-UNLINKED visitors (home-polish spec §3; narrowed by the
 * pending-verification spec §2): same beats as the cold home, CTAs pointed at the on-page claim
 * ladder (#claim) instead of /login.
 *
 * ⚠️ Pending renders NOTHING here. A pending player already claimed — every CTA in these beats
 * asks for a step they have done — and rendering nothing floats the #claim challenge section
 * (`AccountPanels`) to the top of their page. `PendingSupport` (below `#claim` in the page)
 * carries their support content instead. `JoinServers` (mounted here after the CTA slab)
 * carries no "How to connect" landmark of its own, so it can sit beside the claim ladder's
 * empty state (which does carry that landmark) without duplicating it.
 *
 * Renders NOTHING until accountStatus resolves to unlinked — a verified player must never see a
 * pitch flash (SSR renders nothing here; appearing beats vanishing for the unverified).
 */
export function UnverifiedPitch({ stats, obits }: {
  stats: SiteStats | null;
  obits: ObituaryCard[];
}) {
  const status = useAccountStatus();
  if (status.kind !== "unlinked") return null;
  return (
    <>
      <Hero stats={stats} audience="unverified" />
      <Rules />
      <Fallen rows={obits} />
      <CtaSlab audience="unverified" />
      <JoinServers />
    </>
  );
}
