import type { Database } from "@onelife/db";
import { players, lives, servers, kills } from "@onelife/db";
import { and, eq, lt, lte, or, sql } from "drizzle-orm";
import { getPublicDeathsForLives } from "./death-verdicts.js";
import { killWindowEnd } from "./kill-window.js";

export interface PlayerPriors {
  livesLived: number;              // count of PRIOR lives (startedAt < beforeLifeStartedAt); excludes current
  longestLifeSeconds: number;      // best prior life; 0 if none
  totalKills: number;              // every kill before this life, trap kills included (death-verdict spec 2.4)
  /** How many of `totalKills` are credited from a trap the player set (`kills.basis =
   *  'trap_placement'`). The writer is told to count them as kills and never to tell one as a
   *  shooting; the obituary check keeps any count out of the headline and lede when this is above
   *  zero (spec 6.1). */
  trapKills: number;
  /** Most common cause FAMILY across prior deaths, as the lower-case noun of the public tag
   *  ("pvp", "hunger and thirst", "wildlife"); null if none. Definitive and strong verdicts only. */
  usualDeathCause: string | null;
  /** The family of the most recent prior death with a definitive or strong verdict; null if none. */
  lastDeathCause: string | null;
  bestLifeMap: string | null;      // servers.map of the longest prior life; null if none
}

const EMPTY: PlayerPriors = {
  livesLived: 0, longestLifeSeconds: 0, totalKills: 0, trapKills: 0,
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
      id: lives.id,
      serverId: lives.serverId,
      endedAt: lives.endedAt,
      playtimeSeconds: lives.playtimeSeconds,
      deathCause: lives.deathCause,
      deathByGamertag: lives.deathByGamertag,
      deathWeapon: lives.deathWeapon,
      deathDistance: lives.deathDistance,
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

  // ⚠️ Causes come from the stored verdicts (death-verdict spec 2.1, 6.1) and aggregate on the
  // TAG, never on the label: "Killed by A", "Killed by B" and "Killed by C" are one usual cause,
  // and a label can hold a killer's name, which must never reach a prior. Definitive and strong
  // only: an inferred reading is not a fact to build a reputation on, and a pending death has
  // nothing to count yet. The prior prints the tag's lower-case noun.
  const deaths = await getPublicDeathsForLives(db, priorLives.map((l) => ({ ...l, id: Number(l.id) })));
  const familyOf = (id: number): string | null => {
    const d = deaths.get(id);
    if (!d || d.status !== "final" || (d.certainty !== "definitive" && d.certainty !== "strong")) return null;
    return d.tag && d.tag !== "Unknown" ? d.tag.toLowerCase() : null;
  };
  // mode, first-inserted wins on a tie -> oldest life
  const counts = new Map<string, number>();
  for (const l of priorLives) {
    const fam = familyOf(Number(l.id));
    if (fam) counts.set(fam, (counts.get(fam) ?? 0) + 1);
  }
  let usualDeathCause: string | null = null;
  let bestCount = 0;
  for (const [cause, c] of counts) {
    if (c > bestCount) { bestCount = c; usualDeathCause = cause; }
  }

  // last death cause = family of the most-recently ended prior death that has one
  const ended = priorLives.filter((l) => l.endedAt !== null && familyOf(Number(l.id)) !== null);
  ended.sort((a, b) => b.endedAt!.getTime() - a.endedAt!.getTime());
  const lastDeathCause = ended[0] ? familyOf(Number(ended[0].id)) : null;

  // kills across all prior lives = kills scored before the current life began (any server), plus
  // a kill logged inside a prior life's two seconds after its death (kill-window.ts) when the
  // player was already back. That kill is the dead life's: the current life does not count it,
  // so without this it was in neither number. Almost always there is no such life and the
  // condition is the plain "before the current life began". A trap kill is a kill (revision 3):
  // it is in the total, and counted again on its own.
  const stillInGrace = priorLives.filter(
    (l) => l.endedAt !== null && killWindowEnd(l.endedAt).getTime() >= beforeLifeStartedAt.getTime(),
  );
  const kc = await db
    .select({
      c: sql<number>`count(*)::int`,
      t: sql<number>`count(*) FILTER (WHERE ${kills.basis} = 'trap_placement')::int`,
    })
    .from(kills)
    .where(and(
      eq(kills.killerPlayerId, p.id),
      or(
        lt(kills.occurredAt, beforeLifeStartedAt),
        ...stillInGrace.map((l) => and(eq(kills.serverId, l.serverId), lte(kills.occurredAt, killWindowEnd(l.endedAt!)))),
      ),
    ));
  const totalKills = kc[0]?.c ?? 0;
  const trapKills = kc[0]?.t ?? 0;

  return {
    livesLived: priorLives.length,
    longestLifeSeconds,
    totalKills,
    trapKills,
    usualDeathCause,
    lastDeathCause,
    bestLifeMap,
  };
}
