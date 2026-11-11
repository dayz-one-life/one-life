import { and, eq, gte, lte } from "drizzle-orm";
import type { Database } from "@onelife/db";
import { lives, sessions, hitEvents, buildEvents, players } from "@onelife/db";
import { classifyEntityLabel } from "@onelife/domain";
import type { PublicDeath } from "@onelife/death-verdict";
import { getPublicDeath, type PublicDeathLife } from "./death-verdicts.js";

// Damage arrives as individual ticks; consecutive same-category hits within this gap are ONE
// encounter (a single fire, a single zombie scrap), so the story counts run-ins, not blows.
const ENCOUNTER_GAP_S = 120;

/** An encounter whose last tick is this close to the death is part of the death (see
 *  `encountersForLife`). It was `RECENT_HIT_WINDOW_S` of the stage-1 classifier, deleted in
 *  death-verdict plan step 10; the value, 120 s, is unchanged. */
const DEATH_ADJACENT_S = 120;

/** One ordeal category, collapsed from raw hit-ticks into distinct encounters. */
export interface OrdealSummary { encounters: number; hits: number; worstEncounterHits: number }

/**
 * The ordeals fact sheet of a life. It used to carry the inputs of the stage-1 read-time classifier
 * as well (the 120 s hits and knockouts, the death vitals); death-verdict plan step 10 removed them,
 * because the stored verdict (`death_verdicts`, `getPublicDeath`) is the only answer to how a life
 * ended, its `hunted` condition included.
 */
export interface LifeDossier {
  lifeId: number;
  startedAt: Date;
  endedAt: Date | null;
  playtimeSeconds: number;
  sessionCount: number;
  hpLow: number | null;
  ordeals: { infected: OrdealSummary; fire: OrdealSummary; pvp: OrdealSummary; buildsPlaced: number };
}

/** The lives-row slice the dossier needs — satisfied structurally by a full lives row. */
export interface DossierLife {
  id: number;
  serverId: number;
  startedAt: Date;
  endedAt: Date | null;
  playtimeSeconds: number;
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

/** The ordeals fact sheet for a life whose row the caller already holds. */
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
  return {
    lifeId: life.id, startedAt: life.startedAt, endedAt: life.endedAt, playtimeSeconds: life.playtimeSeconds,
    sessionCount: sess.length, hpLow, ordeals,
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

/**
 * The death a page shows: the stored verdict through `toPublicDeath` (death-verdict spec 7), or
 * the pending state while the sweep has not written it. `cause`, `confidence` and `conditions`
 * are still there, in the pre-stage-4 vocabulary (`legacyCause`), for readers that predate the
 * label (an old mobile build, a rolled-back web, a third-party reader of the public JSON). They
 * stay until the mobile minimum-version gate is raised past the last build that reads them.
 */
export type DeathVerdictSummary = PublicDeath;

/** The public death of a life whose row the caller holds; null when it did not end in a death. */
export async function dossierVerdict(db: Database, life: PublicDeathLife): Promise<DeathVerdictSummary | null> {
  return getPublicDeath(db, life);
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
 * ⚠️ An encounter whose last tick lands within DEATH_ADJACENT_S of the death is suppressed —
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
      if (life.endedAt && (life.endedAt.getTime() - last.getTime()) / 1000 <= DEATH_ADJACENT_S) { span = []; return; }
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
