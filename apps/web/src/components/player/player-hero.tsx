import type { PlayerPage } from "@/lib/types";
import { heroStats, monthYear, aliveMaps } from "./format";
import { Stat } from "./stat";

export function PlayerHero({ page }: { page: PlayerPage }) {
  const stats = heroStats(page.totals);
  const alive = aliveMaps(page);
  const overline = page.firstSeenAt
    ? `First seen ${monthYear(page.firstSeenAt)}${alive.length ? ` · alive on ${alive.join(", ")}` : ""}`
    : null;

  return (
    <header className="border-b-[3px] border-ink pb-6">
      {overline && (
        <p className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">{overline}</p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="font-display text-5xl font-bold uppercase leading-[.92] text-ink sm:text-6xl">{page.gamertag}</h1>
        {alive.length > 0 && (
          <span className="-skew-x-[5deg] bg-blue px-2.5 pb-0.5 pt-1 font-display text-xs font-bold uppercase tracking-[.1em] text-white">
            {alive.length > 1 ? `Alive ×${alive.length}` : "Alive"}
          </span>
        )}
        {page.verified && (
          <span className="-rotate-6 border-2 border-red px-2.5 pb-0.5 pt-1 font-display text-xs font-bold uppercase tracking-[.12em] text-red-deep">
            Verified
          </span>
        )}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-y-4 sm:flex sm:gap-x-9">
        {stats.map((st) => (
          <Stat key={st.label} value={st.value} label={st.label} size="lg" hot={st.hot} />
        ))}
      </div>
    </header>
  );
}
