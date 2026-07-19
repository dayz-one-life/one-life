import type { Database } from "@onelife/db";
import { articles } from "@onelife/db";
import { and, desc, eq, sql } from "drizzle-orm";

export const NEWS_FEED_PAGE_SIZE = 20;

export type NewsTrigger = "standing_dead" | "long_form";

/**
 * The trigger comes from the natural_key PREFIX, which is produced by exactly one function per
 * trigger (standingDeadNaturalKey / longFormNaturalKey) and is rebuild-stable. `facts.trigger`
 * carries the same information, but having two sources means they can disagree after a schema
 * change; the newsdesk's own retraction sweep already reads the prefix
 * (`starts_with(natural_key, 'standing_dead:')`), so the page and the sweep now agree by
 * construction. A published news row always has a natural_key — both the publish path and the
 * failure-stub path write it — so the fallback below is unreachable in practice, and long_form is
 * the safe default because it turns off the Standing-Dead-only status line rather than turning it
 * on for a subject who has no idle figure.
 */
export function newsTriggerOf(naturalKey: string | null): NewsTrigger {
  return naturalKey?.startsWith("standing_dead:") ? "standing_dead" : "long_form";
}

export interface NewsCard {
  slug: string;
  trigger: NewsTrigger;
  gamertag: string;          // the PRIMARY subject; co-subjects live in the detail's `subjects`
  map: string;
  mapSlug: string | null;
  lifeNumber: number;
  headline: string;
  lede: string;
  tags: string[];
  subjectCount: number;
  createdAt: Date;
}

export interface NewsFeed {
  rows: NewsCard[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * The subset of `articles.facts` this module reads. NewsFacts is much wider, but a read-model must
 * project what it needs and nothing else — and nothing here is coordinate-shaped, because
 * NewsFacts carries no coordinate at any depth (spec §11, asserted in news-facts.test.ts).
 */
type NewsFactsSnapshot = {
  subjectCount?: number;
  idleSeconds?: number | null;
  spanSeconds?: number | null;
  subjects?: { gamertag?: string; mapSlug?: string | null; lifeNumber?: number }[];
};

// NAMED COLUMNS ONLY. Never `SELECT *` and never `events.payload` — that column holds 5,633
// coordinate rows and a Standing Dead subject is alive and can be hunted.
const CARD_COLS = {
  slug: articles.slug,
  naturalKey: articles.naturalKey,
  gamertag: articles.gamertag,
  map: articles.map,
  mapSlug: articles.mapSlug,
  lifeNumber: articles.lifeNumber,
  headline: articles.headline,
  lede: articles.lede,
  tags: articles.tags,
  facts: articles.facts,
  createdAt: articles.createdAt,
} as const;

const publishedNews = and(eq(articles.kind, "news"), eq(articles.status, "published"));

function cardOf(r: {
  slug: string | null; naturalKey: string | null; gamertag: string; map: string;
  mapSlug: string | null; lifeNumber: number; headline: string | null; lede: string | null;
  tags: string[] | null; facts: unknown; createdAt: Date;
}): NewsCard {
  const facts = (r.facts ?? {}) as NewsFactsSnapshot;
  return {
    slug: r.slug!,
    trigger: newsTriggerOf(r.naturalKey),
    gamertag: r.gamertag,
    map: r.map,
    mapSlug: r.mapSlug,
    lifeNumber: r.lifeNumber,
    headline: r.headline!,
    lede: r.lede!,
    tags: r.tags ?? [],
    subjectCount: facts.subjectCount ?? 1,
    createdAt: r.createdAt,
  };
}

/**
 * Published news features, newest FIRST BY created_at — not by death_at. A Standing Dead article
 * has no death and its death_at is NULL, so a death-ordered feed would sort every Standing Dead
 * piece to one end regardless of when it was filed. Served by articles_kind_status_created_idx
 * (migration 0014).
 *
 * `retracted` rows are excluded here and nowhere else needs to repeat that: the feed is also the
 * source for "More From the Desk". Failed stubs are excluded by the same predicate.
 */
export async function getPublishedNews(
  db: Database,
  opts: { page: number; pageSize?: number },
): Promise<NewsFeed> {
  const pageSize = opts.pageSize ?? NEWS_FEED_PAGE_SIZE;
  const page = Math.max(1, Math.trunc(opts.page) || 1);

  const rows = await db
    .select(CARD_COLS)
    .from(articles)
    .where(publishedNews)
    .orderBy(desc(articles.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const totalRow = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(articles)
    .where(publishedNews);

  return {
    rows: rows.map(cardOf),
    total: totalRow[0]?.c ?? 0,
    page,
    pageSize,
  };
}
