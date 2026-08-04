import type { Database } from "@onelife/db";
import type { Config } from "./config.js";
import type { SyndicationTarget } from "./pg-store.js";
import { postToDiscord } from "./channels/discord.js";
import { postToFacebook } from "./channels/facebook.js";
import { postToReddit, createRedditTokenProvider } from "./channels/reddit.js";
import type { ObituaryPost } from "./post.js";

/** Mirrors apps/newsdesk obituary-url.ts and apps/web obituaryHref: SITE_URL + /obituaries/slug. */
const obituaryUrl = (siteUrl: string, slug: string): string =>
  `${siteUrl.replace(/\/$/, "")}/obituaries/${slug}`;

export type CrierStore = {
  findSyndicationTargets(db: Database, opts: { channels: string[]; since: Date; maxAttempts: number; limit: number }): Promise<SyndicationTarget[]>;
  recordSuccess(db: Database, slug: string, channel: string, now: Date): Promise<void>;
  recordFailure(db: Database, slug: string, channel: string, error: string): Promise<void>;
  lastPostedAt(db: Database, channel: string): Promise<Date | null>;
};

export type CrierDeps = {
  cfg: Config;
  fetchFn: typeof fetch;
  now: Date;
  log: { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };
  store: CrierStore;
  sleep: (ms: number) => Promise<void>;
};

export type CrierResult = { posted: number; failed: number; skipped: number; deferred: number; dryRun: boolean };

/** Pause between consecutive live posts — rate courtesy toward both platforms, and the pacing
 *  that keeps a deliberate backfill (CRIER_SINCE pointed backwards) from flooding a channel. */
const INTER_POST_MS = 2000;

export async function crierTick(db: Database, deps: CrierDeps): Promise<CrierResult> {
  const { cfg } = deps;
  const none: CrierResult = { posted: 0, failed: 0, skipped: 0, deferred: 0, dryRun: cfg.dryRun };
  // SINCE gate: unset means OFF — never an epoch default that would blast all history.
  if (cfg.since === null) return none;
  const channels: string[] = [];
  if (cfg.discordWebhookUrl) channels.push("discord");
  if (cfg.fbPageId && cfg.fbPageAccessToken) channels.push("facebook");
  if (cfg.reddit) channels.push("reddit");
  if (channels.length === 0) return none;

  const targets = await deps.store.findSyndicationTargets(db, {
    channels, since: cfg.since, maxAttempts: cfg.maxAttempts, limit: cfg.batchCap,
  });

  // One token provider per tick: it caches internally, so several Reddit posts in one tick share
  // a single mint. Built even when no Reddit row turns up — construction makes no request.
  const redditToken = cfg.reddit
    ? createRedditTokenProvider({ fetchFn: deps.fetchFn, creds: cfg.reddit, now: () => deps.now })
    : null;

  // Reddit paces itself independently of INTER_POST_MS: its spam heuristics dislike a burst of
  // same-domain links far more than Discord's or Facebook's do. Seeded from the ledger so the
  // window holds across restarts, then advanced in-loop so two Reddit rows in one tick cannot
  // both go out.
  let redditLastPost = cfg.reddit && !cfg.dryRun ? await deps.store.lastPostedAt(db, "reddit") : null;
  const redditWindowMs = cfg.redditMinIntervalSeconds * 1000;

  let posted = 0, failed = 0, skipped = 0, deferred = 0, live = 0;
  for (const t of targets) {
    const post: ObituaryPost = { headline: t.headline, lede: t.lede, url: obituaryUrl(cfg.siteUrl, t.slug) };
    if (cfg.dryRun) {
      skipped++;
      deps.log.info({ slug: t.slug, channel: t.channel, post }, "dry-run: would post");
      continue;
    }
    // ⚠️ A rate-cap deferral is NEITHER a success NOR a failure — it must not touch the row.
    // Recording it as a failure burns an attempt, and at CRIER_MAX_ATTEMPTS=5 five minutes of
    // ordinary rate limiting would poison every queued row permanently: the channel goes silent
    // with nothing in `last_error` to explain it. Leave the row alone and pick it up next tick.
    if (t.channel === "reddit" && redditLastPost && deps.now.getTime() - redditLastPost.getTime() < redditWindowMs) {
      deferred++;
      deps.log.info({ slug: t.slug, channel: t.channel, lastPost: redditLastPost }, "rate cap: deferred");
      continue;
    }
    if (live > 0) await deps.sleep(INTER_POST_MS);
    live++;
    // Channels are independent: a throw here records THIS row's failure and moves on — it must
    // never skip the same article's other channel or abort the tick.
    try {
      // ⚠️ A dispatch map, not `if discord … else facebook`. That binary form shipped first and
      // would route ANY third channel to Facebook.
      if (t.channel === "discord") {
        await postToDiscord(deps.fetchFn, cfg.discordWebhookUrl!, post);
      } else if (t.channel === "facebook") {
        await postToFacebook(deps.fetchFn, cfg.fbPageId!, cfg.fbPageAccessToken!, post);
      } else if (t.channel === "reddit") {
        await postToReddit(deps.fetchFn, await redditToken!(), post, cfg.reddit!);
        redditLastPost = deps.now;
      } else {
        throw new Error(`unknown channel ${t.channel}`);
      }
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
  return { posted, failed, skipped, deferred, dryRun: cfg.dryRun };
}
