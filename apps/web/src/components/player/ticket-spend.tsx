"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createCheckout, redeemToken } from "@/lib/api";
import { tokenPriceLabel } from "@/components/account/buy-tokens";
import { SrStatus } from "@/components/shared/sr-status";

/**
 * The per-ticket spend button.
 *
 * ⚠️ Ownership is decided by the SERVER (the stage's `viewer` prop) and this island is only
 * rendered for the owner — it does not re-derive owner-ness from a client session query. That
 * also keeps it mountable without a query provider.
 *
 * ⚠️ It names the ban it lifts. The ticket is the only place that knows WHICH ban a token would
 * lift, which is why the spend affordance lives here and not in the controls slab.
 */
export function TicketSpend({ banId, liftPending }: { banId: number; liftPending: boolean }) {
  const [pending, setPending] = useState(liftPending);
  const [buying, setBuying] = useState(false);
  const router = useRouter();

  if (pending) {
    return (
      <>
        <SrStatus>Unban pending — lifting shortly…</SrStatus>
        <p className="w-full bg-bone px-3 py-2.5 text-center font-mono text-[10px] uppercase tracking-[.1em] text-ink-soft">
          Lifting…
        </p>
      </>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          setPending(true);
          try {
            await redeemToken(banId);
            // The stage is server-rendered on the dossier and query-driven on the home page;
            // `refresh()` re-runs the RSC fetch, which is the one path that serves both.
            router.refresh();
          } catch {
            setPending(false);
          }
        }}
        className="w-full bg-red px-3 py-2.5 font-mono text-[10px] uppercase tracking-[.1em] text-white"
      >
        Spend 1 token
      </button>
      {tokenPriceLabel() && (
        <button
          type="button"
          disabled={buying}
          onClick={async () => {
            setBuying(true);
            try {
              const { url } = await createCheckout();
              window.location.assign(url);
            } catch {
              setBuying(false);
            }
          }}
          className="mt-2 w-full border-2 border-ink bg-paper px-3 py-2.5 font-mono text-[10px] uppercase tracking-[.1em] text-ink hover:bg-ink hover:text-paper disabled:opacity-40"
        >
          {buying ? "Opening checkout…" : `Buy a token — ${tokenPriceLabel()}`}
        </button>
      )}
    </>
  );
}
