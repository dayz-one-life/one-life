import type { Database } from "@onelife/db";
import { lives, players, kills } from "@onelife/db";
import { and, or, eq, gte, lte, isNull, exists, sql, type SQL } from "drizzle-orm";
import { QUALIFY_SECONDS } from "./qualified.js";

/**
 * A life counts (is "qualified") when it was killed by a player, survived >= 5 min of
 * accumulated (closed-session) playtime, or scored a kill during its window.
 * Correlated on the outer `lives`/`players` rows — the caller must join `players` (by
 * `players.id = lives.playerId`). Exact for dead lives. For alive lives the playtime term
 * uses stored `lives.playtimeSeconds`, which excludes the current open session (documented
 * approximation — see the plan's Global Constraints).
 */
export function qualifiedLifeCondition(db: Database): SQL {
  return or(
    eq(lives.deathCause, "pvp"),
    gte(lives.playtimeSeconds, QUALIFY_SECONDS),
    exists(
      db
        .select({ x: sql`1` })
        .from(kills)
        .where(
          and(
            eq(kills.serverId, lives.serverId),
            eq(kills.killerGamertag, players.gamertag),
            gte(kills.occurredAt, lives.startedAt),
            or(isNull(lives.endedAt), lte(kills.occurredAt, lives.endedAt)),
          ),
        ),
    ),
  )!;
}
