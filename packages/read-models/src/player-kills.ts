import type { Database } from "@onelife/db";
import { kills, players } from "@onelife/db";
import { and, eq, gte, lte, desc } from "drizzle-orm";
import type { KillBasis } from "./qualified.js";

export interface PlayerKill {
  victimGamertag: string;
  weapon: string | null;
  distanceMeters: number | null;
  occurredAt: Date;
  /** `trap_placement`: credited from where a trap was placed; the log names no killer. A renderer
   *  must mark it "by trap" (death-verdict spec 2.4). Counting is identical for both. */
  basis: KillBasis;
}

/** Kills scored by `killerGamertag` on `serverId` within [startedAt, endedAt] (endedAt null = open). Newest first. */
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
  const rows = await db
    .select({
      victimGamertag: kills.victimGamertag,
      weapon: kills.weapon,
      distance: kills.distance,
      occurredAt: kills.occurredAt,
      basis: kills.basis,
    })
    .from(kills)
    .where(
      and(
        eq(kills.serverId, serverId),
        eq(kills.killerPlayerId, p.id),
        gte(kills.occurredAt, startedAt),
        endedAt ? lte(kills.occurredAt, endedAt) : undefined,
      ),
    )
    .orderBy(desc(kills.occurredAt));
  return rows.map((r) => ({
    victimGamertag: r.victimGamertag,
    weapon: r.weapon,
    distanceMeters: r.distance,
    occurredAt: r.occurredAt,
    basis: r.basis === "trap_placement" ? "trap_placement" : "kill_line",
  }));
}
