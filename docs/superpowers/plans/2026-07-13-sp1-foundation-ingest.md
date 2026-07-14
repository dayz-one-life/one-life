# SP1 — Foundation + ADM Ingest + Lives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the fresh `one-life/` monorepo with multi-server DayZ ADM-log ingest → event
log → life/player/session/kill projections, including the qualified-lives read model — by porting
the working subset of `one-life-platform` and dropping all news/auth/verification code.

**Architecture:** This is a **port**, not a green-field build. Each task copies specific files
from `one-life-platform` (the SOURCE, read-only) into `one-life` (the DEST), applies a small set of
named trims (drop news + auth/verification tables and read-models), then runs that package's own
ported tests. The tests come across with the code — a task is "green" when the ported vitest suite
passes. Build in dependency-tier order so each package's `@onelife/*` deps already exist.

**Tech Stack:** pnpm@9.12.0 workspaces, turbo, TypeScript ESM (NodeNext/Bundler), Postgres 16,
Drizzle ORM 0.36 + drizzle-kit 0.28, vitest 2.1, pino, tsx, zod.

## Global Constraints

- **SOURCE root:** `/Users/steveharmeyer/Development/dayz-one-life/one-life-platform` — read-only,
  never edit.
- **DEST root:** `/Users/steveharmeyer/Development/dayz-one-life/one-life` — current repo, branch
  `feature/sp1-foundation-ingest`.
- **Node ≥ 20; pnpm 9.12.0.** All packages `"type": "module"`, `"version": "0.0.0"`, entry
  `src/index.ts` (apps: `src/main.ts`), `exports { ".": "./src/index.ts" }`, `tsconfig.json`
  extends `../../tsconfig.base.json`.
- **Ported schema is exactly 12 core tables:** `servers, adm_files, raw_lines, events,
  consumer_cursors, players, lives, sessions, kills, hit_events, build_events, positions`. NEVER
  port the auth (`user, session, account, verification`), verification (`gamertag_links,
  verification_challenges`), or news (`articles, newsroom_state`) tables — they belong to dropped
  sub-projects.
- **Do NOT port these packages/apps at all:** `apps/{generator,api,web,verifier}`,
  `packages/{auth,verification,newsroom,openrouter}`.
- **Postgres for tests:** the DB-touching suites (`test-support`, `event-log`, `read-models`,
  `ingest-worker`, `projector`) need a running Postgres and `TEST_DATABASE_URL`. Bring it up with
  `docker compose up -d postgres` before those tasks.
- **Commit after every task** on `feature/sp1-foundation-ingest`. Conventional-commit messages.

---

### Task 1: Repo skeleton + workspace tooling

**Files (create in DEST):**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.npmrc`
- Modify: `.gitignore` (merge SOURCE's ignores into the existing DEST file)
- Create: `docker-compose.yml` (SOURCE's, **minus the `api:` service**), `.env.example`
  (SOURCE's top block only — see below)
- Create empty dirs: `packages/`, `apps/`

**Interfaces:**
- Produces: a workspace where `pnpm install` resolves and `pnpm turbo run typecheck` runs (no
  packages yet → no-ops). All later tasks add packages under `packages/*` and `apps/*`.

- [ ] **Step 1:** Copy verbatim from SOURCE: `package.json`, `pnpm-workspace.yaml`, `turbo.json`,
  `tsconfig.base.json`, `.npmrc`. (Contents are in the port manifest; `pnpm-workspace.yaml` =
  `packages:\n  - "packages/*"\n  - "apps/*"`.)
- [ ] **Step 2:** Merge SOURCE `.gitignore` entries (`node_modules/ dist/ .turbo/ *.log .env
  .env.* !.env.example coverage/ scratchpad/ .superpowers/ docker-compose.override.yml data/`)
  into DEST `.gitignore`, de-duping.
- [ ] **Step 3:** Copy SOURCE `docker-compose.yml` but **delete the entire `api:` service block**;
  keep `postgres`, `ingest-worker`, `projector`, `volumes`.
- [ ] **Step 4:** Create `.env.example` with only the SP1 block: `DATABASE_URL`, `NITRADO_TOKEN`,
  `NITRADO_SERVICE_ID`, `INGEST_INTERVAL_SECONDS=60`, `ADM_BACKFILL_BUDGET=15`, `LOG_LEVEL=info`,
  `PROJECTOR_INTERVAL_SECONDS=30`, `PROJECTOR_BATCH_SIZE=500`,
  `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5432/onelife_test`. (Drop api/generator/
  auth/oauth lines.)
- [ ] **Step 5:** Run `pnpm install`. Expected: resolves, creates `pnpm-lock.yaml`, no packages to
  build yet.
- [ ] **Step 6:** Run `pnpm turbo run typecheck`. Expected: succeeds with no tasks (empty workspace).
- [ ] **Step 7:** Commit.
  ```bash
  git add -A && git commit -m "chore: scaffold SP1 monorepo skeleton (news/api/auth stripped)"
  ```

---

### Task 2: `@onelife/db` — schema trimmed to 12 core tables

**Files:**
- Create dir `packages/db/`; copy from SOURCE `packages/db/`: `package.json`, `tsconfig.json`,
  `drizzle.config.ts`, `src/{client.ts,index.ts,migrate.ts,schema.ts}`.
- **Trim** `packages/db/src/schema.ts`: delete the auth block, verification block, and news block —
  everything from the `user` table through `newsroom_state` (SOURCE lines ~176–296). Keep only the
  12 core tables and their imports.
- **Regenerate migrations:** do NOT copy SOURCE `drizzle/`. After trimming schema, generate a
  single clean `0000` migration in DEST.

**Interfaces:**
- Produces: `@onelife/db` exporting the 12 core Drizzle tables, `getDb()`, `Database` type,
  `migrateDb()`. Consumed by event-log, read-models, test-support, ingest-worker, projector.

- [ ] **Step 1:** Copy the four `src/*.ts` files, `package.json`, `tsconfig.json`,
  `drizzle.config.ts` from SOURCE `packages/db/`.
- [ ] **Step 2:** Edit `src/schema.ts` — remove the `user/session/account/verification`,
  `gamertagLinks/verificationChallenges`, and `articles/newsroomState` table declarations plus any
  now-unused imports. Verify the 12 core tables remain and reference only each other + `servers`.
- [ ] **Step 3:** Run `pnpm install` (registers the new workspace package).
- [ ] **Step 4:** Run `pnpm --filter @onelife/db typecheck`. Expected: PASS (no dangling refs to
  removed tables).
- [ ] **Step 5:** Bring up Postgres: `docker compose up -d postgres`. Generate the clean migration:
  `pnpm --filter @onelife/db db:generate`. Expected: one new `drizzle/0000_*.sql` creating exactly
  the 12 tables + a fresh `meta/_journal.json`.
- [ ] **Step 6:** Apply it against a scratch DB to prove it runs:
  `DATABASE_URL=postgres://onelife:onelife@localhost:5432/onelife pnpm --filter @onelife/db db:migrate`.
  Expected: success, 12 tables created.
- [ ] **Step 7:** Commit.
  ```bash
  git add -A && git commit -m "feat(db): port core schema (12 tables) + regenerated clean migration"
  ```

---

### Task 3: `@onelife/domain`

**Files:** copy SOURCE `packages/domain/` → DEST: `package.json`, `tsconfig.json`,
`src/{emotes.ts,events.ts,index.ts,weapons.ts}`, `test/{emotes.test.ts,weapons.test.ts}`.

**Interfaces:** Produces the zod event schemas (consumed by event-log, projections, ingest-worker,
projector) + emote/weapon dictionaries.

- [ ] **Step 1:** Copy all files listed above verbatim. (Optional: trim the "not news" comment in
  `weapons.ts:2`; no code change.)
- [ ] **Step 2:** `pnpm install`.
- [ ] **Step 3:** Run `pnpm --filter @onelife/domain test`. Expected: PASS (emotes + weapons suites).
- [ ] **Step 4:** Commit: `git add -A && git commit -m "feat(domain): port event schemas + emote/weapon dictionaries"`

---

### Task 4: `@onelife/nitrado`

**Files:** copy SOURCE `packages/nitrado/` → DEST: `package.json`, `tsconfig.json`,
`src/{client.ts,index.ts}`, `test/client.test.ts`.

**Interfaces:** Produces `NitradoClient` with `listAdmFiles()` + `downloadFile()` (consumed by
ingest-worker). No prod deps.

- [ ] **Step 1:** Copy all files verbatim.
- [ ] **Step 2:** `pnpm install`.
- [ ] **Step 3:** Run `pnpm --filter @onelife/nitrado test`. Expected: PASS.
- [ ] **Step 4:** Commit: `git add -A && git commit -m "feat(nitrado): port list/download client"`

---

### Task 5: `@onelife/adm-parser`

**Files:** copy SOURCE `packages/adm-parser/` → DEST: `package.json`, `tsconfig.json`, all of
`src/` (`build, clock-offset, coords, death, emote, hit, index, lines, parse-line, position,
teleport, timestamps, types`), all of `test/` (build, clock-offset, coords, death, emote, hit,
lines-basic, parse-line, position, teleport, timestamps) **and** `test/fixtures/sample.ADM`.

**Interfaces:** Produces pure `parseLine`/typed event constructors (consumed by ingest-worker,
projector). No prod deps.

- [ ] **Step 1:** Copy `src/`, `test/`, and `test/fixtures/sample.ADM` verbatim.
- [ ] **Step 2:** `pnpm install`.
- [ ] **Step 3:** Run `pnpm --filter @onelife/adm-parser test`. Expected: PASS (all parser suites).
- [ ] **Step 4:** Commit: `git add -A && git commit -m "feat(adm-parser): port ADM line parser + fixtures"`

---

### Task 6: `@onelife/test-support` — truncation list trimmed to 12 tables

**Files:** copy SOURCE `packages/test-support/` → DEST: `package.json`, `tsconfig.json`,
`vitest.config.ts`, `src/{global-setup.ts,guard.ts,guard.test.ts,index.ts,setup-path.ts}`.
**Trim** `src/global-setup.ts`: from the `APP_TABLES` array remove `"articles"`, `"newsroom_state"`,
`"gamertag_links"`, `"verification_challenges"`, `"user"`, `"account"`, `"session"`,
`"verification"` — keep only the 12 core tables.

**Interfaces:** Produces the test DB harness (per-test truncation via `APP_TABLES`) + `guard`.
Dev-dependency of event-log, read-models, ingest-worker, projector.

- [ ] **Step 1:** Copy all files verbatim.
- [ ] **Step 2:** Edit `src/global-setup.ts` `APP_TABLES` to the 12 core tables only.
- [ ] **Step 3:** `pnpm install`.
- [ ] **Step 4:** Ensure test DB exists: `docker compose up -d postgres` then create `onelife_test`
  if absent (`createdb` or `CREATE DATABASE onelife_test;`). Run
  `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5432/onelife_test pnpm --filter @onelife/test-support test`.
  Expected: PASS (guard suite; setup truncates only existing core tables).
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat(test-support): port test DB harness (core tables only)"`

---

### Task 7: `@onelife/event-log`

**Files:** copy SOURCE `packages/event-log/` → DEST: `package.json`, `tsconfig.json`,
`vitest.config.ts`, `src/{append.ts,cursor.ts,index.ts}`, `test/{append.test.ts,cursor.test.ts}`.

**Interfaces:** Consumes `@onelife/db` + `@onelife/domain`. Produces `appendEvents`,
`getCursor/setCursor`, `readEventBatch` over `events`/`consumer_cursors` (consumed by ingest-worker
+ projector).

- [ ] **Step 1:** Copy all files verbatim.
- [ ] **Step 2:** `pnpm install`.
- [ ] **Step 3:** Run against test DB:
  `TEST_DATABASE_URL=... pnpm --filter @onelife/event-log test`. Expected: PASS.
- [ ] **Step 4:** Commit: `git add -A && git commit -m "feat(event-log): port append + cursor helpers"`

---

### Task 8: `@onelife/projections`

**Files:** copy SOURCE `packages/projections/` → DEST: `package.json`, `tsconfig.json`,
`src/{fold.ts,index.ts,memory-store.ts,payloads.ts,store.ts,types.ts}`, all `test/` fold + store
suites.

**Interfaces:** Consumes `@onelife/domain`. Produces the fold/reducer + store abstraction (consumed
by projector). No DB dependency (memory-store based tests).

- [ ] **Step 1:** Copy all files verbatim.
- [ ] **Step 2:** `pnpm install`.
- [ ] **Step 3:** Run `pnpm --filter @onelife/projections test`. Expected: PASS (fold-build,
  fold-close-cap, fold-death, fold-hit-position, fold-session, fold-stream, memory-store).
- [ ] **Step 4:** Commit: `git add -A && git commit -m "feat(projections): port fold + store logic"`

---

### Task 9: `@onelife/read-models` — news read-models dropped

**Files:** copy SOURCE `packages/read-models/` → DEST: `package.json`, `tsconfig.json`,
`vitest.config.ts`, and from `src/` **only**: `global.ts, index.ts, leaderboards.ts,
player-aggregate.ts, playtime.ts, qualified.ts, queries.ts`. **Do NOT copy** `articles.ts,
births.ts, dossier.ts`. From `test/` copy only: global, leaderboards, player-aggregate, playtime,
qualified-at, qualified-boards, qualified-queries, qualified, queries. **Do NOT copy**
`articles.test.ts, births.test.ts, dossier.test.ts`.
**Trim** `src/index.ts` to remove the three news exports — keep exactly:
```ts
export * from "./queries.js";
export * from "./leaderboards.js";
export * from "./player-aggregate.js";
export * from "./global.js";
export * from "./qualified.js";
```

**Interfaces:** Consumes `@onelife/db`. Produces the core stats/queries API (leaderboards,
player-aggregate, qualified, playtime, global) — used later by SP2's API.

- [ ] **Step 1:** Copy the 7 core `src/*.ts`, the core `test/*`, `package.json`, `tsconfig.json`,
  `vitest.config.ts`. Omit the 3 news files + their tests.
- [ ] **Step 2:** Overwrite `src/index.ts` with the 5-line core-only export list above.
- [ ] **Step 3:** `pnpm install`.
- [ ] **Step 4:** `pnpm --filter @onelife/read-models typecheck`. Expected: PASS (no imports of the
  removed files).
- [ ] **Step 5:** Run against test DB: `TEST_DATABASE_URL=... pnpm --filter @onelife/read-models test`.
  Expected: PASS (core suites only).
- [ ] **Step 6:** Commit: `git add -A && git commit -m "feat(read-models): port core stats read-models (news dropped)"`

---

### Task 10: `@onelife/ingest-worker`

**Files:** copy SOURCE `apps/ingest-worker/` → DEST: `package.json`, `tsconfig.json`,
`vitest.config.ts`, `Dockerfile`, `src/{config.ts,main.ts,map-events.ts,process-file.ts,tick.ts}`,
`test/{config,map-events,process-file,tick}.test.ts`. (No news coupling — copy verbatim.)

**Interfaces:** Consumes adm-parser, db, domain, event-log, nitrado. The ingest loop:
list ADM files → download → track `adm_files.lastProcessedLine` → store `raw_lines` → map to
`events`.

- [ ] **Step 1:** Copy all files verbatim.
- [ ] **Step 2:** `pnpm install`.
- [ ] **Step 3:** Run against test DB: `TEST_DATABASE_URL=... pnpm --filter @onelife/ingest-worker test`.
  Expected: PASS (config, map-events, process-file, tick).
- [ ] **Step 4:** Commit: `git add -A && git commit -m "feat(ingest-worker): port ADM ingest loop"`

---

### Task 11: `@onelife/projector`

**Files:** copy SOURCE `apps/projector/` → DEST: `package.json`, `tsconfig.json`,
`vitest.config.ts`, `Dockerfile`, `src/{backfill-death-stats.ts,config.ts,main.ts,pg-store.ts,
rebuild.ts,tick.ts}`, `test/{backfill-death-stats,config,pg-store,rebuild,tick}.test.ts`. (No news
coupling; uses only the `"projector"` consumer cursor — copy verbatim.)

**Interfaces:** Consumes adm-parser, db, domain, event-log, projections. Folds `events` → the
projection tables; `rebuild` replays from scratch.

- [ ] **Step 1:** Copy all files verbatim.
- [ ] **Step 2:** `pnpm install`.
- [ ] **Step 3:** Run against test DB: `TEST_DATABASE_URL=... pnpm --filter @onelife/projector test`.
  Expected: PASS (backfill-death-stats, config, pg-store, rebuild, tick).
- [ ] **Step 4:** Commit: `git add -A && git commit -m "feat(projector): port event→projection folding"`

---

### Task 12: Full-repo verification + end-to-end smoke

**Files:** none (verification only).

**Interfaces:** Confirms the whole SP1 workspace builds, typechecks, and all ported suites pass
together; proves ingest→project produces lives from the real fixture.

- [ ] **Step 1:** `pnpm turbo run typecheck`. Expected: PASS across all 10 packages.
- [ ] **Step 2:** `TEST_DATABASE_URL=... pnpm turbo run test --concurrency=1`. Expected: PASS across
  all suites.
- [ ] **Step 3:** End-to-end smoke against `packages/adm-parser/test/fixtures/sample.ADM`: point a
  local ingest at the fixture (or feed it through `map-events` → `appendEvents`), run one projector
  tick, and assert ≥1 row lands in `lives` and `players` in a scratch DB. Document the exact command
  used in the commit body.
- [ ] **Step 4:** Update `CHANGELOG.md` (Unreleased → Added: "SP1 foundation, ADM ingest, and life
  projections ported from one-life-platform").
- [ ] **Step 5:** Commit: `git add -A && git commit -m "test: verify SP1 workspace green end-to-end"`

---

## Self-Review

- **Spec coverage (SP1 scope):** multi-server ingest (Tasks 2,4,10) ✓; lives/players/sessions/kills
  projections (Tasks 8,11) ✓; real playtime + PVP tracking (carried by ported projections/read-
  models) ✓; qualified-lives read model (Task 9 — `qualified.ts`) ✓; item 3 players (not device) ✓.
  Out of SP1 by design: RPT/character (SP5), bans (SP3), tokens (SP4), auth/web/verify (SP2).
- **Placeholder scan:** none — every task names exact source/dest paths and exact trims (schema
  lines ~176–296; read-models index 5-line list; test-support `APP_TABLES` removals).
- **Type/name consistency:** package names (`@onelife/db|domain|nitrado|adm-parser|event-log|
  projections|read-models|test-support|ingest-worker|projector`) and the 12-table set are used
  identically across tasks and the Global Constraints.
- **Order safety:** tiers respect the dependency graph — Tier 0 (db, domain, nitrado, adm-parser) →
  Tier 1 (test-support, event-log, projections, read-models) → Tier 2 (ingest-worker, projector).
