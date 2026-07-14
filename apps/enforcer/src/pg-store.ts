import { and, eq, isNull, isNotNull, gte, lte } from "drizzle-orm";
import { type Database, lives, players, kills, bans, servers } from "@onelife/db";
import type { EndedLife, BanPlan } from "./decide.js";

/** Ended lives with no ban row yet, joined to gamertag + their in-life kills. */
export async function findEndedUnbannedLives(db: Database): Promise<EndedLife[]> {
  const rows = await db
    .select({
      serverId: lives.serverId,
      gamertag: players.gamertag,
      startedAt: lives.startedAt,
      endedAt: lives.endedAt,
      deathCause: lives.deathCause,
      playtimeSeconds: lives.playtimeSeconds,
    })
    .from(lives)
    .innerJoin(players, eq(players.id, lives.playerId))
    .leftJoin(
      bans,
      and(
        eq(bans.serverId, lives.serverId),
        eq(bans.gamertag, players.gamertag),
        eq(bans.lifeStartedAt, lives.startedAt),
      ),
    )
    .where(and(isNotNull(lives.endedAt), isNull(bans.id)));

  const out: EndedLife[] = [];
  for (const r of rows) {
    if (!r.endedAt) continue;
    const krows = await db
      .select({ occurredAt: kills.occurredAt })
      .from(kills)
      .where(
        and(
          eq(kills.serverId, r.serverId),
          eq(kills.killerGamertag, r.gamertag),
          gte(kills.occurredAt, r.startedAt),
          lte(kills.occurredAt, r.endedAt),
        ),
      );
    out.push({
      serverId: r.serverId,
      gamertag: r.gamertag,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      deathCause: r.deathCause,
      effectivePlaytimeSeconds: r.playtimeSeconds,
      playerKills: krows.map((k) => ({ occurredAt: k.occurredAt })),
    });
  }
  return out;
}

/** Insert a planned ban (idempotent on the durable death key). */
export async function insertBan(db: Database, plan: BanPlan, dryRun: boolean): Promise<void> {
  await db
    .insert(bans)
    .values({
      serverId: plan.serverId,
      gamertag: plan.gamertag,
      lifeStartedAt: plan.lifeStartedAt,
      reason: "qualified_death",
      qualifiedBy: plan.qualifiedBy,
      bannedAt: plan.bannedAt,
      expiresAt: plan.expiresAt,
      status: "pending",
      dryRun,
    })
    .onConflictDoNothing();
}

export type BanRow = { id: number; serverId: number; gamertag: string; expiresAt: Date | null };

export async function pendingBans(db: Database): Promise<BanRow[]> {
  return db
    .select({ id: bans.id, serverId: bans.serverId, gamertag: bans.gamertag, expiresAt: bans.expiresAt })
    .from(bans)
    .where(eq(bans.status, "pending"));
}

export async function appliedBans(db: Database): Promise<BanRow[]> {
  return db
    .select({ id: bans.id, serverId: bans.serverId, gamertag: bans.gamertag, expiresAt: bans.expiresAt })
    .from(bans)
    .where(eq(bans.status, "applied"));
}

export async function markApplied(db: Database, id: number, at: Date): Promise<void> {
  await db.update(bans).set({ status: "applied", appliedAt: at }).where(eq(bans.id, id));
}

/** Keep the ban 'pending' (retried next tick) but record the error. */
export async function markError(db: Database, id: number, err: string): Promise<void> {
  await db.update(bans).set({ lastError: err }).where(eq(bans.id, id));
}

export async function markExpired(db: Database, id: number, at: Date): Promise<void> {
  await db.update(bans).set({ status: "expired", liftedAt: at }).where(eq(bans.id, id));
}

export async function serverServiceId(db: Database, serverId: number): Promise<number> {
  const [s] = await db.select({ sid: servers.nitradoServiceId }).from(servers).where(eq(servers.id, serverId));
  if (!s) throw new Error(`enforcer: no server ${serverId}`);
  return s.sid;
}
