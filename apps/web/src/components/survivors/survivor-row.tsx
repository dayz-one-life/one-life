import type { SurvivorRow as SurvivorRowData, SurvivorSort } from "@/lib/types";
import { avatarSrc, formatTimeAlive, tierFor } from "./format";
import { GamertagLink } from "@/components/gamertag-link";

/** The single stat shown for a given sort. */
function statFor(sort: SurvivorSort, row: SurvivorRowData): { label: string; value: string } {
  switch (sort) {
    case "kills":
      return { label: "Kills", value: String(row.killsThisLife) };
    case "longest":
      return { label: "Longest kill", value: row.longestKillMeters === null ? "—" : `${row.longestKillMeters}m` };
    case "time":
    default:
      return { label: "Time alive", value: formatTimeAlive(row.timeAliveSeconds) };
  }
}

function Portrait({ row, size }: { row: SurvivorRowData; size: number }) {
  const src = avatarSrc(row.character);
  const box = { width: size, height: size };
  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        style={box}
        className="border border-hairline object-cover"
      />
    );
  }
  return (
    <span aria-hidden="true" style={box} className="flex items-center justify-center border border-hairline bg-bone text-ink-muted">
      <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="currentColor" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      </svg>
    </span>
  );
}

/** Mono sub-line under the gamertag: map (combined board) and, on the hero row, a kills flourish. */
function subLine(row: SurvivorRowData, sort: SurvivorSort, showMap: boolean, hero: boolean): string | null {
  const parts: string[] = [];
  if (showMap) parts.push(row.slug);
  if (hero && sort !== "kills" && row.killsThisLife > 0) parts.push(`${row.killsThisLife} kills`);
  return parts.length ? parts.join(" · ") : null;
}

export function SurvivorRow({
  row,
  rank,
  showMap,
  sort,
}: {
  row: SurvivorRowData;
  rank: number;
  showMap: boolean;
  sort: SurvivorSort;
}) {
  const tier = tierFor(rank);
  const stat = statFor(sort, row);

  if (tier === "hero") {
    const sub = subLine(row, sort, showMap, true);
    return (
      <div className="grid grid-cols-[40px_76px_1fr_auto] items-center gap-x-3 border-b border-hairline bg-bone px-2 py-4 sm:grid-cols-[56px_76px_1fr_auto] sm:gap-x-4">
        <span aria-hidden className="text-center font-display text-[40px] font-bold leading-none text-red">{rank}</span>
        <Portrait row={row} size={76} />
        <div className="min-w-0">
          <GamertagLink gamertag={row.gamertag} className="font-display text-xl font-bold uppercase leading-none text-ink sm:text-[26px]" />
          {sub && <div className="mt-1 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">{sub}</div>}
        </div>
        <div className="text-right">
          <div className="font-display text-2xl font-bold leading-none text-ink sm:text-[28px]">{stat.value}</div>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[.06em] text-ink-muted">{stat.label}</div>
        </div>
      </div>
    );
  }

  if (tier === "podium") {
    const sub = subLine(row, sort, showMap, false);
    return (
      <div className="grid grid-cols-[40px_60px_1fr_auto] items-center gap-x-3 border-b border-hairline px-2 py-3 sm:grid-cols-[56px_60px_1fr_auto] sm:gap-x-4">
        <span aria-hidden className="text-center font-display text-[28px] font-bold leading-none text-red">{rank}</span>
        <Portrait row={row} size={60} />
        <div className="min-w-0">
          <GamertagLink gamertag={row.gamertag} className="font-display text-lg font-bold uppercase leading-none text-ink sm:text-[21px]" />
          {sub && <div className="mt-0.5 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">{sub}</div>}
        </div>
        <div className="text-right font-display text-lg font-bold leading-none text-ink sm:text-[21px]">{stat.value}</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[40px_1fr_auto] items-center gap-x-3 border-b border-hairline-2 px-2 py-2.5 sm:grid-cols-[56px_1fr_auto] sm:gap-x-4">
      <span aria-hidden className="text-center font-display text-xl font-bold leading-none text-ink">{rank}</span>
      <div className="min-w-0">
        <GamertagLink gamertag={row.gamertag} className="font-display text-[17px] font-semibold uppercase text-ink" />
        {showMap && <span className="ml-2 font-mono text-[11px] uppercase text-ink-muted">{row.slug}</span>}
      </div>
      <div className="text-right font-mono text-[15px] font-bold text-ink">{stat.value}</div>
    </div>
  );
}
