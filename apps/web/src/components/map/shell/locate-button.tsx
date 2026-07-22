"use client";
import { useId, useRef } from "react";
import { worldSize, worldToLatLng } from "@/lib/dayz-projection";
import { CANVAS_PX, MAX_ZOOM, type MapFocus } from "@/components/map/map-canvas";
import type { FriendPositionDto } from "@/lib/types";

const LOCATE_ZOOM = 5;

/** Recentre on your own dot.
 *
 *  Three distinct states, never collapsed: ready, loading, and genuinely-no-position. A
 *  disabled control with no stated reason is indistinguishable from a broken one, and
 *  "loading" must not render as "you are offline" (live-data honesty). */
export function LocateButton({ self, loading, error, onLocate, mapCodename }: {
  self: FriendPositionDto | undefined;
  loading: boolean;
  /** A FAILED fetch. "You appear offline" is a claim about the game; a network error is not
   *  evidence for it, and the page would then contradict its own "Couldn't load" card. */
  error?: boolean;
  onLocate: (focus: MapFocus) => void;
  mapCodename: string;
}) {
  const nonce = useRef(0);
  const hintId = useId();
  const size = worldSize(mapCodename);
  const ready = !loading && !error && self !== undefined && size !== null;
  const hint = loading
    ? "Loading your position…"
    : error
      ? "Couldn't load your position."
      : "No live position — you appear offline, or have not been seen in game yet.";

  return (
    <>
      <button
        type="button"
        // `aria-disabled`, NOT `disabled`: a disabled button leaves the tab order, which makes
        // the stated reason unreachable by exactly the users it was written for — the control
        // then reads as absent rather than as unavailable-because-X.
        aria-disabled={!ready}
        aria-describedby={ready ? undefined : hintId}
        onClick={() => {
          if (!ready || !self || size === null) return;
          nonce.current += 1;
          // The SAME projection MapCanvas draws in, via the shared helper and the canvas's own
          // pyramid constants — never restated arithmetic, which would drift silently.
          const { lat, lng } = worldToLatLng(self.x, self.y, size, CANVAS_PX, MAX_ZOOM);
          onLocate({ lat, lng, zoom: LOCATE_ZOOM, nonce: nonce.current });
        }}
        // ⚠️ DARK SURFACE (the top bar) — paper/cream tokens, never ink.
        className={`flex min-h-[44px] min-w-[44px] items-center justify-center border border-dark-edge px-3 py-1.5 font-mono text-[13px] uppercase tracking-[.05em] md:min-h-0 md:min-w-0 md:px-2 md:text-[11px] ${
          ready ? "text-paper" : "cursor-default text-cream-muted"
        }`}
      >
        <span aria-hidden>◎</span>
        <span className="ml-1 hidden md:inline">Locate</span>
      </button>
      {!ready && <span id={hintId} className="sr-only">{hint}</span>}
    </>
  );
}
