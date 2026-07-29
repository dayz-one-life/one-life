"use client";
import { useAccountStatus } from "@/lib/use-account-status";
import type { ObituaryCard } from "@/lib/types";
import { HowToConnect, type ServersView } from "@/components/servers/how-to-connect";
import { Fallen } from "./fallen";

/**
 * Support content for a PENDING player, mounted below the #claim challenge section
 * (pending-verification spec §2). They must get in game to perform the emotes, so connect
 * instructions come first; the obituary wall follows for flavor. Deliberately bare
 * `HowToConnect`, not `ConnectSection` — its "Play first, claim later" kicker is untrue for
 * someone who already claimed.
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
      <div className="px-6 pb-10 md:px-10">
        <div className="max-w-lg">
          <HowToConnect servers={servers} />
        </div>
      </div>
      <Fallen rows={obits} />
    </>
  );
}
