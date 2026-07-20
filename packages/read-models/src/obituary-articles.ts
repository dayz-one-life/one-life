import type { Database } from "@onelife/db";
import { articles } from "@onelife/db";
import { and, eq, desc, sql } from "drizzle-orm";

export const OBITUARIES_FEED_PAGE_SIZE = 20;

/**
 * R5d rich-body block union. `articles.body_blocks` is jsonb and NULL on every pre-R5d row, so
 * every consumer must handle null by rendering the flat `body`. Declared here and imported by
 * birth-notice-articles.ts — `index.ts` is a barrel of `export *`, so declaring it twice collides.
 */
export type ArticleBlock =
  | { type: "para"; text: string }
  | { type: "subhead"; text: string }
  | { type: "quote"; text: string; attribution: string }
  | { type: "list"; items: string[] };

/**
 * Migration 0016 made the subject columns nullable for institutional editorial pieces. For an
 * obituary or a birth notice a null subject is DATA CORRUPTION, not a valid state — the article
 * is keyed by that tuple. Throwing is deliberate: rendering an empty gamertag onto a public page
 * is worse than a 500, because it looks like a real article about nobody.
 */
export function assertSubjectful<T extends { gamertag: string | null; slug: string | null }>(
  row: T, kind: string,
): T & { gamertag: string } {
  if (row.gamertag == null) {
    throw new Error(`${kind} article ${row.slug ?? "(no slug)"} has a null gamertag — corrupt row`);
  }
  return row as T & { gamertag: string };
}

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
  bodyBlocks: ArticleBlock[] | null;
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
    rows: rows.map((raw) => {
      const r = assertSubjectful(raw, "obituary");
      return {
        ...r,
        slug: r.slug!,
        map: r.map!,
        lifeNumber: r.lifeNumber!,
        headline: r.headline!,
        lede: r.lede!,
        tags: r.tags ?? [],
        deathAt: r.deathAt!, // obituaries always carry a non-null death_at (only birth notices go NULL)
      };
    }),
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
      bodyBlocks: articles.bodyBlocks,
      pullQuoteText: articles.pullQuoteText,
      pullQuoteAttribution: articles.pullQuoteAttribution,
      facts: articles.facts,
    })
    .from(articles)
    .where(and(publishedObituary, eq(articles.slug, slug)))
    .limit(1);

  const raw = rows[0];
  if (!raw) return null;
  const r = assertSubjectful(raw, "obituary");
  const facts = (r.facts ?? {}) as FactsSnapshot;
  return {
    slug: r.slug!,
    gamertag: r.gamertag,
    map: r.map!,
    mapSlug: r.mapSlug,
    lifeNumber: r.lifeNumber!,
    headline: r.headline!,
    lede: r.lede!,
    tags: r.tags ?? [],
    timeAliveSeconds: r.timeAliveSeconds,
    kills: r.kills,
    longestKillMeters: r.longestKillMeters,
    cause: r.cause,
    deathAt: r.deathAt!, // obituaries always carry a non-null death_at (only birth notices go NULL)
    body: r.body ?? "",
    bodyBlocks: (r.bodyBlocks as ArticleBlock[] | null) ?? null,
    pullQuote: r.pullQuoteText ? { text: r.pullQuoteText, attribution: r.pullQuoteAttribution ?? "" } : null,
    sessions: facts.sessions ?? 0,
    killerGamertag: facts.killerGamertag ?? null,
    weapon: facts.weapon ?? null,
    verdict: facts.verdict?.cause
      ? { cause: facts.verdict.cause, confidence: facts.verdict.confidence ?? "high", conditions: facts.verdict.conditions ?? [] }
      : null,
  };
}
