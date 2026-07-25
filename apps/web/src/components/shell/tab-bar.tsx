"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccountStatus } from "@/lib/use-account-status";
import { cn } from "@/lib/utils";

type Tab = { href: string; label: string };

const COMMON: Tab[] = [
  { href: "/", label: "Home" },
  // Resolves through the existing `/maps` redirect, so the tab bar needs no knowledge of map
  // resolution — sub-project D changes that redirect's internals without touching this file.
  { href: "/maps", label: "Map" },
  // Route stays /survivors until D; the label matches the nav's "Leaderboard" in spirit but is
  // shortened to fit a five-item row on a 320px phone.
  { href: "/survivors", label: "Board" },
];

const SIGNED_IN: Tab[] = [...COMMON, { href: "/friends", label: "Friends" }, { href: "/you", label: "You" }];
const SIGNED_OUT: Tab[] = [...COMMON, { href: "/login", label: "Sign in" }];

/**
 * Mobile quick-access bar.
 *
 * It is NOT the nav. The nav is four sections (Home · Maps · Leaderboard · About); this is the
 * five things a player does often — which is why Friends and You appear here and About does not
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
              "flex min-h-[52px] flex-1 items-center justify-center px-1 font-display text-[15px] font-semibold uppercase tracking-[.06em]",
              active ? "text-red" : "text-paper",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
