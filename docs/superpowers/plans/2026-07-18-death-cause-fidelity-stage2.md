# Death-Cause Fidelity — Stage 2 (Parser Vocabulary + Backfill) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The parser names non-player killers (wolf/bear/animal/infected/fall) as first-class death causes, a backfill re-derives historical causes from `raw_lines`, and the dormant cause-substring image gates light up — per spec §5 of `docs/superpowers/specs/2026-07-18-death-cause-fidelity-design.md`.

**Architecture:** In-place cause enrichment: the non-player `killed by X` branch extracts the entity, maps it through an ordered dict co-located with the verb ladder, and emits richer `DeathCause` tokens (`wolf|bear|animal|infected|fall`; `vehicle`/`explosion` exist in the type but ship in the `environment` fallback until the prod backfill survey confirms real class names). The raw entity rides the event payload as nullish `deathEntity` (no `lives` column). A new `backfill-death-causes` script re-parses historical `player.died` events (upgrade-only, idempotent, logs unmapped entities as the survey) followed by a projection rebuild. `classifyDeath` treats the new tokens as stated mechanisms; priors group causes into families so the mode doesn't fragment.

**Tech Stack:** TypeScript ESM monorepo (pnpm + turbo), Drizzle/Postgres, vitest.

## Global Constraints

- **PvP stays literal:** the PvP branch of the parser, `"pvp"` comparisons in qualification (`packages/read-models/src/qualified.ts:15`, `qualified-lives.ts:16`), the enforcer (`apps/enforcer/src/decide.ts`), and kill-row projection (`packages/projections/src/fold.ts:84`) are untouched. The backfill NEVER rewrites a stored `pvp`/`suicide`/`bled_out`/`drowned` cause — only `environment`/`died`/`unknown` upgrade.
- **No DB migrations.** `lives.death_cause` and `articles.cause` are untyped text; `deathEntity` lives only in the event payload jsonb.
- **The three dormant image-gate regexes are the contract** (`apps/newsdesk/src/image-categories.ts`): `/wolf|bear|animal/`, `/fell|fall/`, `/vehicle|car|transport|truck/` must not change; the new cause tokens are chosen to match them.
- **Entity dict ships only confirmable patterns** (spec §5.1): `Animal_CanisLupus*`→`wolf`, `Animal_UrsusArctos*`→`bear`, other `Animal_*`→`animal`, `Zmb*`→`infected`, `FallDamage`→`fall`. Vehicle/explosion class names are unconfirmed → those lines stay `environment` (with `deathEntity` captured); the backfill's unmapped-entity survey feeds the dict later.
- **Behavioral change is intended and test-locked:** `killed by FallDamage` now parses as `fall` (previously `environment`) — the existing parser test asserting `environment` for that line MUST be updated, not worked around.
- Package code uses ESM imports with `.js` suffix; web app code uses `@/` imports without suffix.
- DB suites: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter <pkg> test` (host port 5434 — 5432 is a different project's DB). Full sweep needs `--env-mode=loose`.
- Work happens on branch `feature/death-cause-fidelity-stage2` (already created from `origin/develop`).
- **Ops runbook (documented in Task 6, executed by the operator at release):** normal deploy → run `backfill-death-causes` on the host → projection rebuild (`./deploy/deploy.sh --rebuild` or `pnpm --filter @onelife/projector run rebuild`). Frozen `articles.facts` stay coarse (forward-only articles); lives/priors/web update retroactively.

---

### Task 1: Parser — entity dict, richer tokens, `deathEntity`

**Files:**
- Modify: `packages/adm-parser/src/types.ts:1-12`
- Modify: `packages/adm-parser/src/death.ts`
- Modify: `packages/adm-parser/test/death.test.ts`
- Modify: `packages/projections/src/payloads.ts:7-9`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 2-5): `DeathCause` union widens with `"wolf" | "bear" | "animal" | "infected" | "fall" | "vehicle" | "explosion"`; `parseDeath` return and the death `ParsedLine` variant gain `deathEntity: string | null` (the raw `killed by <entity>` token; null for PvP and non-killed-by deaths). `apps/ingest-worker/src/map-events.ts` spreads the ParsedLine into the payload, so `deathEntity` reaches stored events with **no ingest change**; the projections death zod schema accepts it as `nullish` (old events stay valid).

- [ ] **Step 1: Write the failing tests**

In `packages/adm-parser/test/death.test.ts`:

1. Update the two `toEqual` assertions in the first describe to include the new field — pvp full-shape (line 6-7) gains `deathEntity: null`.
2. **Update the intended behavioral change:** in "classifies environment causes" (line 17), change

```ts
    expect(parseDeath('10:00:00 | Player "A" (DEAD) (id=A=) killed by FallDamage')?.cause).toBe("environment");
```

to

```ts
    expect(parseDeath('10:00:00 | Player "A" (DEAD) (id=A=) killed by FallDamage')?.cause).toBe("fall");
```

3. Append a new describe:

```ts
describe("parseDeath — named non-player killers (stage 2)", () => {
  const line = (killer: string) => `10:00:00 | Player "A" (DEAD) (id=A= pos=<1.0, 2.0, 3.0>) killed by ${killer}`;

  it("maps wolf, bear, other animals, infected, and falls to first-class causes", () => {
    expect(parseDeath(line("Animal_CanisLupus"))).toMatchObject({ cause: "wolf", deathEntity: "Animal_CanisLupus" });
    expect(parseDeath(line("Animal_UrsusArctos"))).toMatchObject({ cause: "bear", deathEntity: "Animal_UrsusArctos" });
    expect(parseDeath(line("Animal_GallusGallusDomesticus"))).toMatchObject({ cause: "animal", deathEntity: "Animal_GallusGallusDomesticus" });
    expect(parseDeath(line("ZmbM_CitizenASkater_Blue"))).toMatchObject({ cause: "infected", deathEntity: "ZmbM_CitizenASkater_Blue" });
    expect(parseDeath(line("FallDamage"))).toMatchObject({ cause: "fall", deathEntity: "FallDamage" });
  });

  it("an unmapped entity stays environment but keeps the entity for the survey", () => {
    expect(parseDeath(line("BarbedWireKit"))).toMatchObject({ cause: "environment", deathEntity: "BarbedWireKit" });
  });

  it("pvp and verb-only deaths carry a null deathEntity", () => {
    expect(parseDeath('10:00:00 | Player "V" (DEAD) (id=V=) killed by Player "K" (id=K=) with M4A1 from 10 meters')?.deathEntity).toBeNull();
    expect(parseDeath('10:00:00 | Player "A" (DEAD) (id=A=) died.')?.deathEntity).toBeNull();
    expect(parseDeath('10:00:00 | Player "A" (DEAD) (id=A=) bled out')?.deathEntity).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @onelife/adm-parser test`
Expected: FAIL — `deathEntity` missing from returns; `killed by FallDamage` still `environment`.

- [ ] **Step 3: Implement**

`packages/adm-parser/src/types.ts` — widen the union and the death variant:

```ts
export type DeathCause =
  | "pvp" | "bled_out" | "drowned" | "suicide" | "environment" | "died" | "unknown"
  // Stage 2 — named non-player killers. `vehicle`/`explosion` are reserved in the type; the
  // entity dict emits them only once real class names are confirmed by the backfill survey.
  | "wolf" | "bear" | "animal" | "infected" | "fall" | "vehicle" | "explosion";
```

and in the death `ParsedLine` variant, after `bleedSources: number | null`, add `; deathEntity: string | null`.

`packages/adm-parser/src/death.ts` — add below `DEATH_VERB_RE`:

```ts
const KILLED_BY_ENTITY_RE = /killed by ([A-Za-z0-9_]+)/u;
// Ordered entity dict (first match wins). Only class-name patterns confirmable from DayZ
// conventions ship; anything else stays "environment" with the entity captured — the
// backfill-death-causes survey logs unmapped entities so this dict can grow (vehicle, explosion).
const ENTITY_CAUSES: readonly [RegExp, DeathCause][] = [
  [/^Animal_CanisLupus/, "wolf"],
  [/^Animal_UrsusArctos/, "bear"],
  [/^Animal_/, "animal"],
  [/^Zmb/, "infected"],
  [/^FallDamage$/, "fall"],
];
```

Extend the return type (lines 9-13) with `deathEntity: string | null;`, add `deathEntity: null` to the PvP return (line 27-28), and replace the non-PvP cause chain + return (lines 36-49) with:

```ts
  const entity = KILLED_BY_ENTITY_RE.exec(tail)?.[1] ?? null;
  const entityCause = entity ? ENTITY_CAUSES.find(([re]) => re.test(entity))?.[1] ?? null : null;
  const cause: DeathCause =
    lower.includes("bled out") ? "bled_out" :
    lower.includes("drowned") ? "drowned" :
    lower.includes("committed suicide") ? "suicide" :
    lower.includes("killed by") ? (entityCause ?? "environment") :
    lower.includes("died") ? "died" : "unknown";

  const s = STATS_RE.exec(tail);
  const water = s ? parseFloat(s[1]!) : null;
  const energy = s ? parseFloat(s[2]!) : null;
  const bleedSources = s ? parseInt(s[3]!, 10) : null;

  return { victim: m[1]!, dayzId: m[2]!, cause, killer: null, weapon: null, distance: null,
    energy, water, bleedSources, deathEntity: lower.includes("killed by") ? entity : null };
```

`packages/projections/src/payloads.ts` — the death schema (line 7-9) gains the nullish field:

```ts
const death = z.object({ victim: z.string(), cause: z.string(), killer: z.string().nullable(),
  weapon: z.string().nullable(), distance: z.number().nullable(),
  energy: z.number().nullish(), water: z.number().nullish(), bleedSources: z.number().nullish(),
  deathEntity: z.string().nullish() });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/adm-parser test` — Expected: PASS.
Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/projections test` — Expected: PASS (payload schema change is additive).
Run: `pnpm --filter @onelife/ingest-worker test` — Expected: PASS (map-events spreads the new field with no change; if a map-events test asserts the exact death payload shape, add `deathEntity: null` to its expectation).

- [ ] **Step 5: Commit**

```bash
git add packages/adm-parser/src/types.ts packages/adm-parser/src/death.ts packages/adm-parser/test/death.test.ts packages/projections/src/payloads.ts
git commit -m "feat(adm-parser): name non-player killers — wolf/bear/animal/infected/fall causes + deathEntity"
```

(Add any ingest-worker test file you had to touch.)

---

### Task 2: `classifyDeath` — entity tokens are stated mechanisms

**Files:**
- Modify: `packages/domain/src/death-verdict.ts`
- Modify: `packages/domain/test/death-verdict.test.ts`

**Interfaces:**
- Consumes: the new cause tokens from Task 1 (as `facts.mechanism` strings).
- Produces (used by read-models/newsdesk unchanged): `DeathVerdict["cause"]` widens to the stage-1 eight values plus `"wolf" | "bear" | "animal" | "infected" | "fall" | "vehicle" | "explosion"`; new exported `const ENTITY_MECHANISMS: ReadonlySet<string>`. `DeathVerdictSummary` (a `Pick`) widens automatically.

- [ ] **Step 1: Write the failing tests**

Append to `packages/domain/test/death-verdict.test.ts`:

```ts
  it("stage-2 entity mechanisms pass through at high confidence (wolf, healthy)", () => {
    const v = classifyDeath({ mechanism: "wolf", energy: 500, water: 500, bleedSources: 2, weapon: null }, []);
    expect(v.cause).toBe("wolf");
    expect(v.confidence).toBe("high");
    expect(v.conditions).toEqual(["healthy"]); // the wolf explains its own bleed — not "bleeding"
  });

  it("entity mechanism keeps real conditions (fall while starving)", () => {
    const v = classifyDeath({ mechanism: "fall", energy: 0, water: 500, bleedSources: 0, weapon: null }, []);
    expect(v.cause).toBe("fall");
    expect(v.conditions).toEqual(["starving"]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @onelife/domain test`
Expected: FAIL — wolf falls through to the inference branch (`unknown`/`bled_out`).

- [ ] **Step 3: Implement**

In `packages/domain/src/death-verdict.ts`:

Widen the verdict union:

```ts
export interface DeathVerdict {
  cause: "pvp" | "suicide" | "starvation" | "dehydration" | "bled_out" | "mauled" | "environmental" | "unknown"
    // Stage 2 — named non-player mechanisms pass through as themselves.
    | "wolf" | "bear" | "animal" | "infected" | "fall" | "vehicle" | "explosion";
  confidence: DeathConfidence;
  conditions: string[];          // "starving" | "dehydrated" | "bleeding" | "hunted" | "drowned" | "healthy"
  basis: Record<string, unknown>;
}
```

Below the constants add:

```ts
/** Stage-2 mechanism tokens from the parser's entity dict — stated causes, never inferred over. */
export const ENTITY_MECHANISMS: ReadonlySet<string> = new Set([
  "wolf", "bear", "animal", "infected", "fall", "vehicle", "explosion",
]);
```

And in `classifyDeath`, directly after the `environment` mechanism branch (line 52), insert:

```ts
  if (facts.mechanism && ENTITY_MECHANISMS.has(facts.mechanism)) {
    // A named killer explains its own bleed/HP damage — same side-effect subtraction as above.
    return { cause: facts.mechanism as DeathVerdict["cause"], confidence: "high", conditions: withHealthy(baseConditions), basis };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/domain test` — Expected: PASS (all existing + 2 new).
Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test` — Expected: PASS (summary type widens transparently).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/death-verdict.ts packages/domain/test/death-verdict.test.ts
git commit -m "feat(domain): classifyDeath passes stage-2 entity mechanisms through as stated causes"
```

---

### Task 3: `backfill-death-causes` script

**Files:**
- Create: `apps/projector/src/backfill-death-causes.ts`
- Create: `apps/projector/test/backfill-death-causes.test.ts`

**Interfaces:**
- Consumes (Task 1): the current `parseDeath` (richer tokens + `deathEntity`).
- Produces: `backfillDeathCauses(db: Database): Promise<{ patched: number; unmapped: Record<string, number> }>` + a runnable entrypoint. Upgrade-only (`environment|died|unknown` → a more specific cause), adds `deathEntity` when missing, idempotent, and `unmapped` is the entity survey (entities still falling back to `environment`).

- [ ] **Step 1: Write the failing test**

Create `apps/projector/test/backfill-death-causes.test.ts` (harness mirrors `test/backfill-death-stats.test.ts`):

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, admFiles, rawLines, events } from "@onelife/db";
import { eq } from "drizzle-orm";
import { appendEvent } from "@onelife/event-log";
import { backfillDeathCauses } from "../src/backfill-death-causes.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 8e8;
let serverId: number;
let admFileId: number;

const WOLF_LINE = 'Player "W" (DEAD) (id=1 pos=<1.0, 2.0, 3.0>) killed by Animal_CanisLupus';
const WEIRD_LINE = 'Player "X" (DEAD) (id=2 pos=<1.0, 2.0, 3.0>) killed by BarbedWireKit';
const PVP_LINE = 'Player "V" (DEAD) (id=3) killed by Player "K" (id=4) with M4A1 from 10 meters';

async function seed(lineIndex: number, text: string, payload: Record<string, unknown>) {
  const occurredAt = new Date("2026-07-10T12:00:00Z");
  const [rl] = await db.insert(rawLines).values({ serverId, admFileId, lineIndex, text, occurredAt }).returning();
  await appendEvent(db, { serverId, admFileId, lineIndex, subIndex: 0, type: "player.died", occurredAt, payload, rawLineId: rl!.id });
  return rl!.id;
}

let wolfRawLineId: number;
let weirdRawLineId: number;
let pvpRawLineId: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "backfill-death-causes-test" }).returning();
  serverId = s!.id;
  const [f] = await db.insert(admFiles).values({ serverId, path: "y.ADM", name: "y.ADM" }).returning();
  admFileId = f!.id;
  // Historical payloads: the pre-stage-2 parser flattened both non-player killers to "environment".
  wolfRawLineId = await seed(10, WOLF_LINE, { victim: "W", cause: "environment", killer: null, weapon: null, distance: null });
  weirdRawLineId = await seed(11, WEIRD_LINE, { victim: "X", cause: "environment", killer: null, weapon: null, distance: null });
  pvpRawLineId = await seed(12, PVP_LINE, { victim: "V", cause: "pvp", killer: "K", weapon: "M4A1", distance: 10 });
});

afterAll(async () => {
  await db.delete(events).where(eq(events.serverId, serverId));
  await db.delete(rawLines).where(eq(rawLines.serverId, serverId));
  await db.delete(admFiles).where(eq(admFiles.serverId, serverId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("backfillDeathCauses", () => {
  it("upgrades environment->wolf, keeps unmapped entities as environment with a survey entry, never touches pvp", async () => {
    const { patched, unmapped } = await backfillDeathCauses(db);
    expect(patched).toBe(2); // wolf upgrade + weird deathEntity add

    const wolf = (await db.select().from(events).where(eq(events.rawLineId, wolfRawLineId)))[0]!;
    expect((wolf.payload as any).cause).toBe("wolf");
    expect((wolf.payload as any).deathEntity).toBe("Animal_CanisLupus");

    const weird = (await db.select().from(events).where(eq(events.rawLineId, weirdRawLineId)))[0]!;
    expect((weird.payload as any).cause).toBe("environment");
    expect((weird.payload as any).deathEntity).toBe("BarbedWireKit");
    expect(unmapped).toEqual({ BarbedWireKit: 1 });

    const pvp = (await db.select().from(events).where(eq(events.rawLineId, pvpRawLineId)))[0]!;
    expect((pvp.payload as any).cause).toBe("pvp");
    expect((pvp.payload as any).deathEntity).toBeUndefined();
  });

  it("is idempotent — a second run patches nothing", async () => {
    const second = await backfillDeathCauses(db);
    expect(second.patched).toBe(0);
    expect(second.unmapped).toEqual({ BarbedWireKit: 1 }); // survey still reports, patching does not repeat
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/projector test -- backfill-death-causes`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/projector/src/backfill-death-causes.ts` (modeled on `backfill-death-stats.ts`, which cannot be reused — it skips events that already carry stats):

```ts
import { eq } from "drizzle-orm";
import type { Database } from "@onelife/db";
import { events, rawLines } from "@onelife/db";
import { parseDeath } from "@onelife/adm-parser";

// Only these stored causes may be upgraded; a specific stored mechanism is never rewritten.
const UPGRADEABLE = new Set(["environment", "died", "unknown"]);

/**
 * Re-derives death causes for historical player.died events from their lossless raw lines using
 * the CURRENT parser (stage-2 entity dict). Upgrade-only + fill-only, idempotent. `unmapped`
 * counts entities that still fall back to "environment" — the survey that grows the entity dict.
 * Follow with a full projection rebuild so lives pick up the patched payloads.
 */
export async function backfillDeathCauses(db: Database): Promise<{ patched: number; unmapped: Record<string, number> }> {
  const deaths = await db.select().from(events).where(eq(events.type, "player.died"));
  let patched = 0;
  const unmapped: Record<string, number> = {};
  for (const ev of deaths) {
    const payload = ev.payload as Record<string, unknown>;
    if (ev.rawLineId == null) continue;
    const raw = (await db.select({ text: rawLines.text }).from(rawLines).where(eq(rawLines.id, ev.rawLineId)))[0];
    if (!raw) continue;
    const d = parseDeath(raw.text);
    if (!d) continue;

    if (d.deathEntity && d.cause === "environment") {
      unmapped[d.deathEntity] = (unmapped[d.deathEntity] ?? 0) + 1;
    }

    const upgradeCause =
      typeof payload.cause === "string" && UPGRADEABLE.has(payload.cause) &&
      d.cause !== payload.cause && !UPGRADEABLE.has(d.cause) && d.cause !== "died" && d.cause !== "unknown";
    const addEntity = d.deathEntity != null && payload.deathEntity == null;
    if (!upgradeCause && !addEntity) continue;

    await db.update(events).set({
      payload: { ...payload,
        ...(addEntity ? { deathEntity: d.deathEntity } : {}),
        ...(upgradeCause ? { cause: d.cause } : {}) },
    }).where(eq(events.id, ev.id));
    patched++;
  }
  return { patched, unmapped };
}

// Runnable entrypoint (mirrors backfill-death-stats).
if (import.meta.url === `file://${process.argv[1]}`) {
  const { getDb } = await import("@onelife/db");
  const { db, sql: end } = getDb(process.env.DATABASE_URL!);
  const { patched, unmapped } = await backfillDeathCauses(db);
  console.log(`[backfill-death-causes] patched ${patched} death events.`);
  const survey = Object.entries(unmapped).sort((a, b) => b[1] - a[1]);
  if (survey.length) {
    console.log(`[backfill-death-causes] unmapped entities (grow the dict from these):`);
    for (const [entity, n] of survey) console.log(`  ${entity}: ${n}`);
  }
  console.log(`Now run: corepack pnpm --filter @onelife/projector run rebuild`);
  await end.end();
  process.exit(0);
}
```

Check `apps/projector/package.json`: if `backfill-death-stats` has a script entry, add a matching `"backfill-death-causes": "tsx src/backfill-death-causes.ts"` beside it; if it has none, add none.

- [ ] **Step 4: Run tests to verify they pass**

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/projector test`
Expected: PASS (new file + all pre-existing projector tests).

- [ ] **Step 5: Commit**

```bash
git add apps/projector/src/backfill-death-causes.ts apps/projector/test/backfill-death-causes.test.ts
git commit -m "feat(projector): backfill-death-causes — re-derive historical causes + entity survey from raw_lines"
```

(Add `apps/projector/package.json` if you touched it.)

---

### Task 4: Priors cause families

**Files:**
- Modify: `packages/domain/src/death-verdict.ts` (add `causeFamily` beside the death vocab)
- Modify: `packages/domain/test/death-verdict.test.ts`
- Modify: `packages/read-models/src/player-priors.ts:57-66`
- Modify: `packages/read-models/test/player-priors.test.ts`

**Interfaces:**
- Consumes: the widened cause vocabulary.
- Produces: domain `causeFamily(cause: string): string` — `wolf`/`bear`/`animal` → `"animal"`, everything else identity. `getPlayerPriors().usualDeathCause` becomes the mode over families (its value may now be a family token like `"animal"`; `lastDeathCause` stays the raw token). Web display is automatic: `causeLabel("animal")` → "Animal".

- [ ] **Step 1: Write the failing tests**

Append to `packages/domain/test/death-verdict.test.ts`:

```ts
describe("causeFamily", () => {
  it("groups the animal kingdom, passes everything else through", () => {
    expect(causeFamily("wolf")).toBe("animal");
    expect(causeFamily("bear")).toBe("animal");
    expect(causeFamily("animal")).toBe("animal");
    expect(causeFamily("pvp")).toBe("pvp");
    expect(causeFamily("fall")).toBe("fall");
    expect(causeFamily("died")).toBe("died");
  });
});
```

(Import `causeFamily` alongside `classifyDeath`.)

In `packages/read-models/test/player-priors.test.ts`, add a test in the existing describe (reuse the file's seeding helpers/conventions — it seeds players/lives directly):

```ts
  it("usualDeathCause groups cause families so wolf+bear beats pvp", async () => {
    // seed a fresh player with 3 ended prior lives: wolf, bear, pvp (follow the file's existing
    // insert pattern for players + lives with distinct startedAt values before `now`)
    // ...
    const priors = await getPlayerPriors(db, /* that gamertag */, now);
    expect(priors.usualDeathCause).toBe("animal"); // wolf(1)+bear(1) family beats pvp(1)
  });
```

Use the file's actual variable names and seeding helpers; the assertion is the contract.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @onelife/domain test` — FAIL (`causeFamily` not exported).
Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test -- player-priors` — FAIL (mode over raw tokens picks any of the three).

- [ ] **Step 3: Implement**

In `packages/domain/src/death-verdict.ts`, below `ENTITY_MECHANISMS`:

```ts
/**
 * Cause family for aggregation (the priors mode): the finer stage-2 vocabulary must not fragment
 * "usual end" — wolf x2 + bear x1 should still beat pvp x2 as "animal". Display labels stay
 * specific; only aggregation groups.
 */
export function causeFamily(cause: string): string {
  if (cause === "wolf" || cause === "bear" || cause === "animal") return "animal";
  return cause;
}
```

In `packages/read-models/src/player-priors.ts`, import it (`import { causeFamily } from "@onelife/domain";`) and change the mode loop (lines 58-61):

```ts
  // usual death cause = mode across non-null cause FAMILIES (wolf/bear/animal group as "animal";
  // first-inserted wins on a tie -> oldest life)
  const counts = new Map<string, number>();
  for (const l of priorLives) {
    if (l.deathCause) {
      const fam = causeFamily(l.deathCause);
      counts.set(fam, (counts.get(fam) ?? 0) + 1);
    }
  }
```

(`usualDeathCause` selection below is unchanged — it now selects a family token.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/domain test` and `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test`
Expected: PASS (whole suites — pre-existing priors tests use causes like pvp/environment where family = identity, so their expectations hold).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/death-verdict.ts packages/domain/test/death-verdict.test.ts packages/read-models/src/player-priors.ts packages/read-models/test/player-priors.test.ts
git commit -m "feat(read-models): usual death cause aggregates over cause families (wolf+bear -> animal)"
```

---

### Task 5: Labels, prose, and gate proof

**Files:**
- Modify: `apps/web/src/lib/cause-format.ts` + `apps/web/src/lib/cause-format.test.ts`
- Modify: `apps/newsdesk/src/prompt.ts` (describeDeath noun map) + `apps/newsdesk/test/prompt.test.ts`
- Modify: `apps/newsdesk/test/image-categories.test.ts` (proof tests only — NO gate code change)

**Interfaces:**
- Consumes: the new cause tokens flowing through `lives.death_cause` → API → web, and through obituary facts.
- Produces: `causeLabel("fall")` → `"Fell"`; `causeLabel("died")` → `"Unknown"` (the ratified "Died — Died" fix); other new tokens title-case generically ("Wolf", "Bear", "Infected"). `describeDeath` gains qualitative nouns for the seven entity tokens. The three dormant image gates are proven live by tests with zero gate changes.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/cause-format.test.ts` — add to the `causeLabel` describe:

```ts
  it("stage-2 tokens read naturally", () => {
    expect(causeLabel("wolf")).toBe("Wolf");
    expect(causeLabel("fall")).toBe("Fell");
    expect(causeLabel("died")).toBe("Unknown"); // "Died — Died" fix: a bare died mechanism is an unknown end
  });
```

and to the `verdictPhrase` describe:

```ts
  it("entity verdicts label through causeLabel (never hedged — stated mechanisms)", () => {
    expect(verdictPhrase(v("wolf"), "wolf")).toBe("Wolf");
    expect(verdictPhrase(v("fall"), "fall")).toBe("Fell");
  });
```

`apps/newsdesk/test/prompt.test.ts` — add:

```ts
  it("describeDeath: named killers read qualitatively", () => {
    expect(describeDeath(mkFacts({ causeCategory: "environment", cause: "wolf", verdict: { cause: "wolf", confidence: "high", conditions: ["healthy"] } })))
      .toBe("killed by a wolf (not a player kill). They were in good health at the end.");
    expect(describeDeath(mkFacts({ causeCategory: "environment", cause: "fall", verdict: { cause: "fall", confidence: "high", conditions: [] } })))
      .toBe("died in a fall (not a player kill).");
  });
```

`apps/newsdesk/test/image-categories.test.ts` — add:

```ts
  it("stage-2 cause tokens light the dormant gates with zero gate changes", () => {
    const slugs = (cause: string) =>
      eligibleCategories("obituary", { causeCategory: "environment", cause }).map((c) => c.slug);
    expect(slugs("wolf")).toContain("suspect-at-large");
    expect(slugs("bear")).toContain("suspect-at-large");
    expect(slugs("fall")).toContain("gravity-undefeated");
    expect(slugs("vehicle")).toContain("driver-not-pictured"); // reserved token, gate ready
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @onelife/web test -- cause-format` — FAIL ("Fall" not "Fell"; "Died" not "Unknown").
Run: `pnpm --filter @onelife/newsdesk test -- prompt image-categories` — describeDeath cases FAIL ("wolf (not a player kill)." — no noun); the gate test should already PASS (regex contract) — if it fails, the gates changed and that is a bug.

- [ ] **Step 3: Implement**

`apps/web/src/lib/cause-format.ts` — extend `causeLabel`:

```ts
export function causeLabel(cause: string | null): string {
  if (cause === "pvp") return "Killed";
  if (cause === "fall") return "Fell";
  if (cause === "died") return "Unknown"; // a bare "died" mechanism says nothing — read it as unknown
  if (!cause) return "Unknown";
  return cause.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
```

(`verdictPhrase` needs no change — entity verdicts have no `VERDICT_NOUN` entry and fall back to `causeLabel(cause)`, and stated mechanisms are always high-confidence so the hedge never applies.)

`apps/newsdesk/src/prompt.ts` — in `describeDeath`'s `noun` map, add before `environmental`:

```ts
    wolf: "killed by a wolf",
    bear: "killed by a bear",
    animal: "killed by a wild animal",
    infected: "killed by the infected",
    fall: "died in a fall",
    vehicle: "killed by a vehicle",
    explosion: "killed in an explosion",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/web test` and `pnpm --filter @onelife/newsdesk test`
Expected: PASS — whole suites. If any pre-existing web test asserted `causeLabel("died") === "Died"` or a "Died" Rap-Sheet value from a died-mechanism fixture, update it to "Unknown" (this is the ratified behavior change; note each such edit in your report).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/cause-format.ts apps/web/src/lib/cause-format.test.ts apps/newsdesk/src/prompt.ts apps/newsdesk/test/prompt.test.ts apps/newsdesk/test/image-categories.test.ts
git commit -m "feat(web,newsdesk): stage-2 cause labels + qualitative nouns; dormant image gates proven live"
```

---

### Task 6: Full verification + CHANGELOG + CLAUDE.md (runbook)

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the PR-ready branch (guard requires CHANGELOG + CLAUDE.md changes).

- [ ] **Step 1: Full monorepo verification**

Run: `pnpm turbo run typecheck` — Expected: PASS 21/21.
Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm turbo run test --concurrency=1 --env-mode=loose` — Expected: PASS all packages (`--env-mode=loose` REQUIRED — strict mode strips the var and DB suites hit the wrong Postgres).
If anything fails, STOP and report BLOCKED — do not fix product code in this task.

- [ ] **Step 2: CHANGELOG entry**

Under `## [Unreleased]` → `### Added`:

```markdown
- Death-cause fidelity, stage 2 — richer parser vocabulary + backfill:
  - The parser names non-player killers: `wolf` / `bear` / `animal` (other `Animal_*`) /
    `infected` (`Zmb*`) / `fall` (`FallDamage`) become first-class death causes (previously all
    `environment`); the raw entity rides event payloads as `deathEntity`. `vehicle`/`explosion`
    are reserved tokens pending the prod entity survey.
  - `backfill-death-causes` (apps/projector): re-derives historical causes from `raw_lines`
    (upgrade-only — stored `pvp`/`suicide`/`bled_out`/`drowned` never rewritten; idempotent) and
    prints the unmapped-entity survey that grows the dict. Run it + a projection rebuild after
    deploy (see CLAUDE.md runbook).
  - `classifyDeath` passes the new tokens through as stated mechanisms; priors' "usual end"
    aggregates over cause families (wolf + bear count together as "animal").
  - The three dormant Morgue image gates (`suspect-at-large`, `gravity-undefeated`,
    `driver-not-pictured`) light up on the new tokens with zero gate changes.
  - Labels: `causeLabel("fall")` → "Fell"; a bare `died` mechanism now labels "Unknown"
    (fixes "Died — Died"); obituary prompts describe named killers qualitatively.
```

- [ ] **Step 3: CLAUDE.md update**

Replace the stage-1 bullet's final sentence ("Stage 2 (richer parser vocabulary…) is specced but not yet built: …") with:

```markdown
  **Stage 2 shipped — richer parser vocabulary + backfill.** The parser's non-player `killed by X`
  branch maps entities through an ordered dict (`Animal_CanisLupus*`→`wolf`,
  `Animal_UrsusArctos*`→`bear`, other `Animal_*`→`animal`, `Zmb*`→`infected`, `FallDamage`→`fall`;
  unmapped→`environment`; `vehicle`/`explosion` reserved in the type pending the survey) and
  captures the raw entity as `deathEntity` on the event payload (no `lives` column, zod `nullish`).
  The dormant image gates fire on the new tokens with zero gate changes; `classifyDeath` passes
  them through as stated mechanisms; priors' `usualDeathCause` aggregates over `causeFamily`
  (`@onelife/domain` — wolf/bear/animal → "animal"); `causeLabel` reads `fall` as "Fell" and a
  bare `died` as "Unknown". **Deploy runbook (stage-2 release):** normal deploy → on the host run
  `apps/projector` `backfill-death-causes` (re-parses `raw_lines`, upgrade-only, prints the
  unmapped-entity survey — feed it back into the dict) → projection rebuild
  (`./deploy/deploy.sh --rebuild`). Frozen `articles.facts` stay coarse (forward-only); lives,
  priors, and web surfaces update retroactively.
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: changelog + CLAUDE.md for death-cause fidelity stage 2"
```

---

## Post-plan

After all tasks pass: final whole-branch review → **finishing-a-feature** (PR into `develop`) → release. The release's prod rollout carries the backfill + `--rebuild` runbook (operator host-side action).
