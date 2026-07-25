"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAndTeardownPush } from "@/lib/push";
import { claimErrorMessage } from "@/lib/claim-error";
import { playerSlug } from "@/lib/slug";
import { useControls, useControlsActions } from "@/components/account/use-controls";
import { serverCards } from "@/components/account/format";
import { IdentityRow } from "@/components/account/identity-row";
import { LinkTagPanel } from "@/components/account/link-panel";
import { ProveItPanel } from "@/components/account/verify-panel";
import { TokensSummary } from "@/components/account/tokens-summary";
import { LadderFrame } from "@/components/account/ladder-frame";
import { ServerCard } from "@/components/servers/server-cards";
import { groupServerCards, isSoleRow, type ServerGroup } from "@/components/servers/grouping";
import { HowToConnect, serversView } from "@/components/servers/how-to-connect";
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

const GROUP_HEADING: Record<ServerGroup["state"], string> = {
  banned: "Serving a ban",
  alive: "Currently living",
  idle: "Nothing running",
};

/**
 * Server rows grouped by state. The heading is omitted for a sole row — with one group holding one
 * row there is nothing to distinguish it from, and the heading would be pure chrome.
 */
function ServerGroups({
  groups, ownSlug, balance, balanceLoading, now, onRedeem, redeeming,
}: {
  groups: ServerGroup[]; ownSlug: string; balance: number; balanceLoading: boolean; now: Date;
  onRedeem: (banId: number) => void; redeeming: boolean;
}) {
  const sole = isSoleRow(groups);
  return (
    <>
      {groups.map((g) => (
        <section key={g.state} aria-label={GROUP_HEADING[g.state]} className="flex flex-col gap-2.5">
          {!sole && (
            <h3 className="font-mono text-[10.5px] uppercase tracking-[.08em] text-ink-muted">
              {GROUP_HEADING[g.state]}
            </h3>
          )}
          {g.cards.map((card) => (
            <ServerCard
              key={card.slug}
              card={card}
              ownSlug={ownSlug}
              balance={balance}
              balanceLoading={balanceLoading}
              now={now}
              onRedeem={onRedeem}
              redeeming={redeeming}
            />
          ))}
        </section>
      ))}
    </>
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

  // A signed-out visitor gets nothing here: Home already carries the hero and `ColdFork`, and a
  // sign-in panel here would be a SECOND call to action on the same page. The old rail could
  // afford one because it was a separate column; in the main flow it is a duplicate.
  if (c.status.kind === "signedOut") return null;

  let body: ReactNode;
  if (c.status.kind === "loading") {
    body = <PanelsSkeleton />;
  } else if (c.status.kind === "unlinked") {
    body = (
      <>
        <IdentityRow name={c.name ?? "You"} provider={c.provider} tagLine="No gamertag" />
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
        <IdentityRow name={link.gamertag} provider={c.provider} />
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
    body = (
      <>
        <IdentityRow name={gamertag} provider={c.provider} verified />
        {/* A SUMMARY, not the full panel: sending and the referrer live on /you, and spending is
         *  afforded on the ban row itself, which already knows which ban to lift. */}
        <TokensSummary balance={c.balance} loading={c.balanceLoading} />
        <h2 className="border-b-[3px] border-ink pb-1.5 font-display text-[13px] font-bold uppercase tracking-[.14em] text-ink">
          Your servers
        </h2>
        {c.standingLoading ? (
          <ServerCardsSkeleton />
        ) : (
          <>
            <ServerGroups
              groups={groupServerCards(cards)}
              ownSlug={slug}
              balance={c.balance ?? 0}
              balanceLoading={c.balanceLoading}
              now={now}
              onRedeem={(banId) => a.redeem.mutate(banId)}
              redeeming={a.redeem.isPending}
            />
            {/* An idle row's action. Rendered once below the groups rather than per row: the
             *  instructions are identical for every server, and repeating them would bury the
             *  rows that need attention. */}
            {cards.some((card) => card.state === "idle") && (
              <HowToConnect servers={serversView(c.servers, { loading: c.serversLoading })} />
            )}
          </>
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
