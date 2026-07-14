import type { Database } from "@onelife/db";
import { getCursor, setCursor, readEventBatch } from "@onelife/event-log";
import { applyEvent, PayloadError } from "@onelife/projections";
import type { ProjectionEvent } from "@onelife/projections";
import type { EventType } from "@onelife/domain";
import { PgProjectionStore } from "./pg-store.js";

export type TickOpts = { batchSize: number; consumerName?: string; onSkip?: (eventId: number, err: unknown) => void };

export async function projectorTick(db: Database, opts: TickOpts): Promise<{ applied: number; skipped: number }> {
  const consumer = opts.consumerName ?? "projector";
  const cursor = await getCursor(db, consumer);
  const batch = await readEventBatch(db, cursor, opts.batchSize);
  if (batch.length === 0) return { applied: 0, skipped: 0 };

  let applied = 0;
  let skipped = 0;
  await db.transaction(async (tx) => {
    const store = new PgProjectionStore(tx as unknown as Database);
    for (const row of batch) {
      const e: ProjectionEvent = {
        id: row.id, serverId: row.serverId, type: row.type as EventType,
        occurredAt: row.occurredAt, payload: row.payload as Record<string, unknown>,
      };
      try {
        await applyEvent(store, e);
        applied++;
      } catch (err) {
        if (err instanceof PayloadError) { skipped++; opts.onSkip?.(row.id, err); }
        else throw err;   // real DB error → roll back the whole batch, retry next tick
      }
    }
    await setCursor(tx as unknown as Database, consumer, batch[batch.length - 1]!.id);
  });
  return { applied, skipped };
}
