import type { Database } from "@onelife/db";
import { lives } from "@onelife/db";
import { isNotNull, sql } from "drizzle-orm";
import { getAliveSurvivors } from "./survivors.js";

export type SiteStats = { deaths: number; alive: number };

/**
 * The cold home's ledger numbers. `deaths` counts EVERY ended life — qualification is
 * deliberately irrelevant here (changed 2026-07-28 from qualified-only): the headline answers
 * "how many lives have ended on these servers," and a sub-5-minute blip still ended. This is the
 * ONE surface whose count deliberately exceeds the qualified-only record (boards, funeral cards,
 * bans) — do not "reconcile" it back to `qualifiedLifeCondition`, and do not point any
 * qualified-only surface at it.
 *
 * `alive` IS the survivors board's fleet-wide total (delegated, not re-derived, so the headline
 * and the boards can never disagree) — still qualified-only by the boards' own definition.
 *
 * `deaths` counts ALL servers, including retired ones — a death on a server that later left the
 * fleet is still a death to date. `alive` counts only active, slugged servers, because it
 * delegates to the boards' definition. Do NOT "fix" either side to match the other; they are
 * answering different questions on purpose.
 *
 * Scaling note: `getAliveSurvivors` here is fleet-wide and loads every kill for every active
 * server. At tens of servers, or once the kills table is large, this wants a time bound or a
 * cached total rather than a live full scan on every cold home load.
 */
export async function getSiteStats(db: Database, now: Date): Promise<SiteStats> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(lives)
    .where(isNotNull(lives.endedAt));

  // pageSize 1: we only want `total`; the single row's avatar lookup is one indexed query.
  const board = await getAliveSurvivors(db, { page: 1, pageSize: 1 }, now);

  return { deaths: row?.n ?? 0, alive: board.total };
}
