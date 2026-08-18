"use client";

import { useState } from "react";
import { reportAvatar } from "@/lib/api";
import { useModalBehavior } from "@/lib/use-modal-behavior";

/** ⚠️ A FIXED list. A free-text reason box would itself be a UGC surface — putting one inside
 *  the moderation feature would be self-defeating. Values match `ReportReason` in
 *  `@onelife/api-client` exactly; the cast in `onSubmit` below relies on that. */
const REASONS = [
  { value: "sexual", label: "Sexual or nudity" },
  { value: "violent", label: "Violent or graphic" },
  { value: "hate", label: "Hateful or harassing" },
  { value: "illegal", label: "Illegal content" },
  { value: "impersonation", label: "Impersonation" },
  { value: "other", label: "Something else" },
] as const;

export function ReportDialog({
  open,
  gamertag,
  avatarHash,
  onClose,
}: {
  open: boolean;
  gamertag: string;
  avatarHash: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Same shell as `DeleteAccountDialog`/`ClaimModal`: focus moves into the panel on open and
  // back to the opener on close, Escape closes, Tab is trapped, body scroll is locked. Called
  // unconditionally (before the `!open` bail below) for hooks-order safety; the hook itself
  // no-ops while `open` is false.
  const panelRef = useModalBehavior(open, onClose);

  if (!open) return null;

  async function onSubmit() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await reportAvatar(avatarHash, reason as (typeof REASONS)[number]["value"]);
      setDone(true);
    } catch {
      // ⚠️ Never fall through to a success message. The avatar is still up, and telling the
      // reporter otherwise means nobody reports it again.
      setError("We couldn't submit that report. The avatar is unchanged — please try again.");
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
        aria-label={`Report ${gamertag}'s avatar`}
        tabIndex={-1}
        className="w-full max-w-md border border-red-deep bg-paper p-5"
      >
        {done ? (
          <>
            <h2 className="font-display text-sm font-bold uppercase tracking-[.14em]">Reported</h2>
            {/* ⚠️ True, not reassuring-sounding. The machine really did hide it — which is also
             *  what makes a mistaken report recoverable. */}
            <p className="mt-2 font-mono text-[11.5px] uppercase leading-relaxed tracking-[.03em] text-ink-muted">
              This avatar is hidden straight away while a moderator reviews it. If it turns out to
              be fine, it goes back up.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 border border-ink px-4 py-2 font-mono text-xs uppercase"
            >
              Close
            </button>
          </>
        ) : (
          <>
            <h2 className="font-display text-sm font-bold uppercase tracking-[.14em]">Report this avatar</h2>
            <p className="mt-2 font-mono text-[11.5px] uppercase leading-relaxed tracking-[.03em] text-ink-muted">
              It is hidden immediately while a moderator reviews it.
            </p>
            <fieldset className="mt-4">
              <legend className="sr-only">Reason</legend>
              {REASONS.map((r) => (
                <label key={r.value} className="mt-2 flex items-center gap-2 font-mono text-[11.5px] uppercase">
                  <input
                    type="radio"
                    name="reason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                  />
                  {r.label}
                </label>
              ))}
            </fieldset>
            {error && (
              <p role="alert" className="mt-3 font-mono text-[11.5px] uppercase text-red-deep">
                {error}
              </p>
            )}
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => void onSubmit()}
                disabled={!reason || busy}
                className="border border-red-deep px-4 py-2 font-mono text-xs uppercase text-red-deep disabled:opacity-40"
              >
                Report avatar
              </button>
              <button type="button" onClick={onClose} className="border border-ink px-4 py-2 font-mono text-xs uppercase">
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
