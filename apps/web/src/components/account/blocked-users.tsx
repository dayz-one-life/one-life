"use client";

import { useEffect, useState } from "react";
import { getBlocks, unblockPlayer } from "@/lib/api";
import type { BlockedPlayer } from "@onelife/api-client";

/** ⚠️ FOUR renders. `empty` and `failed` must never collapse together: "you haven't blocked
 *  anyone" shown because the fetch failed tells someone they are unprotected when they are not. */
type State =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "empty" }
  | { kind: "loaded"; blocks: BlockedPlayer[] };

export function BlockedUsers() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [unblockError, setUnblockError] = useState(false);
  // Rows currently mid-unblock. Tracked per gamertag so a second click on the SAME row while its
  // request is still in flight is ignored (no duplicate request, no false "couldn't unblock" from
  // the second call landing on an already-gone block) without disabling any other row.
  const [pending, setPending] = useState<Set<string>>(new Set());

  // The actual fetch, shared by the initial load and post-unblock revalidation. Does NOT touch
  // `loading` itself — callers decide whether a loading flash is appropriate.
  async function fetchAndApply() {
    try {
      const { blocks } = await getBlocks();
      setState(blocks.length === 0 ? { kind: "empty" } : { kind: "loaded", blocks });
    } catch {
      setState({ kind: "failed" });
    }
  }

  useEffect(() => {
    // Initial mount: the `loading` render is one of the four states and is test-pinned, so this
    // path (and only this path) flashes to it before fetching.
    setState({ kind: "loading" });
    void fetchAndApply();
  }, []);

  async function onUnblock(gamertag: string) {
    if (pending.has(gamertag)) return;
    setPending((prev) => new Set(prev).add(gamertag));
    setUnblockError(false);
    try {
      await unblockPlayer(gamertag);
      // Revalidate in place — the list stays on screen while this resolves, it does not flash
      // back to the `loading` render (that would wipe out every untouched row, not just this one).
      await fetchAndApply();
    } catch {
      // Leave the row in place — an optimistic removal here would let a failed unblock look
      // like it worked. Surface the failure instead so the player isn't left guessing.
      setUnblockError(true);
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(gamertag);
        return next;
      });
    }
  }

  return (
    <section className="mt-10 border border-ink/20 px-5 py-4">
      <h2 className="font-display text-sm font-bold uppercase tracking-[.14em]">Blocked players</h2>
      {state.kind === "loading" && (
        <p className="mt-2 font-mono text-[11.5px] uppercase text-ink-muted">Loading…</p>
      )}
      {state.kind === "failed" && (
        <p role="alert" className="mt-2 font-mono text-[11.5px] uppercase text-red-deep">
          We couldn&apos;t load your blocked players. Try again shortly.
        </p>
      )}
      {state.kind === "empty" && (
        <p className="mt-2 font-mono text-[11.5px] uppercase text-ink-muted">
          You haven&apos;t blocked anyone.
        </p>
      )}
      {state.kind === "loaded" && unblockError && (
        <p role="alert" className="mt-2 font-mono text-[11.5px] uppercase text-red-deep">
          Couldn&apos;t unblock that player. Try again shortly.
        </p>
      )}
      {state.kind === "loaded" && (
        <ul role="list" className="mt-3">
          {state.blocks.map((b) => (
            <li
              key={`${b.gamertag}-${b.createdAt}`}
              className="flex items-center justify-between border-t border-ink/10 py-2"
            >
              {/* The gamertag is a server-side snapshot from block time, so it is always here —
                  even if that account has since unlinked. That is what keeps the row removable. */}
              <span className="font-mono text-[11.5px] uppercase">{b.gamertag}</span>
              <button
                type="button"
                disabled={pending.has(b.gamertag)}
                onClick={() => void onUnblock(b.gamertag)}
                className="border border-ink px-3 py-1 font-mono text-xs uppercase disabled:opacity-50"
              >
                Unblock
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
