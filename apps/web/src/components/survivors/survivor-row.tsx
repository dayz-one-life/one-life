import type { SurvivorRow as SurvivorRowData, SurvivorSort } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MapBadge } from "./map-badge";
import { avatarSrc, formatTimeAlive } from "./format";
import { GamertagLink } from "@/components/gamertag-link";

function Avatar({ row }: { row: SurvivorRowData }) {
  const src = avatarSrc(row.character);
  if (src) {
    return <img src={src} alt={row.character?.name ?? row.gamertag} className="h-20 w-20 rounded-full border border-line object-cover" />;
  }
  return (
    <span
      aria-label="Unknown survivor"
      className="flex h-20 w-20 items-center justify-center rounded-full border border-line bg-panel-2 text-muted"
    >
      <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      </svg>
    </span>
  );
}

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
  const stat = statFor(sort, row);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded border bg-panel p-3 sm:flex-row sm:items-center sm:gap-4",
        rank <= 3 ? "border-amber/40" : "border-line"
      )}
    >
      <div className="flex items-center gap-3 sm:flex-1">
        <span className="w-6 shrink-0 text-right font-mono text-sm text-muted">{rank}</span>
        <Avatar row={row} />
        <div className="flex flex-col">
          <GamertagLink gamertag={row.gamertag} />
          {showMap && <MapBadge slug={row.slug} />}
        </div>
      </div>

      <div className="text-center sm:text-right">
        <span className="block text-[10px] uppercase tracking-wide text-muted">{stat.label}</span>
        <span className="font-mono text-bone">{stat.value}</span>
      </div>
    </div>
  );
}
