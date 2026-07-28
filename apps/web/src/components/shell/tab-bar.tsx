"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccountStatus } from "@/lib/use-account-status";
import { cn } from "@/lib/utils";

type Tab = { href: string; label: string; icon: string };

const COMMON: Tab[] = [
  { href: "/", label: "Home", icon: "⌂" },
  // Resolves through the existing `/maps` redirect, so the tab bar needs no knowledge of map
  // resolution — sub-project D changes that redirect's internals without touching this file.
  { href: "/maps", label: "Map", icon: "◎" },
  // Same name as the nav item — "Board" was a third name for the one surface (nav said
  // Leaderboard, the page says Survivors), and orientation beats brevity here.
  { href: "/survivors", label: "Survivors", icon: "▤" },
];

// "Obits" not "Obituaries": the bar is five fixed-width columns at 320px and the long form does
// not fit — the same short-form split the nav already uses for Maps/Map.
const OBITS: Tab = { href: "/obituaries", label: "Obits", icon: "▧" };

// You is deliberately absent: account entry stays reachable at every width via AccountAffordance
// in the masthead (no width gate, unlike the nav beside it), so the tab is free for a public
// surface.
const SIGNED_IN: Tab[] = [...COMMON, { href: "/friends", label: "Friends", icon: "◍" }, OBITS];
const SIGNED_OUT: Tab[] = [...COMMON, OBITS, { href: "/login", label: "Sign in", icon: "◉" }];

/**
 * Mobile quick-access bar.
 *
 * It is NOT the nav. The nav is four sections (Home · Maps · Survivors · About); this is the
 * five things a player does often — which is why Friends and Obituaries appear here and About does not
 * (About lives in the footer).
 *
 * ⚠️ Height is a calc, never `h-16` plus bottom padding. Under `border-box` the safe-area padding
 * is subtracted from the declared height and collapses the row to a sliver on a notched phone in
 * PWA mode — the same bug the map top bar shipped and fixed.
 *
 * ⚠️ This is NOT a reintroduction of the retired ControlsPill (UX review sub-project 4). That was
 * a floating ACCOUNT surface; this is app-wide navigation, and it renders for signed-out visitors.
 */
export function TabBar() {
  const status = useAccountStatus();
  const pathname = usePathname() ?? "/";

  // Never render a set we might have to swap a frame later: a signed-out bar flashing before the
  // signed-in one is how a player learns not to trust the chrome.
  if (status.kind === "loading") return null;

  const tabs = status.kind === "signedOut" ? SIGNED_OUT : SIGNED_IN;

  return (
    <nav
      aria-label="Quick access"
      className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(4rem+env(safe-area-inset-bottom))] items-start border-t border-dark-line bg-dark pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {tabs.map((t) => {
        // Home is an exact match for the same reason activeNavKey's is — every path starts "/".
        const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              // `min-w-0` is defensive, not cosmetic: a flex item defaults to `min-width: auto`,
              // so `flex-1` alone will not shrink an item below its label's intrinsic width. With
              // five tabs at 320px the widest labels ("Friends", "Sign in") would otherwise push
              // the row wider than the viewport. Unverified on a real device — see the outstanding
              // device pass in the B plan, Task 10.
              // Icon-over-label stack per the mobile-shell mock; the active tab reads as paper
              // text with a red-soft icon (dark surface — plain red/red-soft, never red-deep).
              "flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-center font-mono text-[11px] uppercase tracking-[.08em]",
              active ? "text-paper" : "text-cream-dim",
            )}
          >
            <span aria-hidden className={cn("text-[17px] leading-none", active && "text-red-soft")}>
              {t.icon}
            </span>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
