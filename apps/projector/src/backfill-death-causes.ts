import { and, eq, isNotNull, notExists, or, sql } from "drizzle-orm";
import type { Database } from "@onelife/db";
import { events, rawLines } from "@onelife/db";
import { parseDeath } from "@onelife/adm-parser";
import { appendEvent } from "@onelife/event-log";

// Only these stored causes may be upgraded; a specific stored mechanism is never rewritten.
const UPGRADEABLE = new Set(["environment", "died", "unknown"]);

/**
 * Re-derives death causes for historical player.died events from their lossless raw lines using
 * the CURRENT parser (stage-2 entity dict). Upgrade-only + fill-only, idempotent. `unmapped`
 * counts entities that still fall back to "environment" — the survey that grows the entity dict.
 * Follow with a full projection rebuild so lives pick up the patched payloads.
 */
export async function backfillDeathCauses(db: Database): Promise<{ patched: number; recovered: number; unmapped: Record<string, number> }> {
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
  return { patched, recovered: await recoverMissedDeaths(db), unmapped };
}

/**
 * Second arm: raw lines the parser NOW reads as a death but which carry no `player.died` event —
 * a death the parser of the day dropped entirely, so no payload exists to patch. The case that
 * forced this: DayZ omits the `(DEAD)` marker on ~12% of `committed suicide` lines, the old
 * DEATH_RE required it, and the line was ingested as a bare position event; only the companion
 * clauseless `died. Stats>` line survived, so the life read "Unknown".
 *
 * ⚠️ The recovered event is appended at max(subIndex)+1, NOT at the index `parseLine` would now
 * give it. subIndex is that array's position, so re-parsing the line renumbers it — the death
 * would claim subIndex 0, which the position event already holds, and `appendEvent`'s
 * onConflictDoNothing on (server, file, line, sub) would swallow it silently. Idempotent for the
 * same reason it is safe: a second run finds the death event and skips the line.
 *
 * The recovered event sorts LAST in the fold (order is events.id), by which point the life is
 * closed — so it lands on `onDied`'s already-closed branch and upgrades the stored `died` through
 * `enrichLifeDeath`, which matches on exact endedAt equality. Both lines share a timestamp, and
 * the upgrade is upgrade-only, so a rebuild converges to the same result either way.
 */
async function recoverMissedDeaths(db: Database): Promise<number> {
  const candidates = await db.select({
    id: rawLines.id, serverId: rawLines.serverId, admFileId: rawLines.admFileId,
    lineIndex: rawLines.lineIndex, occurredAt: rawLines.occurredAt, text: rawLines.text,
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
  for (const line of candidates) {
    const d = parseDeath(line.text);
    if (!d) continue;
    const [max] = await db.select({ m: sql<number>`COALESCE(MAX(${events.subIndex}), -1)` })
      .from(events).where(and(
        eq(events.serverId, line.serverId), eq(events.admFileId, line.admFileId),
        eq(events.lineIndex, line.lineIndex),
      ));
    const { victim, dayzId, cause, killer, weapon, distance, energy, water, bleedSources, deathEntity } = d;
    await appendEvent(db, {
      serverId: line.serverId, admFileId: line.admFileId, lineIndex: line.lineIndex,
      subIndex: (max?.m ?? -1) + 1, type: "player.died", occurredAt: line.occurredAt!,
      payload: { victim, dayzId, cause, killer, weapon, distance, energy, water, bleedSources, deathEntity },
      rawLineId: line.id,
    });
    recovered++;
  }
  return recovered;
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
