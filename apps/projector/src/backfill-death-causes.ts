import { eq } from "drizzle-orm";
import type { Database } from "@onelife/db";
import { events, rawLines } from "@onelife/db";
import { parseDeath } from "@onelife/adm-parser";

// Only these stored causes may be upgraded; a specific stored mechanism is never rewritten.
const UPGRADEABLE = new Set(["environment", "died", "unknown"]);

/**
 * Re-derives death causes for historical player.died events from their lossless raw lines using
 * the CURRENT parser (stage-2 entity dict). Upgrade-only + fill-only, idempotent. `unmapped`
 * counts entities that still fall back to "environment" — the survey that grows the entity dict.
 * Follow with a full projection rebuild so lives pick up the patched payloads.
 */
export async function backfillDeathCauses(db: Database): Promise<{ patched: number; unmapped: Record<string, number> }> {
  const deaths = await db.select().from(events).where(eq(events.type, "player.died"));
  let patched = 0;
  const unmapped: Record<string, number> = {};
  for (const ev of deaths) {
    const payload = ev.payload as Record<string, unknown>;
    if (ev.rawLineId == null) continue;
    const raw = (await db.select({ text: rawLines.text }).from(rawLines).where(eq(rawLines.id, ev.rawLineId)))[0];
    if (!raw) continue;
    const d = parseDeath(raw.text);
    if (!d) continue;

    if (d.deathEntity && d.cause === "environment") {
      unmapped[d.deathEntity] = (unmapped[d.deathEntity] ?? 0) + 1;
    }

    const upgradeCause =
      typeof payload.cause === "string" && UPGRADEABLE.has(payload.cause) &&
      d.cause !== payload.cause && !UPGRADEABLE.has(d.cause) && d.cause !== "died" && d.cause !== "unknown";
    const addEntity = d.deathEntity != null && payload.deathEntity == null;
    if (!upgradeCause && !addEntity) continue;

    await db.update(events).set({
      payload: { ...payload,
        ...(addEntity ? { deathEntity: d.deathEntity } : {}),
        ...(upgradeCause ? { cause: d.cause } : {}) },
    }).where(eq(events.id, ev.id));
    patched++;
  }
  return { patched, unmapped };
}

// Runnable entrypoint (mirrors backfill-death-stats).
if (import.meta.url === `file://${process.argv[1]}`) {
  const { getDb } = await import("@onelife/db");
  const { db, sql: end } = getDb(process.env.DATABASE_URL!);
  const { patched, unmapped } = await backfillDeathCauses(db);
  console.log(`[backfill-death-causes] patched ${patched} death events.`);
  const survey = Object.entries(unmapped).sort((a, b) => b[1] - a[1]);
  if (survey.length) {
    console.log(`[backfill-death-causes] unmapped entities (grow the dict from these):`);
    for (const [entity, n] of survey) console.log(`  ${entity}: ${n}`);
  }
  console.log(`Now run: corepack pnpm --filter @onelife/projector run rebuild`);
  await end.end();
  process.exit(0);
}
