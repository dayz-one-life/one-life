import type { Database } from "@onelife/db";
import { lives, players, kills } from "@onelife/db";
import { and, or, eq, gt, gte, lt, isNull, exists, notExists, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { QUALIFY_SECONDS } from "./qualified.js";
import { POSTHUMOUS_KILL_GRACE_MS } from "./kill-window.js";

/**
 * A life counts (is "qualified") when it was killed by a player, survived >= 5 min of
 * accumulated (closed-session) playtime, or scored a kill during its window.
 * Correlated on the outer `lives`/`players` rows — the caller must join `players` (by
 * `players.id = lives.playerId`). Exact for dead lives. For alive lives the playtime term
 * uses stored `lives.playtimeSeconds`, which excludes the current open session (documented
 * approximation — see the plan's Global Constraints).
 *
 * ⚠️ The kill window is kill-window.ts's, written in SQL: it runs two seconds past
 * `lives.ended_at`, and a kill inside the PREVIOUS life's two seconds is that life's, not this
 * one's. Keep the two definitions identical — this one decides which deaths get an obituary.
 */
export function qualifiedLifeCondition(db: Database): SQL {
  // A constant, never user input.
  const grace = sql.raw(`interval '${POSTHUMOUS_KILL_GRACE_MS} milliseconds'`);
  const prev = alias(lives, "prev_life");
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
            eq(kills.killerPlayerId, players.id),
            gte(kills.occurredAt, lives.startedAt),
            or(isNull(lives.endedAt), sql`${kills.occurredAt} <= ${lives.endedAt} + ${grace}`),
            notExists(
              db
                .select({ x: sql`1` })
                .from(prev)
                .where(
                  and(
                    eq(prev.serverId, lives.serverId),
                    eq(prev.playerId, lives.playerId),
                    // "Previous" as in previousLifeEnd (kill-window.ts): an earlier start, or
                    // the same start when that life is zero-length and this one is not.
                    or(
                      lt(prev.startedAt, lives.startedAt),
                      and(
                        eq(prev.startedAt, lives.startedAt),
                        eq(prev.endedAt, prev.startedAt),
                        or(isNull(lives.endedAt), gt(lives.endedAt, lives.startedAt)),
                      ),
                    ),
                    sql`${kills.occurredAt} <= ${prev.endedAt} + ${grace}`,
                  ),
                ),
            ),
          ),
        ),
    ),
  )!;
}
