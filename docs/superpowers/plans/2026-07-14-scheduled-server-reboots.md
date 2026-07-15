# Scheduled Server Reboots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an always-on `apps/rebooter` worker that restarts every active Nitrado server on the top of every even UTC hour (00:00, 02:00, …, 22:00).

**Architecture:** A standalone worker mirroring `apps/enforcer` / `apps/granter` (own `config.ts` / `main.ts` / `tick.ts` + a pure `schedule.ts`). It sleeps until the next even-UTC-hour boundary, then restarts each `active` server best-effort via a new `NitradoClient.restartServer()` method. No dry-run gate — reboots go live on deploy.

**Tech Stack:** TypeScript/ESM, Drizzle ORM (Postgres), Zod, pino, Vitest, `@onelife/nitrado`, `@onelife/db`, `@onelife/test-support`.

## Global Constraints

- TypeScript + ESM; local imports use the `.js` extension (e.g. `./tick.js`).
- Workers query the DB directly via `@onelife/db` (`getDb(url).db`); no new tables, no event-log writes.
- One `NitradoClient` per server, constructed as `new NitradoClient(NITRADO_TOKEN, nitradoServiceId)`.
- Boundaries are **even UTC hours at minute 0** (00,02,…,22); interval is exactly 2h = `7_200_000` ms.
- No dry-run flag anywhere in this feature.
- DB-backed tests use `getTestDb()` from `@onelife/test-support` and a Vitest config with `globalSetup` + `fileParallelism: false`.
- Follow the existing worker file layout exactly; `main.ts` stays a thin, untested loop.

---

### Task 1: `NitradoClient.restartServer()`

**Files:**
- Modify: `packages/nitrado/src/client.ts` (add method after `removeBan`, ~line 66)
- Test: `packages/nitrado/test/restart.test.ts` (create)

**Interfaces:**
- Consumes: existing private `postJson(path, body)` on `NitradoClient` (POSTs bearer-auth JSON, throws unless response `status === "success"`).
- Produces: `restartServer(): Promise<void>` — POSTs `/services/{serviceId}/gameservers/restart`.

- [ ] **Step 1: Write the failing test**

Create `packages/nitrado/test/restart.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { NitradoClient } from "../src/client.js";

/** Fake fetch: records POST url + parsed body; returns a Nitrado success envelope. */
function makeFake(status = "success") {
  const posts: Array<{ url: string; body: unknown }> = [];
  const fetchFn = (async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "POST") {
      posts.push({ url, body: init.body ? JSON.parse(init.body) : undefined });
      return { ok: true, json: async () => ({ status, data: {} }) } as Response;
    }
    return { ok: true, json: async () => ({ status: "success", data: {} }) } as Response;
  }) as unknown as typeof fetch;
  return { fetchFn, posts };
}

describe("NitradoClient.restartServer", () => {
  it("POSTs the restart endpoint for its service id with an empty body", async () => {
    const { fetchFn, posts } = makeFake();
    const c = new NitradoClient("tok", 777, fetchFn);
    await c.restartServer();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe("https://api.nitrado.net/services/777/gameservers/restart");
    expect(posts[0]!.body).toEqual({});
  });

  it("throws when Nitrado returns a non-success envelope", async () => {
    const { fetchFn } = makeFake("error");
    const c = new NitradoClient("tok", 777, fetchFn);
    await expect(c.restartServer()).rejects.toThrow(/Nitrado/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/nitrado test -- restart`
Expected: FAIL — `c.restartServer is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `packages/nitrado/src/client.ts`, add immediately after the `removeBan` method:

```ts
  /** Restart this service's game server (fire immediately, no warning message). */
  async restartServer(): Promise<void> {
    await this.postJson(`/services/${this.serviceId}/gameservers/restart`, {});
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/nitrado test -- restart`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add packages/nitrado/src/client.ts packages/nitrado/test/restart.test.ts
git commit -m "feat(nitrado): add restartServer() for scheduled reboots"
```

---

### Task 2: `apps/rebooter` scaffold + config

**Files:**
- Create: `apps/rebooter/package.json`
- Create: `apps/rebooter/tsconfig.json`
- Create: `apps/rebooter/vitest.config.ts`
- Create: `apps/rebooter/src/config.ts`
- Test: `apps/rebooter/test/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env: Record<string, string | undefined>): Config` where
  `Config = { databaseUrl: string; nitradoToken: string; logLevel: string }`.

- [ ] **Step 1: Create the package manifest**

`apps/rebooter/package.json`:

```json
{
  "name": "@onelife/rebooter",
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
    "@onelife/nitrado": "workspace:*",
    "drizzle-orm": "^0.36.0",
    "pino": "^9.4.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@onelife/test-support": "workspace:*",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "tsx": "^4.19.0",
    "postgres": "^3.4.4"
  }
}
```

- [ ] **Step 2: Create tsconfig and vitest config**

`apps/rebooter/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`apps/rebooter/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { GLOBAL_SETUP_PATH } from "@onelife/test-support/setup-path";

export default defineConfig({
  test: { globalSetup: [GLOBAL_SETUP_PATH], fileParallelism: false },
});
```

- [ ] **Step 3: Install so the workspace picks up the new package**

Run: `pnpm install`
Expected: adds `@onelife/rebooter` to the workspace, no errors.

- [ ] **Step 4: Write the failing config test**

`apps/rebooter/test/config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const BASE = { DATABASE_URL: "postgres://x/y", NITRADO_TOKEN: "tok" };

describe("rebooter config", () => {
  it("parses database url, nitrado token, and default log level", () => {
    const c = loadConfig({ ...BASE });
    expect(c.databaseUrl).toBe("postgres://x/y");
    expect(c.nitradoToken).toBe("tok");
    expect(c.logLevel).toBe("info");
  });

  it("throws when DATABASE_URL is missing", () => {
    expect(() => loadConfig({ NITRADO_TOKEN: "tok" })).toThrow();
  });

  it("throws when NITRADO_TOKEN is missing", () => {
    expect(() => loadConfig({ DATABASE_URL: "postgres://x/y" })).toThrow();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm --filter @onelife/rebooter test -- config`
Expected: FAIL — cannot resolve `../src/config.js`.

- [ ] **Step 6: Write minimal implementation**

`apps/rebooter/src/config.ts`:

```ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  NITRADO_TOKEN: z.string().min(1),
  LOG_LEVEL: z.string().default("info"),
});

export type Config = { databaseUrl: string; nitradoToken: string; logLevel: string };

export function loadConfig(env: Record<string, string | undefined>): Config {
  const p = schema.parse(env);
  return { databaseUrl: p.DATABASE_URL, nitradoToken: p.NITRADO_TOKEN, logLevel: p.LOG_LEVEL };
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @onelife/rebooter test -- config`
Expected: PASS (all three cases).

- [ ] **Step 8: Commit**

```bash
git add apps/rebooter/package.json apps/rebooter/tsconfig.json apps/rebooter/vitest.config.ts apps/rebooter/src/config.ts apps/rebooter/test/config.test.ts pnpm-lock.yaml
git commit -m "feat(rebooter): scaffold worker app + config"
```

---

### Task 3: `schedule.ts` — even-UTC-hour boundary math

**Files:**
- Create: `apps/rebooter/src/schedule.ts`
- Test: `apps/rebooter/test/schedule.test.ts`

**Interfaces:**
- Produces: `msUntilNextBoundary(nowMs: number): number` — ms from `nowMs` until the next even UTC hour at :00:00. Returns the full `7_200_000` ms interval when `nowMs` is exactly on a boundary (never 0).

- [ ] **Step 1: Write the failing test**

`apps/rebooter/test/schedule.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { msUntilNextBoundary } from "../src/schedule.js";

const MIN = 60_000;

describe("msUntilNextBoundary (even UTC hours, 2h interval)", () => {
  it("mid odd hour → next even hour", () => {
    // 01:30 UTC → 02:00 UTC = 30 min
    expect(msUntilNextBoundary(Date.UTC(2026, 6, 14, 1, 30, 0))).toBe(30 * MIN);
  });

  it("mid even hour → the following even hour", () => {
    // 02:30 UTC → 04:00 UTC = 90 min
    expect(msUntilNextBoundary(Date.UTC(2026, 6, 14, 2, 30, 0))).toBe(90 * MIN);
  });

  it("exactly on a boundary → full interval, never 0", () => {
    // 04:00:00.000 UTC → 06:00 UTC = 120 min
    expect(msUntilNextBoundary(Date.UTC(2026, 6, 14, 4, 0, 0))).toBe(120 * MIN);
  });

  it("late odd hour wraps across midnight to 00:00 next day", () => {
    // 23:15 UTC → 00:00 UTC next day = 45 min
    expect(msUntilNextBoundary(Date.UTC(2026, 6, 14, 23, 15, 0))).toBe(45 * MIN);
  });

  it("result always lands exactly on an even UTC hour at minute 0", () => {
    const now = Date.UTC(2026, 6, 14, 5, 17, 42, 123);
    const next = new Date(now + msUntilNextBoundary(now));
    expect(next.getUTCMinutes()).toBe(0);
    expect(next.getUTCSeconds()).toBe(0);
    expect(next.getUTCMilliseconds()).toBe(0);
    expect(next.getUTCHours() % 2).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/rebooter test -- schedule`
Expected: FAIL — cannot resolve `../src/schedule.js`.

- [ ] **Step 3: Write minimal implementation**

`apps/rebooter/src/schedule.ts`:

```ts
/** 2 hours in ms — the reboot interval. */
export const INTERVAL_MS = 2 * 60 * 60 * 1000;

/**
 * Ms from `nowMs` until the next even UTC hour at :00:00.
 * The Unix epoch (1970-01-01T00:00:00Z) is itself an even-hour boundary, so every
 * multiple of INTERVAL_MS from the epoch lands on 00,02,…,22 UTC — hence the modulo.
 * On an exact boundary this returns INTERVAL_MS (the next one), never 0.
 */
export function msUntilNextBoundary(nowMs: number): number {
  return INTERVAL_MS - (nowMs % INTERVAL_MS);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/rebooter test -- schedule`
Expected: PASS (all five cases).

- [ ] **Step 5: Commit**

```bash
git add apps/rebooter/src/schedule.ts apps/rebooter/test/schedule.test.ts
git commit -m "feat(rebooter): even-UTC-hour boundary scheduler"
```

---

### Task 4: `tick.ts` — restart all active servers

**Files:**
- Create: `apps/rebooter/src/tick.ts`
- Test: `apps/rebooter/test/tick.test.ts`

**Interfaces:**
- Consumes: `Database` and `servers` from `@onelife/db`; `NitradoClient.restartServer()` (Task 1).
- Produces:
  - `interface RestartClient { restartServer(): Promise<void> }`
  - `type RebooterDeps = { nitradoFor: (serviceId: number) => RestartClient; log: { info: (obj: unknown, msg?: string) => void; error?: (obj: unknown, msg?: string) => void } }`
  - `type RebooterResult = { restarted: number; failed: number }`
  - `rebooterTick(db: Database, deps: RebooterDeps): Promise<RebooterResult>`

- [ ] **Step 1: Write the failing test**

`apps/rebooter/test/tick.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { rebooterTick, type RestartClient } from "../src/tick.js";

const { db, sql } = getTestDb();
const log = { info: () => {}, error: () => {} };

/** Records restart calls per service id; `failOn` service ids throw. */
function fakeNitrado(failOn: number[] = []) {
  const restarted: number[] = [];
  const nitradoFor = (sid: number): RestartClient => ({
    async restartServer() {
      if (failOn.includes(sid)) throw new Error(`boom ${sid}`);
      restarted.push(sid);
    },
  });
  return { restarted, nitradoFor };
}

beforeAll(async () => {
  await db.insert(servers).values({ nitradoServiceId: 900001, name: "alpha", active: true });
  await db.insert(servers).values({ nitradoServiceId: 900002, name: "bravo", active: true });
  await db.insert(servers).values({ nitradoServiceId: 900003, name: "charlie", active: false });
});
afterAll(async () => { await sql.end(); });

describe("rebooterTick", () => {
  it("restarts every active server and skips inactive ones", async () => {
    const fake = fakeNitrado();
    const r = await rebooterTick(db, { nitradoFor: fake.nitradoFor, log });
    expect(fake.restarted.sort()).toEqual([900001, 900002]);
    expect(r).toEqual({ restarted: 2, failed: 0 });
  });

  it("is best-effort: one server failing does not stop the others", async () => {
    const fake = fakeNitrado([900001]);
    const r = await rebooterTick(db, { nitradoFor: fake.nitradoFor, log });
    expect(fake.restarted).toEqual([900002]); // bravo still restarted
    expect(r).toEqual({ restarted: 1, failed: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/rebooter test -- tick`
Expected: FAIL — cannot resolve `../src/tick.js`.

- [ ] **Step 3: Write minimal implementation**

`apps/rebooter/src/tick.ts`:

```ts
import { eq } from "drizzle-orm";
import { type Database, servers } from "@onelife/db";

/** Minimal Nitrado surface the rebooter needs — real client or a fake in tests. */
export interface RestartClient {
  restartServer(): Promise<void>;
}

export type RebooterDeps = {
  nitradoFor: (serviceId: number) => RestartClient;
  log: { info: (obj: unknown, msg?: string) => void; error?: (obj: unknown, msg?: string) => void };
};

export type RebooterResult = { restarted: number; failed: number };

/** Restart every active server, best-effort: a single failure is logged and skipped. */
export async function rebooterTick(db: Database, deps: RebooterDeps): Promise<RebooterResult> {
  const rows = await db
    .select({ name: servers.name, serviceId: servers.nitradoServiceId })
    .from(servers)
    .where(eq(servers.active, true));

  let restarted = 0;
  let failed = 0;
  for (const s of rows) {
    try {
      await deps.nitradoFor(s.serviceId).restartServer();
      deps.log.info({ name: s.name, serviceId: s.serviceId }, "restarting");
      restarted++;
    } catch (e) {
      failed++;
      deps.log.error?.({ err: e, name: s.name, serviceId: s.serviceId }, "restart failed");
    }
  }
  return { restarted, failed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/rebooter test -- tick`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add apps/rebooter/src/tick.ts apps/rebooter/test/tick.test.ts
git commit -m "feat(rebooter): restart all active servers each tick"
```

---

### Task 5: `main.ts` loop + deploy wiring

**Files:**
- Create: `apps/rebooter/src/main.ts`
- Modify: `deploy/deploy.sh:31` (SERVICES array)
- Modify: `deploy/README.md` (worker inventory + start loop lines)

**Interfaces:**
- Consumes: `loadConfig` (Task 2), `msUntilNextBoundary` (Task 3), `rebooterTick` (Task 4), `NitradoClient` (Task 1), `getDb` from `@onelife/db`.

- [ ] **Step 1: Write the loop (untested, per worker convention)**

`apps/rebooter/src/main.ts`:

```ts
import pino from "pino";
import { getDb } from "@onelife/db";
import { NitradoClient } from "@onelife/nitrado";
import { loadConfig } from "./config.js";
import { msUntilNextBoundary } from "./schedule.js";
import { rebooterTick } from "./tick.js";

const cfg = loadConfig(process.env);
const log = pino({ level: cfg.logLevel });
const { db } = getDb(cfg.databaseUrl);

async function loop(): Promise<void> {
  log.info({}, "rebooter starting — restarts every even UTC hour (00,02,…,22)");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const waitMs = msUntilNextBoundary(Date.now());
    log.info({ nextRebootInMinutes: Math.round(waitMs / 60000) }, "sleeping until next boundary");
    await new Promise((r) => setTimeout(r, waitMs));
    try {
      const r = await rebooterTick(db, {
        nitradoFor: (sid) => new NitradoClient(cfg.nitradoToken, sid),
        log,
      });
      log.info(r, "rebooter tick");
    } catch (err) {
      log.error({ err }, "rebooter tick failed");
    }
  }
}

loop();
```

- [ ] **Step 2: Typecheck the app**

Run: `pnpm --filter @onelife/rebooter typecheck`
Expected: no errors.

- [ ] **Step 3: Add the worker to the deploy fleet**

In `deploy/deploy.sh`, change the `SERVICES` line (currently line 31):

```bash
# All eight units, in a safe stop order (consumers/HTTP first, projector last).
# Start order is the reverse, so the projector leads and re-folds ASAP.
SERVICES=(web api verifier enforcer granter rebooter ingest projector)
```

- [ ] **Step 4: Update the deploy README worker inventory**

In `deploy/README.md`, add `rebooter` to the workers row of the inventory table and to the start-loop example, mirroring how `granter` appears. Add a one-line note under the worker descriptions:

```markdown
`rebooter` restarts every **active** server in the `servers` table on the top of every
even UTC hour (00:00, 02:00, …, 22:00), using the shared `NITRADO_TOKEN`. Requires a
`onelife-rebooter` systemd unit on the host (create it alongside the other worker units).
```

- [ ] **Step 5: Run the full app test suite**

Run: `pnpm --filter @onelife/rebooter test`
Expected: PASS — config, schedule, and tick suites all green.

- [ ] **Step 6: Commit**

```bash
git add apps/rebooter/src/main.ts deploy/deploy.sh deploy/README.md
git commit -m "feat(rebooter): main loop + deploy fleet wiring"
```

---

## Pre-PR wrap-up (handled by finishing-a-feature, not a task here)

- `pnpm turbo run typecheck` and `pnpm turbo run test --concurrency=1` green.
- `CHANGELOG.md` updated with the scheduled-reboots feature.
- `CLAUDE.md` sub-projects/apps list updated to mention `apps/rebooter` (last step before PR).
- PR into `develop`.
