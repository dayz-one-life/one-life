import type { Database } from "@onelife/db";
import { articles, lives, players, servers } from "@onelife/db";
import { and, eq, asc, gte, inArray, notExists, sql } from "drizzle-orm";
import { qualifiedLifeCondition } from "@onelife/read-models";

export interface BirthNoticeTarget {
  lifeId: number;         // CURRENT id — transient (loads getLifeTimeline in the tick); never stored
  serverId: number;
  gamertag: string;
  map: string;
  mapSlug: string | null;
  lifeNumber: number;
  lifeStartedAt: Date;    // natural-key: which life (rebuild-stable) + feed order
  endedAt: Date | null;   // set only if the life already died before the sweep
}

/** Structural inputs publishBirthNotice needs — the tick passes the full BirthFacts object, which
 *  has these fields plus more; the extra fields ride into the `facts` jsonb at runtime. No index
 *  signature (that would make a named interface like BirthFacts fail to assign). */
export interface PublishBirthFacts {
  minutesToQualify: number | null;
  persona: string | null;
  isKnownQuantity: boolean;
}
export interface PublishBirthNotice {
  headline: string;
  lede: string;
  body: string;
  pullQuote: { text: string; attribution: string } | null;
  tags: string[];
}
export interface PublishBirthInput {
  target: BirthNoticeTarget;
  facts: PublishBirthFacts;
  notice: PublishBirthNotice;
  promptVersion: string;
  model: string;
  now: Date;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Deterministic, rebuild-stable, unique per life: headline + gamertag + serverId + lifeNumber
 *  (mirror of obituarySlug — all natural, rebuild-stable values, no projection row id). */
export function birthNoticeSlug(headline: string, gamertag: string, serverId: number, lifeNumber: number): string {
  const h = slugify(headline).slice(0, 60).replace(/-+$/g, "") || "birth-notice";
  const g = slugify(gamertag) || "survivor";
  return `${h}-${g}-${serverId}-${lifeNumber}`;
}

// The article's identity is the natural life tuple — the conflict target for both upserts.
const CONFLICT = [articles.kind, articles.serverId, articles.gamertag, articles.lifeStartedAt];
// Migration 0014 made that unique index PARTIAL; an ON CONFLICT target only matches a partial
// index when the statement repeats its predicate. Mirrors pg-store.ts — deliberately duplicated,
// each store owns its own conflict spec (see also the mirrored CONFLICT above).
const CONFLICT_WHERE = inArray(articles.kind, ["obituary", "birth_notice"]);

/** Qualified lives (alive OR dead) needing a birth notice: born on/after `since`, no published
 *  article and no exhausted failed stub. Anti-joins `articles` on the natural key with
 *  kind='birth_notice'. Unlike the obituary query there is NO `isNotNull(lives.endedAt)` filter —
 *  a living spawn is a valid target. */
export async function findBirthNoticeTargets(
  db: Database,
  opts: { since: Date; limit: number; maxAttempts: number },
): Promise<BirthNoticeTarget[]> {
  const rows = await db
    .select({
      lifeId: lives.id,
      serverId: lives.serverId,
      gamertag: players.gamertag,
      map: servers.map,
      mapSlug: servers.slug,
      lifeNumber: lives.lifeNumber,
      lifeStartedAt: lives.startedAt,
      endedAt: lives.endedAt,
    })
    .from(lives)
    .innerJoin(players, eq(players.id, lives.playerId))
    .innerJoin(servers, eq(servers.id, lives.serverId))
    .where(
      and(
        gte(lives.startedAt, opts.since),
        qualifiedLifeCondition(db),
        // no blocking article for this life (natural key): published, or failed-but-exhausted
        notExists(
          db
            .select({ x: sql`1` })
            .from(articles)
            .where(
              and(
                eq(articles.kind, "birth_notice"),
                eq(articles.serverId, lives.serverId),
                eq(articles.gamertag, players.gamertag),
                eq(articles.lifeStartedAt, lives.startedAt),
                sql`(${articles.status} = 'published' OR ${articles.attempts} >= ${opts.maxAttempts})`,
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(lives.startedAt)) // forward from the cutoff, oldest arrivals first
    .limit(opts.limit);

  return rows;
}

const IDENTITY = (t: BirthNoticeTarget) => ({
  kind: "birth_notice" as const,
  serverId: t.serverId,
  gamertag: t.gamertag,
  lifeStartedAt: t.lifeStartedAt,
  map: t.map,
  mapSlug: t.mapSlug,
  lifeNumber: t.lifeNumber,
  deathAt: t.endedAt ?? null, // NULL while alive (requires migration 0010: death_at nullable)
});

/** Upsert a published birth notice on the natural key. Bumps attempts, sets status='published',
 *  stores the full BirthFacts object in `facts` jsonb. */
export async function publishBirthNotice(db: Database, input: PublishBirthInput): Promise<void> {
  const { target: t, notice: n } = input;
  const values = {
    ...IDENTITY(t),
    status: "published" as const,
    slug: birthNoticeSlug(n.headline, t.gamertag, t.serverId, t.lifeNumber),
    headline: n.headline,
    lede: n.lede,
    body: n.body,
    pullQuoteText: n.pullQuote?.text ?? null,
    pullQuoteAttribution: n.pullQuote?.attribution ?? null,
    tags: n.tags,
    facts: input.facts as unknown, // full BirthFacts (incl. priors) rides into jsonb
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

/** Upsert a failed stub on the natural key: attempts += 1, status='failed'. */
export async function recordBirthNoticeFailure(
  db: Database,
  args: { target: BirthNoticeTarget; error: string },
): Promise<void> {
  const id = IDENTITY(args.target);
  await db
    .insert(articles)
    .values({ ...id, status: "failed", attempts: 1, lastError: args.error })
    .onConflictDoUpdate({
      target: CONFLICT,
      set: { status: "failed", attempts: sql`${articles.attempts} + 1`, lastError: args.error },
    });
}
