import { isLifeQualified, type QualificationInput } from "@onelife/read-models";

export type EndedLife = {
  serverId: number;
  gamertag: string;
  dayzId: string | null;
  startedAt: Date;
  endedAt: Date;
  deathCause: string | null;
  effectivePlaytimeSeconds: number;
  playerKills: { occurredAt: Date }[];
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
  const s = life.startedAt.getTime();
  const e = life.endedAt.getTime();
  if (life.playerKills.some((k) => { const t = k.occurredAt.getTime(); return t >= s && t <= e; })) {
    return "kill";
  }
  return "playtime";
}

/** Which ended (already-unbanned) lives are qualified and therefore need a ban. Pure. */
export function planBans(lives: EndedLife[], banDurationHours: number): BanPlan[] {
  const plans: BanPlan[] = [];
  for (const life of lives) {
    const input: QualificationInput = {
      deathCause: life.deathCause,
      effectivePlaytimeSeconds: life.effectivePlaytimeSeconds,
      startedAt: life.startedAt,
      windowEnd: life.endedAt,
      playerKills: life.playerKills,
    };
    if (!isLifeQualified(input)) continue;
    plans.push({
      serverId: life.serverId,
      gamertag: life.gamertag,
      dayzId: life.dayzId,
      lifeStartedAt: life.startedAt,
      bannedAt: life.endedAt,
      expiresAt: new Date(life.endedAt.getTime() + banDurationHours * 3600_000),
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
