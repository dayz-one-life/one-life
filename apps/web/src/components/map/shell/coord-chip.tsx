"use client";
import { useEffect, useRef, useState } from "react";
import { gridRef } from "@/lib/map-grid";

/** The grid reference under the centre crosshair.
 *
 *  Deliberately NOT a live region: this updates on every animation frame of a pan, and a
 *  polite live region would read a new coordinate continuously. The value is available on
 *  demand through the copy button's accessible name — which is also the point of a readout,
 *  since you read a coordinate in order to send it to someone. */
export function CoordChip({ world }: { world: { x: number; y: number } | null }) {
  const [copied, setCopied] = useState(false);
  // Cleared on unmount: the chip disappears whenever the friend query errors or the route
  // changes, and a pending setCopied would then fire against a gone component.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  if (!world) return null;
  const ref = gridRef(world.x, world.y);

  async function copy() {
    try {
      await navigator.clipboard.writeText(ref);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // A denied clipboard permission must not break the readout; the value stays on screen.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy grid reference ${ref}`}
      // Position is the CALLER's business: in the bottom bar it is ordinary flow content, and
      // over the map (md and up) the wrapper positions it. Only the box lives here.
      className="flex min-h-[52px] items-center border border-dark-edge bg-dark px-4 py-1 font-mono text-[15px] uppercase tracking-[.08em] tabular-nums text-paper md:min-h-0 md:px-2 md:text-[11px]"
    >
      {copied ? "Copied" : ref}
    </button>
  );
}
