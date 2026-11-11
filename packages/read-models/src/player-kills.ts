import type { Database } from "@onelife/db";
import { kills, players } from "@onelife/db";
import { and, eq, desc } from "drizzle-orm";
import { killsInLifeWindow, previousLifeEndedAt } from "./kill-window-db.js";

export interface PlayerKill {
  victimGamertag: string;
  weapon: string | null;
  distanceMeters: number | null;
  occurredAt: Date;
}

/** Kills scored by `killerGamertag` on `serverId` during the life [startedAt, endedAt] (endedAt
 *  null = open). Newest first. The window is kill-window.ts's: a kill logged up to two seconds
 *  after the death is included, and one that belongs to the previous life's two seconds is not. */
export async function getLifeKills(
  db: Database,
  serverId: number,
  killerGamertag: string,
  startedAt: Date,
  endedAt: Date | null,
): Promise<PlayerKill[]> {
  // Match on the player FK (the identity), not the name: a kill scored under a former gamertag
  // still counts. Resolve the id once from the caller's gamertag; a miss means no kills.
  const p = (await db.select({ id: players.id }).from(players).where(eq(players.gamertag, killerGamertag)))[0];
  if (!p) return [];
  const previousEnd = await previousLifeEndedAt(db, serverId, p.id, startedAt);
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
        eq(kills.killerPlayerId, p.id),
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
