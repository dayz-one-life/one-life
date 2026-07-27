import type { Database } from "@onelife/db";
import { players, gamertagLinks, avatars } from "@onelife/db";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getLifeDetail } from "./queries.js";
import { getLifeKills, type PlayerKill } from "./player-kills.js";
import { lifeQualifiedAt, type QualifiedAt } from "./qualified.js";
import { dossierForLife, dossierVerdict, type LifeDossier, type DeathVerdictSummary } from "./life-dossier.js";

export interface LifeTimeline {
  life: NonNullable<Awaited<ReturnType<typeof getLifeDetail>>>["life"];
  sessions: NonNullable<Awaited<ReturnType<typeof getLifeDetail>>>["sessions"];
  kills: PlayerKill[];
  qualifiedAt: QualifiedAt | null;
  verdict: DeathVerdictSummary | null; // classified death — null while the life is open
  ordeals: LifeDossier["ordeals"] | null; // null while the life is open (no dossier fetched)
  hpLow: number | null;
  // Player heartbeat — caps an open life's live time-alive accrual (mirrors `livePlaytime` in
  // survivors.ts + the dossier's cap in queries.ts), so a crashed/ghosted player doesn't keep
  // climbing on this page while the board and dossier stop at last-seen.
  lastSeenAt: Date | null;
  // Only a VERIFIED gamertag link with a LIVE (non-tombstoned) avatar contributes a hash — same
  // predicate as the survivors board's batched join in survivors.ts.
  avatarHash: string | null;
}

/** Full per-life timeline data: the life row, ordered sessions,
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
  const [kills, playerRow, dossier, avatarRow] = await Promise.all([
    getLifeKills(db, serverId, gamertag, life.startedAt, life.endedAt),
    db.select({ lastSeenAt: players.lastSeenAt }).from(players).where(eq(players.gamertag, gamertag)),
    life.endedAt ? dossierForLife(db, gamertag, life) : Promise.resolve(null),
    db
      .select({ hash: avatars.hash })
      .from(gamertagLinks)
      .innerJoin(avatars, and(eq(avatars.userId, gamertagLinks.userId), isNotNull(avatars.image)))
      .where(and(
        eq(gamertagLinks.status, "verified"),
        eq(sql`lower(${gamertagLinks.gamertag})`, gamertag.toLowerCase()),
      ))
      .limit(1),
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
    life, sessions, kills, qualifiedAt,
    verdict: dossier ? dossierVerdict(dossier) : null,
    ordeals: dossier?.ordeals ?? null,
    hpLow: dossier?.hpLow ?? null,
    lastSeenAt: playerRow[0]?.lastSeenAt ?? null,
    avatarHash: avatarRow[0]?.hash ?? null,
  };
}
