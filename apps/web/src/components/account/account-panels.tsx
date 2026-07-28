"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { signOutAndTeardownPush } from "@/lib/push";
import { claimErrorMessage } from "@/lib/claim-error";
import { playerSlug } from "@/lib/slug";
import { ApiError, getAvatar } from "@/lib/api";
import { useControls, useControlsActions } from "@/components/account/use-controls";
import { serverCards, transferErrorLabel } from "@/components/account/format";
import { IdentityRow } from "@/components/account/identity-row";
import { LinkTagPanel } from "@/components/account/link-panel";
import { ProveItPanel } from "@/components/account/verify-panel";
import { TokensPanel, type MutationView } from "@/components/account/tokens-panel";
import { LadderFrame } from "@/components/account/ladder-frame";
import { StandingGroups } from "@/components/servers/standing-groups";
import { HowToConnect, serversView } from "@/components/servers/how-to-connect";
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

/** Onboarding-state escape hatch: an unlinked/pending user must always be able to bail out. */
function SignedInFooter() {
  return (
    <div className="flex justify-end border-t border-hairline pt-2.5 font-mono text-[11px] uppercase tracking-[.05em]">
      <button type="button" onClick={() => void signOutAndTeardownPush()} className="text-ink-muted hover:text-red">
        Sign out
      </button>
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
  // Mirrors `useControls`' own `signedIn` gate above (unlinked/pending/verified) — do not fetch
  // `/me/avatar` for a signed-out visitor. Same `["avatar"]` key `AvatarPanel`/`YouPanel` read.
  const signedIn = c.status.kind === "unlinked" || c.status.kind === "pending" || c.status.kind === "verified";
  const avatar = useQuery({ queryKey: ["avatar"], queryFn: getAvatar, enabled: signedIn });

  // A signed-out visitor normally gets nothing here: Home carries the hero and `CtaSlab`, and a
  // sign-in panel here would be a SECOND call to action on the same page. The old rail could
  // afford one because it was a separate column; in the main flow it is a duplicate. The
  // exception is the stale-cookie case above, where this is the ONLY call to action left.
  if (c.status.kind === "signedOut") {
    if (!signInFallback) return null;
    return (
      <div className="flex flex-col items-start gap-3">
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
  } else if (c.status.kind === "unlinked") {
    body = (
      <>
        <IdentityRow
          name={c.name ?? "You"}
          provider={c.provider}
          tagLine="No gamertag"
          avatarHash={avatar.data?.hash ?? null}
        />
        <LadderFrame kind="unlinked">
          <div className="flex flex-col gap-4">
            <LinkTagPanel
              pending={a.claim.isPending}
              error={a.claim.isError ? claimErrorMessage(a.claim.error) : null}
              onClaim={(gt) => a.claim.mutate({ gamertag: gt })}
            />
            {/* The claim search only suggests gamertags the LOGS have seen, so a player who has
             *  never connected finds nothing there. This is that empty state's answer — and the
             *  only place "go play a session" belongs (it is deliberately not a ladder step). */}
            <HowToConnect servers={serversView(c.servers, { loading: c.serversLoading })} />
          </div>
        </LadderFrame>
      </>
    );
  } else if (c.status.kind === "pending") {
    const link = c.status.link;
    body = (
      <>
        <IdentityRow name={link.gamertag} provider={c.provider} avatarHash={avatar.data?.hash ?? null} />
        <LadderFrame kind="pending">
          <ProveItPanel
            gamertag={link.gamertag}
            challenge={link.challenge}
            now={now.getTime()}
            onCancel={() => a.cancel.mutate(link.id)}
            onReclaim={() => a.claim.mutate({ gamertag: link.gamertag })}
            canceling={a.cancel.isPending}
            reclaiming={a.claim.isPending}
          />
        </LadderFrame>
      </>
    );
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

  const showFooter = c.status.kind === "unlinked" || c.status.kind === "pending";

  return (
    <section aria-label="Your account" className="flex flex-col gap-4">
      {/* ⚠️ Unconditional sibling of `body`, never inside a branch: it must outlive the
       *  pending -> verified panel swap to announce the change (SR-structure spec). */}
      <VerificationAnnouncer kind={c.status.kind} />
      {body}
      {/* Onboarding states keep an inline sign-out (they may need to bail); verified account
       *  controls live behind the masthead avatar instead. */}
      {showFooter && <SignedInFooter />}
    </section>
  );
}
