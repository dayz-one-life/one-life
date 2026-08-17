"use client";

import { useEffect, useState } from "react";
import { getTokens, deleteAccount } from "@/lib/api";
import { signOutAndTeardownPush } from "@/lib/push";
import { useModalBehavior } from "@/lib/use-modal-behavior";

/** ⚠️ FOUR renders, not two. `loading` and `failed` must never collapse into `0` — telling
 *  someone "0 tokens will be forfeited" when the fetch merely failed, and they in fact hold
 *  five, destroys real value at the one moment they cannot check. */
type Balance =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "loaded"; value: number };

export function DeleteAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [balance, setBalance] = useState<Balance>({ kind: "loading" });
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setBalance({ kind: "loading" });
    getTokens()
      .then((w) => { if (live) setBalance({ kind: "loaded", value: w.balance }); })
      .catch(() => { if (live) setBalance({ kind: "failed" }); });
    return () => { live = false; };
  }, [open]);

  // Same shell as `AvatarDialog`/`ClaimModal`: focus moves into the panel on open and back to
  // the opener on close, Escape closes, Tab is trapped, body scroll is locked. Called
  // unconditionally (before the `!open` bail below) because it must run on every render for
  // hooks-order safety; the hook itself no-ops while `open` is false.
  const panelRef = useModalBehavior(open, onClose);

  if (!open) return null;

  // Confirm requires BOTH the exact word and a known balance: we will not let someone destroy
  // tokens whose count we could not read.
  const canConfirm = typed === "DELETE" && balance.kind === "loaded" && !busy;

  async function onConfirm() {
    setBusy(true);
    setError(null);
    try {
      await deleteAccount();
      // This calls `teardownPush()` first, but by now the session died with the deleted user,
      // so `DELETE /me/push-subscriptions` 401s and the browser's PushSubscription survives —
      // `teardownPush` swallows that failure deliberately (see its own comment). Harmless: the
      // matching server-side row went with the deletion cascade, and `teardownPush`'s
      // per-endpoint design means the next person to subscribe from this browser reclaims it
      // rather than inheriting this account's notifications. We don't reorder this ahead of
      // `deleteAccount()` to do it "for real", because that would unsubscribe push on a
      // deletion attempt that then fails, contradicting the "Nothing was changed" error below.
      await signOutAndTeardownPush();
    } catch {
      setError("We couldn't delete your account. Nothing was changed — please try again.");
      setBusy(false);
    }
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Delete account"
      tabIndex={-1}
      className="mt-4 border border-red-deep p-4"
    >
      <p className="font-mono text-[11.5px] uppercase leading-relaxed tracking-[.03em] text-ink">
        This cannot be undone. Your sign-in, gamertag link and avatar are removed, and you are
        signed out everywhere. Your lives, deaths and obituaries stay on the site.
      </p>

      <p className="mt-3 font-mono text-[11.5px] uppercase tracking-[.03em] text-ink-muted">
        {balance.kind === "loading" ? "Checking your token balance…"
          : balance.kind === "failed" ? "We couldn't check your token balance, so we won't let you delete yet. Please try again."
          : balance.value === 0 ? "You have no unspent tokens."
          : `${balance.value} unspent tokens will be forfeited.`}
      </p>

      <label htmlFor="confirm-delete" className="mt-4 block font-mono text-[11px] uppercase tracking-[.03em] text-ink-muted">
        Type DELETE to confirm
      </label>
      <input
        id="confirm-delete"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        className="mt-1 w-full border border-dash bg-transparent px-3 py-2 font-mono text-sm text-ink"
      />

      {error ? (
        <p role="alert" className="mt-3 font-mono text-xs uppercase tracking-[.04em] text-red-deep">{error}</p>
      ) : null}

      <div className="mt-4 flex gap-3">
        <button type="button" onClick={onClose} className="border border-dash px-4 py-2 font-mono text-xs uppercase tracking-[.04em] text-ink">
          Cancel
        </button>
        <button
          type="button"
          disabled={!canConfirm}
          onClick={() => void onConfirm()}
          className="border border-red-deep px-4 py-2 font-mono text-xs uppercase tracking-[.04em] text-red-deep disabled:opacity-40"
        >
          Delete my account
        </button>
      </div>
    </div>
  );
}
