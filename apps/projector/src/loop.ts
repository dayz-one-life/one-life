import { sql } from "drizzle-orm";
import type { Database } from "@onelife/db";
import { getCursor } from "@onelife/event-log";
import type { Config } from "./config.js";

export interface LoopLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

export interface LoopDeps {
  db: Database;
  cfg: Pick<Config, "batchSize">;
  log: LoopLogger;
  tick: () => Promise<{ applied: number; skipped: number }>;
  sweep: () => Promise<{ written: number; failed: number; held: number; rederived: number }>;
  /** Test seam: whether the cursor is below the newest event. Defaults to asking the database. */
  cursorBehind?: () => Promise<boolean>;
}

/** True when the projector's cursor is below the newest event id. */
export async function cursorBehind(db: Database, consumer = "projector"): Promise<boolean> {
  const cursor = await getCursor(db, consumer);
  const r = (await db.execute<{ max: string | null }>(sql`SELECT max(id) AS max FROM events`)) as unknown as { max: string | null }[];
  const max = r[0]?.max == null ? 0 : Number(r[0].max);
  return cursor < max;
}

/**
 * One turn of the projector loop: fold a batch of events, then — only when the fold has caught up —
 * one pass of the verdict sweep.
 *
 * ⚠️ The sweep is skipped while the projector is behind (the tick took a full batch, or the cursor
 * is below the newest event). During a re-fold the sweep would classify half-folded lives (the
 * second line of a death cluster upgrades `death_cause`), and its settle and held alarms would fire
 * on every pass of a rebuild.
 * ⚠️ The sweep has its own try/catch: a failing sweep must never stop the fold.
 */
export async function runLoopOnce(deps: LoopDeps): Promise<{ applied: number; behind: boolean }> {
  const started = Date.now();
  let applied = 0;
  let skipped = 0;
  try {
    ({ applied, skipped } = await deps.tick());
    if (applied || skipped) deps.log.info({ applied, skipped, ms: Date.now() - started }, "projector tick");
  } catch (err) {
    deps.log.error({ err }, "projector tick failed");
    return { applied: 0, behind: true };
  }
  let behind = applied + skipped >= deps.cfg.batchSize;
  if (!behind) {
    try {
      behind = await (deps.cursorBehind ?? (() => cursorBehind(deps.db)))();
    } catch (err) {
      deps.log.error({ err }, "projector cursor check failed");
      behind = true;
    }
  }
  if (!behind) {
    const t = Date.now();
    try {
      const r = await deps.sweep();
      if (r.written || r.failed || r.rederived) deps.log.info({ ...r, ms: Date.now() - t }, "verdict_sweep");
    } catch (err) {
      deps.log.error({ err }, "verdict_sweep failed");
    }
  }
  return { applied, behind };
}
