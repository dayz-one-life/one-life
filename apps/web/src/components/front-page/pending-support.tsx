"use client";
import { useAccountStatus } from "@/lib/use-account-status";
import type { ObituaryCard } from "@/lib/types";
import type { ServersView } from "@/components/servers/how-to-connect";
import { ConnectSection } from "./connect-section";
import { Fallen } from "./fallen";

/**
 * Support content for a PENDING player, mounted below the #claim challenge section
 * (pending-verification spec §2). They must get in game to perform the emotes, so connect
 * instructions come first; the obituary wall follows for flavor. `ConnectSection` with a
 * pending kicker (full-width beat rhythm, pending-hero spec §4) — the cold "Play first, claim
 * later" line is untrue for someone who already claimed.
 *
 * Renders NOTHING for every other status, including `loading` (no flash) and `unlinked`
 * (whose claim-ladder empty state already carries HowToConnect — rendering it here too would
 * duplicate the landmark on one page).
 */
export function PendingSupport({ obits, servers }: {
  obits: ObituaryCard[];
  servers: ServersView;
}) {
  const status = useAccountStatus();
  if (status.kind !== "pending") return null;
  return (
    <>
      <ConnectSection
        servers={servers}
        kicker="Get in game — perform your sequence on any One Life server"
      />
      <Fallen rows={obits} />
    </>
  );
}
