/** Live playtime for a life: stored (closed-session) seconds plus the open session's elapsed time,
 *  but the open session is counted only up to `upTo` — the player's last_seen_at heartbeat — so a
 *  crashed/ghosted player (no recent position ping) stops accumulating instead of growing to `now`. */
export function livePlaytime(
  storedSeconds: number,
  openSession: { connectedAt: Date } | null,
  upTo: Date | null,
): number {
  if (!openSession || !upTo) return storedSeconds;
  return storedSeconds + Math.max(0, Math.floor((upTo.getTime() - openSession.connectedAt.getTime()) / 1000));
}
