import type { Database } from "@onelife/db";
import { getDeathCheckHints, getLifeTimeline, getPlayerPriors, getWriterDeath, type WriterOptions } from "@onelife/read-models";
import { buildObituaryFacts, type ObituaryFacts } from "./facts.js";
import type { CheckHints } from "./generate.js";
import type { ObituaryTarget } from "./pg-store.js";

/** Everything one obituary is generated from: the facts, the internal check hints, and the
 *  classifier version of the verdict behind them. */
export interface ObituaryInputs { facts: ObituaryFacts; hints: CheckHints; verdictVersion: number }

/**
 * Builds the inputs for one target. The tick, the preview and the tuning script all go through
 * here, so a preview shows exactly what the tick would send. Null when the life cannot be read or
 * has no final verdict (no obituary is written from a pending one).
 *
 * ⚠️ `hints` is internal (`getDeathCheckHints`): it is handed to the cause check only, never to
 * the prompt or the stored facts.
 */
export async function loadObituaryInputs(db: Database, t: ObituaryTarget, opts: WriterOptions = {}): Promise<ObituaryInputs | null> {
  const timeline = await getLifeTimeline(db, t.serverId, t.gamertag, t.lifeId);
  if (!timeline) return null;
  // `opts.withdrawFamily` is `regenerate --inferred-family`: write as if that family were off.
  const writer = await getWriterDeath(db, timeline.life, opts);
  if (!writer) return null;
  const [priors, hints] = await Promise.all([getPlayerPriors(db, t.gamertag, t.lifeStartedAt), getDeathCheckHints(db, t.lifeId)]);
  return { facts: buildObituaryFacts(t, timeline, priors, writer), hints, verdictVersion: writer.verdictVersion };
}
