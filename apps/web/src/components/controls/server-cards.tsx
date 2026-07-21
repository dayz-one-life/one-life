import Link from "next/link";
import { cn } from "@/lib/utils";
import { lifeHrefBySlug } from "@/lib/life-href";
import { banCountdown, mapLabel } from "@/components/player/format";
import { UnbanView, unbanStateOf } from "@/components/player/self-unban-button";
import { serverFactLine, type ServerCardData } from "./format";

export function StateChip({ state, small = false }: { state: ServerCardData["state"]; small?: boolean }) {
  const base = cn("ml-auto flex-none px-2 pb-0.5 pt-1 font-display font-bold uppercase tracking-[.1em]", small ? "text-[9px]" : "text-[10px]");
  if (state === "alive") return <span className={cn(base, "bg-blue text-white")}>Alive</span>;
  if (state === "banned") return <span className={cn(base, "bg-red text-white")}>Banned</span>;
  return <span className={cn(base, "border border-dashed border-dash font-semibold text-ink-muted")}>No life</span>;
}

/** One rail card per active server: name + state chip + fact line; banned adds countdown + spend CTA. */
export function ServerCard({
  card,
  ownSlug,
  balance,
  balanceLoading = false,
  now,
  onRedeem,
  redeeming,
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
}) {
  const banned = card.state === "banned" && card.ban !== null;
  const countdown = banned ? banCountdown(card.ban!.expiresAt, now) : null;
  return (
    <section className={cn("border border-hairline bg-white px-4 py-3.5", banned && "border-l-4 border-l-red")}>
      <div className="flex items-center gap-2.5">
        <h3 className="font-display text-base font-semibold uppercase leading-none text-ink">{mapLabel(card.map)}</h3>
        <StateChip state={card.state} />
      </div>
      <p className="mt-1.5 font-mono text-[10.5px] uppercase tracking-[.04em] text-ink-muted">
        {serverFactLine(card)}
        {banned && ownSlug && (
          <>
            {" · "}
            <Link href={`/players/${ownSlug}`} className="font-bold text-red-deep">
              Obituary →
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
    </section>
  );
}
