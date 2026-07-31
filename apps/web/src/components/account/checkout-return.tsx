"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { confirmCheckout } from "@/lib/api";

type Result = { kind: "idle" } | { kind: "added"; n: number } | { kind: "replay" } | { kind: "processing" };

/**
 * Handles the `/?checkout={sessionId}` return leg from Stripe's hosted page: confirm →
 * refresh the balance → say what happened. Mount inside <Suspense> (useSearchParams).
 *
 * ⚠️ There is no failure render. A confirm that errors, or a session Stripe reports
 * unpaid/unknown, both say "payment processing" — the webhook fulfills independently, and
 * telling a buyer whose card WAS charged that something failed would be a lie we can't
 * verify. Never fabricate an outcome from an unresolved confirm (live-data honesty §5).
 */
export function CheckoutReturn() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const sessionId = params.get("checkout");
  const [result, setResult] = useState<Result>({ kind: "idle" });

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await confirmCheckout(sessionId);
        if (cancelled) return;
        if (r.paid) setResult(r.granted > 0 ? { kind: "added", n: r.granted } : { kind: "replay" });
        else setResult({ kind: "processing" });
        void qc.invalidateQueries({ queryKey: ["tokens"] });
      } catch {
        if (!cancelled) setResult({ kind: "processing" });
      }
      router.replace("/", { scroll: false }); // strip the param; the note lives in state
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, qc, router]);

  if (!sessionId || result.kind === "idle") return null;
  const text =
    result.kind === "added"
      ? `${result.n} token${result.n === 1 ? "" : "s"} added — thanks for keeping the servers up`
      : result.kind === "replay"
        ? "Tokens already added — thanks for keeping the servers up"
        : "Payment processing — your tokens land shortly";
  // A single visible, live-announcing node — not a separate SrStatus + visible pair — because
  // both would render this SAME text and a screen-reader query (or an RTL findByText) can no
  // longer tell them apart. Unlike the "pending -> ready" transitions elsewhere that need the
  // live region mounted BEFORE the text change to be announced, sessionId is already known at
  // mount here, so there is no pre-existing-region requirement to preserve.
  return (
    <p
      role="status"
      aria-live="polite"
      className="bg-bone px-3 py-2 font-mono text-[11px] uppercase tracking-[.06em] text-ink-soft"
    >
      {text}
    </p>
  );
}
