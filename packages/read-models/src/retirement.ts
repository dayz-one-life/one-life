import { livePlaytime } from "./playtime.js";

export type EndReason = "death" | "server_retired";

/** ⚠️ Retirement is DERIVED, never written: an open life on a server with `retired_at` ended then,
 *  and not by death. Writing it into `lives` would be lost on `--rebuild` and would look like a
 *  death to the enforcer. Only readers that do not filter on `servers.active` need this. */
export function applyRetirement<L extends { endedAt: Date | null; playtimeSeconds: number }>(
  life: L, openSession: { connectedAt: Date } | null, retiredAt: Date | null, lastSeenAt: Date | null,
): L & { endReason: EndReason | null } {
  if (life.endedAt) return { ...life, endReason: "death" };
  if (!retiredAt) return { ...life, endReason: null };
  return {
    ...life, endedAt: retiredAt, endReason: "server_retired",
    playtimeSeconds: livePlaytime(life.playtimeSeconds, openSession, retirementCap(retiredAt, lastSeenAt)),
  };
}

/** Where a retired life's open session stops counting: `retired_at`, or the player's last
 *  heartbeat when that is earlier (a ghosted player stops accumulating, as everywhere else).
 *  The playtime, the closed session and the life-track window all use this one cap so they agree;
 *  the life's `endedAt` stays `retired_at`. */
export function retirementCap(retiredAt: Date, lastSeenAt: Date | null): Date {
  return lastSeenAt && lastSeenAt < retiredAt ? lastSeenAt : retiredAt;
}

export function closeSessionsAt<S extends { disconnectedAt: Date | null }>(
  rows: S[], retiredAt: Date | null, lastSeenAt: Date | null,
): S[] {
  if (!retiredAt) return rows;
  const cap = retirementCap(retiredAt, lastSeenAt);
  return rows.map((s) => (s.disconnectedAt ? s : { ...s, disconnectedAt: cap }));
}
