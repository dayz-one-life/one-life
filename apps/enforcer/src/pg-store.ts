import { and, eq, isNull, isNotNull, ne, gt, or, inArray, sql } from "drizzle-orm";
import { killsByPlayer, killsInLifeWindow, previousLifeEndedAt } from "@onelife/read-models";
import { type Database, lives, players, kills, bans, servers } from "@onelife/db";
import { banNames, type EndedLife, type BanPlan } from "./decide.js";

/** Ended lives with no ban row yet, joined to gamertag + their in-life kills. */
export async function findEndedUnbannedLives(db: Database): Promise<EndedLife[]> {
  const rows = await db
    .select({
      serverId: lives.serverId,
      playerId: lives.playerId,
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
        eq(bans.lifeStartedAt, lives.startedAt),
        // ⚠️ The ban belongs to the player with its dayz id, whatever he is called now: matching by
        // the current gamertag alone made a rename after the ban look like an unbanned death, and
        // the enforcer banned (and notified) it again under the new name. The name decides only
        // when either side has no dayz id.
        or(
          eq(bans.dayzId, players.dayzId),
          and(or(isNull(bans.dayzId), isNull(players.dayzId)), eq(bans.gamertag, players.gamertag)),
        ),
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
    // ⚠️ The kill window is read-models' kill-window.ts: it runs two seconds past the death, and
    // skips a kill that belongs to the previous life's two seconds. decide.ts applies the same
    // rule again to what this returns; narrowing here alone would silently un-ban.
    const previousEnd = await previousLifeEndedAt(db, r.serverId, r.playerId, r.startedAt, r.endedAt);
    const krows = await db
      .select({ occurredAt: kills.occurredAt })
      .from(kills)
      .where(
        and(
          eq(kills.serverId, r.serverId),
          // ⚠️ By player id, not by name (read-models kill-owner.ts): a kill logged under a name
          // the killer has since changed still bans him, and never the name's next holder.
          killsByPlayer(r.playerId, r.gamertag),
          killsInLifeWindow({ startedAt: r.startedAt, endedAt: r.endedAt, previousLifeEndedAt: previousEnd }),
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
      previousLifeEndedAt: previousEnd,
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
 * The names of `ban` that no other real ban on the same server still needs: not dry-run, `pending`
 * or `applied`, not yet due, and sharing a name with it (the dayz id, or the gamertag ignoring
 * case). Only these may be removed from the server's ban list.
 *
 * ⚠️ The server's ban list holds names, not bans: two bans of one player share entries. A late ban
 * (a trap kill written after the death it qualifies, an operator grant) can overlap a later one;
 * removing every name when the earlier one expires or is lifted would let the player back in while
 * the database still says the later ban is applied. Equally, a name only this ban needs must come
 * off: an old gamertag after a rename, or the first player's id when another player now holds the
 * same gamertag.
 */
export async function namesToRemove(db: Database, ban: BanRow, now: Date): Promise<string[]> {
  const sameName = sql`lower(${bans.gamertag}) = lower(${ban.gamertag})`;
  const who = ban.dayzId ? or(eq(bans.dayzId, ban.dayzId), sameName)! : sameName;
  const rows = await db.select({ dayzId: bans.dayzId, gamertag: bans.gamertag }).from(bans).where(and(
    ne(bans.id, ban.id),
    eq(bans.serverId, ban.serverId),
    eq(bans.dryRun, false),
    inArray(bans.status, ["pending", "applied"]),
    // A ban with no expiry never ends, so it keeps its names for good.
    or(isNull(bans.expiresAt), gt(bans.expiresAt, now)),
    who,
  ));
  const kept = new Set(rows.flatMap((r) => banNames(r)).map((x) => x.toLowerCase()));
  return banNames(ban).filter((x) => !kept.has(x.toLowerCase()));
}
