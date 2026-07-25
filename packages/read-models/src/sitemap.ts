import type { Database } from "@onelife/db";
import { players, lives, servers } from "@onelife/db";
import { eq, isNotNull, sql } from "drizzle-orm";

export interface SitemapPlayer {
  gamertag: string;
  lastmod: Date;
}
export interface SitemapLife {
  gamertag: string;
  mapSlug: string;
  n: number;
  lastmod: Date;
}
export interface SitemapEntries {
  players: SitemapPlayer[];
  lives: SitemapLife[];
}

/**
 * Every URL the sitemap may advertise, with an honest `lastmod`.
 *
 * A sitemap that lists a URL which 404s or redirects is worse than no sitemap, so the rules here
 * are about never emitting an unreachable URL:
 *  - a life is keyed by `servers.slug` (the segment the route resolves with `resolveServerBySlug`),
 *    NEVER `servers.map`, and a life on an un-slugged server has no reachable URL at all;
 *  - a player with no lives has nothing to render.
 *
 * `lives.life_number` IS the URL segment here — this generates the URL the router resolves by
 * number.
 */
export async function getSitemapEntries(db: Database): Promise<SitemapEntries> {
  const lastActivity = sql<Date>`max(coalesce(${lives.endedAt}, ${lives.startedAt}))`;

  const playerRows = await db
    .select({ gamertag: players.gamertag, lastmod: lastActivity })
    .from(players)
    .innerJoin(lives, eq(lives.playerId, players.id))
    .groupBy(players.gamertag);

  const lifeRows = await db
    .select({
      gamertag: players.gamertag,
      mapSlug: servers.slug,
      n: lives.lifeNumber,
      endedAt: lives.endedAt,
      startedAt: lives.startedAt,
    })
    .from(lives)
    .innerJoin(players, eq(lives.playerId, players.id))
    .innerJoin(servers, eq(lives.serverId, servers.id))
    .where(isNotNull(servers.slug));

  return {
    players: playerRows.map((r) => ({ gamertag: r.gamertag, lastmod: new Date(r.lastmod) })),
    lives: lifeRows.map((r) => ({
      gamertag: r.gamertag,
      mapSlug: r.mapSlug as string,
      n: r.n,
      lastmod: r.endedAt ?? r.startedAt,
    })),
  };
}
