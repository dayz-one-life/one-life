import type { Database } from "@onelife/db";
import { articles } from "@onelife/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { ArticleBlock } from "./obituary-articles.js";

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

/** One person in a news feature, as the web surface needs them: enough to build a life-timeline
 *  URL and nothing more. No row ids (they do not survive a projector rebuild) and no coordinates. */
export interface NewsSubjectRef {
  gamertag: string;
  mapSlug: string | null;
  lifeNumber: number;
}

/**
 * The §4.1.3 status line, computed at REQUEST time and never regenerated prose. Populated by
 * getNewsSubjectStatus for a Standing Dead article only; a Long Form subject is dead and the
 * question does not arise.
 */
export type NewsSubjectStatus =
  | { kind: "idle"; idleDaysAtPublication: number }
  | { kind: "returned"; seenAt: Date }
  | { kind: "died"; diedAt: Date; obituarySlug: string | null };

export interface NewsArticleDetail extends NewsCard {
  body: string;
  /** R5d rich body. News is the FIRST kind whose writer populates articles.body_blocks — every
   *  live interior before this took ArticleBody's flat fallback. Selected AND cast here; a
   *  missing select would yield `undefined` and silently take the fallback forever. */
  bodyBlocks: ArticleBlock[] | null;
  pullQuote: { text: string; attribution: string } | null;
  imageUrl: string | null;
  imageCaption: string | null;
  /** True when the subject came back and the newsdesk de-published the piece. The row still
   *  RESOLVES — retraction removes it from discovery (feed, related rail, search index), not from
   *  its URL — so the interior can render a truthful correction instead of a 404. */
  retracted: boolean;
  timeAliveSeconds: number;      // playtime_seconds of the primary. NEVER wall clock.
  kills: number;
  idleSeconds: number | null;    // Standing Dead only. The length of an ABSENCE, not of a life.
  spanSeconds: number | null;    // Long Form only. TIME between first and last death — never a distance.
  subjects: NewsSubjectRef[];
  subjectStatus: NewsSubjectStatus | null;
}

// A news interior resolves for BOTH statuses. `failed` is excluded (its slug is NULL anyway) and
// so is every other kind — an obituary slug must not resolve through the news route.
const readableNews = inArray(articles.status, ["published", "retracted"]);

/** A single news feature by slug, or null (unknown slug, failed stub, or another kind). */
export async function getNewsArticleBySlug(
  db: Database,
  slug: string,
): Promise<NewsArticleDetail | null> {
  const rows = await db
    .select({
      ...CARD_COLS,
      status: articles.status,
      body: articles.body,
      bodyBlocks: articles.bodyBlocks,
      pullQuoteText: articles.pullQuoteText,
      pullQuoteAttribution: articles.pullQuoteAttribution,
      imageUrl: articles.imageUrl,
      imageCaption: articles.imageCaption,
      timeAliveSeconds: articles.timeAliveSeconds,
      kills: articles.kills,
    })
    .from(articles)
    .where(and(eq(articles.kind, "news"), readableNews, eq(articles.slug, slug)))
    .limit(1);

  const r = rows[0];
  if (!r) return null;

  const card = cardOf(r);
  const facts = (r.facts ?? {}) as NewsFactsSnapshot;

  // A Standing Dead article has exactly one subject and its facts always carry it; the fallback
  // reconstructs a self-subject from the row's own identity columns so an older or malformed
  // facts blob degrades to a working timeline link rather than an empty interior.
  const subjects: NewsSubjectRef[] = (facts.subjects ?? [])
    .filter((s): s is { gamertag: string; mapSlug?: string | null; lifeNumber?: number } =>
      typeof s?.gamertag === "string")
    .map((s) => ({
      gamertag: s.gamertag,
      mapSlug: s.mapSlug ?? null,
      lifeNumber: s.lifeNumber ?? card.lifeNumber,
    }));

  return {
    ...card,
    body: r.body ?? "",
    bodyBlocks: (r.bodyBlocks as ArticleBlock[] | null) ?? null,
    pullQuote: r.pullQuoteText
      ? { text: r.pullQuoteText, attribution: r.pullQuoteAttribution ?? "" }
      : null,
    imageUrl: r.imageUrl,
    imageCaption: r.imageCaption,
    retracted: r.status === "retracted",
    timeAliveSeconds: r.timeAliveSeconds,
    kills: r.kills,
    idleSeconds: facts.idleSeconds ?? null,
    spanSeconds: facts.spanSeconds ?? null,
    subjects: subjects.length > 0
      ? subjects
      : [{ gamertag: card.gamertag, mapSlug: card.mapSlug, lifeNumber: card.lifeNumber }],
    // Populated in the next task; a Long Form article keeps it null permanently.
    subjectStatus: null,
  };
}
