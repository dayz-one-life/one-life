"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAndTeardownPush } from "@/lib/push";
import { claimErrorMessage } from "@/lib/claim-error";
import { playerSlug } from "@/lib/slug";
import { ApiError } from "@/lib/api";
import { useControls, useControlsActions } from "@/components/controls/use-controls";
import { serverCards, transferErrorLabel } from "@/components/controls/format";
import { IdentityRow } from "@/components/controls/identity-row";
import { SignInPanel } from "@/components/controls/signin-panel";
import { LinkTagPanel } from "@/components/controls/link-panel";
import { ProveItPanel } from "@/components/controls/verify-panel";
import { TokensPanel, type MutationView } from "@/components/controls/tokens-panel";
import { ServerCard } from "@/components/controls/server-cards";
import { VerificationAnnouncer } from "@/components/controls/verification-announcer";

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

function mutView(m: { isPending: boolean; isSuccess: boolean; isError: boolean; error: unknown }): MutationView {
  return {
    pending: m.isPending,
    ok: m.isSuccess,
    error: m.isError ? transferErrorLabel(m.error instanceof ApiError ? m.error.code : "") : null,
  };
}

/** Shown in every signed-in state so a signed-in user can always sign out; the profile link only
 *  appears once a gamertag is verified. */
function SignedInFooter({ profileSlug }: { profileSlug?: string }) {
  return (
    <div className="flex justify-between border-t border-hairline pt-2.5 font-mono text-[11px] uppercase tracking-[.05em]">
      {profileSlug ? (
        <Link href={`/players/${profileSlug}`} className="font-bold text-ink hover:text-red">
          Your profile →
        </Link>
      ) : (
        <span />
      )}
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
export function AccountPanels() {
  const c = useControls();
  const a = useControlsActions();
  const now = new Date();
  const cards = serverCards(c.servers, c.standing);

  let body: ReactNode;
  if (c.status.kind === "loading") {
    body = <PanelsSkeleton />;
  } else if (c.status.kind === "signedOut") {
    body = <SignInPanel />;
  } else if (c.status.kind === "unlinked") {
    body = (
      <>
        <IdentityRow name={c.name ?? "You"} provider={c.provider} tagLine="No gamertag" />
        <LinkTagPanel
          pending={a.claim.isPending}
          error={a.claim.isError ? claimErrorMessage(a.claim.error) : null}
          onClaim={(gt) => a.claim.mutate({ gamertag: gt })}
        />
      </>
    );
  } else if (c.status.kind === "pending") {
    const link = c.status.link;
    body = (
      <>
        <IdentityRow name={link.gamertag} provider={c.provider} />
        <ProveItPanel
          gamertag={link.gamertag}
          challenge={link.challenge}
          now={now.getTime()}
          onCancel={() => a.cancel.mutate(link.id)}
          onReclaim={() => a.claim.mutate({ gamertag: link.gamertag })}
          canceling={a.cancel.isPending}
          reclaiming={a.claim.isPending}
        />
      </>
    );
  } else {
    const gamertag = c.status.link.gamertag;
    const slug = playerSlug(gamertag);
    body = (
      <>
        <IdentityRow name={gamertag} provider={c.provider} verified />
        <TokensPanel
          balance={c.balance ?? 0}
          balanceLoading={c.balanceLoading}
          send={mutView(a.send)}
          referrer={mutView(a.refer)}
          onSend={(gt) => a.send.mutate(gt)}
          onSetReferrer={(gt) => a.refer.mutate(gt)}
          myGamertag={gamertag}
        />
        <h2 className="border-b-[3px] border-ink pb-1.5 font-display text-[13px] font-bold uppercase tracking-[.14em] text-ink">
          Your servers
        </h2>
        {c.standingLoading ? (
          <ServerCardsSkeleton />
        ) : (
          cards.map((card) => (
            <ServerCard
              key={card.slug}
              card={card}
              ownSlug={slug}
              balance={c.balance ?? 0}
              balanceLoading={c.balanceLoading}
              now={now}
              onRedeem={(banId) => a.redeem.mutate(banId)}
              redeeming={a.redeem.isPending}
            />
          ))
        )}
      </>
    );
  }

  const signedIn =
    c.status.kind === "unlinked" || c.status.kind === "pending" || c.status.kind === "verified";
  const profileSlug = c.status.kind === "verified" ? playerSlug(c.status.link.gamertag) : undefined;

  return (
    <section aria-label="Your account" className="flex flex-col gap-4">
      {/* ⚠️ Unconditional sibling of `body`, never inside a branch: it must outlive the
       *  pending -> verified panel swap to announce the change (SR-structure spec). */}
      <VerificationAnnouncer kind={c.status.kind} />
      {body}
      {signedIn && <SignedInFooter profileSlug={profileSlug} />}
    </section>
  );
}
