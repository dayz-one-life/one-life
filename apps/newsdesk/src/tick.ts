import type { Database } from "@onelife/db";
import { findObituaryTargets, overdueObituaryLives, publishObituary, recordObituaryFailure, OBITUARY_OVERDUE_MINUTES } from "./pg-store.js";
import { recentProse, RECENT_PROSE_LIMIT } from "./prose-pg-store.js";
import { storedFacts } from "./facts.js";
import { loadObituaryInputs } from "./inputs.js";
import { composeTags } from "./prompt.js";
import { CauseCheckError, generateObituary, type CompletionClient } from "./generate.js";
import { dedupePullQuote } from "./prose-backstop.js";

export type NewsdeskDeps = {
  client: CompletionClient;
  dryRun: boolean;
  batchCap: number;
  maxAttempts: number;
  promptVersion: string;
  model: string;
  now: Date;
  since: Date | null;
  log: { info: (obj: unknown, msg?: string) => void; error?: (obj: unknown, msg?: string) => void };
};

export type NewsdeskResult = { generated: number; failed: number; skipped: number; dryRun: boolean };

/** How many recently published articles the model is shown as do-not-reuse material. Fetched
 *  ONCE per tick, not per article — the block is the same for every target in the batch. */

/**
 * One newsdesk cycle: find qualified deaths lacking a published obituary, generate each in the
 * One Life voice, and publish it. Every OpenRouter call + write is behind the dryRun gate.
 */
export async function newsdeskTick(db: Database, deps: NewsdeskDeps): Promise<NewsdeskResult> {
  // SINCE gate: unset means OFF — never a silent epoch default that would obituarize all history.
  if (deps.since === null) return { generated: 0, failed: 0, skipped: 0, dryRun: deps.dryRun };

  // ⚠️ The overdue alarm. The death-verdict gate holds a death until its verdict is stored; a death
  // held too long is logged here, at error level, whatever the reason (the projector's sweep may
  // never have failed on it). Delayed, never silently lost.
  const overdue = await overdueObituaryLives(db, { since: deps.since, now: deps.now, maxAttempts: deps.maxAttempts });
  if (overdue.length) {
    deps.log.error?.({ count: overdue.length, lifeIds: overdue.slice(0, 20), minutes: OBITUARY_OVERDUE_MINUTES }, "newsdesk.obituary_overdue");
  }

  const targets = await findObituaryTargets(db, { limit: deps.batchCap, maxAttempts: deps.maxAttempts, since: deps.since });
  let generated = 0;
  let failed = 0;
  let skipped = 0;

  // One query for the whole batch. Skipped entirely in dry-run — nothing is generated, so the
  // do-not-reuse material would go unused.
  const recent = deps.dryRun || targets.length === 0 ? [] : await recentProse(db, "obituary", RECENT_PROSE_LIMIT);

  for (const t of targets) {
    // The life, its stored verdict (with a credit, if any), the priors and the internal check hint.
    const inputs = await loadObituaryInputs(db, t);
    if (!inputs) {
      skipped++;
      continue;
    }
    const { facts, hints, verdictVersion } = inputs;

    if (deps.dryRun) {
      deps.log.info({ gamertag: t.gamertag, lifeId: t.lifeId, map: t.map }, "DRY RUN: would generate obituary");
      continue;
    }

    try {
      const obituary = await generateObituary(deps.client, facts, recent, hints);
      // Deterministic backstop behind the do-not-reuse prompt block: a recycled attribution
      // loses its byline rather than re-seeding the phrase for the next tick.
      const deduped = dedupePullQuote(obituary, recent);
      // Reserved tags (Obituaries / map / cause) are composed deterministically; the LLM only
      // contributes at most one flavor tag.
      const tagged = { ...deduped, tags: composeTags(facts, deduped.tags) };
      await publishObituary(db, {
        target: t,
        // ⚠️ Stored without the credited name or the writer's brief (spec 6.1).
        facts: storedFacts(facts),
        obituary: tagged,
        verdictVersion,
        promptVersion: deps.promptVersion,
        model: deps.model,
        now: deps.now,
      });
      generated++;
    } catch (e) {
      await recordObituaryFailure(db, { target: t, error: e instanceof Error ? e.message : String(e) });
      // The operator log gets the cause check's full strings; the stored last_error only its rule numbers.
      const violations = e instanceof CauseCheckError ? e.violations : undefined;
      deps.log.error?.({ err: e, lifeId: t.lifeId, violations }, "obituary generation failed (will retry)");
      failed++;
    }
  }

  return { generated, failed, skipped, dryRun: deps.dryRun };
}
