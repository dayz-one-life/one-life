"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import type { MapServerDto } from "@/lib/types";
import { MapSwitcher } from "./map-switcher";

/** The map application's only chrome.
 *
 *  ⚠️ LAYER LEGEND (see components/header.tsx): this route renders no masthead, so THIS is the
 *  z-40 occupant. The friends sheet is the z-50 overlay. Do not add a fourth altitude.
 *
 *  The back link is not decoration: the shell replaces the site chrome entirely, so this is the
 *  only way off the map. */
export function TopBar({ slug, servers, serversLoading, children }: {
  slug: string;
  servers?: MapServerDto[];
  serversLoading: boolean;
  children?: ReactNode;
}) {
  return (
    // `h-[calc(3rem+inset)]`, NOT `h-12` + `pt-inset`: under border-box the padding would be
    // SUBTRACTED from the 48px box, and on a notched phone in PWA mode (~47px inset) that
    // collapses the row to about 1px. `min-w-0` on the row so a long map name truncates rather
    // than pushing the friends panel — the only route to the accessible legend — off-screen.
    <header className="relative z-40 flex h-[calc(3rem+env(safe-area-inset-top))] w-full min-w-0 shrink-0 items-center gap-2 border-b border-dark-edge bg-dark px-2 pt-[env(safe-area-inset-top)] md:px-4">
      <Link
        href="/"
        aria-label="Back to One Life"
        className="flex shrink-0 items-center gap-2 px-1 font-display text-sm font-bold uppercase text-paper"
      >
        <span aria-hidden>←</span>
        <span className="hidden md:inline">One Life</span>
      </Link>
      <MapSwitcher slug={slug} servers={servers} loading={serversLoading} />
      <div className="ml-auto flex shrink-0 items-center gap-1">{children}</div>
    </header>
  );
}
