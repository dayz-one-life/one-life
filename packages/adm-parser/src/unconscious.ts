import { parsePos } from "./coords.js";

const GAMERTAG_RE = /Player "([^"]+)"/u;
const DEAD_RE = /\(DEAD\)/u;

/**
 * `is unconscious` / `is disconnecting while being unconscious`.
 *
 * Infected deal SHOCK, which never appears in the `[HP: …]` field — a player is knocked out at
 * near-full health and DayZ then kills them for logging out unconscious. That is why this line,
 * not an HP threshold, is the signal that an infected mauling turned lethal.
 *
 * Deliberately NOT matched: `regained consciousness` (we record going down, not a state machine)
 * and `(DEAD) … is unconscious` (a corpse line, post-death noise).
 */
export function parseUnconscious(raw: string): {
  gamertag: string; disconnecting: boolean; x: number | null; y: number | null;
} | null {
  if (!raw.includes("unconscious")) return null;
  if (DEAD_RE.test(raw)) return null;

  const disconnecting = raw.includes("is disconnecting while being unconscious");
  if (!disconnecting && !raw.includes("is unconscious")) return null;

  const g = GAMERTAG_RE.exec(raw);
  if (!g) return null;

  const c = parsePos(raw);
  return { gamertag: g[1]!, disconnecting, x: c?.x ?? null, y: c?.y ?? null };
}
