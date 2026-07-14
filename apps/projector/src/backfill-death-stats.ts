import { eq } from "drizzle-orm";
import type { Database } from "@onelife/db";
import { events, rawLines } from "@onelife/db";
import { parseDeath } from "@onelife/adm-parser";

export async function backfillDeathStats(db: Database): Promise<{ patched: number }> {
  const deaths = await db.select().from(events).where(eq(events.type, "player.died"));
  let patched = 0;
  for (const ev of deaths) {
    const payload = ev.payload as Record<string, unknown>;
    if (payload.energy != null || payload.water != null || payload.bleedSources != null) continue; // already enriched
    if (ev.rawLineId == null) continue;
    const raw = (await db.select({ text: rawLines.text }).from(rawLines).where(eq(rawLines.id, ev.rawLineId)))[0];
    if (!raw) continue;
    const d = parseDeath(raw.text);
    if (!d || (d.energy == null && d.water == null && d.bleedSources == null)) continue;
    await db.update(events).set({
      payload: { ...payload, energy: d.energy, water: d.water, bleedSources: d.bleedSources,
        ...(payload.cause === "died" && d.cause !== "died" ? { cause: d.cause } : {}) },
    }).where(eq(events.id, ev.id));
    patched++;
  }
  return { patched };
}

// Runnable entrypoint (mirrors the projector's rebuild entrypoint style).
if (import.meta.url === `file://${process.argv[1]}`) {
  const { getDb } = await import("@onelife/db");
  const { db, sql: end } = getDb(process.env.DATABASE_URL!);
  const { patched } = await backfillDeathStats(db);
  console.log(`[backfill-death-stats] patched ${patched} death events. Now run: corepack pnpm --filter @onelife/projector run rebuild`);
  await end.end();
  process.exit(0);
}
