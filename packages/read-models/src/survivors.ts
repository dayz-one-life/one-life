import type { Database } from "@onelife/db";
import { players, lives, servers, sessions, kills } from "@onelife/db";
import { and, eq, isNull, isNotNull, inArray } from "drizzle-orm";
import { livePlaytime } from "./playtime.js";
import { isLifeQualified } from "./qualified.js";
import { getLifeCharacter } from "./character.js";
import { rosterByClass } from "@onelife/domain";

export const SURVIVORS_PAGE_SIZE = 25;

export type SurvivorSort = "kills" | "time" | "longest";

export interface SurvivorCharacter {
  name: string | null; // "Helga"
  head: string | null; // roster head key, e.g. "f_helga"
  gender: string | null; // "female" | "male"
}

export interface SurvivorRow {
  gamertag: string;
  map: string; // servers.map
  slug: string; // servers.slug
  timeAliveSeconds: number;
  killsThisLife: number;
  longestKillMeters: number | null;
  character: SurvivorCharacter | null; // Task 1 always sets null; Task 2 fills it
}

export interface SurvivorsPage {
  rows: SurvivorRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: SurvivorSort;
}

/** Internal candidate row: carries `serverId`/`startedAt` for Task 2's character enrichment —
 *  never exposed on `SurvivorRow`. */
interface SurvivorCandidate extends SurvivorRow {
  serverId: number;
  startedAt: Date;
}

function metricFor(sort: SurvivorSort, row: SurvivorCandidate): number {
  switch (sort) {
    case "kills":
      return row.killsThisLife;
    case "time":
      return row.timeAliveSeconds;
    case "longest":
      // nulls sort last under descending order
      return row.longestKillMeters ?? -Infinity;
  }
}

/**
 * Currently-alive survivors: players with an open, qualified life on an active, slugged server.
 * `character` is always null here — Task 2 enriches it from `character_sightings`.
 */
export async function getAliveSurvivors(
  db: Database,
  opts: { slug?: string; sort: SurvivorSort; page: number; pageSize?: number },
  now: Date,
): Promise<SurvivorsPage> {
  const pageSize = opts.pageSize ?? SURVIVORS_PAGE_SIZE;
  const sort = opts.sort;
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
    return { rows: [], total: 0, page, pageSize, sort };
  }

  const serverIds = [...new Set(openLives.map((r) => r.serverId))];
  const killRows = await db
    .select({
      serverId: kills.serverId,
      gamertag: kills.killerGamertag,
      occurredAt: kills.occurredAt,
      distance: kills.distance,
    })
    .from(kills)
    .where(inArray(kills.serverId, serverIds));

  const candidates: SurvivorCandidate[] = [];
  for (const r of openLives) {
    const upTo = r.lastSeenAt ?? r.connectedAt ?? now;
    const timeAliveSeconds = livePlaytime(r.stored, r.connectedAt ? { connectedAt: r.connectedAt } : null, upTo);

    // this-life kills: killerGamertag = gamertag AND serverId = server.id AND occurredAt >= life.startedAt
    const myKills = killRows.filter(
      (k) => k.serverId === r.serverId && k.gamertag === r.gamertag && k.occurredAt.getTime() >= r.startedAt.getTime(),
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
      character: null,
      serverId: r.serverId,
      startedAt: r.startedAt,
    });
  }

  candidates.sort((a, b) => {
    const byMetric = metricFor(sort, b) - metricFor(sort, a);
    if (byMetric !== 0) return byMetric;
    const byTime = b.timeAliveSeconds - a.timeAliveSeconds;
    if (byTime !== 0) return byTime;
    return a.gamertag.localeCompare(b.gamertag);
  });

  const total = candidates.length;
  const start = (page - 1) * pageSize;
  const pageCandidates = candidates.slice(start, start + pageSize);

  const rows: SurvivorRow[] = await Promise.all(
    pageCandidates.map(async ({ serverId, startedAt, ...row }) => {
      const lc = await getLifeCharacter(db, serverId, row.gamertag, startedAt, null);
      const rc = lc?.characterClass ? rosterByClass(lc.characterClass) : null;
      const character: SurvivorCharacter | null = rc ? { name: rc.name, head: rc.head, gender: rc.gender } : null;
      return { ...row, character };
    }),
  );

  return { rows, total, page, pageSize, sort };
}
