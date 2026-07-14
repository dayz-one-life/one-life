# UP1 — Global Player Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a player a single global identity keyed by gamertag (one row per gamertag across all servers), while lives stay per-server; regenerate projections from the event log.

**Architecture:** Projections are derived from the immutable `events` log. We change player resolution in the fold from `(serverId, gamertag)` to `gamertag`, drop `players.server_id` and `players.current_life_id`, and rebuild. Lives already key on `(serverId, playerId)` so they need no logic change.

**Tech Stack:** TypeScript/ESM, Drizzle ORM + Postgres, Vitest, pnpm workspaces, `@onelife/test-support` Postgres harness.

## Global Constraints

- DB tests require `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5432/onelife_test`.
- Run a package's tests with `pnpm --filter <pkg> test`; typecheck with `pnpm --filter <pkg> typecheck`.
- TDD: failing test first, watch it fail, minimal code, watch it pass, commit.
- Latest migration is `0004`; the new one is `0005`.
- `lives`, `sessions`, `kills`, `hit_events`, `build_events`, `positions` schemas are UNCHANGED. Only `players` changes.
- Do NOT touch `gamertag_links`, `bans`, `character_*` (UP2 / durable).

---

### Task 1: Schema — global `players`

**Files:**
- Modify: `packages/db/src/schema.ts:67-77` (players table)
- Create: `packages/db/drizzle/0005_*.sql` (generated)
- Test: `packages/db` migration applies via `@onelife/test-support` globalSetup (no dedicated test file; verified by Task 3+ suites).

**Interfaces:**
- Produces: `players` columns `{ id, gamertag (unique), dayz_id, first_seen_at, last_seen_at }` — no `server_id`, no `current_life_id`.

- [ ] **Step 1: Edit the schema.** In `packages/db/src/schema.ts`, replace the `players` table definition:

```typescript
export const players = pgTable("players", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  gamertag: text("gamertag").notNull(),
  dayzId: text("dayz_id"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
}, (t) => ({
  uniq: uniqueIndex("players_gamertag_uniq").on(t.gamertag),
}));
```

(Removed `serverId`, `currentLifeId`, and the old `(server_id, gamertag)` unique; `lives.serverId` FK to `servers` is unaffected — it references `servers`, not `players`.)

- [ ] **Step 2: Generate the migration.**

Run: `cd packages/db && TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5432/onelife_test pnpm db:generate`
Expected: creates `packages/db/drizzle/0005_*.sql` dropping `server_id`/`current_life_id` and the old unique, adding `players_gamertag_uniq`. Open the file and confirm it does NOT drop/alter `lives`.

- [ ] **Step 3: Apply against the test DB to confirm it's valid.**

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5432/onelife_test pnpm --filter @onelife/db db:migrate`
Expected: `migrations applied successfully`. (If the test DB has legacy duplicate-gamertag player rows, drop it first: `dropdb onelife_test` — the harness recreates it.)

- [ ] **Step 4: Commit.**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/
git commit -m "feat(db): global players — drop server_id/current_life_id, unique on gamertag (0005)"
```

---

### Task 2: Projection store interface + in-memory store

**Files:**
- Modify: `packages/projections/src/types.ts:11` (PlayerRow)
- Modify: `packages/projections/src/store.ts:7-11`
- Modify: `packages/projections/src/memory-store.ts:21,31,37,44` (getPlayer/createPlayer, drop setCurrentLife)
- Test: `packages/projections/test/memory-store.test.ts` (create if absent) or extend an existing fold test.

**Interfaces:**
- Produces: `getPlayer(gamertag: string)`, `createPlayer(gamertag, dayzId, seenAt)`, `PlayerRow = { id, gamertag, lastSeenAt }`. `setCurrentLife` removed.

- [ ] **Step 1: Failing test** — add to `packages/projections/test/memory-store.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { MemoryStore } from "../src/memory-store.js";

describe("MemoryStore global players", () => {
  it("resolves one player by gamertag regardless of server", async () => {
    const s = new MemoryStore();
    const p = await s.createPlayer("Bob", null, new Date("2026-07-01"));
    // seen again 'on another server' — still the same player row
    expect((await s.getPlayer("Bob"))?.id).toBe(p.id);
    expect("currentLifeId" in (await s.getPlayer("Bob"))!).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (getPlayer/createPlayer still take serverId).

Run: `pnpm --filter @onelife/projections test -- memory-store`
Expected: TS/red — wrong argument count.

- [ ] **Step 3: Update types + interface + memory store.**

`types.ts:11`:
```typescript
export type PlayerRow = { id: number; gamertag: string; lastSeenAt: Date | null };
```

`store.ts` — replace lines 7-11 with:
```typescript
  getPlayer(gamertag: string): Promise<PlayerRow | null>;
  getPlayerById(playerId: number): Promise<PlayerRow | null>;
  createPlayer(gamertag: string, dayzId: string | null, seenAt: Date): Promise<PlayerRow>;
  touchPlayer(playerId: number, lastSeenAt: Date): Promise<void>;
```
(Delete the `setCurrentLife` line.)

`memory-store.ts`: drop `currentLifeId`/`serverId` from the players field type; `getPlayer(gamertag)` matches by gamertag only; `createPlayer(gamertag, dayzId, seenAt)` pushes `{ id, gamertag, dayzId, lastSeenAt: seenAt, firstSeenAt: seenAt }`; delete `setCurrentLife`.

- [ ] **Step 4: Run — expect PASS.** `pnpm --filter @onelife/projections test -- memory-store`

- [ ] **Step 5: Commit.**
```bash
git add packages/projections/src/{types,store,memory-store}.ts packages/projections/test/memory-store.test.ts
git commit -m "feat(projections): global-player store interface + memory store"
```

---

### Task 3: Fold — resolve player by gamertag

**Files:**
- Modify: `packages/projections/src/fold.ts` (lines 31, 35, 45, 51, 60, 84, 87, 106, 121, 132)
- Test: `packages/projections/test/fold.test.ts` (extend)

**Interfaces:**
- Consumes: Task 2 store signatures.

- [ ] **Step 1: Failing test** — a gamertag seen on two servers is one player with a life per server:

```typescript
it("gives a gamertag one global player with a per-server life", async () => {
  const s = new MemoryStore();
  await applyEvent(s, { serverId: 1, type: "player.connected", occurredAt: new Date("2026-07-01T00:00:00Z"), payload: { gamertag: "Bob" } } as any);
  await applyEvent(s, { serverId: 2, type: "player.connected", occurredAt: new Date("2026-07-01T01:00:00Z"), payload: { gamertag: "Bob" } } as any);
  const p1 = await s.getPlayer("Bob");
  expect(s.players.filter((p) => p.gamertag === "Bob")).toHaveLength(1); // one global player
  const lives = (s.lives as any[]).filter((l) => l.playerId === p1!.id);
  expect(lives.map((l) => l.serverId).sort()).toEqual([1, 2]);          // a life on each server
  expect(lives.every((l) => l.lifeNumber === 1)).toBe(true);            // life_number per server
});
```

- [ ] **Step 2: Run — expect FAIL** (`getPlayer(serverId, tag)` currently splits Bob into two players).

Run: `pnpm --filter @onelife/projections test -- fold`

- [ ] **Step 3: Edit `fold.ts`.** Mechanical: remove `e.serverId,` from every `store.getPlayer(...)` call (lines 31, 51, 60, 87, 106, 121, 132) and from the `store.createPlayer(...)` call (line 35). Delete the two `store.setCurrentLife(...)` calls (lines 45, 84). Example — line 31 and 35 become:
```typescript
  let player = await store.getPlayer(gamertag);
  ...
  if (!player) player = await store.createPlayer(gamertag, dayzId, e.occurredAt);
```
Leave every `getOpenLife/getMaxLifeNumber/createLife(e.serverId, player.id, …)` call unchanged.

- [ ] **Step 4: Run — expect PASS**, and run the whole projections suite to catch regressions: `pnpm --filter @onelife/projections test`

- [ ] **Step 5: Commit.**
```bash
git add packages/projections/src/fold.ts packages/projections/test/fold.test.ts
git commit -m "feat(projections): fold resolves players globally by gamertag"
```

---

### Task 4: Postgres projection store

**Files:**
- Modify: `apps/projector/src/pg-store.ts:13-34`
- Test: `apps/projector/test/pg-store.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1 schema, Task 2 interface.

- [ ] **Step 1: Failing test** — global upsert by gamertag:

```typescript
it("getPlayer/createPlayer are keyed by gamertag alone", async () => {
  await db.transaction(async (tx) => {
    const store = new PgProjectionStore(tx);
    const a = await store.createPlayer("Zed", null, new Date("2026-07-01"));
    const b = await store.createPlayer("Zed", null, new Date("2026-07-02")); // upsert, not a 2nd row
    expect(b.id).toBe(a.id);
    expect((await store.getPlayer("Zed"))?.id).toBe(a.id);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `TEST_DATABASE_URL=… pnpm --filter @onelife/projector test -- pg-store`

- [ ] **Step 3: Edit `pg-store.ts`.** `getPlayer(gamertag)` → `where(eq(players.gamertag, gamertag))`. `createPlayer(gamertag, dayzId, seenAt)` → values `{ gamertag, dayzId, firstSeenAt: seenAt, lastSeenAt: seenAt }`, `onConflictDoUpdate({ target: [players.gamertag], set: { lastSeenAt: seenAt } })`. Delete `setCurrentLife`. Drop `currentLifeId` from the three `PlayerRow` return objects (lines 16, 20, 27).

- [ ] **Step 4: Run — expect PASS**, then full projector suite: `TEST_DATABASE_URL=… pnpm --filter @onelife/projector test`

- [ ] **Step 5: Commit.**
```bash
git add apps/projector/src/pg-store.ts apps/projector/test/pg-store.test.ts
git commit -m "feat(projector): Postgres store upserts players by gamertag"
```

---

### Task 5: Read-models — resolve players globally

**Files:**
- Modify: `packages/read-models/src/queries.ts:35,65` and any `players.serverId` reference in `leaderboards.ts`, `global.ts`, `player-aggregate.ts`
- Test: existing `packages/read-models/test/*` (adjust fixtures inserting `players` with `server_id`)

**Interfaces:**
- Consumes: Task 1 schema.

- [ ] **Step 1: Find every `players.serverId` / `players_server_gamertag` usage.**

Run: `grep -rn "players.serverId\|server_id.*gamertag\|serverId.*players" packages/read-models/src`
For each: resolve the player by `gamertag` only; keep server scoping on `lives.serverId`/`sessions.serverId`.

- [ ] **Step 2: Run the read-models suite — expect FAILs** where fixtures insert `players` with `server_id` (now invalid) or queries filter players by server.

Run: `TEST_DATABASE_URL=… pnpm --filter @onelife/read-models test`

- [ ] **Step 3: Fix queries + fixtures.** In `queries.ts:35` and `:65`, change
`.where(and(eq(players.serverId, serverId), eq(players.gamertag, gamertag)))` → `.where(eq(players.gamertag, gamertag))`. In test fixtures, insert players as `{ gamertag }` (no `serverId`) and attach lives/sessions with `serverId`.

- [ ] **Step 4: Run — expect PASS.** `TEST_DATABASE_URL=… pnpm --filter @onelife/read-models test`

- [ ] **Step 5: Commit.**
```bash
git add packages/read-models/
git commit -m "feat(read-models): resolve players globally; scope per-server via lives"
```

---

### Task 6: Enforcer + repo-wide green

**Files:**
- Inspect/modify: `apps/enforcer/src/**` (only if it references `players.serverId`)
- Test: full monorepo

- [ ] **Step 1: Grep for stragglers.** `grep -rn "players.serverId\|current_life_id\|currentLifeId\|setCurrentLife\|players.*server_id" apps packages --include=*.ts | grep -v test | grep -v drizzle` — expect empty. Fix any hit (enforcer bans by gamertag+server via `lives`, so it should be clean).

- [ ] **Step 2: Full typecheck.** `pnpm turbo run typecheck` → 19/19 pass.

- [ ] **Step 3: Full test suite.** `TEST_DATABASE_URL=… pnpm turbo run test --concurrency=1` → all pass.

- [ ] **Step 4: Commit any enforcer fix** (skip if none).

---

### Task 7: Rebuild verification test

**Files:**
- Test: `apps/projector/test/rebuild.test.ts` (extend)

- [ ] **Step 1: Failing test** — after seeding two servers' events for one gamertag and running the projector fold, `rebuildAll` + re-fold yields one player, two lives. (Model this on the existing rebuild test; assert `players` has exactly one row for the gamertag and `lives` has two rows with distinct `serverId`.)

- [ ] **Step 2–4:** Run (should pass once Tasks 1–4 are in), then commit.
```bash
git commit -am "test(projector): rebuild yields one global player with per-server lives"
```

---

## Deployment (runbook — NOT part of the code PR; run after release)

The prod rebuild is a deploy step, gated behind a checkpoint.

**Ordering is critical.** Migration `0005` builds `players_gamertag_uniq`. On real prod data a
gamertag has played more than one server, so the old per-`(server_id, gamertag)` rows contain
duplicate gamertags — building the unique index over them fails with `duplicate key` and aborts
the migration mid-statement. Therefore `players` MUST be empty before `db:migrate`, and the
projector MUST be stopped first so the still-running OLD code can't repopulate old-model rows
between the truncate and the migrate.

1. `pg_dump` a checkpoint:
   `pg_dump "postgres://onelife:onelife@localhost:5432/onelife" -t players -t lives -t sessions -t kills -t hit_events -t build_events -t positions > /root/pre-up1-projections.sql`
   Also note the pre-rebuild `SELECT count(*) FROM lives;` for the post-check.
2. **Deploy the merged code** (prod checkout onto the released `main`).
3. **Stop the projector** so old code can't re-fold during the migration:
   `sudo systemctl stop onelife-projector`
4. **Clear the derived projection tables + reset the cursor** (schema-agnostic TRUNCATE, safe pre-migrate):
   `pnpm --filter @onelife/projector rebuild`  — this empties `players`, `lives`, `sessions`,
   `kills`, `hit_events`, `build_events`, `positions` and sets the projector cursor to 0.
5. **Apply migrations** — now `players` is empty, so `0005` (players) and `0006` (gamertag_links, UP2)
   build cleanly: `pnpm --filter @onelife/db db:migrate`.
6. **Start the projector** — it re-folds from cursor 0 under the new schema/code, rebuilding one
   global player per gamertag with per-server lives: `sudo systemctl start onelife-projector`;
   watch `journalctl -u onelife-projector -f` until it catches up.
7. **Verify:** `SELECT count(*) FROM players;` = one row per distinct gamertag; total `lives`
   matches the step-1 count; a gamertag that played both servers has ONE player row with lives on
   both `server_id`s.

---

## Self-review

- **Spec coverage:** schema (T1), store interface (T2), fold (T3), pg-store (T4), read-models (T5), enforcer + green (T6), rebuild verification (T7), prod rebuild runbook (Deployment). `current_life_id` drop covered in T1/T2. UP2 items excluded. ✓
- **Placeholders:** none — each code step shows the concrete change.
- **Type consistency:** `PlayerRow = { id, gamertag, lastSeenAt }` used consistently across T2/T4; `getPlayer(gamertag)` / `createPlayer(gamertag, dayzId, seenAt)` consistent T2→T3→T4.
