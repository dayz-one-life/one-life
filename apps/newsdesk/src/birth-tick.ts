import type { Database } from "@onelife/db";
import { getLifeTimeline, getPlayerPriors } from "@onelife/read-models";
import { findBirthNoticeTargets, publishBirthNotice, recordBirthNoticeFailure } from "./birth-pg-store.js";
import { recentProse } from "./prose-pg-store.js";
import { buildBirthFacts } from "./birth-facts.js";
import { composeBirthTags } from "./birth-prompt.js";
import { generateBirthNotice } from "./generate.js";
import type { NewsdeskDeps, NewsdeskResult } from "./tick.js";
import { dedupePullQuote } from "./prose-backstop.js";

/** Mirror of tick.ts: the do-not-reuse window, fetched once per tick. */
const RECENT_PROSE_LIMIT = 12;

/**
 * One birth-notice cycle, the sibling of newsdeskTick. Forward-only: `since` is the go-live cutoff.
 * When `since` is null the birth pass is OFF — return zeros immediately without querying the DB or
 * calling the model. Otherwise: find qualified lives (alive-or-dead) born since the cutoff lacking a
 * published notice, generate each in the Nursery voice, and publish it. Every OpenRouter call + write
 * is behind the dryRun gate.
 */
export async function birthNoticeTick(
  db: Database,
  deps: NewsdeskDeps & { since: Date | null },
): Promise<NewsdeskResult> {
  if (deps.since === null) {
    return { generated: 0, failed: 0, skipped: 0, dryRun: deps.dryRun };
  }

  const targets = await findBirthNoticeTargets(db, { since: deps.since, limit: deps.batchCap, maxAttempts: deps.maxAttempts });
  let generated = 0;
  let failed = 0;
  let skipped = 0;

  const recent = deps.dryRun || targets.length === 0 ? [] : await recentProse(db, "birth_notice", RECENT_PROSE_LIMIT);

  for (const t of targets) {
    const timeline = await getLifeTimeline(db, t.serverId, t.gamertag, t.lifeId);
    if (!timeline) {
      skipped++;
      continue;
    }
    const priors = await getPlayerPriors(db, t.gamertag, t.lifeStartedAt);
    const facts = buildBirthFacts(t, timeline, priors);

    if (deps.dryRun) {
      deps.log.info({ gamertag: t.gamertag, lifeId: t.lifeId, map: t.map }, "DRY RUN: would generate birth notice");
      continue;
    }

    try {
      const notice = await generateBirthNotice(deps.client, facts, recent);
      const deduped = dedupePullQuote(notice, recent);
      // Reserved tags (Fresh Spawns / map / priors label) are composed deterministically; the LLM
      // only contributes at most one flavor tag.
      const tagged = { ...deduped, tags: composeBirthTags(facts, deduped.tags) };
      await publishBirthNotice(db, {
        target: t,
        facts,
        notice: tagged,
        promptVersion: deps.promptVersion,
        model: deps.model,
        now: deps.now,
      });
      generated++;
    } catch (e) {
      await recordBirthNoticeFailure(db, { target: t, error: e instanceof Error ? e.message : String(e) });
      deps.log.error?.({ err: e, lifeId: t.lifeId }, "birth notice generation failed (will retry)");
      failed++;
    }
  }

  return { generated, failed, skipped, dryRun: deps.dryRun };
}
