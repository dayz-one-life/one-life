"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { playerSlug } from "@/lib/slug";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useControls, useControlsActions } from "@/components/account/use-controls";
import { serverCards, transferErrorLabel } from "@/components/account/format";
import { TokensPanel, type MutationView } from "@/components/account/tokens-panel";
import { StandingGroups } from "@/components/servers/standing-groups";
import { serversView } from "@/components/servers/how-to-connect";
import { OnlineFriendsContainer } from "@/components/friends/online-friends";
import { VerificationAnnouncer } from "@/components/account/verification-announcer";

function mutView(m: { isPending: boolean; isSuccess: boolean; isError: boolean; error: unknown }): MutationView {
  return {
    pending: m.isPending,
    ok: m.isSuccess,
    error: m.isError ? transferErrorLabel(m.error instanceof ApiError ? m.error.code : "") : null,
  };
}

function PanelsSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <div aria-hidden className="h-10 bg-bone motion-safe:animate-pulse" />
      <div aria-hidden className="h-40 bg-bone motion-safe:animate-pulse" />
      <div aria-hidden className="h-24 bg-bone motion-safe:animate-pulse" />
    </div>
  );
}

/** Standing is still loading/errored — the truth is unknown, so show a placeholder rather than
 *  fabricating "idle" for every server (live-data honesty §5). */
function ServerCardsSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-2.5">
      <div aria-hidden className="h-20 bg-bone motion-safe:animate-pulse" />
      <div aria-hidden className="h-20 bg-bone motion-safe:animate-pulse" />
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
  const a = useControlsActions();
  const now = new Date();
  const cards = serverCards(c.servers, c.standing);

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
    const gamertag = c.status.link.gamertag;
    const slug = playerSlug(gamertag);
    // Verified home = the mock's control panel: standing groups, tokens, friends online. No
    // identity row and no profile/sign-out footer here — the masthead avatar menu owns account
    // entry, per the avatar-menu amendment.
    body = (
      <>
        {c.standingLoading ? (
          <ServerCardsSkeleton />
        ) : (
          <StandingGroups
            cards={cards}
            ownSlug={slug}
            balance={c.balance ?? 0}
            balanceLoading={c.balanceLoading}
            previousBestSeconds={c.previousBestSeconds}
            now={now}
            onRedeem={(banId) => a.redeem.mutate(banId)}
            redeeming={a.redeem.isPending}
            joinServers={serversView(c.servers, { loading: c.serversLoading })}
          />
        )}
        {/* The FULL panel, back from the deleted /you page (home-is-the-app spec §3): home is
         *  the app, and Send belongs where the balance is. Spending still lives on the ban row,
         *  which knows WHICH ban to lift. */}
        <TokensPanel
          balance={c.balance ?? 0}
          balanceLoading={c.balanceLoading}
          send={mutView(a.send)}
          onSend={(gt) => a.send.mutate(gt)}
          myGamertag={gamertag}
        />
        {/* xl:hidden — the xl sidebar already mounts this; two mounts, one component (spec §4). */}
        <div className="xl:hidden">
          <OnlineFriendsContainer />
        </div>
      </>
    );
  }

  return (
    <section
      aria-label="Your account"
      className={cn("flex flex-col gap-4", body != null && "px-6 py-8 md:px-10")}
    >
      {/* ⚠️ Unconditional sibling of `body`, never inside a branch: it must outlive the
       *  pending -> verified panel swap to announce the change (SR-structure spec). */}
      <VerificationAnnouncer kind={c.status.kind} />
      {body}
    </section>
  );
}
