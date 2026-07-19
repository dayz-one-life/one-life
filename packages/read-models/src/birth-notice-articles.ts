import type { Database } from "@onelife/db";
import { articles } from "@onelife/db";
import { and, eq, desc, sql } from "drizzle-orm";
import type { PlayerPriors } from "./player-priors.js";
import type { ArticleBlock } from "./obituary-articles.js";

export const BIRTH_NOTICES_FEED_PAGE_SIZE = 20;

export interface BirthNoticeCard {
  slug: string;
  gamertag: string;
  map: string;
  mapSlug: string | null;
  lifeNumber: number;
  headline: string;
  lede: string;
  tags: string[];
  bornAt: Date;
  minutesToQualify: number | null;
  priorLives: number;
}

export interface BirthNoticesFeed {
  rows: BirthNoticeCard[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BirthNoticeArticle extends BirthNoticeCard {
  body: string;
  bodyBlocks: ArticleBlock[] | null;
  pullQuote: { text: string; attribution: string } | null;
  priors: PlayerPriors;
  endedAt: Date | null;
}

type BirthFactsSnapshot = {
  minutesToQualify?: number | null;
  priors?: Partial<PlayerPriors> | null;
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
  bornAt: articles.lifeStartedAt,
  facts: articles.facts,
} as const;

const publishedBirthNotice = and(eq(articles.kind, "birth_notice"), eq(articles.status, "published"));

function priorsFrom(facts: BirthFactsSnapshot): PlayerPriors {
  const p = facts.priors ?? {};
  return {
    livesLived: p.livesLived ?? 0,
    longestLifeSeconds: p.longestLifeSeconds ?? 0,
    totalKills: p.totalKills ?? 0,
    usualDeathCause: p.usualDeathCause ?? null,
    lastDeathCause: p.lastDeathCause ?? null,
    bestLifeMap: p.bestLifeMap ?? null,
  };
}

/** Published birth notices, freshest spawn first (lifeStartedAt desc). Paginated. Failed stubs excluded. */
export async function getPublishedBirthNotices(
  db: Database,
  opts: { page: number; pageSize?: number },
): Promise<BirthNoticesFeed> {
  const pageSize = opts.pageSize ?? BIRTH_NOTICES_FEED_PAGE_SIZE;
  const page = Math.max(1, Math.trunc(opts.page) || 1);

  const rows = await db
    .select(CARD_COLS)
    .from(articles)
    .where(publishedBirthNotice)
    .orderBy(desc(articles.lifeStartedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const totalRow = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(articles)
    .where(publishedBirthNotice);

  return {
    rows: rows.map((r) => {
      const facts = (r.facts ?? {}) as BirthFactsSnapshot;
      return {
        slug: r.slug!,
        gamertag: r.gamertag,
        map: r.map,
        mapSlug: r.mapSlug,
        lifeNumber: r.lifeNumber,
        headline: r.headline!,
        lede: r.lede!,
        tags: r.tags ?? [],
        bornAt: r.bornAt,
        minutesToQualify: facts.minutesToQualify ?? null,
        priorLives: priorsFrom(facts).livesLived,
      };
    }),
    total: totalRow[0]?.c ?? 0,
    page,
    pageSize,
  };
}

/** A single published birth notice by slug, or null (unknown/failed). Hydrates pullQuote + priors from facts. */
export async function getBirthNoticeBySlug(db: Database, slug: string): Promise<BirthNoticeArticle | null> {
  const rows = await db
    .select({
      ...CARD_COLS,
      body: articles.body,
      bodyBlocks: articles.bodyBlocks,
      pullQuoteText: articles.pullQuoteText,
      pullQuoteAttribution: articles.pullQuoteAttribution,
      endedAt: articles.deathAt,
    })
    .from(articles)
    .where(and(publishedBirthNotice, eq(articles.slug, slug)))
    .limit(1);

  const r = rows[0];
  if (!r) return null;
  const facts = (r.facts ?? {}) as BirthFactsSnapshot;
  const priors = priorsFrom(facts);
  return {
    slug: r.slug!,
    gamertag: r.gamertag,
    map: r.map,
    mapSlug: r.mapSlug,
    lifeNumber: r.lifeNumber,
    headline: r.headline!,
    lede: r.lede!,
    tags: r.tags ?? [],
    bornAt: r.bornAt,
    minutesToQualify: facts.minutesToQualify ?? null,
    priorLives: priors.livesLived,
    body: r.body ?? "",
    bodyBlocks: (r.bodyBlocks as ArticleBlock[] | null) ?? null,
    pullQuote: r.pullQuoteText ? { text: r.pullQuoteText, attribution: r.pullQuoteAttribution ?? "" } : null,
    priors,
    endedAt: r.endedAt,
  };
}
