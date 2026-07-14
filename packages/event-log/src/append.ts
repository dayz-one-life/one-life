import type { Database } from "@onelife/db";
import { events } from "@onelife/db";
import type { EventType } from "@onelife/domain";

export type AppendEventInput = {
  serverId: number;
  admFileId: number;
  lineIndex: number;
  subIndex: number;
  type: EventType;
  occurredAt: Date;
  payload: unknown;
  rawLineId?: number;
};

/** Append one event, ignoring duplicates on the (server, file, line, sub) idempotency key. */
export async function appendEvent(db: Database, input: AppendEventInput): Promise<void> {
  await db.insert(events).values({
    serverId: input.serverId,
    admFileId: input.admFileId,
    lineIndex: input.lineIndex,
    subIndex: input.subIndex,
    type: input.type,
    occurredAt: input.occurredAt,
    payload: input.payload as object,
    rawLineId: input.rawLineId,
  }).onConflictDoNothing({
    target: [events.serverId, events.admFileId, events.lineIndex, events.subIndex],
  });
}
