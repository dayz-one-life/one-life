import { gamertagLinks, kills, lives, players, servers, sessions } from "@onelife/db";
import { lifeQualifiedAt, type LifeSessionSlice } from "@onelife/read-models";
import { and, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import type { Generator, NotificationDraft } from "../types.js";
import { windowStart } from "../types.js";
import { playerSlug } from "./account.js";

type Row = {
  lifeId: number; lifeNumber: number; startedAt: Date; qualifiedAt: Date;
  userId: string; gamertag: string; serverSlug: string | null; serverName: string;
};

/**
 * Open lives owned by a verified user on a slugged server, with qualification DERIVED in
 * TypeScript via lifeQualifiedAt() — the same lazy predicate the survivors board, the
 * enforcer and the newsdesk use. There is deliberately no SQL qualification filter:
 * qualifiedLifeCondition/lives.playtime_seconds only advance when a session CLOSES, so
 * any SQL prefilter would miss a life that crosses the threshold mid-session. The
 * candidate set is "currently alive verified players", which is small.
 */
async function openQualifiedLives(deps: Parameters<Generator>[0]): Promise<Row[]> {
  const candidates = await deps.db
    .select({
      lifeId: lives.id, lifeNumber: lives.lifeNumber, startedAt: lives.startedAt,
      deathCause: lives.deathCause, serverId: lives.serverId, lastSeenAt: players.lastSeenAt,
      userId: gamertagLinks.userId, gamertag: gamertagLinks.gamertag,
      serverSlug: servers.slug, serverName: servers.name,
    })
    .from(lives)
    .innerJoin(players, eq(players.id, lives.playerId))
    .innerJoin(servers, eq(servers.id, lives.serverId))
    .innerJoin(gamertagLinks, and(
      eq(gamertagLinks.status, "verified"),
      sql`lower(${gamertagLinks.gamertag}) = lower(${players.gamertag})`,
    ))
    .where(and(isNull(lives.endedAt), isNotNull(servers.slug)));

  if (candidates.length === 0) return [];

  const lifeIds = candidates.map((c) => c.lifeId);
  const serverIds = [...new Set(candidates.map((c) => c.serverId))];

  const sessionRows = await deps.db
    .select({
      lifeId: sessions.lifeId, connectedAt: sessions.connectedAt,
      disconnectedAt: sessions.disconnectedAt, durationSeconds: sessions.durationSeconds,
    })
    .from(sessions)
    .where(inArray(sessions.lifeId, lifeIds));

  const killRows = await deps.db
    .select({ serverId: kills.serverId, gamertag: kills.killerGamertag, occurredAt: kills.occurredAt })
    .from(kills)
    .where(inArray(kills.serverId, serverIds));

  const rows: Row[] = [];
  for (const c of candidates) {
    const lifeSessions: LifeSessionSlice[] = sessionRows
      .filter((s) => s.lifeId === c.lifeId)
      .map((s) => ({ connectedAt: s.connectedAt, disconnectedAt: s.disconnectedAt, durationSeconds: s.durationSeconds }));
    const playerKills = killRows.filter(
      (k) => k.serverId === c.serverId && k.gamertag.toLowerCase() === c.gamertag.toLowerCase(),
    );
    const q = lifeQualifiedAt({
      startedAt: c.startedAt,
      endedAt: null, // open life
      deathCause: c.deathCause,
      sessions: lifeSessions,
      lastSeenAt: c.lastSeenAt,
      playerKills,
    });
    if (!q) continue;
    rows.push({
      lifeId: c.lifeId, lifeNumber: c.lifeNumber, startedAt: c.startedAt, qualifiedAt: q.at,
      userId: c.userId, gamertag: c.gamertag, serverSlug: c.serverSlug, serverName: c.serverName,
    });
  }
  return rows;
}

const lifeHref = (r: Row) => `/players/${playerSlug(r.gamertag)}/${r.serverSlug}/lives/${r.lifeNumber}`;

export const lifeQualifiedGenerator: Generator = async (deps) => {
  const start = windowStart(deps);
  // Window on the derived qualification instant itself — exact, unlike windowing on startedAt.
  const rows = (await openQualifiedLives(deps)).filter((r) => r.qualifiedAt >= start);
  return rows.map((r): NotificationDraft => ({
    userId: r.userId,
    kind: "life_qualified",
    naturalKey: `life_qualified:${r.lifeId}`,
    title: "This life counts now",
    body: `${r.serverName}: life ${r.lifeNumber} is qualified. Dying costs you 24 hours.`,
    href: lifeHref(r),
  }));
};

const MILESTONE_DAYS = [7, 14, 30] as const;

/** Milestones are time-derived, so the window is the milestone's crossing instant
 *  (startedAt + m days): a life is only eligible once it has been open that long AND
 *  that crossing falls inside the current lookback window. Without the latter check, a
 *  life far older than any threshold would re-emit every threshold on every tick forever
 *  (and, at go-live, would emit all three thresholds at once for old open lives). The
 *  natural key carries the day count, so each threshold fires exactly once per life
 *  regardless.  */
export const survivalMilestoneGenerator: Generator = async (deps) => {
  // No qualification-instant filter here: eligibility is the life's age, not when it
  // qualified. The window is enforced per-milestone against the crossing instant instead.
  const rows = await openQualifiedLives(deps);
  const start = windowStart(deps);
  const drafts: NotificationDraft[] = [];
  for (const r of rows) {
    const days = (deps.now.getTime() - r.startedAt.getTime()) / 86_400_000;
    for (const m of MILESTONE_DAYS) {
      if (days < m) continue;
      const crossedAt = new Date(r.startedAt.getTime() + m * 86_400_000);
      if (crossedAt < start) continue;
      drafts.push({
        userId: r.userId,
        kind: "survival_milestone",
        naturalKey: `milestone:${m}d:${r.lifeId}`,
        title: `${m} days alive`,
        body: `${r.serverName}: life ${r.lifeNumber} has survived ${m} days.`,
        href: lifeHref(r),
      });
    }
  }
  return drafts;
};
