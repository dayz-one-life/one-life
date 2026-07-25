import type { Database } from "@onelife/db";
import { servers, players, lives, sessions, bans, gamertagLinks, kills, playerGamertags } from "@onelife/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getPlayerProfile, getPlayerLives } from "./queries.js";
import { getLifeCharacter } from "./character.js";
import { getLifeKills, type PlayerKill } from "./player-kills.js";
import { resolveGamertagBySlug } from "./player-aggregate.js";
import { dossierForLife, dossierVerdict, type DeathVerdictSummary } from "./life-dossier.js";
import { lifeQualifiedAt, type QualifiedAt } from "./qualified.js";
import { livePlaytime } from "./playtime.js";
import { rosterByClass } from "@onelife/domain";

export interface PlayerCharacter { name: string | null; head: string | null; gender: string | null; }
/**
 * `qualified` refines `state: "alive"`; the state union is deliberately NOT widened to a fourth
 * member. A PROVISIONAL life (inside the five-minute grace window, no kill, no pvp death) is
 * `qualified: false` — before this existed such a life was invisible and the server rendered as
 * `idle`, which is a positive claim that the player has no life there while they are standing on
 * it. `qualifiedAt` is null exactly when `qualified` is false.
 */
export interface AliveStanding { lifeId: number; lifeNumber: number; startedAt: Date; timeAliveSeconds: number; kills: number; longestKillMeters: number | null; killList: PlayerKill[]; qualified: boolean; qualifiedAt: QualifiedAt | null; }
export interface BanStanding { banId: number; bannedAt: Date; expiresAt: Date | null; liftPending: boolean; triggeringLifeNumber: number | null;
  /** The triggering life's death verdict ("mauled", "starvation", …) — the banned row's context
   *  line on the home control panel. Null when the ban cannot be matched to its life. */
  verdict: DeathVerdictSummary | null; }
/**
 * `lastLifeNumber` is NOT "the player's most recent life" despite its name — its meaning is
 * per-`state`:
 *   - `alive`:  the OPEN life's number (same value as `alive.lifeNumber`).
 *   - `banned`: the ban's TRIGGERING life's number, and it is deliberately `null` when that life
 *     could not be identified — it must NEVER fall back to the player's actual most recent life,
 *     or a banned card would link to the wrong life (this is what an earlier fix on this branch
 *     exists to prevent). See `bannedStandingForLifeNumber` in
 *     `apps/web/src/components/controls/format.test.ts` and the `serverCards` fallback chain in
 *     `apps/web/src/components/controls/format.ts`, which must branch on `state` rather than rely
 *     on nullish-coalescing order to preserve this.
 *   - `idle`:   the most recent life's number — here, and only here, does the name match its value.
 * Do not "fix" the banned branch to return the last life just because the field's name suggests
 * it should — that is the exact regression this comment exists to head off.
 */
export interface ServerStanding { serverId: number; map: string; slug: string; state: "alive" | "banned" | "idle"; character: PlayerCharacter | null; alive: AliveStanding | null; ban: BanStanding | null; lastLifeNumber: number | null;
  /** When the most recent QUALIFIED life on this server ended — the idle row's "died 8d ago"
   *  dateline. Null for a never-played server (and for alive/banned rows, which carry their own
   *  timestamps). */
  lastEndedAt: Date | null; }
export interface PastLife { lifeId: number; serverId: number; map: string; slug: string; lifeNumber: number; startedAt: Date; endedAt: Date; timeAliveSeconds: number; kills: number; longestKillMeters: number | null; character: PlayerCharacter | null; death: { cause: string | null; byGamertag: string | null; weapon: string | null; distanceMeters: number | null; verdict: DeathVerdictSummary | null }; vitals: { energy: number | null; water: number | null; bleedSources: number | null }; sessions: number; killList: PlayerKill[]; }
export interface PlayerPage {
  gamertag: string; verified: boolean; firstSeenAt: Date | null; aliveAnywhere: boolean;
  totals: { kills: number; lives: number; deaths: number; longestLifeSeconds: number };
  /** Longest ENDED qualified life, across all servers. `totals.longestLifeSeconds` includes the
   *  open life, so it cannot answer "previous best" while the current run IS the record — this
   *  can (the home hero's "Your longest run yet. Previous best: …"). 0 when no life has ended. */
  previousBestSeconds: number;
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
  const activeBans = await db.select().from(bans).where(and(eq(bans.gamertag, gamertag), inArray(bans.status, ACTIVE_BAN_STATUSES), eq(bans.dryRun, false)));
  // The verified stamp follows IDENTITY, not the current name: after a rename the verified
  // link still names a FORMER callsign while `gamertag` (already resolved to the current one)
  // and the ban rows carry the new one. Match on every name this player has ever held —
  // current label plus alias history — so a raw-string compare can't drop the badge.
  const identityNames = [gamertag.toLowerCase()];
  if (p) {
    const aliasRows = await db.select({ gamertag: playerGamertags.gamertag }).from(playerGamertags).where(eq(playerGamertags.playerId, p.id));
    for (const a of aliasRows) identityNames.push(a.gamertag.toLowerCase());
  }
  const [vf] = await db.select({ id: gamertagLinks.id }).from(gamertagLinks).where(and(inArray(sql`lower(${gamertagLinks.gamertag})`, identityNames), eq(gamertagLinks.status, "verified"))).limit(1);

  const standing: ServerStanding[] = [];
  const endedLives: { row: LifeRow; serverId: number; map: string; slug: string }[] = [];
  const totals = { kills: 0, lives: 0, deaths: 0, longestLifeSeconds: 0 };
  let previousBestSeconds = 0;

  for (const s of activeServers) {
    if (!s.slug) continue;
    const livesRows = (await getPlayerLives(db, s.id, gamertag)) ?? [];
    const serverBan = activeBans.find((b) => b.serverId === s.id) ?? null;

    // ⚠️ ADDITIVE lookup, deliberately separate from `getPlayerLives`. That function is the shared
    // QUALIFIED-lives filter behind the dossier's past-life list, `totals` and `profile`; loosening
    // it would leak provisional lives into a public profile's history and its lives/deaths counts.
    // This row is used for the standing card ONLY and never reaches `totals`.
    const anyOpenLife = p
      ? (await db.select().from(lives)
          .where(and(eq(lives.serverId, s.id), eq(lives.playerId, p.id), sql`${lives.endedAt} is null`))
          .orderBy(sql`${lives.lifeNumber} desc`).limit(1))[0] ?? null
      : null;

    if (livesRows.length === 0 && !serverBan && !anyOpenLife) continue;

    const profile = await getPlayerProfile(db, s.id, gamertag, now);

    // totals
    totals.lives += livesRows.length;
    totals.deaths += livesRows.filter((l) => l.endedAt !== null).length;
    if (p) {
      const kcRow = await db.select({ c: sql<number>`count(*)::int` }).from(kills).where(and(eq(kills.serverId, s.id), eq(kills.killerPlayerId, p.id)));
      totals.kills += kcRow[0]?.c ?? 0;
    }
    for (const l of livesRows) {
      const secs = l.endedAt ? l.playtimeSeconds : (profile?.currentLifeSeconds ?? 0);
      if (secs > totals.longestLifeSeconds) totals.longestLifeSeconds = secs;
      // Ended lives only: the open life must not count as its own "previous best".
      if (l.endedAt && l.playtimeSeconds > previousBestSeconds) previousBestSeconds = l.playtimeSeconds;
    }

    // standing
    const openLife = livesRows.find((l) => l.endedAt === null) ?? null;
    let card: ServerStanding;
    // An active REAL ban outranks a newer open life. When a qualified life dies the enforcer
    // bans the player, but the ban lands on a poll — in the window the player can respawn and
    // play a new life past qualification, so both an active `bans` row AND an open qualified
    // life (`profile.alive`) exist at once. A life ends on DEATH, not on disconnect or ban, so
    // that open life (and `profile.alive`) persists for the whole 24h. If `alive` won here the
    // card would read "Alive" and the self-unban control — which renders only on a `banned`
    // card — would be unreachable for the entire ban (the exact bug this ordering fixes). Ban
    // precedence self-heals: once the ban lifts/expires this falls through to the alive branch.
    if (serverBan) {
      const trig = livesRows.find((l) => l.startedAt.getTime() === serverBan.lifeStartedAt.getTime()) ?? null;
      // The banned row's context line ("mauled · life 7") — one dossier per active ban, and
      // active bans are rare, so this stays off the hot path.
      const trigDossier = trig ? await dossierForLife(db, gamertag, {
        id: trig.id, serverId: s.id, startedAt: trig.startedAt, endedAt: trig.endedAt, playtimeSeconds: trig.playtimeSeconds,
        deathCause: trig.deathCause, deathWeapon: trig.deathWeapon,
        energyAtDeath: trig.energyAtDeath, waterAtDeath: trig.waterAtDeath, bleedSourcesAtDeath: trig.bleedSourcesAtDeath,
      }) : null;
      card = { serverId: s.id, map: s.map, slug: s.slug, state: "banned", character: trig ? await charShape(db, s.id, gamertag, trig.startedAt, trig.endedAt) : null, alive: null, ban: { banId: serverBan.id, bannedAt: serverBan.bannedAt, expiresAt: serverBan.expiresAt, liftPending: serverBan.status === "lift_pending", triggeringLifeNumber: trig?.lifeNumber ?? null, verdict: trigDossier ? dossierVerdict(trigDossier) : null }, lastLifeNumber: trig?.lifeNumber ?? null, lastEndedAt: null };
    } else if (anyOpenLife) {
      // `openLife` (from the qualified-filtered list) being null while `anyOpenLife` is set is
      // exactly the provisional case. `profile.currentLifeSeconds` is 0 there — getPlayerProfile
      // filters the same way — so compute the live duration here instead.
      const isQualified = openLife !== null && profile?.alive === true;
      const killList = await getLifeKills(db, s.id, gamertag, anyOpenLife.startedAt, null);
      const openSession = p
        ? (await db.select().from(sessions)
            .where(and(eq(sessions.serverId, s.id), eq(sessions.playerId, p.id), sql`${sessions.disconnectedAt} is null`)).limit(1))[0] ?? null
        : null;
      // Presence-implying durations cap at `lastSeenAt ?? connectedAt ?? now` and are NEVER
      // clamped to `now` — matching survivors.ts's livePlaytime and queries.ts, which a
      // Math.min(now, ...) would diverge from under servers.clockOffsetMs.
      const upTo = p?.lastSeenAt ?? openSession?.connectedAt ?? now;
      const seconds = isQualified
        ? (profile?.currentLifeSeconds ?? 0)
        : livePlaytime(anyOpenLife.playtimeSeconds, openSession ? { connectedAt: openSession.connectedAt } : null, upTo);
      const sessionRows = await db.select().from(sessions).where(and(eq(sessions.serverId, s.id), eq(sessions.lifeId, anyOpenLife.id)));
      const qAt = lifeQualifiedAt({
        startedAt: anyOpenLife.startedAt,
        endedAt: null,
        deathCause: anyOpenLife.deathCause,
        sessions: sessionRows.map((x) => ({ connectedAt: x.connectedAt, disconnectedAt: x.disconnectedAt, durationSeconds: x.durationSeconds })),
        lastSeenAt: p?.lastSeenAt ?? null,
        playerKills: killList.map((k) => ({ occurredAt: k.occurredAt })),
      });
      card = { serverId: s.id, map: s.map, slug: s.slug, state: "alive", character: await charShape(db, s.id, gamertag, anyOpenLife.startedAt, null), alive: { lifeId: anyOpenLife.id, lifeNumber: anyOpenLife.lifeNumber, startedAt: anyOpenLife.startedAt, timeAliveSeconds: seconds, kills: killList.length, longestKillMeters: longest(killList), killList, qualified: qAt !== null, qualifiedAt: qAt }, ban: null, lastLifeNumber: anyOpenLife.lifeNumber, lastEndedAt: null };
    } else {
      const recent = livesRows[0] ?? null;
      card = { serverId: s.id, map: s.map, slug: s.slug, state: "idle", character: recent ? await charShape(db, s.id, gamertag, recent.startedAt, recent.endedAt) : null, alive: null, ban: null, lastLifeNumber: recent?.lifeNumber ?? null, lastEndedAt: recent?.endedAt ?? null };
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

  return { gamertag, verified: !!vf, firstSeenAt: p?.firstSeenAt ?? null, // A provisional life does NOT count: this feeds the public dossier's `Alive xN` badge and is
  // leaderboard-facing, so a grace-period player is not yet part of it.
  aliveAnywhere: standing.some((s) => s.state === "alive" && s.alive?.qualified === true), totals, previousBestSeconds, standing, pastLives, pastLivesTotal: total, pastLivesPage: page, pastLivesPageSize: pageSize };
}
