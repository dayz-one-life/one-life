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
 * pending-verification spec §2): same beats as the cold home, CTAs pointed at the claim modal
 * (#claim — home-consistency spec §3: opens `ClaimModal`, no longer scrolls to an inline ladder)
 * instead of /login. Beat order: Hero → Rules → JoinServers → CtaSlab → Fallen.
 *
 * ⚠️ Pending renders NOTHING here. A pending player already claimed — every CTA in these beats
 * asks for a step they have done. `PendingHero` (the challenge itself) carries the `#claim`
 * anchor for pending — the masthead's "Finish verification →" scrolls there. `PendingSupport`
 * carries their support content instead. `JoinServers` carries no "How to connect" landmark of
 * its own, so it can sit beside the claim modal's empty state (which does carry that landmark)
 * without duplicating it.
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
      <JoinServers />
      <CtaSlab audience="unverified" />
      <Fallen rows={obits} />
    </>
  );
}
