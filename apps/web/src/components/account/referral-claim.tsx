"use client";
import { useEffect, useRef } from "react";

/**
 * Fires the one-shot referral claim after sign-in. Renders nothing.
 *
 * Mounted on `/welcome` (the OAuth callback) and on signed-in `/`, because a player can arrive
 * either way and the cookie lives for 30 days. The handler is idempotent and `claimReferrer`
 * treats a repeat as a silent no-op, so a double mount is harmless — the ref guard is for
 * StrictMode's double-invoke, not for correctness.
 */
export function ReferralClaim() {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    void fetch("/api/referral/claim", { method: "POST" }).catch(() => {});
  }, []);
  return null;
}
