"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/lib/auth-client";
import { claimErrorMessage } from "@/lib/claim-error";
import { playerSlug } from "@/lib/slug";
import { ApiError } from "@/lib/api";
import { useControls, useControlsActions } from "./use-controls";
import { serverCards, transferErrorLabel } from "./format";
import { IdentityRow } from "./identity-row";
import { SignInPanel } from "./signin-panel";
import { LinkTagPanel } from "./link-panel";
import { ProveItPanel } from "./verify-panel";
import { TokensPanel, type MutationView } from "./tokens-panel";
import { ServerCard } from "./server-cards";
import { NotificationsPanel } from "./notifications-panel";
import { PushToggle } from "./push-toggle";

function RailSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <div aria-hidden className="h-10 animate-pulse bg-bone" />
      <div aria-hidden className="h-40 animate-pulse bg-bone" />
      <div aria-hidden className="h-24 animate-pulse bg-bone" />
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

/** Footer shown in every signed-in state so a signed-in user can always sign out (the
 *  profile link only appears once a gamertag is verified). */
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
      <button
        type="button"
        onClick={() => void signOut().finally(() => { window.location.href = "/"; })}
        className="text-ink-muted hover:text-red"
      >
        Sign out
      </button>
    </div>
  );
}

/** Desktop controls rail (canvas 10a/10d) — the right column of the root layout at xl+. */
export function ControlsRail() {
  const c = useControls();
  const a = useControlsActions();
  const now = new Date();
  const cards = serverCards(c.servers, c.standing);

  let body: ReactNode;
  if (c.status.kind === "loading") {
    body = <RailSkeleton />;
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
        <NotificationsPanel
          items={c.notifications}
          unreadCount={c.unreadCount}
          onOpen={(ids) => a.markRead.mutate(ids)}
        >
          <PushToggle />
        </NotificationsPanel>
        <TokensPanel
          balance={c.balance ?? 0}
          send={mutView(a.send)}
          referrer={mutView(a.refer)}
          onSend={(gt) => a.send.mutate(gt)}
          onSetReferrer={(gt) => a.refer.mutate(gt)}
          myGamertag={gamertag}
        />
        <h2 className="border-b-[3px] border-ink pb-1.5 font-display text-[13px] font-bold uppercase tracking-[.14em] text-ink">
          Your servers
        </h2>
        {cards.map((card) => (
          <ServerCard
            key={card.slug}
            card={card}
            ownSlug={slug}
            balance={c.balance ?? 0}
            now={now}
            onRedeem={(banId) => a.redeem.mutate(banId)}
            redeeming={a.redeem.isPending}
          />
        ))}
      </>
    );
  }

  const signedIn =
    c.status.kind === "unlinked" || c.status.kind === "pending" || c.status.kind === "verified";
  const profileSlug = c.status.kind === "verified" ? playerSlug(c.status.link.gamertag) : undefined;

  return (
    <aside aria-label="Player controls" className="hidden py-8 pl-7 xl:sticky xl:top-0 xl:block xl:max-h-screen xl:self-start xl:overflow-y-auto">
      <div className="flex flex-col gap-4">
        {body}
        {signedIn && <SignedInFooter profileSlug={profileSlug} />}
      </div>
    </aside>
  );
}
