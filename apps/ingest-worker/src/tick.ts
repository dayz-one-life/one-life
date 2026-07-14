import type { Database } from "@onelife/db";
import { admFiles, servers } from "@onelife/db";
import type { AdmFileRef } from "@onelife/nitrado";
import { deriveClockOffsetMs } from "@onelife/adm-parser";
import { and, eq } from "drizzle-orm";
import { processFile } from "./process-file.js";

export type NitradoLike = {
  listAdmFiles(): Promise<AdmFileRef[]>;
  downloadFile(path: string): Promise<string>;
};

export type TickDeps = { serverId: number; client: NitradoLike; backfillBudget: number };

/** One ingestion tick for one server. Backfill oldest-first up to budget; live file last. */
export async function ingestTick(db: Database, deps: TickDeps): Promise<void> {
  const { serverId, client, backfillBudget } = deps;
  const files = await client.listAdmFiles(); // oldest-first
  if (files.length === 0) return;

  // Nitrado sometimes omits modified_at, which the client coerces to 0. Since
  // deriveClockOffsetMs picks the MINIMUM (modifiedAtMs - localTimestampMs) candidate, a
  // 0 modifiedAtMs would produce a huge negative offset that wins and corrupts every
  // timestamp by decades — so exclude files with a non-positive modifiedAtMs.
  const clockCandidates = files
    .filter((f) => f.localTimestampMs != null && f.modifiedAtMs > 0)
    .map((f) => ({ localTimestampMs: f.localTimestampMs as number, modifiedAtMs: f.modifiedAtMs }));

  let offsetMs: number;
  if (clockCandidates.length > 0) {
    offsetMs = deriveClockOffsetMs(clockCandidates);
    await db.update(servers).set({ clockOffsetMs: offsetMs }).where(eq(servers.id, serverId));
  } else {
    // No valid candidates this tick (e.g. Nitrado omitted modified_at for every file) — reuse
    // the previously-stored offset instead of letting deriveClockOffsetMs's empty-input
    // fallback of 0 overwrite a good, previously-derived offset.
    const [srv] = await db.select().from(servers).where(eq(servers.id, serverId));
    offsetMs = srv?.clockOffsetMs ?? 0;
  }

  const newestPath = files[files.length - 1]!.path;
  let budget = backfillBudget;
  let allCaughtUp = true;

  for (const file of files) {
    const isNewest = file.path === newestPath;
    const rows = await db.select().from(admFiles)
      .where(and(eq(admFiles.serverId, serverId), eq(admFiles.path, file.path)));
    const row = rows[0];

    if (row?.isComplete && !isNewest) continue;

    if (!isNewest) {
      if (budget <= 0) { allCaughtUp = false; continue; }
      budget--;
    } else if (!allCaughtUp) {
      // Don't advance to the live file while older files are still pending — ordering matters.
      continue;
    }

    let content: string;
    try {
      content = await client.downloadFile(file.path);
    } catch {
      allCaughtUp = false;
      continue;
    }

    // Ensure the adm_files row exists so we have an id to scope raw_lines/events.
    const admFileId = row?.id ?? (await db.insert(admFiles).values({
      serverId, path: file.path, name: file.name,
      logDate: file.localTimestampMs != null ? new Date(file.localTimestampMs) : null,
    }).returning({ id: admFiles.id }))[0]!.id;

    const cursor = row?.lastProcessedLine ?? 0;
    const fallbackDate = file.localTimestampMs != null ? new Date(file.localTimestampMs) : new Date();
    const newCursor = await processFile(db, { serverId, admFileId, content, cursor, fallbackDate, offsetMs });

    await db.update(admFiles).set({
      name: file.name,
      logDate: file.localTimestampMs != null ? new Date(file.localTimestampMs) : null,
      lastProcessedLine: newCursor,
      isComplete: !isNewest,
      lastPulledAt: new Date(),
    }).where(eq(admFiles.id, admFileId));
  }
}
