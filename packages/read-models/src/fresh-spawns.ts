import type { Database } from "@onelife/db";
import { lives, players, servers, sessions } from "@onelife/db";
import { and, eq, desc, sql } from "drizzle-orm";
import { qualifiedLifeCondition } from "./qualified-lives.js";
import { getLifeKills } from "./player-kills.js";
import { lifeQualifiedAt } from "./qualified.js";

export const FRESH_SPAWNS_PAGE_SIZE = 20;

export interface FreshSpawn {
  gamertag: string;
  map: string;
  slug: string | null;
  lifeNumber: number;
  startedAt: Date;
  qualifiedAt: Date | null;
}

export interface FreshSpawnsPage {
  rows: FreshSpawn[];
  total: number;
  page: number;
  pageSize: number;
}

/** Recent qualified births (alive or dead), newest birth first. `qualifiedAt` is computed
 *  for the returned page slice only (O(pageSize) extra queries), mirroring getPlayerPage. */
export async function getFreshSpawns(
  db: Database,
  opts: { page: number; pageSize?: number },
): Promise<FreshSpawnsPage> {
  const pageSize = opts.pageSize ?? FRESH_SPAWNS_PAGE_SIZE;
  const page = Math.max(1, Math.trunc(opts.page) || 1);
  const where = qualifiedLifeCondition(db);

  const rows = await db
    .select({
      lifeId: lives.id,
      serverId: lives.serverId,
      gamertag: players.gamertag,
      map: servers.map,
      slug: servers.slug,
      lifeNumber: lives.lifeNumber,
      startedAt: lives.startedAt,
      endedAt: lives.endedAt,
      deathCause: lives.deathCause,
      lastSeenAt: players.lastSeenAt,
    })
    .from(lives)
    .innerJoin(players, eq(players.id, lives.playerId))
    .innerJoin(servers, eq(servers.id, lives.serverId))
    .where(where)
    .orderBy(desc(lives.startedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const totalRow = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(lives)
    .innerJoin(players, eq(players.id, lives.playerId))
    .innerJoin(servers, eq(servers.id, lives.serverId))
    .where(where);

  const enriched: FreshSpawn[] = [];
  for (const r of rows) {
    const kills = await getLifeKills(db, r.serverId, r.gamertag, r.startedAt, r.endedAt);
    const sess = await db
      .select({ connectedAt: sessions.connectedAt, disconnectedAt: sessions.disconnectedAt, durationSeconds: sessions.durationSeconds })
      .from(sessions)
      .where(and(eq(sessions.serverId, r.serverId), eq(sessions.lifeId, r.lifeId)));
    const q = lifeQualifiedAt({
      deathCause: r.deathCause,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      playerKills: kills.map((k) => ({ occurredAt: k.occurredAt })),
      sessions: sess,
      lastSeenAt: r.lastSeenAt,
    });
    enriched.push({
      gamertag: r.gamertag,
      map: r.map,
      slug: r.slug,
      lifeNumber: r.lifeNumber,
      startedAt: r.startedAt,
      qualifiedAt: q?.at ?? null,
    });
  }

  return { rows: enriched, total: totalRow[0]?.c ?? 0, page, pageSize };
}
