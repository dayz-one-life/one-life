import type { Database } from "@onelife/db";
import { kills, lives } from "@onelife/db";
import { and, desc, eq, gt, gte, inArray, isNotNull, lt, lte, or, type SQL } from "drizzle-orm";
import { killWindowEnd, previousLifeEndLookup, type LifeKillWindow } from "./kill-window.js";

/** The `kills.occurred_at` half of "this kill belongs to this life" (kill-window.ts), for a query
 *  that already has the life's bounds as values. The caller still filters server and killer. */
export function killsInLifeWindow(life: LifeKillWindow): SQL | undefined {
  return and(
    gte(kills.occurredAt, life.startedAt),
    life.previousLifeEndedAt ? gt(kills.occurredAt, killWindowEnd(life.previousLifeEndedAt)) : undefined,
    life.endedAt ? lte(kills.occurredAt, killWindowEnd(life.endedAt)) : undefined,
  );
}

/** When this player's life before the one running `startedAt`..`endedAt` (null = open) ended on
 *  this server. Same rule as `previousLifeEnd` (kill-window.ts): an earlier start, or the same
 *  start when that life is zero-length and this one is not. */
export async function previousLifeEndedAt(
  db: Database, serverId: number, playerId: number, startedAt: Date, endedAt: Date | null,
): Promise<Date | null> {
  const notZeroLength = !endedAt || endedAt.getTime() > startedAt.getTime();
  const [row] = await db
    .select({ endedAt: lives.endedAt })
    .from(lives)
    .where(and(
      eq(lives.serverId, serverId), eq(lives.playerId, playerId),
      isNotNull(lives.endedAt),
      or(
        lt(lives.startedAt, startedAt),
        notZeroLength ? and(eq(lives.startedAt, startedAt), eq(lives.endedAt, lives.startedAt)) : undefined,
      ),
    ))
    .orderBy(desc(lives.endedAt))
    .limit(1);
  return row?.endedAt ?? null;
}

/** `previousLifeEndedAt` for a whole board: one query for every ended life on these servers. */
export async function loadPreviousLifeEnds(
  db: Database, serverIds: number[],
): Promise<(serverId: number, playerId: number, startedAt: Date, endedAt: Date | null) => Date | null> {
  if (serverIds.length === 0) return () => null;
  const ended = await db
    .select({ serverId: lives.serverId, playerId: lives.playerId, startedAt: lives.startedAt, endedAt: lives.endedAt })
    .from(lives)
    .where(and(inArray(lives.serverId, serverIds), isNotNull(lives.endedAt)));
  return previousLifeEndLookup(ended);
}
