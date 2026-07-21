"use client";
import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useModalBehavior } from "@/lib/use-modal-behavior";
import { NAV_ITEMS, activeNavKey } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { MastheadBell } from "@/components/notifications/bell";
import { MobileAccount } from "@/components/controls/mobile-account";

function NavLinks({ active, onNavigate, className }: {
  active: string | null; onNavigate?: () => void; className?: string;
}) {
  return (
    <>
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          onClick={onNavigate}
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
  const [open, setOpen] = useState(false);
  const panelRef = useModalBehavior(open, () => setOpen(false));

  return (
    // `relative z-50` is load-bearing, not decoration: the bell popover's own `z-50` only
    // ranks it inside the right cluster, whose `-translate-y-1/2` opens a stacking context.
    // Without a layer here, every later positioned-at-z-auto element paints over the
    // popover — the `xl:sticky` ControlsRail and the `relative` article-hero image wrappers.
    <header className="relative z-50 bg-dark">
      <div className="relative flex items-center justify-center px-4 pt-5 md:pt-7">
        <button
          type="button"
          aria-label="Open menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="absolute left-4 flex flex-col gap-[5px] p-2 md:hidden"
        >
          <span aria-hidden className="block h-[3px] w-6 bg-paper" />
          <span aria-hidden className="block h-[3px] w-6 bg-paper" />
          <span aria-hidden className="block h-[3px] w-4 bg-red" />
        </button>
        <Link href="/" aria-label="One Life — home">
          <img
            src="/brand/wordmark-primary@2x.png"
            alt="One Life"
            width={1641}
            height={499}
            className="h-auto w-[150px] md:w-[280px]"
          />
        </Link>
        {/* The bell and the account trigger share one right-cluster wrapper — each used to
         *  self-position `absolute right-4`, which made them collide. Only this wrapper
         *  positions itself now; both children render as plain inline controls (see
         *  bell.tsx / mobile-account.tsx). */}
        <div className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-1 md:top-auto md:translate-y-0">
          <MastheadBell />
          <MobileAccount />
        </div>
      </div>

      <nav
        aria-label="Primary"
        className="mt-4 hidden justify-center gap-9 border-t border-dark-line py-3 font-display text-[15px] font-semibold uppercase tracking-[.12em] md:flex"
      >
        <NavLinks active={active} />
      </nav>
      {/* Mobile masthead has no nav row; the hamburger opens the menu (design 10b). */}
      <div className="mt-4 border-t border-dark-line md:hidden" />

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          ref={panelRef}
          tabIndex={-1}
          className="fixed inset-0 z-50 flex flex-col items-center gap-8 bg-dark pt-24"
        >
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute right-5 top-5 p-2 font-display text-2xl text-paper"
          >
            <span aria-hidden>×</span>
          </button>
          <nav aria-label="Primary" className="flex flex-col items-center gap-8 font-display text-2xl font-semibold uppercase tracking-[.12em]">
            <NavLinks active={active} onNavigate={() => setOpen(false)} />
          </nav>
        </div>
      )}
    </header>
  );
}
