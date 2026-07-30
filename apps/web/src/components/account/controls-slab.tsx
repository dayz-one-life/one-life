"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { getReferralCount } from "@/lib/api";
import { playerSlug } from "@/lib/slug";
import { useControls, useControlsActions } from "./use-controls";
import { ShareBar } from "./share-bar";

const SEND_HINT = "A token you send cannot come back";
const INVITE_HINT = "+1 token when someone you invite verifies their gamertag";

/** ⚠️ The two ways a token appears. Rendered as a chip row so the tokens half has the SAME number
 *  of control rows as the invite half (field + row + hint) — that is what squares the two columns. */
const EARN_RULES = ["+1 on the 1st", "+1 per invite"];

const H2 = "font-display text-2xl font-bold uppercase tracking-[.06em] text-ink";
const HINT = "font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted";

/** The figure, inline beside its heading — present and countable, never a billboard. */
function Figure({ value, label }: { value: number; label: string }) {
  return (
    <p className="font-mono text-[11px] uppercase tracking-[.14em] text-ink-muted">
      <span className="font-display text-xl font-bold tabular-nums text-ink">{value}</span> {label}
    </p>
  );
}

/**
 * ⚠️ An unresolved figure is NOT a zero. A pending or failed balance renders this placeholder;
 * "0 in hand" is a different, authoritative fact about the player and must never be fabricated
 * from an in-flight fetch. Same for the join count.
 *
 * ⚠️ It does not reuse the resolved label either — "— in hand" still asserts the shape of an
 * answer we do not have, and a test can only tell the two renders apart if they differ. It says
 * what is actually true: we are still asking.
 */
function FigurePending({ label }: { label: string }) {
  return (
    <p role="status" className="font-mono text-[11px] uppercase tracking-[.14em] text-ink-muted">
      {label}
    </p>
  );
}

function SendField() {
  const [to, setTo] = useState("");
  const { send } = useControlsActions();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const gt = to.trim();
        if (!gt) return;
        send.mutate(gt, { onSuccess: () => setTo("") });
      }}
      className="flex flex-col gap-2 sm:flex-row"
    >
      <input
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="Send to a verified player…"
        aria-label="Send a token to a verified player"
        className="min-w-0 flex-1 border-2 border-hairline bg-paper px-3.5 py-3 font-mono text-[15px] tracking-[.02em] outline-none placeholder:text-ink-muted"
      />
      <button
        type="submit"
        disabled={!to.trim() || send.isPending}
        className="min-h-[48px] flex-none bg-ink px-6 font-display text-sm font-bold uppercase tracking-[.08em] text-paper disabled:opacity-40"
      >
        Send
      </button>
    </form>
  );
}

function EarnChips() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="sr-only sm:not-sr-only sm:mr-1 sm:font-mono sm:text-[10px] sm:uppercase sm:tracking-[.14em] sm:text-ink-muted">
        Earn by
      </span>
      {EARN_RULES.map((rule) => (
        <span
          key={rule}
          className="flex h-11 items-center border-2 border-ink bg-white px-3 font-mono text-[10px] uppercase tracking-[.06em] text-ink"
        >
          {rule}
        </span>
      ))}
    </div>
  );
}

/* ══════════════════════ the two halves ══════════════════════
 * ⚠️ VERTICAL BALANCE + HEIGHT. The halves used to be written twice each, per variant, with
 * different internal rhythms, so the columns never lined up and the shorter one left a hole. They
 * now share ONE skeleton, stated once here:
 *
 *     h2 + inline figure  →  one sentence  →  [mt-auto] control  →  hint
 *
 * ⚠️ The figures are INLINE and small. They were display-scale numerals (a 7xl balance mirrored by
 * a 7xl join count), which balanced the columns but cost ~90px per half and pushed the send field
 * and the share bar — the things a player actually came here to use — below the fold. A balance of
 * 3 does not need to be read from across the room. Do not re-promote them.
 *
 * Both halves still align at the top (shared heading row) and at the bottom (`mt-auto` pushes the
 * control group down, so the send field and the link field sit on the same line).
 */
function Half({
  heading,
  figure,
  sentence,
  control,
  hint,
}: {
  heading: string;
  figure: React.ReactNode;
  sentence: string;
  control: React.ReactNode;
  hint: string;
}) {
  return (
    <div className="flex h-full flex-col">
      {/* ⚠️ `justify-between` only from lg. Below it the halves are full-page-width, and pinning
       *  the figure to the far right edge left it stranded ~700px from the heading it belongs to. */}
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 lg:justify-between">
        <h2 className={H2}>{heading}</h2>
        {figure}
      </div>
      <p className="mt-2 max-w-md font-sans text-[15px] leading-relaxed text-ink-soft">{sentence}</p>
      {/* mt-auto is the balance mechanism — see the note above. `max-w-xl` only matters BELOW lg,
       *  where the halves stack and an unconstrained field would stretch the full page width. */}
      <div className="mt-auto max-w-xl pt-5 lg:max-w-none">{control}</div>
      <p className={cn(HINT, "mt-3")}>{hint}</p>
    </div>
  );
}

/* ⚠️ The slab runs EDGE TO EDGE of the page column, exactly like the stage — same `px-6 md:px-10`,
 * no outer padding wrapper. It was previously nested inside a padded `BelowStage`, which inset it
 * from the full-bleed stage above; at 1024px that read as two different page widths stacked.
 *
 * G2 (yellow invite slab) and G3 (dark continuation) were dropped on 2026-07-30 — G1 is the pick. */
export function ControlsSlab() {
  const { status, balance, balanceLoading } = useControls();
  const referrals = useQuery({ queryKey: ["referrals"], queryFn: getReferralCount });
  const gamertag = status.kind === "verified" ? status.link.gamertag : null;
  // The origin is only knowable client-side; this is a client island, so it always resolves before
  // the field is interactive. An SSR pass renders the path alone rather than a wrong absolute URL.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link = gamertag ? `${origin}/i/${playerSlug(gamertag)}` : "";
  const joinedResolved = !referrals.isLoading && !referrals.isError && referrals.data !== undefined;

  return (
    <section className="border-y-2 border-ink bg-white">
      {/* ⚠️ The split is `lg` (1024), NOT `md` (768). At md each half is only ~336px of content —
       *  narrower than the share row (label + five 44px targets + the native-share button) and
       *  narrower than "INVITE A SURVIVOR" plus its figure on one line. Both wrapped raggedly for
       *  the whole 768–1023 band. Below lg the halves stack full-width, where everything fits.
       *  Do not move this back to md to "use the space" — the space isn't there. */}
      <div className="grid lg:grid-cols-2">
        <div className="border-b-2 border-ink px-6 py-7 lg:border-b-0 lg:border-r-2 lg:px-10 lg:py-8">
          <Half
            heading="Your tokens"
            figure={
              balanceLoading || balance === null ? (
                <FigurePending label="Checking your balance…" />
              ) : (
                <Figure value={balance} label="in hand" />
              )
            }
            sentence="One token lifts one ban, the moment you spend it."
            control={
              <div className="flex flex-col gap-3">
                <SendField />
                <EarnChips />
              </div>
            }
            hint={SEND_HINT}
          />
        </div>
        <div className="px-6 py-7 lg:px-10 lg:py-8">
          <Half
            heading="Invite a survivor"
            figure={
              joinedResolved ? (
                <Figure value={referrals.data!.joined} label="joined so far" />
              ) : (
                <FigurePending label="Counting your invites…" />
              )
            }
            sentence="Every survivor who verifies on your link pays you a token."
            control={<ShareBar link={link} />}
            hint={INVITE_HINT}
          />
        </div>
      </div>
    </section>
  );
}
