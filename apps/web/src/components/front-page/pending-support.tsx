"use client";
import { useAccountStatus } from "@/lib/use-account-status";
import type { ObituaryCard } from "@/lib/types";
import { Rules } from "./rules";
import { JoinServers } from "./join-servers";
import { Fallen } from "./fallen";

/**
 * Support content for a PENDING player, below the #claim hero (join-the-servers spec §3):
 * Rules → JoinServers → Fallen, mirroring the cold home's beat rhythm. The closing line is the
 * emote variant — "claim later" is a done step for a pending player.
 *
 * Renders NOTHING for every other status, including `loading` (no flash).
 */
export function PendingSupport({ obits }: { obits: ObituaryCard[] }) {
  const status = useAccountStatus();
  if (status.kind !== "pending") return null;
  return (
    <>
      <Rules />
      <JoinServers closing="Any server counts for your emotes." />
      <Fallen rows={obits} />
    </>
  );
}
