import type { Database } from "@onelife/db";
import { players, lives, servers, kills } from "@onelife/db";
import { and, eq, lt, sql } from "drizzle-orm";
import { causeFamily } from "@onelife/domain";

export interface PlayerPriors {
  livesLived: number;              // count of PRIOR lives (startedAt < beforeLifeStartedAt); excludes current
  longestLifeSeconds: number;      // best prior life; 0 if none
  totalKills: number;              // confirmed kills across all prior lives
  usualDeathCause: string | null;  // most-common death cause across prior lives; null if none
                                    // may be a cause-family token (e.g. "animal") since stage 2
  lastDeathCause: string | null;   // cause of most-recent prior death; null if none
  bestLifeMap: string | null;      // servers.map of the longest prior life; null if none
}

const EMPTY: PlayerPriors = {
  livesLived: 0, longestLifeSeconds: 0, totalKills: 0,
  usualDeathCause: null, lastDeathCause: null, bestLifeMap: null,
};

/**
 * The player's reputation before `beforeLifeStartedAt` — every life they lived earlier, on any
 * server (players are one identity per gamertag; lives are per-server). Excludes the current life.
 * A first-lifer (no prior lives) → all zeros/nulls.
 */
export async function getPlayerPriors(
  db: Database,
  gamertag: string,
  beforeLifeStartedAt: Date,
): Promise<PlayerPriors> {
  const p = (await db.select({ id: players.id }).from(players).where(eq(players.gamertag, gamertag)))[0];
  if (!p) return { ...EMPTY };

  // All prior lives across all servers, oldest first (deterministic tie-breaks below).
  const priorLives = await db
    .select({
      endedAt: lives.endedAt,
      playtimeSeconds: lives.playtimeSeconds,
      deathCause: lives.deathCause,
      map: servers.map,
    })
    .from(lives)
    .innerJoin(servers, eq(servers.id, lives.serverId))
    .where(and(eq(lives.playerId, p.id), lt(lives.startedAt, beforeLifeStartedAt)))
    .orderBy(lives.startedAt);

  if (priorLives.length === 0) return { ...EMPTY };

  // longest prior life + its map (first strict-max wins → oldest on a tie)
  let longestLifeSeconds = 0;
  let bestLifeMap: string | null = null;
  for (const l of priorLives) {
    if (l.playtimeSeconds > longestLifeSeconds) {
      longestLifeSeconds = l.playtimeSeconds;
      bestLifeMap = l.map;
    }
  }

  // usual death cause = mode across non-null cause FAMILIES (wolf/bear/animal group as "animal";
  // first-inserted wins on a tie -> oldest life)
  const counts = new Map<string, number>();
  for (const l of priorLives) {
    if (l.deathCause) {
      const fam = causeFamily(l.deathCause);
      counts.set(fam, (counts.get(fam) ?? 0) + 1);
    }
  }
  let usualDeathCause: string | null = null;
  let bestCount = 0;
  for (const [cause, c] of counts) {
    if (c > bestCount) { bestCount = c; usualDeathCause = cause; }
  }

  // last death cause = cause of the most-recently ended prior life
  const ended = priorLives.filter((l) => l.endedAt !== null && l.deathCause !== null);
  ended.sort((a, b) => b.endedAt!.getTime() - a.endedAt!.getTime());
  const lastDeathCause = ended[0]?.deathCause ?? null;

  // confirmed kills across all prior lives = kills scored before the current life began (any server)
  const kc = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(kills)
    .where(and(eq(kills.killerGamertag, gamertag), lt(kills.occurredAt, beforeLifeStartedAt)));
  const totalKills = kc[0]?.c ?? 0;

  return {
    livesLived: priorLives.length,
    longestLifeSeconds,
    totalKills,
    usualDeathCause,
    lastDeathCause,
    bestLifeMap,
  };
}
