import type { Database } from "@onelife/db";
import { articles, lives, players } from "@onelife/db";
import { and, eq, desc, sql } from "drizzle-orm";
import type { PlayerPriors } from "./player-priors.js";
import { assertSubjectful, type ArticleBlock } from "./obituary-articles.js";

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
  /** FROZEN — `articles.death_at` as it stood when the notice was written (non-null only when the
   *  subject had already died by the time the sweep filed, e.g. a spawn that didn't survive the
   *  minute). Never recomputed; kept for API stability. Use `subjectStatus` for the live read. */
  endedAt: Date | null;
  /** The §6 live status, recomputed at REQUEST time — mirrors getNewsSubjectStatus. A subject who
   *  has died since publication reads `dead` here even though `endedAt` (frozen) still says alive. */
  subjectStatus: BirthNoticeSubjectStatus;
}

/**
 * A birth notice's subject is never presumed missing the way a Standing Dead subject is — there is
 * no "idle"/"returned" state to report, only whether the life it was filed about is still open.
 * Mirrors getNewsSubjectStatus's shape (a discriminated union keyed on `kind`) without its
 * idle/returned branches, which don't apply here.
 */
export type BirthNoticeSubjectStatus = { kind: "alive" } | { kind: "dead"; diedAt: Date };

/**
 * The §6 status line, computed at REQUEST time. The prose above it is never regenerated; only this
 * is live. Mirrors getNewsSubjectStatus (packages/read-models/src/news-articles.ts): joins `lives`
 * by the exact (server, gamertag, lifeStartedAt) natural key the article was filed against, rather
 * than trusting the frozen `death_at` column the row was written with.
 *
 * A missing life row (a rebuild in flight, or projections not yet caught up) degrades to
 * `args.frozenDeathAt` — the article's own snapshot at write time — rather than defaulting to
 * "alive": an unavailable projection must not resurrect someone the paper already reported dead.
 */
export async function getBirthNoticeSubjectStatus(
  db: Database,
  args: { serverId: number; gamertag: string; lifeStartedAt: Date; frozenDeathAt: Date | null },
): Promise<BirthNoticeSubjectStatus> {
  const fallback: BirthNoticeSubjectStatus = args.frozenDeathAt
    ? { kind: "dead", diedAt: args.frozenDeathAt }
    : { kind: "alive" };

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
  if (!life) return fallback;

  return life.endedAt ? { kind: "dead", diedAt: life.endedAt } : { kind: "alive" };
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
    rows: rows.map((raw) => {
      const r = assertSubjectful(raw, "birth_notice", ["map", "lifeNumber", "bornAt"]);
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
      serverId: articles.serverId,
      body: articles.body,
      bodyBlocks: articles.bodyBlocks,
      pullQuoteText: articles.pullQuoteText,
      pullQuoteAttribution: articles.pullQuoteAttribution,
      endedAt: articles.deathAt,
    })
    .from(articles)
    .where(and(publishedBirthNotice, eq(articles.slug, slug)))
    .limit(1);

  const raw = rows[0];
  if (!raw) return null;
  const r = assertSubjectful(raw, "birth_notice", ["map", "lifeNumber", "bornAt"]);
  const facts = (r.facts ?? {}) as BirthFactsSnapshot;
  const priors = priorsFrom(facts);
  // A real published birth notice always carries a serverId (it is keyed by (server, gamertag,
  // life) — see assertSubjectful above); the null branch only guards a theoretically nullable
  // schema column and degrades to the frozen snapshot rather than throwing.
  const subjectStatus: BirthNoticeSubjectStatus = r.serverId != null
    ? await getBirthNoticeSubjectStatus(db, {
        serverId: r.serverId, gamertag: r.gamertag, lifeStartedAt: r.bornAt, frozenDeathAt: r.endedAt,
      })
    : (r.endedAt ? { kind: "dead", diedAt: r.endedAt } : { kind: "alive" });
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
    subjectStatus,
  };
}
