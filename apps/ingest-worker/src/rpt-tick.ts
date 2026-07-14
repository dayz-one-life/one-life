import { and, eq } from "drizzle-orm";
import { type Database, rptFiles, servers } from "@onelife/db";
import type { AdmFileRef } from "@onelife/nitrado";
import { processRptContent } from "./rpt-process-file.js";

export type RptNitradoLike = {
  listRptFiles(): Promise<AdmFileRef[]>;
  downloadFile(path: string): Promise<string>;
};

export type RptTickDeps = { serverId: number; client: RptNitradoLike; charStaleHours: number; now?: Date };

/**
 * One RPT ingest pass. Uses the clock offset the ADM tick already derived. Reprocesses the live
 * (latest) file each tick — sightings are idempotent by (server, file, line) — and marks rotated
 * older files complete after processing them once.
 */
export async function rptTick(db: Database, deps: RptTickDeps): Promise<{ files: number; sightings: number }> {
  const files = await deps.client.listRptFiles(); // oldest-first
  if (files.length === 0) return { files: 0, sightings: 0 };

  const [srv] = await db.select().from(servers).where(eq(servers.id, deps.serverId));
  const offsetMs = srv?.clockOffsetMs ?? 0;
  const now = deps.now ?? new Date();
  let sightings = 0;

  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    const isLatest = i === files.length - 1;

    await db
      .insert(rptFiles)
      .values({ serverId: deps.serverId, path: f.path, name: f.name, logDate: f.localTimestampMs ? new Date(f.localTimestampMs) : null })
      .onConflictDoNothing({ target: [rptFiles.serverId, rptFiles.path] });
    const [row] = await db.select().from(rptFiles).where(and(eq(rptFiles.serverId, deps.serverId), eq(rptFiles.path, f.path)));
    if (!row || row.isComplete) continue;

    const content = await deps.client.downloadFile(f.path);
    const r = await processRptContent(db, { serverId: deps.serverId, rptFileId: row.id, content, offsetMs, charStaleHours: deps.charStaleHours });
    sightings += r.sightings;

    await db.update(rptFiles).set({ lastPulledAt: now, isComplete: !isLatest }).where(eq(rptFiles.id, row.id));
  }

  return { files: files.length, sightings };
}
