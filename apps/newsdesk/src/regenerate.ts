import { getDb, type Database } from "@onelife/db";
import { articleRevisions, articles, kills, lives, players } from "@onelife/db";
import { and, asc, eq, gte, lt, lte, sql } from "drizzle-orm";
import {
  articleKey, correctedAtOf, getArticleLives, getInferredFamilies, getPublicDeathsForArticles, getTrapCreditsForVictimLives,
  latestRevision, promptHedgesInferred, qualifiedLifeCondition, sweepCaughtUp, verdictSweepBacklog,
  type ArticleLife, type ArticleLifeKey, type RevisionReason, type VerdictSweepBacklog,
} from "@onelife/read-models";
import { PUBLIC_INFERRED, type InferredFamily, type PublicDeath } from "@onelife/death-verdict";
import { loadConfig } from "./config.js";
import { storedFacts } from "./facts.js";
import { CauseCheckError, generateObituary, type CompletionClient } from "./generate.js";
import { loadObituaryInputs } from "./inputs.js";
import { obituaryUrl } from "./obituary-url.js";
import { openrouterClient } from "./openrouter.js";
import type { ObituaryTarget } from "./pg-store.js";
import { composeTags, OBITUARY_PROMPT_VERSION } from "./prompt.js";
import { dedupePullQuote } from "./prose-backstop.js";
import { opener, recentProse, RECENT_PROSE_LIMIT, type RecentProse } from "./prose-pg-store.js";

/**
 * `pnpm --filter @onelife/newsdesk run regenerate -- <selector> [--limit N] [--write]`, and
 * `-- --restore <slug>` (death-verdict spec 6.2 item 2, 6.3, 6.4; plan step 9).
 *
 * Rewrites already-published obituaries in place, one at a time, through the same prompt and the
 * same two checks as a new one (`generateObituary`):
 *   --slug <s>                 that one published obituary, whatever the selectors say (the pilot);
 *                              with a selector, restricts it to that slug
 *   --stale-cause              filed with no cause, or as a bare explosion / vehicle / environment,
 *                              while the stored verdict now states a cause (definitive or strong)
 *   --stale-inferred           written before obituary-v4 (so the prose says no cause was recorded)
 *                              about a death now read as a "Likely" cause whose family is switched on
 *   --inferred-family <f>      v4 obituaries of a death inferred in family f, rewritten as "not
 *                              recorded" whatever PUBLIC_INFERRED says (the retraction of 6.3)
 *   --denied-credit            obituaries that named a trap-setter whose credit is gone, or counted
 *                              a trap kill that is gone; retracted instead when the life no longer
 *                              qualifies. Refuses while the verdict sweep has anything outstanding.
 *   --restore <slug>           writes the latest archived version back (no --write needed)
 *
 * ⚠️ DRY-RUN BY DEFAULT. Without --write it still CALLS THE MODEL (the operator reads the new
 * headline and lede before approving), and writes nothing. With --write each article's previous
 * row is archived in `article_revisions` and the new text swapped in, in one transaction.
 *
 * ⚠️ Never touched: `slug` (Discord, Facebook and the crier's ledger hold the URL), `status`
 * (except a retraction or a restore), `attempts`, `created_at`, and the `syndications` rows. The
 * update is by article id, never through `publishObituary`'s natural-key upsert: the article's
 * frozen gamertag may no longer be the player's name, and that upsert would insert a second row.
 */

export type Selector =
  | { kind: "slug" }
  | { kind: "stale-cause" }
  | { kind: "stale-inferred" }
  | { kind: "inferred-family"; family: InferredFamily }
  | { kind: "denied-credit" };

export type RegenerateArgs =
  | { restore: string }
  | { restore?: undefined; selector: Selector; slug: string | null; limit: number | null; write: boolean };

const FAMILIES = Object.keys(PUBLIC_INFERRED) as InferredFamily[];
const USAGE = "usage: regenerate (--slug <s> | --stale-cause | --stale-inferred | --inferred-family <family> | --denied-credit) "
  + "[--slug <s>] [--limit N] [--write]  |  regenerate --restore <slug>";

export function parseRegenerateArgs(argv: string[]): RegenerateArgs {
  let slug: string | null = null;
  let restore: string | null = null;
  let limit: number | null = null;
  let write = false;
  const selectors: Selector[] = [];
  const value = (i: number, flag: string): string => {
    const v = argv[i];
    if (v == null || v.startsWith("--")) throw new Error(`${flag} needs a value. ${USAGE}`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") continue;
    else if (a === "--write") write = true;
    else if (a === "--slug") slug = value(++i, a);
    else if (a === "--restore") restore = value(++i, a);
    else if (a === "--limit") {
      const n = Number(value(++i, a));
      if (!Number.isInteger(n) || n <= 0) throw new Error(`--limit needs a positive whole number, got ${argv[i]}`);
      limit = n;
    } else if (a === "--stale-cause") selectors.push({ kind: "stale-cause" });
    else if (a === "--stale-inferred") selectors.push({ kind: "stale-inferred" });
    else if (a === "--denied-credit") selectors.push({ kind: "denied-credit" });
    else if (a === "--inferred-family") {
      const f = value(++i, a);
      if (!FAMILIES.includes(f as InferredFamily)) throw new Error(`--inferred-family must be one of ${FAMILIES.join(", ")}, got ${f}`);
      selectors.push({ kind: "inferred-family", family: f as InferredFamily });
    } else throw new Error(`unknown argument ${a}. ${USAGE}`);
  }
  if (restore != null) {
    if (selectors.length || slug != null || limit != null || write) throw new Error(`--restore takes only a slug. ${USAGE}`);
    return { restore };
  }
  if (selectors.length > 1) throw new Error(`one selector at a time. ${USAGE}`);
  const selector = selectors[0] ?? (slug != null ? { kind: "slug" as const } : null);
  if (!selector) throw new Error(USAGE);
  return { selector, slug, limit, write };
}

// ---------------------------------------------------------------------------------------------
// The article as it stands, and the snapshot archived before it is replaced.
// ---------------------------------------------------------------------------------------------

const ROW_COLS = {
  id: articles.id, slug: articles.slug, status: articles.status, serverId: articles.serverId, gamertag: articles.gamertag,
  lifeStartedAt: articles.lifeStartedAt, lifeNumber: articles.lifeNumber, map: articles.map, mapSlug: articles.mapSlug,
  deathAt: articles.deathAt, createdAt: articles.createdAt,
  headline: articles.headline, lede: articles.lede, body: articles.body, bodyBlocks: articles.bodyBlocks,
  pullQuoteText: articles.pullQuoteText, pullQuoteAttribution: articles.pullQuoteAttribution, tags: articles.tags,
  facts: articles.facts, cause: articles.cause, promptVersion: articles.promptVersion, model: articles.model,
  generatedAt: articles.generatedAt, verdictVersion: articles.verdictVersion, kills: articles.kills,
  timeAliveSeconds: articles.timeAliveSeconds, longestKillMeters: articles.longestKillMeters,
} as const;

export interface ArticleRow {
  id: number; slug: string | null; status: string; serverId: number | null; gamertag: string | null;
  lifeStartedAt: Date | null; lifeNumber: number | null; map: string | null; mapSlug: string | null;
  deathAt: Date | null; createdAt: Date;
  headline: string | null; lede: string | null; body: string | null; bodyBlocks: unknown;
  pullQuoteText: string | null; pullQuoteAttribution: string | null; tags: string[] | null;
  facts: unknown; cause: string | null; promptVersion: string | null; model: string | null;
  generatedAt: Date | null; verdictVersion: number | null; kills: number; timeAliveSeconds: number;
  longestKillMeters: number | null;
}

/** Everything a rewrite, a retraction or a restore can change, as archived in a revision. */
export interface ArticleSnapshot {
  status: string;
  headline: string | null; lede: string | null; body: string | null; bodyBlocks: unknown;
  pullQuoteText: string | null; pullQuoteAttribution: string | null; tags: string[] | null;
  facts: unknown; cause: string | null; promptVersion: string | null; model: string | null;
  generatedAt: string | null; verdictVersion: number | null; kills: number; timeAliveSeconds: number;
  longestKillMeters: number | null;
  /** What the page's correction line said for this text when it was replaced (`correctedAtOf`). */
  correctedAt: string | null;
  /** On a `restored` revision only: the `correctedAt` of the text the restore wrote back. */
  restoredCorrectedAt?: string | null;
}

function snapshotOf(r: ArticleRow, correctedAt: Date | null): ArticleSnapshot {
  return {
    status: r.status, headline: r.headline, lede: r.lede, body: r.body, bodyBlocks: r.bodyBlocks ?? null,
    pullQuoteText: r.pullQuoteText, pullQuoteAttribution: r.pullQuoteAttribution, tags: r.tags, facts: r.facts,
    cause: r.cause, promptVersion: r.promptVersion, model: r.model, generatedAt: r.generatedAt?.toISOString() ?? null,
    verdictVersion: r.verdictVersion, kills: r.kills, timeAliveSeconds: r.timeAliveSeconds,
    longestKillMeters: r.longestKillMeters, correctedAt: correctedAt?.toISOString() ?? null,
  };
}

async function publishedObituaries(db: Database, slug: string | null): Promise<ArticleRow[]> {
  const rows = await db.select(ROW_COLS).from(articles)
    .where(and(eq(articles.kind, "obituary"), eq(articles.status, "published"), slug != null ? eq(articles.slug, slug) : undefined))
    .orderBy(asc(articles.deathAt), asc(articles.id));
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

const keyOf = (a: ArticleRow): ArticleLifeKey | null => a.serverId != null && a.gamertag != null && a.lifeStartedAt != null
  ? { serverId: a.serverId, gamertag: a.gamertag, lifeStartedAt: a.lifeStartedAt } : null;

function keys(rows: ArticleRow[]): ArticleLifeKey[] {
  return rows.map(keyOf).filter((k): k is ArticleLifeKey => k != null);
}

const factsOf = (a: ArticleRow): Record<string, unknown> =>
  a.facts != null && typeof a.facts === "object" ? (a.facts as Record<string, unknown>) : {};
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// ---------------------------------------------------------------------------------------------
// Selection.
// ---------------------------------------------------------------------------------------------

/** What will be done to one selected article, and why (printed in the dry-run). */
export interface Candidate {
  article: ArticleRow;
  action: "rewrite" | "retract";
  reason: RevisionReason;
  why: string;
  /** `--inferred-family`: write as if this family were switched off. */
  withdrawFamily?: InferredFamily;
}

type FrozenCoarse = "explosion" | "vehicle" | "environment";
const COARSE_WORDS: ReadonlySet<string> = new Set<FrozenCoarse>(["explosion", "vehicle", "environment"]);

/**
 * What an article froze about its cause. An article written from a stored verdict (v4) has
 * `facts.death`; one written before has the life row's coarse word in `facts.cause` and the v3
 * category ("pvp" | "suicide" | "environment" | "unknown") in `facts.causeCategory`.
 */
export function frozenCauseOf(a: Pick<ArticleRow, "facts" | "tags">): { unknown: boolean; coarse: FrozenCoarse | null } {
  const f = factsOf(a as ArticleRow);
  const death = f.death != null && typeof f.death === "object" ? (f.death as Record<string, unknown>) : null;
  if (death && typeof death.key === "string") {
    const unknown = death.tag === "Unknown" || death.certainty === "unknown" || death.certainty === "withheld";
    const bare = death.detail == null;
    const coarse = bare && (death.key === "explosion" || death.key === "vehicle") ? (death.key as FrozenCoarse) : null;
    return { unknown, coarse };
  }
  const unknown = f.causeCategory === "unknown" || (f.causeCategory == null && (a.tags ?? [])[2] === "Unknown");
  const coarse = typeof f.cause === "string" && COARSE_WORDS.has(f.cause) ? (f.cause as FrozenCoarse) : null;
  return { unknown, coarse };
}

/** Whether the live verdict says more than the coarse word the article was filed under. */
function saysMore(coarse: FrozenCoarse, d: PublicDeath): boolean {
  if (coarse === "environment") return true; // the word named no mechanism at all
  return !(d.key === coarse && d.detail == null);
}

const stated = (d: PublicDeath | undefined): d is PublicDeath =>
  d != null && d.status === "final" && (d.certainty === "definitive" || d.certainty === "strong");

/**
 * `--stale-cause` (spec 6.2 item 2): published obituaries whose live verdict is definitive or
 * strong, and that were filed with no cause, or under a bare explosion / vehicle / environment
 * while the verdict now names more (an R1-era "explosion" over a tripwire). Never an inferred one.
 */
export async function selectStale(db: Database, opts: { slug?: string | null; limit?: number | null } = {}): Promise<Candidate[]> {
  const rows = await publishedObituaries(db, opts.slug ?? null);
  const live = await getPublicDeathsForArticles(db, keys(rows));
  const out: Candidate[] = [];
  for (const a of rows) {
    const k = keyOf(a);
    const d = k ? live.get(articleKey(k)) : undefined;
    if (!stated(d)) continue;
    const frozen = frozenCauseOf(a);
    if (frozen.unknown) out.push({ article: a, action: "rewrite", reason: "cause-corrected", why: `filed with no cause; the record now says "${d.label}"` });
    else if (frozen.coarse && saysMore(frozen.coarse, d)) {
      out.push({ article: a, action: "rewrite", reason: "cause-corrected", why: `filed as "${frozen.coarse}"; the record now says "${d.label}"` });
    }
  }
  return cap(out, opts.limit);
}

/**
 * `--stale-inferred` (residual question R5): published obituaries written before obituary-v4,
 * whose prose therefore says no cause was recorded, about a death the verdict now reads as a
 * "Likely" cause with its family switched on. Until rewritten their tag reads "Unknown".
 */
export async function selectStaleInferred(db: Database, opts: { slug?: string | null; limit?: number | null } = {}): Promise<Candidate[]> {
  const rows = (await publishedObituaries(db, opts.slug ?? null)).filter((a) => !promptHedgesInferred(a.promptVersion));
  const live = await getPublicDeathsForArticles(db, keys(rows));
  const out: Candidate[] = [];
  for (const a of rows) {
    const k = keyOf(a);
    const d = k ? live.get(articleKey(k)) : undefined;
    if (d?.status === "final" && d.certainty === "inferred") {
      out.push({ article: a, action: "rewrite", reason: "cause-corrected", why: `filed before obituary-v4; the record's reading is now "${d.label}"` });
    }
  }
  return cap(out, opts.limit);
}

/**
 * `--inferred-family <family>` (spec 6.3): published v4 obituaries (the prose narrates the
 * inferred cause, hedged) whose stored verdict is inferred in that family, WHATEVER the switch
 * says. Each is rewritten as "not recorded", under the no-mechanism directive.
 */
export async function selectInferredFamily(
  db: Database, family: InferredFamily, opts: { slug?: string | null; limit?: number | null } = {},
): Promise<Candidate[]> {
  const rows = (await publishedObituaries(db, opts.slug ?? null)).filter((a) => promptHedgesInferred(a.promptVersion));
  const found = await getArticleLives(db, keys(rows));
  const families = await getInferredFamilies(db, [...new Set([...found.values()].map((l) => l.id))]);
  const out: Candidate[] = [];
  for (const a of rows) {
    const k = keyOf(a);
    const life = k ? found.get(articleKey(k)) : undefined;
    if (life && families.get(life.id) === family) {
      out.push({ article: a, action: "rewrite", reason: "cause-corrected", why: `a "${family}" reading, withdrawn`, withdrawFamily: family });
    }
  }
  return cap(out, opts.limit);
}

/** Trap kills credited to `life`'s player: in the life (on its server), and before it (anywhere). */
async function liveTrapKills(db: Database, life: ArticleLife): Promise<{ life: number; prior: number }> {
  const trap = and(eq(kills.basis, "trap_placement"), eq(kills.killerPlayerId, life.playerId));
  const [inLife] = await db.select({ n: sql<number>`count(*)::int` }).from(kills).where(and(
    trap, eq(kills.serverId, life.serverId), gte(kills.occurredAt, life.startedAt),
    life.endedAt ? lte(kills.occurredAt, life.endedAt) : undefined,
  ));
  const [prior] = await db.select({ n: sql<number>`count(*)::int` }).from(kills).where(and(trap, lt(kills.occurredAt, life.startedAt)));
  return { life: inLife?.n ?? 0, prior: prior?.n ?? 0 };
}

/** Whether the life still qualifies (the predicate `findObituaryTargets` uses). */
async function stillQualifies(db: Database, lifeId: number): Promise<boolean> {
  const rows = await db.select({ id: lives.id }).from(lives).innerJoin(players, eq(players.id, lives.playerId))
    .where(and(eq(lives.id, lifeId), qualifiedLifeCondition(db)));
  return rows.length > 0;
}

/**
 * `--denied-credit` (spec 6.4): published obituaries of three kinds —
 *  - a victim's, written with a trap credit (`facts.creditSent`), whose life has no
 *    `trap_placement` row now;
 *  - a placer's, whose `facts.trapKills` is above the live count of that life's trap kills;
 *  - a later life's, whose `facts.priors.trapKills` is above the live count before that life.
 * Each is rewritten, or retracted when its life no longer qualifies (a placer life that qualified
 * through the denied kill alone). The victim kind is a cause correction (the page says so); the
 * two count kinds are not.
 */
export async function selectDeniedCredit(db: Database, opts: { slug?: string | null; limit?: number | null } = {}): Promise<Candidate[]> {
  const rows = (await publishedObituaries(db, opts.slug ?? null)).filter((a) => {
    const f = factsOf(a);
    const priors = f.priors != null && typeof f.priors === "object" ? (f.priors as Record<string, unknown>) : {};
    return f.creditSent === true || num(f.trapKills) > 0 || num(priors.trapKills) > 0;
  });
  const found = await getArticleLives(db, keys(rows));
  const credits = await getTrapCreditsForVictimLives(db, [...new Set([...found.values()].map((l) => l.id))]);
  const out: Candidate[] = [];
  for (const a of rows) {
    const k = keyOf(a);
    const life = k ? found.get(articleKey(k)) : undefined;
    if (!life) continue; // reported by nothing: an unresolvable life cannot be checked
    const f = factsOf(a);
    const priors = f.priors != null && typeof f.priors === "object" ? (f.priors as Record<string, unknown>) : {};
    const counts = await liveTrapKills(db, life);
    const why: string[] = [];
    const victim = f.creditSent === true && !credits.has(life.id);
    if (victim) why.push("named a trap-setter whose credit is gone");
    if (num(f.trapKills) > counts.life) why.push(`counted ${num(f.trapKills)} trap kill(s) this life, ${counts.life} stand`);
    if (num(priors.trapKills) > counts.prior) why.push(`counted ${num(priors.trapKills)} earlier trap kill(s), ${counts.prior} stand`);
    if (why.length === 0) continue;
    const qualifies = await stillQualifies(db, life.id);
    out.push(qualifies
      ? { article: a, action: "rewrite", reason: victim ? "cause-corrected" : "kills-corrected", why: why.join("; ") }
      : { article: a, action: "retract", reason: "retracted", why: `${why.join("; ")}; the life no longer qualifies` });
  }
  return cap(out, opts.limit);
}

/** `--slug` alone: that published obituary, rewritten from the live verdict. */
async function selectSlug(db: Database, slug: string): Promise<Candidate[]> {
  return (await publishedObituaries(db, slug)).map((a) => ({ article: a, action: "rewrite", reason: "cause-corrected", why: "named with --slug" }));
}

const cap = <T>(xs: T[], limit: number | null | undefined): T[] => (limit != null ? xs.slice(0, limit) : xs);

// ---------------------------------------------------------------------------------------------
// One article.
// ---------------------------------------------------------------------------------------------

export interface RegenerateDeps {
  /** Needed for a rewrite (dry-run included: the operator reads the new text first). */
  client: CompletionClient | null;
  model: string;
  now: () => Date;
  siteUrl: string;
  out: (line: string) => void;
  /** Test seam; defaults to `verdictSweepBacklog`. */
  sweepBacklog?: (db: Database) => Promise<VerdictSweepBacklog>;
}

export type Outcome =
  | { status: "rewritten" | "would-rewrite"; headline: string; lede: string }
  | { status: "retracted" | "would-retract" }
  | { status: "skipped"; why: string }
  | { status: "failed"; why: string };

/**
 * Rewrite (or retract) one selected article. Facts are built from the LIVE life, found through
 * the player's alias history, with `gamertag` set to the article's frozen name (the name it was
 * published under). The do-not-reuse list is `recent` plus `batchProse`, the headlines and ledes
 * written earlier in this batch: a regenerated article keeps `created_at`, so `recentProse` alone
 * would not see them. On `write` the previous row is archived and the new one swapped in, in one
 * transaction; a failed generation or check changes nothing.
 */
export async function regenerateOne(
  db: Database, deps: RegenerateDeps, c: Candidate,
  opts: { write: boolean; recent: RecentProse[]; batchProse: RecentProse[] },
): Promise<Outcome> {
  const a = c.article;
  if (c.action === "retract") {
    if (!opts.write) return { status: "would-retract" };
    await db.transaction(async (tx) => {
      const db2 = tx as unknown as Database;
      await archive(db2, a, "retracted", deps.now());
      await tx.update(articles).set({ status: "retracted" }).where(and(eq(articles.id, a.id), eq(articles.status, "published")));
    });
    return { status: "retracted" };
  }

  const k = keyOf(a);
  const life = k ? (await getArticleLives(db, [k])).get(articleKey(k)) : undefined;
  if (!k || !life || life.endedAt == null || a.gamertag == null) return { status: "skipped", why: "its life cannot be resolved" };
  const target: ObituaryTarget = {
    lifeId: life.id, serverId: life.serverId,
    // The reads resolve the player by the CURRENT name; the prose uses the frozen one (below).
    gamertag: life.currentGamertag,
    map: a.map ?? "", mapSlug: a.mapSlug, lifeNumber: a.lifeNumber ?? life.lifeNumber,
    lifeStartedAt: life.startedAt, endedAt: life.endedAt,
  };
  const inputs = await loadObituaryInputs(db, target, c.withdrawFamily ? { withdrawFamily: c.withdrawFamily } : {});
  if (!inputs) return { status: "skipped", why: "no final verdict (none stored, or held for review)" };
  if (!deps.client) throw new Error("a rewrite needs a model client (OPENROUTER_API_KEY)");
  const facts = { ...inputs.facts, gamertag: a.gamertag };
  const recent = [...opts.recent, ...opts.batchProse];

  let obituary;
  try {
    obituary = await generateObituary(deps.client, facts, recent, inputs.hints);
  } catch (e) {
    const why = e instanceof CauseCheckError ? `${e.message}: ${e.violations.join("; ")}` : e instanceof Error ? e.message : String(e);
    return { status: "failed", why };
  }
  const deduped = dedupePullQuote(obituary, recent);
  const tags = composeTags(facts, deduped.tags);
  opts.batchProse.push({ headline: deduped.headline, attribution: deduped.pullQuote?.attribution ?? null, opener: opener(deduped.lede) });
  if (!opts.write) return { status: "would-rewrite", headline: deduped.headline, lede: deduped.lede };

  const stored = storedFacts(facts);
  const now = deps.now();
  await db.transaction(async (tx) => {
    await archive(tx as unknown as Database, a, c.reason, now);
    await tx.update(articles).set({
      headline: deduped.headline,
      lede: deduped.lede,
      body: deduped.body,
      // The rich body of an older article would be rendered instead of the new flat body.
      bodyBlocks: null,
      pullQuoteText: deduped.pullQuote?.text ?? null,
      pullQuoteAttribution: deduped.pullQuote?.attribution ?? null,
      tags,
      facts: stored as unknown,
      cause: stored.verdict.cause,
      // The Rap Sheet reads these columns: a denied trap kill must leave the kill count too.
      kills: stored.kills,
      timeAliveSeconds: stored.timeAliveSeconds,
      longestKillMeters: stored.longestKillMeters,
      promptVersion: OBITUARY_PROMPT_VERSION,
      model: deps.model,
      generatedAt: now,
      verdictVersion: inputs.verdictVersion,
    }).where(eq(articles.id, a.id));
  });
  return { status: "rewritten", headline: deduped.headline, lede: deduped.lede };
}

/** Copy the row as it stands into `article_revisions`. */
async function archive(db: Database, a: ArticleRow, reason: RevisionReason, at: Date, extra: Partial<ArticleSnapshot> = {}): Promise<ArticleSnapshot> {
  const snapshot = { ...snapshotOf(a, correctedAtOf(await latestRevision(db, a.id))), ...extra };
  await db.insert(articleRevisions).values({ articleId: a.id, replacedAt: at, reason, snapshot });
  return snapshot;
}

/**
 * `--restore <slug>`: archive the current row (reason `restored`) and write the latest archived
 * version back, status included, so a retracted obituary is published again. Running it twice puts
 * the replaced text back again. The restore records which correction line the restored text had,
 * so the page shows the line exactly when that text was a correction (`correctedAtOf`).
 */
export async function restore(db: Database, slug: string, deps: Pick<RegenerateDeps, "now" | "out" | "siteUrl">): Promise<boolean> {
  const [row] = await db.select(ROW_COLS).from(articles).where(and(eq(articles.kind, "obituary"), eq(articles.slug, slug)));
  if (!row) { deps.out(`${slug}: no obituary with this slug`); return false; }
  const a: ArticleRow = { ...row, id: Number(row.id) };
  const latest = await db.select().from(articleRevisions).where(eq(articleRevisions.articleId, a.id))
    .orderBy(sql`${articleRevisions.id} desc`).limit(1);
  const rev = latest[0];
  if (!rev) { deps.out(`${slug}: nothing to restore (no archived version)`); return false; }
  const s = rev.snapshot as ArticleSnapshot;
  await db.transaction(async (tx) => {
    await archive(tx as unknown as Database, a, "restored", deps.now(), { restoredCorrectedAt: s.correctedAt ?? null });
    await tx.update(articles).set({
      status: s.status, headline: s.headline, lede: s.lede, body: s.body, bodyBlocks: s.bodyBlocks ?? null,
      pullQuoteText: s.pullQuoteText, pullQuoteAttribution: s.pullQuoteAttribution, tags: s.tags, facts: s.facts,
      cause: s.cause, promptVersion: s.promptVersion, model: s.model,
      generatedAt: s.generatedAt ? new Date(s.generatedAt) : null, verdictVersion: s.verdictVersion,
      kills: s.kills, timeAliveSeconds: s.timeAliveSeconds, longestKillMeters: s.longestKillMeters,
    }).where(eq(articles.id, a.id));
  });
  deps.out(`${slug}: restored the version archived at ${rev.replacedAt.toISOString()} (${rev.reason}); status ${s.status}`);
  deps.out(`  now:      ${s.headline ?? ""}`);
  deps.out(`  replaced: ${a.headline ?? ""}`);
  deps.out(`  ${obituaryUrl(deps.siteUrl, slug)}`);
  return true;
}

// ---------------------------------------------------------------------------------------------
// The command.
// ---------------------------------------------------------------------------------------------

/** Thrown when `--denied-credit` must not run yet; the CLI prints it and exits non-zero. */
export class SweepNotCaughtUpError extends Error {
  constructor(readonly backlog: VerdictSweepBacklog) {
    super(`refusing: the verdict sweep has not caught up (queue ${backlog.queued}, lives without a current verdict `
      + `${backlog.unswept}, fold behind: ${backlog.foldBehind}). In the gap after a rebuild every trap kill is absent. `
      + "Wait for `verify-verdicts -- --held` to show an empty queue, then run this again.");
    this.name = "SweepNotCaughtUpError";
  }
}

export interface RegenerateResult { selected: number; rewritten: number; retracted: number; skipped: number; failed: number }

async function select(db: Database, s: Selector, slug: string | null, limit: number | null): Promise<Candidate[]> {
  switch (s.kind) {
    case "slug": return cap(await selectSlug(db, slug!), limit);
    case "stale-cause": return selectStale(db, { slug, limit });
    case "stale-inferred": return selectStaleInferred(db, { slug, limit });
    case "inferred-family": return selectInferredFamily(db, s.family, { slug, limit });
    case "denied-credit": return selectDeniedCredit(db, { slug, limit });
  }
}

export async function runRegenerate(db: Database, args: Exclude<RegenerateArgs, { restore: string }>, deps: RegenerateDeps): Promise<RegenerateResult> {
  if (args.selector.kind === "denied-credit") {
    const backlog = await (deps.sweepBacklog ?? verdictSweepBacklog)(db);
    if (!sweepCaughtUp(backlog)) throw new SweepNotCaughtUpError(backlog);
  }
  const chosen = await select(db, args.selector, args.slug, args.limit);
  const res: RegenerateResult = { selected: chosen.length, rewritten: 0, retracted: 0, skipped: 0, failed: 0 };
  deps.out(`${chosen.length} article(s) selected${args.write ? "" : " (dry-run: nothing is written; add --write)"}`);
  const recent = chosen.some((c) => c.action === "rewrite") ? await recentProse(db, "obituary", RECENT_PROSE_LIMIT) : [];
  const batchProse: RecentProse[] = [];
  // Social posts cannot be recalled by this command: the URLs to delete by hand (spec 6.3, 6.4).
  const posts = args.selector.kind === "inferred-family" || args.selector.kind === "denied-credit";
  for (const c of chosen) {
    const a = c.article;
    deps.out(`=== ${a.slug} (${c.action}: ${c.why})`);
    if (posts) deps.out(`  url: ${obituaryUrl(deps.siteUrl, a.slug ?? "")}  published ${a.createdAt.toISOString().slice(0, 10)}`);
    const o = await regenerateOne(db, deps, c, { write: args.write, recent, batchProse });
    switch (o.status) {
      case "rewritten":
      case "would-rewrite":
        deps.out(`  old headline: ${a.headline ?? ""}`);
        deps.out(`  new headline: ${o.headline}`);
        deps.out(`  old lede: ${a.lede ?? ""}`);
        deps.out(`  new lede: ${o.lede}`);
        deps.out(`  checks: pass${o.status === "rewritten" ? "; written" : ""}`);
        if (o.status === "rewritten") res.rewritten++;
        break;
      case "retracted":
      case "would-retract":
        deps.out(`  ${o.status === "retracted" ? "retracted" : "would retract"} (status 'retracted'; put back with --restore ${a.slug})`);
        if (o.status === "retracted") res.retracted++;
        break;
      case "skipped":
        deps.out(`  SKIPPED: ${o.why}`);
        res.skipped++;
        break;
      case "failed":
        deps.out(`  FAILED (nothing changed): ${o.why}`);
        res.failed++;
        break;
    }
  }
  deps.out(`done: ${res.rewritten} rewritten, ${res.retracted} retracted, ${res.skipped} skipped, ${res.failed} failed`);
  return res;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseRegenerateArgs(process.argv.slice(2));
  const cfg = loadConfig(process.env);
  const siteUrl = process.env.SITE_URL || "https://dayzonelife.com";
  const { db, sql: conn } = getDb(cfg.databaseUrl);
  const out = (l: string) => console.log(l);
  const now = () => new Date();
  const run = async (): Promise<number> => {
    if (args.restore != null) return (await restore(db, args.restore, { now, out, siteUrl })) ? 0 : 1;
    const client = cfg.openrouterApiKey !== ""
      ? openrouterClient({ apiKey: cfg.openrouterApiKey, model: cfg.model, temperature: cfg.temperature }) : null;
    const r = await runRegenerate(db, args, { client, model: cfg.model, now, siteUrl, out });
    return r.failed || r.skipped ? 1 : 0;
  };
  run()
    .then((code) => { process.exitCode = code; })
    .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
    .finally(() => conn.end());
}
