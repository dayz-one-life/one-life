import type { SurvivorRow as SurvivorRowData } from "@/lib/types";
import { formatTimeAlive, tierFor } from "./format";
import { GamertagLink } from "@/components/gamertag-link";
import { Avatar } from "@/components/shared/avatar";

/**
 * The single stat every row shows. There is one ranking now — time alive — so this is no longer a
 * switch over a sort (sub-project D deleted the sort layer). Kills and longest kill survive as
 * TIE-BREAKS in the read-model, not as things a row displays.
 */
function statFor(row: SurvivorRowData): { label: string; value: string } {
  return { label: "Time alive", value: formatTimeAlive(row.timeAliveSeconds) };
}

/** Mono sub-line under the gamertag: on the hero row, a kills flourish. The map is never shown —
 *  every board is a single map now, so naming it on every row would be noise. */
function subLine(row: SurvivorRowData, hero: boolean): string | null {
  if (hero && row.killsThisLife > 0) return `${row.killsThisLife} kills`;
  return null;
}

export function SurvivorRow({
  row,
  rank,
}: {
  row: SurvivorRowData;
  rank: number;
}) {
  const tier = tierFor(rank);
  const stat = statFor(row);
  const fallbackInitial = row.gamertag.trim().charAt(0).toUpperCase();

  if (tier === "hero") {
    const sub = subLine(row, true);
    return (
      <div className="grid grid-cols-[40px_96px_1fr_auto] items-center gap-x-3 border-b border-hairline bg-bone px-2 py-4 sm:grid-cols-[56px_96px_1fr_auto] sm:gap-x-4">
        <span aria-hidden className="text-center font-display text-[40px] font-bold leading-none text-red">{rank}</span>
        <Avatar hash={row.avatarHash} size={96} fallbackInitial={fallbackInitial} />
        <div className="min-w-0">
          <GamertagLink gamertag={row.gamertag} className="block truncate font-display text-xl font-bold uppercase leading-none text-ink sm:text-[26px]" />
          {sub && <div className="mt-1 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">{sub}</div>}
        </div>
        <div className="text-right">
          <div className="font-display text-2xl font-bold leading-none tabular-nums text-ink sm:text-[28px]">{stat.value}</div>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[.06em] text-ink-muted">{stat.label}</div>
        </div>
      </div>
    );
  }

  if (tier === "podium") {
    const sub = subLine(row, false);
    return (
      <div className="grid grid-cols-[40px_60px_1fr_auto] items-center gap-x-3 border-b border-hairline px-2 py-3 sm:grid-cols-[56px_60px_1fr_auto] sm:gap-x-4">
        <span aria-hidden className="text-center font-display text-[28px] font-bold leading-none text-red">{rank}</span>
        <Avatar hash={row.avatarHash} size={60} fallbackInitial={fallbackInitial} />
        <div className="min-w-0">
          <GamertagLink gamertag={row.gamertag} className="block truncate font-display text-lg font-bold uppercase leading-none text-ink sm:text-[21px]" />
          {sub && <div className="mt-0.5 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">{sub}</div>}
        </div>
        <div className="text-right font-display text-lg font-bold leading-none tabular-nums text-ink sm:text-[21px]">{stat.value}</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[40px_28px_1fr_auto] items-center gap-x-3 border-b border-hairline-2 px-2 py-2.5 sm:grid-cols-[56px_28px_1fr_auto] sm:gap-x-4">
      <span aria-hidden className="text-center font-display text-xl font-bold leading-none text-ink">{rank}</span>
      <Avatar hash={row.avatarHash} size={28} fallbackInitial={fallbackInitial} />
      <div className="min-w-0">
        <GamertagLink gamertag={row.gamertag} className="inline-block max-w-full truncate font-display text-[17px] font-semibold uppercase text-ink" />
      </div>
      <div className="text-right font-mono text-[15px] font-bold tabular-nums text-ink">{stat.value}</div>
    </div>
  );
}
