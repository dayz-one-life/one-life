"use client";
import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { lifeHrefBySlug } from "@/lib/life-href";
import { banCountdown, formatDuration, mapLabel } from "@/components/player/format";
import { UnbanView, unbanStateOf } from "@/components/player/self-unban-button";
import { serverFactLine, type ServerCardData } from "@/components/account/format";
import { HowToConnect, type ServersView } from "@/components/servers/how-to-connect";

/**
 * `qualified` defaults to true so every pre-existing caller is unchanged. A PROVISIONAL life
 * (inside the five-minute grace window) must not wear the solid "Alive" chip: that reads as "this
 * life counts", and it does not yet — death there is free.
 */
export function StateChip({ state, small = false, qualified = true }: { state: ServerCardData["state"]; small?: boolean; qualified?: boolean }) {
  const base = cn("ml-auto flex-none px-2 pb-0.5 pt-1 font-display font-bold uppercase tracking-[.1em]", small ? "text-[9px]" : "text-[10px]");
  if (state === "alive" && !qualified) {
    // Outlined, not solid — "hollow" for a provisional state. `yellow` is the design system's
    // existing attention token; ink-on-paper keeps it readable where white-on-yellow would not.
    return <span className={cn(base, "border border-yellow font-semibold text-ink")}>Not yet</span>;
  }
  if (state === "alive") return <span className={cn(base, "bg-blue text-white")}>Alive</span>;
  if (state === "banned") return <span className={cn(base, "bg-red text-white")}>Banned</span>;
  return <span className={cn(base, "border border-dashed border-dash font-semibold text-ink-muted")}>No life</span>;
}

/**
 * One card per active server: alive renders as the HERO (home-is-the-app spec §1 — big
 * time-alive, Timeline/Open map actions, and time alive is the ONLY stat: no kills, no
 * sessions, per amendment 2); banned adds countdown + spend CTA; idle carries a `Join ▸`
 * disclosure that expands the shared HowToConnect content in place (spec §2).
 */
export function ServerCard({
  card,
  ownSlug,
  balance,
  balanceLoading = false,
  now,
  onRedeem,
  redeeming,
  joinServers,
}: {
  card: ServerCardData;
  ownSlug: string | null;
  balance: number;
  /** True while `balance` is unresolved (loading/errored) — must not assert "no tokens"
   *  (or render the spend CTA) before the tokens query settles (live-data honesty §5). */
  balanceLoading?: boolean;
  now: Date;
  onRedeem: (banId: number) => void;
  redeeming: boolean;
  /** The idle expansion's server list. Optional so non-idle-bearing surfaces need not fetch it;
   *  an idle card without it simply renders no Join disclosure. */
  joinServers?: ServersView;
}) {
  // Unconditional — the alive branch returns early below, and hooks may not sit behind it.
  const [joinOpen, setJoinOpen] = useState(false);

  if (card.state === "alive" && card.alive) {
    const a = card.alive;
    return (
      <section
        className={cn(
          "border border-hairline bg-white px-4 py-4 border-l-4",
          a.qualified ? "border-l-blue" : "border-l-yellow",
        )}
      >
        <div className="flex items-center gap-2.5">
          <h3 className="font-mono text-[10.5px] uppercase tracking-[.08em] text-ink-muted">
            Alive · {mapLabel(card.map)}
            {card.lifeNumber !== null ? ` · Life ${card.lifeNumber}` : ""}
          </h3>
          <StateChip state="alive" qualified={a.qualified} />
        </div>
        {/* Time alive is the one number that matters — a server-baked snapshot, same as the old
         *  fact line, so it carries no fake liveness. */}
        <p className="mt-2.5 font-display text-[34px] font-bold leading-none tabular-nums text-ink">
          {formatDuration(a.timeAliveSeconds)}
        </p>
        {!a.qualified && (
          <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[.04em] text-ink-muted">
            {serverFactLine(card)}
          </p>
        )}
        <div className="mt-3.5 flex items-center gap-2.5">
          {card.lifeNumber !== null && ownSlug && (
            <Link
              href={lifeHrefBySlug(ownSlug, card.slug, card.lifeNumber)}
              className="-skew-x-[5deg] bg-ink px-3.5 py-2 font-display text-[12.5px] font-bold uppercase tracking-[.1em] text-paper"
            >
              Timeline →
            </Link>
          )}
          <Link
            href={`/maps/${card.slug}`}
            className="border border-ink px-3.5 py-2 font-display text-[12.5px] font-bold uppercase tracking-[.1em] text-ink"
          >
            Open map
          </Link>
        </div>
      </section>
    );
  }

  const banned = card.state === "banned" && card.ban !== null;
  const countdown = banned ? banCountdown(card.ban!.expiresAt, now) : null;
  return (
    <section className={cn("border border-hairline bg-white px-4 py-3.5", banned && "border-l-4 border-l-red")}>
      <div className="flex items-center gap-2.5">
        <h3 className="font-display text-base font-semibold uppercase leading-none text-ink">{mapLabel(card.map)}</h3>
        <StateChip state={card.state} qualified />
      </div>
      <p className="mt-1.5 font-mono text-[10.5px] uppercase tracking-[.04em] text-ink-muted">
        {serverFactLine(card)}
        {banned && ownSlug && (
          <>
            {" · "}
            <Link href={`/players/${ownSlug}`} className="font-bold text-red-deep">
              Dossier →
            </Link>
          </>
        )}
        {card.lifeNumber !== null && ownSlug && (
          <>
            {" · "}
            <Link href={lifeHrefBySlug(ownSlug, card.slug, card.lifeNumber)} className="font-bold text-red-deep">
              Timeline →
            </Link>
          </>
        )}
      </p>
      {banned && (
        <>
          {card.ban!.expiresAt && (
            countdown ? (
              <div className="mt-2.5 flex items-center justify-between border border-hairline-2 bg-paper px-3 py-2">
                <span className="font-mono text-[10px] uppercase tracking-[.06em] text-ink-muted">Ban lifts in</span>
                <span className="font-display text-lg font-bold tabular-nums text-ink">{countdown}</span>
              </div>
            ) : (
              <div className="mt-2.5 border border-hairline-2 bg-paper px-3 py-2 text-center">
                <span className="font-display text-sm font-bold uppercase tracking-[.06em] text-ink-muted">Lifting…</span>
              </div>
            )
          )}
          <UnbanView
            state={unbanStateOf(card.ban!.liftPending || redeeming, balance, !balanceLoading)}
            balance={balance}
            onRedeem={() => onRedeem(card.ban!.banId)}
          />
        </>
      )}
      {card.state === "idle" && joinServers && (
        <>
          <button
            type="button"
            aria-expanded={joinOpen}
            onClick={() => setJoinOpen((v) => !v)}
            className="mt-2 inline-flex min-h-[44px] items-center font-mono text-[11px] font-bold uppercase tracking-[.05em] text-red-deep md:min-h-0"
          >
            Join {joinOpen ? "▾" : "▸"}
          </button>
          {joinOpen && (
            <div className="mt-1.5">
              <HowToConnect servers={joinServers} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
