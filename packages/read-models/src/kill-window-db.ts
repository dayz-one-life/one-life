import type { Database } from "@onelife/db";
import { kills, lives } from "@onelife/db";
import { and, desc, eq, gt, gte, inArray, isNotNull, lt, lte, type SQL } from "drizzle-orm";
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

/** When this player's life before the one starting at `startedAt` ended on this server. */
export async function previousLifeEndedAt(
  db: Database, serverId: number, playerId: number, startedAt: Date,
): Promise<Date | null> {
  const [row] = await db
    .select({ endedAt: lives.endedAt })
    .from(lives)
    .where(and(
      eq(lives.serverId, serverId), eq(lives.playerId, playerId),
      lt(lives.startedAt, startedAt), isNotNull(lives.endedAt),
    ))
    .orderBy(desc(lives.endedAt))
    .limit(1);
  return row?.endedAt ?? null;
}

/** `previousLifeEndedAt` for a whole board: one query for every ended life on these servers. */
export async function loadPreviousLifeEnds(
  db: Database, serverIds: number[],
): Promise<(serverId: number, playerId: number, startedAt: Date) => Date | null> {
  if (serverIds.length === 0) return () => null;
  const ended = await db
    .select({ serverId: lives.serverId, playerId: lives.playerId, startedAt: lives.startedAt, endedAt: lives.endedAt })
    .from(lives)
    .where(and(inArray(lives.serverId, serverIds), isNotNull(lives.endedAt)));
  return previousLifeEndLookup(ended);
}
