import type { Database } from "@onelife/db";
import type { ActiveSubscription, UnpushedNotification } from "./push-store.js";
import type { Sender } from "./sender.js";
import type { Log } from "./types.js";

export type PushStore = {
  findUnpushed(db: Database, opts: { limit: number }): Promise<UnpushedNotification[]>;
  activeSubscriptionsFor(db: Database, userId: string): Promise<ActiveSubscription[]>;
  markPushed(db: Database, id: number, now: Date): Promise<void>;
  deleteSubscription(db: Database, id: number): Promise<void>;
  recordFailure(db: Database, id: number, now: Date): Promise<void>;
};

export type PushDeps = {
  now: Date; maxPerTick: number; maxAgeMinutes: number;
  enabled: boolean; dryRun: boolean; log: Log;
  store: PushStore; send: Sender;
};

export type PushResult = { sent: number; skipped: number; failed: number; disabled: boolean };

/** Fan unpushed notifications out to each owner's browser subscriptions.
 *
 *  Delivery is AT-LEAST-ONCE, mirroring apps/newsdesk/src/notify.ts: the send and the
 *  pushed_at stamp are two non-atomic steps, and we stamp only AFTER a confirmed send.
 *  Stamping first would DROP notifications on a transient failure.
 *
 *  Two cases must stamp WITHOUT sending, or the sweep never drains and the same rows are
 *  reconsidered every tick forever:
 *    - the owner has no active subscriptions (nothing to deliver to)
 *    - the notification is older than maxAgeMinutes (a stale backlog must not blast a
 *      user the moment they enable push)
 *
 *  Assumes a single notifier instance; the SELECT is not row-locked. */
export async function pushTick(db: Database, deps: PushDeps): Promise<PushResult> {
  if (!deps.enabled) return { sent: 0, skipped: 0, failed: 0, disabled: true };

  const rows = await deps.store.findUnpushed(db, { limit: deps.maxPerTick });
  const cutoff = deps.now.getTime() - deps.maxAgeMinutes * 60_000;
  let sent = 0, skipped = 0, failed = 0;

  for (const row of rows) {
    if (deps.dryRun) {
      deps.log.info({ id: row.id, kind: row.kind }, "DRY RUN: would push notification");
      continue;
    }

    if (row.createdAt.getTime() < cutoff) {
      await deps.store.markPushed(db, row.id, deps.now);
      skipped++;
      continue;
    }

    const subs = await deps.store.activeSubscriptionsFor(db, row.userId);
    if (subs.length === 0) {
      await deps.store.markPushed(db, row.id, deps.now);
      skipped++;
      continue;
    }

    const payload = JSON.stringify({ title: row.title, body: row.body, href: row.href });
    let delivered = false;

    for (const sub of subs) {
      const res = await deps.send(sub, payload);
      if (res.ok) { delivered = true; continue; }
      if (res.gone) {
        await deps.store.deleteSubscription(db, sub.id);
      } else {
        await deps.store.recordFailure(db, sub.id, deps.now);
        deps.log.warn?.({ id: row.id, subscriptionId: sub.id, error: res.error }, "push failed (retries next tick)");
      }
      failed++;
    }

    // Stamp once at least one endpoint accepted it. If every endpoint failed, the row
    // stays unpushed and is retried next tick.
    if (delivered) {
      await deps.store.markPushed(db, row.id, deps.now);
      sent++;
    }
  }

  return { sent, skipped, failed, disabled: false };
}
