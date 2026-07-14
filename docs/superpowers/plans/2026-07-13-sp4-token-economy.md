# SP4 — Unban-Token Economy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A token economy on top of SP2 (verified users) and SP3 (bans): issue a token on verification, monthly grants to verified players, referrals + monthly referral tokens, self-unban by redeeming a token, and token transfers.

**Architecture:** An append-only ledger (`token_transactions`) is the source of truth; **balance = SUM(delta)**, and a UNIQUE `idempotency_key` makes every grant exactly-once. A `@onelife/tokens` package holds all logic (grants, redeem, transfer, referrer), reused by `apps/api` (session-gated routes) and a new `apps/granter` loop (idempotent sweeps run every tick). Redeeming flips the `bans` row to `'lift_pending'` and spends a token instantly; the **existing enforcer** removes it from Nitrado on its next tick (so the `ENFORCER_DRY_RUN` gate still governs every Nitrado write). The web account page gains a wallet section.

**Tech Stack:** Same workspace (TS ESM, Drizzle, Fastify, Next, vitest). No new external deps.

## Global Constraints

- **DEST:** branch `feature/sp4-token-economy` (off `develop`). Local Postgres host **5434**; DB suites need `TEST_DATABASE_URL`.
- **Balance is derived** (`SUM(token_transactions.delta)`), never a stored counter. All spend paths (redeem/transfer) check balance **inside a transaction**.
- **Grants are idempotent** via `idempotency_key` (`verify:{linkId}`, `monthly:{userId}:{YYYY-MM}`, `referral:{referrerId}:{refereeId}:{YYYY-MM}`).
- **Verified user** = has ≥1 `gamertag_links` row with `status='verified'`.
- **Redeem never calls Nitrado** — it sets the ban to `'lift_pending'`; the enforcer removes it (dry-run-gated).
- Commit per task; same trailers as prior SPs.

---

### Task 1: Schema — `token_transactions` + `referrals` (migration `0003`)

**Files:** `packages/db/src/schema.ts` (append 2 tables), `packages/test-support/src/global-setup.ts` (`APP_TABLES += "token_transactions","referrals"`), new `packages/db/drizzle/0003_*.sql`.

```ts
export const tokenTransactions = pgTable("token_transactions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  delta: integer("delta").notNull(),                 // +1 grant, -1 redeem/transfer-out, +1 transfer-in
  kind: text("kind").notNull(),                      // verification|monthly|referral|redeem|transfer_in|transfer_out
  idempotencyKey: text("idempotency_key").notNull(),
  relatedBanId: bigint("related_ban_id", { mode: "number" }),
  counterpartyUserId: text("counterparty_user_id").references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqIdem: uniqueIndex("token_tx_idempotency_uniq").on(t.idempotencyKey),
  byUser: index("token_tx_user_idx").on(t.userId),
}));

export const referrals = pgTable("referrals", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),  // one referrer each
  referrerUserId: text("referrer_user_id").notNull().references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```
(`bans` gains the `'lift_pending'` status **value** — no schema change, `status` is text.)

- [ ] **Step 1:** Append both tables. **Step 2:** add names to `APP_TABLES`. **Step 3:** `db typecheck` PASS.
- [ ] **Step 4:** generate `0003` (creates only the 2 tables). **Step 5:** apply to onelife (5434).
- [ ] **Step 6:** Commit: `feat(db): add token_transactions + referrals + migration`

---

### Task 2: `@onelife/tokens` — balance + grants

**Files:** create `packages/tokens/{package.json,tsconfig.json,vitest.config.ts}`, `src/{index,balance,grant,verified,sweeps}.ts`, `test/{balance-grant,sweeps}.test.ts`. Deps: `@onelife/db`, `drizzle-orm`; dev: `@onelife/test-support`, vitest, postgres, tsx, typescript.

**Interfaces:**
```ts
export function getBalance(db: Database, userId: string): Promise<number>;   // SUM(delta) coalesce 0
export function isVerifiedUser(db: Database, userId: string): Promise<boolean>;
// idempotent +1; returns true if a new row was inserted, false if the key already existed
export function grant(db: Database, a: { userId: string; kind: string; idempotencyKey: string; relatedBanId?: number }): Promise<boolean>;
export function grantVerification(db: Database): Promise<number>;  // verified links lacking verify:{linkId}
export function grantMonthly(db: Database, yyyymm: string): Promise<number>;  // each verified user, monthly:{u}:{ym}
export function grantReferral(db: Database, yyyymm: string): Promise<number>; // per verified referee: referral:{referrer}:{referee}:{ym}
```

- [ ] **Step 1:** Tests (test DB): `grant` inserts +1 and is idempotent on repeat key (balance stays 1); `getBalance` sums deltas; `grantVerification` grants once per verified link (re-run grants 0 more); `grantMonthly` grants one per verified user per month (re-run 0); `grantReferral` grants the referrer one per verified referee, idempotent per month.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(tokens): balance + idempotent grant sweeps (verification/monthly/referral)`

---

### Task 3: `@onelife/tokens` — redeem, transfer, set-referrer

**Files:** add `src/{redeem,transfer,referrer}.ts` + `test/{redeem,transfer,referrer}.test.ts`; export from `index.ts`.

**Interfaces:**
```ts
// spends 1 token, flips the user's active ban to lift_pending (or lifted if it was still pending/dry-run)
export function redeem(db: Database, a: { userId: string; banId?: number }): Promise<{ banId: number; gamertag: string }>;
export function transfer(db: Database, a: { fromUserId: string; toUserId: string }): Promise<void>;
export function setReferrer(db: Database, a: { userId: string; referrerUserId: string }): Promise<void>;
```
Rules (all inside a txn):
- **redeem:** resolve the user's active liftable ban (`status IN ('pending','applied')`) — by `banId` if given (verify the ban's `(server_id, gamertag)` is owned by a `status='verified'` gamertag_link for `userId`), else the most recent such ban; require `getBalance ≥ 1`; insert −1 (`kind='redeem'`, `related_ban_id`); set ban → `'lift_pending'` if it was `'applied'`, else `'lifted'`. Throw typed errors: `no_active_ban`, `insufficient_tokens`, `not_owner`.
- **transfer:** both users verified, `from ≠ to`, `getBalance(from) ≥ 1`; insert `transfer_out`(−1, counterparty=to) + `transfer_in`(+1, counterparty=from). Errors: `insufficient_tokens`, `not_verified`, `self_transfer`.
- **setReferrer:** both verified, `userId ≠ referrerUserId`, no existing referral for `userId`; insert. Errors: `already_set`, `not_verified`, `self_referral`.

- [ ] **Step 1:** Tests (test DB): redeem happy path (balance→0, ban→lift_pending) + errors; redeem on a dry-run `pending` ban → `lifted`; transfer moves 1 token both ways + insufficient/self errors; setReferrer once + already_set/self errors.
- [ ] **Step 2–4:** RED → implement → GREEN.
- [ ] **Step 5:** Commit: `feat(tokens): redeem (via lift_pending), transfer, set-referrer`

---

### Task 4: enforcer handles `lift_pending`

**Files:** modify `apps/enforcer/src/{pg-store,tick}.ts`; extend `apps/enforcer/test/tick.test.ts`.

- Add `liftPendingBans(db)` (status `'lift_pending'`). In `enforcerTick`, after expiry, for each lift-pending ban: if `dryRun` → `markLifted` (log only); else `removeBan(gamertag)` → `markLifted`. Add `markLifted(db,id,at)` (status `'lifted'`). Include `lifted` in the `TickResult`.

- [ ] **Step 1:** Test: seed an `applied` ban, set it to `lift_pending`, run tick `dryRun:false` → `removeBan` called, status `lifted`; `dryRun:true` → no call, status `lifted`.
- [ ] **Step 2–4:** RED → implement → GREEN.
- [ ] **Step 5:** Commit: `feat(enforcer): remove lift_pending bans from Nitrado (dry-run gated)`

---

### Task 5: `apps/api` token routes

**Files:** create `apps/api/src/routes/tokens.ts` (+ referrer route); register in `app.ts`; `apps/api/test/tokens-routes.test.ts`.

Routes (all resolve `getSession`; 401 if none):
- `GET /me/tokens` → `{ balance, transactions: [...recent] }`
- `POST /me/tokens/redeem` `{ banId? }` → redeem; map typed errors to 400/409 with a code.
- `POST /me/tokens/transfer` `{ toUserId }` → transfer.
- `POST /me/referrer` `{ referrerUserId }` → setReferrer.

- [ ] **Step 1:** Tests: a verified user with 1 token GETs balance 1; redeem lifts their active ban and 400s on none; transfer to another verified user moves the token; set-referrer succeeds then 409s on repeat.
- [ ] **Step 2–4:** RED → implement (register in `app.ts` inside the `if (opts)` auth block) → GREEN.
- [ ] **Step 5:** Commit: `feat(api): token wallet/redeem/transfer + referrer routes`

---

### Task 6: `apps/granter` loop app

**Files:** create `apps/granter/{package.json,tsconfig.json,vitest.config.ts,Dockerfile}`, `src/{config,tick,main}.ts`, `test/tick.test.ts`.

- **config:** `DATABASE_URL`, `GRANTER_INTERVAL_SECONDS` (default 300), `LOG_LEVEL`.
- **tick:** `granterTick(db, { now })` → run `grantVerification(db)`, `grantMonthly(db, ym(now))`, `grantReferral(db, ym(now))`; return counts. `ym(date)` = `YYYY-MM` (UTC).
- **main:** verifier-style loop.

- [ ] **Step 1:** Test (test DB): seed a verified user + a referral; run `granterTick` twice → first grants (verification+monthly+referral), second grants 0 (idempotent).
- [ ] **Step 2–4:** RED → implement + author Dockerfile (mirror verifier) → GREEN.
- [ ] **Step 5:** Commit: `feat(granter): idempotent token grant sweeps loop + Dockerfile`

---

### Task 7: `apps/web` wallet UI

**Files:** add `apps/web/src/components/token-wallet.tsx` (+ test); extend `apps/web/src/app/account/page.tsx` to render it; add token API calls to `apps/web/src/lib/api.ts` + types.

- Wallet component (client): shows balance, a "Use a token to lift my ban" button (calls redeem), a transfer form (recipient + submit), and a set-referrer form. Uses TanStack Query like the existing claim components. Keep it minimal and consistent with existing UI.

- [ ] **Step 1:** Component test (render + a mocked api): shows the balance and disables redeem at 0. **Step 2–4:** implement, `web typecheck` + `test` + `build` PASS.
- [ ] **Step 5:** Commit: `feat(web): token wallet on the account page`

---

### Task 8: Verify + wire granter + docs

- [ ] **Step 1:** `pnpm turbo run typecheck` + `test --concurrency=1` → all PASS.
- [ ] **Step 2:** Add `granter` service to `docker-compose.yml`; `.env.example` `GRANTER_INTERVAL_SECONDS=300`.
- [ ] **Step 3:** `CHANGELOG.md` (Added: SP4) + `CLAUDE.md` (SP4 ✅; add `tokens` package + `granter` app).
- [ ] **Step 4:** Commit: `test: verify SP4; wire granter + docs`. Branch ready for the PR-into-develop flow.

---

## Self-Review

- **Coverage:** issue-on-verify (Task 2 `grantVerification`, item 13) ✓; monthly to verified (14) ✓; set referrer (Task 3, 15) ✓; monthly per referral (Task 2 `grantReferral`, 16) ✓; self-unban (Task 3 redeem + Task 4 enforcer, 17) ✓; transfer (Task 3, 18) ✓.
- **Safety:** redeem never writes to Nitrado; the enforcer (dry-run gated) is still the sole Nitrado writer (Task 4).
- **Correctness:** balance derived + spend checked in-txn; grants idempotent by key; `referrals.user_id` PK enforces one referrer.
- **Placeholder scan:** interfaces, schema, idempotency keys, and error codes are all concrete.
