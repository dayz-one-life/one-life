import type { Database } from "@onelife/db";
import { articles, lives, players, servers } from "@onelife/db";
import { and, eq, desc, isNotNull, notExists, sql } from "drizzle-orm";
import { qualifiedLifeCondition } from "@onelife/read-models";

export interface ObituaryTarget {
  lifeId: number;         // CURRENT id — transient (loads getLifeTimeline in the tick); never stored
  serverId: number;
  gamertag: string;
  map: string;
  mapSlug: string | null;
  lifeNumber: number;
  lifeStartedAt: Date;    // natural-key: which life (rebuild-stable)
  endedAt: Date;
}

/** Structural inputs publishObituary needs — the tick passes the full ObituaryFacts object, which
 *  has these fields plus more; the extra fields ride into the `facts` jsonb at runtime. No index
 *  signature (that would make a named interface like ObituaryFacts fail to assign). */
export interface PublishFacts {
  sessions: number;
  killerGamertag: string | null;
  weapon: string | null;
  timeAliveSeconds: number;
  kills: number;
  longestKillMeters: number | null;
  cause: string | null;
}
export interface PublishObituary {
  headline: string;
  lede: string;
  body: string;
  pullQuote: { text: string; attribution: string } | null;
  tags: string[];
}
export interface PublishInput {
  target: ObituaryTarget;
  facts: PublishFacts;
  obituary: PublishObituary;
  promptVersion: string;
  model: string;
  now: Date;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Deterministic, rebuild-stable, unique per life: headline + gamertag + serverId + lifeNumber
 *  (all natural, rebuild-stable values — no projection row id). */
export function obituarySlug(headline: string, gamertag: string, serverId: number, lifeNumber: number): string {
  const h = slugify(headline).slice(0, 60).replace(/-+$/g, "") || "obituary";
  const g = slugify(gamertag) || "survivor";
  return `${h}-${g}-${serverId}-${lifeNumber}`;
}

// The article's identity is the natural life tuple — the conflict target for both upserts.
const CONFLICT = [articles.kind, articles.serverId, articles.gamertag, articles.lifeStartedAt];

/** Qualified dead lives that need an obituary: no published article and no exhausted failed stub.
 *  Anti-joins `articles` on the natural key (server + gamertag + life_started_at). */
export async function findObituaryTargets(
  db: Database,
  opts: { limit: number; maxAttempts: number },
): Promise<ObituaryTarget[]> {
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
        isNotNull(lives.endedAt),
        qualifiedLifeCondition(db),
        // no blocking article for this life (natural key): published, or failed-but-exhausted
        notExists(
          db
            .select({ x: sql`1` })
            .from(articles)
            .where(
              and(
                eq(articles.kind, "obituary"),
                eq(articles.serverId, lives.serverId),
                eq(articles.gamertag, players.gamertag),
                eq(articles.lifeStartedAt, lives.startedAt),
                sql`(${articles.status} = 'published' OR ${articles.attempts} >= ${opts.maxAttempts})`,
              ),
            ),
        ),
      ),
    )
    .orderBy(desc(lives.endedAt))
    .limit(opts.limit);

  return rows.map((r) => ({ ...r, endedAt: r.endedAt! }));
}

const IDENTITY = (t: ObituaryTarget) => ({
  kind: "obituary" as const,
  serverId: t.serverId,
  gamertag: t.gamertag,
  lifeStartedAt: t.lifeStartedAt,
  map: t.map,
  mapSlug: t.mapSlug,
  lifeNumber: t.lifeNumber,
  deathAt: t.endedAt,
});

/** Upsert a published obituary on the natural key. Bumps attempts, sets status='published'. */
export async function publishObituary(db: Database, input: PublishInput): Promise<void> {
  const { target: t, facts, obituary: o } = input;
  const values = {
    ...IDENTITY(t),
    status: "published" as const,
    slug: obituarySlug(o.headline, t.gamertag, t.serverId, t.lifeNumber),
    timeAliveSeconds: facts.timeAliveSeconds,
    kills: facts.kills,
    longestKillMeters: facts.longestKillMeters,
    cause: facts.cause,
    headline: o.headline,
    lede: o.lede,
    body: o.body,
    pullQuoteText: o.pullQuote?.text ?? null,
    pullQuoteAttribution: o.pullQuote?.attribution ?? null,
    tags: o.tags,
    facts: facts as unknown,
    promptVersion: input.promptVersion,
    model: input.model,
    generatedAt: input.now,
  };
  await db
    .insert(articles)
    .values({ ...values, attempts: 1 })
    .onConflictDoUpdate({
      target: CONFLICT,
      set: { ...values, attempts: sql`${articles.attempts} + 1`, lastError: null },
    });
}

/** Upsert a failed stub on the natural key: attempts += 1, status='failed'. */
export async function recordObituaryFailure(
  db: Database,
  input: { target: ObituaryTarget; error: string },
): Promise<void> {
  const id = IDENTITY(input.target);
  await db
    .insert(articles)
    .values({ ...id, status: "failed", attempts: 1, lastError: input.error })
    .onConflictDoUpdate({
      target: CONFLICT,
      set: { status: "failed", attempts: sql`${articles.attempts} + 1`, lastError: input.error },
    });
}
