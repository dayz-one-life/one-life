import type { Database } from "@onelife/db";
import type { UnpostedObituary } from "./pg-store.js";
import type { DiscordPostResult } from "./discord.js";
import { obituaryUrl } from "./obituary-url.js";

export interface NotifyStore {
  findUnpostedObituaries(db: Database, opts: { limit: number }): Promise<UnpostedObituary[]>;
  markObituaryPosted(db: Database, id: number, now: Date): Promise<void>;
}

export type NotifyDeps = {
  webhookUrl: string; // "" ⇒ feature disabled
  siteUrl: string;
  maxPerTick: number;
  dryRun: boolean;
  now: Date;
  log: { info: (obj: unknown, msg?: string) => void; warn?: (obj: unknown, msg?: string) => void };
  store: NotifyStore;
  post: (webhookUrl: string, content: string) => Promise<DiscordPostResult>;
};

export type NotifyResult = { posted: number; failed: number; disabled: boolean };

/** Post published-but-unposted obituary links to Discord, oldest death first, and stamp each on
 *  success. Idempotent + self-retrying: delivery state lives in the table, so a transient outage,
 *  worker restart, or the dry-run→live switch never drops an obituary.
 *
 *  Delivery is AT-LEAST-ONCE. The POST and the discord_posted_at stamp are two non-atomic steps and
 *  a plain webhook has no idempotency key, so if a post succeeds but the stamp write fails, the row
 *  stays unposted and re-posts next tick (a rare duplicate). We stamp only AFTER a confirmed post —
 *  the inverse (stamp first) would DROP obituaries on a post failure, which the design forbids.
 *  Assumes a single newsdesk instance (one systemd unit); concurrent instances would race the
 *  unlocked SELECT. */
export async function notifyDiscord(db: Database, deps: NotifyDeps): Promise<NotifyResult> {
  if (!deps.webhookUrl) return { posted: 0, failed: 0, disabled: true };

  const rows = await deps.store.findUnpostedObituaries(db, { limit: deps.maxPerTick });
  let posted = 0;
  let failed = 0;

  for (const row of rows) {
    const url = obituaryUrl(deps.siteUrl, row.slug);

    if (deps.dryRun) {
      deps.log.info({ url, gamertag: row.gamertag }, "DRY RUN: would post obituary to Discord");
      continue;
    }

    const res = await deps.post(deps.webhookUrl, url);
    if (res.ok) {
      posted++; // delivered — count it even if the stamp below fails (message did go out)
      try {
        await deps.store.markObituaryPosted(db, row.id, deps.now);
      } catch (e) {
        // Delivered but not stamped: keep going (one transient DB blip must not stall the batch);
        // the row re-posts next tick. Distinct warning so the rare duplicate is diagnosable.
        deps.log.warn?.({ err: e, id: row.id }, "Discord post delivered but stamp failed — may re-post next tick");
      }
    } else if (res.rateLimited) {
      deps.log.warn?.({ retryAfterSeconds: res.retryAfterSeconds }, "Discord rate limited; stopping sweep (retries next tick)");
      break;
    } else {
      deps.log.warn?.({ error: res.error, id: row.id }, "Discord post failed (will retry next tick)");
      failed++;
    }
  }

  return { posted, failed, disabled: false };
}
