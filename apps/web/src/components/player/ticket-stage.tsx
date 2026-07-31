import Link from "next/link";
import type { PlayerPage, ServerStanding } from "@/lib/types";
import { cn } from "@/lib/utils";
import { playerSlug } from "@/lib/slug";
import { lifeHrefBySlug } from "@/lib/life-href";
import { verdictPhrase } from "@/lib/cause-format";
import { FitLine } from "@/components/front-page/fit-line";
import { StageAvatar } from "./stage-avatar";
import { TicketSpend } from "./ticket-spend";
import { formatDuration, banCountdown, mapLabel, relativeDate } from "./format";

export type Viewer = "owner" | "public";

const KICKER = "font-mono text-xs uppercase tracking-[.28em] text-cream-dim";

/** One ticket's worth of facts, derived from a `ServerStanding`. Deriving it once here keeps the
 *  three states from each growing their own ad-hoc rules further down. */
type Ticket = {
  slug: string;
  map: string;
  state: ServerStanding["state"];
  /** The display-scale figure. Null when there is no number — we never fabricate one. */
  figure: string | null;
  /** Null on a never-played ticket, which has nothing to say beyond "Not played". */
  sub: string | null;
  /** The life this ticket's Timeline button points at. Null → no button rather than a broken link. */
  life: number | null;
  /** No life has ever run here. Distinct from idle-with-a-history, which has a death to report. */
  neverPlayed: boolean;
  /** Provisional = the life has not yet qualified. Must never read as qualified. */
  provisional: boolean;
  record: boolean;
  ban: ServerStanding["ban"];
};

function toTicket(s: ServerStanding, now: Date, previousBestSeconds: number): Ticket {
  if (s.state === "alive" && s.alive) {
    return {
      slug: s.slug,
      map: mapLabel(s.map),
      state: "alive",
      figure: formatDuration(s.alive.timeAliveSeconds),
      sub: `Life ${s.alive.lifeNumber} · started ${relativeDate(s.alive.startedAt, now)}`,
      life: s.alive.lifeNumber,
      neverPlayed: false,
      provisional: !s.alive.qualified,
      // A record only means something against a previous best that exists.
      record: previousBestSeconds > 0 && s.alive.timeAliveSeconds > previousBestSeconds,
      ban: null,
    };
  }
  if (s.state === "banned" && s.ban) {
    const cause = verdictPhrase(s.ban.verdict, s.ban.verdict?.cause ?? null);
    const life = s.ban.triggeringLifeNumber ?? s.lastLifeNumber;
    return {
      slug: s.slug,
      map: mapLabel(s.map),
      state: "banned",
      // ⚠️ A null countdown is an expiry the enforcer has not caught up with — NOT zero time
      // left and not "no life". Same "Lifting…" wording as the dossier's standing card.
      figure: banCountdown(s.ban.expiresAt, now),
      sub: life == null ? cause : `${cause} · life ${life}`,
      life,
      neverPlayed: false,
      provisional: false,
      record: false,
      ban: s.ban,
    };
  }
  const neverPlayed = s.lastLifeNumber == null || s.lastEndedAt == null;
  return {
    slug: s.slug,
    map: mapLabel(s.map),
    state: "idle",
    figure: null,
    // A never-played ticket says "Not played" and stops. It used to carry "Clear to spawn" over
    // "Never played" under a "No life" figure — three lines restating one fact.
    sub: neverPlayed ? null : `Died ${relativeDate(s.lastEndedAt!, now)} · life ${s.lastLifeNumber}`,
    life: s.lastLifeNumber,
    neverPlayed,
    provisional: false,
    record: false,
    ban: null,
  };
}

function tally(tickets: Ticket[]) {
  return {
    alive: tickets.filter((t) => t.state === "alive").length,
    banned: tickets.filter((t) => t.state === "banned").length,
    idle: tickets.filter((t) => t.state === "idle").length,
  };
}

/**
 * The life-tickets stage — one ticket per server, serving BOTH `/` (owner) and `/players/{slug}`
 * (public). `/players/{me}` 307s to `/`, so the owner never lands on their own public page.
 *
 * ⚠️ The GAMERTAG is the h1. It reads identically in both viewers, which the old "2 lives running"
 * headline did not — that was second-person on a stranger's page. The aggregate survives as the
 * tally strip below: still stated, no longer shouted.
 */
export function TicketStage({
  page,
  viewer,
  now,
}: {
  page: PlayerPage;
  viewer: Viewer;
  now: Date;
}) {
  const owner = viewer === "owner";
  const slug = playerSlug(page.gamertag);
  const tickets = page.standing.map((s) => toTicket(s, now, page.previousBestSeconds));
  const t = tally(tickets);
  const cols =
    tickets.length >= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : tickets.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";

  return (
    <section className="border-b-[6px] border-red bg-dark px-6 py-12 text-paper md:px-10 md:py-16">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-5 sm:flex-nowrap">
        <StageAvatar
          hash={page.avatarHash}
          fallbackInitial={page.gamertag.slice(0, 1)}
          editable={owner}
        />
        <div className="min-w-0 flex-1">
          {/* ⚠️ The kicker READS `page.verified` — it was hardcoded "Survivor · verified", which
           *  told every visitor that a gamertag nobody has linked was a verified account. Most
           *  players on the board are unclaimed; verification is a claim someone made, and the
           *  page must not make it for them. */}
          <p className={KICKER}>Survivor · {page.verified ? "verified" : "unclaimed"}</p>
          <h1 className="mt-2 font-display font-bold uppercase leading-[.9]">
            <FitLine finalText={page.gamertag} lineClassName="text-[clamp(2.25rem,8vw,7rem)]">
              {page.gamertag}
            </FitLine>
          </h1>
          <p className="mt-3 font-mono text-[11px] uppercase tracking-[.16em] text-cream-muted">
            {/* ⚠️ `whitespace-nowrap` per item — at 390px the strip broke INSIDE a pair ("0 /
             *  clear"), which reads as a different number. Break between items or not at all. */}
            <span className={cn("whitespace-nowrap", t.alive > 0 && "font-bold text-yellow")}>{t.alive} alive</span>
            {" · "}
            <span className={cn("whitespace-nowrap", t.banned > 0 && "font-bold text-red")}>{t.banned} banned</span>
            {" · "}
            <span className="whitespace-nowrap">{t.idle} clear</span>
            {" · "}
            <span className="whitespace-nowrap">{tickets.length} servers</span>
          </p>
        </div>
      </div>

      <p className="mt-7 max-w-2xl font-sans text-lg leading-relaxed text-cream-dim">
        {t.banned > 0 && (
          <>
            <span className="font-bold text-red">
              Banned on {t.banned === 1 ? "one server" : `${t.banned} servers`}.
            </span>{" "}
          </>
        )}
        Every life here is tracked to the minute, birth to death, across sessions.
      </p>

      <ul role="list" className={cn("mt-8 grid grid-cols-1 gap-4", cols)}>
        {tickets.map((r) => {
          // See the ⚠️ on the Timeline link below: alive only, and only when the ticket
          // actually names a life to point at.
          const linkable = r.life != null && r.state === "alive";
          return (
          <li
            key={r.slug}
            aria-label={r.map}
            className={cn(
              "relative flex min-h-[210px] flex-col border-2 bg-paper px-4 py-4 text-ink",
              r.state === "idle" ? "border-dashed border-ink/40" : "border-ink",
              r.state === "banned" && "border-red",
            )}
          >
            <p className="font-mono text-[11px] font-bold uppercase tracking-[.18em] text-ink-muted">{r.map}</p>
            <p
              className={cn(
                "mt-auto whitespace-nowrap font-display font-bold uppercase leading-[.9] tabular-nums",
                r.state === "banned" ? "text-red-deep" : r.state === "alive" ? "text-ink" : "text-ink-muted",
                r.figure ? "text-[clamp(1.75rem,4.5vw,3rem)]" : "text-2xl",
              )}
            >
              {r.figure ?? (r.state === "banned" ? "Lifting…" : r.neverPlayed ? "Not played" : "No life")}
            </p>
            {/* A never-played ticket stops at the figure. "Clear to spawn" over "Never played"
             *  under a "No life" headline was three restatements of nothing having happened. */}
            {!r.neverPlayed && (
              <p className="mt-1.5 font-mono text-[10.5px] uppercase tracking-[.06em] text-ink-muted">
                {r.state === "banned"
                  ? "Left on the ban"
                  : r.state === "alive"
                    ? r.provisional
                      ? "Not yet qualified"
                      : "Alive"
                    : "Clear to spawn"}
              </p>
            )}
            {r.sub && (
              <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[.04em] text-ink-soft">{r.sub}</p>
            )}

            {/* ⚠️ TIMELINE LINKS ARE FOR LIVE TICKETS ONLY — alive and banned, in both viewers.
             *  An IDLE ticket never links out, even when the player has a history on that map.
             *
             *  This rule has now flipped three times (Steve, 2026-07-30, latest): links on every
             *  ticket → no ticket links out → links on every ticket → this. The reason it landed
             *  here is that an idle ticket's headline is "No life", and a card that says there is
             *  no life while offering a button through to one contradicts itself. Alive and banned
             *  tickets both name a life that is currently doing something to the player, so their
             *  links refer to what the card is about. Past lives are reachable from the morgue.
             *
             *  Spend stays owner-only and banned-only: the ticket is the one place that knows
             *  WHICH ban a token would lift.
             *
             *  (Steve, 2026-07-30, v0.69): banned dropped too — only a card about a
             *  currently-RUNNING life links to a live record; the ban card still names its life
             *  in the sub-line, and past lives are reachable from the morgue. */}
            {(linkable || (owner && r.state === "banned" && r.ban)) && (
              <div className="mt-3.5 flex flex-col gap-2">
                {owner && r.state === "banned" && r.ban && (
                  <TicketSpend banId={r.ban.banId} liftPending={r.ban.liftPending} />
                )}
                {linkable && (
                  <Link
                    href={lifeHrefBySlug(slug, r.slug, r.life!)}
                    className="flex min-h-[38px] w-full items-center justify-center border-2 border-ink px-3 font-mono text-[10px] uppercase tracking-[.1em] text-ink hover:bg-ink hover:text-paper"
                  >
                    Timeline <span aria-hidden className="ml-1.5">→</span>
                  </Link>
                )}
              </div>
            )}

            {r.record && (
              <span aria-hidden className="pointer-events-none absolute -right-1 top-3 -rotate-[6deg] border-2 border-red bg-paper px-2 py-0.5 font-display text-[11px] font-bold uppercase tracking-[.08em] text-red">
                Record
              </span>
            )}
          </li>
          );
        })}
      </ul>

      {/* "View your public page" was dropped deliberately: the public view is this same stage with
       *  affordances removed, so there is nothing to inspect, and the `?public=1` bypass it needed
       *  would put a query-string escape on a session-conditional redirect. If sharing is the real
       *  need, it belongs with the invite controls below, not here. */}
    </section>
  );
}

/**
 * Layout reservation for the stage while the player page is in flight — the ONLY thing standing
 * between the first paint and a 0.67 CLS on the signed-in home.
 *
 * ⚠️ THIS IS A SKELETON, NOT A STAGE. It states no fact: no gamertag, no tally, no per-server
 * state. `slots` is a number of empty boxes to hold open, and being wrong by one costs a small
 * shift — never a claim about the fleet. That is why it may carry a fallback count while the
 * fleet list is still loading, and why the "never hardcode a server count" rule (which governs
 * COPY and the real ticket grid) is not in play here.
 *
 * ⚠️ Its geometry must track `TicketStage`'s: the same section padding, the same `cols` formula,
 * the same `min-h-[210px]` cards. A card grid — rather than one fixed `min-h` — is what makes the
 * reservation hold at EVERY width, including the mobile column where three stacked tickets are
 * three times as tall as the desktop row. Change one and change the other.
 */
export function StageSkeleton({ slots, message, live = true }: {
  slots: number;
  message: string;
  /** False for the error render: a failure is not a busy state, and `role="status"` on a message
   *  that will never resolve announces a load that is not happening. */
  live?: boolean;
}) {
  const boxes = Math.max(1, slots);
  const cols = boxes >= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : boxes === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";
  return (
    <section
      {...(live ? { role: "status", "aria-busy": true } : {})}
      className="border-b-[6px] border-red bg-dark px-6 py-12 text-paper md:px-10 md:py-16"
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-5 sm:flex-nowrap">
        <div aria-hidden className="h-[132px] w-[132px] flex-none rounded-full bg-dark-well motion-safe:animate-pulse" />
        <div className="min-w-0 flex-1 space-y-3">
          <p className="font-mono text-xs uppercase tracking-[.28em] text-cream-dim">{message}</p>
          <div aria-hidden className="h-12 w-3/4 max-w-lg bg-dark-well motion-safe:animate-pulse" />
          <div aria-hidden className="h-3 w-56 max-w-full bg-dark-well motion-safe:animate-pulse" />
        </div>
      </div>
      {/* The tally strip + blurb band. Measured against the resolved stage on production at
       *  1348px: this reservation comes to 568px where the real stage is 583px — 2.6% short,
       *  against the 433px shortfall the one-line stub left. */}
      <div aria-hidden className="mt-7 h-8 w-full max-w-2xl bg-dark-well motion-safe:animate-pulse" />
      <ul aria-hidden className={cn("mt-8 grid grid-cols-1 gap-4", cols)}>
        {Array.from({ length: boxes }, (_, i) => (
          <li key={i} className="min-h-[210px] border-2 border-dark-line bg-dark-well motion-safe:animate-pulse" />
        ))}
      </ul>
    </section>
  );
}
