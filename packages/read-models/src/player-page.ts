import type { Database } from "@onelife/db";
import { servers, players, lives, sessions, bans, gamertagLinks, kills } from "@onelife/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getPlayerProfile, getPlayerLives } from "./queries.js";
import { getLifeCharacter } from "./character.js";
import { getLifeKills, type PlayerKill } from "./player-kills.js";
import { resolveGamertagBySlug } from "./player-aggregate.js";
import { rosterByClass } from "@onelife/domain";

export interface PlayerCharacter { name: string | null; head: string | null; gender: string | null; }
export interface AliveStanding { lifeId: number; startedAt: Date; timeAliveSeconds: number; kills: number; longestKillMeters: number | null; killList: PlayerKill[]; }
export interface BanStanding { banId: number; bannedAt: Date; expiresAt: Date | null; liftPending: boolean; triggeringLifeNumber: number | null; }
export interface ServerStanding { serverId: number; map: string; slug: string; state: "alive" | "banned" | "idle"; character: PlayerCharacter | null; alive: AliveStanding | null; ban: BanStanding | null; }
export interface PastLife { lifeId: number; serverId: number; map: string; slug: string; lifeNumber: number; startedAt: Date; endedAt: Date; timeAliveSeconds: number; kills: number; longestKillMeters: number | null; character: PlayerCharacter | null; death: { cause: string | null; byGamertag: string | null; weapon: string | null; distanceMeters: number | null }; vitals: { energy: number | null; water: number | null; bleedSources: number | null }; sessions: number; killList: PlayerKill[]; }
export interface PlayerPage { gamertag: string; verified: boolean; firstSeenAt: Date | null; aliveAnywhere: boolean; heroCharacter: PlayerCharacter | null; totals: { kills: number; lives: number; deaths: number; longestLifeSeconds: number }; standing: ServerStanding[]; pastLives: PastLife[]; }

const ACTIVE_BAN_STATUSES = ["applied", "pending", "lift_pending"];

function longest(killList: PlayerKill[]): number | null {
  return killList.reduce<number | null>((m, k) => (k.distanceMeters == null ? m : m === null ? k.distanceMeters : Math.max(m, k.distanceMeters)), null);
}

async function charShape(db: Database, serverId: number, gamertag: string, startedAt: Date, endedAt: Date | null): Promise<PlayerCharacter | null> {
  const lc = await getLifeCharacter(db, serverId, gamertag, startedAt, endedAt);
  const rc = lc?.characterClass ? rosterByClass(lc.characterClass) : null;
  return rc ? { name: rc.name, head: rc.head, gender: rc.gender } : null;
}

export async function getPlayerPage(db: Database, gamertag: string, now: Date): Promise<PlayerPage | null> {
  const real = await resolveGamertagBySlug(db, gamertag);
  if (!real) return null;
  gamertag = real;

  const [p] = await db.select().from(players).where(eq(players.gamertag, gamertag));
  const activeServers = await db.select().from(servers).where(eq(servers.active, true));
  const activeBans = await db.select().from(bans).where(and(eq(bans.gamertag, gamertag), inArray(bans.status, ACTIVE_BAN_STATUSES)));
  const [vf] = await db.select({ id: gamertagLinks.id }).from(gamertagLinks).where(and(eq(gamertagLinks.gamertag, gamertag), eq(gamertagLinks.status, "verified"))).limit(1);

  const standing: ServerStanding[] = [];
  const pastLives: PastLife[] = [];
  const totals = { kills: 0, lives: 0, deaths: 0, longestLifeSeconds: 0 };
  let heroChar: PlayerCharacter | null = null;
  let heroAt = 0;

  for (const s of activeServers) {
    if (!s.slug) continue;
    const livesRows = (await getPlayerLives(db, s.id, gamertag)) ?? [];
    const serverBan = activeBans.find((b) => b.serverId === s.id) ?? null;
    if (livesRows.length === 0 && !serverBan) continue;

    const profile = await getPlayerProfile(db, s.id, gamertag, now);

    // totals
    totals.lives += livesRows.length;
    totals.deaths += livesRows.filter((l) => l.endedAt !== null).length;
    const kcRow = await db.select({ c: sql<number>`count(*)::int` }).from(kills).where(and(eq(kills.serverId, s.id), eq(kills.killerGamertag, gamertag)));
    totals.kills += kcRow[0]?.c ?? 0;
    for (const l of livesRows) {
      const secs = l.endedAt ? l.playtimeSeconds : (profile?.currentLifeSeconds ?? 0);
      if (secs > totals.longestLifeSeconds) totals.longestLifeSeconds = secs;
      if (l.startedAt.getTime() > heroAt) { heroAt = l.startedAt.getTime(); heroChar = await charShape(db, s.id, gamertag, l.startedAt, l.endedAt); }
    }

    // standing
    const openLife = livesRows.find((l) => l.endedAt === null) ?? null;
    let card: ServerStanding;
    if (openLife && profile?.alive) {
      const killList = await getLifeKills(db, s.id, gamertag, openLife.startedAt, null);
      card = { serverId: s.id, map: s.map, slug: s.slug, state: "alive", character: await charShape(db, s.id, gamertag, openLife.startedAt, null), alive: { lifeId: openLife.id, startedAt: openLife.startedAt, timeAliveSeconds: profile.currentLifeSeconds, kills: killList.length, longestKillMeters: longest(killList), killList }, ban: null };
    } else if (serverBan) {
      const trig = livesRows.find((l) => l.startedAt.getTime() === serverBan.lifeStartedAt.getTime()) ?? null;
      card = { serverId: s.id, map: s.map, slug: s.slug, state: "banned", character: trig ? await charShape(db, s.id, gamertag, trig.startedAt, trig.endedAt) : null, alive: null, ban: { banId: serverBan.id, bannedAt: serverBan.bannedAt, expiresAt: serverBan.expiresAt, liftPending: serverBan.status === "lift_pending", triggeringLifeNumber: trig?.lifeNumber ?? null } };
    } else {
      const recent = livesRows[0] ?? null;
      card = { serverId: s.id, map: s.map, slug: s.slug, state: "idle", character: recent ? await charShape(db, s.id, gamertag, recent.startedAt, recent.endedAt) : null, alive: null, ban: null };
    }
    standing.push(card);

    // past lives (ended)
    for (const l of livesRows.filter((r) => r.endedAt !== null)) {
      const killList = await getLifeKills(db, s.id, gamertag, l.startedAt, l.endedAt);
      const scRow = await db.select({ c: sql<number>`count(*)::int` }).from(sessions).where(and(eq(sessions.serverId, s.id), eq(sessions.lifeId, l.id)));
      pastLives.push({ lifeId: l.id, serverId: s.id, map: s.map, slug: s.slug, lifeNumber: l.lifeNumber, startedAt: l.startedAt, endedAt: l.endedAt!, timeAliveSeconds: l.playtimeSeconds, kills: killList.length, longestKillMeters: longest(killList), character: await charShape(db, s.id, gamertag, l.startedAt, l.endedAt), death: { cause: l.deathCause, byGamertag: l.deathByGamertag, weapon: l.deathWeapon, distanceMeters: l.deathDistance }, vitals: { energy: l.energyAtDeath, water: l.waterAtDeath, bleedSources: l.bleedSourcesAtDeath }, sessions: scRow[0]?.c ?? 0, killList });
    }
  }

  if (standing.length === 0 && pastLives.length === 0) return null;
  pastLives.sort((a, b) => b.endedAt.getTime() - a.endedAt.getTime());

  return { gamertag, verified: !!vf, firstSeenAt: p?.firstSeenAt ?? null, aliveAnywhere: standing.some((s) => s.state === "alive"), heroCharacter: heroChar, totals, standing, pastLives };
}
