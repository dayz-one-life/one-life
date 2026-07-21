"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/auth-client";
import { useGamertagLinks } from "@/lib/use-gamertag-links";
import { activeLink } from "@/lib/active-link";
import { getTokens, redeemToken } from "@/lib/api";
import { SkewCta } from "@/components/tabloid/skew-cta";

export type UnbanState = "hidden" | "ready" | "no-tokens" | "pending";

export function UnbanView({
  state,
  balance,
  onRedeem,
}: {
  state: UnbanState;
  balance: number;
  onRedeem: () => void;
}) {
  if (state === "hidden") return null;
  if (state === "pending") {
    return (
      <p role="status" aria-live="polite" className="mt-3 bg-bone px-3 py-2 text-center font-mono text-xs uppercase tracking-[.05em] text-ink-soft">
        Unban pending — lifting shortly…
      </p>
    );
  }
  const ready = state === "ready";
  return (
    <div className="mt-3 text-center">
      {ready ? (
        <SkewCta onClick={onRedeem}>Spend 1 token — skip the wait</SkewCta>
      ) : (
        <p className="border border-dashed border-dash px-3 py-2 font-mono text-xs uppercase tracking-[.05em] text-red-deep">
          No unban tokens
        </p>
      )}
      <p className="mt-2 font-mono text-[11px] text-ink-muted">
        {ready
          ? `You have ${balance} unban token${balance === 1 ? "" : "s"}`
          : "Earn tokens monthly, by referral, or on verification"}
      </p>
    </div>
  );
}

/** Shared unban CTA state: lift already pending > has tokens > broke. */
export function unbanStateOf(liftPending: boolean, balance: number): UnbanState {
  return liftPending ? "pending" : balance > 0 ? "ready" : "no-tokens";
}

export function SelfUnbanButton({
  banId,
  pageGamertag,
  liftPending,
}: {
  banId: number;
  pageGamertag: string;
  liftPending: boolean;
}) {
  const { data: session } = useSession();
  const links = useGamertagLinks(!!session?.user);
  const link = activeLink(links.data);
  const isOwner = !!session?.user && link?.status === "verified" && link.gamertag === pageGamertag;
  const [pending, setPending] = useState(liftPending);
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: getTokens, enabled: isOwner });
  const qc = useQueryClient();

  if (!isOwner) return <UnbanView state="hidden" balance={0} onRedeem={() => {}} />;

  const balance = tokens.data?.balance ?? 0;
  const state = unbanStateOf(pending, balance);
  const onRedeem = async () => {
    setPending(true);
    try {
      await redeemToken(banId);
      void qc.invalidateQueries({ queryKey: ["tokens"] });
      void qc.invalidateQueries({ queryKey: ["player-page"] });
    } catch {
      setPending(false);
    }
  };
  return <UnbanView state={state} balance={balance} onRedeem={onRedeem} />;
}
