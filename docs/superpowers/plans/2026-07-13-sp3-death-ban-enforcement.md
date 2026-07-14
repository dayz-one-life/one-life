# SP3 — Death-Ban Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a **qualified** life dies, ban the player for 24h on that server's Nitrado ban list — with the actual Nitrado write gated behind `ENFORCER_DRY_RUN` (default **true** = log-only), and 24h auto-expiry managed by the enforcer.

**Architecture:** Net-new (not a port). A new `apps/enforcer` consumer loop reconciles a durable `bans` table against the `lives` projection and the Nitrado ban list, in three phases per tick: **detect** (qualified ended lives with no ban → insert `bans` row), **apply** (pending → Nitrado `addBan`, unless dry-run), **expire** (applied past `expires_at` → Nitrado `removeBan`). Ban decisions are pure functions; qualification reuses `isLifeQualified` from `@onelife/read-models`. Nitrado's ban list is **name-based** (gamertag), a whole-field replace on `settings.general.bans`.

**Tech Stack:** TypeScript ESM, Drizzle, `fetch` (Nitrado), pino, vitest — same workspace as SP1/SP2.

## Global Constraints

- **DEST:** `/Users/steveharmeyer/Development/dayz-one-life/one-life`, branch `feature/sp3-death-ban-enforcement` (off `develop`).
- **Local Postgres host port 5434** (gitignored override); DB suites need `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test`.
- **Ban identifier = gamertag** (Nitrado's list is display-name based; no UID).
- **`ENFORCER_DRY_RUN` defaults to `true`** — in dry-run, write the `bans` audit row + log, but make **no** Nitrado call. Real bans require explicitly setting it false.
- **`bans` is a durable side-table**, never truncated by projector rebuild; keyed on `(server_id, gamertag, life_started_at)` (durable — survives rebuilds).
- **Nitrado API:** base `https://api.nitrado.net`, bearer `NITRADO_TOKEN`, envelope `{status:"success", data}`. Read `GET /services/{serviceId}/gameservers/settings` → `data.settings.general.bans` (`\r\n` string). Write `POST` same path, body `{category:"general", key:"bans", value: names.join("\r\n")}` (whole-list replace).
- Commit after every task; same trailers as SP1/SP2.

---

### Task 1: `bans` table + migration `0002`

**Files:** Modify `packages/db/src/schema.ts` (append `bans`); modify `packages/test-support/src/global-setup.ts` (`APP_TABLES` += `"bans"`); create `packages/db/drizzle/0002_*.sql`.

**Schema (append after `verificationChallenges`):**
```ts
export const bans = pgTable("bans", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  serverId: integer("server_id").notNull().references(() => servers.id),
  gamertag: text("gamertag").notNull(),
  lifeStartedAt: timestamp("life_started_at", { withTimezone: true }).notNull(),
  reason: text("reason").notNull(),          // 'qualified_death'
  qualifiedBy: text("qualified_by"),         // 'playtime' | 'kill' | 'pvp-death'
  bannedAt: timestamp("banned_at", { withTimezone: true }).notNull(),      // death time
  expiresAt: timestamp("expires_at", { withTimezone: true }),              // banned_at + BAN_DURATION_HOURS
  status: text("status").notNull().default("pending"),                     // pending|applied|expired|failed|lifted
  dryRun: boolean("dry_run").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  liftedAt: timestamp("lifted_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqDeath: uniqueIndex("bans_server_gamertag_life_uniq").on(t.serverId, t.gamertag, t.lifeStartedAt),
  byStatus: index("bans_status_idx").on(t.status),
}));
```

- [ ] **Step 1:** Append the `bans` table to `schema.ts`.
- [ ] **Step 2:** Add `"bans"` to `test-support` `APP_TABLES`.
- [ ] **Step 3:** `pnpm --filter @onelife/db typecheck` → PASS.
- [ ] **Step 4:** `docker compose up -d postgres`; `pnpm --filter @onelife/db db:generate` → new `0002_*.sql` creating only `bans`.
- [ ] **Step 5:** Apply: `DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife pnpm --filter @onelife/db db:migrate` → `bans` created.
- [ ] **Step 6:** Commit: `feat(db): add bans table + migration`

---

### Task 2: `@onelife/nitrado` ban methods

**Files:** Modify `packages/nitrado/src/client.ts` (add methods); modify `packages/nitrado/src/index.ts` if needed; add `packages/nitrado/test/bans.test.ts`.

**Interfaces (add to `NitradoClient`):**
```ts
async getBans(): Promise<string[]>                 // GET settings → split data.settings.general.bans
async addBan(gamertag: string): Promise<void>      // read list, add if absent, POST whole list
async removeBan(gamertag: string): Promise<void>   // read list, filter out exact match, POST whole list
// private setBans(names: string[]): Promise<void>  // POST {category:'general',key:'bans',value:names.join('\r\n')}
```
Reuse the existing bearer-auth + envelope handling. POST uses `method:"POST"`, JSON body, `Authorization: Bearer`, `Accept: application/json`.

- [ ] **Step 1:** Write `test/bans.test.ts` with a fake `fetchFn`: (a) `getBans()` parses a `\r\n` string into a trimmed non-empty array; (b) `addBan` POSTs the existing list + the new name joined by `\r\n` and is idempotent (no dup); (c) `removeBan` POSTs the list minus the exact name; (d) a non-`success` envelope throws.
- [ ] **Step 2:** Run tests → FAIL (methods undefined).
- [ ] **Step 3:** Implement `getBans`/`addBan`/`removeBan`/`setBans` on `NitradoClient` (whole-field replace semantics; `getBans` splits on `/\r\n|\r|\n/`, trims, drops empties).
- [ ] **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit: `feat(nitrado): add name-based ban list read/add/remove`

---

### Task 3: enforcer pure decision logic

**Files:** Create `apps/enforcer/src/decide.ts` + `apps/enforcer/test/decide.test.ts` (+ package.json, tsconfig, vitest.config).

**Interfaces:**
```ts
export type EndedLife = {
  serverId: number; gamertag: string; startedAt: Date; endedAt: Date;
  deathCause: string | null; effectivePlaytimeSeconds: number;
  playerKills: { occurredAt: Date }[];
};
export type BanPlan = { serverId: number; gamertag: string; lifeStartedAt: Date; bannedAt: Date; expiresAt: Date; qualifiedBy: "playtime" | "kill" | "pvp-death" };

// Which ended, unbanned, QUALIFIED lives need a ban. Pure; reuses isLifeQualified/lifeQualifiedAt.
export function planBans(lives: EndedLife[], banDurationHours: number): BanPlan[];

// Which applied bans are due to expire at `now`.
export function planExpiries(applied: { id: number; expiresAt: Date | null }[], now: Date): number[];
```

- [ ] **Step 1:** Write `decide.test.ts`: qualified-by-playtime (>=300s, no kill) → planned with `expiresAt = endedAt + hours`; qualified-by-pvp-death → planned; qualified-by-kill → planned; **un**qualified (<300s, no kill, non-pvp death) → NOT planned; `planExpiries` returns only ids whose `expiresAt <= now`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `planBans` (call `isLifeQualified`; derive `qualifiedBy` via the same precedence as `lifeQualifiedAt`: pvp-death > kill > playtime) and `planExpiries`. Import from `@onelife/read-models`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(enforcer): pure ban/expiry decision logic`

---

### Task 4: enforcer app (config, store, tick, main, Dockerfile)

**Files:** Create `apps/enforcer/src/{config,pg-store,tick,main}.ts`, `apps/enforcer/test/tick.test.ts`, `apps/enforcer/Dockerfile`.

**config.ts** (zod): `DATABASE_URL`, `NITRADO_TOKEN`, `ENFORCER_DRY_RUN` (default **true**), `ENFORCER_INTERVAL_SECONDS` (default 300), `BAN_DURATION_HOURS` (default 24), `LOG_LEVEL`.

**pg-store.ts:** `findEndedUnbannedLives(db)` (ended lives — `ended_at not null` — with their `deathCause`, `playtime_seconds`, `started_at`, and `playerKills` from `kills`, LEFT-JOIN `bans` on `(server_id, gamertag, life_started_at)` where no ban row exists); `insertBan(db, BanPlan, dryRun)`; `pendingBans(db)`; `markApplied(db,id)`/`markFailed(db,id,err)`; `appliedBansDue(db, now)`; `markExpired(db,id)`; `serverServiceId(db, serverId)` (from `servers.nitradoServiceId`).

**tick.ts** — `enforcerTick(db, deps)` where `deps = { nitradoFor: (serviceId) => NitradoClient, dryRun, banDurationHours, now, log }`:
1. **detect:** `planBans(findEndedUnbannedLives(), banDurationHours)` → `insertBan(..., dryRun)` each (status `pending`).
2. **apply:** for each `pendingBans()`: if `dryRun` → log `would ban <gamertag> on <server>`, leave `pending`; else `nitradoFor(serviceId).addBan(gamertag)` → `markApplied`, on throw `markFailed`.
3. **expire:** for each `appliedBansDue(now)`: if `dryRun` → `markExpired` (log only); else `removeBan(gamertag)` → `markExpired`.
Returns `{ detected, applied, expired, dryRun }`.

**main.ts:** verifier-style `while(true)` loop calling `enforcerTick` every interval, constructing a `NitradoClient` per server serviceId with the shared token.

**Dockerfile:** mirror `apps/verifier/Dockerfile` (swap to `apps/enforcer`).

- [ ] **Step 1:** Write `test/tick.test.ts` (real test DB + a **fake nitrado**): seed a server + a qualified ended life (>=300s playtime) + its kills; run `enforcerTick` with `dryRun:true` → asserts a `bans` row `pending`, `dry_run=true`, and the fake nitrado `addBan` was **NOT** called. Then run with `dryRun:false` → `addBan` called once, row `applied`. Then advance `now` past `expiresAt`, run → `removeBan` called, row `expired`. Also: an **unqualified** ended life produces **no** ban row.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement config, pg-store, tick, main; author Dockerfile; add `package.json` (deps: db, domain, event-log?, nitrado, read-models, drizzle-orm, pino, zod; dev: test-support, tsx, vitest, postgres) + tsconfig + vitest.config.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(enforcer): death-ban consumer (dry-run default) + Dockerfile`

---

### Task 5: Verify + dry-run smoke + wiring

**Files:** `docker-compose.yml` (add `enforcer` service, `ENFORCER_DRY_RUN: "true"`), `.env.example` (enforcer vars), `CHANGELOG.md`, `CLAUDE.md`.

- [ ] **Step 1:** `pnpm turbo run typecheck` → PASS (all packages).
- [ ] **Step 2:** `TEST_DATABASE_URL=… pnpm turbo run test --concurrency=1` → PASS.
- [ ] **Step 3:** Dry-run smoke: against a scratch DB seeded with a qualified dead life, run one `enforcerTick` with a fake/never-called nitrado and `ENFORCER_DRY_RUN` unset (→ defaults true); assert a `bans` row exists as `pending`/`dry_run=true` and no ban call happened. Document the command in the commit.
- [ ] **Step 4:** Add the `enforcer` service to `docker-compose.yml` with `ENFORCER_DRY_RUN: "true"` and the enforcer env block to `.env.example` (`ENFORCER_DRY_RUN=true`, `ENFORCER_INTERVAL_SECONDS=300`, `BAN_DURATION_HOURS=24`).
- [ ] **Step 5:** Update `CHANGELOG.md` (Added: SP3) and `CLAUDE.md` (SP3 ✅; add `enforcer` app + `bans`; note dry-run default).
- [ ] **Step 6:** Commit: `test: verify SP3 + dry-run smoke; wire enforcer service + docs`.

---

## Self-Review

- **Spec coverage (items 7, 8):** 24h ban on qualified death (Task 3 `planBans` + Task 4 apply) ✓; qualification = >5min OR PvP via reused `isLifeQualified` (Task 3) ✓; per-server (serviceId from `servers`) ✓; dry-run default true (Task 4 config + tick) ✓; 24h auto-expiry (Task 4 expire phase) ✓.
- **Placeholder scan:** none — schema, API shape, config defaults, and pure-function contracts + test cases are all concrete.
- **Durability:** ban idempotency key is `(server_id, gamertag, life_started_at)` — no dependence on regenerated projection ids; `bans` never truncated by rebuild.
- **Safety:** every code path that would call Nitrado is behind the `dryRun` branch; the tick test asserts no ban call in dry-run.
