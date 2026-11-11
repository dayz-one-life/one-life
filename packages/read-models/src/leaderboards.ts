import type { Database } from "@onelife/db";
import { players, lives, kills, sessions, buildEvents } from "@onelife/db";
import { and, eq, isNull, isNotNull, desc, sql } from "drizzle-orm";
import { livePlaytime, isLifeQualified } from "./qualified.js";
import { isKillInLife, previousLifeEndLookup } from "./kill-window.js";
import { loadPreviousLifeEnds } from "./kill-window-db.js";
import { isKillByPlayer } from "./kill-owner.js";

export const LEADERBOARDS = [
  "alive-longest", "alltime-longest", "most-kills", "longest-killstreak",
  "longest-kills",
] as const;
export type Leaderboard = (typeof LEADERBOARDS)[number];
// ⚠️ A row carries no player id. The per-player boards (most-kills, alltime-longest,
// longest-killstreak) are keyed by player, so two players who hold the same gamertag at once
// come back as two rows with the same `gamertag`. Do not key a list by `gamertag` alone.
export type LeaderRow = { gamertag: string; value: number; detail?: Record<string, unknown> };

export async function getLeaderboard(db: Database, serverId: number, board: Leaderboard, now: Date, limit: number): Promise<LeaderRow[]> {
  switch (board) {
    // kill-based: a kill implies the killer's life is qualified — inherently over qualified lives
    case "most-kills": {
      // ⚠️ Counted per PLAYER and printed under his current name (kill-owner.ts). Grouping by
      // `killer_gamertag` split a renamed killer into one row per name he had killed under, each
      // linking to a name that no longer resolved to him. A row with no player id is counted
      // under the name on it: with the player who holds that name now if he is on the board
      // (the most recently seen, as everywhere a name resolves to a player), else on its own.
      const groups = await db.select({
        playerId: kills.killerPlayerId, current: players.gamertag, lastSeenAt: players.lastSeenAt,
        stored: kills.killerGamertag, value: sql<number>`count(*)::int`,
      }).from(kills).leftJoin(players, eq(players.id, kills.killerPlayerId))
        .where(eq(kills.serverId, serverId))
        .groupBy(kills.killerPlayerId, players.gamertag, players.lastSeenAt, kills.killerGamertag);
      const byId = new Map<number, { gamertag: string; value: number; lastSeenAt: Date | null }>();
      for (const g of groups) {
        if (g.playerId == null) continue;
        const row = byId.get(g.playerId) ?? { gamertag: g.current ?? g.stored, value: 0, lastSeenAt: g.lastSeenAt };
        row.value += Number(g.value);
        byId.set(g.playerId, row);
      }
      const byName = new Map<string, { gamertag: string; value: number }>();
      for (const g of groups) {
        if (g.playerId != null) continue;
        const key = g.stored.toLowerCase();
        const holder = [...byId.entries()]
          .filter(([, r]) => r.gamertag.toLowerCase() === key)
          .sort(([aId, a], [bId, b]) => (b.lastSeenAt?.getTime() ?? -Infinity) - (a.lastSeenAt?.getTime() ?? -Infinity) || aId - bId)[0]?.[1];
        const row = holder ?? byName.get(key) ?? { gamertag: g.stored, value: 0 };
        row.value += Number(g.value);
        if (!holder) byName.set(key, row);
      }
      // Level players are ordered by name so the board does not reshuffle between requests.
      return [...byId.values(), ...byName.values()]
        .map(({ gamertag, value }) => ({ gamertag, value }))
        .sort((a, b) => b.value - a.value || (a.gamertag < b.gamertag ? -1 : a.gamertag > b.gamertag ? 1 : 0))
        .slice(0, limit);
    }
    // kill-based: a kill implies the killer's life is qualified — inherently over qualified lives
    case "longest-kills": {
      // Printed under the killer's current name, as most-kills is (kill-owner.ts); a row with no
      // player id keeps the name on it. The id breaks a tie in distance so the order is stable.
      const rows = await db.select({
        current: players.gamertag, stored: kills.killerGamertag, value: kills.distance, victim: kills.victimGamertag, weapon: kills.weapon,
      }).from(kills).leftJoin(players, eq(players.id, kills.killerPlayerId))
        .where(and(eq(kills.serverId, serverId), isNotNull(kills.distance)))
        .orderBy(desc(kills.distance), kills.id).limit(limit);
      return rows.map((r) => ({ gamertag: r.current ?? r.stored, value: Number(r.value ?? 0), detail: { victim: r.victim, weapon: r.weapon } }));
    }
    // Qualifies/ranks on stored playtimeSeconds (closed sessions only) — a still-open life that's
    // qualified only via live livePlaytime accrual may be absent here, but it's covered by alive-longest.
    case "alltime-longest": {
      const rows = await db.select({
        gamertag: players.gamertag, startedAt: lives.startedAt, endedAt: lives.endedAt,
        deathCause: lives.deathCause, playtimeSeconds: lives.playtimeSeconds,
        serverId: lives.serverId, playerId: lives.playerId,
      }).from(lives).innerJoin(players, eq(players.id, lives.playerId)).where(eq(lives.serverId, serverId));
      const previousEnd = previousLifeEndLookup(rows);
      const killRows = await db.select({ killerPlayerId: kills.killerPlayerId, killerGamertag: kills.killerGamertag, occurredAt: kills.occurredAt })
        .from(kills).where(eq(kills.serverId, serverId));
      // Keyed by player id: two players can hold the same name at once (a recycled gamertag).
      const byPlayer = new Map<number, LeaderRow>();
      for (const r of rows) {
        const qualified = isLifeQualified({
          deathCause: r.deathCause, effectivePlaytimeSeconds: r.playtimeSeconds, startedAt: r.startedAt,
          windowEnd: r.endedAt ?? now, playerKills: killRows.filter((k) => isKillByPlayer(k, r)), // kill-owner.ts
          previousLifeEndedAt: previousEnd(r.serverId, r.playerId, r.startedAt, r.endedAt),
        });
        if (!qualified) continue;
        byPlayer.set(r.playerId, { gamertag: r.gamertag, value: Math.max(byPlayer.get(r.playerId)?.value ?? 0, r.playtimeSeconds) });
      }
      return [...byPlayer.values()].sort((a, b) => b.value - a.value).slice(0, limit);
    }
    case "alive-longest": {
      // open lives; live playtime = stored + open session elapsed
      const rows = await db.select({
        gamertag: players.gamertag, stored: lives.playtimeSeconds, connectedAt: sessions.connectedAt,
        startedAt: lives.startedAt, deathCause: lives.deathCause, lastSeenAt: players.lastSeenAt,
        playerId: lives.playerId,
      }).from(lives)
        .innerJoin(players, eq(players.id, lives.playerId))
        .leftJoin(sessions, and(eq(sessions.lifeId, lives.id), isNull(sessions.disconnectedAt)))
        .where(and(eq(lives.serverId, serverId), isNull(lives.endedAt)));
      const killRows = await db.select({ killerPlayerId: kills.killerPlayerId, killerGamertag: kills.killerGamertag, occurredAt: kills.occurredAt })
        .from(kills).where(eq(kills.serverId, serverId));
      const previousEnd = await loadPreviousLifeEnds(db, [serverId]);
      return rows
        .map((r) => {
          const upTo = r.lastSeenAt ?? r.connectedAt ?? now;
          const value = livePlaytime(r.stored, r.connectedAt ? { connectedAt: r.connectedAt } : null, upTo);
          const qualified = isLifeQualified({
            // ⚠️ kill window to now, not the last heartbeat: a trap kill lands while its placer is offline
            deathCause: r.deathCause, effectivePlaytimeSeconds: value, startedAt: r.startedAt, windowEnd: now,
            playerKills: killRows.filter((k) => isKillByPlayer(k, r)), // kill-owner.ts
            previousLifeEndedAt: previousEnd(serverId, r.playerId, r.startedAt, null),
          });
          return { gamertag: r.gamertag, value, qualified };
        })
        .filter((r) => r.qualified)
        .map(({ gamertag, value }) => ({ gamertag, value }))
        .sort((a, b) => b.value - a.value).slice(0, limit);
    }
    // kill-based: a kill implies the killer's life is qualified — inherently over qualified lives
    case "longest-killstreak": {
      // kills that fall inside the killer's own life window, counted per life; max per player.
      const rows = await db.select({
        gamertag: players.gamertag, lifeId: lives.id, startedAt: lives.startedAt, endedAt: lives.endedAt,
        serverId: lives.serverId, playerId: lives.playerId,
      }).from(lives).innerJoin(players, eq(players.id, lives.playerId)).where(eq(lives.serverId, serverId));
      const previousEnd = previousLifeEndLookup(rows);
      const killRows = await db.select().from(kills).where(eq(kills.serverId, serverId));
      // Keyed by player id: two players can hold the same name at once (a recycled gamertag).
      const byPlayer = new Map<number, LeaderRow>();
      for (const life of rows) {
        // kill-window.ts: a kill logged up to two seconds after the death is part of the streak
        // it ended, and is not the first kill of the next life's streak.
        const window = { startedAt: life.startedAt, endedAt: life.endedAt, previousLifeEndedAt: previousEnd(life.serverId, life.playerId, life.startedAt, life.endedAt) };
        const count = killRows.filter((k) =>
          isKillByPlayer(k, life) && isKillInLife(k.occurredAt, window) && // kill-owner.ts
          (life.endedAt !== null || k.occurredAt.getTime() <= now.getTime())).length;
        byPlayer.set(life.playerId, { gamertag: life.gamertag, value: Math.max(byPlayer.get(life.playerId)?.value ?? 0, count) });
      }
      return [...byPlayer.values()].filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, limit);
    }
  }
}

export async function getKillFeed(db: Database, serverId: number, limit: number, offset: number) {
  return db.select().from(kills).where(eq(kills.serverId, serverId)).orderBy(desc(kills.occurredAt)).limit(limit).offset(offset);
}

export async function getBuildFeed(db: Database, serverId: number, opts: { gamertag?: string; limit: number; offset: number }) {
  const where = opts.gamertag
    ? and(eq(buildEvents.serverId, serverId), eq(buildEvents.gamertag, opts.gamertag))
    : eq(buildEvents.serverId, serverId);
  return db.select().from(buildEvents).where(where).orderBy(desc(buildEvents.occurredAt)).limit(opts.limit).offset(opts.offset);
}
