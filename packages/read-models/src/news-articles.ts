import type { Database } from "@onelife/db";
import { articles, articleImages, lives, players, sessions } from "@onelife/db";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
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

/** Article families the news surface can render. The two triggers are written by `newsTick`
 *  (shipped, disabled); `editorial` is written by hand through the `newsroom` CLI. */
export type NewsFormat = "standing_dead" | "long_form" | "editorial";

/** Natural-key prefixes owned by the editorial desk. Disjoint from `standing_dead:`/`long_form:`
 *  by construction, so a hand-written article can never collide with a generated one. The CLI
 *  validates every payload's key against this list (apps/newsdesk/src/newsroom/contract.ts). */
export const EDITORIAL_PREFIXES = ["almanac:", "ledger:", "editorial:"] as const;

/**
 * Which family a row belongs to, from its natural_key PREFIX — the same rebuild-stable signal
 * `newsTriggerOf` uses, and the same one the newsdesk's retraction sweep reads
 * (`starts_with(natural_key, 'standing_dead:')`), so page and sweep agree by construction.
 *
 * The unrecognised-key fallback is deliberately still `long_form`, matching `newsTriggerOf`
 * exactly: a null or malformed key must not newly classify as `editorial` and lose its dossier.
 * Editorial is a POSITIVE match on an owned prefix, never a default.
 */
export function newsFormatOf(naturalKey: string | null): NewsFormat {
  if (naturalKey?.startsWith("standing_dead:")) return "standing_dead";
  if (EDITORIAL_PREFIXES.some((p) => naturalKey?.startsWith(p))) return "editorial";
  return "long_form";
}

export interface NewsCard {
  slug: string;
  trigger: NewsTrigger;
  format: NewsFormat;
  /** `facts.format` for an editorial piece ("almanac" | "ledger" | …) — drives the interior
   *  kicker. NULL for the two generated triggers, which use `triggerLabel` instead. */
  editorialFormat: string | null;
  /** NULL for an institutional editorial piece. A census of three servers has no one subject,
   *  and inventing one would render, link and index a player who is not in the story. */
  gamertag: string | null;
  map: string | null;
  mapSlug: string | null;
  lifeNumber: number | null;
  headline: string;
  lede: string;
  tags: string[];
  subjectCount: number;
  createdAt: Date;
  /** Cache-versioned (`?v=<article_images.created_at epoch>`) when a stored hero exists; the bare
   *  URL when the row is half-written; null with no image. Cards carry it for the home lead —
   *  the /news feed page stays text-only by choice. */
  imageUrl: string | null;
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
  format?: string;
  subjects?: { gamertag?: string; mapSlug?: string | null; lifeNumber?: number }[];
};

// NAMED COLUMNS ONLY. Never `SELECT *` and never `events.payload` — that column holds 5,633
// coordinate rows and a Standing Dead subject is alive and can be hunted.
const CARD_COLS = {
  slug: articles.slug,
  naturalKey: articles.naturalKey,
  imageUrl: articles.imageUrl,
  // The stored image's created_at versions imageUrl (v0.27.2's cache-bust rule). Never the bytes
  // column — the named-columns rule below holds for the join too.
  imageCreatedAt: articleImages.createdAt,
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
  slug: string | null; naturalKey: string | null; gamertag: string | null; map: string | null;
  mapSlug: string | null; lifeNumber: number | null; headline: string | null; lede: string | null;
  tags: string[] | null; facts: unknown; createdAt: Date;
  imageUrl: string | null; imageCreatedAt: Date | null;
}): NewsCard {
  const facts = (r.facts ?? {}) as NewsFactsSnapshot;
  const format = newsFormatOf(r.naturalKey);
  return {
    slug: r.slug!,
    trigger: newsTriggerOf(r.naturalKey),
    format,
    editorialFormat: format === "editorial" ? facts.format ?? null : null,
    gamertag: r.gamertag,
    map: r.map,
    mapSlug: r.mapSlug,
    lifeNumber: r.lifeNumber,
    headline: r.headline!,
    lede: r.lede!,
    tags: r.tags ?? [],
    // An editorial piece has no subjects unless it names some; default 0, not 1.
    subjectCount: facts.subjectCount ?? (format === "editorial" ? 0 : 1),
    createdAt: r.createdAt,
    imageUrl: r.imageUrl && r.imageCreatedAt
      ? `${r.imageUrl}?v=${r.imageCreatedAt.getTime()}`
      : r.imageUrl,
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
    .leftJoin(articleImages, eq(articleImages.articleId, articles.id))
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
  /** Drafts are served ONLY through the preview gate; the feed never contains one. */
  status: "published" | "draft" | "retracted";
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

const READABLE_PUBLIC = ["published", "retracted"] as const;
const READABLE_PREVIEW = ["published", "retracted", "draft"] as const;

/** A single news feature by slug, or null. `includeDraft` is the preview gate's key — the API
 *  sets it only for a request carrying a valid NEWS_PREVIEW_TOKEN. */
export async function getNewsArticleBySlug(
  db: Database,
  slug: string,
  opts: { includeDraft?: boolean } = {},
): Promise<NewsArticleDetail | null> {
  const readable = inArray(articles.status, [...(opts.includeDraft ? READABLE_PREVIEW : READABLE_PUBLIC)]);
  const rows = await db
    .select({
      ...CARD_COLS,
      status: articles.status,
      serverId: articles.serverId,
      lifeStartedAt: articles.lifeStartedAt,
      body: articles.body,
      bodyBlocks: articles.bodyBlocks,
      pullQuoteText: articles.pullQuoteText,
      pullQuoteAttribution: articles.pullQuoteAttribution,
      imageCaption: articles.imageCaption,
      timeAliveSeconds: articles.timeAliveSeconds,
      kills: articles.kills,
    })
    .from(articles)
    .leftJoin(articleImages, eq(articleImages.articleId, articles.id))
    .where(and(eq(articles.kind, "news"), readable, eq(articles.slug, slug)))
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
      lifeNumber: s.lifeNumber ?? card.lifeNumber ?? 1,
    }));

  // The self-subject fallback reconstructs a subject from the row's own identity columns — but an
  // editorial piece HAS no identity columns, and a fabricated subject there would render a
  // timeline link for a player who is not in the story. Empty is the correct answer.
  const selfSubject: NewsSubjectRef[] = card.gamertag && card.lifeNumber != null
    ? [{ gamertag: card.gamertag, mapSlug: card.mapSlug, lifeNumber: card.lifeNumber }]
    : [];

  return {
    ...card,
    status: r.status as NewsArticleDetail["status"],
    body: r.body ?? "",
    bodyBlocks: (r.bodyBlocks as ArticleBlock[] | null) ?? null,
    pullQuote: r.pullQuoteText
      ? { text: r.pullQuoteText, attribution: r.pullQuoteAttribution ?? "" }
      : null,
    // imageUrl rides in from cardOf, already cache-versioned (v0.27.2 rule, now in CARD_COLS).
    imageCaption: r.imageCaption,
    retracted: r.status === "retracted",
    timeAliveSeconds: r.timeAliveSeconds,
    kills: r.kills,
    idleSeconds: facts.idleSeconds ?? null,
    spanSeconds: facts.spanSeconds ?? null,
    subjects: subjects.length > 0 ? subjects : selfSubject,
    // The status line needs a real (server, gamertag, life) tuple; an editorial piece has none.
    subjectStatus: card.trigger === "standing_dead" && r.serverId != null && card.gamertag && r.lifeStartedAt
      ? await getNewsSubjectStatus(db, {
          serverId: r.serverId,
          gamertag: card.gamertag,
          lifeStartedAt: r.lifeStartedAt,
          createdAt: card.createdAt,
          idleSecondsAtPublication: facts.idleSeconds ?? null,
        })
      : null,
  };
}

/**
 * Spec §4.1.3. The prose of a Standing Dead feature is never regenerated; only this line is live.
 *
 * Branch order is DEATH FIRST, deliberately. A subject who died must have returned to do it, so
 * both predicates can hold at once — and "he came back" is a footnote next to "he is in the
 * morgue now". Reporting the return in that case would be technically true and editorially false.
 *
 * The return predicate MIRRORS findReturnedStandingDead in apps/newsdesk/src/news-pg-store.ts:
 * scoped by (server, gamertag) rather than by life id, and keyed on `connected_at >`, never on
 * COALESCE(disconnected_at, connected_at) — a session that BEGAN before publication and ended
 * after it is the session the article was written about, not a return. Keeping the two identical
 * means the page and the de-publication sweep can never tell the reader different stories.
 *
 * A missing life row (the projections were rebuilt, or the life was folded away) degrades to
 * `idle` rather than throwing: an unavailable projection must not 500 a published page.
 */
export async function getNewsSubjectStatus(
  db: Database,
  args: {
    serverId: number;
    gamertag: string;
    lifeStartedAt: Date;
    createdAt: Date;
    idleSecondsAtPublication: number | null;
  },
): Promise<NewsSubjectStatus> {
  const idle: NewsSubjectStatus = {
    kind: "idle",
    idleDaysAtPublication: Math.floor((args.idleSecondsAtPublication ?? 0) / 86_400),
  };

  const lifeRows = await db
    .select({ endedAt: lives.endedAt })
    .from(lives)
    .innerJoin(players, eq(players.id, lives.playerId))
    .where(and(
      eq(lives.serverId, args.serverId),
      eq(players.gamertag, args.gamertag),
      eq(lives.startedAt, args.lifeStartedAt),
    ))
    .limit(1);

  const life = lifeRows[0];
  if (!life) return idle;

  if (life.endedAt) {
    const obit = await db
      .select({ slug: articles.slug })
      .from(articles)
      .where(and(
        eq(articles.kind, "obituary"),
        eq(articles.status, "published"),
        eq(articles.serverId, args.serverId),
        eq(articles.gamertag, args.gamertag),
        eq(articles.lifeStartedAt, args.lifeStartedAt),
      ))
      .limit(1);
    return { kind: "died", diedAt: life.endedAt, obituarySlug: obit[0]?.slug ?? null };
  }

  const seen = await db
    .select({ connectedAt: sessions.connectedAt })
    .from(sessions)
    .innerJoin(players, eq(players.id, sessions.playerId))
    .where(and(
      eq(sessions.serverId, args.serverId),
      eq(players.gamertag, args.gamertag),
      gt(sessions.connectedAt, args.createdAt),
    ))
    .orderBy(desc(sessions.connectedAt))
    .limit(1);

  const back = seen[0];
  return back ? { kind: "returned", seenAt: back.connectedAt } : idle;
}
