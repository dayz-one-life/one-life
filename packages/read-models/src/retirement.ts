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
  const cap = lastSeenAt && lastSeenAt < retiredAt ? lastSeenAt : retiredAt;
  return { ...life, endedAt: retiredAt, endReason: "server_retired", playtimeSeconds: livePlaytime(life.playtimeSeconds, openSession, cap) };
}

export function closeSessionsAt<S extends { disconnectedAt: Date | null }>(rows: S[], retiredAt: Date | null): S[] {
  if (!retiredAt) return rows;
  return rows.map((s) => (s.disconnectedAt ? s : { ...s, disconnectedAt: retiredAt }));
}
