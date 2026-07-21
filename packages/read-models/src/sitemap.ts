import type { Database } from "@onelife/db";
import { players, lives, servers, articles } from "@onelife/db";
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
export interface SitemapArticle {
  kind: string;
  slug: string;
  lastmod: Date;
}
export interface SitemapEntries {
  players: SitemapPlayer[];
  lives: SitemapLife[];
  articles: SitemapArticle[];
}

/**
 * Every URL the sitemap may advertise, with an honest `lastmod`.
 *
 * A sitemap that lists a URL which 404s or redirects is worse than no sitemap, so the rules here
 * are about never emitting an unreachable URL:
 *  - a life is keyed by `servers.slug` (the segment the route resolves with `resolveServerBySlug`),
 *    NEVER `servers.map`, and a life on an un-slugged server has no reachable URL at all;
 *  - a player with no lives has nothing to render;
 *  - only published articles — retracted ones are deliberately `noindex`.
 *
 * `lives.life_number` IS the URL segment here. That does not contradict the repo rule against
 * keying on `life_number`: that rule governs matching an ARTICLE to a life (stable key
 * `(server_id, gamertag, life_started_at)`). This is generating the URL the router resolves by
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

  const articleRows = await db
    .select({ kind: articles.kind, slug: articles.slug, lastmod: articles.createdAt })
    .from(articles)
    .where(eq(articles.status, "published"));

  return {
    players: playerRows.map((r) => ({ gamertag: r.gamertag, lastmod: new Date(r.lastmod) })),
    lives: lifeRows.map((r) => ({
      gamertag: r.gamertag,
      mapSlug: r.mapSlug as string,
      n: r.n,
      lastmod: r.endedAt ?? r.startedAt,
    })),
    articles: articleRows
      .filter((r): r is { kind: string; slug: string; lastmod: Date } => r.slug !== null)
      .map((r) => ({ kind: r.kind, slug: r.slug, lastmod: r.lastmod })),
  };
}
