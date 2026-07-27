"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAccountStatus } from "@/lib/use-account-status";
import { getAvatar } from "@/lib/api";
import { avatarSrc } from "@/components/shared/avatar";

/**
 * The masthead's account control. Replaces `MobileAccount`, which opened the now-deleted
 * ControlsSheet.
 *
 * ⚠️ Renders at EVERY width. The old trigger was `xl:hidden` because the controls rail covered
 * desktop; with the rail gone this is the only route to the account surface, so a width gate here
 * strands desktop users.
 */
export function AccountAffordance() {
  const status = useAccountStatus();
  const signedIn = status.kind === "unlinked" || status.kind === "pending" || status.kind === "verified";
  // Gated on `signedIn`, not rendered conditionally on the query itself — loading must not blank
  // the control. The fallback-initial disc renders unchanged until the hash resolves.
  const avatar = useQuery({ queryKey: ["avatar"], queryFn: getAvatar, enabled: signedIn });

  // Nothing while unresolved — a "Sign in" chip that becomes an avatar a frame later is worse
  // than a beat of empty space.
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

  // Only a verified user has a gamertag to take an initial from; unlinked/pending fall back to a
  // neutral mark rather than inventing one from the account name.
  const initial = status.kind === "verified" ? status.link.gamertag.trim().charAt(0).toUpperCase() : "•";
  const hash = avatar.data?.hash ?? null;

  return (
    <Link
      href="/you"
      aria-label="Your account"
      className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-dark-edge-bright bg-dark-well font-display text-sm font-bold uppercase text-paper hover:border-red hover:text-red"
    >
      {hash ? (
        <img src={avatarSrc(hash)} alt="" width={36} height={36} className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden>{initial}</span>
      )}
    </Link>
  );
}
