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

/** Among one player's lives on one server: when the life before `life` ended, or null for a
 *  first life.
 *
 *  ⚠️ "Before" is by start, with one extra case. A connect, death and reconnect logged in one
 *  second give a zero-length life and its successor the SAME start. A player's lives do not
 *  overlap, so of two lives sharing a start the earlier one is the zero-length one: it is the
 *  predecessor of the other, and never of itself. Start alone is not enough: with neither life
 *  counted as the other's predecessor, a kill in the zero-length life's two seconds was claimed
 *  by both. Never order by end alone either, or a zero-length life is its own predecessor. The
 *  same rule is written in `previousLifeEndedAt` (kill-window-db.ts) and in
 *  `qualifiedLifeCondition` (qualified-lives.ts); keep the three identical.
 *
 *  Two zero-length lives of one player in the same second cannot be told apart here and would
 *  both claim such a kill. That needs two whole lives inside one logged second. */
export function previousLifeEnd(
  playerLives: readonly { startedAt: Date; endedAt: Date | null }[],
  life: { startedAt: Date; endedAt: Date | null },
): Date | null {
  const s = life.startedAt.getTime();
  const e = life.endedAt ? life.endedAt.getTime() : Infinity;
  let best: Date | null = null;
  for (const l of playerLives) {
    if (!l.endedAt) continue;
    const ls = l.startedAt.getTime();
    if (ls > s) continue;
    // Same start: only a zero-length life precedes, and only a life that is not zero-length.
    if (ls === s && !(l.endedAt.getTime() === ls && e > s)) continue;
    if (!best || l.endedAt.getTime() > best.getTime()) best = l.endedAt;
  }
  return best;
}

/** `previousLifeEnd` for many players at once: index a set of lives, then ask per life, giving
 *  that life's own start and end (null = open). */
export function previousLifeEndLookup(
  all: readonly { serverId: number; playerId: number; startedAt: Date; endedAt: Date | null }[],
): (serverId: number, playerId: number, startedAt: Date, endedAt: Date | null) => Date | null {
  const byPlayer = new Map<string, { startedAt: Date; endedAt: Date | null }[]>();
  for (const l of all) {
    const key = `${l.serverId}:${l.playerId}`;
    const list = byPlayer.get(key);
    if (list) list.push(l); else byPlayer.set(key, [l]);
  }
  return (serverId, playerId, startedAt, endedAt) =>
    previousLifeEnd(byPlayer.get(`${serverId}:${playerId}`) ?? [], { startedAt, endedAt });
}
