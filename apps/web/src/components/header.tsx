"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getServers } from "@/lib/api";
import type { Server } from "@/lib/types";
import { MastheadBell } from "@/components/notifications/bell";
import { AccountAffordance } from "@/components/shell/account-affordance";
import { NavMenu } from "@/components/shell/nav-menu";
import { MapSwitcher } from "@/components/map/shell/map-switcher";

/** The map switcher, in the masthead — the mock's rule for `/maps/[map]`: "the dropdown is the
 *  only header addition". It renders ONLY on a map route, so the servers query is gated on that
 *  and costs every other page nothing (and shares the `["servers"]` cache with the map page). */
function MastheadMapSwitcher({ pathname }: { pathname: string }) {
  const seg = /^\/maps\/([^/]+)$/.exec(pathname)?.[1];
  const slug = seg ? decodeURIComponent(seg) : null;
  const servers = useQuery({ queryKey: ["servers"], queryFn: getServers, enabled: slug !== null });
  if (slug === null) return null;
  const mapServers = servers.data
    ?.filter((s): s is Server & { slug: string } => Boolean(s.slug))
    .map((s) => ({ slug: s.slug, name: s.name }));
  return <MapSwitcher slug={slug} servers={mapServers} loading={servers.isPending} />;
}

export function Masthead() {
  const pathname = usePathname();

  return (
    // ⚠️ LAYER LEGEND — the app has exactly three altitudes, and they must stay in this order:
    //   z-auto  page content — incl. the `relative` image wrappers. NOTE: `sticky` and
    //           `position`ed elements open a stacking context regardless of z-index, and z-auto
    //           contexts still paint in tree order, so any of these positioned LATER in the DOM
    //           paints over an unlayered masthead. (The `xl:sticky` HomeSidebar that used to be
    //           the worked example here is gone — home is one column now — but the hazard is a
    //           property of `sticky`, not of that component, so the note stays.)
    //   z-40    chrome — this masthead AND the mobile TabBar (`shell/tab-bar.tsx`). They never
    //           overlap spatially, so they share a layer. Load-bearing, not decoration: the bell
    //           popover's own `z-50` only ranks it INSIDE the right cluster, whose
    //           `-translate-y-1/2` opens a stacking context; without a layer here the popover
    //           paints behind page content.
    //   z-50    full-screen overlays that must cover the chrome: the skip-to-content link
    //           (`app/layout.tsx`, which renders BEFORE the header and so would lose a z-50 tie).
    // Keep the masthead strictly BELOW 50 — an equal value leaves that decided by DOM order.
    // One compact app bar, per the design mocks (verified-desktop/pure-app-ia): wordmark left,
    // nav inline beside it, bell + avatar right — the two-tier tabloid masthead (big centered
    // wordmark over a nav row) is retired with the tabloid.
    //   ⚠️ The masthead is `sticky top-0`. Sticky opens a stacking context on its own, but the
    //   explicit z-40 above predates that (the bell popover needs it) and still governs.
    <header className="sticky top-0 z-40 bg-dark">
      {/* Same box as (boxed)/layout.tsx, plus the house prose inset (px-6 md:px-10) so the
          wordmark aligns with page text rather than the box edge. The dark bar stays full-bleed. */}
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-7 px-6 md:px-10">
        <Link href="/" aria-label="One Life — home" className="flex-none">
          <img
            src="/brand/wordmark-primary@2x.png"
            alt="One Life"
            width={1641}
            height={499}
            className="h-auto w-[105px]"
          />
        </Link>
        {/* The bell and the account control share one right cluster; both render as plain
         *  inline controls (they used to self-position absolutely and collided). */}
        <div className="ml-auto flex min-w-0 flex-none items-center gap-2">
          <MastheadMapSwitcher pathname={pathname ?? "/"} />
          <MastheadBell />
          <AccountAffordance />
          <NavMenu />
        </div>
      </div>
    </header>
  );
}
