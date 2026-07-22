"use client";
import { useState } from "react";
import { useModalBehavior } from "@/lib/use-modal-behavior";
import { FriendsMapLegend } from "@/components/map/friends-map";
import type { FriendPositionDto } from "@/lib/types";

/** Who is sharing on this map, on demand.
 *
 *  This is the ONLY home of `FriendsMapLegend` now that the map fills the viewport — and the
 *  legend is the screen-reader companion to a canvas with no text, so it must stay reachable
 *  by a real button in the tab order rather than becoming decoration behind a hover. */
export function FriendsPanel({ positions, loading, error, now }: {
  positions: FriendPositionDto[] | undefined;
  loading: boolean;
  /** A FAILED fetch. Distinct from loading and from a genuinely empty map — rendering it as
   *  "nobody is sharing" is a claim about the game made from a network error. */
  error?: boolean;
  now: Date;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useModalBehavior(open, () => setOpen(false));
  // Loading is not zero. Until the payload lands, the button carries no count at all.
  const count = loading || !positions ? null : positions.filter((p) => !p.self).length;

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        // ⚠️ DARK SURFACE (the top bar) — paper/cream tokens, never ink.
        className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 border border-dark-edge px-3 py-1.5 font-mono text-[13px] uppercase tracking-[.05em] text-paper md:min-h-0 md:min-w-0 md:px-2 md:text-[11px]"
      >
        <span aria-hidden>☰</span>
        <span className="hidden md:inline">Friends</span>
        {count !== null && <span>{count}</span>}
        {/* The visible label collapses to an icon below md, so the accessible name must not. */}
        <span className="sr-only md:hidden">Friends{count !== null ? ` ${count}` : ""}</span>
      </button>
      {open && (
        // z-50 is the overlay altitude (LAYER LEGEND, components/header.tsx) — above the z-40
        // bar this hangs from. A bottom sheet on a phone, an anchored panel from md up.
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          // Load-bearing: useModalBehavior calls panelRef.current?.focus(), which is a silent
          // no-op on a div with no tabindex — the sheet would open with focus left behind.
          tabIndex={-1}
          aria-label="Friends sharing on this map"
          className="fixed inset-x-0 bottom-0 z-50 max-h-[60dvh] overflow-y-auto border-t border-dark-edge bg-dark-well p-4 pb-[env(safe-area-inset-bottom)] md:absolute md:inset-x-auto md:bottom-auto md:right-0 md:top-full md:mt-1 md:w-72 md:border"
        >
          {/* The legend already carries cream tokens — the map shell is dark end to end, so
              there is no light variant of it to swap to. */}
          {error ? (
            <p role="status" className="font-mono text-[11px] uppercase tracking-[.05em] text-cream-muted">
              Couldn&apos;t load who is sharing.
            </p>
          ) : loading ? (
            <p role="status" className="font-mono text-[11px] uppercase tracking-[.05em] text-cream-muted">
              Loading…
            </p>
          ) : (
            <FriendsMapLegend positions={positions ?? []} now={now} />
          )}
        </div>
      )}
    </div>
  );
}
