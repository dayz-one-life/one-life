"use client";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { useGamertagLinks } from "@/lib/use-gamertag-links";
import { activeLink } from "@/lib/active-link";
import { getTokens, redeemToken } from "@/lib/api";
import { cn } from "@/lib/utils";

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
      <p className="mt-3 rounded bg-panel-2 px-3 py-2 text-center text-sm text-muted">
        ⏳ Unban pending — lifting shortly…
      </p>
    );
  }
  const ready = state === "ready";
  return (
    <div className="mt-3">
      <button
        onClick={ready ? onRedeem : undefined}
        disabled={!ready}
        className={cn(
          "w-full rounded px-3 py-2 text-sm font-hand",
          ready ? "bg-amber text-black" : "border border-line text-muted",
        )}
      >
        {ready ? "Spend 1 token to unban now" : "No unban tokens"}
      </button>
      <p className="mt-1 text-center text-xs text-muted">
        {ready
          ? `🎟️ You have ${balance} unban token${balance === 1 ? "" : "s"}`
          : "Earn tokens monthly, by referral, or on verification"}
      </p>
    </div>
  );
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
  const [tokens, setTokens] = useState<number | null>(null);

  // Fetch the balance as a side effect once ownership is established — not during render.
  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    getTokens()
      .then((t) => {
        if (!cancelled) setTokens(t.balance);
      })
      .catch(() => {
        if (!cancelled) setTokens(0);
      });
    return () => {
      cancelled = true;
    };
  }, [isOwner]);

  if (!isOwner) return <UnbanView state="hidden" balance={0} onRedeem={() => {}} />;

  const state: UnbanState = pending ? "pending" : (tokens ?? 0) > 0 ? "ready" : "no-tokens";
  const onRedeem = async () => {
    setPending(true);
    try {
      await redeemToken(banId);
    } catch {
      setPending(false);
    }
  };
  return <UnbanView state={state} balance={tokens ?? 0} onRedeem={onRedeem} />;
}
