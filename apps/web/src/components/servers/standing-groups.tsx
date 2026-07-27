"use client";
import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { lifeHrefBySlug } from "@/lib/life-href";
import { banCountdown, formatDuration, mapLabel } from "@/components/player/format";
import { verdictPhrase } from "@/lib/cause-format";
import { relativeTime } from "@/components/notifications/row";
import { UnbanView, unbanStateOf } from "@/components/player/self-unban-button";
import { serverFactLine, type ServerCardData } from "@/components/account/format";
import { groupServerCards } from "@/components/servers/grouping";
import { HowToConnect, type ServersView } from "@/components/servers/how-to-connect";

/**
 * The verified home's standing groups, built to the design mock
 * (`verified-desktop.html`, option A, with the agreed amendments): a red banned group headed by
 * the tokens-in-hand count, one hero block PER alive life (time alive is the ONLY stat), and a
 * compact idle group whose `How to connect ▸` discloses the shared HowToConnect content in place.
 */

const OV = "font-mono text-[10px] uppercase tracking-[.12em]";

/** Day-aware run length for the hero ("4d 2h"), falling back to h/m under a day — the mock
 *  headlines multi-day runs in days, which `formatDuration`'s flat hours cannot say. */
export function formatRunLength(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  if (d > 0) return `${d}d ${Math.floor((s % 86400) / 3600)}h`;
  return formatDuration(s);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function Pip({ tone }: { tone: "red" | "blue" | "neutral" }) {
  const bg = tone === "red" ? "bg-red" : tone === "blue" ? "bg-blue" : "bg-dash";
  return <span aria-hidden className={cn("h-[9px] w-[9px] flex-none rounded-full", bg)} />;
}

function BannedRow({ card, ownSlug, balance, balanceLoading, now, onRedeem, redeeming }: {
  card: ServerCardData; ownSlug: string | null; balance: number; balanceLoading: boolean;
  now: Date; onRedeem: (banId: number) => void; redeeming: boolean;
}) {
  const ban = card.ban!;
  const countdown = ban.expiresAt ? banCountdown(ban.expiresAt, now) : null;
  // "mauled · life 7" — the death that earned the ban. A ban with no matched life shows no line
  // rather than a guess; a verdict-less death reads through causeLabel as "unknown".
  const deathLine = [
    ban.verdict ? verdictPhrase(ban.verdict, null).toLowerCase() : null,
    card.lifeNumber !== null ? `life ${card.lifeNumber}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <div className="border-t border-ink/10 px-3.5 py-2.5">
      <div className="flex items-center gap-3">
        <Pip tone="red" />
        <span className="min-w-[96px] font-display text-[15px] font-medium uppercase text-ink">{mapLabel(card.map)}</span>
        <span className="font-mono text-[12px] text-ink">
          <span className="font-bold tabular-nums">{countdown ?? "Lifting…"}</span>
          {deathLine && <><br /><span className="text-[10px] uppercase tracking-[.04em] text-ink-muted">{deathLine}</span></>}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {card.lifeNumber !== null && ownSlug && (
            <Link
              href={lifeHrefBySlug(ownSlug, card.slug, card.lifeNumber)}
              className="border border-ink px-2.5 py-1.5 font-mono text-[9.5px] uppercase tracking-[.1em] text-ink"
            >
              Timeline
            </Link>
          )}
        </span>
      </div>
      <UnbanView
        state={unbanStateOf(ban.liftPending || redeeming, balance, !balanceLoading)}
        balance={balance}
        onRedeem={() => onRedeem(ban.banId)}
      />
    </div>
  );
}

function AliveHero({ card, ownSlug, previousBestSeconds }: {
  card: ServerCardData; ownSlug: string | null; previousBestSeconds: number;
}) {
  const a = card.alive!;
  const since = a.startedAt
    ? new Date(a.startedAt).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" })
    : null;
  const record = a.qualified && previousBestSeconds > 0 && a.timeAliveSeconds > previousBestSeconds;
  return (
    <section
      aria-label={`Alive on ${mapLabel(card.map)}`}
      className="border border-hairline border-l-4 border-l-blue bg-bone"
    >
      <div className="flex items-baseline justify-between px-3.5 pt-2.5">
        <span className={cn(OV, "text-ink-muted")}>
          Alive · {mapLabel(card.map)}
          {card.lifeNumber !== null ? ` · Life ${card.lifeNumber}` : ""}
        </span>
        {since && <span className={cn(OV, "text-ink-muted")}>since {since}</span>}
      </div>
      <div className="px-4 pb-4 pt-1.5">
        {/* Time alive is the ONE stat (amendment 2) — no kills, no sessions, no rank band. */}
        <p className="font-display text-[44px] font-bold leading-[.95] tracking-tight tabular-nums text-ink md:text-[56px]">
          {formatRunLength(a.timeAliveSeconds)}
        </p>
        {!a.qualified ? (
          <p className="mt-1.5 font-mono text-[11px] uppercase tracking-[.04em] text-ink-muted">{serverFactLine(card)}</p>
        ) : record ? (
          <p className="mt-1.5 font-mono text-[12px] text-ink-soft">
            Your longest run yet. Previous best: {formatRunLength(previousBestSeconds)}.
          </p>
        ) : null}
        <div className="mt-3.5 flex gap-2">
          {card.lifeNumber !== null && ownSlug && (
            <Link
              href={lifeHrefBySlug(ownSlug, card.slug, card.lifeNumber)}
              className="flex-1 border border-ink px-3 py-2.5 text-center font-mono text-[10px] uppercase tracking-[.1em] text-ink"
            >
              Timeline →
            </Link>
          )}
          <Link
            href={`/maps/${card.slug}`}
            className="flex-1 bg-ink px-3 py-2.5 text-center font-mono text-[10px] uppercase tracking-[.1em] text-paper"
          >
            Open map
          </Link>
        </div>
      </div>
    </section>
  );
}

/** The compact alive treatment for a page a ban leads (mock D): a row, not a hero — the ban is
 *  the story, and two heroes stacked under it bury the countdown. Time alive stays the only
 *  stat (amendment 2); "Map" is the one affordance. */
function AliveRow({ card }: { card: ServerCardData }) {
  const a = card.alive!;
  return (
    <div className="flex min-h-[36px] items-center gap-3 border-t border-ink/10 px-3.5 py-2.5 first:border-t-0">
      <Pip tone="blue" />
      <span className="min-w-[96px] font-display text-[15px] font-medium uppercase text-ink">{mapLabel(card.map)}</span>
      <span className="font-mono text-[12px] font-bold tabular-nums text-ink">{formatRunLength(a.timeAliveSeconds)}</span>
      <Link
        href={`/maps/${card.slug}`}
        className="ml-auto border border-ink px-2.5 py-1.5 font-mono text-[9.5px] uppercase tracking-[.1em] text-ink"
      >
        Map
      </Link>
    </div>
  );
}

function IdleRow({ card, now, joinServers }: {
  card: ServerCardData; now: Date; joinServers?: ServersView;
}) {
  const [open, setOpen] = useState(false);
  // "died 2d ago · life 11" — the life number names WHICH run ended, per the mobile mock.
  const diedLine = card.lastEndedAt
    ? `· died ${relativeTime(card.lastEndedAt, now).toLowerCase()}${card.lifeNumber !== null ? ` · life ${card.lifeNumber}` : ""}`
    : "· never played";
  return (
    <div className="border-t border-ink/10 px-3.5 py-2.5 first:border-t-0">
      <div className="flex min-h-[36px] items-center gap-3">
        <Pip tone="neutral" />
        <span className="min-w-[96px] font-display text-[15px] font-medium uppercase text-ink">{mapLabel(card.map)}</span>
        <span className="font-mono text-[11px] text-ink">
          No life <span className="text-ink-muted">{diedLine}</span>
        </span>
        {joinServers && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="ml-auto border border-ink px-2.5 py-1.5 font-mono text-[9.5px] uppercase tracking-[.1em] text-ink"
          >
            {/* Not "Join": a console DayZ server has no join URL (how-to-connect.tsx), so this
             *  names what it actually reveals instead of promising an action we can't perform. */}
            How to connect {open ? "▾" : "▸"}
          </button>
        )}
      </div>
      {open && joinServers && (
        <div className="pb-1.5 pt-2">
          <HowToConnect servers={joinServers} />
        </div>
      )}
    </div>
  );
}

export function StandingGroups({
  cards, ownSlug, balance, balanceLoading, previousBestSeconds, now, onRedeem, redeeming, joinServers,
}: {
  cards: ServerCardData[];
  ownSlug: string | null;
  balance: number;
  /** True while `balance` is unresolved — the tokens-in-hand header and the spend CTA must not
   *  assert a fabricated count (live-data honesty §5). */
  balanceLoading: boolean;
  previousBestSeconds: number;
  now: Date;
  onRedeem: (banId: number) => void;
  redeeming: boolean;
  joinServers?: ServersView;
}) {
  const groups = groupServerCards(cards);
  const hasBan = groups.some((g) => g.state === "banned");
  const allIdle = cards.length > 0 && cards.every((c) => c.state === "idle");
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => {
        if (g.state === "banned") {
          return (
            <section key="banned" aria-label="Serving a ban" className="border border-red border-l-4 bg-red/5">
              <div className="flex items-baseline justify-between px-3.5 pb-1 pt-2.5">
                <span className={cn(OV, "font-bold text-red-deep")}>Banned · {plural(g.cards.length, "server")}</span>
                {!balanceLoading && (
                  <span className={cn(OV, "font-bold text-red-deep")}>{plural(balance, "token")} in hand</span>
                )}
              </div>
              {g.cards.map((card) => (
                <BannedRow
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
          );
        }
        if (g.state === "alive") {
          // A ban outranks a life as the page's story (mock D): alive collapses to a compact
          // row group so the countdown leads. Otherwise, one hero PER life, per the mock.
          if (hasBan) {
            return (
              <section key="alive" aria-label="Alive" className="border border-hairline border-l-4 border-l-blue bg-bone">
                <div className="px-3.5 pb-1 pt-2.5">
                  <span className={cn(OV, "text-ink-muted")}>Alive · {plural(g.cards.length, "server")}</span>
                </div>
                {g.cards.map((card) => (
                  <AliveRow key={card.slug} card={card} />
                ))}
              </section>
            );
          }
          return g.cards.map((card) => (
            <AliveHero key={card.slug} card={card} ownSlug={ownSlug} previousBestSeconds={previousBestSeconds} />
          ));
        }
        return (
          <section key="idle" aria-label="No life" className="border border-hairline border-l-4 border-l-dash bg-white">
            <div className="px-3.5 pb-1 pt-2.5">
              <span className={cn(OV, "text-ink-muted")}>
                {allIdle ? "Your servers · nothing running" : `No life · ${plural(g.cards.length, "server")}`}
              </span>
            </div>
            {g.cards.map((card) => (
              <IdleRow key={card.slug} card={card} now={now} joinServers={joinServers} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
