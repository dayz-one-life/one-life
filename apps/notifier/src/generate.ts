import type { Database } from "@onelife/db";
import { notifications } from "@onelife/db";
import type { Generator, Log, NotificationDraft } from "./types.js";

export type GenerateResult = { drafts: number; inserted: number; disabled: boolean };

export type GenerateDeps = {
  generators: Generator[];
  now: Date;
  since: Date | null;
  lookbackHours: number;
  siteUrl: string;
  dryRun: boolean;
  log: Log;
};

/** Drop drafts sharing a naturalKey. Postgres rejects an ON CONFLICT batch that
 *  conflicts with ITSELF ("cannot affect row a second time"), so intra-batch dedup
 *  must happen here — the unique index only protects against prior ticks. */
function dedupe(drafts: NotificationDraft[]): NotificationDraft[] {
  const seen = new Set<string>();
  return drafts.filter((d) => (seen.has(d.naturalKey) ? false : (seen.add(d.naturalKey), true)));
}

/** Run every generator, then insert all drafts in one statement. The unique index on
 *  natural_key IS the anti-join: no cursor, no per-row existence check.
 *
 *  NOTE: onConflictDoNothing targets a PLAIN unique index, so it takes no targetWhere.
 *  Do not copy the targetWhere argument from apps/newsdesk/src/pg-store.ts, whose
 *  index is partial. */
export async function generateTick(db: Database, deps: GenerateDeps): Promise<GenerateResult> {
  if (!deps.since) return { drafts: 0, inserted: 0, disabled: true };

  const genDeps = {
    db, now: deps.now, since: deps.since,
    lookbackHours: deps.lookbackHours, siteUrl: deps.siteUrl,
  };

  const all: NotificationDraft[] = [];
  for (const gen of deps.generators) {
    // One broken generator must not cost the whole tick.
    try {
      all.push(...(await gen(genDeps)));
    } catch (err) {
      deps.log.warn?.({ err }, "notification generator failed (skipped this tick)");
    }
  }

  const drafts = dedupe(all);
  if (deps.dryRun) {
    for (const d of drafts) deps.log.info({ kind: d.kind, naturalKey: d.naturalKey }, "DRY RUN: would notify");
    return { drafts: drafts.length, inserted: 0, disabled: false };
  }
  if (drafts.length === 0) return { drafts: 0, inserted: 0, disabled: false };

  const rows = await db
    .insert(notifications)
    .values(drafts)
    .onConflictDoNothing({ target: notifications.naturalKey })
    .returning({ id: notifications.id });

  return { drafts: drafts.length, inserted: rows.length, disabled: false };
}
