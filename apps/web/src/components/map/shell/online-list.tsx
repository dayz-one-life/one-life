import type { FriendPositionDto, OnlinePlayerDto } from "@/lib/types";
import { positionAge } from "../friends-map";

/** Who is on this server. Replaces FriendsMapLegend: it is still the screen-reader companion
 *  to a canvas with no text, so it stays a real list reached by a real button.
 *
 *  ⚠️ DARK SURFACE — cream/paper tokens only.
 *  Order comes from the server (self → friends sharing → friends → sharing → rest); do not
 *  re-sort here, or the rule lives in two places. */
export function OnlineList({ players, positions, now }: {
  players: OnlinePlayerDto[];
  /** Fixes for the players who are sharing — the ONLY source of a fix age. A row not present
   *  here has no fix and must show none: absence, not a fabricated "unknown". */
  positions?: FriendPositionDto[];
  now?: Date;
}) {
  if (players.length === 0) {
    return (
      <p className="font-mono text-[15px] uppercase tracking-[.05em] text-cream-muted md:text-[11px]">
        Nobody is on this server right now.
      </p>
    );
  }
  return (
    <ul role="list" className="flex flex-col">
      {players.map((p) => {
        // Case-insensitive: the fix keyed by gamertag comes from a different DTO than the
        // roster row, and nothing guarantees identical casing between the two.
        const fix = p.sharing
          ? positions?.find((pos) => pos.gamertag.toLowerCase() === p.gamertag.toLowerCase())
          : undefined;
        return (
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
            {/* Not colour alone — WCAG 1.4.1. The words carry it. Age is reported ONLY when a
                fix is actually known, so a stale bound (MARKER_MAX_AGE_SECONDS) is learnable
                here, not just from mouse-driven canvas chrome. */}
            {p.sharing && (
              <span className="shrink-0 text-red">
                On the map{fix && now ? ` · ${positionAge(fix.recordedAt, now)}` : ""}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
