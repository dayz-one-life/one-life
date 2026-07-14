import type { Database } from "@onelife/db";
import { players, lives, sessions, kills } from "@onelife/db";
import { and, eq, isNull, desc } from "drizzle-orm";
import { livePlaytime, isLifeQualified } from "./qualified.js";

export type RosterEntry = { gamertag: string; sessionSeconds: number; lifeSeconds: number };

export async function getRoster(db: Database, serverId: number, now: Date): Promise<RosterEntry[]> {
  const rows = await db.select({
    gamertag: players.gamertag, connectedAt: sessions.connectedAt,
    playtimeSeconds: lives.playtimeSeconds, lastSeenAt: players.lastSeenAt,
  }).from(sessions)
    .innerJoin(players, eq(players.id, sessions.playerId))
    .innerJoin(lives, eq(lives.id, sessions.lifeId))
    .where(and(eq(sessions.serverId, serverId), isNull(sessions.disconnectedAt)));
  return rows.map((r) => {
    const upTo = r.lastSeenAt ?? r.connectedAt;                       // cap at heartbeat (crash-robust)
    const sessionSeconds = Math.max(0, Math.floor((upTo.getTime() - r.connectedAt.getTime()) / 1000));
    return { gamertag: r.gamertag, sessionSeconds, lifeSeconds: livePlaytime(r.playtimeSeconds, { connectedAt: r.connectedAt }, upTo) };
  }).sort((a, b) => b.sessionSeconds - a.sessionSeconds);
}

/** All kill timestamps scored by this gamertag on this server (killer side of qualification). */
async function killTimes(db: Database, serverId: number, gamertag: string): Promise<{ occurredAt: Date }[]> {
  return db.select({ occurredAt: kills.occurredAt }).from(kills)
    .where(and(eq(kills.serverId, serverId), eq(kills.killerGamertag, gamertag)));
}

export type Profile = {
  gamertag: string; lives: number; deaths: number; totalPlaytimeSeconds: number;
  currentLifeSeconds: number; alive: boolean; lastSeenAt: Date | null;
};

export async function getPlayerProfile(db: Database, serverId: number, gamertag: string, now: Date): Promise<Profile | null> {
  const p = (await db.select().from(players).where(eq(players.gamertag, gamertag)))[0];
  if (!p) return null;
  const lifeRows = await db.select().from(lives).where(and(eq(lives.serverId, serverId), eq(lives.playerId, p.id)));
  // players are global; a per-server profile only exists where the player has actually played
  // (i.e. has at least one life on this server) — otherwise every server would show a (mostly
  // empty) profile for any globally-known gamertag.
  if (lifeRows.length === 0) return null;
  const openSession = (await db.select().from(sessions)
    .where(and(eq(sessions.serverId, serverId), eq(sessions.playerId, p.id), isNull(sessions.disconnectedAt))))[0] ?? null;
  const pk = await killTimes(db, serverId, gamertag);
  const upTo = p.lastSeenAt ?? (openSession ? openSession.connectedAt : now);

  const qualified = lifeRows.filter((l) => isLifeQualified({
    deathCause: l.deathCause,
    effectivePlaytimeSeconds: l.endedAt ? l.playtimeSeconds
      : livePlaytime(l.playtimeSeconds, openSession ? { connectedAt: openSession.connectedAt } : null, upTo),
    startedAt: l.startedAt,
    windowEnd: l.endedAt ?? upTo,
    playerKills: pk,
  }));

  const openLife = qualified.find((l) => l.endedAt === null) ?? null;   // qualified current life only
  const total = qualified.reduce((s, l) => s + (l.endedAt ? l.playtimeSeconds
    : livePlaytime(l.playtimeSeconds, openSession ? { connectedAt: openSession.connectedAt } : null, upTo)), 0);
  const currentLifeSeconds = openLife
    ? livePlaytime(openLife.playtimeSeconds, openSession ? { connectedAt: openSession.connectedAt } : null, upTo) : 0;

  return {
    gamertag: p.gamertag, lives: qualified.length, deaths: qualified.filter((l) => l.endedAt !== null).length,
    totalPlaytimeSeconds: total, currentLifeSeconds, alive: openLife !== null, lastSeenAt: p.lastSeenAt,
  };
}

export async function getPlayerLives(db: Database, serverId: number, gamertag: string) {
  const p = (await db.select().from(players).where(eq(players.gamertag, gamertag)))[0];
  if (!p) return null;
  const rows = await db.select().from(lives).where(and(eq(lives.serverId, serverId), eq(lives.playerId, p.id))).orderBy(desc(lives.lifeNumber));
  const openSession = (await db.select().from(sessions)
    .where(and(eq(sessions.serverId, serverId), eq(sessions.playerId, p.id), isNull(sessions.disconnectedAt))))[0] ?? null;
  const pk = await killTimes(db, serverId, gamertag);
  const upTo = p.lastSeenAt ?? (openSession ? openSession.connectedAt : new Date());
  return rows.filter((l) => isLifeQualified({
    deathCause: l.deathCause,
    effectivePlaytimeSeconds: l.endedAt ? l.playtimeSeconds
      : livePlaytime(l.playtimeSeconds, openSession ? { connectedAt: openSession.connectedAt } : null, upTo),
    startedAt: l.startedAt,
    windowEnd: l.endedAt ?? upTo,
    playerKills: pk,
  }));
}

export async function getLifeDetail(db: Database, serverId: number, lifeId: number) {
  const life = (await db.select().from(lives).where(and(eq(lives.serverId, serverId), eq(lives.id, lifeId))))[0];
  if (!life) return null;
  const sess = await db.select().from(sessions).where(and(eq(sessions.serverId, serverId), eq(sessions.lifeId, lifeId))).orderBy(sessions.connectedAt);
  return { life, sessions: sess };
}
