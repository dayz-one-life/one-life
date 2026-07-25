"use client";
import { useEffect, useRef, useState } from "react";
import { SrStatus } from "@/components/shared/sr-status";
import type { AccountStatus } from "@/lib/account-status";

/**
 * `ProveItPanel` unmounts entirely on the pending -> verified swap in `ControlsRail` /
 * `MobileControls` (replaced by `IdentityRow verified` + `TokensPanel`), taking any live region
 * inside it down before it can announce anything — the same "announcer must outlive the
 * unmount" problem `TokensPanel` already solves for its referrer message. Mount this
 * unconditionally as a sibling of the status-dependent body (never inside a branch keyed on
 * `status.kind`) so it survives every transition, and announce "Verification complete" exactly
 * once, only when `kind` goes from "pending" to "verified" on a later render — never on initial
 * mount, so a returning verified user does not hear it.
 */
export function VerificationAnnouncer({ kind }: { kind: AccountStatus["kind"] }) {
  const prevKind = useRef(kind);
  const [announced, setAnnounced] = useState(false);

  useEffect(() => {
    if (prevKind.current === "pending" && kind === "verified") {
      setAnnounced(true);
    }
    prevKind.current = kind;
  }, [kind]);

  return <SrStatus>{announced ? "Verification complete" : ""}</SrStatus>;
}
