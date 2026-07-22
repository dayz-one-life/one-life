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
    // 64px below `md`, 48 above. Sized from real use rather than from the 44px accessibility
    // floor: 44 was measured on a phone and still read as fiddly, so the touch targets are 52
    // and the bar has room to hold them. The map is the one screen used one-handed in a hurry.
    <header className="relative z-40 flex h-[calc(4rem+env(safe-area-inset-top))] w-full min-w-0 shrink-0 items-center gap-2 border-b border-dark-edge bg-dark px-3 pt-[env(safe-area-inset-top)] md:h-[calc(3rem+env(safe-area-inset-top))] md:px-4">
      <Link
        href="/"
        aria-label="Back to One Life"
        className="flex min-h-[52px] shrink-0 items-center pr-2 text-paper md:min-h-0"
      >
        {/* No arrow: the wordmark IS the way home, as it is in the masthead, and the label
            below carries the "back" meaning for anyone who cannot see it.
            `alt=""` is load-bearing: the link already carries the name, and an alt of
            "One Life" on top of it makes the accessible name "Back to One Life One Life".
            Intrinsic width/height so the bar cannot shift as the image loads — the same
            pattern as the masthead's wordmark. */}
        <img
          src="/brand/wordmark-primary@2x.png"
          alt=""
          width={1641}
          height={499}
          className="h-[32px] w-auto md:h-[20px]"
        />
      </Link>
      <MapSwitcher slug={slug} servers={servers} loading={serversLoading} />
      <div className="ml-auto flex shrink-0 items-center gap-1">{children}</div>
    </header>
  );
}
