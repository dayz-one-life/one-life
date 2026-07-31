"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, activeNavKey } from "@/lib/nav";
import { useAccountStatus } from "@/lib/use-account-status";
import { useModalBehavior } from "@/lib/use-modal-behavior";
import { signOutAndTeardownPush } from "@/lib/push";
import { playerSlug } from "@/lib/slug";
import { cn } from "@/lib/utils";

/**
 * THE navigation. Not a mobile menu — the one menu, at every width.
 *
 * It replaces two things at once: the desktop inline nav row that used to live in the masthead,
 * and `shell/tab-bar.tsx`, the fixed bottom bar below `md` (both deleted). So a width gate
 * anywhere in here leaves some breakpoint with no way to navigate.
 *
 * It also absorbed the account items from `shell/account-affordance.tsx`, which is now just the
 * avatar link. One panel: nav on top, a divider, then account.
 *
 * ⚠️ Mechanics are the old account popover's, kept verbatim because each line is a shipped bug:
 *  - the panel MUST carry `tabIndex={-1}` — `useModalBehavior` focuses it, and focusing a div
 *    with no tabindex is a silent no-op.
 *  - EVERY item closes the menu explicitly. Route-change close is not enough for `/#claim`,
 *    which from `/` changes no route: the menu would sit open on top of the claim modal it just
 *    opened, holding a second (ref-counted) body scroll-lock.
 *  - the claim items are plain <a>, never <Link>: same-page hash navigation goes through
 *    pushState, which fires no `hashchange`, so a <Link href="/#claim"> clicked while already on
 *    `/` would never open ClaimModal. From any other page this is a normal navigation and the
 *    modal's mount-time hash check catches it.
 *  - `z-50` on the panel ranks it INSIDE the z-40 masthead's stacking context. No fourth
 *    altitude — see the LAYER LEGEND in `components/header.tsx`.
 */
export function NavMenu() {
  const status = useAccountStatus();

  const [open, setOpen] = useState(false);
  const panelRef = useModalBehavior(open, () => setOpen(false));
  const rootRef = useRef<HTMLDivElement>(null);

  const pathname = usePathname();
  const active = activeNavKey(pathname ?? "/");
  const prevPath = useRef(pathname);
  useEffect(() => {
    if (prevPath.current !== pathname) setOpen(false);
    prevPath.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Minimal roving-focus menu contract: focus the first item on open, then Arrow/Home/End move
  // focus between items (wrapping). Escape/outside-click/route-close are handled above already.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    items[0]?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLElement);
      let next: number;
      if (e.key === "Home") next = 0;
      else if (e.key === "End") next = items.length - 1;
      else if (e.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % items.length;
      else next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
      items[next]?.focus();
    };
    panel.addEventListener("keydown", onKeyDown);
    return () => panel.removeEventListener("keydown", onKeyDown);
  }, [open, panelRef]);

  const close = () => setOpen(false);
  const itemClass =
    "block w-full px-3 py-2.5 text-left font-mono text-[11px] uppercase tracking-[.08em] text-cream-dim hover:bg-dark-well hover:text-red-soft";
  const activeClass = "text-paper";
  const gamertag = status.kind === "verified" ? status.link.gamertag : null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="nav-menu"
        // min 44px target: this is the only navigation control on a phone.
        className="flex h-11 w-11 items-center justify-center text-paper hover:text-red"
      >
        <span aria-hidden className="text-[19px] leading-none">
          ☰
        </span>
      </button>
      {open && (
        <div
          ref={panelRef}
          id="nav-menu"
          role="menu"
          aria-label="Menu"
          tabIndex={-1}
          className="absolute right-0 top-full z-50 mt-2 w-[220px] border border-dark-line bg-dark py-1 shadow-[0_10px_30px_rgba(0,0,0,.45)]"
        >
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.key}
              role="menuitem"
              href={item.href}
              aria-current={active === item.key ? "page" : undefined}
              onClick={close}
              className={cn(itemClass, active === item.key && activeClass)}
            >
              {item.label}
            </Link>
          ))}
          {/* ⚠️ Nothing account-shaped while the status is loading: an item set that has to be
           *  swapped a frame later is worse than one that arrives a frame late. */}
          {status.kind !== "loading" && (
            // ⚠️ `role="none"`, not a bare <div>. `role="menu"` only permits `menuitem*`,
            // `group` and `separator` children, so a generic element owned directly by the menu
            // is invalid and can make AT skip or mis-count the items inside it. `none` because
            // this wrapper is a layout box with a decorative rule — `group` would need an
            // accessible name and would announce a section this menu does not really have.
            <div role="none" className="mt-1 border-t border-dark-line pt-1">
              {status.kind === "signedOut" ? (
                <Link role="menuitem" href="/login" onClick={close} className={itemClass}>
                  Sign in
                </Link>
              ) : (
                <>
                  {gamertag ? (
                    <Link
                      role="menuitem"
                      href={`/players/${playerSlug(gamertag)}`}
                      onClick={close}
                      className={itemClass}
                    >
                      Your profile →
                    </Link>
                  ) : status.kind === "pending" ? (
                    // Plain <a>, not <Link> — see the ⚠️ at the top of this file.
                    <a role="menuitem" href="/#claim" onClick={close} className={itemClass}>
                      Finish verification →
                    </a>
                  ) : (
                    <a role="menuitem" href="/#claim" onClick={close} className={itemClass}>
                      Claim your gamertag →
                    </a>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close();
                      void signOutAndTeardownPush();
                    }}
                    className={itemClass}
                  >
                    Sign out
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
