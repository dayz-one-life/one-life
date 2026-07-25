"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, activeNavKey } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { MastheadBell } from "@/components/notifications/bell";
import { AccountAffordance } from "@/components/shell/account-affordance";

function NavLinks({ active, className }: { active: string | null; className?: string }) {
  return (
    <>
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={active === item.key ? "page" : undefined}
          className={cn(active === item.key ? "text-red" : "text-paper hover:text-red", className)}
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
    //   z-auto  page content — incl. the `xl:sticky` HomeSidebar (`account/home-sidebar.tsx`) and
    //           the `relative` image wrappers. NOTE: `sticky` opens a stacking context regardless
    //           of z-index, and z-auto contexts still paint in tree order, so any of these
    //           positioned LATER in the DOM paints over an unlayered masthead.
    //   z-40    chrome — this masthead AND the mobile TabBar (`shell/tab-bar.tsx`). They never
    //           overlap spatially, so they share a layer. Load-bearing, not decoration: the bell
    //           popover's own `z-50` only ranks it INSIDE the right cluster, whose
    //           `-translate-y-1/2` opens a stacking context; without a layer here the popover
    //           paints behind page content.
    //   z-50    full-screen overlays that must cover the chrome: the skip-to-content link
    //           (`app/layout.tsx`, which renders BEFORE the header and so would lose a z-50 tie).
    // Keep the masthead strictly BELOW 50 — an equal value leaves that decided by DOM order.
    <header className="relative z-40 bg-dark">
      <div className="relative flex items-center justify-center px-4 pt-5 md:pt-7">
        <Link href="/" aria-label="One Life — home">
          <img
            src="/brand/wordmark-primary@2x.png"
            alt="One Life"
            width={1641}
            height={499}
            className="h-auto w-[150px] md:w-[280px]"
          />
        </Link>
        {/* The bell and the account control share one right-cluster wrapper — each used to
         *  self-position `absolute right-4`, which made them collide. Only this wrapper
         *  positions itself; both children render as plain inline controls. */}
        <div className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-1 md:top-auto md:translate-y-0">
          <MastheadBell />
          <AccountAffordance />
        </div>
      </div>

      <nav
        aria-label="Primary"
        className="mt-4 hidden justify-center gap-9 border-t border-dark-line py-3 font-display text-[15px] font-semibold uppercase tracking-[.12em] md:flex"
      >
        <NavLinks active={active} />
      </nav>
      {/* Below md the nav row is replaced by the TabBar (shell/tab-bar.tsx), which carries Home,
       *  Map, Board and the account destinations. About lives in the footer. */}
      <div className="mt-4 border-t border-dark-line md:hidden" />
    </header>
  );
}
