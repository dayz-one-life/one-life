import type { Database } from "@onelife/db";
import { articles, players, sessions } from "@onelife/db";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { NewsFacts, NewsSubject } from "./news-facts.js";
import type { NewsArticle } from "./news-prompt.js";

// DUPLICATED VERBATIM in pg-store.ts and birth-pg-store.ts — deliberate, not an oversight. The
// slug *builders* around this helper differ genuinely per kind, slugs are frozen at publish time,
// and a shared helper would couple the three: changing one kind's slugging would silently rewrite
// another kind's URLs. Do not extract it.
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Cloned from birthNoticeSlug but PREFIXED WITH THE TRIGGER (spec §6): a news feature about the
 *  same life as an obituary must not collide on articles_slug_uniq. Deterministic and
 *  rebuild-stable — headline + gamertag + serverId + lifeNumber, no projection row id. Matches
 *  [a-z0-9-]+ so the existing /media/heroes/:file route serves its hero image unchanged. */
export function newsSlug(
  trigger: NewsFacts["trigger"],
  headline: string,
  primaryGamertag: string,
  serverId: number,
  lifeNumber: number,
): string {
  const prefix = trigger === "standing_dead" ? "standing-dead" : "long-form";
  const h = slugify(headline).slice(0, 60).replace(/-+$/g, "") || "news";
  const g = slugify(primaryGamertag) || "survivor";
  return `${prefix}-${h}-${g}-${serverId}-${lifeNumber}`;
}

// ── THE CONFLICT SPEC. Read the comment before changing either line. ──
// News does NOT key on the life tuple: a Long Form article has several lives and a Standing Dead
// article shares its life with a possible future obituary. It keys on natural_key, and migration
// 0014's articles_natural_key_uniq is PARTIAL (WHERE natural_key IS NOT NULL). An ON CONFLICT
// target only matches a partial index when the statement repeats that predicate — without the
// targetWhere below, Postgres raises 42P10 ("no unique or exclusion constraint matching the ON
// CONFLICT specification") and news publishing dies on the first tick.
// The sibling stores (pg-store.ts, birth-pg-store.ts) target the OTHER partial index with
// `inArray(articles.kind, ["obituary","birth_notice"])`; each store owns its own spec on purpose.
const CONFLICT = [articles.naturalKey];
const CONFLICT_WHERE = isNotNull(articles.naturalKey);

function primaryOf(f: NewsFacts): NewsSubject {
  const p = f.subjects.find((s) => s.gamertag === f.primaryGamertag);
  if (!p) throw new Error(`news facts: primary subject ${f.primaryGamertag} missing from subjects`);
  return p;
}

/** The NOT NULL columns `articles` inherited from the two life-keyed kinds, filled from the
 *  primary subject. Written identically by the publish path and the failure-stub path, so a stub
 *  and its eventual article are the same row. */
function IDENTITY(f: NewsFacts) {
  const p = primaryOf(f);
  return {
    kind: "news" as const,
    naturalKey: f.naturalKey,
    serverId: f.serverId,
    gamertag: f.primaryGamertag,
    map: f.map,
    mapSlug: f.mapSlug,
    lifeNumber: p.lifeNumber,
    lifeStartedAt: new Date(p.lifeStartedAt),
    // NULL for a Standing Dead subject, who has not died — legal since migration 0010.
    deathAt: p.endedAt ? new Date(p.endedAt) : null,
  };
}

export interface PublishNewsInput {
  facts: NewsFacts;
  article: NewsArticle;
  promptVersion: string;
  model: string;
  now: Date;
}

/** Upsert a published news feature on the natural key. */
export async function publishNews(db: Database, input: PublishNewsInput): Promise<void> {
  const { facts: f, article: a } = input;
  const p = primaryOf(f);
  const values = {
    ...IDENTITY(f),
    status: "published" as const,
    slug: newsSlug(f.trigger, a.headline, f.primaryGamertag, f.serverId, p.lifeNumber),
    headline: a.headline,
    lede: a.lede,
    // DERIVED from the para blocks, never model-authored (spec §8) — stored for the OG card, the
    // meta description and any future Discord unfurl, so those can never quote text that is not
    // on the page.
    body: a.body,
    bodyBlocks: a.blocks as unknown,
    pullQuoteText: a.pullQuote?.text ?? null,
    pullQuoteAttribution: a.pullQuote?.attribution ?? null,
    tags: a.tags,
    timeAliveSeconds: f.timeAliveSeconds,
    kills: p.kills,
    cause: p.deathCause,
    facts: f as unknown,
    promptVersion: input.promptVersion,
    model: input.model,
    generatedAt: input.now,
  };
  await db
    .insert(articles)
    .values({ ...values, attempts: 1 })
    .onConflictDoUpdate({
      target: CONFLICT,
      targetWhere: CONFLICT_WHERE,
      set: { ...values, attempts: sql`${articles.attempts} + 1`, lastError: null },
    });
}

/** Upsert a failed stub on the natural key: attempts += 1, status='failed'. The natural key is
 *  written HERE too — a stub with a NULL key escapes articles_natural_key_uniq, so `attempts`
 *  would never increment and every retry would insert another stub, forever. */
export async function recordNewsFailure(
  db: Database,
  args: { facts: NewsFacts; error: string },
): Promise<void> {
  const id = IDENTITY(args.facts);
  await db
    .insert(articles)
    .values({ ...id, status: "failed", attempts: 1, lastError: args.error })
    .onConflictDoUpdate({
      target: CONFLICT,
      targetWhere: CONFLICT_WHERE,
      set: { status: "failed", attempts: sql`${articles.attempts} + 1`, lastError: args.error },
    });
}

/** A published Standing Dead article whose subject has since been seen again. */
export interface ReturnedSubject {
  articleId: number;
  naturalKey: string;
  gamertag: string;
  slug: string | null;
}

/**
 * The de-publication sweep (spec §4.1.3). A Standing Dead article is the ONLY thing the paper
 * prints that its subject can falsify by acting, and it stays live and indexed until something
 * takes it down. Any PUBLISHED standing_dead article whose subject has a session on that server
 * that CONNECTED after the article was created is a candidate for retraction.
 *
 *  - `connected_at >`, not COALESCE(disconnected_at, connected_at): a session that began before
 *    publication and ended after it is the session the article was written about, not a return.
 *  - The trigger is read off the natural_key prefix, which is written by exactly one function
 *    (standingDeadNaturalKey) and is rebuild-stable. Long Form subjects are dead and cannot come
 *    back, so they are never swept. `starts_with` rather than LIKE: in a LIKE pattern the `_` in
 *    'standing_dead:' is a single-character wildcard, which is not the predicate this comment
 *    claims.
 *  - Already-'retracted' rows are excluded, so a returned subject is swept once, not every tick.
 *  - The row is NEVER deleted. Deleting would cascade the hero image away via
 *    article_images.article_id ON DELETE CASCADE, and would lose the prose. findImageTargets
 *    filters status='published', so a retracted article can never acquire a photo either.
 *    What stops the subject being re-covered is NOT this row existing — it is the anti-join in
 *    standing-dead-targets.ts / long-form-targets.ts, which blocks on
 *    `status IN ('published','retracted')`. If that predicate is ever narrowed back to
 *    'published', this sweep becomes an infinite regenerate-then-retract loop that spends a paid
 *    model call every tick (spec §4.1.3: the prose is never regenerated).
 */
export async function findReturnedStandingDead(
  db: Database,
  opts: { limit: number },
): Promise<ReturnedSubject[]> {
  const rows = await db
    .select({
      articleId: articles.id,
      naturalKey: articles.naturalKey,
      gamertag: articles.gamertag,
      slug: articles.slug,
    })
    .from(articles)
    .where(
      and(
        eq(articles.kind, "news"),
        eq(articles.status, "published"),
        sql`starts_with(${articles.naturalKey}, 'standing_dead:')`,
        sql`EXISTS (
          SELECT 1
          FROM ${sessions} s
          INNER JOIN ${players} p ON p.id = s.player_id
          WHERE s.server_id = ${articles.serverId}
            AND p.gamertag = ${articles.gamertag}
            AND s.connected_at > ${articles.createdAt}
        )`,
      ),
    )
    .limit(opts.limit);

  return rows.map((r) => ({
    articleId: r.articleId,
    naturalKey: r.naturalKey ?? "",
    gamertag: r.gamertag,
    slug: r.slug,
  }));
}

/** Move the given articles to `status='retracted'`. Separate from the finder so the sweep can sit
 *  behind NEWSDESK_DRY_RUN like every other write in this worker. */
export async function retractNewsArticles(db: Database, articleIds: number[]): Promise<void> {
  if (articleIds.length === 0) return;
  await db.update(articles).set({ status: "retracted" }).where(inArray(articles.id, articleIds));
}
