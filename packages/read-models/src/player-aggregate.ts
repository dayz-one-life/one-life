import type { Database } from "@onelife/db";
import { servers, players, kills } from "@onelife/db";
import { and, eq, sql } from "drizzle-orm";
import { getPlayerProfile, getPlayerLives, type Profile } from "./queries.js";

export interface PlayerMapStats {
  map: string; slug: string; profile: Profile; kills: number; longestLifeSeconds: number;
}
export interface PlayerAggregate {
  gamertag: string;
  perMap: PlayerMapStats[];
  totals: { lives: number; deaths: number; kills: number; totalPlaytimeSeconds: number; longestLifeSeconds: number; aliveAnywhere: boolean };
}

const slugNorm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Resolve a player-page slug (or a raw gamertag) to the exact stored gamertag.
// Normalizes BOTH sides so it's robust to /players/twhizzle4life AND /players/Twhizzle4life.
// NOTE: slugNorm duplicates apps/web/src/lib/slug.ts playerSlug — kept in sync by hand
// (read-models cannot import from apps/web).
export async function resolveGamertagBySlug(db: Database, input: string): Promise<string | null> {
  const target = slugNorm(input);
  if (!target) return null;
  const rows = await db
    .select({ gamertag: players.gamertag })
    .from(players)
    .where(sql`trim(both '-' from regexp_replace(lower(${players.gamertag}), '[^a-z0-9]+', '-', 'g')) = ${target}`)
    .limit(1);
  return rows[0]?.gamertag ?? null;
}

async function killCount(db: Database, serverId: number, gamertag: string): Promise<number> {
  const r = await db.select({ c: sql<number>`count(*)::int` }).from(kills)
    .where(and(eq(kills.serverId, serverId), eq(kills.killerGamertag, gamertag)));
  return r[0]?.c ?? 0;
}
async function longestLifeSeconds(db: Database, serverId: number, gamertag: string): Promise<number> {
  const qualified = await getPlayerLives(db, serverId, gamertag);
  if (!qualified || qualified.length === 0) return 0;
  return Math.max(0, ...qualified.map((l) => l.playtimeSeconds));
}

export async function getPlayerAcrossServers(db: Database, gamertag: string, now: Date): Promise<PlayerAggregate | null> {
  const real = await resolveGamertagBySlug(db, gamertag);
  if (!real) return null;
  gamertag = real;
  const active = await db.select().from(servers).where(eq(servers.active, true));
  const perMap: PlayerMapStats[] = [];
  for (const s of active) {
    if (!s.slug) continue;
    const profile = await getPlayerProfile(db, s.id, gamertag, now);
    if (!profile) continue;
    const kc = await killCount(db, s.id, gamertag);
    const ll = await longestLifeSeconds(db, s.id, gamertag);
    perMap.push({ map: s.map, slug: s.slug, profile, kills: kc, longestLifeSeconds: ll });
  }
  if (perMap.length === 0) return null;
  const totals = perMap.reduce((acc, m) => ({
    lives: acc.lives + m.profile.lives,
    deaths: acc.deaths + m.profile.deaths,
    kills: acc.kills + m.kills,
    totalPlaytimeSeconds: acc.totalPlaytimeSeconds + m.profile.totalPlaytimeSeconds,
    longestLifeSeconds: Math.max(acc.longestLifeSeconds, m.longestLifeSeconds),
    aliveAnywhere: acc.aliveAnywhere || m.profile.alive,
  }), { lives: 0, deaths: 0, kills: 0, totalPlaytimeSeconds: 0, longestLifeSeconds: 0, aliveAnywhere: false });
  return { gamertag, perMap, totals };
}
