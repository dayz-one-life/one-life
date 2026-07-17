import type { Database } from "@onelife/db";
import { lives, players, servers } from "@onelife/db";
import { and, eq, desc, isNotNull, sql } from "drizzle-orm";
import { qualifiedLifeCondition } from "./qualified-lives.js";

export const OBITUARIES_PAGE_SIZE = 20;

export interface Obituary {
  gamertag: string;
  map: string;
  slug: string | null;
  lifeNumber: number;
  cause: string | null;
  byGamertag: string | null;
  weapon: string | null;
  distanceMeters: number | null;
  timeAliveSeconds: number;
  endedAt: Date;
}

export interface ObituariesPage {
  rows: Obituary[];
  total: number;
  page: number;
  pageSize: number;
}

/** Recent qualified deaths, newest first. Paginated. */
export async function getObituaries(
  db: Database,
  opts: { page: number; pageSize?: number },
): Promise<ObituariesPage> {
  const pageSize = opts.pageSize ?? OBITUARIES_PAGE_SIZE;
  const page = Math.max(1, Math.trunc(opts.page) || 1);
  const where = and(isNotNull(lives.endedAt), qualifiedLifeCondition(db));

  const rows = await db
    .select({
      gamertag: players.gamertag,
      map: servers.map,
      slug: servers.slug,
      lifeNumber: lives.lifeNumber,
      cause: lives.deathCause,
      byGamertag: lives.deathByGamertag,
      weapon: lives.deathWeapon,
      distanceMeters: lives.deathDistance,
      timeAliveSeconds: lives.playtimeSeconds,
      endedAt: lives.endedAt,
    })
    .from(lives)
    .innerJoin(players, eq(players.id, lives.playerId))
    .innerJoin(servers, eq(servers.id, lives.serverId))
    .where(where)
    .orderBy(desc(lives.endedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const totalRow = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(lives)
    .innerJoin(players, eq(players.id, lives.playerId))
    .innerJoin(servers, eq(servers.id, lives.serverId))
    .where(where);

  return {
    rows: rows.map((r) => ({ ...r, slug: r.slug, endedAt: r.endedAt! })),
    total: totalRow[0]?.c ?? 0,
    page,
    pageSize,
  };
}
