import type { Database } from "@onelife/db";
import { rawLines } from "@onelife/db";
import { assignTimestamps, parseLine } from "@onelife/adm-parser";
import { appendEvent } from "@onelife/event-log";
import { and, eq } from "drizzle-orm";
import { mapParsedToEvents } from "./map-events.js";

export type ProcessFileContext = {
  serverId: number;
  admFileId: number;
  content: string;
  cursor: number;
  fallbackDate: Date;
  offsetMs: number;
};

/** Process lines after `cursor`. Writes raw_lines then events. Returns the new cursor (line count). */
export async function processFile(db: Database, ctx: ProcessFileContext): Promise<number> {
  const lines = ctx.content.split(/\r\n|\r|\n/);
  // A trailing line terminator yields a phantom empty final element. Drop exactly one
  // so `total` counts only real lines and the persisted cursor stays aligned as the live
  // file grows between polls — otherwise every newly-appended line is skipped forever.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const total = lines.length;
  let cursor = ctx.cursor;
  if (cursor < 0) cursor = 0;
  if (cursor > total) cursor = total; // file shrank/rotated: never reprocess

  const tsByLine = assignTimestamps(lines, ctx.fallbackDate);

  for (let i = cursor; i < total; i++) {
    const raw = lines[i];
    if (raw === "" || raw == null) continue;

    const localMs = tsByLine[i];
    const occurredAt = localMs != null ? new Date(localMs + ctx.offsetMs) : null;

    // Lossless raw capture first (idempotent on (adm_file_id, line_index)).
    const inserted = await db.insert(rawLines).values({
      serverId: ctx.serverId,
      admFileId: ctx.admFileId,
      lineIndex: i,
      occurredAt,
      text: raw,
    }).onConflictDoNothing({ target: [rawLines.admFileId, rawLines.lineIndex] }).returning({ id: rawLines.id });

    let rawLineId = inserted[0]?.id;
    if (rawLineId == null) {
      const existing = await db.select({ id: rawLines.id }).from(rawLines)
        .where(and(eq(rawLines.admFileId, ctx.admFileId), eq(rawLines.lineIndex, i)));
      rawLineId = existing[0]?.id;
    }

    const parsed = parseLine(raw);
    const mapped = mapParsedToEvents(parsed);
    for (let sub = 0; sub < mapped.length; sub++) {
      const m = mapped[sub]!;
      // server.rebooted uses the boot header's own local time (already in the line);
      // for that event occurredAt may be null from tsByLine, so fall back to fallbackDate+offset.
      const evOccurredAt = occurredAt ?? new Date(ctx.fallbackDate.getTime() + ctx.offsetMs);
      await appendEvent(db, {
        serverId: ctx.serverId,
        admFileId: ctx.admFileId,
        lineIndex: i,
        subIndex: sub,
        type: m.type,
        occurredAt: evOccurredAt,
        payload: m.payload,
        rawLineId,
      });
    }
  }
  return total;
}
