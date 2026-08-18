"use client";

import { useEffect, useState } from "react";
import { REPORT_REASONS, type ReportReason } from "@onelife/api-client";
import { reportAvatar } from "@/lib/api";
import { useModalBehavior } from "@/lib/use-modal-behavior";

/** ⚠️ A FIXED list. A free-text reason box would itself be a UGC surface — putting one inside
 *  the moderation feature would be self-defeating. Labels are keyed off `REPORT_REASONS` (the
 *  server's actual enum, re-exported as a value from `@onelife/api-client`) rather than
 *  hand-duplicated, so a change to the enum is a type error here, not a silent runtime
 *  mismatch. */
const LABELS: Record<ReportReason, string> = {
  sexual: "Sexual or nudity",
  violent: "Violent or graphic",
  hate: "Hateful or harassing",
  illegal: "Illegal content",
  impersonation: "Impersonation",
  other: "Something else",
};
const REASONS = REPORT_REASONS.map((value) => ({ value, label: LABELS[value] }));

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
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Same shell as `DeleteAccountDialog`/`ClaimModal`: focus moves into the panel on open and
  // back to the opener on close, Escape closes, Tab is trapped, body scroll is locked. Called
  // unconditionally (before the `!open` bail below) for hooks-order safety; the hook itself
  // no-ops while `open` is false.
  const panelRef = useModalBehavior(open, onClose);

  // ⚠️ This dialog is mounted once (by `ReportBlockMenu`) and toggled purely via `open` — it is
  // never unmounted between uses. Without this, a second open would reopen straight onto a
  // stale "Reported" screen or a stale error banner from the PREVIOUS submission, before the
  // user has done anything this time. That is exactly the lie this whole feature exists to
  // prevent: a confirmation shown before a real submit.
  useEffect(() => {
    if (!open) return;
    setReason(null);
    setError(null);
    setDone(false);
  }, [open]);

  if (!open) return null;

  async function onSubmit() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await reportAvatar(avatarHash, reason);
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
