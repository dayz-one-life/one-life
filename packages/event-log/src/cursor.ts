import type { Database } from "@onelife/db";
import { events, consumerCursors } from "@onelife/db";
import { eq, gt, asc } from "drizzle-orm";

export type EventRow = typeof events.$inferSelect;

export async function getCursor(db: Database, name: string): Promise<number> {
  const rows = await db.select().from(consumerCursors).where(eq(consumerCursors.consumerName, name));
  return rows[0]?.lastEventId ?? 0;
}

export async function setCursor(db: Database, name: string, lastEventId: number): Promise<void> {
  await db.insert(consumerCursors)
    .values({ consumerName: name, lastEventId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: consumerCursors.consumerName,
      set: { lastEventId, updatedAt: new Date() },
    });
}

// Reads events by `id > afterId`. Correctness relies on event ids committing in monotonic
// order, which holds while there is exactly ONE sequential ingest writer. If ingest is ever
// parallelized (multiple writers sharing the `events` id sequence), a higher id could commit
// before a lower one and the projector could skip the late-committing lower id — move to a
// gap-tolerant/watermark cursor before parallelizing ingest.
export async function readEventBatch(db: Database, afterId: number, limit: number): Promise<EventRow[]> {
  return db.select().from(events).where(gt(events.id, afterId)).orderBy(asc(events.id)).limit(limit);
}
