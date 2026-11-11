import { isLifeQualified, isKillInLife, type QualificationInput } from "@onelife/read-models";

export type EndedLife = {
  serverId: number;
  gamertag: string;
  dayzId: string | null;
  startedAt: Date;
  endedAt: Date;
  deathCause: string | null;
  effectivePlaytimeSeconds: number;
  playerKills: { occurredAt: Date }[];
  /** End of this player's previous life on this server; keeps that life's posthumous kill out of
   *  this one (read-models kill-window.ts). */
  previousLifeEndedAt?: Date | null;
};

export type QualifiedBy = "playtime" | "kill" | "pvp-death";

export type BanPlan = {
  serverId: number;
  gamertag: string;
  dayzId: string | null;
  lifeStartedAt: Date;
  bannedAt: Date;
  expiresAt: Date;
  qualifiedBy: QualifiedBy;
};

/** Why this life qualified — same precedence isLifeQualified evaluates in (pvp > kill > playtime). */
function qualifiedBy(life: EndedLife): QualifiedBy {
  if (life.deathCause === "pvp") return "pvp-death";
  // Same window isLifeQualified uses, two-second grace included, or a life banned for a kill
  // logged just after the death would be recorded as qualified by playtime it never had.
  if (life.playerKills.some((k) => isKillInLife(k.occurredAt, life))) {
    return "kill";
  }
  return "playtime";
}

/**
 * Which ended (already-unbanned) lives are qualified and therefore need a ban. Pure.
 *
 * ⚠️ A death whose ban would already be over at `now` gets NO plan, so no `bans` row. Such a
 * death is found late: the enforcer was down for longer than the ban, or a `kills` row that
 * qualifies an old life only appeared afterwards (a trap kill is written minutes after the death
 * it scores, an operator grant weeks later, a rebuild; the two-second grace in read-models
 * kill-window.ts is what lets a late-stamped kill count). Recording it would add the player to
 * the Nitrado list and remove them in the same tick, which can lift another, still-running ban
 * sharing the same name entry, and the notifier, which windows on `bans.created_at`, would tell
 * them they were banned for a death that may be weeks old. The life simply stays in
 * `findEndedUnbannedLives`, like every unqualified one.
 */
export function planBans(lives: EndedLife[], banDurationHours: number, now: Date): BanPlan[] {
  const plans: BanPlan[] = [];
  for (const life of lives) {
    const expiresAt = new Date(life.endedAt.getTime() + banDurationHours * 3600_000);
    if (expiresAt.getTime() <= now.getTime()) continue; // same instant planExpiries calls due
    const input: QualificationInput = {
      deathCause: life.deathCause,
      effectivePlaytimeSeconds: life.effectivePlaytimeSeconds,
      startedAt: life.startedAt,
      windowEnd: life.endedAt,
      playerKills: life.playerKills,
      previousLifeEndedAt: life.previousLifeEndedAt,
    };
    if (!isLifeQualified(input)) continue;
    plans.push({
      serverId: life.serverId,
      gamertag: life.gamertag,
      dayzId: life.dayzId,
      lifeStartedAt: life.startedAt,
      bannedAt: life.endedAt,
      expiresAt,
      qualifiedBy: qualifiedBy(life),
    });
  }
  return plans;
}

/** Ids of applied bans whose expiry is due at `now`. Pure. */
export function planExpiries(applied: { id: number; expiresAt: Date | null }[], now: Date): number[] {
  return applied
    .filter((b) => b.expiresAt !== null && b.expiresAt.getTime() <= now.getTime())
    .map((b) => b.id);
}

/**
 * What goes on the Nitrado ban list for one ban. Pure.
 *
 * The ID is load-bearing — it is the only entry that survives a gamertag rename, which is
 * the whole point of this feature. The gamertag is belt-and-braces at the cost of one line
 * in a text field. A null/blank id degrades to name-only rather than writing an empty entry,
 * which would otherwise land as a stray blank line in the ban list.
 */
export function banNames(b: { dayzId: string | null; gamertag: string }): string[] {
  return [b.dayzId, b.gamertag]
    .filter((n): n is string => typeof n === "string" && n.trim() !== "")
    .map((n) => n.trim());
}
