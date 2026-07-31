import { and, eq, gte, lte } from "drizzle-orm";
import type { Database } from "@onelife/db";
import { lives, sessions, hitEvents, buildEvents, players, unconsciousEvents } from "@onelife/db";
import { classifyDeath, classifyEntityLabel, RECENT_HIT_WINDOW_S, type DeathVerdict } from "@onelife/domain";

// Damage arrives as individual ticks; consecutive same-category hits within this gap are ONE
// encounter (a single fire, a single zombie scrap), so the story counts run-ins, not blows.
const ENCOUNTER_GAP_S = 120;

/** One ordeal category, collapsed from raw hit-ticks into distinct encounters. */
export interface OrdealSummary { encounters: number; hits: number; worstEncounterHits: number }

export interface DossierRecentHit { attackerType: string; attackerLabel: string | null; secondsBeforeDeath: number; victimHp: number | null }
export interface DossierUnconscious { secondsBeforeDeath: number; disconnecting: boolean }
export interface LifeDossier {
  lifeId: number;
  startedAt: Date;
  endedAt: Date | null;
  playtimeSeconds: number;
  sessionCount: number;
  hpLow: number | null;
  ordeals: { infected: OrdealSummary; fire: OrdealSummary; pvp: OrdealSummary; buildsPlaced: number };
  recentHits: DossierRecentHit[];
  recentUnconscious: DossierUnconscious[];
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

  // Knockouts in the life window. Same bounds and same player-id resolution as `hits` —
  // the evidence that an infected mauling turned lethal when bleeding has already closed.
  const knockouts = p ? await db.select({
    disconnecting: unconsciousEvents.disconnecting, occurredAt: unconsciousEvents.occurredAt,
  }).from(unconsciousEvents).where(and(
    eq(unconsciousEvents.serverId, life.serverId), eq(unconsciousEvents.playerId, p.id),
    gte(unconsciousEvents.occurredAt, life.startedAt), lte(unconsciousEvents.occurredAt, windowEnd),
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

  const recentUnconscious: DossierUnconscious[] = knockouts
    .map((u) => ({ disconnecting: u.disconnecting, secondsBeforeDeath: Math.round((endMs - u.occurredAt.getTime()) / 1000) }))
    .filter((u) => u.secondsBeforeDeath >= 0 && u.secondsBeforeDeath <= RECENT_HIT_WINDOW_S);

  return {
    lifeId: life.id, startedAt: life.startedAt, endedAt: life.endedAt, playtimeSeconds: life.playtimeSeconds,
    sessionCount: sess.length, hpLow, ordeals, recentHits, recentUnconscious,
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
    d.recentUnconscious,
  );
  return { cause, confidence, conditions };
}

/** One per-encounter span for the timeline (v0.69 spec §7) — distinct from `OrdealSummary`,
 *  which only rolls a category up into counts. */
export interface LifeEncounter {
  category: "wolf" | "bear" | "animal" | "infected" | "player" | "fire" | "environment";
  attackerGamertag: string | null; // set only for category "player"
  startedAt: Date;
  durationSeconds: number; // last tick − first tick, whole seconds
  hits: number;
  hpLow: number | null; // min victimHp across the encounter's ticks; null if all null
}

const isFireLabel = (label: string | null) => (label ?? "").toLowerCase().includes("fire");

function encounterKey(h: { attackerType: string; attackerGamertag: string | null; attackerLabel: string | null }): string {
  if (isFireLabel(h.attackerLabel)) return "fire";
  if (h.attackerType === "infected") return "infected";
  if (h.attackerType === "player") return `player:${(h.attackerGamertag ?? "").toLowerCase()}`;
  const animal = classifyEntityLabel(h.attackerLabel);
  return animal ?? "environment";
}

/**
 * Per-encounter spans for the timeline (v0.69 spec §7). Same 120s gap rule as the ordeal
 * summaries; PvP groups per attacker; fire is checked before category (a fire tick is
 * attackerType "environment" but its own story).
 *
 * ⚠️ Window end for an OPEN life is `lastSeenAt ?? now` — `endedAt ?? startedAt` (the dossier's
 * rule) would give an open life a zero-width window and silently hide every fight.
 *
 * ⚠️ An encounter whose last tick lands within RECENT_HIT_WINDOW_S of the death is suppressed —
 * the death row already tells that story, and printing it twice reads as two fights.
 */
export async function encountersForLife(db: Database, gamertag: string, life: DossierLife, lastSeenAt: Date | null): Promise<LifeEncounter[]> {
  const windowEnd = life.endedAt ?? lastSeenAt ?? new Date();
  const p = (await db.select({ id: players.id }).from(players).where(eq(players.gamertag, gamertag)))[0];
  if (!p) return [];
  const ticks = await db.select({
    attackerType: hitEvents.attackerType, attackerGamertag: hitEvents.attackerGamertag,
    attackerLabel: hitEvents.attackerLabel, victimHp: hitEvents.victimHp, occurredAt: hitEvents.occurredAt,
  }).from(hitEvents).where(and(
    eq(hitEvents.serverId, life.serverId), eq(hitEvents.victimPlayerId, p.id),
    gte(hitEvents.occurredAt, life.startedAt), lte(hitEvents.occurredAt, windowEnd),
  ));
  const byKey = new Map<string, typeof ticks>();
  for (const t of ticks) {
    const k = encounterKey(t);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(t);
  }
  const out: LifeEncounter[] = [];
  for (const [key, group] of byKey) {
    const sorted = [...group].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    let span: typeof sorted = [];
    const flush = () => {
      if (span.length === 0) return;
      const last = span[span.length - 1]!.occurredAt;
      // death-adjacent suppression
      if (life.endedAt && (life.endedAt.getTime() - last.getTime()) / 1000 <= RECENT_HIT_WINDOW_S) { span = []; return; }
      const hps = span.map((t) => t.victimHp).filter((n): n is number => n != null);
      const category = key.startsWith("player:") ? "player" : (key as LifeEncounter["category"]);
      out.push({
        category,
        attackerGamertag: category === "player" ? span[0]!.attackerGamertag : null,
        startedAt: span[0]!.occurredAt,
        durationSeconds: Math.round((last.getTime() - span[0]!.occurredAt.getTime()) / 1000),
        hits: span.length,
        hpLow: hps.length ? Math.min(...hps) : null,
      });
      span = [];
    };
    for (const t of sorted) {
      if (span.length && (t.occurredAt.getTime() - span[span.length - 1]!.occurredAt.getTime()) / 1000 > ENCOUNTER_GAP_S) flush();
      span.push(t);
    }
    flush();
  }
  return out.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}
