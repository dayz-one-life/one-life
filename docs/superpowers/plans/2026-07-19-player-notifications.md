# Player Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give verified players an inbox — a `notifications` table fed by a sweep worker, surfaced in the controls rail and delivered by web push.

**Architecture:** A new `apps/notifier` worker runs two passes per tick. `generateTick` runs a list of `Generator` functions that read existing durable state (bans, token transactions, lives, articles, gamertag links) and emit `NotificationDraft[]`; a single bulk insert with `onConflictDoNothing` on a unique `natural_key` provides idempotency. `pushTick` then sweeps unpushed rows and fans them out to registered browser push subscriptions. Nothing writes notifications inline from other workers.

**Tech Stack:** TypeScript/ESM, Postgres + Drizzle, Fastify, Next.js App Router, TanStack Query, vitest, `web-push`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-19-player-notifications-design.md`.
- Every `naturalKey` is built **in TypeScript** from an integer primary key. Never render a natural key in SQL.
- `notifications.natural_key` carries a **plain, full** unique index. `onConflictDoNothing` against it takes **no `targetWhere`** — do not copy that argument from `apps/newsdesk/src/pg-store.ts`.
- Neither new table may be added to the truncate list in `apps/projector/src/rebuild.ts`. Both **must** be added to `APP_TABLES` in `packages/test-support/src/global-setup.ts`.
- **This release reshapes the `lives` projection** (new `qualified_at` column, written by the fold). Deploy therefore requires `./deploy/deploy.sh --rebuild`. Migrations live in `packages/db/drizzle/` — the latest is `0014_article_natural_key_and_blocks.sql`, so the new one is `0015_*`.
- `qualified_at` is **write-once**: never overwrite a non-null value. The fold observes candidates in event order, so write-once yields the earliest, matching `lifeQualifiedAt`'s "earliest candidate wins" semantics.
- The fold credits playtime only at **session close** (`closeOpen`), so a playtime-qualified life's `qualified_at` is **backdated to the true crossing instant but written late** — at disconnect. Kill and pvp-death qualification are written immediately. `NOTIFIER_LOOKBACK_HOURS` defaults to **48** to absorb that lag.
- `NOTIFIER_SINCE` unset, empty, or unparseable ⇒ generation produces zero drafts and performs zero writes.
- `NOTIFIER_DRY_RUN` defaults to `true`.
- `NOTIFIER_PUSH_ENABLED` defaults to `true` and gates only `pushTick`; a push failure must never stop generation.
- Notifications are only ever generated for users with a `verified` row in `gamertag_links`.
- `qualifiedLifeCondition(db)` references `players.gamertag`; any query using it must join `players`.
- Token transaction kinds are `verification|monthly|referral|redeem|transfer_in|transfer_out`. There is no `transfer` kind.
- Run tests with `pnpm turbo run test --concurrency=1`; typecheck with `pnpm turbo run typecheck`.
- **DB suites require this exact env var** (Docker Postgres is on port 5434 on this machine, not the 5432 default baked into `packages/test-support/src/guard.ts`):
  `TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5434/onelife_test"`
  Prefix every test command with it. Baseline before this work: `@onelife/read-models` 106 tests passing.
- Work happens on branch `feature/player-notifications`.

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `packages/db/drizzle/0015_notifications.sql` | migration |
| `apps/notifier/package.json`, `tsconfig.json`, `vitest.config.ts` | package scaffolding |
| `apps/notifier/src/config.ts` | zod env → `Config` |
| `apps/notifier/src/types.ts` | `NotificationDraft`, `Generator`, `GeneratorDeps` |
| `apps/notifier/src/generators/*.ts` | one file per catalogue group |
| `apps/notifier/src/generate.ts` | `generateTick` orchestration + bulk insert |
| `apps/notifier/src/push-store.ts` | push-related queries |
| `apps/notifier/src/push.ts` | `pushTick` |
| `apps/notifier/src/sender.ts` | `web-push` transport |
| `apps/notifier/src/main.ts` | loop |
| `apps/api/src/routes/notifications.ts` | `/me/notifications`, push subscription routes, `/push/vapid-key` |
| `apps/web/src/components/controls/notifications-panel.tsx` | presentational panel |
| `apps/web/src/components/controls/push-toggle.tsx` | permission + subscribe button |
| `apps/web/public/sw.js` | service worker |
| `apps/web/public/manifest.json` | PWA manifest |

**Modified**

| Path | Change |
|---|---|
| `packages/db/src/schema.ts` | two new tables |
| `packages/db/drizzle/meta/_journal.json` | migration entry (generated) |
| `packages/test-support/src/global-setup.ts` | add both tables to `APP_TABLES` |
| `apps/api/src/app.ts` | register the new routes |
| `apps/web/src/lib/types.ts` | `Notification`, `NotificationsFeed` |
| `apps/web/src/lib/api.ts` | client functions |
| `apps/web/src/components/controls/use-controls.ts` | notifications query + markRead mutation |
| `apps/web/src/components/controls/rail.tsx` | mount panel |
| `apps/web/src/components/controls/mobile-controls.tsx` | mount panel |
| `apps/web/src/app/layout.tsx` | link manifest |
| `deploy/deploy.sh` | add `notifier` to `SERVICES` |
| `deploy/README.md` | unit table + env vars |
| `CHANGELOG.md`, `CLAUDE.md` | required before PR |

---

### Task 1: Schema and migration

**Files:**
- Modify: `packages/db/src/schema.ts` (append after the `referrals` table; also `lives` at ~line 77-95)
- Modify: `packages/test-support/src/global-setup.ts:5-32`
- Create: `packages/db/drizzle/0015_notifications.sql`

**Interfaces:**
- Consumes: nothing
- Produces: `notifications` and `pushSubscriptions` drizzle tables plus a `lives.qualifiedAt` column, all exported from `@onelife/db` via the existing `export * from "./schema.js"` barrel.

- [ ] **Step 0: Add `qualified_at` to the `lives` table**

In `packages/db/src/schema.ts`, in the `lives` table definition, add after `playtimeSeconds`:

```ts
  // The instant this life became qualified (earliest of: playtime crossing QUALIFY_SECONDS,
  // first kill in the life, pvp death). Written WRITE-ONCE by the projector fold; null until
  // the life qualifies. Materializes what lifeQualifiedAt() computes at read time.
  qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
```

And in the same table's `(t) => ({ ... })` index block (add one in the file's neighbouring
style if `lives` has none):

```ts
  qualifiedAtIdx: index("lives_qualified_at_idx").on(t.qualifiedAt).where(sql`${t.qualifiedAt} IS NOT NULL`),
```

- [ ] **Step 1: Add the tables to the schema**

Append to `packages/db/src/schema.ts`:

```ts
// ── Player notifications. Durable: NOT in apps/projector/src/rebuild.ts's truncate
// list, so a --rebuild never drops a player's inbox. Dedup is the natural_key unique
// index — a PLAIN unique index, so onConflictDoNothing against it takes no targetWhere. ──

export const notifications = pgTable("notifications", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  naturalKey: text("natural_key").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  href: text("href").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp("read_at", { withTimezone: true }),
  pushedAt: timestamp("pushed_at", { withTimezone: true }),
}, (t) => ({
  uniqNatural: uniqueIndex("notifications_natural_key_uniq").on(t.naturalKey),
  byUser: index("notifications_user_created_idx").on(t.userId, t.createdAt),
  // Partial indexes MUST be declared here too, not only in the SQL — this repo manages
  // them in drizzle (see articles_discord_unposted_idx, schema.ts ~line 413). A partial
  // index present only in the migration would be dropped by a future drizzle-kit generate.
  unpushedIdx: index("notifications_unpushed_idx").on(t.createdAt).where(sql`${t.pushedAt} IS NULL`),
}));

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  failureCount: integer("failure_count").notNull().default(0),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
}, (t) => ({
  uniqEndpoint: uniqueIndex("push_subscriptions_endpoint_uniq").on(t.endpoint),
  byUser: index("push_subscriptions_user_idx").on(t.userId),
}));
```

- [ ] **Step 2: Write the migration**

Create `packages/db/drizzle/0015_notifications.sql`:

```sql
ALTER TABLE "lives" ADD COLUMN IF NOT EXISTS "qualified_at" timestamp with time zone;
CREATE INDEX IF NOT EXISTS "lives_qualified_at_idx" ON "lives" ("qualified_at") WHERE "qualified_at" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  "natural_key" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "href" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "read_at" timestamp with time zone,
  "pushed_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "notifications_natural_key_uniq" ON "notifications" ("natural_key");
CREATE INDEX IF NOT EXISTS "notifications_user_created_idx" ON "notifications" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "notifications_unpushed_idx" ON "notifications" ("created_at") WHERE "pushed_at" IS NULL;

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "failure_count" integer DEFAULT 0 NOT NULL,
  "disabled_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_uniq" ON "push_subscriptions" ("endpoint");
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx" ON "push_subscriptions" ("user_id");
```

Add the corresponding entry to `packages/db/drizzle/meta/_journal.json` following the shape of the existing idx-14 entry, with `"idx": 15` and `"tag": "0015_notifications"`.

- [ ] **Step 3: Add both tables to the test truncate list**

In `packages/test-support/src/global-setup.ts`, append to `APP_TABLES` after `"article_images"`:

```ts
  "notifications",
  "push_subscriptions",
```

- [ ] **Step 4: Verify the migration applies**

Run: `pnpm --filter @onelife/read-models run test`
Expected: PASS. The harness runs `migrateDb` then truncates `APP_TABLES`; a bad migration or a misspelled table name fails here immediately.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle packages/test-support/src/global-setup.ts
git commit -m "feat(db): notifications, push_subscriptions, and lives.qualified_at (0015)"
```

---

### Task 1B: The fold writes `qualified_at`

**Files:**
- Modify: `packages/domain/src/index.ts` (or the appropriate barrel — add `QUALIFY_SECONDS`)
- Modify: `packages/read-models/src/qualified.ts:4` (re-export from domain instead of declaring)
- Modify: `packages/projections/src/store.ts` (interface)
- Modify: `packages/projections/src/fold.ts:17-26` (`closeOpen`), `:82-91` (`onDied`)
- Modify: `packages/projections/src/memory-store.ts:83-86`
- Modify: `apps/projector/src/pg-store.ts:53-55`
- Test: `packages/projections/test/` (add to the existing fold test file — find it with `ls packages/projections/test/`)

**Interfaces:**
- Consumes: `lives.qualifiedAt` from Task 1.
- Produces:
  - `QUALIFY_SECONDS: number` exported from `@onelife/domain` (value `300`, unchanged).
  - `ProjectionStore.markLifeQualified(lifeId: number, at: Date): Promise<void>` — write-once.
  - `ProjectionStore.addLifePlaytime(lifeId: number, seconds: number): Promise<number>` — **signature change**: now returns the life's NEW total playtime seconds.

Three places a life can become qualified, all in the fold:

| Trigger | Where | Timestamp written |
|---|---|---|
| playtime crosses 300s | `closeOpen` | backdated crossing instant |
| victim died to pvp | `onDied`, after `endLife` | `e.occurredAt` |
| killer got a kill | `onDied`, kill branch | `e.occurredAt` (the **killer's** life) |

- [ ] **Step 1: Move `QUALIFY_SECONDS` to domain**

`projections` depends on `@onelife/domain` but not on `@onelife/read-models`, so the constant must live in domain to be shared. Add to the `@onelife/domain` barrel:

```ts
/** A life qualifies after this much playtime. Shared by the read-time qualification
 *  predicate and the projector fold that materializes lives.qualified_at. */
export const QUALIFY_SECONDS = 300;
```

Then in `packages/read-models/src/qualified.ts`, replace `export const QUALIFY_SECONDS = 300;` with a re-export so existing importers are unaffected:

```ts
export { QUALIFY_SECONDS } from "@onelife/domain";
```

Confirm `packages/read-models/package.json` already lists `@onelife/domain`; add it if not.

- [ ] **Step 2: Write the failing fold tests**

Read the existing fold test file first to match its harness (it uses `memory-store.ts`). Add these cases:

```ts
it("marks a life qualified at the backdated playtime crossing", async () => {
  // Session runs 400s from 12:00:00; the life crosses 300s at 12:05:00.
  const store = new MemoryProjectionStore();
  await applyEvent(store, connectedEvent("Alice", new Date("2026-07-19T12:00:00Z")));
  await applyEvent(store, disconnectedEvent("Alice", new Date("2026-07-19T12:06:40Z")));
  const life = store.lives[0]!;
  expect(life.qualifiedAt?.toISOString()).toBe("2026-07-19T12:05:00.000Z");
});

it("does not mark a life qualified below the playtime threshold", async () => {
  const store = new MemoryProjectionStore();
  await applyEvent(store, connectedEvent("Alice", new Date("2026-07-19T12:00:00Z")));
  await applyEvent(store, disconnectedEvent("Alice", new Date("2026-07-19T12:04:00Z")));
  expect(store.lives[0]!.qualifiedAt).toBeNull();
});

it("marks a pvp victim's life qualified at the death instant", async () => {
  const store = new MemoryProjectionStore();
  await applyEvent(store, connectedEvent("Victim", new Date("2026-07-19T12:00:00Z")));
  await applyEvent(store, diedEvent({ victim: "Victim", cause: "pvp", killer: "Killer", at: new Date("2026-07-19T12:01:00Z") }));
  const life = store.lives.find((l) => l.endedAt !== null)!;
  expect(life.qualifiedAt?.toISOString()).toBe("2026-07-19T12:01:00.000Z");
});

it("marks the KILLER's open life qualified at the kill instant", async () => {
  const store = new MemoryProjectionStore();
  await applyEvent(store, connectedEvent("Killer", new Date("2026-07-19T11:00:00Z")));
  await applyEvent(store, connectedEvent("Victim", new Date("2026-07-19T12:00:00Z")));
  await applyEvent(store, diedEvent({ victim: "Victim", cause: "pvp", killer: "Killer", at: new Date("2026-07-19T12:01:00Z") }));
  const killerPlayer = await store.getPlayer("Killer");
  const killerLife = store.lives.find((l) => l.playerId === killerPlayer!.id)!;
  expect(killerLife.qualifiedAt?.toISOString()).toBe("2026-07-19T12:01:00.000Z");
});

it("never overwrites an existing qualified_at (write-once)", async () => {
  const store = new MemoryProjectionStore();
  await applyEvent(store, connectedEvent("Alice", new Date("2026-07-19T12:00:00Z")));
  await applyEvent(store, disconnectedEvent("Alice", new Date("2026-07-19T12:06:40Z")));
  const first = store.lives[0]!.qualifiedAt!;
  await applyEvent(store, connectedEvent("Alice", new Date("2026-07-19T13:00:00Z")));
  await applyEvent(store, disconnectedEvent("Alice", new Date("2026-07-19T13:10:00Z")));
  expect(store.lives[0]!.qualifiedAt!.getTime()).toBe(first.getTime());
});
```

Adapt the event-constructor helper names to whatever the existing fold test file uses — do not invent new helpers if equivalents exist.

- [ ] **Step 3: Run to confirm failure**

Run: `TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5434/onelife_test" pnpm --filter @onelife/projections run test`
Expected: FAIL — `qualifiedAt` is undefined / `markLifeQualified` is not a function.

- [ ] **Step 4: Extend the store interface**

In `packages/projections/src/store.ts`, change the `addLifePlaytime` line and add `markLifeQualified`:

```ts
  /** Returns the life's NEW total playtime seconds, so the caller can detect the
   *  instant the life crossed QUALIFY_SECONDS. */
  addLifePlaytime(lifeId: number, seconds: number): Promise<number>;
  /** Write-once: sets qualified_at only when it is currently null. */
  markLifeQualified(lifeId: number, at: Date): Promise<void>;
```

Add `qualifiedAt: Date | null` to the `LifeRow` type in `packages/projections/src/types.ts`.

- [ ] **Step 5: Implement in both stores**

`apps/projector/src/pg-store.ts` — replace `addLifePlaytime` and add `markLifeQualified`:

```ts
  async addLifePlaytime(lifeId: number, seconds: number): Promise<number> {
    const rows = await this.tx.update(lives)
      .set({ playtimeSeconds: sql`${lives.playtimeSeconds} + ${seconds}` })
      .where(eq(lives.id, lifeId))
      .returning({ total: lives.playtimeSeconds });
    return rows[0]?.total ?? 0;
  }

  /** Write-once. The IS NULL guard is in the WHERE clause, so a concurrent or replayed
   *  event can never move an already-recorded qualification later. */
  async markLifeQualified(lifeId: number, at: Date): Promise<void> {
    await this.tx.update(lives)
      .set({ qualifiedAt: at })
      .where(and(eq(lives.id, lifeId), isNull(lives.qualifiedAt)));
  }
```

Add `isNull` to the `drizzle-orm` import in that file if absent.

`packages/projections/src/memory-store.ts` — mirror the same semantics:

```ts
  async addLifePlaytime(lifeId: number, seconds: number): Promise<number> {
    const life = this.lives.find((l) => l.id === lifeId);
    if (!life) return 0;
    life.playtimeSeconds += seconds;
    return life.playtimeSeconds;
  }

  async markLifeQualified(lifeId: number, at: Date): Promise<void> {
    const life = this.lives.find((l) => l.id === lifeId);
    if (life && life.qualifiedAt == null) life.qualifiedAt = at;
  }
```

Ensure `createLife` in the memory store initializes `qualifiedAt: null`, and that its `lives` array elements carry `playtimeSeconds`.

- [ ] **Step 6: Wire the three fold call sites**

In `packages/projections/src/fold.ts`, import the constant:

```ts
import { QUALIFY_SECONDS } from "@onelife/domain";
```

Replace the body of `closeOpen`:

```ts
async function closeOpen(store: ProjectionStore, session: SessionRow, at: Date, reason: string, capAt?: Date | null): Promise<void> {
  let end = at;
  if (capAt !== undefined) {
    const cap = Math.max(capAt?.getTime() ?? session.connectedAt.getTime(), session.connectedAt.getTime());
    end = new Date(Math.min(at.getTime(), cap));
  }
  const d = durationSeconds(session.connectedAt, end);
  await store.closeSession(session.id, end, d, reason);
  const total = await store.addLifePlaytime(session.lifeId, d);
  const prior = total - d;
  // Playtime is only credited at session close, so qualified_at is BACKDATED to the
  // instant the life actually crossed the threshold mid-session.
  if (prior < QUALIFY_SECONDS && total >= QUALIFY_SECONDS) {
    const crossing = new Date(session.connectedAt.getTime() + (QUALIFY_SECONDS - prior) * 1000);
    await store.markLifeQualified(session.lifeId, crossing);
  }
}
```

In `onDied`, immediately after the `await store.endLife(life.id, {...});` line:

```ts
  if (cause === "pvp") await store.markLifeQualified(life.id, e.occurredAt);
```

And inside the existing `if (cause === "pvp" && killer && killer !== victim)` block, after `insertKill`:

```ts
    // A kill qualifies the KILLER's life too — insertKill only records the victim's.
    if (killerPlayer) {
      const killerLifeId = await store.findLifeIdAt(e.serverId, killerPlayer.id, e.occurredAt);
      if (killerLifeId != null) await store.markLifeQualified(killerLifeId, e.occurredAt);
    }
```

- [ ] **Step 7: Run tests to confirm pass**

Run: `TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5434/onelife_test" pnpm --filter @onelife/projections run test && TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5434/onelife_test" pnpm --filter @onelife/projector run test && TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5434/onelife_test" pnpm --filter @onelife/read-models run test`
Expected: PASS for all three. The read-models run confirms the `QUALIFY_SECONDS` re-export did not break existing importers.

- [ ] **Step 8: Commit**

```bash
git add packages/domain packages/read-models/src/qualified.ts packages/projections apps/projector/src/pg-store.ts
git commit -m "feat(projections): fold materializes lives.qualified_at write-once"
```

---

### Task 2: Notifier package scaffolding and config

**Files:**
- Create: `apps/notifier/package.json`, `apps/notifier/tsconfig.json`, `apps/notifier/vitest.config.ts`
- Create: `apps/notifier/src/config.ts`
- Test: `apps/notifier/test/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env: Record<string, string | undefined>): Config` where

```ts
export type Config = {
  databaseUrl: string;
  intervalSeconds: number;
  logLevel: string;
  since: Date | null;          // null ⇒ generation OFF
  dryRun: boolean;
  lookbackHours: number;
  siteUrl: string;
  pushEnabled: boolean;
  pushMaxPerTick: number;
  pushMaxAgeMinutes: number;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidSubject: string;
};
```

- [ ] **Step 1: Create the package files**

`apps/notifier/package.json`:

```json
{
  "name": "@onelife/notifier",
  "version": "0.0.0",
  "type": "module",
  "main": "src/main.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "start": "tsx src/main.ts"
  },
  "dependencies": {
    "@onelife/db": "workspace:*",
    "@onelife/read-models": "workspace:*",
    "pino": "^9.4.0",
    "web-push": "^3.6.7",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@onelife/test-support": "workspace:*",
    "@types/web-push": "^3.6.3",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "tsx": "^4.19.0",
    "postgres": "^3.4.4"
  }
}
```

Copy `apps/granter/tsconfig.json` and `apps/granter/vitest.config.ts` verbatim to `apps/notifier/`.

- [ ] **Step 2: Write the failing config test**

`apps/notifier/test/config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const base = { DATABASE_URL: "postgres://x/y", SITE_URL: "https://dayzonelife.com" };

describe("loadConfig", () => {
  it("defaults dry run on and push enabled", () => {
    const c = loadConfig(base);
    expect(c.dryRun).toBe(true);
    expect(c.pushEnabled).toBe(true);
    expect(c.intervalSeconds).toBe(60);
    expect(c.lookbackHours).toBe(48);
    expect(c.pushMaxPerTick).toBe(50);
    expect(c.pushMaxAgeMinutes).toBe(60);
  });

  it("leaves since null when unset, empty, or unparseable", () => {
    expect(loadConfig(base).since).toBeNull();
    expect(loadConfig({ ...base, NOTIFIER_SINCE: "" }).since).toBeNull();
    expect(loadConfig({ ...base, NOTIFIER_SINCE: "not-a-date" }).since).toBeNull();
  });

  it("parses a valid ISO since", () => {
    const c = loadConfig({ ...base, NOTIFIER_SINCE: "2026-07-19T00:00:00Z" });
    expect(c.since?.toISOString()).toBe("2026-07-19T00:00:00.000Z");
  });

  it("reads NOTIFIER_DRY_RUN=false as live", () => {
    expect(loadConfig({ ...base, NOTIFIER_DRY_RUN: "false" }).dryRun).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to confirm failure**

Run: `pnpm --filter @onelife/notifier run test`
Expected: FAIL — cannot resolve `../src/config.js`.

- [ ] **Step 4: Implement the config**

`apps/notifier/src/config.ts`:

```ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SITE_URL: z.string().min(1),
  NOTIFIER_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  NOTIFIER_SINCE: z.string().optional(),
  NOTIFIER_DRY_RUN: z.enum(["true", "false"]).default("true"),
  NOTIFIER_LOOKBACK_HOURS: z.coerce.number().int().positive().default(48),
  NOTIFIER_PUSH_ENABLED: z.enum(["true", "false"]).default("true"),
  NOTIFIER_PUSH_MAX_PER_TICK: z.coerce.number().int().positive().default(50),
  NOTIFIER_PUSH_MAX_AGE_MINUTES: z.coerce.number().int().positive().default(60),
  VAPID_PUBLIC_KEY: z.string().default(""),
  VAPID_PRIVATE_KEY: z.string().default(""),
  VAPID_SUBJECT: z.string().default(""),
  LOG_LEVEL: z.string().default("info"),
});

export type Config = {
  databaseUrl: string; intervalSeconds: number; logLevel: string;
  since: Date | null; dryRun: boolean; lookbackHours: number; siteUrl: string;
  pushEnabled: boolean; pushMaxPerTick: number; pushMaxAgeMinutes: number;
  vapidPublicKey: string; vapidPrivateKey: string; vapidSubject: string;
};

/** An unset, empty, or unparseable NOTIFIER_SINCE means generation is OFF — never a
 *  silent epoch default, which would notify every player about their entire history. */
function parseSince(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const p = schema.parse(env);
  return {
    databaseUrl: p.DATABASE_URL,
    intervalSeconds: p.NOTIFIER_INTERVAL_SECONDS,
    logLevel: p.LOG_LEVEL,
    since: parseSince(p.NOTIFIER_SINCE),
    dryRun: p.NOTIFIER_DRY_RUN === "true",
    lookbackHours: p.NOTIFIER_LOOKBACK_HOURS,
    siteUrl: p.SITE_URL,
    pushEnabled: p.NOTIFIER_PUSH_ENABLED === "true",
    pushMaxPerTick: p.NOTIFIER_PUSH_MAX_PER_TICK,
    pushMaxAgeMinutes: p.NOTIFIER_PUSH_MAX_AGE_MINUTES,
    vapidPublicKey: p.VAPID_PUBLIC_KEY,
    vapidPrivateKey: p.VAPID_PRIVATE_KEY,
    vapidSubject: p.VAPID_SUBJECT,
  };
}
```

- [ ] **Step 5: Run tests to confirm pass**

Run: `pnpm --filter @onelife/notifier run test`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/notifier
git commit -m "feat(notifier): package scaffolding and config"
```

---

### Task 3: Generator types and `generateTick` orchestration

**Files:**
- Create: `apps/notifier/src/types.ts`, `apps/notifier/src/generate.ts`
- Test: `apps/notifier/test/generate.test.ts`

**Interfaces:**
- Consumes: `Config` from Task 2.
- Produces:

```ts
export type NotificationDraft = {
  userId: string; kind: string; naturalKey: string;
  title: string; body: string; href: string;
};
export type GeneratorDeps = {
  db: Database; now: Date; since: Date; lookbackHours: number; siteUrl: string;
};
export type Generator = (deps: GeneratorDeps) => Promise<NotificationDraft[]>;
export type GenerateResult = { drafts: number; inserted: number; disabled: boolean };
export async function generateTick(
  db: Database,
  deps: { generators: Generator[]; now: Date; since: Date | null; lookbackHours: number;
          siteUrl: string; dryRun: boolean; log: Log },
): Promise<GenerateResult>;
```

- [ ] **Step 1: Write the failing test**

`apps/notifier/test/generate.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { user, notifications } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { generateTick } from "../src/generate.js";
import type { Generator } from "../src/types.js";

const { db, sql } = getTestDb();
const log = { info: () => {}, warn: () => {} };
const NOW = new Date("2026-07-19T12:00:00Z");
const SINCE = new Date("2026-07-01T00:00:00Z");

beforeAll(async () => {
  await db.insert(user).values({ id: "nu1", name: "NU1", email: "nu1@x.com" });
});
beforeEach(async () => { await db.delete(notifications); });
afterAll(async () => { await sql.end(); });

const oneDraft: Generator = async () => [{
  userId: "nu1", kind: "test_kind", naturalKey: "test:1",
  title: "T", body: "B", href: "/x",
}];

const base = { now: NOW, since: SINCE, lookbackHours: 24, siteUrl: "https://s", log };

describe("generateTick", () => {
  it("writes nothing when since is null (generation off)", async () => {
    const r = await generateTick(db, { ...base, since: null, dryRun: false, generators: [oneDraft] });
    expect(r).toEqual({ drafts: 0, inserted: 0, disabled: true });
    expect(await db.select().from(notifications)).toHaveLength(0);
  });

  it("writes nothing in dry run", async () => {
    const r = await generateTick(db, { ...base, dryRun: true, generators: [oneDraft] });
    expect(r.drafts).toBe(1);
    expect(r.inserted).toBe(0);
    expect(await db.select().from(notifications)).toHaveLength(0);
  });

  it("inserts drafts when live", async () => {
    const r = await generateTick(db, { ...base, dryRun: false, generators: [oneDraft] });
    expect(r.inserted).toBe(1);
    expect(await db.select().from(notifications)).toHaveLength(1);
  });

  it("is idempotent — running twice inserts one row", async () => {
    await generateTick(db, { ...base, dryRun: false, generators: [oneDraft] });
    const second = await generateTick(db, { ...base, dryRun: false, generators: [oneDraft] });
    expect(second.inserted).toBe(0);
    expect(await db.select().from(notifications)).toHaveLength(1);
  });

  it("dedups duplicate natural keys within a single batch", async () => {
    const r = await generateTick(db, { ...base, dryRun: false, generators: [oneDraft, oneDraft] });
    expect(r.inserted).toBe(1);
    expect(await db.select().from(notifications)).toHaveLength(1);
  });

  it("one failing generator does not stop the others", async () => {
    const boom: Generator = async () => { throw new Error("boom"); };
    const r = await generateTick(db, { ...base, dryRun: false, generators: [boom, oneDraft] });
    expect(r.inserted).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `pnpm --filter @onelife/notifier run test generate`
Expected: FAIL — cannot resolve `../src/generate.js`.

- [ ] **Step 3: Implement types**

`apps/notifier/src/types.ts`:

```ts
import type { Database } from "@onelife/db";

export type NotificationDraft = {
  userId: string;
  kind: string;
  naturalKey: string;
  title: string;
  body: string;
  href: string;
};

export type GeneratorDeps = {
  db: Database;
  now: Date;
  since: Date;
  lookbackHours: number;
  siteUrl: string;
};

export type Generator = (deps: GeneratorDeps) => Promise<NotificationDraft[]>;

export type Log = {
  info: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
};

/** Lower bound for a generator's query window: the later of the global cutoff and
 *  now-minus-lookback. Bounds per-tick work without ever reaching before go-live. */
export function windowStart(deps: GeneratorDeps): Date {
  const lookback = new Date(deps.now.getTime() - deps.lookbackHours * 3600_000);
  return lookback > deps.since ? lookback : deps.since;
}
```

- [ ] **Step 4: Implement `generateTick`**

`apps/notifier/src/generate.ts`:

```ts
import type { Database } from "@onelife/db";
import { notifications } from "@onelife/db";
import type { Generator, Log, NotificationDraft } from "./types.js";

export type GenerateResult = { drafts: number; inserted: number; disabled: boolean };

export type GenerateDeps = {
  generators: Generator[];
  now: Date;
  since: Date | null;
  lookbackHours: number;
  siteUrl: string;
  dryRun: boolean;
  log: Log;
};

/** Drop drafts sharing a naturalKey. Postgres rejects an ON CONFLICT batch that
 *  conflicts with ITSELF ("cannot affect row a second time"), so intra-batch dedup
 *  must happen here — the unique index only protects against prior ticks. */
function dedupe(drafts: NotificationDraft[]): NotificationDraft[] {
  const seen = new Set<string>();
  return drafts.filter((d) => (seen.has(d.naturalKey) ? false : (seen.add(d.naturalKey), true)));
}

/** Run every generator, then insert all drafts in one statement. The unique index on
 *  natural_key IS the anti-join: no cursor, no per-row existence check.
 *
 *  NOTE: onConflictDoNothing targets a PLAIN unique index, so it takes no targetWhere.
 *  Do not copy the targetWhere argument from apps/newsdesk/src/pg-store.ts, whose
 *  index is partial. */
export async function generateTick(db: Database, deps: GenerateDeps): Promise<GenerateResult> {
  if (!deps.since) return { drafts: 0, inserted: 0, disabled: true };

  const genDeps = {
    db, now: deps.now, since: deps.since,
    lookbackHours: deps.lookbackHours, siteUrl: deps.siteUrl,
  };

  const all: NotificationDraft[] = [];
  for (const gen of deps.generators) {
    // One broken generator must not cost the whole tick.
    try {
      all.push(...(await gen(genDeps)));
    } catch (err) {
      deps.log.warn?.({ err }, "notification generator failed (skipped this tick)");
    }
  }

  const drafts = dedupe(all);
  if (deps.dryRun) {
    for (const d of drafts) deps.log.info({ kind: d.kind, naturalKey: d.naturalKey }, "DRY RUN: would notify");
    return { drafts: drafts.length, inserted: 0, disabled: false };
  }
  if (drafts.length === 0) return { drafts: 0, inserted: 0, disabled: false };

  const rows = await db
    .insert(notifications)
    .values(drafts)
    .onConflictDoNothing({ target: notifications.naturalKey })
    .returning({ id: notifications.id });

  return { drafts: drafts.length, inserted: rows.length, disabled: false };
}
```

- [ ] **Step 5: Run tests to confirm pass**

Run: `pnpm --filter @onelife/notifier run test generate`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/notifier/src/types.ts apps/notifier/src/generate.ts apps/notifier/test/generate.test.ts
git commit -m "feat(notifier): generateTick orchestration with natural-key dedup"
```

---

### Task 4: Account generators

**Files:**
- Create: `apps/notifier/src/generators/account.ts`
- Test: `apps/notifier/test/generators-account.test.ts`

**Interfaces:**
- Consumes: `Generator`, `NotificationDraft`, `windowStart` from `../types.js`.
- Produces: `gamertagVerifiedGenerator: Generator`, `tokensGenerator: Generator`.

- [ ] **Step 1: Write the failing test**

`apps/notifier/test/generators-account.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, gamertagLinks, tokenTransactions } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { gamertagVerifiedGenerator, tokensGenerator } from "../src/generators/account.js";

const { db, sql } = getTestDb();
const NOW = new Date("2026-07-19T12:00:00Z");
const deps = { db, now: NOW, since: new Date("2026-07-01T00:00:00Z"), lookbackHours: 24, siteUrl: "https://s" };

beforeAll(async () => {
  await db.insert(user).values([
    { id: "ac1", name: "AC1", email: "ac1@x.com" },
    { id: "ac2", name: "AC2", email: "ac2@x.com" },
  ]);
  await db.insert(gamertagLinks).values([
    { userId: "ac1", gamertag: "AcOne", status: "verified", verifiedAt: new Date("2026-07-19T11:00:00Z") },
    { userId: "ac2", gamertag: "AcTwo", status: "pending" },
  ]);
  await db.insert(tokenTransactions).values([
    { userId: "ac1", delta: 1, kind: "monthly", idempotencyKey: "ntf-m-1", createdAt: new Date("2026-07-19T11:30:00Z") },
    { userId: "ac1", delta: 1, kind: "transfer_in", idempotencyKey: "ntf-t-1", createdAt: new Date("2026-07-19T11:40:00Z") },
    { userId: "ac1", delta: -1, kind: "redeem", idempotencyKey: "ntf-r-1", createdAt: new Date("2026-07-19T11:50:00Z") },
    { userId: "ac1", delta: 1, kind: "monthly", idempotencyKey: "ntf-m-old", createdAt: new Date("2026-06-01T00:00:00Z") },
  ]);
});
afterAll(async () => { await sql.end(); });

describe("gamertagVerifiedGenerator", () => {
  it("emits one draft for a verified link and ignores pending", async () => {
    const drafts = await gamertagVerifiedGenerator(deps);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].userId).toBe("ac1");
    expect(drafts[0].kind).toBe("gamertag_verified");
    expect(drafts[0].naturalKey).toMatch(/^gamertag_verified:\d+$/);
    expect(drafts[0].href).toBe("/players/acone");
  });
});

describe("tokensGenerator", () => {
  it("emits grants and transfers-in, never redeems or out-of-window rows", async () => {
    const drafts = await tokensGenerator(deps);
    const kinds = drafts.map((d) => d.kind).sort();
    expect(kinds).toEqual(["tokens_granted", "tokens_received"]);
    expect(drafts.every((d) => d.naturalKey.startsWith("tokens:"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `pnpm --filter @onelife/notifier run test generators-account`
Expected: FAIL — cannot resolve `../src/generators/account.js`.

- [ ] **Step 3: Implement the generators**

`apps/notifier/src/generators/account.ts`:

```ts
import { gamertagLinks, tokenTransactions } from "@onelife/db";
import { and, eq, gte, inArray } from "drizzle-orm";
import type { Generator, NotificationDraft } from "../types.js";
import { windowStart } from "../types.js";

/** Mirror of apps/web/src/lib/slug.ts playerSlug — kept local so the worker does not
 *  depend on the web app. Both must stay in step or notification links 404. */
export function playerSlug(gamertag: string): string {
  return gamertag.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export const gamertagVerifiedGenerator: Generator = async (deps) => {
  const from = windowStart(deps);
  const rows = await deps.db
    .select({ id: gamertagLinks.id, userId: gamertagLinks.userId, gamertag: gamertagLinks.gamertag })
    .from(gamertagLinks)
    .where(and(eq(gamertagLinks.status, "verified"), gte(gamertagLinks.verifiedAt, from)));

  return rows.map((r): NotificationDraft => ({
    userId: r.userId,
    kind: "gamertag_verified",
    naturalKey: `gamertag_verified:${r.id}`,
    title: "Gamertag verified",
    body: `${r.gamertag} is yours. Your lives are now tracked.`,
    href: `/players/${playerSlug(r.gamertag)}`,
  }));
};

const GRANT_KINDS = ["monthly", "referral", "verification"] as const;

const GRANT_BODY: Record<string, string> = {
  monthly: "Your monthly unban token landed.",
  referral: "A referral paid out — one unban token.",
  verification: "Verification bonus — one unban token.",
};

export const tokensGenerator: Generator = async (deps) => {
  const from = windowStart(deps);
  const rows = await deps.db
    .select({ id: tokenTransactions.id, userId: tokenTransactions.userId, kind: tokenTransactions.kind })
    .from(tokenTransactions)
    .where(and(
      gte(tokenTransactions.createdAt, from),
      inArray(tokenTransactions.kind, [...GRANT_KINDS, "transfer_in"]),
    ));

  return rows.map((r): NotificationDraft => {
    const received = r.kind === "transfer_in";
    return {
      userId: r.userId,
      kind: received ? "tokens_received" : "tokens_granted",
      naturalKey: `tokens:${r.id}`,
      title: received ? "Token received" : "Token granted",
      body: received ? "Another survivor sent you an unban token." : (GRANT_BODY[r.kind] ?? "You received an unban token."),
      href: "/",
    };
  });
};
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `pnpm --filter @onelife/notifier run test generators-account`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/notifier/src/generators/account.ts apps/notifier/test/generators-account.test.ts
git commit -m "feat(notifier): account generators (gamertag verified, tokens)"
```

---

### Task 5: Ban generators

**Files:**
- Create: `apps/notifier/src/generators/bans.ts`
- Test: `apps/notifier/test/generators-bans.test.ts`

**Interfaces:**
- Consumes: `Generator`, `windowStart`, `playerSlug` from Task 4.
- Produces: `banAppliedGenerator: Generator`, `banLiftedGenerator: Generator`.

A ban row carries a `gamertag`, not a `userId`, so both generators join `gamertag_links` on a case-insensitive gamertag match with `status = 'verified'`. An unverified player's ban produces no notification.

- [ ] **Step 1: Write the failing test**

`apps/notifier/test/generators-bans.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, servers, gamertagLinks, bans } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { banAppliedGenerator, banLiftedGenerator } from "../src/generators/bans.js";

const { db, sql } = getTestDb();
const NOW = new Date("2026-07-19T12:00:00Z");
const deps = { db, now: NOW, since: new Date("2026-07-01T00:00:00Z"), lookbackHours: 24, siteUrl: "https://s" };

beforeAll(async () => {
  await db.insert(user).values([
    { id: "bn1", name: "BN1", email: "bn1@x.com" },
    { id: "bn2", name: "BN2", email: "bn2@x.com" },
  ]);
  const [s] = await db.insert(servers).values({ nitradoServiceId: 991001, name: "bansrv", slug: "bansrv" }).returning();
  await db.insert(gamertagLinks).values([
    { userId: "bn1", gamertag: "BanOne", status: "verified", verifiedAt: new Date("2026-07-02T00:00:00Z") },
    { userId: "bn2", gamertag: "BanTwo", status: "pending" },
  ]);
  await db.insert(bans).values([
    { serverId: s.id, gamertag: "banone", lifeStartedAt: new Date("2026-07-18T00:00:00Z"),
      reason: "qualified_death", bannedAt: new Date("2026-07-19T11:00:00Z"),
      expiresAt: new Date("2026-07-20T11:00:00Z"), status: "applied", dryRun: false,
      appliedAt: new Date("2026-07-19T11:01:00Z") },
    { serverId: s.id, gamertag: "BanOne", lifeStartedAt: new Date("2026-07-16T00:00:00Z"),
      reason: "qualified_death", bannedAt: new Date("2026-07-17T00:00:00Z"),
      expiresAt: new Date("2026-07-19T11:30:00Z"), status: "expired", dryRun: false,
      liftedAt: new Date("2026-07-19T11:30:00Z") },
    { serverId: s.id, gamertag: "BanTwo", lifeStartedAt: new Date("2026-07-18T00:00:00Z"),
      reason: "qualified_death", bannedAt: new Date("2026-07-19T11:00:00Z"),
      expiresAt: new Date("2026-07-20T11:00:00Z"), status: "applied", dryRun: false,
      appliedAt: new Date("2026-07-19T11:02:00Z") },
  ]);
});
afterAll(async () => { await sql.end(); });

describe("banAppliedGenerator", () => {
  it("notifies the verified owner and matches gamertag case-insensitively", async () => {
    const drafts = await banAppliedGenerator(deps);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].userId).toBe("bn1");
    expect(drafts[0].kind).toBe("ban_applied");
    expect(drafts[0].naturalKey).toMatch(/^ban_applied:\d+$/);
  });

  it("ignores a ban whose gamertag is only pending", async () => {
    const drafts = await banAppliedGenerator(deps);
    expect(drafts.some((d) => d.userId === "bn2")).toBe(false);
  });
});

describe("banLiftedGenerator", () => {
  it("emits one draft for an expired ban", async () => {
    const drafts = await banLiftedGenerator(deps);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].kind).toBe("ban_lifted");
    expect(drafts[0].naturalKey).toMatch(/^ban_lifted:\d+$/);
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `pnpm --filter @onelife/notifier run test generators-bans`
Expected: FAIL — cannot resolve `../src/generators/bans.js`.

- [ ] **Step 3: Implement the generators**

`apps/notifier/src/generators/bans.ts`:

```ts
import { bans, gamertagLinks, servers } from "@onelife/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Generator, NotificationDraft } from "../types.js";
import { windowStart } from "../types.js";
import { playerSlug } from "./account.js";

/** Bans are keyed by gamertag; an inbox is keyed by user. The only bridge is a verified
 *  gamertag_links row, matched case-insensitively because ban rows carry whatever casing
 *  the ADM log used. */
const verifiedOwner = and(
  eq(gamertagLinks.status, "verified"),
  sql`lower(${gamertagLinks.gamertag}) = lower(${bans.gamertag})`,
);

export const banAppliedGenerator: Generator = async (deps) => {
  const from = windowStart(deps);
  const rows = await deps.db
    .select({
      id: bans.id, userId: gamertagLinks.userId, gamertag: gamertagLinks.gamertag,
      serverName: servers.name, expiresAt: bans.expiresAt,
    })
    .from(bans)
    .innerJoin(gamertagLinks, verifiedOwner)
    .innerJoin(servers, eq(servers.id, bans.serverId))
    .where(and(eq(bans.status, "applied"), gte(bans.bannedAt, from)));

  return rows.map((r): NotificationDraft => ({
    userId: r.userId,
    kind: "ban_applied",
    naturalKey: `ban_applied:${r.id}`,
    title: "You died on a qualified life",
    body: `${r.serverName}: banned for 24 hours. Spend an unban token to come back early.`,
    href: `/players/${playerSlug(r.gamertag)}`,
  }));
};

export const banLiftedGenerator: Generator = async (deps) => {
  const from = windowStart(deps);
  const rows = await deps.db
    .select({
      id: bans.id, userId: gamertagLinks.userId, gamertag: gamertagLinks.gamertag,
      serverName: servers.name, status: bans.status,
    })
    .from(bans)
    .innerJoin(gamertagLinks, verifiedOwner)
    .innerJoin(servers, eq(servers.id, bans.serverId))
    .where(and(inArray(bans.status, ["expired", "lifted"]), gte(bans.expiresAt, from)));

  return rows.map((r): NotificationDraft => ({
    userId: r.userId,
    kind: "ban_lifted",
    naturalKey: `ban_lifted:${r.id}`,
    title: "You're back in",
    body: r.status === "lifted"
      ? `${r.serverName}: your token was spent and the ban is lifted.`
      : `${r.serverName}: your ban has expired. Go start a new life.`,
    href: `/players/${playerSlug(r.gamertag)}`,
  }));
};
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `pnpm --filter @onelife/notifier run test generators-bans`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/notifier/src/generators/bans.ts apps/notifier/test/generators-bans.test.ts
git commit -m "feat(notifier): ban applied and lifted generators"
```

---

### Task 6: Life generators (qualified, survival milestone)

**Files:**
- Create: `apps/notifier/src/generators/lives.ts`
- Test: `apps/notifier/test/generators-lives.test.ts`

**Interfaces:**
- Consumes: `Generator`, `windowStart`, `playerSlug`; `qualifiedLifeCondition` from `@onelife/read-models`.
- Produces: `lifeQualifiedGenerator: Generator`, `survivalMilestoneGenerator: Generator`.

Two constraints specific to this task:

1. This generator windows on **`lives.qualifiedAt`** (materialized by Task 1B), not on `startedAt`. A life is announced when it qualified, which is exact. `qualifiedLifeCondition` is **not** used here — `qualifiedAt IS NOT NULL` is now the authoritative signal and needs no `players` join for the predicate.
2. `survivalMilestoneGenerator` still needs the set of open qualified lives regardless of when they qualified, so it filters on `isNull(lives.endedAt)` + `isNotNull(lives.qualifiedAt)` with the window applied to the milestone arithmetic rather than to the query.

- [ ] **Step 1: Write the failing test**

`apps/notifier/test/generators-lives.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, servers, players, lives, gamertagLinks } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { lifeQualifiedGenerator, survivalMilestoneGenerator } from "../src/generators/lives.js";

const { db, sql } = getTestDb();
const NOW = new Date("2026-07-19T12:00:00Z");
const deps = { db, now: NOW, since: new Date("2026-06-01T00:00:00Z"), lookbackHours: 48, siteUrl: "https://s" };

beforeAll(async () => {
  await db.insert(user).values({ id: "lf1", name: "LF1", email: "lf1@x.com" });
  const [s] = await db.insert(servers).values({ nitradoServiceId: 992001, name: "lifesrv", slug: "lifesrv" }).returning();
  const [p] = await db.insert(players).values({ gamertag: "LifeOne" }).returning();
  await db.insert(gamertagLinks).values({ userId: "lf1", gamertag: "LifeOne", status: "verified", verifiedAt: new Date("2026-06-02T00:00:00Z") });
  await db.insert(lives).values([
    // Open + qualified 8 days ago -> life_qualified (in window) + 7d milestone.
    { serverId: s.id, playerId: p.id, lifeNumber: 1, startedAt: new Date("2026-07-11T12:00:00Z"),
      playtimeSeconds: 4000, qualifiedAt: new Date("2026-07-11T12:05:00Z") },
    // Open but NOT qualified: qualified_at is null.
    { serverId: s.id, playerId: p.id, lifeNumber: 2, startedAt: new Date("2026-07-18T12:00:00Z"),
      playtimeSeconds: 60, qualifiedAt: null },
    // Open + qualified, but LONG ago -> excluded from life_qualified by the window,
    // still eligible for milestones.
    { serverId: s.id, playerId: p.id, lifeNumber: 3, startedAt: new Date("2026-06-05T12:00:00Z"),
      playtimeSeconds: 9000, qualifiedAt: new Date("2026-06-05T12:05:00Z") },
  ]);
});
afterAll(async () => { await sql.end(); });

describe("lifeQualifiedGenerator", () => {
  it("emits only for lives that qualified inside the window", async () => {
    const drafts = await lifeQualifiedGenerator(deps);
    // life 1 only: life 2 never qualified, life 3 qualified before the 48h window.
    expect(drafts).toHaveLength(1);
    expect(drafts[0].kind).toBe("life_qualified");
    expect(drafts[0].userId).toBe("lf1");
    expect(drafts[0].naturalKey).toMatch(/^life_qualified:\d+$/);
    expect(drafts[0].href).toMatch(/^\/players\/lifeone\/lifesrv\/lives\/1$/);
  });
});

describe("survivalMilestoneGenerator", () => {
  it("emits 7d for the 8-day-old life and 7/14/30d for the 44-day-old one", async () => {
    const drafts = await survivalMilestoneGenerator(deps);
    const keys = drafts.map((d) => d.naturalKey).sort();
    // Ignores the window entirely — eligibility is life age, not qualification time.
    expect(keys.filter((k) => k.includes(":7d:"))).toHaveLength(2);
    expect(keys.filter((k) => k.includes(":14d:"))).toHaveLength(1);
    expect(keys.filter((k) => k.includes(":30d:"))).toHaveLength(1);
  });

  it("never emits a milestone for the unqualified life", async () => {
    const drafts = await survivalMilestoneGenerator(deps);
    expect(drafts.every((d) => !d.body.includes("life 2"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `pnpm --filter @onelife/notifier run test generators-lives`
Expected: FAIL — cannot resolve `../src/generators/lives.js`.

- [ ] **Step 3: Implement the generators**

`apps/notifier/src/generators/lives.ts`:

```ts
import { gamertagLinks, lives, players, servers } from "@onelife/db";
import { and, eq, gte, isNull, isNotNull, sql, type SQL } from "drizzle-orm";
import type { Generator, NotificationDraft } from "../types.js";
import { windowStart } from "../types.js";
import { playerSlug } from "./account.js";

type Row = {
  lifeId: number; lifeNumber: number; startedAt: Date; qualifiedAt: Date;
  userId: string; gamertag: string; serverSlug: string | null; serverName: string;
};

/** Open, qualified lives owned by a verified user. qualified_at is materialized by the
 *  projector fold (write-once), so IS NOT NULL is the authoritative qualification signal. */
async function openQualifiedLives(deps: Parameters<Generator>[0], extra?: SQL): Promise<Row[]> {
  return deps.db
    .select({
      lifeId: lives.id, lifeNumber: lives.lifeNumber, startedAt: lives.startedAt,
      qualifiedAt: lives.qualifiedAt,
      userId: gamertagLinks.userId, gamertag: gamertagLinks.gamertag,
      serverSlug: servers.slug, serverName: servers.name,
    })
    .from(lives)
    .innerJoin(players, eq(players.id, lives.playerId))
    .innerJoin(servers, eq(servers.id, lives.serverId))
    .innerJoin(gamertagLinks, and(
      eq(gamertagLinks.status, "verified"),
      sql`lower(${gamertagLinks.gamertag}) = lower(${players.gamertag})`,
    ))
    .where(and(
      isNull(lives.endedAt),
      isNotNull(servers.slug),
      isNotNull(lives.qualifiedAt),
      ...(extra ? [extra] : []),
    )) as Promise<Row[]>;
}

const lifeHref = (r: Row) => `/players/${playerSlug(r.gamertag)}/${r.serverSlug}/lives/${r.lifeNumber}`;

export const lifeQualifiedGenerator: Generator = async (deps) => {
  // Window on the qualification instant itself — exact, unlike windowing on startedAt.
  const rows = await openQualifiedLives(deps, gte(lives.qualifiedAt, windowStart(deps)));
  return rows.map((r): NotificationDraft => ({
    userId: r.userId,
    kind: "life_qualified",
    naturalKey: `life_qualified:${r.lifeId}`,
    title: "This life counts now",
    body: `${r.serverName}: life ${r.lifeNumber} is qualified. Dying costs you 24 hours.`,
    href: lifeHref(r),
  }));
};

const MILESTONE_DAYS = [7, 14, 30] as const;

/** Milestones are time-derived, so the window is the milestone itself: a life is only
 *  eligible once it has been open that long. The natural key carries the day count, so
 *  each threshold fires exactly once per life. */
export const survivalMilestoneGenerator: Generator = async (deps) => {
  // No time filter: eligibility is the life's age, computed below, not when it qualified.
  const rows = await openQualifiedLives(deps);
  const drafts: NotificationDraft[] = [];
  for (const r of rows) {
    const days = (deps.now.getTime() - r.startedAt.getTime()) / 86_400_000;
    for (const m of MILESTONE_DAYS) {
      if (days < m) continue;
      drafts.push({
        userId: r.userId,
        kind: "survival_milestone",
        naturalKey: `milestone:${m}d:${r.lifeId}`,
        title: `${m} days alive`,
        body: `${r.serverName}: life ${r.lifeNumber} has survived ${m} days.`,
        href: lifeHref(r),
      });
    }
  }
  return drafts;
};
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `pnpm --filter @onelife/notifier run test generators-lives`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/notifier/src/generators/lives.ts apps/notifier/test/generators-lives.test.ts
git commit -m "feat(notifier): life qualified and survival milestone generators"
```

---

### Task 7: Article generators

**Files:**
- Create: `apps/notifier/src/generators/articles.ts`
- Test: `apps/notifier/test/generators-articles.test.ts`

**Interfaces:**
- Consumes: `Generator`, `windowStart`.
- Produces: `articleGenerator: Generator` (covers both `obituary` and `birth_notice`).

- [ ] **Step 1: Write the failing test**

`apps/notifier/test/generators-articles.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, servers, gamertagLinks, articles } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { articleGenerator } from "../src/generators/articles.js";

const { db, sql } = getTestDb();
const NOW = new Date("2026-07-19T12:00:00Z");
const deps = { db, now: NOW, since: new Date("2026-07-01T00:00:00Z"), lookbackHours: 24, siteUrl: "https://s" };

beforeAll(async () => {
  await db.insert(user).values({ id: "ar1", name: "AR1", email: "ar1@x.com" });
  const [s] = await db.insert(servers).values({ nitradoServiceId: 993001, name: "artsrv", slug: "artsrv" }).returning();
  await db.insert(gamertagLinks).values({ userId: "ar1", gamertag: "ArtOne", status: "verified", verifiedAt: new Date("2026-07-02T00:00:00Z") });
  await db.insert(articles).values([
    { kind: "obituary", status: "published", slug: "art-ob-1", serverId: s.id, gamertag: "artone",
      map: "chernarusplus", lifeNumber: 1, lifeStartedAt: new Date("2026-07-17T00:00:00Z"),
      deathAt: new Date("2026-07-19T10:00:00Z"), headline: "Gone", lede: "l", body: "b",
      generatedAt: new Date("2026-07-19T10:05:00Z") },
    { kind: "birth_notice", status: "published", slug: "art-bn-1", serverId: s.id, gamertag: "ArtOne",
      map: "chernarusplus", lifeNumber: 2, lifeStartedAt: new Date("2026-07-19T11:00:00Z"),
      headline: "Born", lede: "l", body: "b", generatedAt: new Date("2026-07-19T11:05:00Z") },
    { kind: "obituary", status: "failed", slug: "art-ob-2", serverId: s.id, gamertag: "ArtOne",
      map: "chernarusplus", lifeNumber: 3, lifeStartedAt: new Date("2026-07-18T00:00:00Z"),
      deathAt: new Date("2026-07-19T09:00:00Z"), headline: "x", lede: "l", body: "b",
      generatedAt: new Date("2026-07-19T09:05:00Z") },
  ]);
});
afterAll(async () => { await sql.end(); });

describe("articleGenerator", () => {
  it("emits for published obituaries and birth notices only", async () => {
    const drafts = await articleGenerator(deps);
    expect(drafts.map((d) => d.kind).sort()).toEqual(["birth_notice_published", "obituary_published"]);
  });

  it("links to the right interior and keys on article id", async () => {
    const drafts = await articleGenerator(deps);
    const ob = drafts.find((d) => d.kind === "obituary_published")!;
    const bn = drafts.find((d) => d.kind === "birth_notice_published")!;
    expect(ob.href).toBe("/obituaries/art-ob-1");
    expect(bn.href).toBe("/fresh-spawns/art-bn-1");
    expect(ob.naturalKey).toMatch(/^article:\d+$/);
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `pnpm --filter @onelife/notifier run test generators-articles`
Expected: FAIL — cannot resolve `../src/generators/articles.js`.

- [ ] **Step 3: Implement the generator**

`apps/notifier/src/generators/articles.ts`:

```ts
import { articles, gamertagLinks } from "@onelife/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Generator, NotificationDraft } from "../types.js";
import { windowStart } from "../types.js";

const KIND_MAP: Record<string, { kind: string; title: string; body: string; path: string }> = {
  obituary: {
    kind: "obituary_published",
    title: "You made the Morgue",
    body: "The paper ran your obituary.",
    path: "/obituaries",
  },
  birth_notice: {
    kind: "birth_notice_published",
    title: "You made the Nursery",
    body: "The paper ran your birth notice.",
    path: "/fresh-spawns",
  },
};

/** Articles are keyed by gamertag with whatever casing the log produced, so the join to
 *  the verified owner is case-insensitive. Only published articles notify — a failed or
 *  pending row must never reach a player. */
export const articleGenerator: Generator = async (deps) => {
  const from = windowStart(deps);
  const rows = await deps.db
    .select({
      id: articles.id, kind: articles.kind, slug: articles.slug,
      headline: articles.headline, userId: gamertagLinks.userId,
    })
    .from(articles)
    .innerJoin(gamertagLinks, and(
      eq(gamertagLinks.status, "verified"),
      sql`lower(${gamertagLinks.gamertag}) = lower(${articles.gamertag})`,
    ))
    .where(and(
      eq(articles.status, "published"),
      inArray(articles.kind, ["obituary", "birth_notice"]),
      gte(articles.generatedAt, from),
    ));

  return rows.flatMap((r): NotificationDraft[] => {
    const meta = KIND_MAP[r.kind];
    if (!meta) return []; // a future article kind is skipped, never crashes the sweep
    return [{
      userId: r.userId,
      kind: meta.kind,
      naturalKey: `article:${r.id}`,
      title: meta.title,
      body: r.headline ?? meta.body,
      href: `${meta.path}/${r.slug}`,
    }];
  });
};
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `pnpm --filter @onelife/notifier run test generators-articles`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/notifier/src/generators/articles.ts apps/notifier/test/generators-articles.test.ts
git commit -m "feat(notifier): obituary and birth-notice article generators"
```

---

### Task 8: Push store and sender

**Files:**
- Create: `apps/notifier/src/push-store.ts`, `apps/notifier/src/sender.ts`
- Test: `apps/notifier/test/push-store.test.ts`

**Interfaces:**
- Produces:

```ts
export type UnpushedNotification = {
  id: number; userId: string; kind: string; title: string; body: string; href: string; createdAt: Date;
};
export type ActiveSubscription = { id: number; endpoint: string; p256dh: string; auth: string };
export async function findUnpushed(db: Database, opts: { limit: number }): Promise<UnpushedNotification[]>;
export async function activeSubscriptionsFor(db: Database, userId: string): Promise<ActiveSubscription[]>;
export async function markPushed(db: Database, id: number, now: Date): Promise<void>;
export async function deleteSubscription(db: Database, id: number): Promise<void>;
export async function recordFailure(db: Database, id: number, now: Date): Promise<void>;

export type SendResult = { ok: true } | { ok: false; gone: boolean; error: string };
export type Sender = (sub: ActiveSubscription, payload: string) => Promise<SendResult>;
export function webPushSender(vapid: { publicKey: string; privateKey: string; subject: string }): Sender;
```

- [ ] **Step 1: Write the failing store test**

`apps/notifier/test/push-store.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { user, notifications, pushSubscriptions } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { activeSubscriptionsFor, deleteSubscription, findUnpushed, markPushed, recordFailure } from "../src/push-store.js";

const { db, sql } = getTestDb();
const NOW = new Date("2026-07-19T12:00:00Z");

beforeAll(async () => {
  await db.insert(user).values({ id: "ps1", name: "PS1", email: "ps1@x.com" });
});
beforeEach(async () => {
  await db.delete(notifications);
  await db.delete(pushSubscriptions);
});
afterAll(async () => { await sql.end(); });

const note = (naturalKey: string, pushedAt: Date | null = null) => ({
  userId: "ps1", kind: "k", naturalKey, title: "t", body: "b", href: "/h", pushedAt,
});

describe("push store", () => {
  it("finds only unpushed notifications, oldest first", async () => {
    await db.insert(notifications).values([note("a"), note("b", NOW)]);
    const rows = await findUnpushed(db, { limit: 10 });
    expect(rows.map((r) => r.title)).toEqual(["t"]);
    expect(rows).toHaveLength(1);
  });

  it("markPushed stamps the row so it is not found again", async () => {
    const [n] = await db.insert(notifications).values(note("c")).returning();
    await markPushed(db, n.id, NOW);
    expect(await findUnpushed(db, { limit: 10 })).toHaveLength(0);
  });

  it("returns only enabled subscriptions", async () => {
    await db.insert(pushSubscriptions).values([
      { userId: "ps1", endpoint: "e1", p256dh: "p", auth: "a" },
      { userId: "ps1", endpoint: "e2", p256dh: "p", auth: "a", disabledAt: NOW },
    ]);
    const subs = await activeSubscriptionsFor(db, "ps1");
    expect(subs.map((s) => s.endpoint)).toEqual(["e1"]);
  });

  it("recordFailure disables a subscription at the fifth failure", async () => {
    const [s] = await db.insert(pushSubscriptions).values({ userId: "ps1", endpoint: "e3", p256dh: "p", auth: "a" }).returning();
    for (let i = 0; i < 5; i++) await recordFailure(db, s.id, NOW);
    expect(await activeSubscriptionsFor(db, "ps1")).toHaveLength(0);
  });

  it("deleteSubscription removes the row", async () => {
    const [s] = await db.insert(pushSubscriptions).values({ userId: "ps1", endpoint: "e4", p256dh: "p", auth: "a" }).returning();
    await deleteSubscription(db, s.id);
    expect(await activeSubscriptionsFor(db, "ps1")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `pnpm --filter @onelife/notifier run test push-store`
Expected: FAIL — cannot resolve `../src/push-store.js`.

- [ ] **Step 3: Implement the store**

`apps/notifier/src/push-store.ts`:

```ts
import type { Database } from "@onelife/db";
import { notifications, pushSubscriptions } from "@onelife/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

export type UnpushedNotification = {
  id: number; userId: string; kind: string; title: string; body: string; href: string; createdAt: Date;
};
export type ActiveSubscription = { id: number; endpoint: string; p256dh: string; auth: string };

const MAX_FAILURES = 5;

export async function findUnpushed(db: Database, opts: { limit: number }): Promise<UnpushedNotification[]> {
  return db
    .select({
      id: notifications.id, userId: notifications.userId, kind: notifications.kind,
      title: notifications.title, body: notifications.body, href: notifications.href,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(isNull(notifications.pushedAt))
    .orderBy(asc(notifications.createdAt))
    .limit(opts.limit);
}

export async function activeSubscriptionsFor(db: Database, userId: string): Promise<ActiveSubscription[]> {
  return db
    .select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), isNull(pushSubscriptions.disabledAt)));
}

export async function markPushed(db: Database, id: number, now: Date): Promise<void> {
  await db.update(notifications).set({ pushedAt: now }).where(eq(notifications.id, id));
}

export async function deleteSubscription(db: Database, id: number): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
}

/** Count a delivery failure and retire the subscription once it has failed MAX_FAILURES
 *  times, so a permanently broken endpoint stops costing a request every tick. */
export async function recordFailure(db: Database, id: number, now: Date): Promise<void> {
  await db
    .update(pushSubscriptions)
    .set({
      failureCount: sql`${pushSubscriptions.failureCount} + 1`,
      disabledAt: sql`CASE WHEN ${pushSubscriptions.failureCount} + 1 >= ${MAX_FAILURES} THEN ${now} ELSE ${pushSubscriptions.disabledAt} END`,
    })
    .where(eq(pushSubscriptions.id, id));
}
```

- [ ] **Step 4: Implement the sender**

`apps/notifier/src/sender.ts`:

```ts
import webpush from "web-push";
import type { ActiveSubscription } from "./push-store.js";

export type SendResult = { ok: true } | { ok: false; gone: boolean; error: string };
export type Sender = (sub: ActiveSubscription, payload: string) => Promise<SendResult>;

/** Build a web-push sender. A 404/410 means the browser discarded the subscription —
 *  that endpoint is permanently dead and its row should be deleted, not retried. */
export function webPushSender(vapid: { publicKey: string; privateKey: string; subject: string }): Sender {
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  return async (sub, payload) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
      return { ok: true };
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      return { ok: false, gone: status === 404 || status === 410, error: String(err) };
    }
  };
}
```

- [ ] **Step 5: Run tests to confirm pass**

Run: `pnpm --filter @onelife/notifier run test push-store`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/notifier/src/push-store.ts apps/notifier/src/sender.ts apps/notifier/test/push-store.test.ts
git commit -m "feat(notifier): push subscription store and web-push sender"
```

---

### Task 9: `pushTick`

**Files:**
- Create: `apps/notifier/src/push.ts`
- Test: `apps/notifier/test/push.test.ts`

**Interfaces:**
- Consumes: `UnpushedNotification`, `ActiveSubscription`, `Sender` from Task 8.
- Produces:

```ts
export type PushStore = {
  findUnpushed(db: Database, opts: { limit: number }): Promise<UnpushedNotification[]>;
  activeSubscriptionsFor(db: Database, userId: string): Promise<ActiveSubscription[]>;
  markPushed(db: Database, id: number, now: Date): Promise<void>;
  deleteSubscription(db: Database, id: number): Promise<void>;
  recordFailure(db: Database, id: number, now: Date): Promise<void>;
};
export type PushResult = { sent: number; skipped: number; failed: number; disabled: boolean };
export async function pushTick(db: Database, deps: PushDeps): Promise<PushResult>;
```

- [ ] **Step 1: Write the failing test**

`apps/notifier/test/push.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { pushTick } from "../src/push.js";
import type { ActiveSubscription, UnpushedNotification } from "../src/push-store.js";

const NOW = new Date("2026-07-19T12:00:00Z");
const log = { info: () => {}, warn: () => {} };
const db = {} as never;

const note = (id: number, createdAt = new Date("2026-07-19T11:59:00Z")): UnpushedNotification => ({
  id, userId: "u1", kind: "k", title: "t", body: "b", href: "/h", createdAt,
});
const sub = (id: number): ActiveSubscription => ({ id, endpoint: `e${id}`, p256dh: "p", auth: "a" });

function makeStore(over: Partial<Record<string, unknown>> = {}) {
  return {
    findUnpushed: vi.fn(async () => [note(1)]),
    activeSubscriptionsFor: vi.fn(async () => [sub(10)]),
    markPushed: vi.fn(async () => {}),
    deleteSubscription: vi.fn(async () => {}),
    recordFailure: vi.fn(async () => {}),
    ...over,
  } as never;
}

const base = { now: NOW, maxPerTick: 50, maxAgeMinutes: 60, enabled: true, dryRun: false, log };

describe("pushTick", () => {
  it("is a no-op when disabled", async () => {
    const store = makeStore();
    const r = await pushTick(db, { ...base, enabled: false, store, send: vi.fn() });
    expect(r.disabled).toBe(true);
    expect((store as never as { findUnpushed: { mock: unknown[] } }).findUnpushed).not.toHaveBeenCalled();
  });

  it("sends and stamps only after a confirmed send", async () => {
    const store = makeStore();
    const send = vi.fn(async () => ({ ok: true as const }));
    const r = await pushTick(db, { ...base, store, send });
    expect(r.sent).toBe(1);
    expect(send).toHaveBeenCalledOnce();
    expect((store as never as { markPushed: unknown }).markPushed).toHaveBeenCalledWith(db, 1, NOW);
  });

  it("stamps notifications for a user with no subscriptions so the sweep drains", async () => {
    const store = makeStore({ activeSubscriptionsFor: vi.fn(async () => []) });
    const send = vi.fn();
    const r = await pushTick(db, { ...base, store, send });
    expect(r.skipped).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect((store as never as { markPushed: unknown }).markPushed).toHaveBeenCalledWith(db, 1, NOW);
  });

  it("stamps without sending when the notification is stale", async () => {
    const store = makeStore({ findUnpushed: vi.fn(async () => [note(1, new Date("2026-07-19T09:00:00Z"))]) });
    const send = vi.fn();
    const r = await pushTick(db, { ...base, store, send });
    expect(r.skipped).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect((store as never as { markPushed: unknown }).markPushed).toHaveBeenCalledWith(db, 1, NOW);
  });

  it("deletes a subscription on a gone response", async () => {
    const store = makeStore();
    const send = vi.fn(async () => ({ ok: false as const, gone: true, error: "410" }));
    const r = await pushTick(db, { ...base, store, send });
    expect((store as never as { deleteSubscription: unknown }).deleteSubscription).toHaveBeenCalledWith(db, 10);
    expect(r.failed).toBe(1);
    expect((store as never as { markPushed: unknown }).markPushed).not.toHaveBeenCalled();
  });

  it("records a failure on a non-gone error and leaves the row unpushed", async () => {
    const store = makeStore();
    const send = vi.fn(async () => ({ ok: false as const, gone: false, error: "500" }));
    await pushTick(db, { ...base, store, send });
    expect((store as never as { recordFailure: unknown }).recordFailure).toHaveBeenCalledWith(db, 10, NOW);
    expect((store as never as { markPushed: unknown }).markPushed).not.toHaveBeenCalled();
  });

  it("does not send in dry run", async () => {
    const store = makeStore();
    const send = vi.fn();
    await pushTick(db, { ...base, dryRun: true, store, send });
    expect(send).not.toHaveBeenCalled();
    expect((store as never as { markPushed: unknown }).markPushed).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `pnpm --filter @onelife/notifier run test push.test`
Expected: FAIL — cannot resolve `../src/push.js`.

- [ ] **Step 3: Implement `pushTick`**

`apps/notifier/src/push.ts`:

```ts
import type { Database } from "@onelife/db";
import type { ActiveSubscription, UnpushedNotification } from "./push-store.js";
import type { Sender } from "./sender.js";
import type { Log } from "./types.js";

export type PushStore = {
  findUnpushed(db: Database, opts: { limit: number }): Promise<UnpushedNotification[]>;
  activeSubscriptionsFor(db: Database, userId: string): Promise<ActiveSubscription[]>;
  markPushed(db: Database, id: number, now: Date): Promise<void>;
  deleteSubscription(db: Database, id: number): Promise<void>;
  recordFailure(db: Database, id: number, now: Date): Promise<void>;
};

export type PushDeps = {
  now: Date; maxPerTick: number; maxAgeMinutes: number;
  enabled: boolean; dryRun: boolean; log: Log;
  store: PushStore; send: Sender;
};

export type PushResult = { sent: number; skipped: number; failed: number; disabled: boolean };

/** Fan unpushed notifications out to each owner's browser subscriptions.
 *
 *  Delivery is AT-LEAST-ONCE, mirroring apps/newsdesk/src/notify.ts: the send and the
 *  pushed_at stamp are two non-atomic steps, and we stamp only AFTER a confirmed send.
 *  Stamping first would DROP notifications on a transient failure.
 *
 *  Two cases must stamp WITHOUT sending, or the sweep never drains and the same rows are
 *  reconsidered every tick forever:
 *    - the owner has no active subscriptions (nothing to deliver to)
 *    - the notification is older than maxAgeMinutes (a stale backlog must not blast a
 *      user the moment they enable push)
 *
 *  Assumes a single notifier instance; the SELECT is not row-locked. */
export async function pushTick(db: Database, deps: PushDeps): Promise<PushResult> {
  if (!deps.enabled) return { sent: 0, skipped: 0, failed: 0, disabled: true };

  const rows = await deps.store.findUnpushed(db, { limit: deps.maxPerTick });
  const cutoff = deps.now.getTime() - deps.maxAgeMinutes * 60_000;
  let sent = 0, skipped = 0, failed = 0;

  for (const row of rows) {
    if (deps.dryRun) {
      deps.log.info({ id: row.id, kind: row.kind }, "DRY RUN: would push notification");
      continue;
    }

    if (row.createdAt.getTime() < cutoff) {
      await deps.store.markPushed(db, row.id, deps.now);
      skipped++;
      continue;
    }

    const subs = await deps.store.activeSubscriptionsFor(db, row.userId);
    if (subs.length === 0) {
      await deps.store.markPushed(db, row.id, deps.now);
      skipped++;
      continue;
    }

    const payload = JSON.stringify({ title: row.title, body: row.body, href: row.href });
    let delivered = false;

    for (const sub of subs) {
      const res = await deps.send(sub, payload);
      if (res.ok) { delivered = true; continue; }
      if (res.gone) {
        await deps.store.deleteSubscription(db, sub.id);
      } else {
        await deps.store.recordFailure(db, sub.id, deps.now);
        deps.log.warn?.({ id: row.id, subscriptionId: sub.id, error: res.error }, "push failed (retries next tick)");
      }
      failed++;
    }

    // Stamp once at least one endpoint accepted it. If every endpoint failed, the row
    // stays unpushed and is retried next tick.
    if (delivered) {
      await deps.store.markPushed(db, row.id, deps.now);
      sent++;
    }
  }

  return { sent, skipped, failed, disabled: false };
}
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `pnpm --filter @onelife/notifier run test push.test`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/notifier/src/push.ts apps/notifier/test/push.test.ts
git commit -m "feat(notifier): pushTick with at-least-once delivery and drain guards"
```

---

### Task 10: Worker entrypoint

**Files:**
- Create: `apps/notifier/src/main.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–9.
- Produces: the runnable worker (`pnpm --filter @onelife/notifier start`).

- [ ] **Step 1: Write the entrypoint**

`apps/notifier/src/main.ts`:

```ts
import pino from "pino";
import { getDb } from "@onelife/db";
import { loadConfig } from "./config.js";
import { generateTick } from "./generate.js";
import { pushTick } from "./push.js";
import { webPushSender } from "./sender.js";
import * as pushStore from "./push-store.js";
import { gamertagVerifiedGenerator, tokensGenerator } from "./generators/account.js";
import { banAppliedGenerator, banLiftedGenerator } from "./generators/bans.js";
import { lifeQualifiedGenerator, survivalMilestoneGenerator } from "./generators/lives.js";
import { articleGenerator } from "./generators/articles.js";

const cfg = loadConfig(process.env);
const log = pino({ level: cfg.logLevel });
const { db } = getDb(cfg.databaseUrl);

const generators = [
  gamertagVerifiedGenerator,
  tokensGenerator,
  banAppliedGenerator,
  banLiftedGenerator,
  lifeQualifiedGenerator,
  survivalMilestoneGenerator,
  articleGenerator,
];

const hasVapid = Boolean(cfg.vapidPublicKey && cfg.vapidPrivateKey && cfg.vapidSubject);
const send = hasVapid
  ? webPushSender({ publicKey: cfg.vapidPublicKey, privateKey: cfg.vapidPrivateKey, subject: cfg.vapidSubject })
  : null;

async function loop(): Promise<void> {
  log.info({ interval: cfg.intervalSeconds, dryRun: cfg.dryRun, since: cfg.since?.toISOString() ?? null }, "notifier starting");
  if (cfg.dryRun) log.warn("NOTIFIER_DRY_RUN is true — no notifications will be written");
  if (!cfg.since) log.warn("NOTIFIER_SINCE is unset — generation is OFF");
  if (cfg.pushEnabled && !send) log.warn("VAPID keys are not configured — push is OFF");

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const r = await generateTick(db, {
        generators, now: new Date(), since: cfg.since,
        lookbackHours: cfg.lookbackHours, siteUrl: cfg.siteUrl,
        dryRun: cfg.dryRun, log,
      });
      if (r.drafts || r.inserted) log.info(r, "notifications generated");
    } catch (err) {
      log.error({ err }, "notifier generate tick failed");
    }

    // Push is a separate try/catch so a broken push pipeline can never stop generation.
    try {
      const r = await pushTick(db, {
        now: new Date(), maxPerTick: cfg.pushMaxPerTick, maxAgeMinutes: cfg.pushMaxAgeMinutes,
        enabled: cfg.pushEnabled && send !== null, dryRun: cfg.dryRun, log,
        store: pushStore, send: send ?? (async () => ({ ok: false, gone: false, error: "no vapid" })),
      });
      if (r.sent || r.failed) log.info(r, "notifications pushed");
    } catch (err) {
      log.error({ err }, "notifier push tick failed");
    }

    await new Promise((r) => setTimeout(r, cfg.intervalSeconds * 1000));
  }
}

loop();
```

- [ ] **Step 2: Typecheck the whole workspace**

Run: `pnpm turbo run typecheck`
Expected: PASS with no errors in `@onelife/notifier`.

- [ ] **Step 3: Run the notifier suite**

Run: `pnpm --filter @onelife/notifier run test`
Expected: PASS (all tests from Tasks 2–9).

- [ ] **Step 4: Commit**

```bash
git add apps/notifier/src/main.ts
git commit -m "feat(notifier): worker entrypoint wiring both passes"
```

---

### Task 11: API routes

**Files:**
- Create: `apps/api/src/routes/notifications.ts`
- Modify: `apps/api/src/app.ts:19` (import) and `:39` (registration)
- Test: `apps/api/test/notifications-routes.test.ts`

**Interfaces:**
- Produces: `registerNotificationRoutes(app: FastifyInstance, db: Database, auth: Auth, vapidPublicKey: string): void`

Routes: `GET /me/notifications`, `POST /me/notifications/read`, `POST /me/push-subscriptions`, `DELETE /me/push-subscriptions`, `GET /push/vapid-key`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/notifications-routes.test.ts`. This mirrors the magic-link sign-in harness in `apps/api/test/tokens-routes.test.ts` — read that file first; the `signIn`/`cookieHeader`/`authed` helpers below are copied from it deliberately, because each API test file is self-contained.

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, notifications, pushSubscriptions } from "@onelife/db";
import { eq } from "drizzle-orm";
import { createAuth, type Mailer } from "@onelife/auth";
import { buildApp } from "../src/app.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 6e8;
const email = `ntf${svc}@example.com`;

let lastLink = "";
const captureMailer: Mailer = { async send(msg) { lastLink = msg.url; } };
const auth = createAuth(db, {
  secret: "s".repeat(32), baseURL: "http://localhost", trustedOrigins: ["http://localhost"],
  providers: {}, mailer: captureMailer,
});
const app = buildApp(db, { auth, corsOrigins: ["http://localhost"], vapidPublicKey: "TEST_PUBLIC_KEY" });

function cookieHeader(setCookie: string | string[] | undefined): string {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr.map((c) => c.split(";")[0]).join("; ");
}

let cookie = "";
let userId = "";
let otherUserId = "";

async function signIn(): Promise<void> {
  await app.inject({
    method: "POST", url: "/api/auth/sign-in/magic-link",
    headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost" },
    payload: { email },
  });
  const verifyPath = lastLink.replace(/^https?:\/\/[^/]+/, "");
  const verify = await app.inject({ method: "GET", url: verifyPath, headers: { host: "localhost" } });
  cookie = cookieHeader(verify.headers["set-cookie"] as string | string[] | undefined);
}

beforeAll(async () => {
  await app.ready();
  await signIn();
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  userId = u!.id;

  const [other] = await db.insert(user)
    .values({ id: `ntf-other-${svc}`, name: "Other", email: `other${svc}@example.com` })
    .returning();
  otherUserId = other!.id;

  await db.insert(notifications).values([
    { userId, kind: "ban_applied", naturalKey: `ntf:${svc}:1`, title: "Mine unread", body: "b", href: "/h" },
    { userId, kind: "tokens_granted", naturalKey: `ntf:${svc}:2`, title: "Mine read", body: "b", href: "/h", readAt: new Date() },
    { userId: otherUserId, kind: "ban_applied", naturalKey: `ntf:${svc}:3`, title: "Theirs", body: "b", href: "/h" },
  ]);
});

afterAll(async () => {
  await sql`DELETE FROM notifications WHERE user_id IN (${userId}, ${otherUserId})`;
  await sql`DELETE FROM push_subscriptions WHERE user_id IN (${userId}, ${otherUserId})`;
  await sql`DELETE FROM "session" WHERE user_id = ${userId}`;
  await sql`DELETE FROM "account" WHERE user_id = ${userId}`;
  await sql`DELETE FROM "user" WHERE id IN (${userId}, ${otherUserId})`;
  await sql.end();
});

const authed = () => ({ host: "localhost", cookie, "content-type": "application/json" });

describe("notification routes", () => {
  it("401 without a session", async () => {
    const res = await app.inject({ method: "GET", url: "/me/notifications", headers: { host: "localhost" } });
    expect(res.statusCode).toBe(401);
  });

  it("returns only the caller's notifications with an unread count", async () => {
    const res = await app.inject({ method: "GET", url: "/me/notifications", headers: authed() });
    expect(res.statusCode).toBe(200);
    const bodyJson = res.json();
    expect(bodyJson.items.map((i: { title: string }) => i.title).sort()).toEqual(["Mine read", "Mine unread"]);
    expect(bodyJson.unreadCount).toBe(1);
  });

  it("marks all unread notifications read", async () => {
    const post = await app.inject({ method: "POST", url: "/me/notifications/read", headers: authed(), payload: {} });
    expect(post.statusCode).toBe(200);
    const res = await app.inject({ method: "GET", url: "/me/notifications", headers: authed() });
    expect(res.json().unreadCount).toBe(0);
  });

  it("never marks another user's notifications read", async () => {
    const rows = await db.select().from(notifications).where(eq(notifications.userId, otherUserId));
    expect(rows[0]!.readAt).toBeNull();
  });

  it("401 on subscribing without a session", async () => {
    const res = await app.inject({
      method: "POST", url: "/me/push-subscriptions",
      headers: { host: "localhost", "content-type": "application/json" },
      payload: { endpoint: "e", keys: { p256dh: "p", auth: "a" } },
    });
    expect(res.statusCode).toBe(401);
  });

  it("upserts a push subscription instead of duplicating it", async () => {
    const payload = { endpoint: `ep-${svc}`, keys: { p256dh: "p1", auth: "a1" } };
    await app.inject({ method: "POST", url: "/me/push-subscriptions", headers: authed(), payload });
    await app.inject({
      method: "POST", url: "/me/push-subscriptions", headers: authed(),
      payload: { ...payload, keys: { p256dh: "p2", auth: "a2" } },
    });
    const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.p256dh).toBe("p2");
  });

  it("deletes a push subscription", async () => {
    const res = await app.inject({
      method: "DELETE", url: "/me/push-subscriptions", headers: authed(),
      payload: { endpoint: `ep-${svc}` },
    });
    expect(res.statusCode).toBe(200);
    const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    expect(rows).toHaveLength(0);
  });

  it("serves the vapid public key without a session", async () => {
    const res = await app.inject({ method: "GET", url: "/push/vapid-key", headers: { host: "localhost" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().publicKey).toBe("TEST_PUBLIC_KEY");
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `pnpm --filter @onelife/api run test notifications-routes`
Expected: FAIL — route not registered.

- [ ] **Step 3: Implement the routes**

`apps/api/src/routes/notifications.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import type { Auth } from "@onelife/auth";
import { notifications, pushSubscriptions } from "@onelife/db";
import { and, desc, eq, isNull, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { getSession } from "../auth-plugin.js";

const FEED_LIMIT = 20;

const subscribeBody = z.object({
  endpoint: z.string().min(1),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
const unsubscribeBody = z.object({ endpoint: z.string().min(1) });

export function registerNotificationRoutes(
  app: FastifyInstance, db: Database, auth: Auth, vapidPublicKey: string,
): void {
  app.get("/me/notifications", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const userId = session.user.id;

    const [items, [counted]] = await Promise.all([
      db
        .select({
          id: notifications.id, kind: notifications.kind, title: notifications.title,
          body: notifications.body, href: notifications.href,
          createdAt: notifications.createdAt, readAt: notifications.readAt,
        })
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt))
        .limit(FEED_LIMIT),
      db
        .select({ n: dsql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
    ]);

    return { items, unreadCount: counted?.n ?? 0 };
  });

  app.post("/me/notifications/read", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, session.user.id), isNull(notifications.readAt)));
    return { ok: true };
  });

  app.post("/me/push-subscriptions", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const body = subscribeBody.parse(req.body);
    const now = new Date();
    // Upsert on endpoint: re-subscribing the same browser must move the row to the
    // current user and clear any prior failure state, not create a duplicate.
    await db
      .insert(pushSubscriptions)
      .values({
        userId: session.user.id, endpoint: body.endpoint,
        p256dh: body.keys.p256dh, auth: body.keys.auth,
        userAgent: String(req.headers["user-agent"] ?? "").slice(0, 300),
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId: session.user.id, p256dh: body.keys.p256dh, auth: body.keys.auth,
          lastSeenAt: now, failureCount: 0, disabledAt: null,
        },
      });
    return { ok: true };
  });

  app.delete("/me/push-subscriptions", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const body = unsubscribeBody.parse(req.body);
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, session.user.id), eq(pushSubscriptions.endpoint, body.endpoint)));
    return { ok: true };
  });

  // Public: the browser needs this before it can call pushManager.subscribe().
  app.get("/push/vapid-key", async () => ({ publicKey: vapidPublicKey }));
}
```

- [ ] **Step 4: Register the routes**

In `apps/api/src/app.ts`, add the import after line 19:

```ts
import { registerNotificationRoutes } from "./routes/notifications.js";
```

Add to `AuthOptions`:

```ts
  vapidPublicKey?: string;
```

And inside the `if (opts)` block, after `registerTokenRoutes(app, db, opts.auth);`:

```ts
    registerNotificationRoutes(app, db, opts.auth, opts.vapidPublicKey ?? "");
```

Then in the API's server entrypoint (find it with `grep -rn "buildApp(" apps/api/src --include=*.ts | grep -v app.ts`), pass `vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? ""` into the options object.

- [ ] **Step 5: Run tests to confirm pass**

Run: `pnpm --filter @onelife/api run test`
Expected: PASS, including the new notification tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/notifications.ts apps/api/src/app.ts apps/api/test/notifications-routes.test.ts
git commit -m "feat(api): notification feed, read, and push subscription routes"
```

---

### Task 12: Web types and API client

**Files:**
- Modify: `apps/web/src/lib/types.ts`, `apps/web/src/lib/api.ts`

**Interfaces:**
- Produces:

```ts
export type AppNotification = {
  id: number; kind: string; title: string; body: string; href: string;
  createdAt: string; readAt: string | null;
};
export type NotificationsFeed = { items: AppNotification[]; unreadCount: number };

export const getNotifications: () => Promise<NotificationsFeed>;
export const markNotificationsRead: () => Promise<{ ok: true }>;
export const getVapidKey: () => Promise<{ publicKey: string }>;
export const subscribePush: (sub: PushSubscriptionJSON) => Promise<{ ok: true }>;
export const unsubscribePush: (endpoint: string) => Promise<{ ok: true }>;
```

The type is named `AppNotification`, **not** `Notification` — the DOM already has a global `Notification` and shadowing it breaks the push-permission code in Task 14.

- [ ] **Step 1: Add the types**

Append to `apps/web/src/lib/types.ts`:

```ts
/** Named AppNotification to avoid shadowing the DOM's global Notification type,
 *  which the push permission flow depends on. */
export type AppNotification = {
  id: number;
  kind: string;
  title: string;
  body: string;
  href: string;
  createdAt: string;
  readAt: string | null;
};

export type NotificationsFeed = { items: AppNotification[]; unreadCount: number };
```

- [ ] **Step 2: Add the client functions**

Add `NotificationsFeed` to the import block at the top of `apps/web/src/lib/api.ts`, then append after the token client functions (around line 116):

```ts
export const getNotifications = () => apiGet<NotificationsFeed>("/api/me/notifications");
export const markNotificationsRead = () =>
  apiSend<{ ok: true }>("POST", "/api/me/notifications/read", {});
export const getVapidKey = () => apiGet<{ publicKey: string }>("/api/push/vapid-key");
export const subscribePush = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
  apiSend<{ ok: true }>("POST", "/api/me/push-subscriptions", sub);
export const unsubscribePush = (endpoint: string) =>
  apiSend<{ ok: true }>("DELETE", "/api/me/push-subscriptions", { endpoint });
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @onelife/web run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/types.ts apps/web/src/lib/api.ts
git commit -m "feat(web): notification types and API client functions"
```

---

### Task 13: Notifications panel component

**Files:**
- Create: `apps/web/src/components/controls/notifications-panel.tsx`
- Test: `apps/web/src/components/controls/notifications-panel.test.tsx`

**Interfaces:**
- Consumes: `AppNotification` from Task 12.
- Produces:

```tsx
export function NotificationsPanel(props: {
  items: AppNotification[];
  unreadCount: number;
  onOpen: () => void;
  children?: ReactNode;   // slot for the push toggle from Task 14
}): JSX.Element;
export function relativeTime(iso: string, now: Date): string;
export function accentFor(kind: string): string;
```

- [ ] **Step 1: Write the failing test**

`apps/web/src/components/controls/notifications-panel.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NotificationsPanel, relativeTime, accentFor } from "./notifications-panel";
import type { AppNotification } from "@/lib/types";

const NOW = new Date("2026-07-19T12:00:00Z");

const item = (over: Partial<AppNotification> = {}): AppNotification => ({
  id: 1, kind: "ban_applied", title: "You died", body: "24 hours.",
  href: "/players/x", createdAt: "2026-07-19T11:30:00Z", readAt: null, ...over,
});

describe("relativeTime", () => {
  it("formats minutes, hours, and days", () => {
    expect(relativeTime("2026-07-19T11:30:00Z", NOW)).toBe("30m ago");
    expect(relativeTime("2026-07-19T09:00:00Z", NOW)).toBe("3h ago");
    expect(relativeTime("2026-07-16T12:00:00Z", NOW)).toBe("3d ago");
  });
  it("calls anything under a minute 'just now'", () => {
    expect(relativeTime("2026-07-19T11:59:30Z", NOW)).toBe("just now");
  });
});

describe("accentFor", () => {
  it("maps ban and obituary kinds to red, births to blue, rest to ink", () => {
    expect(accentFor("ban_applied")).toContain("red");
    expect(accentFor("obituary_published")).toContain("red");
    expect(accentFor("birth_notice_published")).toContain("blue");
    expect(accentFor("life_qualified")).toContain("blue");
    expect(accentFor("tokens_granted")).toContain("ink");
    expect(accentFor("something_new")).toContain("ink");
  });
});

describe("NotificationsPanel", () => {
  it("shows the unread count badge when there are unread items", () => {
    render(<NotificationsPanel items={[item()]} unreadCount={3} onOpen={() => {}} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("hides the badge at zero unread", () => {
    render(<NotificationsPanel items={[item({ readAt: "2026-07-19T11:45:00Z" })]} unreadCount={0} onOpen={() => {}} />);
    expect(screen.queryByTestId("unread-badge")).toBeNull();
  });

  it("calls onOpen the first time it is expanded, not on collapse", () => {
    const onOpen = vi.fn();
    render(<NotificationsPanel items={[item()]} unreadCount={1} onOpen={onOpen} />);
    const toggle = screen.getByRole("button", { name: /notifications/i });
    fireEvent.click(toggle);
    expect(onOpen).toHaveBeenCalledOnce();
    fireEvent.click(toggle);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("renders each item as a link to its href once expanded", () => {
    render(<NotificationsPanel items={[item()]} unreadCount={1} onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(screen.getByRole("link", { name: /You died/ })).toHaveAttribute("href", "/players/x");
  });

  it("shows an in-voice empty state", () => {
    render(<NotificationsPanel items={[]} unreadCount={0} onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(screen.getByText(/nothing/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `pnpm --filter @onelife/web run test notifications-panel`
Expected: FAIL — cannot resolve `./notifications-panel`.

- [ ] **Step 3: Implement the panel**

`apps/web/src/components/controls/notifications-panel.tsx`:

```tsx
"use client";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import type { AppNotification } from "@/lib/types";

export function relativeTime(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

const RED = new Set(["ban_applied", "obituary_published"]);
const BLUE = new Set(["ban_lifted", "life_qualified", "survival_milestone", "birth_notice_published"]);

/** Reuses the R5b/R5c convention: red for death and the Morgue, blue for life and the
 *  Nursery, ink for account bookkeeping. An unknown kind falls back to ink rather than
 *  throwing, so a future notification type degrades quietly. */
export function accentFor(kind: string): string {
  if (RED.has(kind)) return "border-l-red";
  if (BLUE.has(kind)) return "border-l-blue";
  return "border-l-ink";
}

export function NotificationsPanel({
  items, unreadCount, onOpen, children,
}: {
  items: AppNotification[];
  unreadCount: number;
  onOpen: () => void;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Fire onOpen once per mount: marking read is not idempotent-free (it costs a request),
  // and re-firing on every expand would spam the API.
  const opened = useRef(false);
  const now = new Date();

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !opened.current) {
      opened.current = true;
      onOpen();
    }
  }

  return (
    <section>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between border-b-[3px] border-ink pb-1.5 font-display text-[13px] font-bold uppercase tracking-[.14em] text-ink"
      >
        <span>Notifications</span>
        {unreadCount > 0 && (
          <span
            data-testid="unread-badge"
            className="min-w-[20px] bg-red px-1.5 py-0.5 text-center font-mono text-[11px] font-bold text-paper"
          >
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-1.5">
          {items.length === 0 ? (
            <p className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
              Nothing on the wire.
            </p>
          ) : (
            items.map((n) => (
              <Link
                key={n.id}
                href={n.href}
                className={`border-l-[3px] ${accentFor(n.kind)} py-1 pl-2.5 ${n.readAt ? "" : "bg-bone"}`}
              >
                <span className="block font-display text-[12px] font-bold uppercase tracking-[.06em] text-ink">
                  {n.title}
                </span>
                <span className="block text-[13px] text-ink">{n.body}</span>
                <span className="block font-mono text-[10px] uppercase tracking-[.05em] text-ink-muted">
                  {relativeTime(n.createdAt, now)}
                </span>
              </Link>
            ))
          )}
          {children}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `pnpm --filter @onelife/web run test notifications-panel`
Expected: PASS (7 tests).

If `border-l-blue` is not a configured Tailwind color, check `apps/web/tailwind.config.ts` for the R1 token names and substitute the correct blue token (the birth-notice blue already used by `/fresh-spawns`), updating both the component and the `accentFor` test expectations.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/controls/notifications-panel.tsx apps/web/src/components/controls/notifications-panel.test.tsx
git commit -m "feat(web): notifications panel component"
```

---

### Task 14: Service worker, manifest, and push toggle

**Files:**
- Create: `apps/web/public/sw.js`, `apps/web/public/manifest.json`
- Create: `apps/web/src/components/controls/push-toggle.tsx`
- Modify: `apps/web/src/app/layout.tsx`

**Interfaces:**
- Consumes: `getVapidKey`, `subscribePush`, `unsubscribePush` from Task 12.
- Produces: `<PushToggle />`, rendered as the `children` slot of `NotificationsPanel`.

- [ ] **Step 1: Write the service worker**

`apps/web/public/sw.js`:

```js
// One Life push service worker. Payloads are JSON: { title, body, href }.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    return; // a malformed payload must never reject the push event
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { href: payload.href || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Prefer focusing an already-open tab over stacking up new windows.
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(href);
          return client.focus();
        }
      }
      return self.clients.openWindow(href);
    }),
  );
});
```

- [ ] **Step 2: Write the manifest**

`apps/web/public/manifest.json`:

```json
{
  "name": "One Life",
  "short_name": "One Life",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#f5f1e8",
  "theme_color": "#1a1a1a",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

Confirm `/icon-192.png` and `/icon-512.png` exist in `apps/web/public/` (`ls apps/web/public/*.png`). The R1 brand favicon kit was vendored there; if the filenames differ, use the actual names. If no 192/512 PNGs exist, generate them from the existing brand skull/wordmark asset before continuing — iOS will not offer "Add to Home Screen" as an installable app without them. Replace the two color values with the actual Paper and Ink hex values from `apps/web/src/app/globals.css`.

- [ ] **Step 3: Link the manifest**

In `apps/web/src/app/layout.tsx`, add `manifest: "/manifest.json"` to the exported `metadata` object.

- [ ] **Step 4: Implement the push toggle**

`apps/web/src/components/controls/push-toggle.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { getVapidKey, subscribePush, unsubscribePush } from "@/lib/api";

type State = "unsupported" | "denied" | "off" | "on" | "working";

/** VAPID public keys are base64url; PushManager wants a Uint8Array. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function PushToggle() {
  const [state, setState] = useState<State>("working");

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    void navigator.serviceWorker.getRegistration().then(async (reg) => {
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    });
  }, []);

  async function enable() {
    setState("working");
    try {
      // requestPermission MUST be inside the click handler's call stack — browsers
      // ignore (and some permanently block) prompts not tied to a user gesture.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      const { publicKey } = await getVapidKey();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await subscribePush({ endpoint: json.endpoint, keys: json.keys });
      setState("on");
    } catch {
      setState("off");
    }
  }

  async function disable() {
    setState("working");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await unsubscribePush(sub.endpoint);
        await sub.unsubscribe();
      }
    } finally {
      setState("off");
    }
  }

  const cls = "mt-1 text-left font-mono text-[10px] uppercase tracking-[.05em] text-ink-muted hover:text-red";
  if (state === "unsupported") return null;
  if (state === "denied") {
    return <p className={cls}>Push blocked in your browser settings.</p>;
  }
  if (state === "working") return <p className={cls}>Working…</p>;
  return (
    <button type="button" onClick={() => void (state === "on" ? disable() : enable())} className={cls}>
      {state === "on" ? "Turn off push alerts" : "Turn on push alerts"}
    </button>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @onelife/web run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/public/sw.js apps/web/public/manifest.json apps/web/src/components/controls/push-toggle.tsx apps/web/src/app/layout.tsx
git commit -m "feat(web): service worker, PWA manifest, and push opt-in toggle"
```

---

### Task 15: Wire the panel into the rail and mobile sheet

**Files:**
- Modify: `apps/web/src/components/controls/use-controls.ts`
- Modify: `apps/web/src/components/controls/rail.tsx:97-127`
- Modify: `apps/web/src/components/controls/mobile-controls.tsx`

**Interfaces:**
- Consumes: `NotificationsPanel` (Task 13), `PushToggle` (Task 14), client functions (Task 12).
- Produces: `Controls` gains `notifications: AppNotification[]` and `unreadCount: number`; `useControlsActions()` gains `markRead`.

- [ ] **Step 1: Extend `useControls`**

In `apps/web/src/components/controls/use-controls.ts`, add to the imports:

```ts
import { getMe, getNotifications, getPlayerPage, getServers, getTokens, markNotificationsRead, redeemToken, setReferrer, transferToken } from "@/lib/api";
import type { AppNotification } from "@/lib/types";
```

Add to the `Controls` type:

```ts
  notifications: AppNotification[];
  unreadCount: number;
```

Add the query inside `useControls`, after the `player` query:

```ts
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: getNotifications,
    enabled: signedIn,
    refetchInterval: 60_000,
  });
```

Add to the returned object:

```ts
    notifications: notifications.data?.items ?? [],
    unreadCount: notifications.data?.unreadCount ?? 0,
```

Add to `useControlsActions`:

```ts
  const markRead = useMutation({
    mutationFn: () => markNotificationsRead(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
```

and include `markRead` in the returned object.

- [ ] **Step 2: Mount in the rail**

In `apps/web/src/components/controls/rail.tsx`, add imports:

```ts
import { NotificationsPanel } from "./notifications-panel";
import { PushToggle } from "./push-toggle";
```

In the verified branch (the `else` block starting at line 97), insert between `<IdentityRow ... verified />` and `<TokensPanel ...>`:

```tsx
        <NotificationsPanel
          items={c.notifications}
          unreadCount={c.unreadCount}
          onOpen={() => a.markRead.mutate()}
        >
          <PushToggle />
        </NotificationsPanel>
```

- [ ] **Step 3: Mount in the mobile sheet**

Read `apps/web/src/components/controls/mobile-controls.tsx`, find its `verified &&` block, and insert the identical `<NotificationsPanel>…</NotificationsPanel>` element in the same position relative to `IdentityRow` and `TokensPanel`.

- [ ] **Step 4: Run the web suite and typecheck**

Run: `pnpm --filter @onelife/web run test && pnpm --filter @onelife/web run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/controls
git commit -m "feat(web): mount notifications panel in rail and mobile sheet"
```

---

### Task 16: Deploy wiring and documentation

**Files:**
- Modify: `deploy/deploy.sh` (the `SERVICES` array, ~line 32)
- Modify: `deploy/README.md` (unit table, manual restart command ~lines 125-126, env var docs)
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the service to the deploy fleet**

In `deploy/deploy.sh`, change:

```bash
SERVICES=(web api verifier enforcer granter rebooter newsdesk ingest projector)
```

to:

```bash
SERVICES=(web api verifier enforcer granter rebooter newsdesk notifier ingest projector)
```

Update the neighbouring comment if it says "All nine units" — it is now ten.

- [ ] **Step 2: Document the unit and env vars**

In `deploy/README.md`, add a row to the unit table for `onelife-notifier` with `ExecStart` of `pnpm --filter @onelife/notifier start`, matching the format of the existing `onelife-newsdesk` row, and add the notifier env vars from the Task 2 config table. Include the one-time key generation step:

```bash
npx web-push generate-vapid-keys
```

and note that `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (a `mailto:` address) go into the shared `/var/www/dayzonelife.com/.env`, and that `VAPID_PUBLIC_KEY` must be readable by the **api** unit too, since `GET /push/vapid-key` serves it.

Document the staged rollout from spec §8 as a runbook: deploy with `NOTIFIER_DRY_RUN=true` and no `NOTIFIER_SINCE`; then set `NOTIFIER_SINCE`; then `NOTIFIER_DRY_RUN=false` with `NOTIFIER_PUSH_ENABLED=false`; then enable push.

**This release reshapes the `lives` projection** (new `qualified_at` column written by the fold), so it MUST deploy with `./deploy/deploy.sh --rebuild` — a normal deploy would leave `qualified_at` null on every existing life and the `life_qualified` notification would never fire for anyone.

- [ ] **Step 3: Update the changelog**

Add an `### Added` entry under the Unreleased heading in `CHANGELOG.md` describing the notifications feature, the `apps/notifier` worker, the new API routes, the rail panel, and web push.

- [ ] **Step 4: Update CLAUDE.md**

Add `notifier` to the **apps** list in the Monorepo section, describing the two passes, the `NOTIFIER_SINCE` off-by-default gate, `NOTIFIER_DRY_RUN` defaulting to `true`, the `NOTIFIER_PUSH_ENABLED` kill switch, the single-instance at-least-once boundary, and the plain-vs-partial unique index distinction that makes `onConflictDoNothing` here take no `targetWhere`. Add `notifications` and `push_subscriptions` to the `db` package entry, noting they are durable (absent from `rebuild.ts`'s truncate list) and present in `APP_TABLES`. Add a short **Player notifications** sub-project entry summarising the catalogue and the verified-link boundary.

- [ ] **Step 5: Full verification**

Run: `pnpm turbo run typecheck`
Expected: PASS.

Run: `pnpm turbo run test --concurrency=1`
Expected: PASS across all packages.

- [ ] **Step 6: Commit**

```bash
git add deploy/deploy.sh deploy/README.md CHANGELOG.md CLAUDE.md
git commit -m "chore: deploy wiring and docs for the notifier"
```

- [ ] **Step 7: Open the PR**

Use the **finishing-a-feature** skill. The PR targets `develop` and requires both `CHANGELOG.md` and `CLAUDE.md` updates, which Steps 3 and 4 provide.

---

## Self-Review Notes

**Spec coverage.** Catalogue §1 → Tasks 4–7 (all nine kinds). Data model §2 → Task 1. Worker §3 → Tasks 2, 3, 10. API §4 → Task 11. Web UI §5 → Tasks 12, 13, 15. Web push §6 → Tasks 8, 9, 14. Testing §7 → tests within each task; the double-run idempotency assertion is Task 3 Step 1. Rollout §8 → Task 16.

**Two spec deviations, both deliberate:**

1. **`life_qualified` windows on a new materialized `qualified_at` column** (Tasks 1 and 1B), not on `lives.startedAt` as the spec originally described. The spec's approach would have silently dropped any life that qualified more than a lookback-window after it started. Materializing the instant in the fold is exact, and it also replaces the read-time `lifeQualifiedAt` derivation for future consumers. Cost: this makes the release a projection reshape, so deploy requires `--rebuild`. Residual caveat, documented in Global Constraints: the fold credits playtime at session close, so a playtime-qualified life's `qualified_at` is backdated correctly but written at disconnect — hence the 48h lookback default.
2. **`playerSlug` is duplicated** into `apps/notifier/src/generators/account.ts` rather than imported, because the worker must not depend on the web app. The two copies must stay in step or notification links 404. Task 4 carries a comment saying so.

**Open item for the implementer.** Task 14 Step 2 assumes `icon-192.png` and `icon-512.png` exist in `apps/web/public/`. Verify before writing the manifest; if absent, generating them from the vendored brand assets is in scope for that task.
