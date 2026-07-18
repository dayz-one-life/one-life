import type { Database } from "@onelife/db";
import { players } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getLifeDetail } from "./queries.js";
import { getLifeCharacter, type LifeCharacter } from "./character.js";
import { getLifeKills, type PlayerKill } from "./player-kills.js";
import { lifeQualifiedAt, type QualifiedAt } from "./qualified.js";
import { dossierForLife, dossierVerdict, type LifeDossier } from "./life-dossier.js";
import type { DeathVerdict } from "@onelife/domain";

export interface LifeTimeline {
  life: NonNullable<Awaited<ReturnType<typeof getLifeDetail>>>["life"];
  sessions: NonNullable<Awaited<ReturnType<typeof getLifeDetail>>>["sessions"];
  character: LifeCharacter | null;
  kills: PlayerKill[];
  qualifiedAt: QualifiedAt | null;
  verdict: DeathVerdict | null;        // classified death — null while the life is open
  ordeals: LifeDossier["ordeals"];
  hpLow: number | null;
}

/** Full per-life timeline data: the life row, ordered sessions, resolved character,
 *  the life's kills (newest-first), and when/why the life qualified. */
export async function getLifeTimeline(
  db: Database,
  serverId: number,
  gamertag: string,
  lifeId: number,
): Promise<LifeTimeline | null> {
  const detail = await getLifeDetail(db, serverId, lifeId);
  if (!detail) return null;
  const { life, sessions } = detail;
  const [character, kills, playerRow, dossier] = await Promise.all([
    getLifeCharacter(db, serverId, gamertag, life.startedAt, life.endedAt),
    getLifeKills(db, serverId, gamertag, life.startedAt, life.endedAt),
    db.select({ lastSeenAt: players.lastSeenAt }).from(players).where(eq(players.gamertag, gamertag)),
    dossierForLife(db, gamertag, life),
  ]);
  const qualifiedAt = lifeQualifiedAt({
    deathCause: life.deathCause,
    startedAt: life.startedAt,
    endedAt: life.endedAt,
    playerKills: kills.map((k) => ({ occurredAt: k.occurredAt })),
    sessions: sessions.map((s) => ({
      connectedAt: s.connectedAt,
      disconnectedAt: s.disconnectedAt,
      durationSeconds: s.durationSeconds,
    })),
    lastSeenAt: playerRow[0]?.lastSeenAt ?? null,
  });
  return {
    life, sessions, character, kills, qualifiedAt,
    verdict: life.endedAt ? dossierVerdict(dossier) : null,
    ordeals: dossier.ordeals,
    hpLow: dossier.hpLow,
  };
}
