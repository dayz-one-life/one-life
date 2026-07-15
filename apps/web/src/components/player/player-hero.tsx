import type { PlayerPage } from "@/lib/types";
import { PlayerAvatar } from "./player-avatar";
import { formatDuration, heroStatusLine } from "./format";

function Kpi({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex-1 rounded border border-line bg-panel-2 px-2 py-2 text-center">
      <span className="block font-display text-xl text-bone">{value}</span>
      <span className="text-[9px] uppercase tracking-wide text-muted">{label}</span>
    </div>
  );
}

export function PlayerHero({ page }: { page: PlayerPage }) {
  return (
    <header className="rounded-lg border border-line bg-panel p-4 sm:flex sm:items-center sm:gap-5">
      <div className="flex items-center gap-4 sm:flex-1">
        <PlayerAvatar character={page.heroCharacter} size={80} />
        <div>
          <h1 className="font-display text-2xl text-amber">{page.gamertag}</h1>
          {page.verified && <p className="text-xs text-emerald-400">✓ Verified survivor</p>}
          <p className="text-xs text-muted">{heroStatusLine(page)}</p>
        </div>
      </div>
      <div className="mt-4 flex gap-2 sm:mt-0">
        <Kpi value={String(page.totals.kills)} label="Kills" />
        <Kpi value={String(page.totals.lives)} label="Lives" />
        <Kpi value={String(page.totals.deaths)} label="Deaths" />
        <Kpi value={formatDuration(page.totals.longestLifeSeconds)} label="Longest life" />
      </div>
    </header>
  );
}
