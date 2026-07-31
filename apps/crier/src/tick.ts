import type { Database } from "@onelife/db";
import type { Config } from "./config.js";
import type { SyndicationTarget } from "./pg-store.js";
import { postToDiscord } from "./channels/discord.js";
import { postToFacebook } from "./channels/facebook.js";
import type { ObituaryPost } from "./post.js";

/** Mirrors apps/newsdesk obituary-url.ts and apps/web obituaryHref: SITE_URL + /obituaries/slug. */
const obituaryUrl = (siteUrl: string, slug: string): string =>
  `${siteUrl.replace(/\/$/, "")}/obituaries/${slug}`;

export type CrierStore = {
  findSyndicationTargets(db: Database, opts: { channels: string[]; since: Date; maxAttempts: number; limit: number }): Promise<SyndicationTarget[]>;
  recordSuccess(db: Database, slug: string, channel: string, now: Date): Promise<void>;
  recordFailure(db: Database, slug: string, channel: string, error: string): Promise<void>;
};

export type CrierDeps = {
  cfg: Config;
  fetchFn: typeof fetch;
  now: Date;
  log: { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };
  store: CrierStore;
  sleep: (ms: number) => Promise<void>;
};

export type CrierResult = { posted: number; failed: number; skipped: number; dryRun: boolean };

/** Pause between consecutive live posts — rate courtesy toward both platforms, and the pacing
 *  that keeps a deliberate backfill (CRIER_SINCE pointed backwards) from flooding a channel. */
const INTER_POST_MS = 2000;

export async function crierTick(db: Database, deps: CrierDeps): Promise<CrierResult> {
  const { cfg } = deps;
  const none: CrierResult = { posted: 0, failed: 0, skipped: 0, dryRun: cfg.dryRun };
  // SINCE gate: unset means OFF — never an epoch default that would blast all history.
  if (cfg.since === null) return none;
  const channels: string[] = [];
  if (cfg.discordWebhookUrl) channels.push("discord");
  if (cfg.fbPageId && cfg.fbPageAccessToken) channels.push("facebook");
  if (channels.length === 0) return none;

  const targets = await deps.store.findSyndicationTargets(db, {
    channels, since: cfg.since, maxAttempts: cfg.maxAttempts, limit: cfg.batchCap,
  });

  let posted = 0, failed = 0, skipped = 0, live = 0;
  for (const t of targets) {
    const post: ObituaryPost = { headline: t.headline, lede: t.lede, url: obituaryUrl(cfg.siteUrl, t.slug) };
    if (cfg.dryRun) {
      skipped++;
      deps.log.info({ slug: t.slug, channel: t.channel, post }, "dry-run: would post");
      continue;
    }
    if (live > 0) await deps.sleep(INTER_POST_MS);
    live++;
    // Channels are independent: a throw here records THIS row's failure and moves on — it must
    // never skip the same article's other channel or abort the tick.
    try {
      if (t.channel === "discord") await postToDiscord(deps.fetchFn, cfg.discordWebhookUrl!, post);
      else await postToFacebook(deps.fetchFn, cfg.fbPageId!, cfg.fbPageAccessToken!, post);
      await deps.store.recordSuccess(db, t.slug, t.channel, deps.now);
      posted++;
      deps.log.info({ slug: t.slug, channel: t.channel }, "posted");
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      await deps.store.recordFailure(db, t.slug, t.channel, msg);
      deps.log.error({ slug: t.slug, channel: t.channel, err: msg }, "post failed");
    }
  }
  return { posted, failed, skipped, dryRun: cfg.dryRun };
}
