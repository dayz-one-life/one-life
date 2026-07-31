"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { confirmCheckout } from "@/lib/api";
import { SrStatus } from "@/components/shared/sr-status";

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
  // Captured once on mount: the render must not depend on the live search params after that,
  // because the effect below strips the `checkout` param via router.replace(), and a render
  // still reading params.get("checkout") would unmount the settled note (and its live region)
  // the instant the param is gone. See the ⚠️ this fixes: "the note lives in state" comment
  // below was previously false — the render was reading from the URL, not state.
  const [sessionId] = useState(() => params.get("checkout"));
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
      // Strip the param now that we've settled — but not if the caller navigated away and
      // cleanup already fired; yanking them back to "/" after they left would be worse than
      // leaving a stale query param behind.
      if (!cancelled) router.replace("/", { scroll: false }); // the note lives in state, not params
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, qc, router]);

  if (!sessionId) return null;
  const text =
    result.kind === "added"
      ? `${result.n} token${result.n === 1 ? "" : "s"} added — thanks for keeping the servers up`
      : result.kind === "replay"
        ? "Tokens already added — thanks for keeping the servers up"
        : result.kind === "processing"
          ? "Payment processing — your tokens land shortly"
          : "";
  // Two nodes, per the repo's SrStatus rule (see sr-status.tsx's doc comment and the idiom in
  // self-unban-button.tsx): the live region must PRE-EXIST the text change it announces, because
  // some screen readers only announce mutations to an already-mounted region. So as soon as we
  // have a sessionId — before confirmCheckout resolves — we mount SrStatus with an empty string
  // and update it in place once `result` settles. The visible copy is a separate paragraph that
  // only appears once there's something to say (result.kind !== "idle"); it never renders empty.
  return (
    <>
      <SrStatus>{text}</SrStatus>
      {result.kind !== "idle" && (
        <p className="bg-bone px-3 py-2 font-mono text-[11px] uppercase tracking-[.06em] text-ink-soft">{text}</p>
      )}
    </>
  );
}
