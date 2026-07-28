# Cold-Home Ledger Hero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The signed-out home's hero becomes a dynamic casualty ledger — "Deaths to date: 1,247. Still standing: 38." — built from real fleet-wide numbers, with the death figure counting up from 0 on load.

**Architecture:** One new read-model (`getSiteStats`) reusing the survivors board's alive definition and the SQL `qualifiedLifeCondition` for ended lives; one public Fastify route (`GET /stats`); a `Hero` rework taking optional stats with the current evergreen hero as the no-stats fallback; a small `CountUp` client component. Spec: `docs/superpowers/specs/2026-07-28-cold-home-ledger-hero-design.md`.

**Tech Stack:** TypeScript/ESM monorepo (pnpm + turbo), Drizzle + Postgres, Fastify, Next.js App Router, vitest + RTL.

## Global Constraints

- **One well:** deaths = ended qualified lives; alive = the survivors boards' exact fleet-wide total. Unqualified lives count in neither.
- **Live-data honesty:** a missing/failed stats fetch renders the current evergreen hero — never a `0`, never a placeholder, no failure banner. Feeds degrade independently (own `settleFeed` per fetch).
- **`qualifiedLifeCondition` may only be used for ENDED lives** (`lives.playtime_seconds` is stale mid-session; final once the life ended).
- **Numbers format with `toLocaleString("en-US")`** (deterministic — server and client HTML must agree).
- **A11y/motion:** SSR/no-JS/`prefers-reduced-motion` render the real final number; animated span is `aria-hidden`; an `sr-only` sentence carries the final numbers.
- **RED POLICY:** the red death figure must be display-scale (≥19px bold) to legally use plain `--red` on paper.
- **Repo law:** DB suites need `TEST_DATABASE_URL`. Run tests with `pnpm --filter <pkg> test -- <file>` patterns as shown. CHANGELOG.md Unreleased entry required before the PR.

---

### Task 1: `getSiteStats` read-model

**Files:**
- Create: `packages/read-models/src/site-stats.ts`
- Modify: `packages/read-models/src/index.ts` (add `export * from "./site-stats.js";` alongside the other exports)
- Test: `packages/read-models/test/site-stats.test.ts`

**Interfaces:**
- Consumes: `qualifiedLifeCondition(db)` from `./qualified-lives.js`; `getAliveSurvivors(db, { page, pageSize }, now)` from `./survivors.js`.
- Produces: `getSiteStats(db: Database, now: Date): Promise<SiteStats>` where `export type SiteStats = { deaths: number; alive: number }`. Task 2 imports both from `@onelife/read-models`.

- [ ] **Step 1: Write the failing test**

Model the harness on `packages/read-models/test/survivors.test.ts` (same `getTestDb`, per-file random `nitradoServiceId`, cleanup of inserted rows in `afterAll`). The seed helpers below are the same shape that file uses — copy its `insertLife` (players are global/gamertag-unique, so upsert-by-lookup) and its kills insert.

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, kills } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { getSiteStats } from "../src/site-stats.js";
import { getAliveSurvivors } from "../src/survivors.js";

const { db } = getTestDb();

const now = new Date("2026-07-28T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

const svc = Math.floor(Math.random() * 1e8) + 47e7;
let serverId: number;
const insertedGamertags = new Set<string>();

async function insertLife(opts: {
  gamertag: string;
  endedAt: Date | null;
  playtimeSeconds: number;
  startedAt: Date;
  deathCause?: string | null;
}) {
  let [p] = await db.select().from(players).where(eq(players.gamertag, opts.gamertag));
  if (!p) {
    [p] = await db.insert(players).values({ gamertag: opts.gamertag, firstSeenAt: opts.startedAt, lastSeenAt: now }).returning();
  }
  insertedGamertags.add(opts.gamertag);
  const [life] = await db.insert(lives).values({
    serverId,
    playerId: p!.id,
    startedAt: opts.startedAt,
    endedAt: opts.endedAt,
    playtimeSeconds: opts.playtimeSeconds,
    deathCause: opts.deathCause ?? (opts.endedAt ? "died" : null),
  }).returning();
  return { life: life!, player: p! };
}

describe("getSiteStats", () => {
  beforeAll(async () => {
    const [s] = await db.insert(servers).values({
      nitradoServiceId: svc, name: "Stats", map: "chernarusplus", slug: `stats-${svc}`, active: true,
    }).returning();
    serverId = s!.id;

    // deaths: 2 qualified ended lives (one by playtime, one instant PvP death)
    await insertLife({ gamertag: `St-DeadLong-${svc}`, startedAt: hoursAgo(30), endedAt: hoursAgo(25), playtimeSeconds: 7200 });
    await insertLife({ gamertag: `St-DeadPvp-${svc}`, startedAt: hoursAgo(20), endedAt: hoursAgo(20), playtimeSeconds: 30, deathCause: "pvp" });
    // excluded from deaths: unqualified ended life (sub-5-minute, no pvp, no kills)
    await insertLife({ gamertag: `St-Blip-${svc}`, startedAt: hoursAgo(10), endedAt: hoursAgo(10), playtimeSeconds: 90 });
    // alive: 1 open qualified life; excluded from BOTH: 1 open provisional life
    await insertLife({ gamertag: `St-Alive-${svc}`, startedAt: hoursAgo(5), endedAt: null, playtimeSeconds: 7200 });
    await insertLife({ gamertag: `St-Fresh-${svc}`, startedAt: hoursAgo(1), endedAt: null, playtimeSeconds: 60 });
  });

  afterAll(async () => {
    const ps = await db.select().from(players).where(inArray(players.gamertag, [...insertedGamertags]));
    const ids = ps.map((p) => p.id);
    if (ids.length) {
      await db.delete(kills).where(inArray(kills.killerPlayerId, ids));
      await db.delete(lives).where(inArray(lives.playerId, ids));
      await db.delete(players).where(inArray(players.id, ids));
    }
    await db.delete(servers).where(eq(servers.id, serverId));
  });

  it("counts ended qualified lives as deaths — unqualified ended lives excluded", async () => {
    const stats = await getSiteStats(db, now);
    // MUTATION CHECK for qualified-only: drop the qualifiedLifeCondition clause and St-Blip
    // makes this 3.
    expect(stats.deaths).toBe(2);
  });

  it("never counts an open life as a death, however qualified", async () => {
    const stats = await getSiteStats(db, now);
    // MUTATION CHECK for ended-only: drop the isNotNull(lives.endedAt) clause and St-Alive
    // (open, 2h playtime — passes the SQL condition) makes deaths 3.
    expect(stats.deaths).toBe(2);
  });

  it("alive IS the survivors board's total — same well, cannot disagree", async () => {
    const stats = await getSiteStats(db, now);
    const board = await getAliveSurvivors(db, { page: 1, pageSize: 1 }, now);
    expect(stats.alive).toBe(board.total);
    expect(stats.alive).toBeGreaterThanOrEqual(1); // St-Alive is on it; St-Fresh (provisional) is not
  });
});
```

Note the suite runs against a shared test DB — other suites' rows may exist. The counts above are exact only because every gamertag/server here is suffixed with the random `svc`; deaths assertions would be polluted by OTHER suites' ended qualified lives. **Guard against that:** instead of `toBe(2)`, snapshot a baseline before seeding and assert the delta:

```ts
// In beforeAll, FIRST line, before any insert:
//   baseline = await getSiteStats(db, now);
// Then assertions become:
//   expect(stats.deaths).toBe(baseline.deaths + 2);
```

Use the delta form in the actual test file (declare `let baseline: { deaths: number; alive: number };` at module scope). The alive-equals-board assertion needs no baseline — both sides are measured at the same instant.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/read-models test -- site-stats`
Expected: FAIL — `Cannot find module '../src/site-stats.js'` (or similar).

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/read-models/src/site-stats.ts
import type { Database } from "@onelife/db";
import { lives, players } from "@onelife/db";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { qualifiedLifeCondition } from "./qualified-lives.js";
import { getAliveSurvivors } from "./survivors.js";

export type SiteStats = { deaths: number; alive: number };

/**
 * The cold home's ledger numbers. ONE WELL: `deaths` counts ended qualified lives with the same
 * qualification every other surface uses; `alive` IS the survivors board's fleet-wide total
 * (delegated, not re-derived, so the headline and the boards can never disagree).
 *
 * ⚠️ `qualifiedLifeCondition` is legal here ONLY because of the `endedAt IS NOT NULL` clause:
 * `lives.playtime_seconds` advances at session close, so the SQL condition is stale for OPEN
 * lives (why the alive side must go through the derived JS path) but final once a life ended —
 * every session of an ended life is closed.
 */
export async function getSiteStats(db: Database, now: Date): Promise<SiteStats> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(lives)
    .innerJoin(players, eq(players.id, lives.playerId))
    .where(and(isNotNull(lives.endedAt), qualifiedLifeCondition(db)));

  // pageSize 1: we only want `total`; the single row's avatar lookup is one indexed query.
  const board = await getAliveSurvivors(db, { page: 1, pageSize: 1 }, now);

  return { deaths: row?.n ?? 0, alive: board.total };
}
```

(The `players` inner join exists because `qualifiedLifeCondition`'s kill-window subquery correlates on `players.id` — see its doc comment.)

Add to `packages/read-models/src/index.ts`:

```ts
export * from "./site-stats.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/read-models test -- site-stats`
Expected: PASS (all 3 tests).

- [ ] **Step 5: Mutation-verify the two load-bearing clauses**

Temporarily delete `qualifiedLifeCondition(db)` from the `where` → run → the qualified-only test must FAIL. Restore. Temporarily delete `isNotNull(lives.endedAt)` → run → the ended-only test must FAIL. Restore, re-run, all green. (Do not commit the mutations.)

- [ ] **Step 6: Commit**

```bash
git add packages/read-models/src/site-stats.ts packages/read-models/src/index.ts packages/read-models/test/site-stats.test.ts
git commit -m "feat(read-models): getSiteStats — fleet-wide deaths + alive ledger numbers"
```

---

### Task 2: Public `GET /stats` route

**Files:**
- Create: `apps/api/src/routes/stats.ts`
- Modify: `apps/api/src/app.ts` (import + register alongside `registerSurvivorsRoutes(app, db)`)
- Test: `apps/api/test/stats.test.ts`

**Interfaces:**
- Consumes: `getSiteStats` from `@onelife/read-models` (Task 1).
- Produces: `GET /stats` → `200 { deaths: number, alive: number }`, public, no params, no session. The web (Task 3) fetches it at `/api/stats` (the Next rewrite strips `/api`).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/stats.test.ts
import { describe, it, expect } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { buildApp } from "../src/app.js";

const { db } = getTestDb();
const app = buildApp(db);

describe("GET /stats", () => {
  it("is public and returns the two ledger numbers", async () => {
    const res = await app.inject({ method: "GET", url: "/stats" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.deaths).toBe("number");
    expect(typeof body.alive).toBe("number");
    // Nothing player-scoped in the payload — exactly two fields.
    expect(Object.keys(body).sort()).toEqual(["alive", "deaths"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/api test -- stats.test`
Expected: FAIL — 404 (route not registered).

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/routes/stats.ts
import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import { getSiteStats } from "@onelife/read-models";

/** Public site-wide ledger numbers for the cold home's hero. No params, no session — nothing
 *  in the payload is player-scoped. */
export function registerStatsRoutes(app: FastifyInstance, db: Database): void {
  app.get("/stats", async () => getSiteStats(db, new Date()));
}
```

In `apps/api/src/app.ts`, add the import next to the other route imports and register next to `registerSurvivorsRoutes(app, db);`:

```ts
import { registerStatsRoutes } from "./routes/stats.js";
// …
registerStatsRoutes(app, db);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/api test -- stats.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/stats.ts apps/api/src/app.ts apps/api/test/stats.test.ts
git commit -m "feat(api): public GET /stats — site-wide deaths/alive ledger"
```

---

### Task 3: Web plumbing — `SiteStats` type, fetcher, `CountUp`

**Files:**
- Modify: `apps/web/src/lib/types.ts` (add `SiteStats`)
- Modify: `apps/web/src/lib/api.ts` (add `getSiteStats`)
- Create: `apps/web/src/components/front-page/count-up.tsx`
- Test: `apps/web/src/components/front-page/count-up.test.tsx`

**Interfaces:**
- Consumes: `GET /api/stats` (Task 2 via the Next rewrite); `apiGet` from `@/lib/api`.
- Produces: `export type SiteStats = { deaths: number; alive: number }` in `@/lib/types`; `export const getSiteStats = () => apiGet<SiteStats>("/api/stats")` in `@/lib/api`; `export function CountUp({ value, durationMs? }: { value: number; durationMs?: number })` rendering an `aria-hidden` span. Task 4 uses all three.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/front-page/count-up.test.tsx
import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { CountUp } from "./count-up";

function stubMatchMedia(reduced: boolean) {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: reduced }));
}
afterEach(() => vi.unstubAllGlobals());

describe("CountUp", () => {
  it("under reduced motion, renders the real final value and never animates", () => {
    stubMatchMedia(true);
    const { container } = render(<CountUp value={1247} />);
    expect(container.textContent).toBe("1,247");
  });

  it("is aria-hidden — screen readers get the number from the hero's sr-only sentence instead", () => {
    stubMatchMedia(true);
    const { container } = render(<CountUp value={5} />);
    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
  });

  it("with motion allowed, lands exactly on the final value when the animation completes", async () => {
    stubMatchMedia(false);
    vi.useFakeTimers();
    // jsdom has no rAF loop under fake timers — drive it: each rAF becomes a 16ms timeout.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 16) as unknown as number);
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
    const { container } = render(<CountUp value={1247} durationMs={100} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(container.textContent).toBe("1,247");
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/web test -- count-up`
Expected: FAIL — module `./count-up` not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/web/src/components/front-page/count-up.tsx
"use client";
import { useEffect, useState } from "react";

/**
 * The ledger's mortality odometer. The initial render — which is also the SSR/no-JS HTML — is
 * the REAL final value (SEO and curl see the truth); only after hydration, and only when the
 * visitor allows motion, does it restart from 0 and sprint up (~1.5s, ease-out cubic, so it
 * slams into the final figure).
 *
 * ⚠️ `aria-hidden` is load-bearing: a screen reader must never hear ticking digits. The hero
 * carries the final numbers in an `sr-only` sentence instead.
 */
export function CountUp({ value, durationMs = 1500 }: { value: number; durationMs?: number }) {
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let start: number | null = null;
    const tick = (t: number) => {
      start ??= t;
      const p = Math.min(1, (t - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(eased * value));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  return <span aria-hidden="true">{shown.toLocaleString("en-US")}</span>;
}
```

In `apps/web/src/lib/types.ts`, add near the other payload types:

```ts
export type SiteStats = { deaths: number; alive: number };
```

In `apps/web/src/lib/api.ts`, add `SiteStats` to the type import from `./types` and, next to `getSurvivors`:

```ts
/** Public fleet-wide ledger numbers for the cold home's hero. */
export const getSiteStats = () => apiGet<SiteStats>("/api/stats");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/web test -- count-up`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/types.ts apps/web/src/lib/api.ts apps/web/src/components/front-page/count-up.tsx apps/web/src/components/front-page/count-up.test.tsx
git commit -m "feat(web): SiteStats fetcher + CountUp odometer component"
```

---

### Task 4: Hero rework + home wiring

**Files:**
- Modify: `apps/web/src/components/front-page/hero.tsx`
- Modify: `apps/web/src/app/(site)/(boxed)/page.tsx`
- Test: `apps/web/src/components/front-page/front-page.test.tsx` (extend the existing `Hero` describe)

**Interfaces:**
- Consumes: `SiteStats` from `@/lib/types`, `CountUp` from `./count-up` (Task 3), `settleFeed` from `@/lib/settle-feed`, `getSiteStats` from `@/lib/api`, existing `Kicker` from `@/components/tabloid/kicker`.
- Produces: `Hero({ stats }: { stats?: SiteStats | null })` — the last task; nothing consumes it further.

- [ ] **Step 1: Write the failing tests**

Extend the `Hero` describe in `apps/web/src/components/front-page/front-page.test.tsx` (keep the existing evergreen test — it now covers the no-stats branch; update its name if you like):

```tsx
// add to imports: import type { SiteStats } from "@/lib/types";
// CountUp is a client component; under jsdom its effect runs but matchMedia is missing — stub it
// once for this file (top of file, after the other mocks):
//   vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));

const stats: SiteStats = { deaths: 1247, alive: 38 };

it("with stats, the ledger IS the h1 and the brand line demotes to the kicker", () => {
  render(<Hero stats={stats} />);
  // The accessible name comes from the sr-only sentence — final numbers, one clean announcement.
  expect(
    screen.getByRole("heading", { level: 1, name: "Deaths to date: 1,247. Still standing: 38." }),
  ).toBeInTheDocument();
  expect(screen.getByText("One life. No respawns.")).toBeInTheDocument(); // the kicker now
  expect(screen.queryByText("The record of record")).not.toBeInTheDocument();
});

it("without stats, the evergreen hero renders — no zero, no placeholder, no banner", () => {
  render(<Hero stats={null} />);
  expect(screen.getByRole("heading", { level: 1, name: "One life. No respawns." })).toBeInTheDocument();
  expect(screen.queryByText(/Deaths to date/)).not.toBeInTheDocument();
  // ⚠️ Live-data honesty: a missing number must never render as 0.
  expect(screen.queryByText(/\b0\b/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @onelife/web test -- front-page`
Expected: the two new tests FAIL (Hero takes no props yet); existing tests still pass.

- [ ] **Step 3: Implement the Hero rework**

Replace `apps/web/src/components/front-page/hero.tsx` with:

```tsx
import Link from "next/link";
import { Kicker } from "@/components/tabloid/kicker";
import { CountUp } from "./count-up";
import type { SiteStats } from "@/lib/types";

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * The cold home's hero. With stats, the casualty ledger IS the `<h1>` — real fleet-wide
 * numbers, the death figure counting up — and the evergreen brand line demotes to the kicker.
 * Without stats (fetch failed / null), the evergreen hero renders unchanged: the floor is a
 * fully legitimate front page, so there is no banner and NEVER a zero (live-data honesty).
 *
 * The visible ledger is aria-hidden with an sr-only sentence carrying the final numbers, so a
 * screen reader hears one clean announcement rather than CountUp's ticking digits.
 */
export function Hero({ stats }: { stats?: SiteStats | null }) {
  return (
    <section className="border-b-[3px] border-ink px-6 py-10 md:px-10 md:py-14">
      <Kicker>{stats ? "One life. No respawns." : "The record of record"}</Kicker>
      {stats ? (
        <h1 className="mt-3 font-display text-4xl font-bold uppercase leading-[1.05] md:text-6xl">
          <span className="sr-only">
            {`Deaths to date: ${fmt(stats.deaths)}. Still standing: ${fmt(stats.alive)}.`}
          </span>
          <span aria-hidden="true">
            Deaths to date: <span className="text-red"><CountUp value={stats.deaths} /></span>.{" "}
            Still standing: {fmt(stats.alive)}.
          </span>
        </h1>
      ) : (
        <h1 className="mt-3 font-display text-5xl font-bold uppercase leading-[.95] md:text-7xl">
          One life. No respawns.
        </h1>
      )}
      <p className="mt-5 max-w-3xl font-sans text-lg leading-relaxed text-ink-soft">
        Hardcore permadeath DayZ, tracked to the minute. One life per server; when it ends, the
        ban is real and the record is permanent. The living are ranked below.
      </p>
      <Link
        href="/about"
        className="mt-6 inline-block border-b-2 border-red font-display text-sm font-semibold uppercase tracking-[.06em] text-ink hover:text-red"
      >
        How it works →
      </Link>
    </section>
  );
}
```

(Display sizes `text-4xl`/`md:text-6xl` are ≥19px bold, so plain `text-red` is legal under the RED POLICY. The ledger drops one size tier from the evergreen headline because the sentence is longer.)

In `apps/web/src/app/(site)/(boxed)/page.tsx`, inside `Home()` after the `servers` fetch, add its **own** settled feed (independent degradation — do not share a try/catch with anything):

```tsx
// add to the imports from "@/lib/api": getSiteStats
// The ledger's numbers. Its OWN settleFeed: a failed stats fetch costs only the ledger (the
// hero falls back to the evergreen headline) — never the board strip or the cold fork.
const stats = await settleFeed(getSiteStats());
```

and pass it to the hero: `<Hero stats={stats.data} />`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/web test -- front-page`
Expected: PASS (all Hero/TopSurvivors/SignInCta tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm turbo run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/front-page/hero.tsx "apps/web/src/app/(site)/(boxed)/page.tsx" apps/web/src/components/front-page/front-page.test.tsx
git commit -m "feat(web): cold-home ledger hero — dynamic deaths/alive headline with evergreen fallback"
```

---

### Task 5: Changelog + full verification

**Files:**
- Modify: `CHANGELOG.md` (Unreleased section, per repo convention — look at the existing entries' format)

- [ ] **Step 1: Add the changelog entry**

Under `## [Unreleased]` (create the section if absent, matching the file's existing style):

```markdown
### Added
- Cold-home ledger hero: the signed-out front page's headline is now a live casualty ledger —
  "Deaths to date: N. Still standing: M." — from real fleet-wide numbers (ended qualified lives /
  the survivors boards' alive total), with the death figure counting up on load. Falls back to
  the evergreen "One life. No respawns." headline when the numbers are unavailable. New public
  `GET /stats`.
```

- [ ] **Step 2: Full test suite + typecheck**

Run: `pnpm turbo run test --concurrency=1 && pnpm turbo run typecheck`
Expected: all green. (DB suites need `TEST_DATABASE_URL` exported; this dev machine's Postgres is on port 5434 — check `docker ps`.)

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for cold-home ledger hero"
```

---

## Post-plan notes (not tasks)

- **Deploy:** no migration, no worker, no env var — plain `./deploy/deploy.sh`, no `--rebuild`.
- **Browser check (per repo convention, before release):** load the cold home in real Chrome — count-up runs once, lands on the exact figure, reduced-motion (macOS: System Settings → Accessibility → Display → Reduce motion) renders it static, and the number in view-source matches the final figure.
- **PR:** via `keel:finish-work` (changelog entry is already committed by Task 5).
