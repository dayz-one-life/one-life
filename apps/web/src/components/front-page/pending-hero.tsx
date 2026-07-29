"use client";
import type { Challenge } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatExpiry } from "@/lib/format-expiry";
import { useAccountStatus } from "@/lib/use-account-status";
import { useControlsActions } from "@/components/account/use-controls";
import { SkewCta } from "@/components/tabloid/skew-cta";
import { SrStatus } from "@/components/shared/sr-status";
import { FitLine } from "./fit-line";

const quietBtn =
  "inline-flex min-h-[44px] items-center font-mono text-[11px] uppercase tracking-[.05em] text-cream-muted underline underline-offset-2 hover:text-paper disabled:opacity-50";

const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth"];

/** The sequence as paper tickets (spec §2): orders to carry out, not a live tracker. Only
 *  server-confirmed state renders differently — NO current-step pointer, ever. */
function TicketSequence({ challenge: c }: { challenge: Challenge }) {
  return (
    <ol
      role="list"
      aria-label="Emote sequence"
      className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4"
    >
      {c.sequence.map((emote, i) => {
        const confirmed = i < c.progressIndex;
        return (
          <li
            key={i}
            className={cn(
              "relative flex min-h-[130px] flex-col items-center justify-center gap-1 px-4 py-8 text-center md:min-h-[170px]",
              confirmed ? "bg-paper text-ink" : "border-2 border-dashed border-dark-line text-paper",
            )}
          >
            <span
              className={cn(
                "font-mono text-[12px] font-bold uppercase tracking-[.2em]",
                confirmed ? "text-ink-muted/60" : "text-yellow",
              )}
            >
              {ORDINALS[i] ?? `${i + 1}.`}
            </span>
            <span className={cn("font-display text-3xl font-bold uppercase leading-none md:text-5xl", confirmed && "opacity-30")}>
              {emote}
            </span>
            {confirmed && (
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="-rotate-[8deg] border-4 border-red bg-paper/70 px-3 py-0.5 font-display text-2xl font-bold uppercase tracking-[.08em] text-red">
                  Confirmed
                </span>
              </span>
            )}
            <span className="sr-only">{confirmed ? "— confirmed by the server" : "— not yet confirmed"}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The pending home's full-bleed hero (pending-hero spec §2): the emote challenge as the page's
 * centerpiece, in the cold hero's visual language — dark stage, red frame, yellow for everything
 * live. Absorbs the retired ProveItPanel; this is the pending page's only h1, and the "Step 3
 * of 3" kicker is the 3-step ladder folded to one line (LadderFrame no longer renders for
 * pending). The live branch renders the sequence as paper tickets — orders to carry out, not a
 * live tracker — with a status paragraph carrying the confirmed count and the batching notice;
 * see `TicketSequence` above for the honesty rule (no current-step pointer, ever).
 *
 * RED POLICY: `red-deep` is a light-surface token and must never appear here; the frame and the
 * SkewCta background are display-scale red, allowed on dark.
 */
export function PendingHeroView({
  gamertag,
  challenge,
  now,
  onCancel,
  onReclaim,
  canceling,
  reclaiming,
}: {
  gamertag: string;
  challenge: Challenge | null;
  now: number;
  onCancel: () => void;
  onReclaim: () => void;
  canceling?: boolean;
  reclaiming?: boolean;
}) {
  const expired = !challenge || challenge.expired;
  return (
    <section className="border-b-[6px] border-red bg-dark px-6 py-12 text-paper md:px-10 md:py-16">
      {/* Deliberately renders in BOTH the live and expired branches below (outside the ternary):
       *  an expired challenge doesn't change where the player stands in the 3-step ladder —
       *  proving is still the one remaining step either way. */}
      <p className="font-mono text-xs uppercase tracking-[.28em] text-cream-dim">
        <span className="font-bold text-yellow">Step 3 of 3</span> — one step left
      </p>
      {expired ? (
        <>
          <h1 className="mt-4 font-display text-4xl font-bold uppercase leading-[.95] md:text-6xl">
            Your verification for {gamertag} expired
          </h1>
          <p className="mt-4 max-w-xl font-sans text-lg leading-relaxed text-cream-dim">
            The emote challenge timed out. Start a fresh one and perform the new sequence in game.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-5">
            <SkewCta onClick={onReclaim} disabled={reclaiming}>Start a new challenge →</SkewCta>
            <button type="button" onClick={onCancel} disabled={canceling} className={quietBtn}>
              Cancel claim
            </button>
          </div>
        </>
      ) : (
        <>
          <h1 className="mt-4 font-display font-bold uppercase leading-[.95]">
            <FitLine finalText="Prove it's you" lineClassName="text-[clamp(2.5rem,9vw,10rem)]">
              Prove it's you
            </FitLine>
            <span className="mt-3 block text-2xl font-semibold tracking-[.12em] text-yellow md:text-4xl">
              {gamertag}
            </span>
          </h1>
          <p className="mt-6 max-w-2xl font-sans text-lg leading-relaxed text-cream-dim">
            Join any One Life server and perform these three emotes, in order. Other emotes in
            between don&rsquo;t matter — the order does.
          </p>
          {/* Separate node from the <ol> below — role="status" on the list itself would strip
           *  its list semantics (SR-structure spec). */}
          <SrStatus>{`Step ${challenge.progressIndex} of ${challenge.sequence.length} confirmed`}</SrStatus>
          <div className="mt-6">
            <TicketSequence challenge={challenge} />
          </div>
          <p className="mt-6 max-w-2xl border-l-4 border-yellow pl-4 font-sans text-base leading-relaxed text-cream-dim">
            <span className="font-bold text-yellow">
              {`The server has confirmed ${challenge.progressIndex} of ${challenge.sequence.length}.`}
            </span>{" "}
            DayZ reports emotes in batches — confirmations land up to 15 minutes behind, and this
            page does not update in real time. Perform all three and you can log off; the stamp
            catches up on its own.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-6 font-mono text-[12px] uppercase tracking-[.06em]">
            <span className="font-bold text-yellow">{formatExpiry(challenge.expiresAt, now)}</span>
            <button type="button" onClick={onCancel} disabled={canceling} className={quietBtn}>
              Cancel claim
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Thin container (untested, per convention): gates on pending — renders nothing for every other
 * status, including `loading` (no flash; appearing beats vanishing) — and wires the claim/cancel
 * mutations. The 5s pending poll lives in `useGamertagLinks`, untouched.
 */
export function PendingHero() {
  const status = useAccountStatus();
  const a = useControlsActions();
  if (status.kind !== "pending") return null;
  const link = status.link;
  return (
    <PendingHeroView
      gamertag={link.gamertag}
      challenge={link.challenge}
      now={Date.now()}
      onCancel={() => a.cancel.mutate(link.id)}
      onReclaim={() => a.claim.mutate({ gamertag: link.gamertag })}
      canceling={a.cancel.isPending}
      reclaiming={a.claim.isPending}
    />
  );
}
