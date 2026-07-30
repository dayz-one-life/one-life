"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAccountStatus } from "@/lib/use-account-status";
import { getAvatar } from "@/lib/api";
import { Avatar } from "@/components/shared/avatar";
import { cn } from "@/lib/utils";

/**
 * The masthead's account face: an avatar disc that LINKS TO `/`.
 *
 * `/` is the player's own home — the ledger, the tickets, the controls slab — so the avatar
 * means "you" and goes there. It used to open a popover; those items (profile / claim / sign
 * out) moved into `shell/nav-menu.tsx`, so the masthead has exactly one menu.
 *
 * ⚠️ Signed out this renders a VISIBLE `Sign in` link rather than nothing. It is the primary
 * conversion action on a marketing surface; the menu carries it too, but not only.
 *
 * ⚠️ Renders nothing while the status is loading — a Sign in chip swapped for an avatar a frame
 * later teaches a player not to trust the chrome.
 */
export function AccountAffordance() {
  const status = useAccountStatus();
  const signedIn = status.kind === "unlinked" || status.kind === "pending" || status.kind === "verified";
  const avatar = useQuery({ queryKey: ["avatar"], queryFn: getAvatar, enabled: signedIn });

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
  // A pending player has a claimed tag too — show its initial rather than an anonymous dot,
  // and mark the disc with the verification yellow so the state is visible at every width.
  const pendingTag = status.kind === "pending" ? status.link.gamertag : null;
  const initial = (gamertag ?? pendingTag)?.trim().charAt(0).toUpperCase() || "•";

  return (
    <Link href="/" aria-label="Your home" className="group flex h-9 w-9 items-center justify-center rounded-full">
      {/* The ring, fill and glyph all come from `Avatar` — see the ⚠️ at that component. The
          pending cue and the hover both reach it through `className`, which `cn` merges LAST:
          `border-yellow` replaces the variant's `border-dark-edge-bright` (same Tailwind class
          group), while `group-hover:border-red` is a variant group and survives alongside it.
          That is why the cue and the hover do not cancel each other out. */}
      <Avatar
        hash={avatar.data?.hash ?? null}
        size={36}
        fallbackInitial={initial}
        variant="dark"
        className={cn("group-hover:border-red group-hover:text-red", pendingTag && "border-yellow")}
      />
    </Link>
  );
}
