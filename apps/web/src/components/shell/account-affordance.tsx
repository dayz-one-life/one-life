"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAccountStatus } from "@/lib/use-account-status";
import { getAvatar } from "@/lib/api";
import { avatarSrc } from "@/components/shared/avatar";
import { useModalBehavior } from "@/lib/use-modal-behavior";
import { signOutAndTeardownPush } from "@/lib/push";
import { playerSlug } from "@/lib/slug";

/**
 * The masthead's account control — an avatar disc that opens a small menu (profile / claim +
 * sign out). Replaces the old plain link to /you, which is deleted (avatar-account-pass spec §4).
 *
 * ⚠️ Renders at EVERY width — this is the only route to sign-out now.
 * Pattern is MastheadBell's: owned open state, outside-click via a rootRef mousedown listener,
 * route-change close, useModalBehavior for Escape/focus (panel MUST carry tabIndex={-1}).
 * The popover's z-50 ranks it inside the z-40 masthead — no new altitude (LAYER LEGEND).
 */
export function AccountAffordance() {
  const status = useAccountStatus();
  const signedIn = status.kind === "unlinked" || status.kind === "pending" || status.kind === "verified";
  const avatar = useQuery({ queryKey: ["avatar"], queryFn: getAvatar, enabled: signedIn });

  const [open, setOpen] = useState(false);
  const panelRef = useModalBehavior(open, () => setOpen(false));
  const rootRef = useRef<HTMLDivElement>(null);

  const pathname = usePathname();
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

  if (status.kind === "loading") return null;

  if (status.kind === "signedOut") {
    return (
      <Link
        href="/login"
        className="flex min-h-[44px] items-center px-2 font-display text-[13px] font-semibold uppercase tracking-[.08em] text-paper hover:text-red"
      >
        Sign in
      </Link>
    );
  }

  const gamertag = status.kind === "verified" ? status.link.gamertag : null;
  const initial = gamertag ? gamertag.trim().charAt(0).toUpperCase() : "•";
  const hash = avatar.data?.hash ?? null;
  const itemClass =
    "block w-full px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[.08em] text-paper hover:bg-dark-well hover:text-red-soft";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Your account"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="account-menu"
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-dark-edge-bright bg-dark-well font-display text-sm font-bold uppercase text-paper hover:border-red hover:text-red"
      >
        {hash ? (
          <img src={avatarSrc(hash)} alt="" width={36} height={36} className="h-full w-full object-cover" />
        ) : (
          <span aria-hidden>{initial}</span>
        )}
      </button>
      {open && (
        <div
          ref={panelRef}
          id="account-menu"
          role="menu"
          aria-label="Your account"
          tabIndex={-1}
          className="absolute right-0 top-full z-50 mt-2 w-[200px] border border-dark-line bg-dark py-1 shadow-[0_10px_30px_rgba(0,0,0,.45)]"
        >
          {gamertag ? (
            <Link role="menuitem" href={`/players/${playerSlug(gamertag)}`} className={itemClass}>
              Your profile →
            </Link>
          ) : (
            <Link role="menuitem" href="/" className={itemClass}>
              Claim your gamertag →
            </Link>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => void signOutAndTeardownPush()}
            className={itemClass}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
