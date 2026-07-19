import type { Database } from "@onelife/db";
import { getLifeTimeline, getPlayerPriors } from "@onelife/read-models";
import type { LifeTimeline, PlayerPriors } from "@onelife/read-models";
import { findStandingDeadTargets, findLongFormTargets } from "./news-targets.js";
import { buildStandingDeadFacts, buildLongFormFacts } from "./news-facts.js";
import type { NewsFacts } from "./news-facts.js";
import { composeNewsTags } from "./news-prompt.js";
import { generateNews } from "./generate.js";
import {
  publishNews, recordNewsFailure, findReturnedStandingDead, retractNewsArticles,
} from "./news-pg-store.js";
import { recentProse } from "./prose-pg-store.js";
import { dedupePullQuote } from "./prose-backstop.js";
import type { NewsdeskDeps } from "./tick.js";

/** Every threshold is required, never defaulted — main.ts must pass the operator's configuration
 *  or fail to compile. A silently-defaulted 72h in two places is how tuning drifts. */
export type NewsTickDeps = NewsdeskDeps & {
  enabled: boolean;
  since: Date | null;
  maxPerTick: number;
  standingDeadHours: number;
  minPlaytimeSeconds: number;
  minHitsAbsorbed: number;
  suppressedGamertags: string[];
  windowSeconds: number;
  radiusMeters: number;
  maxFixAgeSeconds: number;
};

/** Spec §14 observability: targets found, published, failed, and skipped-by-exclusion with
 *  per-reason counts. Without the last one, "why did the Long Form not fire this week" is
 *  unanswerable. */
export type NewsTickResult = {
  standingDeadFound: number;
  longFormFound: number;
  generated: number;
  failed: number;
  skipped: number;                              // target found but its timeline would not load
  retracted: number;
  longFormSkipped: Record<string, number>;
  dryRun: boolean;
};

/** How many recently published news articles the model is shown as do-not-reuse material.
 *  Fetched ONCE per tick, not per article — the block is the same for every target in the batch. */
const RECENT_PROSE_LIMIT = 12;

/** Over-fetch bound for the Long Form candidate query. Deliberately NOT an env var: it bounds one
 *  SQL read rather than any editorial behaviour, and at the verified fire rate (~1 clean cluster
 *  per week) 200 candidate deaths is several weeks of material. */
const LONG_FORM_CANDIDATE_LIMIT = 200;

/**
 * Project the exclusion counters onto the ones that can actually be non-zero.
 *
 * `unqualified_subject` is DROPPED. applyLongFormExclusions returns it, but the qualified gate
 * lives in the candidate SQL (long-form-targets.ts) — an unqualified death is a "candidate never
 * selected" and can never reach cluster construction, so the counter is structurally always 0.
 * Printing a permanently-zero counter in the observability line reads as "no cluster was ever
 * dropped for being unqualified", which is a claim the number cannot support and which an
 * operator debugging a silent week would act on. The honest alternative — pairing it with the
 * SQL-layer filtered count — needs a return-shape change in the PR-C1 targeting layer, which this
 * PR must not touch.
 */
export function longFormSkipLog(skipped: Record<string, number>): Record<string, number> {
  return {
    self_cluster: skipped.self_cluster ?? 0,
    suicide_subject: skipped.suicide_subject ?? 0,
    suppressed_gamertag: skipped.suppressed_gamertag ?? 0,
  };
}

const emptySkips = (): Record<string, number> =>
  ({ self_cluster: 0, suicide_subject: 0, suppressed_gamertag: 0 });

/**
 * One news cycle, the fourth sibling of newsdeskTick. TWO independent off-states, both returning
 * before any query and before any model call:
 *   - `enabled` is the NEWSDESK_NEWS_ENABLED kill switch (opt-in; default off);
 *   - `since === null` is an unset/invalid NEWSDESK_NEWS_SINCE (forward-only cutoff, gated on the
 *     ELIGIBILITY instant — see spec §4.1.3 — not on lives.started_at).
 * Both ship off, so this release is inert in production until an operator sets them.
 *
 * Everything past that gate is behind `dryRun` as well, including the retraction sweep: in a dry
 * run nothing was ever published, so there is nothing real to take down.
 */
export async function newsTick(db: Database, deps: NewsTickDeps): Promise<NewsTickResult> {
  if (!deps.enabled || deps.since === null) {
    return {
      standingDeadFound: 0, longFormFound: 0, generated: 0, failed: 0, skipped: 0,
      retracted: 0, longFormSkipped: emptySkips(), dryRun: deps.dryRun,
    };
  }

  const standing = await findStandingDeadTargets(db, {
    now: deps.now,
    since: deps.since,
    standingDeadHours: deps.standingDeadHours,
    minPlaytimeSeconds: deps.minPlaytimeSeconds,
    minHitsAbsorbed: deps.minHitsAbsorbed,
    suppressedGamertags: deps.suppressedGamertags,
    maxAttempts: deps.maxAttempts,
    limit: deps.maxPerTick,
  });

  const long = await findLongFormTargets(db, {
    since: deps.since,
    now: deps.now,
    maxFixAgeSeconds: deps.maxFixAgeSeconds,
    suppressedGamertags: deps.suppressedGamertags,
    candidateLimit: LONG_FORM_CANDIDATE_LIMIT,
    windowSeconds: deps.windowSeconds,
    radiusMeters: deps.radiusMeters,
    maxAttempts: deps.maxAttempts,
    limit: deps.maxPerTick,
  });

  let generated = 0;
  let failed = 0;
  let skipped = 0;

  // One query for the whole batch. Skipped entirely in dry-run — nothing is generated, so the
  // do-not-reuse material would go unused.
  const hasTargets = standing.length + long.clusters.length > 0;
  const recent = deps.dryRun || !hasTargets ? [] : await recentProse(db, "news", RECENT_PROSE_LIMIT);

  /** Shared tail: generate, dedupe the attribution, compose the reserved tags, publish. A failure
   *  writes a stub against the SAME natural key and is isolated to this one target. */
  const runOne = async (facts: NewsFacts): Promise<void> => {
    try {
      const article = await generateNews(deps.client, facts, recent);
      // Deterministic backstop behind the do-not-reuse prompt block: a recycled attribution loses
      // its byline rather than re-seeding the phrase for the next tick.
      const deduped = dedupePullQuote(article, recent);
      // Reserved tags (News / map / trigger) are composed deterministically; the LLM contributes
      // at most one flavor tag.
      const tagged = { ...deduped, tags: composeNewsTags(facts, deduped.tags) };
      await publishNews(db, {
        facts,
        article: tagged,
        promptVersion: deps.promptVersion,
        model: deps.model,
        now: deps.now,
      });
      generated++;
    } catch (e) {
      await recordNewsFailure(db, { facts, error: e instanceof Error ? e.message : String(e) });
      deps.log.error?.({ err: e, naturalKey: facts.naturalKey }, "news generation failed (will retry)");
      failed++;
    }
  };

  // ── The Standing Dead: one open, qualified life whose owner has gone quiet. ──
  for (const t of standing) {
    const timeline = await getLifeTimeline(db, t.serverId, t.gamertag, t.lifeId);
    if (!timeline) {
      skipped++;
      continue;
    }
    const priors = await getPlayerPriors(db, t.gamertag, t.lifeStartedAt);
    const facts = buildStandingDeadFacts(t, timeline, priors);
    if (deps.dryRun) {
      deps.log.info(
        { trigger: "standing_dead", gamertag: t.gamertag, map: t.map, idleSeconds: t.idleSeconds,
          priorLives: t.priorLives, hitsAbsorbed: t.hitsAbsorbed },
        "DRY RUN: would generate a Standing Dead feature",
      );
      continue;
    }
    await runOne(facts);
  }

  // ── The Long Form: a clique of qualified deaths sharing a minute and a patch of ground. ──
  for (const c of long.clusters) {
    const per = new Map<string, { timeline: LifeTimeline; priors: PlayerPriors }>();
    let incomplete = false;
    for (const s of c.subjects) {
      const timeline = await getLifeTimeline(db, s.serverId, s.gamertag, s.lifeId);
      if (!timeline) {
        // Publishing a shared-fate story that silently omits one of the people in it is worse
        // than not publishing it. The whole cluster is skipped, and its natural key stays
        // unclaimed so a later tick can retry it whole.
        incomplete = true;
        break;
      }
      per.set(s.gamertag, { timeline, priors: await getPlayerPriors(db, s.gamertag, s.lifeStartedAt) });
    }
    if (incomplete) {
      skipped++;
      continue;
    }
    const facts = buildLongFormFacts(c, per);
    if (deps.dryRun) {
      deps.log.info(
        { trigger: "long_form", gamertags: c.subjects.map((s) => s.gamertag), map: c.map,
          spanSeconds: facts.spanSeconds, allFreshSubjects: facts.allFreshSubjects },
        "DRY RUN: would generate a Long Form feature",
      );
      continue;
    }
    await runOne(facts);
  }

  // ── Retraction (spec §4.1.3). Reported in a dry run, written only for real. ──
  //
  // The sweep is GLOBAL AND UNBOUNDED IN TIME by design: it is not scoped to the servers this tick
  // looked at and has no created_at floor, so it rescans the whole published standing_dead
  // back-catalogue every tick. That is correct — a subject can return at any distance from
  // publication, and a scoped sweep would silently strand articles on quiet servers. `batchCap`
  // bounds the result, and at the verified corpus size (~7 subjects) the scan is trivial. If the
  // catalogue ever grows enough to matter, add a created_at floor knowingly, not by accident.
  //
  // The sweep also runs AFTER the generate loop, so an article published in THIS tick whose
  // subject reconnected between the target query and the publish is retracted immediately, in the
  // same tick. That is intended: the article was false the moment it was written, and it is better
  // taken down before anyone sees it than left up for one interval. It costs one model call, which
  // is the price of the race and not a bug to be tuned away.
  const returned = await findReturnedStandingDead(db, { limit: deps.batchCap });
  for (const r of returned) {
    deps.log.info(
      { articleId: r.articleId, naturalKey: r.naturalKey, gamertag: r.gamertag, slug: r.slug, dryRun: deps.dryRun },
      deps.dryRun
        ? "DRY RUN: would retract a Standing Dead feature — the subject came back"
        : "retracting a Standing Dead feature — the subject came back",
    );
  }
  if (!deps.dryRun) await retractNewsArticles(db, returned.map((r) => r.articleId));

  const result: NewsTickResult = {
    standingDeadFound: standing.length,
    longFormFound: long.clusters.length,
    generated,
    failed,
    skipped,
    retracted: returned.length,
    longFormSkipped: longFormSkipLog(long.skipped),
    dryRun: deps.dryRun,
  };
  // Logged UNCONDITIONALLY while the pass is enabled, unlike the sibling ticks which log only on
  // activity. Spec §14 requires the per-reason skip counts every tick: a silent week is exactly
  // the case the operator needs the numbers for, and the pass is off by default anyway.
  deps.log.info(result, "news tick");
  return result;
}
