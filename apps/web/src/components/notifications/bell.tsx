"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAccountStatus } from "@/lib/use-account-status";
import { useNotifications, useNotificationSeen } from "@/lib/use-notifications";
import { useModalBehavior } from "@/lib/use-modal-behavior";
import { NotificationsPopover } from "./popover";

function BellGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Badge({ count }: { count: number }) {
  return (
    <span
      data-testid="bell-badge"
      aria-hidden
      className="pointer-events-none absolute -right-0.5 -top-0.5 min-w-[18px] bg-red px-1 py-px text-center font-mono text-[10px] font-bold leading-[14px] text-paper"
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

/** The masthead bell (spec §3.1). Signed-in only; renders before verification so the
 *  gamertag_verified notification has somewhere to land. Mobile: a plain link to
 *  /notifications. Desktop (md+): toggles the anchored popover. A broken query must never
 *  break the header — error states render inside the popover, never here. */
export function MastheadBell() {
  const status = useAccountStatus();
  const signedIn = status.kind === "unlinked" || status.kind === "pending" || status.kind === "verified";
  const n = useNotifications();
  const [open, setOpen] = useState(false);
  const panelRef = useModalBehavior(open, () => setOpen(false));
  const rootRef = useRef<HTMLDivElement>(null);

  // Row clicks navigate AND dismiss — the sheet-over-destination bug class cannot recur.
  const pathname = usePathname();
  const prevPath = useRef(pathname);
  useEffect(() => {
    if (pathname !== prevPath.current) {
      prevPath.current = pathname;
      setOpen(false);
    }
  }, [pathname]);

  // Outside click closes (useModalBehavior covers Escape/focus).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // The popover shows page 1 only, so only page 1 is ever reported seen (invariant #6).
  const seen = useNotificationSeen(n.firstPage, open, n.markRead);

  if (!signedIn) return null;
  const label = n.unreadCount > 0 ? `Notifications, ${n.unreadCount} unread` : "Notifications";

  // No self-positioning here: this renders as a plain inline control inside the masthead's
  // right cluster (`header.tsx`), alongside `MobileAccount`'s trigger. `relative` is kept —
  // it's the popover's anchor and the badge's positioning context, not page positioning.
  return (
    <div ref={rootRef} className="relative">
      <Link href="/notifications" aria-label={label} className="block p-2 text-paper md:hidden">
        <BellGlyph />
      </Link>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="hidden p-2 text-paper hover:text-red-soft md:flex"
      >
        <BellGlyph />
      </button>
      {n.unreadCount > 0 && <Badge count={n.unreadCount} />}
      {open && (
        <NotificationsPopover
          items={n.firstPage}
          unreadIds={seen}
          now={new Date()}
          error={n.error}
          panelRef={panelRef}
        />
      )}
    </div>
  );
}
