import type { Challenge } from "@/lib/types";
import { EmoteSequence } from "./emote-sequence";

export function ClaimStatus({
  status, challenge,
}: { status: "pending" | "verified" | "cancelled"; challenge: Challenge | null }) {
  if (status === "verified") {
    return <p className="rounded border border-amber bg-panel-2 p-4 text-sm">✅ Gamertag verified! You now own this gamertag.</p>;
  }
  if (status === "cancelled") {
    return <p className="rounded border border-line bg-panel-2 p-4 text-sm">This claim was cancelled.</p>;
  }
  return (
    <div className="space-y-3">
      {challenge && <EmoteSequence challenge={challenge} />}
      <p className="text-sm text-muted">Waiting for you to perform the emotes in game…</p>
    </div>
  );
}
