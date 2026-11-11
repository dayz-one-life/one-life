import { and, eq, isNull, isNotNull, gte, lte, ne, gt, or, inArray, sql } from "drizzle-orm";
import { type Database, lives, players, kills, bans, servers } from "@onelife/db";
import type { EndedLife, BanPlan } from "./decide.js";

/** Ended lives with no ban row yet, joined to gamertag + their in-life kills. */
export async function findEndedUnbannedLives(db: Database): Promise<EndedLife[]> {
  const rows = await db
    .select({
      serverId: lives.serverId,
      gamertag: players.gamertag,
      dayzId: players.dayzId,
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
    .where(and(isNotNull(lives.endedAt), isNull(bans.id)))
    // Deterministic: bans are inserted in this order, so `bans.id` — and therefore the order
    // pendingBans() applies them to Nitrado — follows it. Without an ORDER BY the join plan
    // decides, and it flips with table statistics, which made the apply-order assertions in
    // apps/enforcer/test/tick.ts pass alone and fail after other suites had touched the tables.
    .orderBy(lives.id);

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
      dayzId: r.dayzId,
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
      dayzId: plan.dayzId,
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

export type BanRow = { id: number; serverId: number; gamertag: string; dayzId: string | null; expiresAt: Date | null };

export async function pendingBans(db: Database): Promise<BanRow[]> {
  return db
    .select({ id: bans.id, serverId: bans.serverId, gamertag: bans.gamertag, dayzId: bans.dayzId, expiresAt: bans.expiresAt })
    .from(bans)
    .where(eq(bans.status, "pending"))
    .orderBy(bans.id);
}

export async function appliedBans(db: Database): Promise<BanRow[]> {
  return db
    .select({ id: bans.id, serverId: bans.serverId, gamertag: bans.gamertag, dayzId: bans.dayzId, expiresAt: bans.expiresAt })
    .from(bans)
    .where(eq(bans.status, "applied"))
    .orderBy(bans.id);
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

/** Bans a token-redemption flagged for removal (was applied to Nitrado). */
export async function liftPendingBans(db: Database): Promise<BanRow[]> {
  return db
    .select({ id: bans.id, serverId: bans.serverId, gamertag: bans.gamertag, dayzId: bans.dayzId, expiresAt: bans.expiresAt })
    .from(bans)
    .where(eq(bans.status, "lift_pending"))
    .orderBy(bans.id);
}

export async function markLifted(db: Database, id: number, at: Date): Promise<void> {
  await db.update(bans).set({ status: "lifted", liftedAt: at }).where(eq(bans.id, id));
}

export async function serverServiceId(db: Database, serverId: number): Promise<number> {
  const [s] = await db.select({ sid: servers.nitradoServiceId }).from(servers).where(eq(servers.id, serverId));
  if (!s) throw new Error(`enforcer: no server ${serverId}`);
  return s.sid;
}

/**
 * Whether another real ban of the same player on the same server is still running: not dry-run,
 * `pending` or `applied`, not yet due, matched by dayz id or by gamertag (ignoring case).
 *
 * ⚠️ The server's ban list holds names, not bans: two bans of one player share one entry. A late
 * ban (a trap kill written after the death it qualifies, an operator grant) can overlap a later
 * one; removing the names when the earlier one expires or is lifted would let the player back in
 * while the database still says the later ban is applied.
 */
export async function hasActiveSibling(db: Database, ban: BanRow, now: Date): Promise<boolean> {
  const sameName = sql`lower(${bans.gamertag}) = lower(${ban.gamertag})`;
  const who = ban.dayzId ? or(eq(bans.dayzId, ban.dayzId), sameName)! : sameName;
  const rows = await db.select({ id: bans.id }).from(bans).where(and(
    ne(bans.id, ban.id),
    eq(bans.serverId, ban.serverId),
    eq(bans.dryRun, false),
    inArray(bans.status, ["pending", "applied"]),
    gt(bans.expiresAt, now),
    who,
  )).limit(1);
  return rows.length > 0;
}
