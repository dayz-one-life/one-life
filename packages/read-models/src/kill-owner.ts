import { kills } from "@onelife/db";
import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm";

/**
 * Whose kill a `kills` row is. The one definition for readers that hold both the player's id and
 * his current gamertag.
 *
 * `kills.killer_player_id` is the killer. `kills.killer_gamertag` is only the name on the kill
 * line: it does not move when the killer renames, and a name he gave up can be taken by someone
 * else. Matching by name lost a renamed killer's kills (so the life they qualified drew no ban and
 * no "counts now" notice, and fell off three boards) and would hand them to the name's next
 * holder.
 *
 * ⚠️ The name is consulted ONLY for a row with no id. The fold leaves the id null when no player
 * held the killer's name at the kill (he had not connected inside the ingested log). Such a row
 * can only be matched by name, ignoring case like every other gamertag lookup, which is what
 * these readers did for every row before. Never widen the fallback to rows that have an id: that
 * is the bug this replaced.
 *
 * Readers that resolve by id alone (`getLifeKills`, `qualifiedLifeCondition`, the survivors
 * board, career counts) have no fallback and do not see an id-less row.
 */
export type KillOwnerFields = { killerPlayerId: number | null; killerGamertag: string };

export function isKillByPlayer(kill: KillOwnerFields, player: { playerId: number; gamertag: string }): boolean {
  // Number(): a bigint column read through raw SQL arrives as a string.
  if (kill.killerPlayerId != null) return Number(kill.killerPlayerId) === Number(player.playerId);
  return kill.killerGamertag.toLowerCase() === player.gamertag.toLowerCase();
}

/** `isKillByPlayer` as a WHERE predicate on `kills`. The caller still filters server and time. */
export function killsByPlayer(playerId: number, gamertag: string): SQL | undefined {
  return or(
    eq(kills.killerPlayerId, playerId),
    and(isNull(kills.killerPlayerId), sql`lower(${kills.killerGamertag}) = lower(${gamertag})`),
  );
}
