import { and, eq, gte, lte } from "drizzle-orm";
import type { Database } from "@onelife/db";
import { lives, sessions, hitEvents, buildEvents, players } from "@onelife/db";
import { classifyDeath, RECENT_HIT_WINDOW_S, type DeathVerdict } from "@onelife/domain";

// Damage arrives as individual ticks; consecutive same-category hits within this gap are ONE
// encounter (a single fire, a single zombie scrap), so the story counts run-ins, not blows.
const ENCOUNTER_GAP_S = 120;

/** One ordeal category, collapsed from raw hit-ticks into distinct encounters. */
export interface OrdealSummary { encounters: number; hits: number; worstEncounterHits: number }

export interface DossierRecentHit { attackerType: string; attackerLabel: string | null; secondsBeforeDeath: number; victimHp: number | null }
export interface LifeDossier {
  lifeId: number;
  startedAt: Date;
  endedAt: Date | null;
  playtimeSeconds: number;
  sessionCount: number;
  hpLow: number | null;
  ordeals: { infected: OrdealSummary; fire: OrdealSummary; pvp: OrdealSummary; buildsPlaced: number };
  recentHits: DossierRecentHit[];
  death: { mechanism: string | null; energy: number | null; water: number | null; bleedSources: number | null; weapon: string | null };
}

/** The lives-row slice the dossier needs — satisfied structurally by a full lives row. */
export interface DossierLife {
  id: number;
  serverId: number;
  startedAt: Date;
  endedAt: Date | null;
  playtimeSeconds: number;
  deathCause: string | null;
  deathWeapon: string | null;
  energyAtDeath: number | null;
  waterAtDeath: number | null;
  bleedSourcesAtDeath: number | null;
}

/** Collapse time-sorted hit ticks of one category into encounters (gap > ENCOUNTER_GAP_S = new one). */
function summarizeEncounters(times: number[]): OrdealSummary {
  if (times.length === 0) return { encounters: 0, hits: 0, worstEncounterHits: 0 };
  const sorted = [...times].sort((a, b) => a - b);
  let encounters = 1, current = 1, worst = 1;
  for (let i = 1; i < sorted.length; i++) {
    if ((sorted[i]! - sorted[i - 1]!) / 1000 > ENCOUNTER_GAP_S) { encounters++; current = 1; }
    else { current++; }
    if (current > worst) worst = current;
  }
  return { encounters, hits: sorted.length, worstEncounterHits: worst };
}

/** The ordeals + recent-hits fact sheet for a life whose row the caller already holds. */
export async function dossierForLife(db: Database, gamertag: string, life: DossierLife): Promise<LifeDossier> {
  const windowEnd = life.endedAt ?? life.startedAt;
  const sess = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.lifeId, life.id));
  // Filter builds by life FK directly — correct for both open and ended lives.
  const builds = await db.select({ id: buildEvents.id }).from(buildEvents).where(eq(buildEvents.lifeId, life.id));

  // Hits on this player within the life window (hit_events has no life id). Match on the player
  // FK (the identity), not the name, so hits taken under a former gamertag still count; resolve
  // the id once from the caller's gamertag. A miss (no players row) means no hits.
  const p = (await db.select({ id: players.id }).from(players).where(eq(players.gamertag, gamertag)))[0];
  const hits = p ? await db.select({
    attackerType: hitEvents.attackerType, attackerLabel: hitEvents.attackerLabel,
    victimHp: hitEvents.victimHp, occurredAt: hitEvents.occurredAt,
  }).from(hitEvents).where(and(
    eq(hitEvents.serverId, life.serverId), eq(hitEvents.victimPlayerId, p.id),
    gte(hitEvents.occurredAt, life.startedAt), lte(hitEvents.occurredAt, windowEnd),
  )) : [];

  const isFire = (h: { attackerLabel: string | null }) => (h.attackerLabel ?? "").toLowerCase().includes("fire");
  const ms = (h: { occurredAt: Date }) => h.occurredAt.getTime();
  // Fire is checked first (a fire tick is attackerType "environment" but reads as its own ordeal).
  const ordeals = {
    fire: summarizeEncounters(hits.filter(isFire).map(ms)),
    infected: summarizeEncounters(hits.filter((h) => !isFire(h) && h.attackerType === "infected").map(ms)),
    pvp: summarizeEncounters(hits.filter((h) => !isFire(h) && h.attackerType === "player").map(ms)),
    buildsPlaced: builds.length,
  };
  const hps = hits.map((h) => h.victimHp).filter((n): n is number => n != null);
  const hpLow = hps.length ? Math.min(...hps) : null;
  const endMs = windowEnd.getTime();
  const recentHits: DossierRecentHit[] = hits
    // victimHp is carried through so classifyDeath can spot a terminal hit — a fatal fall names
    // itself only here, never on the death line. Dropping it is what made those deaths "unknown".
    .map((h) => ({ attackerType: h.attackerType, attackerLabel: h.attackerLabel, victimHp: h.victimHp, secondsBeforeDeath: Math.round((endMs - h.occurredAt.getTime()) / 1000) }))
    .filter((h) => h.secondsBeforeDeath >= 0 && h.secondsBeforeDeath <= RECENT_HIT_WINDOW_S);

  return {
    lifeId: life.id, startedAt: life.startedAt, endedAt: life.endedAt, playtimeSeconds: life.playtimeSeconds,
    sessionCount: sess.length, hpLow, ordeals, recentHits,
    death: { mechanism: life.deathCause, energy: life.energyAtDeath, water: life.waterAtDeath,
      bleedSources: life.bleedSourcesAtDeath, weapon: life.deathWeapon },
  };
}

/** Fetch-by-id variant: resolves the life + its player's gamertag, then delegates. */
export async function getLifeDossier(db: Database, serverId: number, lifeId: number): Promise<LifeDossier | null> {
  const life = (await db.select().from(lives).where(and(eq(lives.serverId, serverId), eq(lives.id, lifeId))))[0];
  if (!life) return null;
  const player = (await db.select({ gamertag: players.gamertag }).from(players).where(eq(players.id, life.playerId)))[0];
  if (!player) return null;
  return dossierForLife(db, player.gamertag, life);
}

/** The public verdict shape: `basis` is an internal audit detail (raw facts snapshot) that
 *  stays inside `@onelife/domain` — the read-model boundary and everything downstream
 *  (API, newsdesk, web) only ever sees cause/confidence/conditions. */
export type DeathVerdictSummary = Pick<DeathVerdict, "cause" | "confidence" | "conditions">;

/** The classified death verdict for a dossier — pure composition over classifyDeath.
 *  `basis` is stripped here at the read-model boundary; it's an internal audit detail. */
export function dossierVerdict(d: LifeDossier): DeathVerdictSummary {
  const { cause, confidence, conditions } = classifyDeath(
    { mechanism: d.death.mechanism, energy: d.death.energy, water: d.death.water,
      bleedSources: d.death.bleedSources, weapon: d.death.weapon },
    d.recentHits,
  );
  return { cause, confidence, conditions };
}
