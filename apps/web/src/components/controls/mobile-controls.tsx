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
import { VerificationAnnouncer } from "./verification-announcer";
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
  // Standing unresolved (loading/errored) — don't fabricate "idle" cards/dots from an unknown
  // state; the empty list here degrades to no dots on the pill and a loading row in the sheet
  // (spec: live-data honesty §5).
  const cards = c.standingLoading ? [] : serverCards(c.servers, c.standing);
  const verified = c.status.kind === "verified";
  const pendingLink = c.status.kind === "pending" ? c.status.link : null;
  const gamertag =
    c.status.kind === "verified" || c.status.kind === "pending" ? c.status.link.gamertag : null;
  const name = gamertag ?? c.name ?? "You";
  const slug = verified && gamertag ? playerSlug(gamertag) : null;
  const line = pillStatus(c.status, cards, now, c.standingLoading);

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
      {/* Mounted unconditionally (not inside ControlsSheet, which unmounts entirely while
       *  closed) so it survives both the pending -> verified swap and the sheet's own
       *  open/close cycle. Wrapped `xl:hidden`: sr-only is clip-based, not display:none, so
       *  the <p> stays in the a11y tree at every breakpoint unless we gate it ourselves. The
       *  rail already carries this announcer at `xl` (`hidden xl:block`), so leaving this copy
       *  unguarded would put two live announcers in the tree at `xl` and double-announce
       *  "Verification complete" to desktop screen readers. */}
      <div className="xl:hidden">
        <VerificationAnnouncer kind={c.status.kind} />
      </div>
      <ControlsPillView
        name={name}
        line={line}
        dots={cards.map((x) => x.state)}
        balance={c.balance}
        balanceLoading={c.balanceLoading}
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
            <TokensPanel
              boxed
              showReferrer={false}
              balance={c.balance ?? 0}
              balanceLoading={c.balanceLoading}
              send={mutView(a.send)}
              referrer={mutView(a.refer)}
              onSend={(gt) => a.send.mutate(gt)}
              onSetReferrer={() => {}}
              myGamertag={gamertag ?? undefined}
            />
            {c.standingLoading ? (
              <div aria-busy="true" className="flex flex-col gap-2">
                <div aria-hidden className="h-16 motion-safe:animate-pulse bg-dark-well" />
                <div aria-hidden className="h-16 motion-safe:animate-pulse bg-dark-well" />
              </div>
            ) : (
              cards.map((card) => (
                <SheetServerRow
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
        )}
        <div className="flex justify-between font-mono text-[11px] uppercase tracking-[.06em]">
          {slug ? (
            <Link href={`/players/${slug}`} className="inline-flex min-h-[44px] items-center text-cream-dim hover:text-paper">
              Your profile →
            </Link>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={() => void signOutAndTeardownPush()}
            className="inline-flex min-h-[44px] items-center text-cream-muted hover:text-paper"
          >
            Sign out
          </button>
        </div>
      </ControlsSheet>
    </>
  );
}
