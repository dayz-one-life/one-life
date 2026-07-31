import type { Database } from "@onelife/db";
import { players, gamertagLinks, avatars, articles } from "@onelife/db";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getLifeDetail } from "./queries.js";
import { getLifeKills, type PlayerKill } from "./player-kills.js";
import { lifeQualifiedAt, type QualifiedAt } from "./qualified.js";
import { dossierForLife, dossierVerdict, encountersForLife, type LifeDossier, type DeathVerdictSummary, type LifeEncounter } from "./life-dossier.js";

export interface LifeTimeline {
  life: NonNullable<Awaited<ReturnType<typeof getLifeDetail>>>["life"];
  sessions: NonNullable<Awaited<ReturnType<typeof getLifeDetail>>>["sessions"];
  kills: PlayerKill[];
  qualifiedAt: QualifiedAt | null;
  verdict: DeathVerdictSummary | null; // classified death — null while the life is open
  ordeals: LifeDossier["ordeals"] | null; // null while the life is open (no dossier fetched)
  hpLow: number | null;
  // Always present; `[]` when the life took no hits — fetched for open lives too, unlike the
  // dossier (verdict/ordeals/hpLow stay null while a life is open).
  encounters: LifeEncounter[];
  // Player heartbeat — caps an open life's live time-alive accrual (mirrors `livePlaytime` in
  // survivors.ts + the dossier's cap in queries.ts), so a crashed/ghosted player doesn't keep
  // climbing on this page while the board and dossier stop at last-seen.
  lastSeenAt: Date | null;
  // Only a VERIFIED gamertag link with a LIVE (non-tombstoned) avatar contributes a hash — same
  // predicate as the survivors board's batched join in survivors.ts.
  avatarHash: string | null;
  /** Slug of this life's published obituary, or null. Published only — a retracted article is a
   *  correction, not the life's obituary, and must never be linked as one. */
  obituarySlug: string | null;
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
  // Fetched BEFORE the Promise.all below (not inside it) so lastSeenAt can be passed into
  // encountersForLife — an open life's window end is `lastSeenAt ?? now`, and encountersForLife
  // needs that value up front, not resolved in parallel with the query that consumes it.
  const playerRow = await db.select({ lastSeenAt: players.lastSeenAt }).from(players).where(eq(players.gamertag, gamertag));
  const lastSeenAt = playerRow[0]?.lastSeenAt ?? null;
  const [kills, dossier, encounters, avatarRow, obituaryRows] = await Promise.all([
    getLifeKills(db, serverId, gamertag, life.startedAt, life.endedAt),
    life.endedAt ? dossierForLife(db, gamertag, life) : Promise.resolve(null),
    encountersForLife(db, gamertag, life, lastSeenAt),
    db
      .select({ hash: avatars.hash })
      .from(gamertagLinks)
      .innerJoin(avatars, and(eq(avatars.userId, gamertagLinks.userId), isNotNull(avatars.image)))
      .where(and(
        eq(gamertagLinks.status, "verified"),
        eq(sql`lower(${gamertagLinks.gamertag})`, gamertag.toLowerCase()),
      ))
      .limit(1),
    db
      .select({ slug: articles.slug })
      .from(articles)
      .where(
        and(
          eq(articles.kind, "obituary"),
          eq(articles.status, "published"),
          eq(articles.serverId, serverId),
          // `articles.gamertag` is frozen at publish time; a rename since then must not orphan
          // the link. Match through the player's full alias history (player_gamertags — one row
          // per (player_id, lower(gamertag)) this player has ever held) rather than the current
          // gamertag alone.
          sql`lower(${articles.gamertag}) IN (SELECT lower(pg.gamertag) FROM player_gamertags pg WHERE pg.player_id = ${life.playerId})`,
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
    lastSeenAt,
  });
  return {
    life, sessions, kills, qualifiedAt,
    verdict: dossier ? dossierVerdict(dossier) : null,
    ordeals: dossier?.ordeals ?? null,
    hpLow: dossier?.hpLow ?? null,
    encounters,
    lastSeenAt,
    avatarHash: avatarRow[0]?.hash ?? null,
    obituarySlug: obituaryRows[0]?.slug ?? null,
  };
}
