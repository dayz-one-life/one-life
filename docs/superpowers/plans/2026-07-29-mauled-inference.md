# Mauled Inference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify bare-`died` DayZ deaths caused by infected as `mauled` instead of `unknown`, by parsing the `is unconscious` ADM lines nothing currently reads and requiring corroborated evidence.

**Architecture:** A new `parseUnconscious` ADM parser feeds a new `player.unconscious` event, folded into a new `unconscious_events` projection table. `classifyDeath` replaces its `bleedSources > 0` gate with `hunted AND (bleeding OR wentUnconscious OR terminalHp <= 1)`. A `backfill-unconscious` projector command re-parses historical `raw_lines` so the fix applies retroactively.

**Tech Stack:** TypeScript ESM, pnpm workspaces + turbo, Postgres + Drizzle ORM, vitest, zod.

**Spec:** `docs/superpowers/specs/2026-07-29-mauled-inference-design.md`

## Global Constraints

- **Migration number is `0031`** — `0030_articles_revival` is the highest existing. Migrations are **hand-written SQL** in `packages/db/drizzle/`, plus an entry in `packages/db/drizzle/meta/_journal.json`.
- **`unconscious_events` MUST NOT be added to `REBUILD_TRUNCATE_TABLES`** (`apps/projector/src/rebuild.ts`). It is cleared via `RESTART IDENTITY CASCADE` through its FK to `players`. Naming a table the same release creates aborts the rebuild phase, which runs *before* migrate — this broke the v0.42.1 deploy.
- **`parseUnconscious` MUST be dispatched AFTER `parsePosition`** in `parseLine`. `subIndex` is the array position; all 63 historical unconscious lines already hold `player.position` at `subIndex 0`.
- **`playerId` is `notNull` with a real FK to `players.id`**, and the fold returns early when the player is unresolvable — the `positions` pattern, not the `hit_events` pattern.
- Run tests with `pnpm --filter <pkg> test`. DB suites need `TEST_DATABASE_URL`.
- Every file uses ESM imports with explicit `.js` extensions.
- Do NOT run any deploy, migration against production, or `git push`. Commit locally only.

---

### Task 1: Parse the unconscious ADM lines

**Files:**
- Create: `packages/adm-parser/src/unconscious.ts`
- Create: `packages/adm-parser/test/unconscious.test.ts`
- Modify: `packages/adm-parser/src/types.ts` (add to the `ParsedLine` union)
- Modify: `packages/adm-parser/src/index.ts` (add the export)
- Modify: `packages/adm-parser/src/parse-line.ts` (dispatch, AFTER position)
- Modify: `packages/adm-parser/test/parse-line.test.ts` (ordering test)

**Interfaces:**
- Consumes: `parsePos` from `./coords.js`
- Produces: `parseUnconscious(raw: string): { gamertag: string; disconnecting: boolean; x: number | null; y: number | null } | null`, and a new `ParsedLine` member `{ kind: "unconscious"; gamertag: string; disconnecting: boolean; x: number | null; y: number | null }`

- [ ] **Step 1: Write the failing parser test**

Create `packages/adm-parser/test/unconscious.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseUnconscious } from "../src/unconscious.js";

describe("parseUnconscious", () => {
  it("parses a plain unconscious line", () => {
    const raw = `09:25:31 | Player "XxBE4zyxX" (id=D34AD4C2D9A2D1068C2B4971CAA01177C20B24C1 pos=<5963.2, 4071.0, 397.1>) is unconscious`;
    expect(parseUnconscious(raw)).toEqual({
      gamertag: "XxBE4zyxX", disconnecting: false, x: 5963.2, y: 4071.0,
    });
  });

  it("parses the combat-log form and flags it", () => {
    const raw = `09:25:58 | Player "XxBE4zyxX" (id=D34AD4C2D9A2D1068C2B4971CAA01177C20B24C1 pos=<5965.9, 4069.1, 397.1>) is disconnecting while being unconscious`;
    expect(parseUnconscious(raw)).toEqual({
      gamertag: "XxBE4zyxX", disconnecting: true, x: 5965.9, y: 4069.1,
    });
  });

  // A corpse line is post-death noise, not evidence about a living player.
  it("ignores a (DEAD) unconscious line", () => {
    const raw = `10:01:02 | Player "Cee Lo GREEN 96" (DEAD) (pos=<8186.4, 12779.7, 116.9>) is unconscious`;
    expect(parseUnconscious(raw)).toBeNull();
  });

  // We record going DOWN, not a consciousness state machine. 45 such lines exist in prod.
  it("ignores a regained-consciousness line", () => {
    const raw = `09:26:40 | Player "XxBE4zyxX" (id=D34AD4C2 pos=<5965.9, 4069.1, 397.1>) regained consciousness`;
    expect(parseUnconscious(raw)).toBeNull();
  });

  it("returns null for an unrelated line", () => {
    expect(parseUnconscious(`09:25:44 | Player "X" (id=A pos=<1, 2, 3>) has been disconnected`)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @onelife/adm-parser test -- unconscious`
Expected: FAIL — cannot resolve `../src/unconscious.js`.

- [ ] **Step 3: Implement the parser**

Create `packages/adm-parser/src/unconscious.ts`:

```ts
import { parsePos } from "./coords.js";

const GAMERTAG_RE = /Player "([^"]+)"/u;
const DEAD_RE = /\(DEAD\)/u;

/**
 * `is unconscious` / `is disconnecting while being unconscious`.
 *
 * Infected deal SHOCK, which never appears in the `[HP: …]` field — a player is knocked out at
 * near-full health and DayZ then kills them for logging out unconscious. That is why this line,
 * not an HP threshold, is the signal that an infected mauling turned lethal.
 *
 * Deliberately NOT matched: `regained consciousness` (we record going down, not a state machine)
 * and `(DEAD) … is unconscious` (a corpse line, post-death noise).
 */
export function parseUnconscious(raw: string): {
  gamertag: string; disconnecting: boolean; x: number | null; y: number | null;
} | null {
  if (!raw.includes("unconscious")) return null;
  if (DEAD_RE.test(raw)) return null;

  const disconnecting = raw.includes("is disconnecting while being unconscious");
  if (!disconnecting && !raw.includes("is unconscious")) return null;

  const g = GAMERTAG_RE.exec(raw);
  if (!g) return null;

  const c = parsePos(raw);
  return { gamertag: g[1]!, disconnecting, x: c?.x ?? null, y: c?.y ?? null };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm --filter @onelife/adm-parser test -- unconscious`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the ParsedLine member**

In `packages/adm-parser/src/types.ts`, add this member to the `ParsedLine` union, immediately after the `hit` member:

```ts
  | { kind: "unconscious"; gamertag: string; disconnecting: boolean; x: number | null; y: number | null }
```

- [ ] **Step 6: Export the module**

In `packages/adm-parser/src/index.ts`, add after the `./hit.js` line:

```ts
export * from "./unconscious.js";
```

- [ ] **Step 7: Write the failing dispatch-ordering test**

Append to `packages/adm-parser/test/parse-line.test.ts`:

```ts
// ⚠️ subIndex is the ARRAY POSITION of the parsed result (apps/ingest-worker/src/process-file.ts).
// All 63 historical unconscious lines already hold player.position at subIndex 0. Dispatching
// unconscious BEFORE position renumbers position to 1 and collides with events_idempotency_uniq
// on every one of them, breaking the backfill. Position MUST stay first.
it("emits position before unconscious so historical subIndex 0 is preserved", () => {
  const raw = `09:25:31 | Player "XxBE4zyxX" (id=D34AD4C2 pos=<5963.2, 4071.0, 397.1>) is unconscious`;
  const out = parseLine(raw);
  expect(out.map((p) => p.kind)).toEqual(["position", "unconscious"]);
});
```

- [ ] **Step 8: Run it and confirm it fails**

Run: `pnpm --filter @onelife/adm-parser test -- parse-line`
Expected: FAIL — received `["position"]`, unconscious not dispatched.

- [ ] **Step 9: Add the dispatch**

In `packages/adm-parser/src/parse-line.ts`, change the doc comment and append the parser AFTER position:

```ts
/** Every ParsedLine a single raw line yields. Primary event(s) first, then position.
 *  ⚠️ EXCEPTION — `unconscious` is dispatched AFTER position, breaking that convention on
 *  purpose: subIndex is this array's index, and every historical unconscious line already
 *  stored player.position at subIndex 0. Putting it first renumbers those and collides with
 *  events_idempotency_uniq. Do not "tidy" it back above position. */
```

Then, after the `position` block and before `return out;`:

```ts
  const unconscious = parseUnconscious(raw);
  if (unconscious) out.push({ kind: "unconscious", ...unconscious });
```

And add the import at the top:

```ts
import { parseUnconscious } from "./unconscious.js";
```

- [ ] **Step 10: Run the full parser suite**

Run: `pnpm --filter @onelife/adm-parser test`
Expected: PASS, all files.

- [ ] **Step 11: Commit**

```bash
git add packages/adm-parser/src/unconscious.ts packages/adm-parser/test/unconscious.test.ts packages/adm-parser/src/types.ts packages/adm-parser/src/index.ts packages/adm-parser/src/parse-line.ts packages/adm-parser/test/parse-line.test.ts
git commit -m "feat(adm-parser): parse unconscious lines"
```

---

### Task 2: Add the `player.unconscious` event type

**Files:**
- Modify: `packages/domain/src/events.ts`
- Modify: `apps/ingest-worker/src/map-events.ts`
- Modify: `apps/ingest-worker/test/map-events.test.ts`

**Interfaces:**
- Consumes: the `kind: "unconscious"` `ParsedLine` member from Task 1.
- Produces: `EventType` literal `"player.unconscious"`, emitted by `mapParsedToEvents` with payload `{ gamertag, disconnecting, x, y }`.

- [ ] **Step 1: Write the failing mapping test**

Append to `apps/ingest-worker/test/map-events.test.ts`:

```ts
it("maps an unconscious ParsedLine to player.unconscious", () => {
  const out = mapParsedToEvents([
    { kind: "unconscious", gamertag: "XxBE4zyxX", disconnecting: true, x: 1, y: 2 },
  ]);
  expect(out).toEqual([
    { type: "player.unconscious", payload: { gamertag: "XxBE4zyxX", disconnecting: true, x: 1, y: 2 } },
  ]);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @onelife/ingest-worker test -- map-events`
Expected: FAIL — `type` is `undefined` (no `KIND_TO_TYPE` entry).

- [ ] **Step 3: Add the event type**

In `packages/domain/src/events.ts`, add to `EVENT_TYPES` after `"player.hit"`:

```ts
  "player.unconscious",
```

- [ ] **Step 4: Add the mapping**

In `apps/ingest-worker/src/map-events.ts`, add to `KIND_TO_TYPE` after the `hit` line:

```ts
  unconscious: "player.unconscious",
```

Note: `KIND_TO_TYPE` is typed `Record<ParsedLine["kind"], EventType>`, so omitting this is a compile error, not a runtime surprise.

- [ ] **Step 5: Run the test and typecheck**

Run: `pnpm --filter @onelife/ingest-worker test -- map-events && pnpm --filter @onelife/ingest-worker typecheck`
Expected: PASS both.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/events.ts apps/ingest-worker/src/map-events.ts apps/ingest-worker/test/map-events.test.ts
git commit -m "feat(domain): add player.unconscious event type"
```

---

### Task 3: Create the `unconscious_events` table

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/drizzle/0031_unconscious_events.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`

**Interfaces:**
- Produces: the `unconsciousEvents` Drizzle table export with columns `id, serverId, playerId, gamertag, disconnecting, occurredAt`.

- [ ] **Step 1: Add the schema table**

In `packages/db/src/schema.ts`, add immediately after the `positions` table definition (around line 203):

```ts
// PROJECTION table (rebuilt from the event log), NOT durable.
// ⚠️ Deliberately absent from REBUILD_TRUNCATE_TABLES: the FK to `players` means
// TRUNCATE players … RESTART IDENTITY CASCADE clears this for free. Naming a table the
// same release creates aborts the rebuild phase, which runs BEFORE migrate.
// playerId is notNull + FK (the `positions` pattern), and the fold returns early on an
// unresolvable player — never the nullable bare-bigint `hit_events` pattern, which would
// leave rows the cascade cannot reach.
export const unconsciousEvents = pgTable("unconscious_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serverId: integer("server_id").notNull().references(() => servers.id),
  playerId: bigint("player_id", { mode: "number" }).notNull().references(() => players.id),
  gamertag: text("gamertag").notNull(),
  disconnecting: boolean("disconnecting").notNull().default(false),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
}, (t) => ({
  byPlayer: index("unconscious_events_player_idx").on(t.serverId, t.playerId, t.occurredAt),
  uniq: uniqueIndex("unconscious_events_natural_uniq").on(t.serverId, t.playerId, t.occurredAt),
}));
```

- [ ] **Step 2: Write the migration SQL**

Create `packages/db/drizzle/0031_unconscious_events.sql`:

```sql
-- Mauled inference: record when a player was knocked unconscious.
-- Infected deal SHOCK, which never appears in the ADM `[HP: …]` field, so a player can be
-- knocked out at near-full health and then killed by DayZ for logging out unconscious. This
-- line is the evidence that an infected mauling turned lethal; `bleedSources` and HP both miss it.
--
-- PROJECTION table: rebuilt from the event log, NOT in APP_TABLES.
-- ⚠️ Deliberately NOT added to REBUILD_TRUNCATE_TABLES — the FK to `players` means
-- TRUNCATE players … RESTART IDENTITY CASCADE already clears it. Naming a newly-created table
-- in that list aborts the rebuild phase (which runs BEFORE migrate) and kills the deploy
-- mid-flight with the fleet already stopped.
CREATE TABLE "unconscious_events" (
  "id" bigserial PRIMARY KEY,
  "server_id" integer NOT NULL REFERENCES "servers"("id"),
  "player_id" bigint NOT NULL REFERENCES "players"("id"),
  "gamertag" text NOT NULL,
  "disconnecting" boolean NOT NULL DEFAULT false,
  "occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "unconscious_events_player_idx" ON "unconscious_events" ("server_id", "player_id", "occurred_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "unconscious_events_natural_uniq" ON "unconscious_events" ("server_id", "player_id", "occurred_at");
```

- [ ] **Step 3: Add the journal entry**

In `packages/db/drizzle/meta/_journal.json`, append to the `entries` array after the `0030_articles_revival` entry:

```json
{
  "idx": 31,
  "version": "7",
  "when": 1786080000000,
  "tag": "0031_unconscious_events",
  "breakpoints": true
}
```

- [ ] **Step 4: Verify the migration applies to a scratch DB**

Run: `DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate`
Expected: applies `0031_unconscious_events` with no error.

Note: `drizzle-kit` reads `DATABASE_URL` and nothing else — naming it explicitly is required.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @onelife/db typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/0031_unconscious_events.sql packages/db/drizzle/meta/_journal.json
git commit -m "feat(db): add unconscious_events projection table"
```

---

### Task 4: Fold `player.unconscious` into the projection

**Files:**
- Modify: `packages/projections/src/types.ts` (add `UnconsciousInput`)
- Modify: `packages/projections/src/store.ts` (add `insertUnconscious`)
- Modify: `packages/projections/src/memory-store.ts`
- Modify: `packages/projections/src/fold.ts`
- Modify: `apps/projector/src/pg-store.ts`
- Create: `packages/projections/test/fold-unconscious.test.ts`

**Interfaces:**
- Consumes: `EventType` `"player.unconscious"` (Task 2), `unconsciousEvents` table (Task 3).
- Produces: `UnconsciousInput = { serverId: number; playerId: number; gamertag: string; disconnecting: boolean; occurredAt: Date }` and `ProjectionStore.insertUnconscious(u: UnconsciousInput): Promise<void>`, plus `MemoryStore.unconscious: UnconsciousInput[]`.

- [ ] **Step 1: Write the failing fold test**

Create `packages/projections/test/fold-unconscious.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { MemoryStore, applyEvent } from "../src/index.js";
import type { ProjectionEvent } from "../src/index.js";

const at = (s: string) => new Date(s);

describe("fold player.unconscious", () => {
  // ⚠️ fold.ts's switch ends in `default: return`, so a MISSING case is silently ignored
  // rather than throwing. This test is the only thing that catches that.
  it("records an unconscious event for a known player", async () => {
    const s = new MemoryStore();
    await applyEvent(s, { id: 1, serverId: 3, type: "player.connected",
      occurredAt: at("2026-07-17T16:00:00Z"), payload: { gamertag: "XxBE4zyxX", dayzId: "D34=" } });
    const ev: ProjectionEvent = { id: 2, serverId: 3, type: "player.unconscious",
      occurredAt: at("2026-07-17T16:25:31Z"),
      payload: { gamertag: "XxBE4zyxX", disconnecting: true, x: 1, y: 2 } };
    await applyEvent(s, ev);
    expect(s.unconscious.length).toBe(1);
    expect(s.unconscious[0]).toMatchObject({
      serverId: 3, gamertag: "XxBE4zyxX", disconnecting: true,
      occurredAt: at("2026-07-17T16:25:31Z"),
    });
  });

  // The `positions` pattern: playerId is notNull + FK, so an unresolvable player must be
  // skipped, never inserted as null. Inserting would violate the FK inside the fold
  // transaction, and an event-log fold retries a failure forever — a crash loop.
  it("no-ops for an unknown gamertag", async () => {
    const s = new MemoryStore();
    await applyEvent(s, { id: 1, serverId: 3, type: "player.unconscious",
      occurredAt: at("2026-07-17T16:25:31Z"),
      payload: { gamertag: "NeverSeen", disconnecting: false, x: null, y: null } });
    expect(s.unconscious.length).toBe(0);
  });
});
```

Note: the fold entrypoint is **`applyEvent`**, exported from `../src/index.js` — not `foldEvent`,
and not imported from `fold.js`. `ProjectionEvent` requires an **`id`**. Players are seeded by
folding a `player.connected` event, never by calling `store.createPlayer` directly. All three
match `packages/projections/test/fold-hit-position.test.ts`.

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @onelife/projections test -- fold-unconscious`
Expected: FAIL — `store.unconscious` is undefined.

- [ ] **Step 3: Add the input type**

In `packages/projections/src/types.ts`, add after `PositionInput`:

```ts
export type UnconsciousInput = { serverId: number; playerId: number; gamertag: string; disconnecting: boolean; occurredAt: Date };
```

- [ ] **Step 4: Add it to the store interface**

In `packages/projections/src/store.ts`, add `UnconsciousInput` to the type import list, and add after `insertPosition`:

```ts
  insertUnconscious(u: UnconsciousInput): Promise<void>;
```

- [ ] **Step 5: Implement in the memory store**

In `packages/projections/src/memory-store.ts`, add a public field alongside the other collections:

```ts
  unconscious: UnconsciousInput[] = [];
```

and the method after `insertPosition`:

```ts
  async insertUnconscious(u: UnconsciousInput): Promise<void> { this.unconscious.push(u); }
```

Add `UnconsciousInput` to the type import at the top.

- [ ] **Step 6: Implement in the pg store**

In `apps/projector/src/pg-store.ts`, add `unconsciousEvents` to the `@onelife/db` import and add after `insertPosition`:

```ts
  async insertUnconscious(u: UnconsciousInput): Promise<void> {
    // onConflictDoNothing: the backfill re-appends historical events, and the fold is
    // at-least-once. The natural key (server, player, occurredAt) makes a repeat a no-op.
    await this.tx.insert(unconsciousEvents).values(u).onConflictDoNothing();
  }
```

Add `UnconsciousInput` to the type import from `@onelife/projections`.

- [ ] **Step 7: Add the fold handler**

In `packages/projections/src/fold.ts`, add the case to the switch, after `case "player.position":`:

```ts
    case "player.unconscious": return onUnconscious(store, e);
```

and the handler, after `onPosition`:

```ts
async function onUnconscious(store: ProjectionStore, e: ProjectionEvent): Promise<void> {
  const gamertag = String(e.payload.gamertag);
  const player = await store.getPlayer(gamertag);
  if (!player) return;                               // no-op for unknown gamertag (positions pattern)
  await store.insertUnconscious({
    serverId: e.serverId, playerId: player.id, gamertag: player.gamertag,
    disconnecting: e.payload.disconnecting === true,
    occurredAt: e.occurredAt,
  });
}
```

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @onelife/projections test && pnpm --filter @onelife/projector typecheck`
Expected: PASS both.

- [ ] **Step 9: Verify the table is NOT in the truncate list**

Run: `grep -n "unconscious" apps/projector/src/rebuild.ts`
Expected: **no output.** If it matches, remove it — see Global Constraints.

- [ ] **Step 10: Test that the cascade actually clears it**

The single-release deploy rests on `TRUNCATE players … CASCADE` reaching this table through its
FK. That is an assumption about the schema, and it silently becomes false if the FK is ever
dropped — so it needs a real DB assertion, not a grep. Add to `apps/projector/test/` (mirror the
DB-harness setup of an existing test there):

```ts
// unconscious_events is deliberately ABSENT from REBUILD_TRUNCATE_TABLES — it is cleared via the
// FK to players by RESTART IDENTITY CASCADE. Naming a newly-created table in that list aborts the
// rebuild phase, which runs BEFORE migrate (this killed the v0.42.1 deploy). If someone drops the
// FK, the cascade stops reaching it and rows survive a rebuild forever — this test is the alarm.
it("rebuildAll clears unconscious_events via the players cascade", async () => {
  // seed: a server, a player, one unconscious_events row
  await rebuildAll(db);
  const rows = await db.select().from(unconsciousEvents);
  expect(rows).toHaveLength(0);
});
```

- [ ] **Step 10: Commit**

```bash
git add packages/projections/src apps/projector/src/pg-store.ts packages/projections/test/fold-unconscious.test.ts
git commit -m "feat(projections): fold player.unconscious into unconscious_events"
```

---

### Task 5: The classifier rung

**Files:**
- Modify: `packages/domain/src/death-verdict.ts`
- Modify: `packages/domain/test/death-verdict.test.ts`

**Interfaces:**
- Produces: `RecentUnconscious = { secondsBeforeDeath: number; disconnecting: boolean }`, exported from `@onelife/domain`; `classifyDeath(facts, recentHits, recentUnconscious)` — a **required** third parameter.

- [ ] **Step 1: Write the failing classifier tests**

Append to `packages/domain/test/death-verdict.test.ts`:

```ts
describe("mauled inference (corroborated)", () => {
  const base = { mechanism: "died", energy: 500, water: 500, bleedSources: 0, weapon: null };
  const infectedHit = (secondsBeforeDeath: number, victimHp: number) =>
    ({ attackerType: "infected", attackerLabel: "Infected", secondsBeforeDeath, victimHp });

  // Life 165: 18 infected hits, died at HP 88 after logging out unconscious. Shock never
  // appears in the HP field, so only the unconscious line proves this was the infected.
  it("uses an unconscious line as corroboration when bleeding is 0 and HP is high", () => {
    const v = classifyDeath(base, [infectedHit(5, 88.31)], [{ secondsBeforeDeath: 0, disconnecting: true }]);
    expect(v.cause).toBe("mauled");
  });

  // Life 313 (GreenGreg420) — the real numbers. No unconscious line; the infected left him
  // at 0.392 HP and he expired 88s later with bleeding already closed.
  it("uses terminal HP as corroboration when there is no unconscious line", () => {
    const v = classifyDeath(
      { ...base, energy: 286.571, water: 572.133 },
      [infectedHit(88, 0.392355), infectedHit(89, 2.33781)],
      [],
    );
    expect(v.cause).toBe("mauled");
    expect(v.conditions).toContain("hunted");
  });

  // Guards against simply deleting the gate: a scratch is not a mauling.
  it("stays unknown for an uncorroborated scratch", () => {
    const v = classifyDeath(base, [infectedHit(110, 45)], []);
    expect(v.cause).toBe("unknown");
  });

  it("keeps starvation above the mauled rung", () => {
    const v = classifyDeath({ ...base, energy: 0 }, [infectedHit(10, 5)], [{ secondsBeforeDeath: 5, disconnecting: false }]);
    expect(v.cause).toBe("starvation");
    expect(v.conditions).toContain("hunted");
  });

  it("keeps a fatal fall above the mauled rung", () => {
    const v = classifyDeath(
      base,
      [{ attackerType: "environment", attackerLabel: "FallDamageHealth", secondsBeforeDeath: 2, victimHp: 0 }, infectedHit(30, 40)],
      [{ secondsBeforeDeath: 3, disconnecting: false }],
    );
    expect(v.cause).toBe("fall");
  });

  it("still reads a non-infected bleeding death as bled_out", () => {
    const v = classifyDeath(
      { ...base, bleedSources: 2 },
      [{ attackerType: "environment", attackerLabel: "Barbed", secondsBeforeDeath: 10, victimHp: 20 }],
      [],
    );
    expect(v.cause).toBe("bled_out");
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `pnpm --filter @onelife/domain test -- death-verdict`
Expected: FAIL — `classifyDeath` takes 2 arguments; the first two cases return `unknown`.

- [ ] **Step 3: Add the type and change the signature**

In `packages/domain/src/death-verdict.ts`, add after the `RecentHit` interface:

```ts
/** A knockout in the death window. Infected deal SHOCK, which never appears in the ADM `[HP: …]`
 *  field — a player is knocked out at near-full health and DayZ then kills them for logging out
 *  unconscious. `disconnecting` records the combat-log form; the rule treats both alike. */
export interface RecentUnconscious {
  secondsBeforeDeath: number;
  disconnecting: boolean;
}

/** HP at or below this counts as "left at effectively zero health". Distinct from the fall
 *  rung's `<= 0` (a fall lands its own killing blow; infected stop just short). */
export const TERMINAL_HP_MAX = 1;
```

Change the signature (note: **no default** — a caller must actively pass `[]`, mirroring the
non-optional `sampleAgeSeconds` precedent, so evidence cannot be silently dropped):

```ts
export function classifyDeath(
  facts: DeathRawFacts,
  recentHits: RecentHit[],
  recentUnconscious: RecentUnconscious[],
): DeathVerdict {
```

- [ ] **Step 4: Replace the bleed-gated branch**

Inside `classifyDeath`, add near the other derived values (after `const hunted = …`):

```ts
  const recentUnconsciousInWindow = recentUnconscious.filter(
    (u) => u.secondsBeforeDeath >= 0 && u.secondsBeforeDeath <= RECENT_HIT_WINDOW_S,
  );
```

Then replace the existing bleed-gated `if` block with:

```ts
  // Infected deaths systematically evade both proxies the old gate relied on: bleeding closes
  // before death, and shock never shows in HP. `hunted` is the gate; the three corroborations
  // are interchangeable. Verified against all 31 bare-`died` lives in production: fixes 5,
  // regresses none. Do NOT collapse this back to a bleedSources-only test.
  const bleeding = facts.bleedSources != null && facts.bleedSources > 0;
  const wentUnconscious = recentUnconsciousInWindow.length > 0;
  const hps = recent.map((h) => h.victimHp).filter((n): n is number => n != null);
  const terminalHp = hps.length ? Math.min(...hps) : null;   // MIN, not the last hit — hits arrive with jitter
  const terminal = terminalHp != null && terminalHp <= TERMINAL_HP_MAX;

  if (hunted && (bleeding || wentUnconscious || terminal)) {
    return { cause: "mauled", confidence: "high",
      conditions: bleeding ? [...baseConditions, "bleeding"] : withHealthy(baseConditions),
      basis: { ...basis, wentUnconscious, terminalHp } };
  }
  if (bleeding && recent.length > 0) {
    return { cause: "bled_out", confidence: "high", conditions: [...baseConditions, "bleeding"], basis };
  }
```

- [ ] **Step 5: Fix the existing two-argument call sites**

Run: `grep -rn "classifyDeath(" --include=*.ts packages apps | grep -v node_modules`

For each call site that passes two arguments, add the third. Existing tests in
`death-verdict.test.ts` that call `classifyDeath(facts, hits)` must become
`classifyDeath(facts, hits, [])`.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @onelife/domain test && pnpm --filter @onelife/domain typecheck`
Expected: PASS both.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/death-verdict.ts packages/domain/test/death-verdict.test.ts
git commit -m "feat(domain): corroborated mauled inference for bare-died infected deaths"
```

---

### Task 6: Wire the read-model

**Files:**
- Modify: `packages/read-models/src/life-dossier.ts`
- Modify: `packages/read-models/test/life-dossier.test.ts` (or create if absent)

**Interfaces:**
- Consumes: `unconsciousEvents` (Task 3), `RecentUnconscious` + the 3-arg `classifyDeath` (Task 5).
- Produces: `DossierUnconscious = { secondsBeforeDeath: number; disconnecting: boolean }` and `LifeDossier.recentUnconscious: DossierUnconscious[]`.

- [ ] **Step 1: Add the interface member**

In `packages/read-models/src/life-dossier.ts`, add after `DossierRecentHit`:

```ts
export interface DossierUnconscious { secondsBeforeDeath: number; disconnecting: boolean }
```

and add to the `LifeDossier` interface, after `recentHits`:

```ts
  recentUnconscious: DossierUnconscious[];
```

- [ ] **Step 2: Query the table**

Add `unconsciousEvents` to the `@onelife/db` import. In `dossierForLife`, after the `hits` query:

```ts
  // Knockouts in the life window. Same bounds and same player-id resolution as `hits` —
  // the evidence that an infected mauling turned lethal when bleeding has already closed.
  const knockouts = p ? await db.select({
    disconnecting: unconsciousEvents.disconnecting, occurredAt: unconsciousEvents.occurredAt,
  }).from(unconsciousEvents).where(and(
    eq(unconsciousEvents.serverId, life.serverId), eq(unconsciousEvents.playerId, p.id),
    gte(unconsciousEvents.occurredAt, life.startedAt), lte(unconsciousEvents.occurredAt, windowEnd),
  )) : [];
```

- [ ] **Step 3: Map and return it**

After the `recentHits` mapping:

```ts
  const recentUnconscious: DossierUnconscious[] = knockouts
    .map((u) => ({ disconnecting: u.disconnecting, secondsBeforeDeath: Math.round((endMs - u.occurredAt.getTime()) / 1000) }))
    .filter((u) => u.secondsBeforeDeath >= 0 && u.secondsBeforeDeath <= RECENT_HIT_WINDOW_S);
```

Add `recentUnconscious,` to the returned object, next to `recentHits`.

- [ ] **Step 4: Pass it to the classifier**

Find `dossierVerdict` in the same file and add the third argument:

```ts
export function dossierVerdict(d: LifeDossier): DeathVerdictSummary {
  const { cause, confidence, conditions } = classifyDeath(d.death, d.recentHits, d.recentUnconscious);
  return { cause, confidence, conditions };
}
```

Match the existing body — only the `classifyDeath` call changes.

- [ ] **Step 5: Test the window boundary**

Add to `packages/read-models/test/life-dossier.test.ts` (create the file if absent, mirroring the
DB-harness setup of a sibling test in that directory). Seed a life, a death at a known instant, one
`unconscious_events` row **119 s** before it and another **121 s** before it:

```ts
// RECENT_HIT_WINDOW_S is 120. The far row must be dropped, exactly as recentHits drops a hit at
// the same distance — one window, one rule, so the two evidence streams cannot disagree.
it("keeps an unconscious event inside the window and drops one outside it", async () => {
  const d = await dossierForLife(db, "Subject", life);
  expect(d.recentUnconscious.map((u) => u.secondsBeforeDeath)).toEqual([119]);
});
```

- [ ] **Step 6: Typecheck and run the suite**

Run: `pnpm --filter @onelife/read-models typecheck && pnpm --filter @onelife/read-models test`
Expected: PASS. Fix any fixture that constructs a `LifeDossier` literal by adding `recentUnconscious: []`.

- [ ] **Step 6: Commit**

```bash
git add packages/read-models/src/life-dossier.ts packages/read-models/test
git commit -m "feat(read-models): feed unconscious evidence to the death classifier"
```

---

### Task 7: Backfill historical unconscious events

**Files:**
- Create: `apps/projector/src/backfill-unconscious.ts`
- Modify: `apps/projector/package.json` (add the script)
- Create: `apps/projector/test/backfill-unconscious.test.ts`

**Interfaces:**
- Consumes: `parseUnconscious` (Task 1), `appendEvent` from `@onelife/event-log`.
- Produces: `backfillUnconscious(db: Database): Promise<{ appended: number; scanned: number }>`.

- [ ] **Step 1: Write the backfill**

Create `apps/projector/src/backfill-unconscious.ts`:

```ts
import { like } from "drizzle-orm";
import type { Database } from "@onelife/db";
import { rawLines } from "@onelife/db";
import { parseUnconscious } from "@onelife/adm-parser";
import { appendEvent } from "@onelife/event-log";

/**
 * Appends `player.unconscious` events for historical raw lines, which predate the parser.
 *
 * ⚠️ subIndex 1, not 0: every one of these lines already stored `player.position` at subIndex 0,
 * and `parseLine` now dispatches unconscious immediately after position. Using 0 here would
 * collide with events_idempotency_uniq and append nothing.
 *
 * Idempotent — appendEvent's onConflictDoNothing on (serverId, admFileId, lineIndex, subIndex)
 * makes a re-run a no-op. Safe to run repeatedly.
 */
export async function backfillUnconscious(db: Database): Promise<{ appended: number; scanned: number }> {
  const rows = await db.select().from(rawLines).where(like(rawLines.text, "%unconscious%"));
  let appended = 0;
  for (const row of rows) {
    const u = parseUnconscious(row.text);
    if (!u) continue;
    if (row.occurredAt == null) continue;             // no timestamp, no place on the timeline
    await appendEvent(db, {
      serverId: row.serverId,
      admFileId: row.admFileId,
      lineIndex: row.lineIndex,
      subIndex: 1,
      type: "player.unconscious",
      occurredAt: row.occurredAt,
      payload: { gamertag: u.gamertag, disconnecting: u.disconnecting, x: u.x, y: u.y },
      rawLineId: row.id,
    });
    appended++;
  }
  return { appended, scanned: rows.length };
}

// Runnable entrypoint (mirrors backfill-death-causes).
if (import.meta.url === `file://${process.argv[1]}`) {
  const { getDb } = await import("@onelife/db");
  const { db, sql: end } = getDb(process.env.DATABASE_URL!);
  const { appended, scanned } = await backfillUnconscious(db);
  console.log(`[backfill-unconscious] scanned ${scanned} candidate lines, appended ${appended} events.`);
  console.log(`The projector folds these forward on its normal cursor — no rebuild required.`);
  await end.end();
  process.exit(0);
}
```

- [ ] **Step 2: Add the package script**

In `apps/projector/package.json`, add to `scripts`:

```json
    "backfill-unconscious": "tsx src/backfill-unconscious.ts",
```

- [ ] **Step 3: Write the test**

Create `apps/projector/test/backfill-unconscious.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, admFiles, rawLines, events } from "@onelife/db";
import { eq, and } from "drizzle-orm";
import { appendEvent } from "@onelife/event-log";
import { backfillUnconscious } from "../src/backfill-unconscious.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 8e8;
let serverId: number;
let admFileId: number;

const UNC_LINE = 'Player "U" (id=1 pos=<1.0, 2.0, 3.0>) is unconscious';
const REGAINED_LINE = 'Player "U" (id=1 pos=<1.0, 2.0, 3.0>) regained consciousness';
const OCCURRED = new Date("2026-07-10T12:00:00Z");

/** Seed a raw line exactly as history holds it: player.position already at subIndex 0. */
async function seed(lineIndex: number, text: string) {
  const [rl] = await db.insert(rawLines).values({ serverId, admFileId, lineIndex, text, occurredAt: OCCURRED }).returning();
  await appendEvent(db, { serverId, admFileId, lineIndex, subIndex: 0, type: "player.position",
    occurredAt: OCCURRED, payload: { gamertag: "U", x: 1, y: 2 }, rawLineId: rl!.id });
  return rl!.id;
}

let uncRawLineId: number;
let regainedRawLineId: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "backfill-unconscious-test" }).returning();
  serverId = s!.id;
  const [f] = await db.insert(admFiles).values({ serverId, path: "u.ADM", name: "u.ADM" }).returning();
  admFileId = f!.id;
  uncRawLineId = await seed(10, UNC_LINE);
  regainedRawLineId = await seed(11, REGAINED_LINE);
});

afterAll(async () => {
  await db.delete(events).where(eq(events.serverId, serverId));
  await db.delete(rawLines).where(eq(rawLines.serverId, serverId));
  await db.delete(admFiles).where(eq(admFiles.serverId, serverId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("backfillUnconscious", () => {
  it("appends one event at subIndex 1, skips regained-consciousness, and is idempotent", async () => {
    const first = await backfillUnconscious(db);
    expect(first.appended).toBe(1);

    const rows = await db.select().from(events).where(eq(events.rawLineId, uncRawLineId));
    const unc = rows.filter((r) => r.type === "player.unconscious");
    expect(unc).toHaveLength(1);
    // ⚠️ subIndex 1, never 0 — position already owns 0 on every historical line. A 0 here
    // collides with events_idempotency_uniq and silently appends nothing.
    expect(unc[0]!.subIndex).toBe(1);

    // `regained consciousness` is not evidence of going down; the parser must ignore it.
    const regained = await db.select().from(events)
      .where(and(eq(events.rawLineId, regainedRawLineId), eq(events.type, "player.unconscious")));
    expect(regained).toHaveLength(0);

    // Re-running must be a no-op — appendEvent's onConflictDoNothing on the four-column key.
    const second = await backfillUnconscious(db);
    expect(second.appended).toBe(1);   // parsed again...
    const after = await db.select().from(events).where(eq(events.rawLineId, uncRawLineId));
    expect(after.filter((r) => r.type === "player.unconscious")).toHaveLength(1); // ...but inserted once
  });
});
```

Note: `appended` counts lines the backfill *attempted*, so it stays 1 on a re-run; the durable
assertion is the row count, which must stay 1. If you prefer `appended` to count real inserts,
have `appendEvent` report whether it inserted and adjust both the implementation and this test —
do not simply change the expectation.

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @onelife/projector test -- backfill-unconscious`
Expected: PASS. Requires `TEST_DATABASE_URL`.

- [ ] **Step 5: Commit**

```bash
git add apps/projector/src/backfill-unconscious.ts apps/projector/package.json apps/projector/test/backfill-unconscious.test.ts
git commit -m "feat(projector): backfill historical unconscious events"
```

---

### Task 8: Changelog and full verification

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Run the whole suite**

Run: `pnpm turbo run typecheck test --concurrency=1`
Expected: PASS across all packages. This is the same command CI runs (`pnpm run ci`).

- [ ] **Step 2: Add the changelog entry**

In `CHANGELOG.md`, under `## [Unreleased]`, in an `### Added` / `### Fixed` section matching
the file's existing style:

```markdown
### Fixed
- Deaths caused by infected are no longer reported as "Unknown". DayZ writes some of these with
  no killer clause, and the classifier's infected branch was gated on bleeding, which has usually
  stopped by the time the player dies. The gate is now recent infected damage plus corroboration —
  bleeding, a knockout, or health driven to effectively zero.

### Added
- The ADM `is unconscious` / `is disconnecting while being unconscious` lines are now parsed into
  a `player.unconscious` event and an `unconscious_events` projection, providing the evidence that
  an infected mauling turned lethal (infected deal shock, which never appears in the health field).
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for mauled inference"
```

---

## Deploy runbook (operator — NOT part of implementation)

Migration `0031` creates a projection table but touches no existing projection shape.

```bash
./deploy/deploy.sh                                          # migrate creates the table
pnpm --filter @onelife/projector run backfill-unconscious   # `run`, never bare
```

No `--rebuild`. Verify the fold picked the events up:

```sql
SELECT count(*) FROM unconscious_events;   -- expect ~62
```

Then regenerate the 9 stale obituaries whose verdict changes: `DELETE` those `articles` rows so
the newsdesk anti-join re-targets them. `NEWSDESK_SINCE` must be at or below the oldest affected
death, and `NEWSDESK_BATCH_CAP` (default 10) bounds each tick.
