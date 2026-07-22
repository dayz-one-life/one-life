"use client";
import type { ReactNode } from "react";

/**
 * The thumb-reachable half of the map's chrome, below `md` only.
 *
 * The top of a full-viewport application is the hardest place on a phone for a thumb to reach,
 * and the map is the one surface a player uses one-handed while doing something else. So Locate
 * and Friends live down here on a phone and in the top bar from `md` up — they MOVE, they are
 * never rendered in both places at once.
 *
 * ⚠️ Deliberately IN THE FLOW, not an overlay: the map region simply gets shorter. An absolutely
 * positioned bar would float controls over terrain and would need a z-index, and the app has
 * exactly three altitudes (LAYER LEGEND at the `<header>` in components/header.tsx). Ordinary
 * flow content needs none of them.
 *
 * ⚠️ DARK SURFACE, like the bar it mirrors — paper/cream tokens, never ink.
 */
export function MapBottomBar({ chip, children }: {
  /** The grid-reference readout. It is a copy button, so it belongs within thumb reach. */
  chip: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-16 w-full shrink-0 items-center justify-between gap-2 border-t border-dark-edge bg-dark px-3 pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="flex min-w-0 items-center">{chip}</div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}
