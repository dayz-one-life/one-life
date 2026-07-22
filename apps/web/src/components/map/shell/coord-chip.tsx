"use client";
import { useState } from "react";
import { gridRef } from "@/lib/map-grid";

/** The grid reference under the centre crosshair.
 *
 *  Deliberately NOT a live region: this updates on every animation frame of a pan, and a
 *  polite live region would read a new coordinate continuously. The value is available on
 *  demand through the copy button's accessible name — which is also the point of a readout,
 *  since you read a coordinate in order to send it to someone. */
export function CoordChip({ world }: { world: { x: number; y: number } | null }) {
  const [copied, setCopied] = useState(false);
  if (!world) return null;
  const ref = gridRef(world.x, world.y);

  async function copy() {
    try {
      await navigator.clipboard.writeText(ref);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // A denied clipboard permission must not break the readout; the value stays on screen.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy grid reference ${ref}`}
      className="pointer-events-auto absolute bottom-3 left-3 z-10 border border-dark-edge bg-dark px-2 py-1 font-mono text-[11px] uppercase tracking-[.08em] tabular-nums text-paper"
    >
      {copied ? "Copied" : ref}
    </button>
  );
}
