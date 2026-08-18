"use client";

import { useEffect, useState } from "react";
import { blockPlayer } from "@/lib/api";
import { useModalBehavior } from "@/lib/use-modal-behavior";

export function BlockDialog({
  open,
  gamertag,
  onClose,
}: {
  open: boolean;
  gamertag: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Same shell as `ReportDialog`/`DeleteAccountDialog`: focus moves into the panel on open and
  // back to the opener on close, Escape closes, Tab is trapped, body scroll is locked. Called
  // unconditionally (before the `!open` bail below) for hooks-order safety.
  const panelRef = useModalBehavior(open, onClose);

  // ⚠️ This dialog is mounted once (by `ReportBlockMenu`) and toggled purely via `open` — it is
  // never unmounted between uses. Without this, a second open would reopen straight onto a
  // stale "Blocked" screen or a stale error banner from the PREVIOUS submission, before the
  // user has done anything this time.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setDone(false);
  }, [open]);

  if (!open) return null;

  async function onSubmit() {
    setBusy(true);
    setError(null);
    try {
      await blockPlayer(gamertag);
      setDone(true);
    } catch {
      setError("We couldn't block that player. Nothing was changed — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark/80 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Block ${gamertag}`}
        tabIndex={-1}
        className="w-full max-w-md border border-red-deep bg-paper p-5"
      >
        <h2 className="font-display text-sm font-bold uppercase tracking-[.14em]">
          {done ? "Blocked" : `Block ${gamertag}?`}
        </h2>
        {/* ⚠️ Both consequences, stated plainly. A block that only half-works is worse than
         *  none, because the person believes they are protected. The last sentence matters too:
         *  a block that notifies is a block that invites retaliation. */}
        <p className="mt-2 font-mono text-[11.5px] uppercase leading-relaxed tracking-[.03em] text-ink-muted">
          Blocking hides their avatar from you, and stops location sharing between you both ways.
          They are not told.
        </p>
        {error && (
          <p role="alert" className="mt-3 font-mono text-[11.5px] uppercase text-red-deep">
            {error}
          </p>
        )}
        <div className="mt-5 flex gap-3">
          {done ? (
            <button type="button" onClick={onClose} className="border border-ink px-4 py-2 font-mono text-xs uppercase">
              Close
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void onSubmit()}
                disabled={busy}
                className="border border-red-deep px-4 py-2 font-mono text-xs uppercase text-red-deep disabled:opacity-40"
              >
                Block player
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="border border-ink px-4 py-2 font-mono text-xs uppercase disabled:opacity-40"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
