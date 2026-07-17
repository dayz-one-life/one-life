import type { Database } from "@onelife/db";
import { players } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getLifeDetail } from "./queries.js";
import { getLifeCharacter, type LifeCharacter } from "./character.js";
import { getLifeKills, type PlayerKill } from "./player-kills.js";
import { lifeQualifiedAt, type QualifiedAt } from "./qualified.js";

export interface LifeTimeline {
  life: NonNullable<Awaited<ReturnType<typeof getLifeDetail>>>["life"];
  sessions: NonNullable<Awaited<ReturnType<typeof getLifeDetail>>>["sessions"];
  character: LifeCharacter | null;
  kills: PlayerKill[];
  qualifiedAt: QualifiedAt | null;
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
  const [character, kills, playerRow] = await Promise.all([
    getLifeCharacter(db, serverId, gamertag, life.startedAt, life.endedAt),
    getLifeKills(db, serverId, gamertag, life.startedAt, life.endedAt),
    db.select({ lastSeenAt: players.lastSeenAt }).from(players).where(eq(players.gamertag, gamertag)),
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
  return { life, sessions, character, kills, qualifiedAt };
}
