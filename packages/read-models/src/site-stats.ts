import type { Database } from "@onelife/db";
import { lives, players } from "@onelife/db";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { qualifiedLifeCondition } from "./qualified-lives.js";
import { getAliveSurvivors } from "./survivors.js";

export type SiteStats = { deaths: number; alive: number };

/**
 * The cold home's ledger numbers. ONE WELL: `deaths` counts ended qualified lives with the same
 * qualification every other surface uses; `alive` IS the survivors board's fleet-wide total
 * (delegated, not re-derived, so the headline and the boards can never disagree).
 *
 * ⚠️ `qualifiedLifeCondition` is legal here ONLY because of the `endedAt IS NOT NULL` clause:
 * `lives.playtime_seconds` advances at session close, so the SQL condition is stale for OPEN
 * lives (why the alive side must go through the derived JS path) but final once a life ended —
 * every session of an ended life is closed.
 *
 * `deaths` deliberately counts ALL servers, including retired ones — a death on a server that
 * later left the fleet is still a death to date. `alive` counts only active, slugged servers,
 * because it delegates to the boards' own definition of alive. Do NOT "fix" either side to match
 * the other; they are answering different questions on purpose.
 *
 * Scaling note: `getAliveSurvivors` here is fleet-wide and loads every kill for every active
 * server. At tens of servers, or once the kills table is large, this wants a time bound or a
 * cached total rather than a live full scan on every cold home load.
 */
export async function getSiteStats(db: Database, now: Date): Promise<SiteStats> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(lives)
    .innerJoin(players, eq(players.id, lives.playerId))
    .where(and(isNotNull(lives.endedAt), qualifiedLifeCondition(db)));

  // pageSize 1: we only want `total`; the single row's avatar lookup is one indexed query.
  const board = await getAliveSurvivors(db, { page: 1, pageSize: 1 }, now);

  return { deaths: row?.n ?? 0, alive: board.total };
}
