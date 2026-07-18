import type { Database } from "@onelife/db";
import { servers, players, lives, sessions, bans, gamertagLinks, kills } from "@onelife/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getPlayerProfile, getPlayerLives } from "./queries.js";
import { getLifeCharacter } from "./character.js";
import { getLifeKills, type PlayerKill } from "./player-kills.js";
import { resolveGamertagBySlug } from "./player-aggregate.js";
import { dossierForLife, dossierVerdict, type DeathVerdictSummary } from "./life-dossier.js";
import { rosterByClass } from "@onelife/domain";

export interface PlayerCharacter { name: string | null; head: string | null; gender: string | null; }
export interface AliveStanding { lifeId: number; lifeNumber: number; startedAt: Date; timeAliveSeconds: number; kills: number; longestKillMeters: number | null; killList: PlayerKill[]; }
export interface BanStanding { banId: number; bannedAt: Date; expiresAt: Date | null; liftPending: boolean; triggeringLifeNumber: number | null; }
export interface ServerStanding { serverId: number; map: string; slug: string; state: "alive" | "banned" | "idle"; character: PlayerCharacter | null; alive: AliveStanding | null; ban: BanStanding | null; }
export interface PastLife { lifeId: number; serverId: number; map: string; slug: string; lifeNumber: number; startedAt: Date; endedAt: Date; timeAliveSeconds: number; kills: number; longestKillMeters: number | null; character: PlayerCharacter | null; death: { cause: string | null; byGamertag: string | null; weapon: string | null; distanceMeters: number | null; verdict: DeathVerdictSummary | null }; vitals: { energy: number | null; water: number | null; bleedSources: number | null }; sessions: number; killList: PlayerKill[]; }
export interface PlayerPage {
  gamertag: string; verified: boolean; firstSeenAt: Date | null; aliveAnywhere: boolean;
  totals: { kills: number; lives: number; deaths: number; longestLifeSeconds: number };
  standing: ServerStanding[];
  pastLives: PastLife[];
  pastLivesTotal: number; pastLivesPage: number; pastLivesPageSize: number;
}

export const PLAYER_PAST_LIVES_PAGE_SIZE = 10;

const ACTIVE_BAN_STATUSES = ["applied", "pending", "lift_pending"];

function longest(killList: PlayerKill[]): number | null {
  return killList.reduce<number | null>((m, k) => (k.distanceMeters == null ? m : m === null ? k.distanceMeters : Math.max(m, k.distanceMeters)), null);
}

async function charShape(db: Database, serverId: number, gamertag: string, startedAt: Date, endedAt: Date | null): Promise<PlayerCharacter | null> {
  const lc = await getLifeCharacter(db, serverId, gamertag, startedAt, endedAt);
  const rc = lc?.characterClass ? rosterByClass(lc.characterClass) : null;
  return rc ? { name: rc.name, head: rc.head, gender: rc.gender } : null;
}

type LifeRow = NonNullable<Awaited<ReturnType<typeof getPlayerLives>>>[number];

export async function getPlayerPage(
  db: Database, gamertag: string, now: Date,
  opts: { page?: number; pageSize?: number } = {},
): Promise<PlayerPage | null> {
  const pageSize = opts.pageSize ?? PLAYER_PAST_LIVES_PAGE_SIZE;
  const reqPage = Math.max(1, Math.trunc(opts.page ?? 1) || 1);

  const real = await resolveGamertagBySlug(db, gamertag);
  if (!real) return null;
  gamertag = real;

  const [p] = await db.select().from(players).where(eq(players.gamertag, gamertag));
  const activeServers = await db.select().from(servers).where(eq(servers.active, true));
  const activeBans = await db.select().from(bans).where(and(eq(bans.gamertag, gamertag), inArray(bans.status, ACTIVE_BAN_STATUSES)));
  const [vf] = await db.select({ id: gamertagLinks.id }).from(gamertagLinks).where(and(eq(gamertagLinks.gamertag, gamertag), eq(gamertagLinks.status, "verified"))).limit(1);

  const standing: ServerStanding[] = [];
  const endedLives: { row: LifeRow; serverId: number; map: string; slug: string }[] = [];
  const totals = { kills: 0, lives: 0, deaths: 0, longestLifeSeconds: 0 };

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
    }

    // standing
    const openLife = livesRows.find((l) => l.endedAt === null) ?? null;
    let card: ServerStanding;
    if (openLife && profile?.alive) {
      const killList = await getLifeKills(db, s.id, gamertag, openLife.startedAt, null);
      card = { serverId: s.id, map: s.map, slug: s.slug, state: "alive", character: await charShape(db, s.id, gamertag, openLife.startedAt, null), alive: { lifeId: openLife.id, lifeNumber: openLife.lifeNumber, startedAt: openLife.startedAt, timeAliveSeconds: profile.currentLifeSeconds, kills: killList.length, longestKillMeters: longest(killList), killList }, ban: null };
    } else if (serverBan) {
      const trig = livesRows.find((l) => l.startedAt.getTime() === serverBan.lifeStartedAt.getTime()) ?? null;
      card = { serverId: s.id, map: s.map, slug: s.slug, state: "banned", character: trig ? await charShape(db, s.id, gamertag, trig.startedAt, trig.endedAt) : null, alive: null, ban: { banId: serverBan.id, bannedAt: serverBan.bannedAt, expiresAt: serverBan.expiresAt, liftPending: serverBan.status === "lift_pending", triggeringLifeNumber: trig?.lifeNumber ?? null } };
    } else {
      const recent = livesRows[0] ?? null;
      card = { serverId: s.id, map: s.map, slug: s.slug, state: "idle", character: recent ? await charShape(db, s.id, gamertag, recent.startedAt, recent.endedAt) : null, alive: null, ban: null };
    }
    standing.push(card);

    // ended lives (lightweight; enriched only for the requested page slice below)
    for (const l of livesRows.filter((r) => r.endedAt !== null)) {
      endedLives.push({ row: l, serverId: s.id, map: s.map, slug: s.slug });
    }
  }

  const total = endedLives.length;
  if (standing.length === 0 && total === 0) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(reqPage, totalPages);
  endedLives.sort((a, b) => b.row.endedAt!.getTime() - a.row.endedAt!.getTime());
  const pageSlice = endedLives.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

  const pastLives: PastLife[] = [];
  for (const { row: l, serverId, map, slug } of pageSlice) {
    const killList = await getLifeKills(db, serverId, gamertag, l.startedAt, l.endedAt);
    const scRow = await db.select({ c: sql<number>`count(*)::int` }).from(sessions).where(and(eq(sessions.serverId, serverId), eq(sessions.lifeId, l.id)));
    const dossier = await dossierForLife(db, gamertag, {
      id: l.id, serverId, startedAt: l.startedAt, endedAt: l.endedAt, playtimeSeconds: l.playtimeSeconds,
      deathCause: l.deathCause, deathWeapon: l.deathWeapon,
      energyAtDeath: l.energyAtDeath, waterAtDeath: l.waterAtDeath, bleedSourcesAtDeath: l.bleedSourcesAtDeath,
    });
    pastLives.push({ lifeId: l.id, serverId, map, slug, lifeNumber: l.lifeNumber, startedAt: l.startedAt, endedAt: l.endedAt!, timeAliveSeconds: l.playtimeSeconds, kills: killList.length, longestKillMeters: longest(killList), character: await charShape(db, serverId, gamertag, l.startedAt, l.endedAt), death: { cause: l.deathCause, byGamertag: l.deathByGamertag, weapon: l.deathWeapon, distanceMeters: l.deathDistance, verdict: dossierVerdict(dossier) }, vitals: { energy: l.energyAtDeath, water: l.waterAtDeath, bleedSources: l.bleedSourcesAtDeath }, sessions: scRow[0]?.c ?? 0, killList });
  }

  return { gamertag, verified: !!vf, firstSeenAt: p?.firstSeenAt ?? null, aliveAnywhere: standing.some((s) => s.state === "alive"), totals, standing, pastLives, pastLivesTotal: total, pastLivesPage: page, pastLivesPageSize: pageSize };
}
