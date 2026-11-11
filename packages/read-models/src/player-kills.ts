import type { Database } from "@onelife/db";
import { kills } from "@onelife/db";
import { and, eq, desc } from "drizzle-orm";
import { killsInLifeWindow, previousLifeEndedAt } from "./kill-window-db.js";

export interface PlayerKill {
  victimGamertag: string;
  weapon: string | null;
  distanceMeters: number | null;
  occurredAt: Date;
}

/** Kills scored by player `playerId` on `serverId` during the life [startedAt, endedAt] (endedAt
 *  null = open). Newest first. The window is kill-window.ts's: a kill logged up to two seconds
 *  after the death is included, and one that belongs to the previous life's two seconds is not.
 *
 *  ⚠️ Takes the player's id, never a gamertag. Pass the `playerId` on the life row whose kills
 *  these are. Two players can hold one name at once (a recycled gamertag whose previous holder
 *  has not reconnected), so a name looked up here could pick the other one and return his kills,
 *  or none, for a life the enforcer and the boards count by id. */
export async function getLifeKills(
  db: Database,
  serverId: number,
  playerId: number,
  startedAt: Date,
  endedAt: Date | null,
): Promise<PlayerKill[]> {
  const previousEnd = await previousLifeEndedAt(db, serverId, playerId, startedAt, endedAt);
  const rows = await db
    .select({
      victimGamertag: kills.victimGamertag,
      weapon: kills.weapon,
      distance: kills.distance,
      occurredAt: kills.occurredAt,
    })
    .from(kills)
    .where(
      and(
        eq(kills.serverId, serverId),
        eq(kills.killerPlayerId, playerId),
        killsInLifeWindow({ startedAt, endedAt, previousLifeEndedAt: previousEnd }),
      ),
    )
    .orderBy(desc(kills.occurredAt));
  return rows.map((r) => ({
    victimGamertag: r.victimGamertag,
    weapon: r.weapon,
    distanceMeters: r.distance,
    occurredAt: r.occurredAt,
  }));
}
