"use client";
import { useState } from "react";
import { useClaimGamertag, useLinkStatus, useCancelLink, useGamertagLinks } from "@/lib/use-gamertag-links";
import { activeLink } from "@/lib/active-link";
import { claimErrorMessage } from "@/lib/claim-error";
import { ClaimForm } from "@/components/claim-form";
import { ClaimStatus } from "@/components/claim-status";
import { Button } from "@/components/ui/button";

export default function ClaimPage() {
  const claim = useClaimGamertag();
  const cancel = useCancelLink();
  const links = useGamertagLinks();
  const [linkId, setLinkId] = useState<number | null>(null);

  const existing = activeLink(links.data);
  const shownId = linkId ?? existing?.id ?? null;

  const status = useLinkStatus(shownId ?? 0, shownId !== null);
  const link = status.data;

  if (shownId !== null && link) {
    return (
      <main className="mx-auto max-w-md space-y-4 p-8">
        <h1 className="font-display text-[28px] text-amber">
          {link.status === "verified" ? `Your gamertag: ${link.gamertag}` : `Verify ${link.gamertag}`}
        </h1>
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
