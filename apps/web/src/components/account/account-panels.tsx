"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useControls } from "@/components/account/use-controls";
import { VerifiedHome } from "@/components/account/verified-home";
import { VerificationAnnouncer } from "@/components/account/verification-announcer";

function PanelsSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <div aria-hidden className="h-10 bg-bone motion-safe:animate-pulse" />
      <div aria-hidden className="h-40 bg-bone motion-safe:animate-pulse" />
      <div aria-hidden className="h-24 bg-bone motion-safe:animate-pulse" />
    </div>
  );
}

/**
 * The account surface, lifted out of the deleted ControlsRail. Rendered in Home's main column —
 * NOT in the sidebar, because the sidebar is xl-only and everything here is actionable.
 *
 * Sub-project C restructures this into the three-mode home; B only rehouses it so nothing is lost.
 */
export function AccountPanels({ signInFallback = false }: {
  /** True when the SERVER believed a session existed (cookie present) and therefore suppressed
   *  the cold pitch. If the session then resolves signed-OUT (stale cookie), the page has no
   *  pitch and no panels — render a sign-in link rather than a blank home. */
  signInFallback?: boolean;
} = {}) {
  const c = useControls();

  // A signed-out visitor normally gets nothing here: Home carries the hero and `CtaSlab`, and a
  // sign-in panel here would be a SECOND call to action on the same page. The old rail could
  // afford one because it was a separate column; in the main flow it is a duplicate. The
  // exception is the stale-cookie case above, where this is the ONLY call to action left.
  if (c.status.kind === "signedOut") {
    if (!signInFallback) return null;
    return (
      <div className="flex flex-col items-start gap-3 px-6 py-8 md:px-10">
        <p className="font-sans text-base text-ink-soft">Your session has expired.</p>
        <Link
          href="/login"
          className="border-b-2 border-red font-display text-sm font-semibold uppercase tracking-[.06em] text-ink hover:text-red"
        >
          Sign in →
        </Link>
      </div>
    );
  }

  let body: ReactNode;
  if (c.status.kind === "loading") {
    body = <PanelsSkeleton />;
  } else if (c.status.kind === "unlinked" || c.status.kind === "pending") {
    // Nothing visible renders here for either onboarding state: the claim modal (Task 3/4) owns
    // the unlinked claim flow, and the full-bleed PendingHero (mounted separately above this
    // component, per pending-hero spec §3) owns the pending challenge UI. The section stays
    // mounted so VerificationAnnouncer (below) survives the pending→verified swap; the masthead
    // avatar menu owns sign-out in every signed-in state now.
    body = null;
  } else {
    // ⚠️ The verified home is now the ticket stage + controls slab + morgue (verified-home
    // redesign spec §2–§4). StandingGroups / TokensPanel / the past-lives grid are gone from
    // here; the stage's tickets own per-server standing and the slab owns tokens + invites.
    body = <VerifiedHome gamertag={c.status.link.gamertag} />;
  }

  return (
    <section
      aria-label="Your account"
      className={cn(
        "flex flex-col",
        // ⚠️ The VERIFIED body is full-bleed — the stage, slab and morgue each state their own
        // `px-6 md:px-10`, and a padded wrapper here is what made them read narrower than the
        // stage. Only the stale-cookie/skeleton bodies still need the wrapper's padding.
        body != null && c.status.kind !== "verified" && "gap-4 px-6 py-8 md:px-10",
      )}
    >
      {/* ⚠️ Unconditional sibling of `body`, never inside a branch: it must outlive the
       *  pending -> verified panel swap to announce the change (SR-structure spec). */}
      <VerificationAnnouncer kind={c.status.kind} />
      {body}
    </section>
  );
}
