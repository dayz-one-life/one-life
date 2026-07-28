import type { FriendPositionDto, OnlinePlayerDto } from "@/lib/types";
import { positionAge } from "../friends-map";

/** Who is on this server. Replaces FriendsMapLegend: it is still the screen-reader companion
 *  to a canvas with no text, so it stays a real list reached by a real button.
 *
 *  ⚠️ DARK SURFACE — cream/paper tokens only.
 *  Order comes from the server (self → friends sharing → friends → sharing → rest); do not
 *  re-sort here, or the rule lives in two places. */
export function OnlineList({ players, positions, now, onShare, onStopSharing, pendingFor }: {
  players: OnlinePlayerDto[];
  /** Fixes for the players who are sharing — the ONLY source of a fix age. A row not present
   *  here has no fix and must show none: absence, not a fabricated "unknown". */
  positions?: FriendPositionDto[];
  now?: Date;
  /** Absent ⇒ no grant controls (a viewer who cannot grant, e.g. while offline). */
  onShare?: (gamertag: string) => void;
  onStopSharing?: (gamertag: string) => void;
  /** The gamertag whose grant is in flight, if any. */
  pendingFor?: string | null;
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
            // `flex-wrap` + `break-all`: a long gamertag beside "On the map · 2m ago" and a
            // grant button cannot fit one 320px row — without wrapping they overprint each
            // other (shipped that way once, verified on the live site).
            className={`flex min-h-[52px] flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1 font-mono text-[15px] uppercase tracking-[.05em] md:min-h-0 md:text-[11px] ${
              p.friend || p.self ? "text-paper" : "text-cream-dim"
            }`}
          >
            <span className={`min-w-0 break-all ${p.friend || p.self ? "font-bold" : ""}`}>
              {p.gamertag}
              {p.self ? " (you)" : ""}
            </span>
            {/* Not colour alone — WCAG 1.4.1. The words carry it. Age is reported ONLY when a
                fix is actually known, so a stale bound (MARKER_MAX_AGE_SECONDS) is learnable
                here, not just from mouse-driven canvas chrome. */}
            <span className="flex shrink-0 items-center gap-3">
              {p.sharing && (
                <span className="text-red">
                  On the map{fix && now ? ` · ${positionAge(fix.recordedAt, now)}` : ""}
                </span>
              )}
              {/* ⚠️ OUTBOUND, and worded as such. `sharing` above is what THEY have given the
                  viewer; this is what the viewer has given them. Two directions, never merged
                  into one "sharing" state — a control that conflated them would let someone
                  believe seeing a dot means being seen. */}
              {!p.self && onShare && onStopSharing && (
                p.sharedWithThem ? (
                  <button
                    type="button"
                    disabled={pendingFor === p.gamertag}
                    onClick={() => onStopSharing(p.gamertag)}
                    className="min-h-[44px] border border-dark-edge px-2 font-bold text-paper uppercase tracking-[.05em] disabled:opacity-50 md:min-h-0 md:py-0.5"
                  >
                    Sharing · Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={pendingFor === p.gamertag}
                    onClick={() => onShare(p.gamertag)}
                    className="min-h-[44px] border border-dark-edge px-2 text-cream-dim uppercase tracking-[.05em] hover:text-paper disabled:opacity-50 md:min-h-0 md:py-0.5"
                  >
                    Share
                  </button>
                )
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
