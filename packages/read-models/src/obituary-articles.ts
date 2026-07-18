import type { Database } from "@onelife/db";
import { articles } from "@onelife/db";
import { and, eq, desc, sql } from "drizzle-orm";

export const OBITUARIES_FEED_PAGE_SIZE = 20;

export interface ObituaryCard {
  slug: string;
  gamertag: string;
  map: string;
  mapSlug: string | null;
  lifeNumber: number;
  headline: string;
  lede: string;
  tags: string[];
  timeAliveSeconds: number;
  kills: number;
  longestKillMeters: number | null;
  cause: string | null;
  deathAt: Date;
}

export interface ObituariesFeed {
  rows: ObituaryCard[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ObituaryArticle extends ObituaryCard {
  body: string;
  pullQuote: { text: string; attribution: string } | null;
  sessions: number;
  killerGamertag: string | null;
  weapon: string | null;
  verdict: { cause: string; confidence: "high" | "low"; conditions: string[] } | null;
}

type FactsSnapshot = {
  sessions?: number; killerGamertag?: string | null; weapon?: string | null;
  verdict?: { cause?: string; confidence?: "high" | "low"; conditions?: string[] } | null;
};

const CARD_COLS = {
  slug: articles.slug,
  gamertag: articles.gamertag,
  map: articles.map,
  mapSlug: articles.mapSlug,
  lifeNumber: articles.lifeNumber,
  headline: articles.headline,
  lede: articles.lede,
  tags: articles.tags,
  timeAliveSeconds: articles.timeAliveSeconds,
  kills: articles.kills,
  longestKillMeters: articles.longestKillMeters,
  cause: articles.cause,
  deathAt: articles.deathAt,
} as const;

const publishedObituary = and(eq(articles.kind, "obituary"), eq(articles.status, "published"));

/** Published obituaries, newest death first. Paginated. Failed stubs are excluded. */
export async function getPublishedObituaries(
  db: Database,
  opts: { page: number; pageSize?: number },
): Promise<ObituariesFeed> {
  const pageSize = opts.pageSize ?? OBITUARIES_FEED_PAGE_SIZE;
  const page = Math.max(1, Math.trunc(opts.page) || 1);

  const rows = await db
    .select(CARD_COLS)
    .from(articles)
    .where(publishedObituary)
    .orderBy(desc(articles.deathAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const totalRow = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(articles)
    .where(publishedObituary);

  return {
    rows: rows.map((r) => ({
      ...r,
      slug: r.slug!,
      headline: r.headline!,
      lede: r.lede!,
      tags: r.tags ?? [],
      deathAt: r.deathAt!, // obituaries always carry a non-null death_at (only birth notices go NULL)
    })),
    total: totalRow[0]?.c ?? 0,
    page,
    pageSize,
  };
}

/** A single published obituary by its slug, or null (unknown/failed). */
export async function getObituaryBySlug(db: Database, slug: string): Promise<ObituaryArticle | null> {
  const rows = await db
    .select({
      ...CARD_COLS,
      body: articles.body,
      pullQuoteText: articles.pullQuoteText,
      pullQuoteAttribution: articles.pullQuoteAttribution,
      facts: articles.facts,
    })
    .from(articles)
    .where(and(publishedObituary, eq(articles.slug, slug)))
    .limit(1);

  const r = rows[0];
  if (!r) return null;
  const facts = (r.facts ?? {}) as FactsSnapshot;
  return {
    slug: r.slug!,
    gamertag: r.gamertag,
    map: r.map,
    mapSlug: r.mapSlug,
    lifeNumber: r.lifeNumber,
    headline: r.headline!,
    lede: r.lede!,
    tags: r.tags ?? [],
    timeAliveSeconds: r.timeAliveSeconds,
    kills: r.kills,
    longestKillMeters: r.longestKillMeters,
    cause: r.cause,
    deathAt: r.deathAt!, // obituaries always carry a non-null death_at (only birth notices go NULL)
    body: r.body ?? "",
    pullQuote: r.pullQuoteText ? { text: r.pullQuoteText, attribution: r.pullQuoteAttribution ?? "" } : null,
    sessions: facts.sessions ?? 0,
    killerGamertag: facts.killerGamertag ?? null,
    weapon: facts.weapon ?? null,
    verdict: facts.verdict?.cause
      ? { cause: facts.verdict.cause, confidence: facts.verdict.confidence ?? "high", conditions: facts.verdict.conditions ?? [] }
      : null,
  };
}
