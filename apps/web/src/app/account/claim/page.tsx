"use client";
import { useState } from "react";
import { ApiError } from "@/lib/api";
import { useClaimGamertag, useLinkStatus, useCancelLink } from "@/lib/use-gamertag-links";
import { ClaimForm } from "@/components/claim-form";
import { ClaimStatus } from "@/components/claim-status";
import { Button } from "@/components/ui/button";

function claimErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 422) return "We haven't seen that gamertag on any server yet.";
    if (e.status === 409) return "That gamertag is already claimed by someone.";
  }
  return "Something went wrong. Please try again.";
}

export default function ClaimPage() {
  const claim = useClaimGamertag();
  const cancel = useCancelLink();
  const [linkId, setLinkId] = useState<number | null>(null);

  const status = useLinkStatus(linkId ?? 0, linkId !== null);
  const link = status.data;

  if (linkId !== null && link) {
    return (
      <main className="mx-auto max-w-md space-y-4 p-8">
        <h1 className="font-display text-[28px] text-amber">Verify {link.gamertag}</h1>
        <ClaimStatus status={link.status} challenge={link.challenge} />
        {link.status === "pending" && (
          <Button className="border border-line bg-panel text-bone hover:border-amber" onClick={() => { cancel.mutate(link.id); setLinkId(null); }}>
            Cancel claim
          </Button>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md space-y-4 p-8">
      <h1 className="font-display text-[28px] text-amber">Claim a gamertag</h1>
      <ClaimForm
        pending={claim.isPending}
        error={claim.isError ? claimErrorMessage(claim.error) : null}
        onSubmit={(gamertag) =>
          claim.mutate({ gamertag }, { onSuccess: (res) => setLinkId(res.linkId) })
        }
      />
    </main>
  );
}
