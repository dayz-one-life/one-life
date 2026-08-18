"use client";

import { useEffect, useState } from "react";
import {
  getModerationQueue,
  restoreAvatarHash,
  confirmAvatarHash,
  moderationImageSrc,
  getMe,
} from "@/lib/api";
import type { ModerationEntry } from "@onelife/api-client";

/** ⚠️ FOUR renders. `empty` and `failed` must never collapse: a queue that failed to load but
 *  reads as "nothing waiting" means reports sit unreviewed while the moderator believes the
 *  page is clean — the one failure auto-hide cannot absorb. */
type State =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "empty" }
  | { kind: "loaded"; entries: ModerationEntry[] };

export function ModerationBody() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [allowed, setAllowed] = useState<boolean | null>(null);
  // Which hashes the moderator has explicitly chosen to reveal. Never mounted an <img> before
  // this — this page is BY CONSTRUCTION a list of things someone reported as objectionable, so
  // auto-loading them would put that content on screen unbidden.
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  // Confirm is a two-step, irreversible action: the first click only "arms" the row, the second
  // (a differently-labelled button) actually destroys the bytes. `armed` holds at most one hash
  // at a time, so arming a new row disarms any other.
  const [armed, setArmed] = useState<string | null>(null);
  // Rows currently mid-action (restore or confirm). Tracked per hash so a second click on the
  // SAME row while its request is in flight is a no-op, without disabling any other row.
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState(false);

  // The actual fetch, shared by the initial load and post-action revalidation. Does NOT touch
  // `loading` itself — callers decide whether a loading flash is appropriate.
  async function fetchAndApply() {
    try {
      const { entries } = await getModerationQueue();
      setState(entries.length === 0 ? { kind: "empty" } : { kind: "loaded", entries });
    } catch {
      setState({ kind: "failed" });
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const me = await getMe();
        setAllowed(Boolean(me.isModerator));
        if (me.isModerator) {
          setState({ kind: "loading" });
          await fetchAndApply();
        }
      } catch {
        setAllowed(false);
      }
    })();
  }, []);

  async function onRestore(hash: string) {
    if (pending.has(hash)) return;
    setPending((prev) => new Set(prev).add(hash));
    setActionError(false);
    try {
      await restoreAvatarHash(hash);
      // Revalidate in place — the list stays on screen while this resolves, it does not flash
      // back to the `loading` render (that would wipe out every untouched row, not just this one).
      await fetchAndApply();
    } catch {
      setActionError(true);
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(hash);
        return next;
      });
    }
  }

  async function onConfirm(hash: string) {
    if (pending.has(hash)) return;
    setPending((prev) => new Set(prev).add(hash));
    setActionError(false);
    try {
      await confirmAvatarHash(hash);
      setArmed(null);
      await fetchAndApply();
    } catch {
      setActionError(true);
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(hash);
        return next;
      });
    }
  }

  if (allowed === null) {
    return (
      <main className="w-full px-6 py-10 md:px-10">
        <p className="font-mono text-[11.5px] uppercase text-ink-muted">Loading…</p>
      </main>
    );
  }

  // Display only. Every moderation route re-checks server-side, so this is courtesy — it keeps
  // a non-moderator from staring at a broken page, and grants nothing on its own.
  if (!allowed) {
    return (
      <main className="w-full px-6 py-10 md:px-10">
        <p className="font-mono text-[11.5px] uppercase text-ink-muted">
          You don&apos;t have access to this page.
        </p>
      </main>
    );
  }

  return (
    <main className="w-full px-6 py-10 md:px-10">
      <h1 className="font-display text-4xl font-bold uppercase tracking-[.02em] text-ink">
        Moderation queue
      </h1>

      {state.kind === "loading" && (
        <p className="mt-4 font-mono text-[11.5px] uppercase text-ink-muted">Loading…</p>
      )}
      {state.kind === "failed" && (
        <p role="alert" className="mt-4 font-mono text-[11.5px] uppercase text-red-deep">
          We couldn&apos;t load the queue. Reports may be waiting — try again.
        </p>
      )}
      {state.kind === "empty" && (
        <p className="mt-4 font-mono text-[11.5px] uppercase text-ink-muted">
          Nothing waiting for review.
        </p>
      )}
      {state.kind === "loaded" && actionError && (
        <p role="alert" className="mt-4 font-mono text-[11.5px] uppercase text-red-deep">
          That action didn&apos;t go through. Try again shortly.
        </p>
      )}

      {state.kind === "loaded" && (
        <ul role="list" className="mt-6">
          {state.entries.map((e) => {
            const reasons = Array.from(new Set(e.reasons));
            const isPending = pending.has(e.hash);
            // A "confirmed" row already had its bytes destroyed by a prior takedown — the
            // server only filters out "allowed" rows, so confirmed ones stay in the queue
            // response. Offering Show image / Restore / Confirm removal on it can only mislead:
            // Show image 404s, and Restore would report success while restoring nothing because
            // the bytes are gone. There is no action left to take, so none is offered.
            const isConfirmed = e.state === "confirmed";
            return (
              // Confirmed rows are visibly muted (dimmed, no red accents) so a moderator
              // scanning the queue can tell at a glance which rows still need judgment (auto,
              // full contrast) versus which are already settled (confirmed, dimmed).
              <li
                key={e.hash}
                className={`border-t border-ink/10 py-4 ${isConfirmed ? "opacity-50" : ""}`}
              >
                <p className="font-mono text-[11.5px] uppercase text-ink-muted">
                  {e.hash} · {e.reportCount} reports · {reasons.join(", ")}
                </p>

                {isConfirmed ? (
                  <p className="mt-3 font-mono text-xs font-bold uppercase text-ink-muted">
                    Already permanently removed — its image is gone, nothing left to review.
                  </p>
                ) : (
                  <>
                    {/* Click-to-reveal, never inline. Every row here is something a person
                        reported as objectionable; a wall of them is a page the moderator learns
                        to avoid. */}
                    {revealed.has(e.hash) ? (
                      <img
                        src={moderationImageSrc(e.hash)}
                        alt="Reported avatar"
                        width={96}
                        height={96}
                        className="mt-3 rounded-full border border-ink"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setRevealed((s) => new Set(s).add(e.hash))}
                        className="mt-3 border border-ink px-3 py-1 font-mono text-xs uppercase"
                      >
                        Show image
                      </button>
                    )}

                    <div className="mt-3 flex gap-3">
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => void onRestore(e.hash)}
                        className="border border-ink px-3 py-1 font-mono text-xs uppercase disabled:opacity-50"
                      >
                        Restore
                      </button>
                      {/* Two-step: confirm DESTROYS the bytes and cannot be undone, so a single
                          click must never trigger it. The first click only arms this row — a
                          different button, with different wording, does the irreversible part. */}
                      {armed === e.hash ? (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => void onConfirm(e.hash)}
                          className="border border-red-deep px-3 py-1 font-mono text-xs uppercase text-red-deep disabled:opacity-50"
                        >
                          Permanently delete
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setArmed(e.hash)}
                          className="border border-red-deep px-3 py-1 font-mono text-xs uppercase text-red-deep"
                        >
                          Confirm removal
                        </button>
                      )}
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
