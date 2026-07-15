import type { Database } from "@onelife/db";
import { kills } from "@onelife/db";
import { and, eq, gte, lte, desc } from "drizzle-orm";

export interface PlayerKill {
  victimGamertag: string;
  weapon: string | null;
  distanceMeters: number | null;
  occurredAt: Date;
}

/** Kills scored by `killerGamertag` on `serverId` within [startedAt, endedAt] (endedAt null = open). Newest first. */
export async function getLifeKills(
  db: Database,
  serverId: number,
  killerGamertag: string,
  startedAt: Date,
  endedAt: Date | null,
): Promise<PlayerKill[]> {
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
        eq(kills.killerGamertag, killerGamertag),
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
  }));
}
