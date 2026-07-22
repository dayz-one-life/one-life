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
    // 56px below `md`, 48 above: a 44px touch target needs room to sit in, and the phone is
    // where this bar is actually used one-handed.
    <header className="relative z-40 flex h-[calc(3.5rem+env(safe-area-inset-top))] w-full min-w-0 shrink-0 items-center gap-2 border-b border-dark-edge bg-dark px-2 pt-[env(safe-area-inset-top)] md:h-[calc(3rem+env(safe-area-inset-top))] md:px-4">
      <Link
        href="/"
        aria-label="Back to One Life"
        className="flex min-h-[44px] shrink-0 items-center gap-1.5 px-1 text-paper"
      >
        <span aria-hidden className="font-display text-base font-bold">←</span>
        {/* The arrow STAYS. This is the only exit from a shell with no other chrome, and a
            bare wordmark reads as a logo rather than as a way out.
            `alt=""` is load-bearing: the link already carries the name, and an alt of
            "One Life" on top of it makes the accessible name "Back to One Life One Life".
            Intrinsic width/height so the bar cannot shift as the image loads — the same
            pattern as the masthead's wordmark. */}
        <img
          src="/brand/wordmark-primary@2x.png"
          alt=""
          width={1641}
          height={499}
          className="h-[18px] w-auto md:h-[20px]"
        />
      </Link>
      <MapSwitcher slug={slug} servers={servers} loading={serversLoading} />
      <div className="ml-auto flex shrink-0 items-center gap-1">{children}</div>
    </header>
  );
}
