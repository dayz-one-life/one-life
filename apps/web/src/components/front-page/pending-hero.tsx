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

/**
 * The pending home's full-bleed hero (pending-hero spec §2): the emote challenge as the page's
 * centerpiece, in the cold hero's visual language — dark stage, red frame, yellow for everything
 * live. Absorbs the retired ProveItPanel; this is the pending page's only h1, and the "Step 3
 * of 3" kicker is the 3-step ladder folded to one line (LadderFrame no longer renders for
 * pending).
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
          <p className="mt-6 font-mono text-[13px] font-bold uppercase tracking-[.08em] text-yellow">
            Perform, in order — {formatExpiry(challenge.expiresAt, now)}
          </p>
          {/* Separate node from the <ol> below — role="status" on the list itself would strip its
           *  list semantics. Scoped to progress only, so the ticking countdown above does not
           *  re-announce every second (SR-structure spec). */}
          <SrStatus>{`Step ${challenge.progressIndex} of ${challenge.sequence.length} confirmed`}</SrStatus>
          <ol
            role="list"
            aria-label="Emote sequence"
            className="mt-4 flex max-w-3xl gap-2.5 font-mono text-[13px] tracking-[.03em] md:text-base"
          >
            {challenge.sequence.map((emote, i) => {
              const done = i < challenge.progressIndex;
              const current = i === challenge.progressIndex;
              return (
                <li
                  key={i}
                  data-done={String(done)}
                  className={cn(
                    "flex-1 px-3 py-5 text-center uppercase",
                    done && "bg-paper font-bold text-ink",
                    current && "border border-dashed border-dark-edge-bright bg-dark-hollow text-yellow",
                    !done && !current && "border border-dashed border-dark-line text-cream-muted",
                  )}
                >
                  {i + 1} {emote}
                  <span aria-hidden="true">{done ? " ✓" : current ? " ←" : ""}</span>
                </li>
              );
            })}
          </ol>
          <div className="mt-8 grid max-w-3xl gap-6 md:grid-cols-2 md:items-start">
            <ol
              role="list"
              aria-label="How this works"
              className="flex list-decimal flex-col gap-2 pl-4 font-mono text-[11px] uppercase leading-relaxed tracking-[.04em] text-cream-muted marker:text-yellow"
            >
              <li>Join any One Life server.</li>
              <li>Perform the emotes above, in order.</li>
              <li>Done — you can log off and close this page.</li>
            </ol>
            <div>
              <p className="border-l-2 border-yellow pl-3 font-mono text-[11px] uppercase leading-relaxed tracking-[.04em] text-yellow">
                DayZ reports emotes in batches — your progress can take up to 15 minutes to appear
                here. It does not update in real time.
              </p>
              <p className="mt-3 font-mono text-[11px] uppercase leading-relaxed tracking-[.04em] text-cream-muted">
                Other emotes in between are fine — order is what counts. Only whoever controls the
                tag can finish this.
              </p>
            </div>
          </div>
          <div className="mt-8">
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
