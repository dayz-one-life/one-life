import type { SurvivorRow as SurvivorRowData } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MapBadge } from "./map-badge";
import { avatarSrc, formatTimeAlive } from "./format";

function Avatar({ row }: { row: SurvivorRowData }) {
  const src = avatarSrc(row.character);
  if (src) {
    return <img src={src} alt={row.character?.name ?? row.gamertag} className="h-10 w-10 rounded-full border border-line object-cover" />;
  }
  return (
    <span
      aria-label="Unknown survivor"
      className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-panel-2 text-muted"
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      </svg>
    </span>
  );
}

export function SurvivorRow({ row, rank, showMap }: { row: SurvivorRowData; rank: number; showMap: boolean }) {
  const longest = row.longestKillMeters === null ? "—" : `${row.longestKillMeters}m`;

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
          <span className="font-hand text-bone">{row.gamertag}</span>
          {showMap && <MapBadge slug={row.slug} />}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center sm:flex sm:gap-6 sm:text-right">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-muted">Time</span>
          <span className="font-mono text-bone">{formatTimeAlive(row.timeAliveSeconds)}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-muted">Kills</span>
          <span className="font-mono text-bone">{row.killsThisLife}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-muted">Longest</span>
          <span className="font-mono text-bone">{longest}</span>
        </div>
      </div>
    </div>
  );
}
