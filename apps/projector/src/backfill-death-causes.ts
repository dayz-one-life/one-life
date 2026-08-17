import { and, eq, gte, isNotNull, lte, notExists, or, sql } from "drizzle-orm";
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
export async function backfillDeathCauses(db: Database): Promise<{ patched: number; recovered: number; unpaired: number; unmapped: Record<string, number> }> {
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
  const { recovered, unpaired } = await recoverMissedDeaths(db);
  return { patched, recovered, unpaired, unmapped };
}

/** ± window for pairing a dropped death line with the companion line DayZ wrote for it. */
const COMPANION_WINDOW_MS = 3_000;

/**
 * Second arm: raw lines the parser NOW reads as a death but which carry no `player.died` event —
 * a death the parser of the day dropped entirely, so no payload of its own exists to patch. The
 * case that forced this: DayZ omits the `(DEAD)` marker on ~12% of `committed suicide` lines, the
 * old DEATH_RE required it, and the line was ingested as a bare position event; only the companion
 * clauseless `died. Stats>` line survived, so the life read "Unknown".
 *
 * ⚠️⚠️ This arm PATCHES THE COMPANION EVENT. It must never append a new one. `events.id` is the
 * fold order, so an event appended today for a historical line folds LAST — after every later
 * event — and `onDied` checks `getOpenLife` BEFORE the already-closed-life branch. It would
 * therefore end the player's CURRENT life and back-date it to the historical death. In production
 * 8 of the 12 recoverable lines belong to players holding an open life right now, and `bans` is
 * durable and never rebuilt, so the damage would outlive any projection rebuild. Patching the
 * companion keeps the correction at the point in the stream where the death already sits.
 *
 * A dropped line with no companion is counted in `unpaired` and left alone — inventing an event is
 * exactly the unsafe operation above. There are none in production today.
 */
async function recoverMissedDeaths(db: Database): Promise<{ recovered: number; unpaired: number }> {
  const candidates = await db.select({
    id: rawLines.id, serverId: rawLines.serverId, occurredAt: rawLines.occurredAt, text: rawLines.text,
  }).from(rawLines).where(and(
    isNotNull(rawLines.occurredAt),
    // Narrow the scan to lines that could possibly be a death; parseDeath is the authority.
    or(
      sql`${rawLines.text} ILIKE '%committed suicide%'`,
      sql`${rawLines.text} ILIKE '%bled out%'`,
      sql`${rawLines.text} ILIKE '%drowned%'`,
      sql`${rawLines.text} ILIKE '%killed by%'`,
      sql`${rawLines.text} ILIKE '%died.%'`,
    ),
    notExists(db.select({ one: sql`1` }).from(events)
      .where(and(eq(events.rawLineId, rawLines.id), eq(events.type, "player.died")))),
  ));

  let recovered = 0;
  let unpaired = 0;
  for (const line of candidates) {
    const d = parseDeath(line.text);
    if (!d) continue;
    if (UPGRADEABLE.has(d.cause)) continue;   // nothing more specific to contribute

    const at = line.occurredAt!.getTime();
    const companions = await db.select().from(events).where(and(
      eq(events.type, "player.died"), eq(events.serverId, line.serverId),
      gte(events.occurredAt, new Date(at - COMPANION_WINDOW_MS)),
      lte(events.occurredAt, new Date(at + COMPANION_WINDOW_MS)),
      sql`lower(${events.payload}->>'victim') = lower(${d.victim})`,
    ));
    // Exactly one, or the pairing is a guess — and a wrong guess rewrites an unrelated death.
    const companion = companions.length === 1 ? companions[0]! : undefined;
    if (!companion) { unpaired++; continue; }

    const payload = companion.payload as Record<string, unknown>;
    if (typeof payload.cause !== "string" || !UPGRADEABLE.has(payload.cause)) continue;

    await db.update(events).set({ payload: { ...payload, cause: d.cause } })
      .where(eq(events.id, companion.id));
    recovered++;
  }
  return { recovered, unpaired };
}


// Runnable entrypoint (mirrors backfill-death-stats).
if (import.meta.url === `file://${process.argv[1]}`) {
  const { getDb } = await import("@onelife/db");
  const { db, sql: end } = getDb(process.env.DATABASE_URL!);
  const { patched, recovered, unpaired, unmapped } = await backfillDeathCauses(db);
  console.log(`[backfill-death-causes] patched ${patched} death events.`);
  console.log(`[backfill-death-causes] recovered ${recovered} dropped deaths onto their companion events.`);
  if (unpaired) {
    console.log(`[backfill-death-causes] ${unpaired} dropped death line(s) had no companion to patch and were LEFT ALONE.`);
    console.log(`  These are not recoverable automatically — an event cannot be appended for them without`);
    console.log(`  corrupting the fold order (see recoverMissedDeaths). Investigate by hand.`);
  }
  const survey = Object.entries(unmapped).sort((a, b) => b[1] - a[1]);
  if (survey.length) {
    console.log(`[backfill-death-causes] unmapped entities (grow the dict from these):`);
    for (const [entity, n] of survey) console.log(`  ${entity}: ${n}`);
  }
  console.log(`Now run: corepack pnpm --filter @onelife/projector run rebuild`);
  await end.end();
  process.exit(0);
}
