import { like } from "drizzle-orm";
import type { Database } from "@onelife/db";
import { rawLines } from "@onelife/db";
import { parseUnconscious } from "@onelife/adm-parser";
import { appendEvent } from "@onelife/event-log";

/**
 * Appends `player.unconscious` events for historical raw lines, which predate the parser.
 *
 * ⚠️ subIndex 1, not 0: every one of these lines already stored `player.position` at subIndex 0,
 * and `parseLine` now dispatches unconscious immediately after position. Using 0 here would
 * collide with events_idempotency_uniq and append nothing.
 *
 * The `%unconscious%` prefilter excludes `regained consciousness` lines by itself — that string
 * does not contain the substring "unconscious" — so those rows are never fetched and never reach
 * parseUnconscious. Corpse lines (`(DEAD) … is unconscious`) DO match the prefilter and are
 * excluded by parseUnconscious's own `(DEAD)` guard.
 *
 * Idempotent — appendEvent's onConflictDoNothing on (serverId, admFileId, lineIndex, subIndex)
 * makes a re-run a no-op. Safe to run repeatedly.
 */
export async function backfillUnconscious(db: Database): Promise<{ appended: number; scanned: number }> {
  const rows = await db.select().from(rawLines).where(like(rawLines.text, "%unconscious%"));
  let appended = 0;
  for (const row of rows) {
    const u = parseUnconscious(row.text);
    if (!u) continue;
    if (row.occurredAt == null) continue;             // no timestamp, no place on the timeline
    await appendEvent(db, {
      serverId: row.serverId,
      admFileId: row.admFileId,
      lineIndex: row.lineIndex,
      subIndex: 1,
      type: "player.unconscious",
      occurredAt: row.occurredAt,
      payload: { gamertag: u.gamertag, disconnecting: u.disconnecting, x: u.x, y: u.y },
      rawLineId: row.id,
    });
    appended++;
  }
  return { appended, scanned: rows.length };
}

// Runnable entrypoint (mirrors backfill-death-causes).
if (import.meta.url === `file://${process.argv[1]}`) {
  const { getDb } = await import("@onelife/db");
  const { db, sql: end } = getDb(process.env.DATABASE_URL!);
  const { appended, scanned } = await backfillUnconscious(db);
  console.log(`[backfill-unconscious] scanned ${scanned} candidate lines, appended ${appended} events.`);
  console.log(`The projector folds these forward on its normal cursor — no rebuild required.`);
  await end.end();
  process.exit(0);
}
