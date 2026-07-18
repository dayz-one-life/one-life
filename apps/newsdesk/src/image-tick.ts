import type { Database } from "@onelife/db";
import type { CompletionClient } from "./generate.js";
import type { ImageClient } from "./openrouter.js";
import type { NewsdeskDeps, NewsdeskResult } from "./tick.js";
import { eligibleCategories } from "./image-categories.js";
import { buildScenePrompt, parseScene } from "./image-scene.js";
import { buildImagePrompt } from "./image-prompt.js";
import { findImageTargets, recentCovers, saveArticleImage, recordImageFailure } from "./image-pg-store.js";

export interface ImageTickDeps {
  client: CompletionClient;
  imageClient: ImageClient;
  enabled: boolean;
  dryRun: boolean;
  batchCap: number;
  maxAttempts: number;
  model: string; // workhorse image model
  flagshipModel: string; // legends' send-offs
  now: Date;
  log: NewsdeskDeps["log"];
}

/**
 * One image cycle: published articles (both kinds) still missing a photo get one — scene-writer
 * LLM (menu + escape hatch + recency exclusion) → §10.4 prompt → OpenRouter image → Postgres.
 * Every client call + write sits behind the dryRun gate; `enabled` is the images-only kill switch.
 */
export async function imageTick(db: Database, deps: ImageTickDeps): Promise<NewsdeskResult> {
  if (!deps.enabled) return { generated: 0, failed: 0, skipped: 0, dryRun: deps.dryRun };

  const targets = await findImageTargets(db, { limit: deps.batchCap, maxAttempts: deps.maxAttempts });
  let generated = 0;
  let failed = 0;
  const skipped = 0;

  for (const t of targets) {
    if (deps.dryRun) {
      deps.log.info({ slug: t.slug, kind: t.kind }, "DRY RUN: would generate article image");
      continue;
    }
    try {
      const eligible = eligibleCategories(t.kind, t.facts);
      const recent = await recentCovers(db, t.kind);
      const prompt = buildScenePrompt({ kind: t.kind, facts: t.facts, headline: t.headline, lede: t.lede, eligible, recent });
      const choice = parseScene(await deps.client.complete({ system: prompt.system, user: prompt.user }));
      const fullPrompt = buildImagePrompt(choice.scene, "hero");
      const model = t.facts.isLegend === true ? deps.flagshipModel : deps.model;
      const image = await deps.imageClient.generate({ prompt: fullPrompt, model });
      await saveArticleImage(db, {
        articleId: t.articleId, slug: t.slug, prompt: fullPrompt,
        caption: choice.caption, model, image, now: deps.now,
      });
      generated++;
    } catch (e) {
      await recordImageFailure(db, { articleId: t.articleId, error: e instanceof Error ? e.message : String(e) });
      deps.log.error?.({ err: e, slug: t.slug }, "article image generation failed (will retry)");
      failed++;
    }
  }

  return { generated, failed, skipped, dryRun: deps.dryRun };
}
