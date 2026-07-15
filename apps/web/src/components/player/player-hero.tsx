import type { PlayerPage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { heroStats, monthYear, heroStatusLine } from "./format";

export function PlayerHero({ page }: { page: PlayerPage }) {
  const stats = heroStats(page.totals);
  const since = page.firstSeenAt ? monthYear(page.firstSeenAt) : null;
  const status = page.aliveAnywhere ? heroStatusLine(page) : null;
  const sub = [since ? `First seen ${since}` : null, status].filter(Boolean).join(" · ");
  return (
    <header className="space-y-6">
      <div className="text-center">
        <h1 className="font-display text-4xl text-bone sm:text-5xl">{page.gamertag}</h1>
        {page.verified && (
          <p className="mt-3">
            <span className="rounded-full border border-emerald-500/40 px-3 py-1 text-xs text-emerald-400">✓ Verified survivor</span>
          </p>
        )}
        {sub && <p className="mt-3 text-xs text-muted">{sub}</p>}
      </div>
      <div className="flex overflow-hidden rounded-xl border border-line">
        {stats.map((st, i) => (
          <div key={st.label} className={cn("flex-1 bg-panel-2 px-2 py-4 text-center", i > 0 && "border-l border-line")}>
            <span className={cn("block font-display text-2xl", st.hot ? "text-amber" : "text-bone")}>{st.value}</span>
            <span className="mt-1 block text-[9px] uppercase tracking-wide text-muted">{st.label}</span>
          </div>
        ))}
      </div>
    </header>
  );
}
