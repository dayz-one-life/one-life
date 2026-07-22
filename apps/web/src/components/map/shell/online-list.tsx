import type { OnlinePlayerDto } from "@/lib/types";

/** Who is on this server. Replaces FriendsMapLegend: it is still the screen-reader companion
 *  to a canvas with no text, so it stays a real list reached by a real button.
 *
 *  ⚠️ DARK SURFACE — cream/paper tokens only.
 *  Order comes from the server (self → friends sharing → friends → sharing → rest); do not
 *  re-sort here, or the rule lives in two places. */
export function OnlineList({ players }: { players: OnlinePlayerDto[] }) {
  if (players.length === 0) {
    return (
      <p className="font-mono text-[15px] uppercase tracking-[.05em] text-cream-muted md:text-[11px]">
        Nobody is on this server right now.
      </p>
    );
  }
  return (
    <ul role="list" className="flex flex-col">
      {players.map((p) => (
        <li
          key={p.gamertag}
          className={`flex min-h-[52px] items-center justify-between gap-3 font-mono text-[15px] uppercase tracking-[.05em] md:min-h-0 md:text-[11px] ${
            p.friend || p.self ? "text-paper" : "text-cream-dim"
          }`}
        >
          <span className={p.friend || p.self ? "font-bold" : undefined}>
            {p.gamertag}
            {p.self ? " (you)" : ""}
          </span>
          {/* Not colour alone — WCAG 1.4.1. The words carry it. */}
          {p.sharing && <span className="shrink-0 text-red">On the map</span>}
        </li>
      ))}
    </ul>
  );
}
