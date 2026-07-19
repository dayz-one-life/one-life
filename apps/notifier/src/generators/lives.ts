import { gamertagLinks, lives, players, servers } from "@onelife/db";
import { and, eq, gte, isNull, isNotNull, sql, type SQL } from "drizzle-orm";
import type { Generator, NotificationDraft } from "../types.js";
import { windowStart } from "../types.js";
import { playerSlug } from "./account.js";

type Row = {
  lifeId: number; lifeNumber: number; startedAt: Date; qualifiedAt: Date;
  userId: string; gamertag: string; serverSlug: string | null; serverName: string;
};

/** Open, qualified lives owned by a verified user. qualified_at is materialized by the
 *  projector fold (write-once), so IS NOT NULL is the authoritative qualification signal. */
async function openQualifiedLives(deps: Parameters<Generator>[0], extra?: SQL): Promise<Row[]> {
  return deps.db
    .select({
      lifeId: lives.id, lifeNumber: lives.lifeNumber, startedAt: lives.startedAt,
      qualifiedAt: lives.qualifiedAt,
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
    .where(and(
      isNull(lives.endedAt),
      isNotNull(servers.slug),
      isNotNull(lives.qualifiedAt),
      ...(extra ? [extra] : []),
    )) as Promise<Row[]>;
}

const lifeHref = (r: Row) => `/players/${playerSlug(r.gamertag)}/${r.serverSlug}/lives/${r.lifeNumber}`;

export const lifeQualifiedGenerator: Generator = async (deps) => {
  // Window on the qualification instant itself — exact, unlike windowing on startedAt.
  const rows = await openQualifiedLives(deps, gte(lives.qualifiedAt, windowStart(deps)));
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

/** Milestones are time-derived, so the window is the milestone itself: a life is only
 *  eligible once it has been open that long. The natural key carries the day count, so
 *  each threshold fires exactly once per life. */
export const survivalMilestoneGenerator: Generator = async (deps) => {
  // No time filter: eligibility is the life's age, computed below, not when it qualified.
  const rows = await openQualifiedLives(deps);
  const drafts: NotificationDraft[] = [];
  for (const r of rows) {
    const days = (deps.now.getTime() - r.startedAt.getTime()) / 86_400_000;
    for (const m of MILESTONE_DAYS) {
      if (days < m) continue;
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
