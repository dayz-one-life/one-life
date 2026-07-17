import type { Database } from "@onelife/db";
import { getLifeTimeline } from "@onelife/read-models";
import { findObituaryTargets, publishObituary, recordObituaryFailure } from "./pg-store.js";
import { buildObituaryFacts } from "./facts.js";
import { composeTags } from "./prompt.js";
import { generateObituary, type CompletionClient } from "./generate.js";

export type NewsdeskDeps = {
  client: CompletionClient;
  dryRun: boolean;
  batchCap: number;
  maxAttempts: number;
  promptVersion: string;
  model: string;
  now: Date;
  log: { info: (obj: unknown, msg?: string) => void; error?: (obj: unknown, msg?: string) => void };
};

export type NewsdeskResult = { generated: number; failed: number; skipped: number; dryRun: boolean };

/**
 * One newsdesk cycle: find qualified deaths lacking a published obituary, generate each in the
 * One Life voice, and publish it. Every OpenRouter call + write is behind the dryRun gate.
 */
export async function newsdeskTick(db: Database, deps: NewsdeskDeps): Promise<NewsdeskResult> {
  const targets = await findObituaryTargets(db, { limit: deps.batchCap, maxAttempts: deps.maxAttempts });
  let generated = 0;
  let failed = 0;
  let skipped = 0;

  for (const t of targets) {
    const timeline = await getLifeTimeline(db, t.serverId, t.gamertag, t.lifeId);
    if (!timeline) {
      skipped++;
      continue;
    }
    const facts = buildObituaryFacts(t, timeline);

    if (deps.dryRun) {
      deps.log.info({ gamertag: t.gamertag, lifeId: t.lifeId, map: t.map }, "DRY RUN: would generate obituary");
      continue;
    }

    try {
      const obituary = await generateObituary(deps.client, facts);
      // Reserved tags (Obituaries / map / cause) are composed deterministically; the LLM only
      // contributes at most one flavor tag.
      const tagged = { ...obituary, tags: composeTags(facts, obituary.tags) };
      await publishObituary(db, {
        target: t,
        facts,
        obituary: tagged,
        promptVersion: deps.promptVersion,
        model: deps.model,
        now: deps.now,
      });
      generated++;
    } catch (e) {
      await recordObituaryFailure(db, { target: t, error: e instanceof Error ? e.message : String(e) });
      deps.log.error?.({ err: e, lifeId: t.lifeId }, "obituary generation failed (will retry)");
      failed++;
    }
  }

  return { generated, failed, skipped, dryRun: deps.dryRun };
}
