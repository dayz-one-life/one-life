/**
 * Which of a killer's lives a kill belongs to. Pure; the one definition every reader shares.
 *
 * A `kills` row carries the VICTIM's death timestamp. DayZ can write that line a second after the
 * killer's own death line (a grenade already in the air, or two players killing each other with
 * the second line stamped one second late), so a window that stops dead at `lives.ended_at` left
 * such a kill in the killer's career total but in none of his lives.
 *
 * ⚠️ The grace reaches past the END of a life only. It must never hand the same kill to the
 * killer's NEXT life as well: if he was back inside the grace, the kill still belongs to the
 * character that died. Readers pass `previousLifeEndedAt` for that; leaving it out is only safe
 * where the kills were already filtered by a reader that applied it.
 *
 * ⚠️ This is read-time only. `kills.occurred_at` and `lives.ended_at` are stored as logged, so a
 * `--rebuild` writes the same rows it always did and no backfill is ever needed for this rule.
 */
export const POSTHUMOUS_KILL_GRACE_MS = 2_000;

export type LifeKillWindow = {
  startedAt: Date;
  /** null = the life is open: no upper bound. */
  endedAt: Date | null;
  /** When this player's previous life on this server ended (null/omitted = none). */
  previousLifeEndedAt?: Date | null;
};

/** The last instant a kill still counts toward a life that ended at `endedAt`. */
export function killWindowEnd(endedAt: Date): Date {
  return new Date(endedAt.getTime() + POSTHUMOUS_KILL_GRACE_MS);
}

export function isKillInLife(occurredAt: Date, life: LifeKillWindow): boolean {
  const t = occurredAt.getTime();
  if (t < life.startedAt.getTime()) return false;
  if (life.endedAt && t > killWindowEnd(life.endedAt).getTime()) return false;
  // Anything up to the end of the previous life's grace is that life's kill, not this one's.
  if (life.previousLifeEndedAt && t <= killWindowEnd(life.previousLifeEndedAt).getTime()) return false;
  return true;
}

/** Among one player's lives on one server: when the life before the one that started at
 *  `startedAt` ended, or null for a first life. "Before" is by start, never by end, so a life
 *  that began and ended in the same second is not mistaken for its own predecessor. */
export function previousLifeEnd(
  playerLives: readonly { startedAt: Date; endedAt: Date | null }[],
  startedAt: Date,
): Date | null {
  const s = startedAt.getTime();
  let best: Date | null = null;
  for (const l of playerLives) {
    if (!l.endedAt || l.startedAt.getTime() >= s) continue;
    if (!best || l.endedAt.getTime() > best.getTime()) best = l.endedAt;
  }
  return best;
}

/** `previousLifeEnd` for many players at once: index a set of lives, then ask per life. */
export function previousLifeEndLookup(
  all: readonly { serverId: number; playerId: number; startedAt: Date; endedAt: Date | null }[],
): (serverId: number, playerId: number, startedAt: Date) => Date | null {
  const byPlayer = new Map<string, { startedAt: Date; endedAt: Date | null }[]>();
  for (const l of all) {
    const key = `${l.serverId}:${l.playerId}`;
    const list = byPlayer.get(key);
    if (list) list.push(l); else byPlayer.set(key, [l]);
  }
  return (serverId, playerId, startedAt) => previousLifeEnd(byPlayer.get(`${serverId}:${playerId}`) ?? [], startedAt);
}
