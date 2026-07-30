"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { NAV_ITEMS, activeNavKey } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { getServers } from "@/lib/api";
import type { Server } from "@/lib/types";
import { MastheadBell } from "@/components/notifications/bell";
import { AccountAffordance } from "@/components/shell/account-affordance";
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

function NavLinks({ active, className }: { active: string | null; className?: string }) {
  return (
    <>
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={active === item.key ? "page" : undefined}
          className={cn(
            "border-b-2 pb-0.5",
            active === item.key
              ? "border-red text-paper"
              : "border-transparent text-cream-dim hover:text-paper",
            className,
          )}
        >
          {item.label}
        </Link>
      ))}
    </>
  );
}

export function Masthead() {
  const pathname = usePathname();
  const active = activeNavKey(pathname ?? "/");

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
    <header className="relative z-40 bg-dark">
      {/* Same box as (boxed)/layout.tsx — on an ultrawide the wordmark must align with the content edge, not the viewport edge. The dark bar itself stays full-bleed. */}
      <div className="mx-auto flex h-14 w-full max-w-[1440px] items-center gap-7 px-4 md:px-6 xl:px-10">
        <Link href="/" aria-label="One Life — home" className="flex-none">
          <img
            src="/brand/wordmark-primary@2x.png"
            alt="One Life"
            width={1641}
            height={499}
            className="h-auto w-[105px]"
          />
        </Link>
        {/* Below md the nav is the TabBar (shell/tab-bar.tsx): Home, Map, Board and the account
         *  destinations. About lives in the footer. */}
        <nav
          aria-label="Primary"
          className="hidden items-center gap-6 font-mono text-[11px] uppercase tracking-[.13em] md:flex"
        >
          <NavLinks active={active} />
        </nav>
        {/* The bell and the account control share one right cluster; both render as plain
         *  inline controls (they used to self-position absolutely and collided). */}
        <div className="ml-auto flex min-w-0 flex-none items-center gap-2">
          <MastheadMapSwitcher pathname={pathname ?? "/"} />
          <MastheadBell />
          <AccountAffordance />
        </div>
      </div>
    </header>
  );
}
