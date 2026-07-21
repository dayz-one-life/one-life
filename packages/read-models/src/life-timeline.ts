import type { Database } from "@onelife/db";
import { players, articles } from "@onelife/db";
import { and, eq, sql } from "drizzle-orm";
import { getLifeDetail } from "./queries.js";
import { getLifeCharacter, type LifeCharacter } from "./character.js";
import { getLifeKills, type PlayerKill } from "./player-kills.js";
import { lifeQualifiedAt, type QualifiedAt } from "./qualified.js";
import { dossierForLife, dossierVerdict, type LifeDossier, type DeathVerdictSummary } from "./life-dossier.js";

export interface LifeTimeline {
  life: NonNullable<Awaited<ReturnType<typeof getLifeDetail>>>["life"];
  sessions: NonNullable<Awaited<ReturnType<typeof getLifeDetail>>>["sessions"];
  character: LifeCharacter | null;
  kills: PlayerKill[];
  qualifiedAt: QualifiedAt | null;
  verdict: DeathVerdictSummary | null; // classified death — null while the life is open
  ordeals: LifeDossier["ordeals"] | null; // null while the life is open (no dossier fetched)
  hpLow: number | null;
  // Player heartbeat — caps an open life's live time-alive accrual (mirrors `livePlaytime` in
  // survivors.ts + the dossier's cap in queries.ts), so a crashed/ghosted player doesn't keep
  // climbing on this page while the board and dossier stop at last-seen.
  lastSeenAt: Date | null;
  /** Slug of this life's published obituary, or null. Published only — a retracted article is a
   *  correction, not the life's obituary, and must never be linked as one. */
  obituarySlug: string | null;
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
  const [character, kills, playerRow, dossier, obituaryRows] = await Promise.all([
    getLifeCharacter(db, serverId, gamertag, life.startedAt, life.endedAt),
    getLifeKills(db, serverId, gamertag, life.startedAt, life.endedAt),
    db.select({ lastSeenAt: players.lastSeenAt }).from(players).where(eq(players.gamertag, gamertag)),
    life.endedAt ? dossierForLife(db, gamertag, life) : Promise.resolve(null),
    db
      .select({ slug: articles.slug })
      .from(articles)
      .where(
        and(
          eq(articles.kind, "obituary"),
          eq(articles.status, "published"),
          eq(articles.serverId, serverId),
          sql`lower(${articles.gamertag}) = lower(${gamertag})`,
          // Identify the life by the rebuild-stable natural key (server_id, gamertag,
          // life_started_at) — matching `articles_kind_server_gamertag_life_uniq`. Never use
          // `life_number`: it is a derived count from projection fold and shifts if the fold
          // changes, while `life_started_at` is frozen at generation time and stays stable.
          eq(articles.lifeStartedAt, life.startedAt),
        ),
      )
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
    life, sessions, character, kills, qualifiedAt,
    verdict: dossier ? dossierVerdict(dossier) : null,
    ordeals: dossier?.ordeals ?? null,
    hpLow: dossier?.hpLow ?? null,
    lastSeenAt: playerRow[0]?.lastSeenAt ?? null,
    obituarySlug: obituaryRows[0]?.slug ?? null,
  };
}
