"use client";
import Link from "next/link";
import { useState } from "react";
import { signOutAndTeardownPush } from "@/lib/push";
import { claimErrorMessage } from "@/lib/claim-error";
import { playerSlug } from "@/lib/slug";
import { useControls, useControlsActions } from "./use-controls";
import { pillStatus, serverCards, transferErrorLabel } from "./format";
import { AvatarDisc } from "./identity-row";
import { ControlsPillView, SignInPill } from "./pill";
import { ControlsSheet, SheetServerRow } from "./sheet";
import { TokensPanel, type MutationView } from "./tokens-panel";
import { LinkTagPanel } from "./link-panel";
import { ProveItPanel } from "./verify-panel";
import { NotificationsPanel } from "./notifications-panel";
import { PushToggle } from "./push-toggle";
import { ApiError } from "@/lib/api";

function mutView(m: { isPending: boolean; isSuccess: boolean; isError: boolean; error: unknown }): MutationView {
  return {
    pending: m.isPending,
    ok: m.isSuccess,
    error: m.isError ? transferErrorLabel(m.error instanceof ApiError ? m.error.code : "") : null,
  };
}

/** Mobile pill + bottom sheet (canvas 10b/10c). Renders nothing for signed-out visitors. */
export function MobileControls() {
  const c = useControls();
  const a = useControlsActions();
  const [open, setOpen] = useState(false);
  // Loading: render nothing (avoids pop-in until auth resolves). Signed-out: a floating sign-in
  // box so mobile visitors don't have to scroll to the footer to log in.
  if (c.status.kind === "loading") return null;
  if (c.status.kind === "signedOut") return <SignInPill />;

  const now = new Date();
  const cards = serverCards(c.servers, c.standing);
  const verified = c.status.kind === "verified";
  const pendingLink = c.status.kind === "pending" ? c.status.link : null;
  const gamertag =
    c.status.kind === "verified" || c.status.kind === "pending" ? c.status.link.gamertag : null;
  const name = gamertag ?? c.name ?? "You";
  const slug = verified && gamertag ? playerSlug(gamertag) : null;
  const line = pillStatus(c.status, cards, now);

  const header = (
    <div className="flex items-center gap-3">
      <AvatarDisc name={name} size={34} />
      <div className="min-w-0">
        <p className="truncate font-display text-base font-semibold uppercase leading-tight text-paper">{name}</p>
        <p className="font-mono text-[10px] uppercase tracking-[.05em] text-cream-muted">
          {c.provider ? `Via ${c.provider}` : ""}
          {verified && (
            <>
              {c.provider ? " · " : ""}
              <span className="font-bold text-red-soft">Verified</span>
            </>
          )}
        </p>
      </div>
    </div>
  );

  return (
    <>
      <ControlsPillView
        name={name}
        line={line}
        dots={cards.map((x) => x.state)}
        balance={c.balance}
        verified={verified}
        open={open}
        onOpen={() => setOpen(true)}
      />
      <ControlsSheet open={open} onClose={() => setOpen(false)} header={header}>
        {c.status.kind === "unlinked" && (
          <LinkTagPanel
            pending={a.claim.isPending}
            error={a.claim.isError ? claimErrorMessage(a.claim.error) : null}
            onClaim={(gt) => a.claim.mutate({ gamertag: gt })}
          />
        )}
        {pendingLink && (
          <ProveItPanel
            gamertag={pendingLink.gamertag}
            challenge={pendingLink.challenge}
            now={now.getTime()}
            onCancel={() => a.cancel.mutate(pendingLink.id)}
            onReclaim={() => a.claim.mutate({ gamertag: pendingLink.gamertag })}
            canceling={a.cancel.isPending}
            reclaiming={a.claim.isPending}
          />
        )}
        {verified && (
          <>
            <NotificationsPanel
              onDark
              items={c.notifications}
              unreadCount={c.unreadCount}
              onOpen={(ids) => a.markRead.mutate(ids)}
              hasMore={c.hasMore}
              onLoadMore={c.loadMore}
              loadingMore={c.loadingMore}
            >
              <PushToggle onDark />
            </NotificationsPanel>
            <TokensPanel
              boxed
              showReferrer={false}
              balance={c.balance ?? 0}
              send={mutView(a.send)}
              referrer={mutView(a.refer)}
              onSend={(gt) => a.send.mutate(gt)}
              onSetReferrer={() => {}}
              myGamertag={gamertag ?? undefined}
            />
            {cards.map((card) => (
              <SheetServerRow
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
        )}
        <div className="flex justify-between font-mono text-[10px] uppercase tracking-[.06em]">
          {slug ? (
            <Link href={`/players/${slug}`} className="text-cream-dim hover:text-paper">
              Your profile →
            </Link>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={() => void signOutAndTeardownPush()}
            className="text-cream-muted hover:text-paper"
          >
            Sign out
          </button>
        </div>
      </ControlsSheet>
    </>
  );
}
