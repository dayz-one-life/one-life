"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { createCheckout } from "@/lib/api";

/** Read at call time (not module scope) so tests can stub the env; Next inlines it either way. */
export function tokenPriceLabel(): string {
  return process.env.NEXT_PUBLIC_TOKEN_PRICE_LABEL ?? "";
}

/**
 * Starts a Stripe Checkout for unban tokens. Renders NOTHING when the price label is unset —
 * the label doubles as the store's web-side ON switch (unset-means-OFF, matching the API's
 * 503 when its Stripe env is unset). Quantity is chosen on Stripe's hosted page.
 */
export function BuyTokensButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const label = tokenPriceLabel();
  if (!label) return null;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { url } = await createCheckout();
          window.location.assign(url);
        } catch {
          setBusy(false); // API 503/network — the button simply re-arms; nothing was charged
        }
      }}
      className={cn(
        "min-h-[44px] border-2 border-ink bg-paper px-5 font-display text-sm font-bold uppercase tracking-[.08em] text-ink hover:bg-ink hover:text-paper disabled:opacity-40",
        className,
      )}
    >
      {busy ? "Opening checkout…" : `Buy tokens — ${label} each`}
    </button>
  );
}
