import type { Database } from "@onelife/db";
import { players, lives, kills, sessions, buildEvents } from "@onelife/db";
import { and, eq, isNull, isNotNull, desc, sql } from "drizzle-orm";
import { livePlaytime, isLifeQualified } from "./qualified.js";

export const LEADERBOARDS = [
  "alive-longest", "alltime-longest", "most-kills", "longest-killstreak",
  "longest-kills",
] as const;
export type Leaderboard = (typeof LEADERBOARDS)[number];
export type LeaderRow = { gamertag: string; value: number; detail?: Record<string, unknown> };

export async function getLeaderboard(db: Database, serverId: number, board: Leaderboard, now: Date, limit: number): Promise<LeaderRow[]> {
  switch (board) {
    // kill-based: a kill implies the killer's life is qualified — inherently over qualified lives
    case "most-kills": {
      const rows = await db.select({ gamertag: kills.killerGamertag, value: sql<number>`count(*)::int` }).from(kills)
        .where(eq(kills.serverId, serverId)).groupBy(kills.killerGamertag).orderBy(desc(sql`count(*)`)).limit(limit);
      return rows.map((r) => ({ gamertag: r.gamertag, value: Number(r.value) }));
    }
    // kill-based: a kill implies the killer's life is qualified — inherently over qualified lives
    case "longest-kills": {
      const rows = await db.select({
        gamertag: kills.killerGamertag, value: kills.distance, victim: kills.victimGamertag, weapon: kills.weapon,
      }).from(kills).where(and(eq(kills.serverId, serverId), isNotNull(kills.distance)))
        .orderBy(desc(kills.distance)).limit(limit);
      return rows.map((r) => ({ gamertag: r.gamertag, value: Number(r.value ?? 0), detail: { victim: r.victim, weapon: r.weapon } }));
    }
    // Qualifies/ranks on stored playtimeSeconds (closed sessions only) — a still-open life that's
    // qualified only via live livePlaytime accrual may be absent here, but it's covered by alive-longest.
    case "alltime-longest": {
      const rows = await db.select({
        gamertag: players.gamertag, startedAt: lives.startedAt, endedAt: lives.endedAt,
        deathCause: lives.deathCause, playtimeSeconds: lives.playtimeSeconds,
      }).from(lives).innerJoin(players, eq(players.id, lives.playerId)).where(eq(lives.serverId, serverId));
      const killRows = await db.select({ gamertag: kills.killerGamertag, occurredAt: kills.occurredAt })
        .from(kills).where(eq(kills.serverId, serverId));
      const byPlayer = new Map<string, number>();
      for (const r of rows) {
        const qualified = isLifeQualified({
          deathCause: r.deathCause, effectivePlaytimeSeconds: r.playtimeSeconds, startedAt: r.startedAt,
          windowEnd: r.endedAt ?? now, playerKills: killRows.filter((k) => k.gamertag === r.gamertag),
        });
        if (!qualified) continue;
        byPlayer.set(r.gamertag, Math.max(byPlayer.get(r.gamertag) ?? 0, r.playtimeSeconds));
      }
      return [...byPlayer.entries()].map(([gamertag, value]) => ({ gamertag, value }))
        .sort((a, b) => b.value - a.value).slice(0, limit);
    }
    case "alive-longest": {
      // open lives; live playtime = stored + open session elapsed
      const rows = await db.select({
        gamertag: players.gamertag, stored: lives.playtimeSeconds, connectedAt: sessions.connectedAt,
        startedAt: lives.startedAt, deathCause: lives.deathCause, lastSeenAt: players.lastSeenAt,
      }).from(lives)
        .innerJoin(players, eq(players.id, lives.playerId))
        .leftJoin(sessions, and(eq(sessions.lifeId, lives.id), isNull(sessions.disconnectedAt)))
        .where(and(eq(lives.serverId, serverId), isNull(lives.endedAt)));
      const killRows = await db.select({ gamertag: kills.killerGamertag, occurredAt: kills.occurredAt })
        .from(kills).where(eq(kills.serverId, serverId));
      return rows
        .map((r) => {
          const upTo = r.lastSeenAt ?? r.connectedAt ?? now;
          const value = livePlaytime(r.stored, r.connectedAt ? { connectedAt: r.connectedAt } : null, upTo);
          const qualified = isLifeQualified({
            deathCause: r.deathCause, effectivePlaytimeSeconds: value, startedAt: r.startedAt, windowEnd: upTo,
            playerKills: killRows.filter((k) => k.gamertag === r.gamertag),
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
      }).from(lives).innerJoin(players, eq(players.id, lives.playerId)).where(eq(lives.serverId, serverId));
      const killRows = await db.select().from(kills).where(and(eq(kills.serverId, serverId), isNotNull(kills.killerPlayerId)));
      const byPlayer = new Map<string, number>();
      for (const life of rows) {
        const end = life.endedAt ? life.endedAt.getTime() : now.getTime();
        const count = killRows.filter((k) =>
          k.killerGamertag === life.gamertag &&
          k.occurredAt.getTime() >= life.startedAt.getTime() && k.occurredAt.getTime() <= end).length;
        byPlayer.set(life.gamertag, Math.max(byPlayer.get(life.gamertag) ?? 0, count));
      }
      return [...byPlayer.entries()].map(([gamertag, value]) => ({ gamertag, value }))
        .filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, limit);
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
