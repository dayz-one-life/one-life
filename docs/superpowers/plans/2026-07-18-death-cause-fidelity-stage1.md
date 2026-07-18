# Death-Cause Fidelity — Stage 1 (Interpretation Layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the archived platform's `classifyDeath` verdict ladder + ordeals dossier into the current repo and surface classified death verdicts (starvation/dehydration/mauled + confidence + conditions) in newsdesk prose and on the web's death surfaces.

**Architecture:** Lazy shared classifier — `classifyDeath` is a pure function in `packages/domain`; a new `life-dossier` read-model supplies its inputs (vitals off the lives row + a 120 s recent-hits window from `hit_events`) plus the ordeals color. `getLifeTimeline`, `getPlayerPage` (visible slice only), and newsdesk facts each compute the verdict at read time. Nothing is materialized: no migration, no projector rebuild, thresholds tune freely. Spec: `docs/superpowers/specs/2026-07-18-death-cause-fidelity-design.md`. Stage 2 (parser vocabulary + backfill) is a separate follow-up plan.

**Tech Stack:** TypeScript ESM monorepo (pnpm + turbo), Drizzle/Postgres, vitest, Next.js (web), Fastify (api).

## Global Constraints

- **PvP stays literal:** no code path may change or stop emitting/comparing the exact string `"pvp"` (qualification `packages/read-models/src/qualified.ts:15`, SQL mirror `qualified-lives.ts:16`, enforcer `apps/enforcer/src/decide.ts:26`, kill rows `packages/projections/src/fold.ts:84`).
- **No DB migrations in stage 1.** No `packages/db` schema changes.
- `classifyDeath` ports **verbatim** from the archived repo (`../one-life-platform/packages/newsroom/src/death-cause.ts`) — thresholds `STARVE_ENERGY_MAX = 1`, `DEHYDRATE_WATER_MAX = 1`, `RECENT_HIT_WINDOW_S = 120`; only the file location changes.
- Package code uses ESM imports with `.js` suffix (`import { x } from "./life-dossier.js"`); web app code uses `@/` path imports without suffix. Match each file's surroundings.
- DB test suites need `TEST_DATABASE_URL`. **This dev machine remaps Postgres to host port 5434** (gitignored `docker-compose.override.yml`): run as `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter <pkg> test`.
- Full check before the PR: `pnpm turbo run typecheck` and `pnpm turbo run test --concurrency=1`.
  **Turbo envMode gotcha:** `turbo.json` doesn't declare `TEST_DATABASE_URL`, so strict envMode strips
  it and DB suites silently fall back to `:5432` (the WRONG container on this machine). Always run the
  turbo test sweep as `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm turbo run test --concurrency=1 --env-mode=loose`
  (per-package `pnpm --filter X test` is unaffected).
- Work happens on the existing branch `feature/death-cause-fidelity` (already created from `origin/develop`; the design-spec commit is on it).
- Prompt text/version changes bump `OBITUARY_PROMPT_VERSION` to `"obituary-v2"`.

---

### Task 1: `classifyDeath` in `packages/domain`

**Files:**
- Create: `packages/domain/src/death-verdict.ts`
- Create: `packages/domain/test/death-verdict.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces (used by Tasks 2, 3, 5): `classifyDeath(facts: DeathRawFacts, recentHits: RecentHit[]): DeathVerdict`; types `DeathRawFacts { mechanism: string | null; energy: number | null; water: number | null; bleedSources: number | null; weapon: string | null }`, `RecentHit { attackerType: string; attackerLabel: string | null; secondsBeforeDeath: number }`, `DeathConfidence = "high" | "low"`, `DeathVerdict { cause: "pvp" | "suicide" | "starvation" | "dehydration" | "bled_out" | "mauled" | "environmental" | "unknown"; confidence: DeathConfidence; conditions: string[]; basis: Record<string, unknown> }`; constants `STARVE_ENERGY_MAX`, `DEHYDRATE_WATER_MAX`, `RECENT_HIT_WINDOW_S`.

- [ ] **Step 1: Write the failing test**

Create `packages/domain/test/death-verdict.test.ts` — the archived golden fixtures, ported verbatim (only the import path changes):

```ts
import { describe, it, expect } from "vitest";
import { classifyDeath, type RecentHit } from "../src/death-verdict.js";

const infected: RecentHit = { attackerType: "infected", attackerLabel: "Infected", secondsBeforeDeath: 30 };
const playerHit: RecentHit = { attackerType: "player", attackerLabel: "PlayerName", secondsBeforeDeath: 45 };

describe("classifyDeath", () => {
  it("flaminx0r: starving suicide by blade, bleed is self-inflicted (not bled_out)", () => {
    const v = classifyDeath(
      { mechanism: "suicide", energy: 0, water: 620.083, bleedSources: 1, weapon: "StoneKnife" },
      [infected],
    );
    expect(v.cause).toBe("suicide");
    expect(v.conditions).toEqual(expect.arrayContaining(["starving", "hunted"]));
    expect(v.conditions).not.toContain("bleeding"); // side-effect subtracted
  });

  it("RonaldRaygun552: healthy suicide", () => {
    const v = classifyDeath(
      { mechanism: "suicide", energy: 469.478, water: 722.265, bleedSources: 3, weapon: "SteakKnife" },
      [],
    );
    expect(v.cause).toBe("suicide");
    expect(v.conditions).toEqual(["healthy"]);
  });

  it("plain died with Energy 0 and no recent combat => starvation (high)", () => {
    const v = classifyDeath({ mechanism: "died", energy: 0, water: 500, bleedSources: 0, weapon: null }, []);
    expect(v.cause).toBe("starvation");
    expect(v.confidence).toBe("high");
  });

  it("plain died, bleeding after infected hits => mauled", () => {
    const v = classifyDeath({ mechanism: "died", energy: 500, water: 500, bleedSources: 2, weapon: null }, [infected]);
    expect(v.cause).toBe("mauled");
    expect(v.conditions).toContain("bleeding");
  });

  it("PvP mechanism passes through", () => {
    const v = classifyDeath({ mechanism: "pvp", energy: null, water: null, bleedSources: null, weapon: "M4A1" }, []);
    expect(v.cause).toBe("pvp");
  });

  it("mechanism: drowned => environmental cause with high confidence", () => {
    const v = classifyDeath({ mechanism: "drowned", energy: 500, water: 500, bleedSources: 0, weapon: null }, []);
    expect(v.cause).toBe("environmental");
    expect(v.conditions).toContain("drowned");
    expect(v.confidence).toBe("high");
  });

  it("mechanism: environment (no recent hits) => environmental cause with high confidence", () => {
    const v = classifyDeath({ mechanism: "environment", energy: 500, water: 500, bleedSources: 0, weapon: null }, []);
    expect(v.cause).toBe("environmental");
    expect(v.confidence).toBe("high");
  });

  it("mechanism: environment with recent player hit => still high confidence (stated mechanism is high)", () => {
    const v = classifyDeath({ mechanism: "environment", energy: 500, water: 500, bleedSources: 0, weapon: null }, [playerHit]);
    expect(v.cause).toBe("environmental");
    expect(v.confidence).toBe("high");
  });

  it("plain died with water 0 and no hits => dehydration with high confidence", () => {
    const v = classifyDeath({ mechanism: "died", energy: 500, water: 0, bleedSources: 0, weapon: null }, []);
    expect(v.cause).toBe("dehydration");
    expect(v.confidence).toBe("high");
  });

  it("plain died with water 0 and recent hit => dehydration with low confidence (competing explanation)", () => {
    const v = classifyDeath({ mechanism: "died", energy: 500, water: 0, bleedSources: 0, weapon: null }, [playerHit]);
    expect(v.cause).toBe("dehydration");
    expect(v.confidence).toBe("low");
  });

  it("plain died with bleed sources and non-infected player hit => bled_out (not mauled), with bleeding condition", () => {
    const v = classifyDeath({ mechanism: "died", energy: 500, water: 500, bleedSources: 2, weapon: null }, [playerHit]);
    expect(v.cause).toBe("bled_out");
    expect(v.conditions).toContain("bleeding");
  });

  it("plain died with all vitals healthy/null and no hits => unknown cause with healthy conditions", () => {
    const v = classifyDeath({ mechanism: "died", energy: 500, water: 500, bleedSources: null, weapon: null }, []);
    expect(v.cause).toBe("unknown");
    expect(v.conditions).toEqual(["healthy"]);
  });

  it("recent-hit window: a hit older than 120s does not grade starvation down", () => {
    const old: RecentHit = { attackerType: "player", attackerLabel: null, secondsBeforeDeath: 300 };
    const v = classifyDeath({ mechanism: "died", energy: 0, water: 500, bleedSources: 0, weapon: null }, [old]);
    expect(v.cause).toBe("starvation");
    expect(v.confidence).toBe("high");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/domain test`
Expected: FAIL — cannot resolve `../src/death-verdict.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/domain/src/death-verdict.ts` — verbatim port of `../one-life-platform/packages/newsroom/src/death-cause.ts`:

```ts
export interface DeathRawFacts {
  mechanism: string | null;      // lives.death_cause: pvp|suicide|bled_out|drowned|died|environment|unknown
  energy: number | null;
  water: number | null;
  bleedSources: number | null;
  weapon: string | null;         // part of input contract; reserved for future melee/firearm distinction; not read by classifyDeath today
}

export interface RecentHit {
  attackerType: string;          // "player" | "infected" | "environment"
  attackerLabel: string | null;  // e.g. "Fireplace", "Infected"
  secondsBeforeDeath: number;
}

export type DeathConfidence = "high" | "low";

export interface DeathVerdict {
  cause: "pvp" | "suicide" | "starvation" | "dehydration" | "bled_out" | "mauled" | "environmental" | "unknown";
  confidence: DeathConfidence;
  conditions: string[];          // "starving" | "dehydrated" | "bleeding" | "hunted" | "drowned" | "healthy"
  basis: Record<string, unknown>;
}

export const STARVE_ENERGY_MAX = 1;     // Energy ≈ 0 (game reports 0 when out of food)
export const DEHYDRATE_WATER_MAX = 1;   // Water ≈ 0
export const RECENT_HIT_WINDOW_S = 120; // "recent" damage window feeding cause inference

/**
 * Mechanism-first ladder. A mechanism explains its own side-effects: a suicide-by-blade's bleed and a
 * PvP kill's low HP are NOT read as underlying conditions. Underlying cause is inferred only for a
 * plain `died`/`unknown` mechanism. Pure — recentHits is supplied by the caller.
 */
export function classifyDeath(facts: DeathRawFacts, recentHits: RecentHit[]): DeathVerdict {
  const recent = recentHits.filter((h) => h.secondsBeforeDeath <= RECENT_HIT_WINDOW_S);
  const starving = facts.energy != null && facts.energy <= STARVE_ENERGY_MAX;
  const dehydrated = facts.water != null && facts.water <= DEHYDRATE_WATER_MAX;
  const hunted = recent.some((h) => h.attackerType === "infected");

  const baseConditions: string[] = [];
  if (starving) baseConditions.push("starving");
  if (dehydrated) baseConditions.push("dehydrated");
  if (hunted) baseConditions.push("hunted");
  const withHealthy = (c: string[]) => (c.length ? c : ["healthy"]);
  const basis = { mechanism: facts.mechanism, energy: facts.energy, water: facts.water,
    bleedSources: facts.bleedSources, recentInfectedHits: recent.filter((h) => h.attackerType === "infected").length };

  // Mechanism-first: these explain their own bleed/HP; do not add "bleeding".
  if (facts.mechanism === "pvp") return { cause: "pvp", confidence: "high", conditions: withHealthy(baseConditions), basis };
  if (facts.mechanism === "suicide") return { cause: "suicide", confidence: "high", conditions: withHealthy(baseConditions), basis };
  if (facts.mechanism === "bled_out") return { cause: "bled_out", confidence: "high", conditions: [...baseConditions, "bleeding"], basis };
  if (facts.mechanism === "drowned") return { cause: "environmental", confidence: "high", conditions: [...baseConditions, "drowned"], basis };
  if (facts.mechanism === "environment") return { cause: "environmental", confidence: "high", conditions: withHealthy(baseConditions), basis }; // STATED mechanism is high-confidence; only INFERRED causes below are graded down by competing hits

  // No explaining mechanism (died/unknown/null): infer the underlying cause.
  if (starving) return { cause: "starvation", confidence: recent.length ? "low" : "high", conditions: baseConditions, basis };
  if (dehydrated) return { cause: "dehydration", confidence: recent.length ? "low" : "high", conditions: baseConditions, basis };
  if (facts.bleedSources != null && facts.bleedSources > 0 && recent.length > 0) {
    return { cause: hunted ? "mauled" : "bled_out", confidence: "high", conditions: [...baseConditions, "bleeding"], basis };
  }
  return { cause: "unknown", confidence: "low", conditions: withHealthy(baseConditions), basis };
}
```

Add to `packages/domain/src/index.ts`:

```ts
export * from "./death-verdict.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/domain test`
Expected: PASS (all 13 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/death-verdict.ts packages/domain/test/death-verdict.test.ts packages/domain/src/index.ts
git commit -m "feat(domain): classifyDeath — mechanism-first death-verdict ladder (ported from one-life-platform)"
```

---

### Task 2: `life-dossier` read-model

**Files:**
- Create: `packages/read-models/src/life-dossier.ts`
- Create: `packages/read-models/test/life-dossier.test.ts`
- Modify: `packages/read-models/src/index.ts`

**Interfaces:**
- Consumes (Task 1): `classifyDeath`, `RECENT_HIT_WINDOW_S`, `DeathVerdict` from `@onelife/domain`.
- Produces (used by Tasks 3, 4):
  - `interface OrdealSummary { encounters: number; hits: number; worstEncounterHits: number }`
  - `interface DossierRecentHit { attackerType: string; attackerLabel: string | null; secondsBeforeDeath: number }`
  - `interface LifeDossier { lifeId: number; startedAt: Date; endedAt: Date | null; playtimeSeconds: number; sessionCount: number; hpLow: number | null; ordeals: { infected: OrdealSummary; fire: OrdealSummary; pvp: OrdealSummary; buildsPlaced: number }; recentHits: DossierRecentHit[]; death: { mechanism: string | null; energy: number | null; water: number | null; bleedSources: number | null; weapon: string | null } }`
  - `interface DossierLife { id: number; serverId: number; startedAt: Date; endedAt: Date | null; playtimeSeconds: number; deathCause: string | null; deathWeapon: string | null; energyAtDeath: number | null; waterAtDeath: number | null; bleedSourcesAtDeath: number | null }`
  - `dossierForLife(db: Database, gamertag: string, life: DossierLife): Promise<LifeDossier>` — workhorse for callers that already hold the life row.
  - `getLifeDossier(db: Database, serverId: number, lifeId: number): Promise<LifeDossier | null>` — fetches the life + player, delegates.
  - `dossierVerdict(d: LifeDossier): DeathVerdict` — `classifyDeath` over the dossier's death facts + recentHits.

- [ ] **Step 1: Write the failing test**

Create `packages/read-models/test/life-dossier.test.ts` (harness pattern matches `test/life-timeline.test.ts`):

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, hitEvents, buildEvents } from "@onelife/db";
import { inArray, eq } from "drizzle-orm";
import { getLifeDossier, dossierVerdict } from "../src/life-dossier.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 61e7;
const start = new Date("2026-07-15T00:00:00Z");
const mins = (m: number) => new Date(start.getTime() + m * 60_000);
const gt = `Dossier-${svc}`;
let serverId: number;
let pid: number;
let lifeId: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "ld", map: "sakhal", slug: `ld-${svc}`, active: true }).returning();
  serverId = s!.id;
  const [p] = await db.insert(players).values({ gamertag: gt, lastSeenAt: mins(400) }).returning();
  pid = p!.id;
  // Died at +360m: mechanism "died", starving, one bleed source — the flaminx0r shape.
  const [l] = await db.insert(lives).values({
    serverId, playerId: pid, lifeNumber: 1, startedAt: start, endedAt: mins(360),
    deathCause: "died", deathWeapon: null,
    energyAtDeath: 0, waterAtDeath: 620.083, bleedSourcesAtDeath: 1, playtimeSeconds: 21600,
  }).returning();
  lifeId = l!.id;
  await db.insert(sessions).values([
    { serverId, playerId: pid, lifeId, connectedAt: start, disconnectedAt: mins(180), durationSeconds: 10800, closeReason: "disconnect" },
    { serverId, playerId: pid, lifeId, connectedAt: mins(200), disconnectedAt: mins(360), durationSeconds: 9600, closeReason: "death" },
  ]);
  await db.insert(buildEvents).values({ serverId, gamertag: gt, playerId: pid, lifeId, action: "placed", object: "Fireplace", occurredAt: mins(30) });
  await db.insert(hitEvents).values([
    // Encounter 1: two infected ticks 10s apart at +100m.
    { serverId, victimGamertag: gt, attackerType: "infected", attackerLabel: "Infected", victimHp: 62, occurredAt: mins(100) },
    { serverId, victimGamertag: gt, attackerType: "infected", attackerLabel: "Infected", victimHp: 47, occurredAt: new Date(mins(100).getTime() + 10_000) },
    // Encounter 2 (gap > 120s): one infected tick 30s before death — inside the recent window.
    { serverId, victimGamertag: gt, attackerType: "infected", attackerLabel: "Infected", victimHp: 12, occurredAt: new Date(mins(360).getTime() - 30_000) },
    // A fire tick (attackerType environment, label Fireplace) at +50m.
    { serverId, victimGamertag: gt, attackerType: "environment", attackerLabel: "Fireplace", victimHp: 80, occurredAt: mins(50) },
    // Outside the life window entirely (before birth) — must be ignored.
    { serverId, victimGamertag: gt, attackerType: "player", attackerGamertag: "Someone", victimHp: 90, occurredAt: mins(-10) },
  ]);
});

afterAll(async () => {
  await db.delete(hitEvents).where(inArray(hitEvents.serverId, [serverId]));
  await db.delete(buildEvents).where(inArray(buildEvents.serverId, [serverId]));
  await db.delete(sessions).where(inArray(sessions.serverId, [serverId]));
  await db.delete(lives).where(inArray(lives.serverId, [serverId]));
  await db.delete(players).where(inArray(players.id, [pid]));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("getLifeDossier", () => {
  it("collapses hit ticks into encounters, splits fire from infected, windows recentHits", async () => {
    const d = await getLifeDossier(db, serverId, lifeId);
    expect(d).not.toBeNull();
    expect(d!.sessionCount).toBe(2);
    expect(d!.ordeals.buildsPlaced).toBe(1);
    // Two infected encounters (ticks 10s apart merge; the pre-death tick is its own).
    expect(d!.ordeals.infected).toEqual({ encounters: 2, hits: 3, worstEncounterHits: 2 });
    expect(d!.ordeals.fire).toEqual({ encounters: 1, hits: 1, worstEncounterHits: 1 });
    // The pre-birth player hit is outside the window: pvp ordeal empty.
    expect(d!.ordeals.pvp).toEqual({ encounters: 0, hits: 0, worstEncounterHits: 0 });
    expect(d!.hpLow).toBe(12);
    // Only the tick 30s before death is "recent".
    expect(d!.recentHits).toHaveLength(1);
    expect(d!.recentHits[0]!.attackerType).toBe("infected");
    expect(d!.recentHits[0]!.secondsBeforeDeath).toBe(30);
    expect(d!.death).toEqual({ mechanism: "died", energy: 0, water: 620.083, bleedSources: 1, weapon: null });
  });

  it("dossierVerdict: starving + recent infected hit => starvation, low confidence, hunted", async () => {
    const d = await getLifeDossier(db, serverId, lifeId);
    const v = dossierVerdict(d!);
    expect(v.cause).toBe("starvation");
    expect(v.confidence).toBe("low"); // the recent infected hit is a competing explanation
    expect(v.conditions).toEqual(expect.arrayContaining(["starving", "hunted"]));
  });

  it("returns null for an unknown life", async () => {
    expect(await getLifeDossier(db, serverId, 999_999_999)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test -- life-dossier`
Expected: FAIL — cannot resolve `../src/life-dossier.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/read-models/src/life-dossier.ts` (adapted from the archived `packages/read-models/src/dossier.ts` — same logic; adds `DossierLife`/`dossierForLife` so row-holding callers skip the refetch, and `dossierVerdict`):

```ts
import { and, eq, gte, lte } from "drizzle-orm";
import type { Database } from "@onelife/db";
import { lives, sessions, hitEvents, buildEvents, players } from "@onelife/db";
import { classifyDeath, RECENT_HIT_WINDOW_S, type DeathVerdict } from "@onelife/domain";

// Damage arrives as individual ticks; consecutive same-category hits within this gap are ONE
// encounter (a single fire, a single zombie scrap), so the story counts run-ins, not blows.
const ENCOUNTER_GAP_S = 120;

/** One ordeal category, collapsed from raw hit-ticks into distinct encounters. */
export interface OrdealSummary { encounters: number; hits: number; worstEncounterHits: number }

export interface DossierRecentHit { attackerType: string; attackerLabel: string | null; secondsBeforeDeath: number }
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

  // Hits on this player within the life window (hit_events is keyed by gamertag, not life id).
  const hits = await db.select({
    attackerType: hitEvents.attackerType, attackerLabel: hitEvents.attackerLabel,
    victimHp: hitEvents.victimHp, occurredAt: hitEvents.occurredAt,
  }).from(hitEvents).where(and(
    eq(hitEvents.serverId, life.serverId), eq(hitEvents.victimGamertag, gamertag),
    gte(hitEvents.occurredAt, life.startedAt), lte(hitEvents.occurredAt, windowEnd),
  ));

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
    .map((h) => ({ attackerType: h.attackerType, attackerLabel: h.attackerLabel, secondsBeforeDeath: Math.round((endMs - h.occurredAt.getTime()) / 1000) }))
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

/** The classified death verdict for a dossier — pure composition over classifyDeath. */
export function dossierVerdict(d: LifeDossier): DeathVerdict {
  return classifyDeath(
    { mechanism: d.death.mechanism, energy: d.death.energy, water: d.death.water,
      bleedSources: d.death.bleedSources, weapon: d.death.weapon },
    d.recentHits,
  );
}
```

Add to `packages/read-models/src/index.ts`:

```ts
export * from "./life-dossier.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test -- life-dossier`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/read-models/src/life-dossier.ts packages/read-models/test/life-dossier.test.ts packages/read-models/src/index.ts
git commit -m "feat(read-models): life dossier — ordeals, recent hits, death verdict composition"
```

---

### Task 3: verdict + ordeals on `getLifeTimeline`

**Files:**
- Modify: `packages/read-models/src/life-timeline.ts`
- Modify: `packages/read-models/test/life-timeline.test.ts`

**Interfaces:**
- Consumes (Task 2): `dossierForLife`, `dossierVerdict`, `LifeDossier`; (Task 1) `DeathVerdict`.
- Produces (used by Tasks 5, 8): `LifeTimeline` gains three fields — `verdict: DeathVerdict | null` (null while the life is open), `ordeals: LifeDossier["ordeals"]`, `hpLow: number | null`. The API route `GET /players/:gamertag/:map/lives/:n` (`apps/api/src/routes/player-aggregate.ts:36`) spreads the timeline object, so the response gains them with **no route change**.

- [ ] **Step 1: Write the failing test**

In `packages/read-models/test/life-timeline.test.ts`, the existing `beforeAll` seeds a dead life (`deathCause: "pvp"`, vitals 42/18/2). Add one hit-event insert at the end of `beforeAll` (import `hitEvents` alongside the other tables):

```ts
await db.insert(hitEvents).values({
  serverId, victimGamertag: `LtHero-${svc}`, attackerType: "player", attackerGamertag: "SomeKiller",
  victimHp: 30, occurredAt: new Date(mins(360).getTime() - 20_000),
});
```

and its cleanup as the first line of `afterAll`:

```ts
await db.delete(hitEvents).where(inArray(hitEvents.serverId, [serverId]));
```

Add a test inside the existing `describe`:

```ts
it("carries the classified verdict, ordeals, and hpLow for a dead life", async () => {
  const t = await getLifeTimeline(db, serverId, `LtHero-${svc}`, deadLifeId);
  expect(t).not.toBeNull();
  // Stated pvp mechanism passes through at high confidence.
  expect(t!.verdict).toMatchObject({ cause: "pvp", confidence: "high" });
  expect(t!.ordeals.pvp.encounters).toBe(1);
  expect(t!.hpLow).toBe(30);
});
```

If the file also exercises an open (alive) life, assert `verdict` is `null` there; if it does not, add nothing further.

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test -- life-timeline`
Expected: FAIL — `verdict`/`ordeals`/`hpLow` undefined on the result.

- [ ] **Step 3: Write the implementation**

In `packages/read-models/src/life-timeline.ts`:

```ts
import { dossierForLife, dossierVerdict, type LifeDossier } from "./life-dossier.js";
import type { DeathVerdict } from "@onelife/domain";
```

Extend the interface:

```ts
export interface LifeTimeline {
  life: NonNullable<Awaited<ReturnType<typeof getLifeDetail>>>["life"];
  sessions: NonNullable<Awaited<ReturnType<typeof getLifeDetail>>>["sessions"];
  character: LifeCharacter | null;
  kills: PlayerKill[];
  qualifiedAt: QualifiedAt | null;
  verdict: DeathVerdict | null;        // classified death — null while the life is open
  ordeals: LifeDossier["ordeals"];
  hpLow: number | null;
}
```

In `getLifeTimeline`, alongside the existing `Promise.all` results (the dossier needs `life`, so compute it after `getLifeDetail` — add it to the existing `Promise.all` batch):

```ts
const [character, kills, playerRow, dossier] = await Promise.all([
  getLifeCharacter(db, serverId, gamertag, life.startedAt, life.endedAt),
  getLifeKills(db, serverId, gamertag, life.startedAt, life.endedAt),
  db.select({ lastSeenAt: players.lastSeenAt }).from(players).where(eq(players.gamertag, gamertag)),
  dossierForLife(db, gamertag, life),
]);
```

and return:

```ts
return {
  life, sessions, character, kills, qualifiedAt,
  verdict: life.endedAt ? dossierVerdict(dossier) : null,
  ordeals: dossier.ordeals,
  hpLow: dossier.hpLow,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test -- life-timeline`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/read-models/src/life-timeline.ts packages/read-models/test/life-timeline.test.ts
git commit -m "feat(read-models): life timeline carries the classified death verdict + ordeals"
```

---

### Task 4: verdict on `getPlayerPage` past lives

**Files:**
- Modify: `packages/read-models/src/player-page.ts`
- Modify: `packages/read-models/test/player-page.test.ts`

**Interfaces:**
- Consumes (Task 2): `dossierForLife`, `dossierVerdict`; (Task 1) `DeathVerdict`.
- Produces (used by Task 8): `PastLife["death"]` gains `verdict: DeathVerdict | null`. Computed **only for the visible page slice** (the O(pageSize) boundary — the lightweight full set for totals/ordering is untouched). `GET /players/:gamertag` returns it with no route change.

- [ ] **Step 1: Write the failing test**

In `packages/read-models/test/player-page.test.ts` (the seeded player is `"Legend"`; the file has a `now` const), add a new test in the main describe:

```ts
it("past lives on the visible slice carry a classified verdict", async () => {
  const page = (await getPlayerPage(db, "Legend", now))!;
  const past = page.pastLives[0]!;
  expect(past.death.verdict).not.toBeNull();
  expect(past.death.verdict!.confidence).toMatch(/^(high|low)$/);
});
```

If the seeded ended life has `deathCause: "pvp"`, additionally assert `expect(past.death.verdict!.cause).toBe("pvp")` (a stated mechanism passes through).

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test -- player-page`
Expected: FAIL — `verdict` undefined.

- [ ] **Step 3: Write the implementation**

In `packages/read-models/src/player-page.ts`:

```ts
import { dossierForLife, dossierVerdict } from "./life-dossier.js";
import type { DeathVerdict } from "@onelife/domain";
```

Extend the `PastLife` interface's `death` field:

```ts
death: { cause: string | null; byGamertag: string | null; weapon: string | null; distanceMeters: number | null; verdict: DeathVerdict | null };
```

In the page-slice enrichment loop (`for (const { row: l, serverId, map, slug } of pageSlice)`), before the `pastLives.push`:

```ts
const dossier = await dossierForLife(db, gamertag, {
  id: l.id, serverId, startedAt: l.startedAt, endedAt: l.endedAt, playtimeSeconds: l.playtimeSeconds,
  deathCause: l.deathCause, deathWeapon: l.deathWeapon,
  energyAtDeath: l.energyAtDeath, waterAtDeath: l.waterAtDeath, bleedSourcesAtDeath: l.bleedSourcesAtDeath,
});
```

and in the pushed object change `death:` to:

```ts
death: { cause: l.deathCause, byGamertag: l.deathByGamertag, weapon: l.deathWeapon, distanceMeters: l.deathDistance, verdict: dossierVerdict(dossier) },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test -- player-page`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/read-models/src/player-page.ts packages/read-models/test/player-page.test.ts
git commit -m "feat(read-models): player-page past lives carry a classified death verdict (visible slice only)"
```

---

### Task 5: newsdesk facts + prompt — verdict, ordeals, death distance

**Files:**
- Modify: `apps/newsdesk/src/facts.ts`
- Modify: `apps/newsdesk/src/prompt.ts`
- Modify: `apps/newsdesk/test/facts.test.ts`
- Modify: `apps/newsdesk/test/prompt.test.ts`

**Interfaces:**
- Consumes (Task 3): `timeline.verdict`, `timeline.ordeals`, `timeline.hpLow`; `OrdealSummary` type from `@onelife/read-models`.
- Produces (used by Task 6 via the frozen `articles.facts` jsonb, and by Task 9): `ObituaryFacts` gains `verdict: { cause: string; confidence: "high" | "low"; conditions: string[] } | null` (basis deliberately stripped), `ordeals: { infected: OrdealSummary; fire: OrdealSummary; pvp: OrdealSummary; buildsPlaced: number } | null`, `hpLow: number | null`, `deathDistance: number | null`. New export `describeDeath(facts: ObituaryFacts): string`. `OBITUARY_PROMPT_VERSION` becomes `"obituary-v2"`. The publish path (`pg-store.ts` `facts: facts as unknown`) freezes the new fields into `articles.facts` with **no pg-store change**.

- [ ] **Step 1: Write the failing tests**

In `apps/newsdesk/test/facts.test.ts` there is a `timeline(overrides)` fixture helper — extend its base object with the three new `LifeTimeline` fields (`verdict: null`, `hpLow: null`, and an all-zero `ordeals: { infected: { encounters: 0, hits: 0, worstEncounterHits: 0 }, fire: { encounters: 0, hits: 0, worstEncounterHits: 0 }, pvp: { encounters: 0, hits: 0, worstEncounterHits: 0 }, buildsPlaced: 0 }`), then add:

```ts
it("carries verdict, ordeals, hpLow, and deathDistance into the facts", () => {
  const t = timeline({
    life: { deathCause: "pvp", deathByGamertag: "Camper", deathWeapon: "SKS", deathDistance: 153.4, playtimeSeconds: 600 },
    kills: [],
    verdict: { cause: "pvp", confidence: "high", conditions: ["healthy"], basis: {} },
    ordeals: { infected: { encounters: 2, hits: 3, worstEncounterHits: 2 }, fire: { encounters: 1, hits: 1, worstEncounterHits: 1 }, pvp: { encounters: 0, hits: 0, worstEncounterHits: 0 }, buildsPlaced: 1 },
    hpLow: 12,
  });
  const f = buildObituaryFacts(target, t);
  expect(f.verdict).toEqual({ cause: "pvp", confidence: "high", conditions: ["healthy"] }); // basis stripped
  expect(f.ordeals!.infected.encounters).toBe(2);
  expect(f.hpLow).toBe(12);
  expect(f.deathDistance).toBe(153.4);
});
```

(If the helper's base `life` object lacks `deathDistance`, add `deathDistance: null` to it.)

In `apps/newsdesk/test/prompt.test.ts` there is a top-level `const facts: ObituaryFacts = {...}` base literal — first add the four new fields to it (`deathDistance: null, verdict: null, ordeals: null, hpLow: null`), then define a local spread helper and the new tests:

```ts
const mkFacts = (overrides: Partial<ObituaryFacts>): ObituaryFacts => ({ ...facts, ...overrides });
```

```ts
it("describeDeath: pvp includes killer, weapon, and distance", () => {
  const s = describeDeath(mkFacts({ causeCategory: "pvp", killerGamertag: "Kilo", weapon: "M4A1", deathDistance: 384.2 }));
  expect(s).toBe("killed by another player (Kilo), M4A1, from 384m.");
});

it("describeDeath: high-confidence starvation is qualitative, no raw stats", () => {
  const s = describeDeath(mkFacts({
    causeCategory: "environment", cause: "died",
    verdict: { cause: "starvation", confidence: "high", conditions: ["starving"] },
  }));
  expect(s).toContain("starvation");
  expect(s).not.toMatch(/\d{2,}/); // no stat numbers leak
});

it("describeDeath: low confidence hedges with 'likely'", () => {
  const s = describeDeath(mkFacts({
    causeCategory: "environment", cause: "died",
    verdict: { cause: "dehydration", confidence: "low", conditions: ["dehydrated", "hunted"] },
  }));
  expect(s).toMatch(/^likely dehydration/);
});

it("describeDeath: no verdict falls back to the mechanism, humanized", () => {
  const s = describeDeath(mkFacts({ causeCategory: "environment", cause: "bled_out", verdict: null }));
  expect(s).toBe("bled out (not a player kill).");
});

it("prompt lists ordeal lines only when counts are non-zero and hedges low-confidence causes", () => {
  const { user } = buildObituaryPrompt(mkFacts({
    causeCategory: "environment", cause: "died",
    verdict: { cause: "starvation", confidence: "low", conditions: ["starving"] },
    ordeals: { infected: { encounters: 3, hits: 9, worstEncounterHits: 5 }, fire: { encounters: 0, hits: 0, worstEncounterHits: 0 }, pvp: { encounters: 0, hits: 0, worstEncounterHits: 0 }, buildsPlaced: 0 },
    hpLow: 8,
  }));
  expect(user).toContain("Run-ins with the infected: 3 (the worst took 5 hits)");
  expect(user).not.toContain("Times caught fire");
  expect(user).toContain("Lowest health recorded: 8 of 100");
  expect(user).toContain("hedge it in-voice");
  expect(user).toContain("never quote raw stat numbers");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @onelife/newsdesk test -- facts` and `pnpm --filter @onelife/newsdesk test -- prompt`
Expected: FAIL — new fields/`describeDeath` missing.

- [ ] **Step 3: Write the implementation**

`apps/newsdesk/src/facts.ts` — extend the interface and builder:

```ts
import type { LifeTimeline, OrdealSummary } from "@onelife/read-models";
```

```ts
export interface ObituaryFacts {
  // ...existing fields unchanged...
  deathDistance: number | null;
  verdict: { cause: string; confidence: "high" | "low"; conditions: string[] } | null;
  ordeals: { infected: OrdealSummary; fire: OrdealSummary; pvp: OrdealSummary; buildsPlaced: number } | null;
  hpLow: number | null;
}
```

In `buildObituaryFacts`, add to the returned object:

```ts
deathDistance: life.deathDistance ?? null,
// basis is auditing detail — keep the frozen facts snapshot lean.
verdict: timeline.verdict
  ? { cause: timeline.verdict.cause, confidence: timeline.verdict.confidence, conditions: timeline.verdict.conditions }
  : null,
ordeals: timeline.ordeals ?? null,
hpLow: timeline.hpLow ?? null,
```

`apps/newsdesk/src/prompt.ts` — bump the version, add `describeDeath`, rewrite the cause block, add ordeal + guidance lines:

```ts
export const OBITUARY_PROMPT_VERSION = "obituary-v2";
```

```ts
/** Deterministic, qualitative death sentence for the prompt — words, never raw stat values. */
export function describeDeath(facts: ObituaryFacts): string {
  if (facts.causeCategory === "pvp") {
    const killer = facts.killerGamertag ? ` (${facts.killerGamertag})` : "";
    const weapon = facts.weapon ? `, ${facts.weapon}` : "";
    const dist = facts.deathDistance != null ? `, from ${Math.round(facts.deathDistance)}m` : "";
    return `killed by another player${killer}${weapon}${dist}.`;
  }
  const v = facts.verdict;
  if (!v) {
    return facts.cause ? `${facts.cause.replace(/_/g, " ")} (not a player kill).` : "unknown.";
  }
  const noun: Record<string, string> = {
    suicide: "died by their own hand",
    starvation: "starvation — they ran out of food",
    dehydration: "dehydration — they ran out of water",
    bled_out: "bled out",
    mauled: "mauled — bleeding out after an animal or infected attack",
    environmental: facts.cause ? facts.cause.replace(/_/g, " ") : "the environment",
    unknown: "unknown",
  };
  const base = noun[v.cause] ?? v.cause.replace(/_/g, " ");
  const hedge = v.confidence === "low" ? "likely " : "";
  const conds = v.conditions.filter((c) => c !== "healthy");
  const state = conds.length
    ? ` At the end they were ${conds.join(" and ")}.`
    : v.conditions.includes("healthy") ? " They were in good health at the end." : "";
  return `${hedge}${base} (not a player kill).${state}`;
}
```

In `buildObituaryPrompt`, replace the whole `if (facts.causeCategory === "pvp") { ... } else if ... else { ... }` cause block with:

```ts
lines.push(`- Cause of death: ${describeDeath(facts)}`);
```

Immediately after the new `- Cause of death:` push, add:

```ts
if (facts.ordeals) {
  const o = facts.ordeals;
  if (o.infected.encounters > 0) lines.push(`- Run-ins with the infected: ${o.infected.encounters}${o.infected.worstEncounterHits > 1 ? ` (the worst took ${o.infected.worstEncounterHits} hits)` : ""}`);
  if (o.fire.encounters > 0) lines.push(`- Times caught fire: ${o.fire.encounters}`);
  if (o.pvp.encounters > 0) lines.push(`- Firefights that left a mark before the end: ${o.pvp.encounters}`);
  if (o.buildsPlaced > 0) lines.push(`- Things built this life: ${o.buildsPlaced}`);
}
if (facts.hpLow != null && facts.hpLow < 50) lines.push(`- Lowest health recorded: ${Math.round(facts.hpLow)} of 100`);
```

Before the final `Respond with only the JSON object` line, add:

```ts
lines.push(`Describe the manner of death in qualitative terms — never quote raw stat numbers (energy or water values).`);
if (facts.verdict?.confidence === "low") {
  lines.push(`The cause of death is an inference from the record, not a certainty — hedge it in-voice ("the record is murky", "the island isn't saying").`);
}
lines.push("");
```

Fix any existing `facts.test.ts`/`prompt.test.ts`/`tick.test.ts` fixtures that now miss the four new `ObituaryFacts` fields — add `deathDistance: null, verdict: null, ordeals: null, hpLow: null` (and old exact-string prompt assertions: update to the `describeDeath` output).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/newsdesk test`
Expected: PASS (whole package — fixtures updated).

- [ ] **Step 5: Commit**

```bash
git add apps/newsdesk/src/facts.ts apps/newsdesk/src/prompt.ts apps/newsdesk/test/facts.test.ts apps/newsdesk/test/prompt.test.ts apps/newsdesk/test/tick.test.ts
git commit -m "feat(newsdesk): obituary facts + prompt carry the classified verdict, ordeals, and shot distance"
```

(Include `tick.test.ts` only if its fixtures needed the new fields.)

---

### Task 6: image gate — `suspect-at-large` fires on a mauled verdict

**Files:**
- Modify: `apps/newsdesk/src/image-categories.ts`
- Modify: `apps/newsdesk/test/image-categories.test.ts`

**Interfaces:**
- Consumes (Task 5): the `verdict` object inside the frozen `articles.facts` snapshot (`FactsSnapshot` is `Record<string, unknown>`).
- Produces: no new exports — only the `suspect-at-large` eligibility widens.

- [ ] **Step 1: Write the failing test**

In `apps/newsdesk/test/image-categories.test.ts` add:

```ts
it("suspect-at-large fires on a mauled verdict even with a coarse cause token", () => {
  const cats = eligibleCategories("obituary", {
    causeCategory: "environment", cause: "died",
    verdict: { cause: "mauled", confidence: "high", conditions: ["bleeding", "hunted"] },
  });
  expect(cats.map((c) => c.slug)).toContain("suspect-at-large");
});

it("suspect-at-large stays dormant without a mauled verdict or matching cause substring", () => {
  const cats = eligibleCategories("obituary", { causeCategory: "environment", cause: "died", verdict: { cause: "starvation", confidence: "high", conditions: [] } });
  expect(cats.map((c) => c.slug)).not.toContain("suspect-at-large");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/newsdesk test -- image-categories`
Expected: FAIL — first new test.

- [ ] **Step 3: Write the implementation**

In `apps/newsdesk/src/image-categories.ts`, below the `s`/`n` helpers add:

```ts
const verdictCause = (f: FactsSnapshot) => s((f.verdict as { cause?: unknown } | null | undefined)?.cause);
```

and change the `suspect-at-large` entry's `eligible` to:

```ts
eligible: (f) => /wolf|bear|animal/.test(s(f.cause)) || verdictCause(f) === "mauled" },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/newsdesk test -- image-categories`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/newsdesk/src/image-categories.ts apps/newsdesk/test/image-categories.test.ts
git commit -m "feat(newsdesk): suspect-at-large image category fires on a mauled verdict"
```

---

### Task 7: shared web cause/verdict formatting

**Files:**
- Create: `apps/web/src/lib/cause-format.ts`
- Create: `apps/web/src/lib/cause-format.test.ts`
- Modify: `apps/web/src/lib/types.ts` (add `DeathVerdictDto` only)
- Modify: `apps/web/src/lib/obituary-format.ts` + `apps/web/src/lib/obituary-format.test.ts`
- Modify: `apps/web/src/lib/birth-format.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 8, 9):
  - `types.ts`: `export type DeathVerdictDto = { cause: string; confidence: "high" | "low"; conditions: string[] };`
  - `cause-format.ts`: `causeLabel(cause: string | null): string` (the single copy — the duplicates in `obituary-format.ts:19-23` and `birth-format.ts:29-33` are deleted and re-imported) and `verdictPhrase(verdict: DeathVerdictDto | null | undefined, cause: string | null): string`.
  - `obituary-format.ts`: `rapSheetFacts` input widens to `Pick<ObituaryCard, "timeAliveSeconds" | "kills" | "longestKillMeters" | "cause"> & { verdict?: DeathVerdictDto | null }` — Cause value becomes `verdictPhrase(a.verdict ?? null, a.cause)`. Existing callers (feed card, OG) pass objects without `verdict` and keep today's labels.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/cause-format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { causeLabel, verdictPhrase } from "./cause-format";

describe("causeLabel", () => {
  it("pvp => Killed", () => expect(causeLabel("pvp")).toBe("Killed"));
  it("null => Unknown", () => expect(causeLabel(null)).toBe("Unknown"));
  it("humanizes underscore tokens", () => expect(causeLabel("bled_out")).toBe("Bled Out"));
});

describe("verdictPhrase", () => {
  const v = (cause: string, confidence: "high" | "low" = "high", conditions: string[] = []) => ({ cause, confidence, conditions });

  it("no verdict falls back to the mechanism label", () => {
    expect(verdictPhrase(null, "drowned")).toBe("Drowned");
  });
  it("pvp => Killed", () => expect(verdictPhrase(v("pvp"), "pvp")).toBe("Killed"));
  it("inferred nouns render directly", () => {
    expect(verdictPhrase(v("starvation"), "died")).toBe("Starvation");
    expect(verdictPhrase(v("mauled"), "died")).toBe("Mauled");
    expect(verdictPhrase(v("bled_out"), "bled_out")).toBe("Bled out");
  });
  it("low confidence hedges", () => {
    expect(verdictPhrase(v("starvation", "low"), "died")).toBe("Likely starvation");
  });
  it("suicide lists non-healthy conditions", () => {
    expect(verdictPhrase(v("suicide", "high", ["starving", "hunted"]), "suicide")).toBe("Suicide (starving, hunted)");
  });
  it("healthy suicide reads deliberate", () => {
    expect(verdictPhrase(v("suicide", "high", ["healthy"]), "suicide")).toBe("Suicide (in good health)");
  });
  it("environmental/unknown verdicts keep the mechanism's specificity", () => {
    expect(verdictPhrase(v("environmental"), "drowned")).toBe("Drowned");
    expect(verdictPhrase(v("unknown", "low"), null)).toBe("Unknown");
  });
});
```

In `apps/web/src/lib/obituary-format.test.ts` add:

```ts
it("rapSheetFacts prefers the classified verdict for the Cause row", () => {
  const facts = rapSheetFacts({ timeAliveSeconds: 3600, kills: 0, longestKillMeters: null, cause: "died", verdict: { cause: "starvation", confidence: "low", conditions: ["starving"] } });
  expect(facts[facts.length - 1]).toEqual({ label: "Cause", value: "Likely starvation", hot: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @onelife/web test -- cause-format` and `pnpm --filter @onelife/web test -- obituary-format`
Expected: FAIL — module/param missing.

- [ ] **Step 3: Write the implementation**

Add to `apps/web/src/lib/types.ts` (near the other DTO types):

```ts
export type DeathVerdictDto = { cause: string; confidence: "high" | "low"; conditions: string[] };
```

Create `apps/web/src/lib/cause-format.ts`:

```ts
import type { DeathVerdictDto } from "./types";

/** Mechanism token -> display label. The single shared copy (obituary/birth formats import it). */
export function causeLabel(cause: string | null): string {
  if (cause === "pvp") return "Killed";
  if (!cause) return "Unknown";
  return cause.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const VERDICT_NOUN: Record<string, string> = {
  suicide: "Suicide",
  starvation: "Starvation",
  dehydration: "Dehydration",
  bled_out: "Bled out",
  mauled: "Mauled",
};

/**
 * Display phrase for a death: the classified verdict when present, the mechanism label otherwise.
 * Environmental/unknown verdicts fall back to the mechanism (keeps "Drowned"/"Environment"
 * specificity); low-confidence inferred nouns hedge with "Likely".
 */
export function verdictPhrase(verdict: DeathVerdictDto | null | undefined, cause: string | null): string {
  if (!verdict) return causeLabel(cause);
  if (verdict.cause === "pvp") return "Killed";
  const noun = VERDICT_NOUN[verdict.cause];
  if (!noun) return causeLabel(cause);
  if (verdict.cause === "suicide") {
    const conds = verdict.conditions.filter((c) => c !== "healthy");
    if (conds.length) return `Suicide (${conds.join(", ")})`;
    if (verdict.conditions.includes("healthy")) return "Suicide (in good health)";
    return "Suicide";
  }
  return verdict.confidence === "low" ? `Likely ${noun.toLowerCase()}` : noun;
}
```

In `apps/web/src/lib/obituary-format.ts`: delete the local `causeLabel`, add

```ts
import { causeLabel, verdictPhrase } from "./cause-format";
import type { DeathVerdictDto } from "./types";
```

and change `rapSheetFacts`:

```ts
export function rapSheetFacts(
  a: Pick<ObituaryCard, "timeAliveSeconds" | "kills" | "longestKillMeters" | "cause"> & { verdict?: DeathVerdictDto | null },
): RapFact[] {
  const out: RapFact[] = [
    { label: "Survived", value: formatDuration(a.timeAliveSeconds), hot: false },
    { label: "Kills", value: String(a.kills), hot: false },
  ];
  if (a.longestKillMeters != null) out.push({ label: "Longest kill", value: `${Math.round(a.longestKillMeters)}m`, hot: false });
  out.push({ label: "Cause", value: verdictPhrase(a.verdict ?? null, a.cause), hot: true });
  return out;
}
```

In `apps/web/src/lib/birth-format.ts`: delete the local `causeLabel` and add `import { causeLabel } from "./cause-format";`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/web test -- cause-format obituary-format birth-format`
Expected: PASS (including all pre-existing obituary/birth format tests, unchanged behavior without a verdict).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/cause-format.ts apps/web/src/lib/cause-format.test.ts apps/web/src/lib/types.ts apps/web/src/lib/obituary-format.ts apps/web/src/lib/obituary-format.test.ts apps/web/src/lib/birth-format.ts
git commit -m "feat(web): shared causeLabel + verdictPhrase; rap sheet prefers the classified verdict"
```

---

### Task 8: timeline death row + funeral cards render the verdict

**Files:**
- Modify: `apps/web/src/lib/types.ts` (LifeTimelineData + PastLife)
- Modify: `apps/web/src/lib/life-timeline.ts` + `apps/web/src/lib/life-timeline.test.ts`
- Modify: `apps/web/src/components/life/timeline.tsx` + `apps/web/src/components/life/timeline.test.tsx`
- Modify: `apps/web/src/components/player/past-life-card.tsx` + `apps/web/src/components/player/past-life-card.test.tsx`

**Interfaces:**
- Consumes (Task 7): `verdictPhrase`, `DeathVerdictDto`; (Tasks 3, 4) the API now serializes `verdict` on the timeline response and on `PastLife.death`.
- Produces: `LifeTimelineData` gains `verdict: DeathVerdictDto | null`; `PastLife["death"]` gains `verdict: DeathVerdictDto | null`; the death `TimelineEvent` variant gains `verdict: DeathVerdictDto | null`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/life-timeline.test.ts` — extend a dead-life fixture with `verdict: { cause: "starvation", confidence: "low", conditions: ["starving"] }` at the top level of the `LifeTimelineData` object, and assert:

```ts
it("threads the verdict onto the death event", () => {
  const view = buildTimeline(deadData, now); // the file's existing dead-life fixture, with verdict added
  const death = view.events.find((e) => e.kind === "death")!;
  expect(death.kind === "death" && death.verdict).toEqual({ cause: "starvation", confidence: "low", conditions: ["starving"] });
});
```

`apps/web/src/components/life/timeline.test.tsx` — render a view whose death event carries that verdict and assert the phrase:

```ts
expect(screen.getByText(/Died — Likely starvation/i)).toBeInTheDocument();
```

`apps/web/src/components/player/past-life-card.test.tsx` — give the fixture `death` a `verdict: { cause: "mauled", confidence: "high", conditions: ["bleeding", "hunted"] }` with `cause: "died"` and assert:

```ts
expect(screen.getByText(/Died — Mauled/i)).toBeInTheDocument();
```

(Existing fixtures without `verdict` get `verdict: null` where the type now requires it.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @onelife/web test -- life-timeline timeline past-life-card`
Expected: FAIL — type errors / missing rendering.

- [ ] **Step 3: Write the implementation**

`apps/web/src/lib/types.ts`:
- `LifeTimelineData` gains `verdict: DeathVerdictDto | null;`
- `PastLife`'s `death` object type gains `; verdict: DeathVerdictDto | null`.

`apps/web/src/lib/life-timeline.ts`:
- Import: `import type { LifeTimelineData, PlayerKill, Session, DeathVerdictDto } from "./types";`
- The death variant of `TimelineEvent` gains `verdict: DeathVerdictDto | null`:

```ts
| { kind: "death"; at: Date; marker: "red"; timeLabel: string; cause: string | null; byGamertag: string | null; weapon: string | null; distanceMeters: number | null; vitals: string | null; verdict: DeathVerdictDto | null }
```

- In `buildTimeline`'s death push, add `verdict: data.verdict ?? null`.

`apps/web/src/components/life/timeline.tsx`:
- `import { verdictPhrase } from "@/lib/cause-format";`
- Replace the non-pvp death headline branch:

```tsx
<>Died — {verdictPhrase(e.verdict, e.cause)}</>
```

`apps/web/src/components/player/past-life-card.tsx`:
- `import { verdictPhrase } from "@/lib/cause-format";`
- Replace the non-pvp branch:

```tsx
<>Died — {verdictPhrase(death.verdict, death.cause)}</>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/web test`
Expected: PASS (whole web suite — any other fixture touching `LifeTimelineData`/`PastLife` updated with `verdict: null`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/types.ts apps/web/src/lib/life-timeline.ts apps/web/src/lib/life-timeline.test.ts apps/web/src/components/life/timeline.tsx apps/web/src/components/life/timeline.test.tsx apps/web/src/components/player/past-life-card.tsx apps/web/src/components/player/past-life-card.test.tsx
git commit -m "feat(web): timeline death row + funeral cards render the classified verdict"
```

---

### Task 9: obituary interior + OG card verdict

**Files:**
- Modify: `packages/read-models/src/obituary-articles.ts` + `packages/read-models/test/obituary-articles.test.ts`
- Modify: `apps/web/src/lib/types.ts` (ObituaryArticle)

**Interfaces:**
- Consumes (Task 5): `verdict` inside the frozen `articles.facts` jsonb; (Task 7) `rapSheetFacts`' optional `verdict` param.
- Produces: read-model `ObituaryArticle` gains `verdict: { cause: string; confidence: "high" | "low"; conditions: string[] } | null`; web `ObituaryArticle` type gains `verdict: DeathVerdictDto | null`. The interior Rap Sheet and the OG card pick it up through `rapSheetFacts(article)` with **no component change**; feed cards (no verdict on `ObituaryCard`) keep mechanism labels. Old articles published before this release have no `facts.verdict` → `null` → exactly today's rendering.

- [ ] **Step 1: Write the failing test**

In `packages/read-models/test/obituary-articles.test.ts`, extend the seeded published article's `facts` jsonb with:

```ts
verdict: { cause: "mauled", confidence: "high", conditions: ["bleeding", "hunted"] },
```

and assert in the by-slug test:

```ts
expect(article!.verdict).toEqual({ cause: "mauled", confidence: "high", conditions: ["bleeding", "hunted"] });
```

Add one more assertion against an article seeded **without** `facts.verdict` (one already exists in the file or seed a second):

```ts
expect(legacy!.verdict).toBeNull();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test -- obituary-articles`
Expected: FAIL — `verdict` undefined.

- [ ] **Step 3: Write the implementation**

In `packages/read-models/src/obituary-articles.ts`:

```ts
type FactsSnapshot = {
  sessions?: number; killerGamertag?: string | null; weapon?: string | null;
  verdict?: { cause?: string; confidence?: "high" | "low"; conditions?: string[] } | null;
};
```

```ts
export interface ObituaryArticle extends ObituaryCard {
  body: string;
  pullQuote: { text: string; attribution: string } | null;
  sessions: number;
  killerGamertag: string | null;
  weapon: string | null;
  verdict: { cause: string; confidence: "high" | "low"; conditions: string[] } | null;
}
```

In `getObituaryBySlug`'s return object add:

```ts
verdict: facts.verdict?.cause
  ? { cause: facts.verdict.cause, confidence: facts.verdict.confidence ?? "high", conditions: facts.verdict.conditions ?? [] }
  : null,
```

In `apps/web/src/lib/types.ts`, `ObituaryArticle` gains:

```ts
verdict: DeathVerdictDto | null;
```

(No component change: `RapSheet` and the OG image already call `rapSheetFacts(article)`, whose Task 7 signature reads the optional `verdict`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test -- obituary-articles` and `pnpm --filter @onelife/web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/read-models/src/obituary-articles.ts packages/read-models/test/obituary-articles.test.ts apps/web/src/lib/types.ts
git commit -m "feat(read-models,web): obituary interior + OG card surface the frozen death verdict"
```

---

### Task 10: full verification + CHANGELOG + CLAUDE.md

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the PR-ready branch (workflow guardrails require CHANGELOG + CLAUDE.md in the PR).

- [ ] **Step 1: Full monorepo verification**

Run: `pnpm turbo run typecheck` — Expected: PASS, all packages.
Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm turbo run test --concurrency=1 --env-mode=loose` — Expected: PASS, all packages (`--env-mode=loose` is required — see Global Constraints).

- [ ] **Step 2: CHANGELOG entry**

Add under an `## [Unreleased]` heading (create it above the latest release heading if absent):

```markdown
### Added
- Death-cause fidelity, stage 1 — the interpretation layer (ported from the archived platform):
  - `classifyDeath` mechanism-first verdict ladder in `@onelife/domain` (starvation / dehydration /
    mauled / bled_out with high|low confidence and conditions; side-effect subtraction).
  - `life-dossier` read-model: ordeals (infected/fire/pvp encounters, HP low, builds) + the 120 s
    recent-hits window; `getLifeTimeline` and `getPlayerPage` (visible slice) now carry the verdict.
  - Obituary prompt describes the death qualitatively (hedged when confidence is low) and gains
    ordeal color + the fatal-shot distance; verdict + ordeals freeze into `articles.facts`
    (prompt version `obituary-v2`).
  - The `suspect-at-large` Morgue image category fires on a mauled verdict.
  - Web: shared `causeLabel`/`verdictPhrase`; timeline death row, funeral cards, Rap Sheet, and the
    obituary OG card render the classified verdict.
```

- [ ] **Step 3: CLAUDE.md update**

In the CLAUDE.md One Life section, add a short subsection after the R5c entry (keep it tight — the spec carries the detail):

```markdown
- **Death-cause fidelity, stage 1** ✅: the archived platform's interpretation layer, ported.
  `classifyDeath` (`@onelife/domain`, pure, mechanism-first ladder + side-effect subtraction,
  thresholds 1/1/120s) turns mechanism + death vitals + a 120 s `hit_events` window into a verdict
  (`starvation|dehydration|bled_out|mauled|…`, `high|low` confidence, conditions). Computed lazily —
  never materialized (no migration/rebuild; the `isLifeQualified` precedent) — by the new
  `life-dossier` read-model (`dossierForLife`/`getLifeDossier`/`dossierVerdict`, plus ordeals:
  encounter-collapsed infected/fire/pvp hits, hpLow, builds). Surfaces: `getLifeTimeline` +
  `getPlayerPage` visible slice → API → web (`verdictPhrase`, shared `@/lib/cause-format`) on the
  timeline death row, funeral cards, Rap Sheet + obituary OG; newsdesk facts/prompt (qualitative
  death line, hedged when low; ordeal color; `deathDistance`; prompt `obituary-v2`) freeze
  `verdict` into `articles.facts`, where the `suspect-at-large` image gate reads it. **PvP keeps the
  literal `"pvp"` everywhere.** Stage 2 (richer parser vocabulary wolf/bear/fall/vehicle + raw_lines
  backfill) is specced but not yet built: `docs/superpowers/specs/2026-07-18-death-cause-fidelity-design.md`.
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: changelog + CLAUDE.md for death-cause fidelity stage 1"
```

---

## Post-plan

After all tasks pass: use the **finishing-a-feature** skill to open the PR into `develop` (squash-merge workflow). Stage 2 (parser vocabulary + `backfill-death-causes` + priors family grouping) gets its own plan once stage 1 merges.
