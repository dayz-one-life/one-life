import type { Database } from "@onelife/db";
import { players, lives, servers, sessions, kills } from "@onelife/db";
import { and, eq, isNull, isNotNull, inArray } from "drizzle-orm";
import { livePlaytime } from "./playtime.js";
import { isLifeQualified } from "./qualified.js";

export const SURVIVORS_PAGE_SIZE = 25;

export interface SurvivorRow {
  gamertag: string;
  map: string; // servers.map
  slug: string; // servers.slug
  timeAliveSeconds: number;
  killsThisLife: number;
  longestKillMeters: number | null;
}

export interface SurvivorsPage {
  rows: SurvivorRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** Internal candidate row: carries `serverId`/`startedAt` for Task 2's character enrichment —
 *  never exposed on `SurvivorRow`. */
interface SurvivorCandidate extends SurvivorRow {
  serverId: number;
  startedAt: Date;
}

/**
 * ⚠️ ONE order, and it is not configurable. Sub-project D deleted the whole sort layer
 * (`kills`/`time`/`longest`, the combined board, and the rule that no server slug may ever be one
 * of those three words): a permadeath tool ranks by the only number that means anything here —
 * how long you have stayed alive. Kills and longest kill remain TIE-BREAKS, not orderings.
 *
 * `-Infinity` for a missing longest kill sorts it last under descending order; the skip-if-equal
 * comparator below never subtracts two of them, which would be NaN.
 */
const METRICS: ((row: SurvivorCandidate) => number)[] = [
  (row) => row.timeAliveSeconds,
  (row) => row.killsThisLife,
  (row) => row.longestKillMeters ?? -Infinity,
];

/**
 * Currently-alive survivors: players with an open, qualified life on an active, slugged server.
 */
export async function getAliveSurvivors(
  db: Database,
  opts: { slug?: string; page: number; pageSize?: number },
  now: Date,
): Promise<SurvivorsPage> {
  const pageSize = opts.pageSize ?? SURVIVORS_PAGE_SIZE;
  const page = Math.max(1, Math.trunc(opts.page) || 1);

  const serverFilter = opts.slug
    ? and(eq(servers.active, true), isNotNull(servers.slug), eq(servers.slug, opts.slug))
    : and(eq(servers.active, true), isNotNull(servers.slug));

  const openLives = await db
    .select({
      serverId: servers.id,
      map: servers.map,
      slug: servers.slug,
      gamertag: players.gamertag,
      playerId: players.id,
      lastSeenAt: players.lastSeenAt,
      stored: lives.playtimeSeconds,
      startedAt: lives.startedAt,
      deathCause: lives.deathCause,
      connectedAt: sessions.connectedAt,
    })
    .from(lives)
    .innerJoin(servers, eq(servers.id, lives.serverId))
    .innerJoin(players, eq(players.id, lives.playerId))
    .leftJoin(sessions, and(eq(sessions.lifeId, lives.id), isNull(sessions.disconnectedAt)))
    .where(and(isNull(lives.endedAt), serverFilter));

  if (openLives.length === 0) {
    return { rows: [], total: 0, page, pageSize };
  }

  const serverIds = [...new Set(openLives.map((r) => r.serverId))];
  const killRows = await db
    .select({
      serverId: kills.serverId,
      killerPlayerId: kills.killerPlayerId,
      occurredAt: kills.occurredAt,
      distance: kills.distance,
    })
    .from(kills)
    .where(inArray(kills.serverId, serverIds));

  const candidates: SurvivorCandidate[] = [];
  for (const r of openLives) {
    const upTo = r.lastSeenAt ?? r.connectedAt ?? now;
    const timeAliveSeconds = livePlaytime(r.stored, r.connectedAt ? { connectedAt: r.connectedAt } : null, upTo);

    // this-life kills: killer_player_id = player.id (the identity, not the name) AND
    // serverId = server.id AND occurredAt >= life.startedAt. A null killer_player_id never
    // equals a real id, so orphan kills are correctly excluded.
    const myKills = killRows.filter(
      (k) => k.serverId === r.serverId && k.killerPlayerId === r.playerId && k.occurredAt.getTime() >= r.startedAt.getTime(),
    );

    const qualified = isLifeQualified({
      deathCause: r.deathCause,
      effectivePlaytimeSeconds: timeAliveSeconds,
      startedAt: r.startedAt,
      windowEnd: upTo,
      playerKills: myKills,
    });
    if (!qualified) continue;

    const longestKillMeters = myKills.reduce<number | null>((max, k) => {
      if (k.distance == null) return max;
      return max === null ? k.distance : Math.max(max, k.distance);
    }, null);

    candidates.push({
      gamertag: r.gamertag,
      map: r.map,
      slug: r.slug as string, // serverFilter guarantees isNotNull(servers.slug)
      timeAliveSeconds,
      killsThisLife: myKills.length,
      longestKillMeters,
      serverId: r.serverId,
      startedAt: r.startedAt,
    });
  }

  candidates.sort((a, b) => {
    for (const metric of METRICS) {
      const av = metric(a);
      const bv = metric(b);
      if (av !== bv) return bv - av; // descending; skip-if-equal avoids -Infinity−(-Infinity)=NaN
    }
    return a.gamertag.localeCompare(b.gamertag);
  });

  const total = candidates.length;
  const start = (page - 1) * pageSize;
  const pageCandidates = candidates.slice(start, start + pageSize);

  const rows: SurvivorRow[] = pageCandidates.map(({ serverId, startedAt, ...row }) => row);

  return { rows, total, page, pageSize };
}
