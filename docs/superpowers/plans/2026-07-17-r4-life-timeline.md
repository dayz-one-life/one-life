# R4 — Life timeline + obituary/birth groundwork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the design-canvas 14a per-life event-timeline page, return R2's dropped per-life detail via that page, and build obituary/birth read-models + API groundwork behind the still-static teasers.

**Architecture:** A new `getLifeTimeline` read-model composes existing pieces (`getLifeDetail` + `getLifeKills` + `getLifeCharacter` + `lifeQualifiedAt`); the existing `GET /players/:gamertag/:map/lives/:n` route returns it plus display fields (real-cased gamertag, map codename, map slug). A pure web helper `buildTimeline(data, now)` turns that into an ordered, grouped, factually-captioned event list rendered by a new `/players/[slug]/[map]/lives/[n]` page. Two paginated read-models (`getObituaries`, `getFreshSpawns`) + public API routes land as R5 groundwork with the teasers untouched. Standing/funeral cards gain `TIMELINE →` links via a pure `lifeHref`.

**Tech Stack:** pnpm + turbo monorepo, TS/ESM; `@onelife/read-models` (Drizzle/Postgres) + `apps/api` (Fastify + Zod); `apps/web` (Next.js 15 App Router, React 19, Tailwind v3 RGB-triple tokens, Vitest 2 + Testing Library).

## Global Constraints

- **Color tokens only** (no raw hex, no legacy names): `paper ink red red-deep yellow blue bone dark hairline hairline-2 archive dark-line dash ink-soft ink-muted cream-muted cream-dim red-soft discord`. Fonts: `font-display` (Oswald), `font-mono` (IBM Plex Mono), `font-sans`. Skew = inline `-skew-x-[5deg]` (no token).
- **Semantic colors:** red = death/breaking, yellow = drama/pending, blue = birth/alive.
- **Captions are deterministic + factual — NO LLM, no editorial prose, no generated headlines.** On-brand fixed labels are allowed; variable descriptive prose is not. No exclamation points, no emoji in copy.
- **h1 is factual:** `Life {n} · {mapLabel}` — never an editorial headline like "The Sakhal streak" (that is R5).
- **Voice-first:** the timeline links to NO teaser pages — no "Obituary →", no "Birth announcement published →" (those are R5). Teasers stay static and unchanged.
- **Location is voice-only:** the "Positions withheld" bar shows **only while a life is alive**; there is **no per-event location line or redaction anywhere**, and nothing is revealed after death.
- **Decorative-image hygiene:** portraits use `CharacterImage` (`alt=""`, never a role; silhouette fallback `aria-hidden`); decorative glyphs/dots wrapped in `aria-hidden`; names route through `GamertagLink`.
- **Qualification (dead lives) = SQL-expressible and exact:** `deathCause = 'pvp' OR playtimeSeconds >= 300 OR EXISTS(a kill by this gamertag in [startedAt, endedAt])`. `QUALIFY_SECONDS = 300`.
- **Qualification (alive lives) has one documented approximation:** the stored `lives.playtimeSeconds` excludes the current open session, so an alive life still in its first continuous session that has neither scored a kill nor accumulated ≥300s of *closed*-session playtime is not yet counted in `getFreshSpawns` (it appears once it disconnects past 5 min or scores a kill). Acceptable for groundwork; note it in a code comment.
- **Test commands:** web = `pnpm --filter @onelife/web test` (script is `vitest run`; a single file: `pnpm --filter @onelife/web test -- <path>`). read-models/api DB suites need `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test`; run one package with `TEST_DATABASE_URL=... pnpm --filter @onelife/read-models test`. Full gate: `pnpm turbo run test --concurrency=1` + `pnpm turbo run typecheck`.
- **Fastify serializes `Date` to ISO strings** in responses — web types use `string` for date fields.
- CHANGELOG.md + CLAUDE.md updates are the finish step (finishing-a-feature), **not** plan tasks.

---

### Task 1: `getLifeTimeline` read-model + per-life route extension

Composes the per-life data the timeline needs (kills + qualification timing are currently missing) and has the existing route return it plus display fields.

**Files:**
- Create: `packages/read-models/src/life-timeline.ts`
- Modify: `packages/read-models/src/index.ts` (add barrel export)
- Modify: `apps/api/src/routes/player-aggregate.ts:34-37` (route body)
- Test: `packages/read-models/test/life-timeline.test.ts`
- Test: `apps/api/test/player-aggregate-routes.test.ts` (add a timeline case — read this file first for its existing fixtures)

**Interfaces:**
- Consumes: `getLifeDetail(db, serverId, lifeId) → { life, sessions } | null`, `getLifeKills(db, serverId, killerGamertag, startedAt, endedAt) → PlayerKill[]`, `getLifeCharacter(db, serverId, gamertag, startedAt, endedAt) → LifeCharacter | null`, `lifeQualifiedAt(input) → { at: Date; by: "playtime"|"kill"|"pvp-death" } | null`, `QUALIFY_SECONDS`. `players.lastSeenAt` column exists.
- Produces: `getLifeTimeline(db, serverId, gamertag, lifeId) → LifeTimeline | null` where `LifeTimeline = { life, sessions, character: LifeCharacter | null, kills: PlayerKill[], qualifiedAt: QualifiedAt | null }`. The **route** returns `{ ...LifeTimeline, gamertag: string, map: string, slug: string }` (real-cased gamertag, map codename, map slug).

- [ ] **Step 1: Write the failing read-model test**

`packages/read-models/test/life-timeline.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, kills } from "@onelife/db";
import { inArray } from "drizzle-orm";
import { getLifeTimeline } from "../src/life-timeline.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 51e7;
const start = new Date("2026-07-14T00:00:00Z");
const mins = (m: number) => new Date(start.getTime() + m * 60_000);
let serverId: number;
let pid: number;
let deadLifeId: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "lt", map: "sakhal", slug: `lt-${svc}`, active: true }).returning();
  serverId = s!.id;
  const [p] = await db.insert(players).values({ gamertag: `LtHero-${svc}`, lastSeenAt: mins(400) }).returning();
  pid = p!.id;
  const [dl] = await db.insert(lives).values({
    serverId, playerId: pid, lifeNumber: 1, startedAt: start, endedAt: mins(360),
    deathCause: "pvp", deathByGamertag: "SomeKiller", deathWeapon: "VSD", deathDistance: 126,
    energyAtDeath: 42, waterAtDeath: 18, bleedSourcesAtDeath: 2, playtimeSeconds: 21600,
  }).returning();
  deadLifeId = dl!.id;
  await db.insert(sessions).values([
    { serverId, playerId: pid, lifeId: deadLifeId, connectedAt: start, disconnectedAt: mins(180), durationSeconds: 10800, closeReason: "disconnect" },
    { serverId, playerId: pid, lifeId: deadLifeId, connectedAt: mins(200), disconnectedAt: mins(360), durationSeconds: 9600, closeReason: "death" },
  ]);
  await db.insert(kills).values({
    serverId, killerGamertag: `LtHero-${svc}`, victimGamertag: "Victim1", weapon: "KAS-74U", distance: 25, occurredAt: mins(120),
  });
});

afterAll(async () => {
  await db.delete(kills).where(inArray(kills.serverId, [serverId]));
  await db.delete(sessions).where(inArray(sessions.serverId, [serverId]));
  await db.delete(lives).where(inArray(lives.serverId, [serverId]));
  await db.delete(players).where(inArray(players.id, [pid]));
  await db.delete(servers).where(inArray(servers.id, [serverId]));
  await sql.end();
});

describe("getLifeTimeline", () => {
  it("returns life + ordered sessions + kills + qualifiedAt", async () => {
    const t = await getLifeTimeline(db, serverId, `LtHero-${svc}`, deadLifeId);
    expect(t).not.toBeNull();
    expect(t!.life.lifeNumber).toBe(1);
    expect(t!.sessions).toHaveLength(2);
    expect(t!.kills).toHaveLength(1);
    expect(t!.kills[0]!.victimGamertag).toBe("Victim1");
    // qualified: pvp death → qualifiedAt.by is the earliest of {kill @120m, pvp-death @360m} → "kill"
    expect(t!.qualifiedAt?.by).toBe("kill");
  });

  it("returns null for an unknown life", async () => {
    expect(await getLifeTimeline(db, serverId, `LtHero-${svc}`, 9_999_999)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test -- life-timeline`
Expected: FAIL — `getLifeTimeline` is not exported / module not found.

- [ ] **Step 3: Implement the read-model**

`packages/read-models/src/life-timeline.ts`:

```ts
import type { Database } from "@onelife/db";
import { players } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getLifeDetail } from "./queries.js";
import { getLifeCharacter, type LifeCharacter } from "./character.js";
import { getLifeKills, type PlayerKill } from "./player-kills.js";
import { lifeQualifiedAt, type QualifiedAt } from "./qualified.js";

export interface LifeTimeline {
  life: NonNullable<Awaited<ReturnType<typeof getLifeDetail>>>["life"];
  sessions: NonNullable<Awaited<ReturnType<typeof getLifeDetail>>>["sessions"];
  character: LifeCharacter | null;
  kills: PlayerKill[];
  qualifiedAt: QualifiedAt | null;
}

/** Full per-life timeline data: the life row, ordered sessions, resolved character,
 *  the life's kills (newest-first), and when/why the life qualified. */
export async function getLifeTimeline(
  db: Database,
  serverId: number,
  gamertag: string,
  lifeId: number,
): Promise<LifeTimeline | null> {
  const detail = await getLifeDetail(db, serverId, lifeId);
  if (!detail) return null;
  const { life, sessions } = detail;
  const [character, kills, playerRow] = await Promise.all([
    getLifeCharacter(db, serverId, gamertag, life.startedAt, life.endedAt),
    getLifeKills(db, serverId, gamertag, life.startedAt, life.endedAt),
    db.select({ lastSeenAt: players.lastSeenAt }).from(players).where(eq(players.gamertag, gamertag)),
  ]);
  const qualifiedAt = lifeQualifiedAt({
    deathCause: life.deathCause,
    startedAt: life.startedAt,
    endedAt: life.endedAt,
    playerKills: kills.map((k) => ({ occurredAt: k.occurredAt })),
    sessions: sessions.map((s) => ({
      connectedAt: s.connectedAt,
      disconnectedAt: s.disconnectedAt,
      durationSeconds: s.durationSeconds,
    })),
    lastSeenAt: playerRow[0]?.lastSeenAt ?? null,
  });
  return { life, sessions, character, kills, qualifiedAt };
}
```

> **Note on `QualifiedAt` export:** `qualified.ts` defines `QualifiedAt = { at: Date; by: "playtime" | "kill" | "pvp-death" }`. Confirm it is `export`ed; if it is only a local type, add `export` to it in `qualified.ts` (that is the only change to that file). Likewise confirm `QualifiedAtInput` accepts `lastSeenAt: Date | null` and the `sessions`/`playerKills` slices shown above — match the real field names (`connectedAt`, `disconnectedAt`, `durationSeconds`, `occurredAt`).

- [ ] **Step 4: Add the barrel export**

In `packages/read-models/src/index.ts`, append:

```ts
export * from "./life-timeline.js";
```

- [ ] **Step 5: Run the read-model test — verify it passes**

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test -- life-timeline`
Expected: PASS (2 tests).

- [ ] **Step 6: Extend the API route**

In `apps/api/src/routes/player-aggregate.ts`: add `getLifeTimeline` to the `@onelife/read-models` import on line 4, and replace the handler body lines 34-37 (from `const detail = ...` through `return { ...detail, character };`) with:

```ts
    const data = await getLifeTimeline(db, server.id, real, match.id);
    if (!data) return reply.code(404).send({ error: "not_found" });
    return { ...data, gamertag: real, map: server.map, slug: server.slug };
```

(`getLifeDetail`/`getLifeCharacter` may remain imported if used elsewhere; if this route was their only consumer, drop them from the import to avoid unused-import lint.) `server` is the row from `resolveServerBySlug` — it has `.map` (codename) and `.slug`.

- [ ] **Step 7: Add the route test**

Read `apps/api/test/player-aggregate-routes.test.ts` first for its fixture setup, then add inside its describe block (adapt fixture names to that file's variables):

```ts
  it("GET /players/:gamertag/:map/lives/:n returns timeline data with display fields", async () => {
    // uses this file's existing seeded gamertag/slug/life — adapt names to the fixtures above
    const res = await app.inject({ method: "GET", url: `/players/${SEEDED_SLUG}/${SEEDED_MAP_SLUG}/lives/1` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.gamertag).toBe(SEEDED_GAMERTAG);
    expect(body.map).toBeTruthy();
    expect(Array.isArray(body.kills)).toBe(true);
    expect(body).toHaveProperty("qualifiedAt");
    expect(Array.isArray(body.sessions)).toBe(true);
  });
```

- [ ] **Step 8: Run the API test + typecheck**

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/api test -- player-aggregate` then `pnpm --filter @onelife/read-models typecheck && pnpm --filter @onelife/api typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/read-models/src/life-timeline.ts packages/read-models/src/index.ts packages/read-models/test/life-timeline.test.ts apps/api/src/routes/player-aggregate.ts apps/api/test/player-aggregate-routes.test.ts packages/read-models/src/qualified.ts
git commit -m "feat(r4): getLifeTimeline read-model + per-life route returns kills/qualifiedAt/display fields"
```

---

### Task 2: `getObituaries` read-model + `GET /obituaries` route

Recent qualified **deaths**, paginated, newest death first. Pure R5 groundwork — no UI.

**Files:**
- Create: `packages/read-models/src/qualified-lives.ts` (shared SQL predicate)
- Create: `packages/read-models/src/obituaries.ts`
- Modify: `packages/read-models/src/index.ts`
- Create: `apps/api/src/routes/obituaries.ts`
- Modify: `apps/api/src/app.ts` (register the route — read it first for the pattern)
- Test: `packages/read-models/test/obituaries.test.ts`
- Test: `apps/api/test/obituaries.test.ts`

**Interfaces:**
- Consumes: `lives`, `players`, `servers`, `kills` tables; `QUALIFY_SECONDS`.
- Produces: `qualifiedLifeCondition(db)` (a Drizzle `SQL` condition, correlated on `lives`/`players`); `getObituaries(db, { page, pageSize? }) → ObituariesPage`; `OBITUARIES_PAGE_SIZE = 20`. `ObituariesPage = { rows: Obituary[]; total; page; pageSize }`, `Obituary = { gamertag; map; slug; lifeNumber; cause; byGamertag; weapon; distanceMeters; timeAliveSeconds; endedAt: Date }`.

- [ ] **Step 1: Write the failing read-model test**

`packages/read-models/test/obituaries.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, kills } from "@onelife/db";
import { inArray } from "drizzle-orm";
import { getObituaries } from "../src/obituaries.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 52e7;
const t0 = new Date("2026-07-10T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
let serverId: number;
const pids: number[] = [];

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "ob", map: "chernarusplus", slug: `ob-${svc}`, active: true }).returning();
  serverId = s!.id;
  const mk = async (tag: string) => {
    const [p] = await db.insert(players).values({ gamertag: tag, lastSeenAt: hrs(100) }).returning();
    pids.push(p!.id);
    return p!.id;
  };
  const pvp = await mk(`ob-pvp-${svc}`);      // qualified: pvp death
  const long = await mk(`ob-long-${svc}`);    // qualified: 5min+ playtime
  const short = await mk(`ob-short-${svc}`);  // NOT qualified: 60s, environment death, no kills
  await db.insert(lives).values([
    { serverId, playerId: pvp, lifeNumber: 1, startedAt: hrs(1), endedAt: hrs(2), deathCause: "pvp", deathByGamertag: "Killer", deathWeapon: "M4", deathDistance: 90, playtimeSeconds: 200, energyAtDeath: null, waterAtDeath: null, bleedSourcesAtDeath: null },
    { serverId, playerId: long, lifeNumber: 1, startedAt: hrs(3), endedAt: hrs(4), deathCause: "bled_out", deathByGamertag: null, deathWeapon: null, deathDistance: null, playtimeSeconds: 3600, energyAtDeath: null, waterAtDeath: null, bleedSourcesAtDeath: null },
    { serverId, playerId: short, lifeNumber: 1, startedAt: hrs(5), endedAt: hrs(5.1), deathCause: "environment", deathByGamertag: null, deathWeapon: null, deathDistance: null, playtimeSeconds: 60, energyAtDeath: null, waterAtDeath: null, bleedSourcesAtDeath: null },
  ]);
});

afterAll(async () => {
  await db.delete(kills).where(inArray(kills.serverId, [serverId]));
  await db.delete(sessions).where(inArray(sessions.serverId, [serverId]));
  await db.delete(lives).where(inArray(lives.serverId, [serverId]));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(inArray(servers.id, [serverId]));
  await sql.end();
});

describe("getObituaries", () => {
  it("returns only qualified dead lives, newest death first", async () => {
    const res = await getObituaries(db, { page: 1, pageSize: 50 });
    const mine = res.rows.filter((r) => r.slug === `ob-${svc}`);
    expect(mine.map((r) => r.gamertag)).toEqual([`ob-long-${svc}`, `ob-pvp-${svc}`]); // long died @4h > pvp @2h; short excluded
    expect(mine[1]!.cause).toBe("pvp");
    expect(mine[1]!.byGamertag).toBe("Killer");
  });

  it("paginates", async () => {
    const res = await getObituaries(db, { page: 1, pageSize: 1 });
    expect(res.pageSize).toBe(1);
    expect(res.rows).toHaveLength(1);
    expect(res.total).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test -- obituaries`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the shared qualified-life predicate**

`packages/read-models/src/qualified-lives.ts`:

```ts
import type { Database } from "@onelife/db";
import { lives, players, kills } from "@onelife/db";
import { and, or, eq, gte, lte, isNull, exists, sql, type SQL } from "drizzle-orm";
import { QUALIFY_SECONDS } from "./qualified.js";

/**
 * A life counts (is "qualified") when it was killed by a player, survived >= 5 min of
 * accumulated (closed-session) playtime, or scored a kill during its window.
 * Correlated on the outer `lives`/`players` rows — the caller must join `players` (by
 * `players.id = lives.playerId`). Exact for dead lives. For alive lives the playtime term
 * uses stored `lives.playtimeSeconds`, which excludes the current open session (documented
 * approximation — see the plan's Global Constraints).
 */
export function qualifiedLifeCondition(db: Database): SQL {
  return or(
    eq(lives.deathCause, "pvp"),
    gte(lives.playtimeSeconds, QUALIFY_SECONDS),
    exists(
      db
        .select({ x: sql`1` })
        .from(kills)
        .where(
          and(
            eq(kills.serverId, lives.serverId),
            eq(kills.killerGamertag, players.gamertag),
            gte(kills.occurredAt, lives.startedAt),
            or(isNull(lives.endedAt), lte(kills.occurredAt, lives.endedAt)),
          ),
        ),
    ),
  )!;
}
```

- [ ] **Step 4: Implement the obituaries read-model**

`packages/read-models/src/obituaries.ts`:

```ts
import type { Database } from "@onelife/db";
import { lives, players, servers } from "@onelife/db";
import { and, eq, desc, isNotNull, sql } from "drizzle-orm";
import { qualifiedLifeCondition } from "./qualified-lives.js";

export const OBITUARIES_PAGE_SIZE = 20;

export interface Obituary {
  gamertag: string;
  map: string;
  slug: string;
  lifeNumber: number;
  cause: string | null;
  byGamertag: string | null;
  weapon: string | null;
  distanceMeters: number | null;
  timeAliveSeconds: number;
  endedAt: Date;
}

export interface ObituariesPage {
  rows: Obituary[];
  total: number;
  page: number;
  pageSize: number;
}

/** Recent qualified deaths, newest first. Paginated. */
export async function getObituaries(
  db: Database,
  opts: { page: number; pageSize?: number },
): Promise<ObituariesPage> {
  const pageSize = opts.pageSize ?? OBITUARIES_PAGE_SIZE;
  const page = Math.max(1, Math.trunc(opts.page) || 1);
  const where = and(isNotNull(lives.endedAt), qualifiedLifeCondition(db));

  const rows = await db
    .select({
      gamertag: players.gamertag,
      map: servers.map,
      slug: servers.slug,
      lifeNumber: lives.lifeNumber,
      cause: lives.deathCause,
      byGamertag: lives.deathByGamertag,
      weapon: lives.deathWeapon,
      distanceMeters: lives.deathDistance,
      timeAliveSeconds: lives.playtimeSeconds,
      endedAt: lives.endedAt,
    })
    .from(lives)
    .innerJoin(players, eq(players.id, lives.playerId))
    .innerJoin(servers, eq(servers.id, lives.serverId))
    .where(where)
    .orderBy(desc(lives.endedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const totalRow = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(lives)
    .innerJoin(players, eq(players.id, lives.playerId))
    .innerJoin(servers, eq(servers.id, lives.serverId))
    .where(where);

  return {
    rows: rows.map((r) => ({ ...r, endedAt: r.endedAt! })),
    total: totalRow[0]?.c ?? 0,
    page,
    pageSize,
  };
}
```

- [ ] **Step 5: Barrel exports + run the test**

In `packages/read-models/src/index.ts` append:

```ts
export * from "./qualified-lives.js";
export * from "./obituaries.js";
```

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test -- obituaries`
Expected: PASS (2 tests).

- [ ] **Step 6: Add the API route + register it**

`apps/api/src/routes/obituaries.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import { z } from "zod";
import { getObituaries } from "@onelife/read-models";

const query = z.object({ page: z.coerce.number().int().positive().catch(1) });

export function registerObituariesRoutes(app: FastifyInstance, db: Database): void {
  app.get("/obituaries", async (req) => {
    const { page } = query.parse(req.query);
    return getObituaries(db, { page });
  });
}
```

Read `apps/api/src/app.ts`, then wire it in exactly like the sibling `register*Routes(app, db)` calls (import `registerObituariesRoutes` from `./routes/obituaries.js`, call it inside `buildApp` next to `registerSurvivorsRoutes`).

- [ ] **Step 7: Add the API route test**

`apps/api/test/obituaries.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { buildApp } from "../src/app.js";

const { db } = getTestDb();
const app = buildApp(db);

describe("GET /obituaries", () => {
  it("returns an ObituariesPage with defaults", async () => {
    const res = await app.inject({ method: "GET", url: "/obituaries" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ page: 1, pageSize: 20 });
    expect(Array.isArray(body.rows)).toBe(true);
    expect(typeof body.total).toBe("number");
  });

  it("coerces invalid page to 1 (no 500)", async () => {
    const res = await app.inject({ method: "GET", url: "/obituaries?page=-3" });
    expect(res.statusCode).toBe(200);
    expect(res.json().page).toBe(1);
  });
});
```

- [ ] **Step 8: Run tests + typecheck**

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/api test -- obituaries` then `pnpm --filter @onelife/read-models typecheck && pnpm --filter @onelife/api typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/read-models/src/qualified-lives.ts packages/read-models/src/obituaries.ts packages/read-models/src/index.ts packages/read-models/test/obituaries.test.ts apps/api/src/routes/obituaries.ts apps/api/src/app.ts apps/api/test/obituaries.test.ts
git commit -m "feat(r4): getObituaries read-model + GET /obituaries route (R5 groundwork)"
```

---

### Task 3: `getFreshSpawns` read-model + `GET /fresh-spawns` route

Recent qualified **births** (alive or dead), newest birth first, with per-row `qualifiedAt` enriched on the page slice only. Pure R5 groundwork — no UI.

**Files:**
- Create: `packages/read-models/src/fresh-spawns.ts`
- Modify: `packages/read-models/src/index.ts`
- Create: `apps/api/src/routes/fresh-spawns.ts`
- Modify: `apps/api/src/app.ts`
- Test: `packages/read-models/test/fresh-spawns.test.ts`
- Test: `apps/api/test/fresh-spawns.test.ts`

**Interfaces:**
- Consumes: `qualifiedLifeCondition(db)` (Task 2), `getLifeKills`, `lifeQualifiedAt`, `sessions` table.
- Produces: `getFreshSpawns(db, { page, pageSize? }) → FreshSpawnsPage`; `FRESH_SPAWNS_PAGE_SIZE = 20`. `FreshSpawn = { gamertag; map; slug; lifeNumber; startedAt: Date; qualifiedAt: Date | null }`.

- [ ] **Step 1: Write the failing read-model test**

`packages/read-models/test/fresh-spawns.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, kills } from "@onelife/db";
import { inArray } from "drizzle-orm";
import { getFreshSpawns } from "../src/fresh-spawns.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 53e7;
const t0 = new Date("2026-07-11T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
let serverId: number;
const pids: number[] = [];

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "fs", map: "sakhal", slug: `fs-${svc}`, active: true }).returning();
  serverId = s!.id;
  const mk = async (tag: string) => {
    const [p] = await db.insert(players).values({ gamertag: tag, lastSeenAt: hrs(100) }).returning();
    pids.push(p!.id);
    return p!.id;
  };
  const early = await mk(`fs-early-${svc}`);  // born @1h, qualified (playtime)
  const late = await mk(`fs-late-${svc}`);    // born @6h, qualified (playtime)
  const short = await mk(`fs-short-${svc}`);  // born @3h, NOT qualified
  await db.insert(lives).values([
    { serverId, playerId: early, lifeNumber: 1, startedAt: hrs(1), endedAt: hrs(2), deathCause: "bled_out", playtimeSeconds: 3600 },
    { serverId, playerId: late, lifeNumber: 1, startedAt: hrs(6), endedAt: null, deathCause: null, playtimeSeconds: 1800 },
    { serverId, playerId: short, lifeNumber: 1, startedAt: hrs(3), endedAt: hrs(3.05), deathCause: "environment", playtimeSeconds: 30 },
  ]);
  await db.insert(sessions).values([
    { serverId, playerId: early, lifeId: (await lifeId(early)), connectedAt: hrs(1), disconnectedAt: hrs(2), durationSeconds: 3600, closeReason: "death" },
  ]);
  async function lifeId(pid: number) {
    const r = await db.select({ id: lives.id }).from(lives).where(inArray(lives.playerId, [pid]));
    return r[0]!.id;
  }
});

afterAll(async () => {
  await db.delete(kills).where(inArray(kills.serverId, [serverId]));
  await db.delete(sessions).where(inArray(sessions.serverId, [serverId]));
  await db.delete(lives).where(inArray(lives.serverId, [serverId]));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(inArray(servers.id, [serverId]));
  await sql.end();
});

describe("getFreshSpawns", () => {
  it("returns only qualified lives, newest birth first", async () => {
    const res = await getFreshSpawns(db, { page: 1, pageSize: 50 });
    const mine = res.rows.filter((r) => r.slug === `fs-${svc}`);
    expect(mine.map((r) => r.gamertag)).toEqual([`fs-late-${svc}`, `fs-early-${svc}`]); // late born @6h > early @1h; short excluded
  });

  it("enriches qualifiedAt on the page slice", async () => {
    const res = await getFreshSpawns(db, { page: 1, pageSize: 50 });
    const early = res.rows.find((r) => r.gamertag === `fs-early-${svc}`);
    expect(early?.qualifiedAt).toBeInstanceOf(Date); // qualified by 5min playtime
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test -- fresh-spawns`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the fresh-spawns read-model**

`packages/read-models/src/fresh-spawns.ts`:

```ts
import type { Database } from "@onelife/db";
import { lives, players, servers, sessions } from "@onelife/db";
import { and, eq, desc, sql } from "drizzle-orm";
import { qualifiedLifeCondition } from "./qualified-lives.js";
import { getLifeKills } from "./player-kills.js";
import { lifeQualifiedAt } from "./qualified.js";

export const FRESH_SPAWNS_PAGE_SIZE = 20;

export interface FreshSpawn {
  gamertag: string;
  map: string;
  slug: string;
  lifeNumber: number;
  startedAt: Date;
  qualifiedAt: Date | null;
}

export interface FreshSpawnsPage {
  rows: FreshSpawn[];
  total: number;
  page: number;
  pageSize: number;
}

/** Recent qualified births (alive or dead), newest birth first. `qualifiedAt` is computed
 *  for the returned page slice only (O(pageSize) extra queries), mirroring getPlayerPage. */
export async function getFreshSpawns(
  db: Database,
  opts: { page: number; pageSize?: number },
): Promise<FreshSpawnsPage> {
  const pageSize = opts.pageSize ?? FRESH_SPAWNS_PAGE_SIZE;
  const page = Math.max(1, Math.trunc(opts.page) || 1);
  const where = qualifiedLifeCondition(db);

  const rows = await db
    .select({
      lifeId: lives.id,
      serverId: lives.serverId,
      gamertag: players.gamertag,
      map: servers.map,
      slug: servers.slug,
      lifeNumber: lives.lifeNumber,
      startedAt: lives.startedAt,
      endedAt: lives.endedAt,
      deathCause: lives.deathCause,
      lastSeenAt: players.lastSeenAt,
    })
    .from(lives)
    .innerJoin(players, eq(players.id, lives.playerId))
    .innerJoin(servers, eq(servers.id, lives.serverId))
    .where(where)
    .orderBy(desc(lives.startedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const totalRow = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(lives)
    .innerJoin(players, eq(players.id, lives.playerId))
    .innerJoin(servers, eq(servers.id, lives.serverId))
    .where(where);

  const enriched: FreshSpawn[] = [];
  for (const r of rows) {
    const kills = await getLifeKills(db, r.serverId, r.gamertag, r.startedAt, r.endedAt);
    const sess = await db
      .select({ connectedAt: sessions.connectedAt, disconnectedAt: sessions.disconnectedAt, durationSeconds: sessions.durationSeconds })
      .from(sessions)
      .where(and(eq(sessions.serverId, r.serverId), eq(sessions.lifeId, r.lifeId)));
    const q = lifeQualifiedAt({
      deathCause: r.deathCause,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      playerKills: kills.map((k) => ({ occurredAt: k.occurredAt })),
      sessions: sess,
      lastSeenAt: r.lastSeenAt,
    });
    enriched.push({
      gamertag: r.gamertag,
      map: r.map,
      slug: r.slug,
      lifeNumber: r.lifeNumber,
      startedAt: r.startedAt,
      qualifiedAt: q?.at ?? null,
    });
  }

  return { rows: enriched, total: totalRow[0]?.c ?? 0, page, pageSize };
}
```

- [ ] **Step 4: Barrel export + run the test**

In `packages/read-models/src/index.ts` append:

```ts
export * from "./fresh-spawns.js";
```

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test -- fresh-spawns`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the API route + register it**

`apps/api/src/routes/fresh-spawns.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import { z } from "zod";
import { getFreshSpawns } from "@onelife/read-models";

const query = z.object({ page: z.coerce.number().int().positive().catch(1) });

export function registerFreshSpawnsRoutes(app: FastifyInstance, db: Database): void {
  app.get("/fresh-spawns", async (req) => {
    const { page } = query.parse(req.query);
    return getFreshSpawns(db, { page });
  });
}
```

Wire it into `apps/api/src/app.ts` next to the obituaries registration.

- [ ] **Step 6: Add the API route test**

`apps/api/test/fresh-spawns.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { buildApp } from "../src/app.js";

const { db } = getTestDb();
const app = buildApp(db);

describe("GET /fresh-spawns", () => {
  it("returns a FreshSpawnsPage with defaults", async () => {
    const res = await app.inject({ method: "GET", url: "/fresh-spawns" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ page: 1, pageSize: 20 });
    expect(Array.isArray(body.rows)).toBe(true);
  });

  it("coerces invalid page to 1 (no 500)", async () => {
    const res = await app.inject({ method: "GET", url: "/fresh-spawns?page=oops" });
    expect(res.statusCode).toBe(200);
    expect(res.json().page).toBe(1);
  });
});
```

- [ ] **Step 7: Run tests + typecheck**

Run: `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/api test -- fresh-spawns` then `pnpm --filter @onelife/read-models typecheck && pnpm --filter @onelife/api typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/read-models/src/fresh-spawns.ts packages/read-models/src/index.ts packages/read-models/test/fresh-spawns.test.ts apps/api/src/routes/fresh-spawns.ts apps/api/src/app.ts apps/api/test/fresh-spawns.test.ts
git commit -m "feat(r4): getFreshSpawns read-model + GET /fresh-spawns route (R5 groundwork)"
```

---

### Task 4: Web types, `getPlayerLife` client, `lifeHref` helper

Foundation the web timeline consumes. Adds the per-life response type, the fetch client, the death-vitals fields on `Life`, and the pure `lifeHref` used by cards + the timeline.

**Files:**
- Modify: `apps/web/src/lib/types.ts` (extend `Life`; add `LifeCharacterDto`, `QualifiedAtDto`, `LifeTimelineData`)
- Modify: `apps/web/src/lib/api.ts` (add `getPlayerLife`)
- Create: `apps/web/src/lib/life-href.ts`
- Test: `apps/web/src/lib/life-href.test.ts`

**Interfaces:**
- Consumes: `playerSlug` (`@/lib/slug`), `getOrNull` (`@/lib/api`), `PlayerKill`/`Life`/`Session` (`@/lib/types`).
- Produces: `LifeTimelineData` type; `getPlayerLife(slug, map, n) → Promise<LifeTimelineData | null>`; `lifeHref(gamertag, mapSlug, lifeNumber) → string`.

- [ ] **Step 1: Write the failing `lifeHref` test**

`apps/web/src/lib/life-href.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { lifeHref } from "./life-href";

describe("lifeHref", () => {
  test("slugs the gamertag and builds the per-life path", () => {
    expect(lifeHref("YrJustBad", "sakhal", 3)).toBe("/players/yrjustbad/sakhal/lives/3");
  });
  test("encodes the map slug and slugs mixed-case gamertags", () => {
    expect(lifeHref("Boots Coldwater", "chernarus", 1)).toBe("/players/boots-coldwater/chernarus/lives/1");
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @onelife/web test -- life-href`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lifeHref`**

`apps/web/src/lib/life-href.ts`:

```ts
import { playerSlug } from "./slug";

/** Pure href builder for a single life's timeline page. */
export function lifeHref(gamertag: string, mapSlug: string, lifeNumber: number): string {
  return `/players/${playerSlug(gamertag)}/${encodeURIComponent(mapSlug)}/lives/${lifeNumber}`;
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @onelife/web test -- life-href`
Expected: PASS (2 tests).

- [ ] **Step 5: Extend web types**

In `apps/web/src/lib/types.ts`, add the three death-vitals fields to the `Life` type (after `deathDistance`, before `playtimeSeconds`):

```ts
  deathDistance: number | null;
  energyAtDeath: number | null;
  waterAtDeath: number | null;
  bleedSourcesAtDeath: number | null;
  playtimeSeconds: number;
```

Then add, near the other player types:

```ts
export type LifeCharacterDto = { charId: number; characterClass: string | null; name: string | null; gender: string | null; sightings: number; confidence: "exact" | "ambiguous" };
export type QualifiedAtDto = { at: string; by: "playtime" | "kill" | "pvp-death" };
export type LifeTimelineData = {
  life: Life;
  sessions: Session[];
  character: LifeCharacterDto | null;
  kills: PlayerKill[];
  qualifiedAt: QualifiedAtDto | null;
  gamertag: string;
  map: string;
  slug: string;
};
```

- [ ] **Step 6: Add the API client**

In `apps/web/src/lib/api.ts`, add `LifeTimelineData` to the type import from `./types`, then add:

```ts
export const getPlayerLife = (slug: string, map: string, n: number) =>
  getOrNull<LifeTimelineData>(`/api/players/${encodeURIComponent(slug)}/${encodeURIComponent(map)}/lives/${n}`);
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @onelife/web typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/types.ts apps/web/src/lib/api.ts apps/web/src/lib/life-href.ts apps/web/src/lib/life-href.test.ts
git commit -m "feat(r4): web LifeTimelineData type, getPlayerLife client, lifeHref helper"
```

---

### Task 5: `buildTimeline` pure helper

The core logic: turn `LifeTimelineData` into an ordered (newest-first), grouped, factually-captioned event list plus hero stats. Pure and heavily unit-tested.

**Files:**
- Create: `apps/web/src/lib/life-timeline.ts`
- Test: `apps/web/src/lib/life-timeline.test.ts`

**Interfaces:**
- Consumes: `LifeTimelineData`, `PlayerKill` (`@/lib/types`); `formatDuration` (`@/components/player/format`).
- Produces: `buildTimeline(data, now) → LifeTimelineView`; types `TimelineEvent` (discriminated on `kind`), `LifeTimelineView = { alive: boolean; events: TimelineEvent[]; hero: { timeAliveSeconds; kills; longestKillMeters; sessions; qualified } }`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/life-timeline.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { buildTimeline } from "./life-timeline";
import type { LifeTimelineData } from "./types";

const start = "2026-07-14T00:00:00Z";
const at = (mins: number) => new Date(Date.parse(start) + mins * 60_000).toISOString();

function data(over: Partial<LifeTimelineData> = {}): LifeTimelineData {
  return {
    gamertag: "YrJustBad",
    map: "sakhal",
    slug: "sakhal",
    life: {
      id: 1, serverId: 1, playerId: 1, lifeNumber: 4,
      startedAt: start, endedAt: null,
      deathCause: null, deathByGamertag: null, deathWeapon: null, deathDistance: null,
      energyAtDeath: null, waterAtDeath: null, bleedSourcesAtDeath: null,
      playtimeSeconds: 0,
    },
    sessions: [
      { id: 1, serverId: 1, playerId: 1, lifeId: 1, connectedAt: at(0), disconnectedAt: at(120), durationSeconds: 7200, closeReason: "d" },
      { id: 2, serverId: 1, playerId: 1, lifeId: 1, connectedAt: at(200), disconnectedAt: at(300), durationSeconds: 6000, closeReason: "d" },
      { id: 3, serverId: 1, playerId: 1, lifeId: 1, connectedAt: at(400), disconnectedAt: null, durationSeconds: null, closeReason: null },
    ],
    kills: [
      { victimGamertag: "Twhizzle4life", weapon: "KAS-74U", distanceMeters: 25, occurredAt: at(430) },
      { victimGamertag: "Tomahawked11", weapon: "VSS", distanceMeters: 5, occurredAt: at(90) },
    ],
    qualifiedAt: { at: at(5), by: "playtime" },
    ...over,
  };
}

describe("buildTimeline", () => {
  test("alive life: newest-first, NOW row first, birth last", () => {
    const now = new Date(Date.parse(start) + 500 * 60_000);
    const v = buildTimeline(data(), now);
    expect(v.alive).toBe(true);
    expect(v.events[0]!.kind).toBe("now");
    expect(v.events[v.events.length - 1]!.kind).toBe("birth");
  });

  test("groups quiet consecutive sessions (no kill inside) into a session-group", () => {
    // sessions 2 (200-300) has no kill; but it's a single quiet run of length 1 -> stays "session"
    // make sessions 2 & 3 both quiet by removing kills to force a group
    const now = new Date(Date.parse(start) + 500 * 60_000);
    const v = buildTimeline(data({ kills: [] }), now);
    const group = v.events.find((e) => e.kind === "session-group");
    expect(group).toBeTruthy();
    expect(group && "title" in group ? group.title : "").toBe("Sessions 2–3");
  });

  test("session containing a kill stays its own row", () => {
    const now = new Date(Date.parse(start) + 500 * 60_000);
    const v = buildTimeline(data(), now); // session 3 (400-now) contains kill @430
    const s3 = v.events.find((e) => e.kind === "session" && "title" in e && e.title === "Session 3 began");
    expect(s3).toBeTruthy();
  });

  test("marks the max-distance kill as the longest (tie -> earliest)", () => {
    const now = new Date(Date.parse(start) + 500 * 60_000);
    const v = buildTimeline(data(), now);
    const longest = v.events.filter((e) => e.kind === "kill" && e.longestKill);
    expect(longest).toHaveLength(1);
    expect(longest[0] && "victimGamertag" in longest[0] ? longest[0].victimGamertag : "").toBe("Twhizzle4life"); // 25m > 5m
  });

  test("hero stats: kills, longest, sessions, qualified true", () => {
    const now = new Date(Date.parse(start) + 500 * 60_000);
    const v = buildTimeline(data(), now);
    expect(v.hero.kills).toBe(2);
    expect(v.hero.longestKillMeters).toBe(25);
    expect(v.hero.sessions).toBe(3);
    expect(v.hero.qualified).toBe(true);
  });

  test("dead life: death row (not now), vitals line, no qualified row when qualifiedAt null", () => {
    const now = new Date(Date.parse(start) + 400 * 60_000);
    const v = buildTimeline(
      data({
        qualifiedAt: null,
        life: {
          ...data().life, endedAt: at(360), deathCause: "pvp", deathByGamertag: "SomeKiller",
          deathWeapon: "VSD", deathDistance: 126, energyAtDeath: 42, waterAtDeath: 18, bleedSourcesAtDeath: 2,
          playtimeSeconds: 21600,
        },
      }),
      now,
    );
    expect(v.alive).toBe(false);
    expect(v.events.some((e) => e.kind === "now")).toBe(false);
    const death = v.events.find((e) => e.kind === "death");
    expect(death && "vitals" in death ? death.vitals : "").toBe("Energy 42 · Water 18 · bleeding ×2");
    expect(v.events.some((e) => e.kind === "qualified")).toBe(false);
    expect(v.hero.qualified).toBe(false);
  });

  test("qualified caption reflects the reason", () => {
    const now = new Date(Date.parse(start) + 500 * 60_000);
    const v = buildTimeline(data({ qualifiedAt: { at: at(120), by: "kill" } }), now);
    const q = v.events.find((e) => e.kind === "qualified");
    expect(q && "line" in q ? q.line : "").toMatch(/first blood/i);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @onelife/web test -- life-timeline`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `buildTimeline`**

`apps/web/src/lib/life-timeline.ts`:

```ts
import type { LifeTimelineData, PlayerKill, Session } from "./types";
import { formatDuration } from "@/components/player/format";

export type Marker = "blue" | "red" | "gray" | "yellow";

export type TimelineEvent =
  | { kind: "now"; at: Date; marker: "blue"; timeLabel: "NOW"; title: string; line: string }
  | { kind: "death"; at: Date; marker: "red"; timeLabel: string; cause: string | null; byGamertag: string | null; weapon: string | null; distanceMeters: number | null; vitals: string | null }
  | { kind: "kill"; at: Date; marker: "red"; timeLabel: string; victimGamertag: string; weapon: string | null; distanceMeters: number | null; longestKill: boolean }
  | { kind: "session"; at: Date; marker: "gray"; timeLabel: string; title: string; line: string }
  | { kind: "session-group"; at: Date; marker: "gray"; timeLabel: string; title: string; line: string }
  | { kind: "qualified"; at: Date; marker: "blue"; timeLabel: string; title: string; line: string }
  | { kind: "birth"; at: Date; marker: "gray"; timeLabel: string; title: string; line: string };

export interface LifeTimelineView {
  alive: boolean;
  events: TimelineEvent[];
  hero: { timeAliveSeconds: number; kills: number; longestKillMeters: number | null; sessions: number; qualified: boolean };
}

function elapsedLabel(at: Date, startedAt: Date): string {
  const sec = Math.max(0, Math.floor((at.getTime() - startedAt.getTime()) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function connMs(s: Session): number {
  return Date.parse(s.connectedAt);
}
function endMs(s: Session, now: Date): number {
  return s.disconnectedAt ? Date.parse(s.disconnectedAt) : now.getTime();
}

function liveTimeAlive(sessions: Session[], now: Date): number {
  return sessions.reduce((acc, s) => {
    const conn = connMs(s);
    if (s.disconnectedAt) return acc + (s.durationSeconds ?? Math.max(0, Math.floor((Date.parse(s.disconnectedAt) - conn) / 1000)));
    return acc + Math.max(0, Math.floor((now.getTime() - conn) / 1000));
  }, 0);
}

function longestOf<T extends { distanceMeters: number | null; at: Date }>(kills: T[]): T | null {
  let best: T | null = null;
  for (const k of kills) {
    if (k.distanceMeters == null) continue;
    if (best === null || k.distanceMeters > best.distanceMeters! || (k.distanceMeters === best.distanceMeters && k.at.getTime() < best.at.getTime())) {
      best = k;
    }
  }
  return best;
}

function qualifiedLine(by: "playtime" | "kill" | "pvp-death"): string {
  if (by === "kill") return "First blood drawn. The life counts from here.";
  if (by === "pvp-death") return "Qualified at the moment of death — killed by a player.";
  return "Five minutes survived. The grace period ends; from here, death counts.";
}

function vitalsLine(life: LifeTimelineData["life"]): string | null {
  const parts: string[] = [];
  if (life.energyAtDeath != null) parts.push(`Energy ${Math.round(life.energyAtDeath)}`);
  if (life.waterAtDeath != null) parts.push(`Water ${Math.round(life.waterAtDeath)}`);
  if (life.bleedSourcesAtDeath != null && life.bleedSourcesAtDeath > 0) parts.push(`bleeding ×${life.bleedSourcesAtDeath}`);
  return parts.length ? parts.join(" · ") : null;
}

/** Pure: LifeTimelineData -> ordered (newest-first) captioned event list + hero stats. */
export function buildTimeline(data: LifeTimelineData, now: Date): LifeTimelineView {
  const startedAt = new Date(data.life.startedAt);
  const endedAt = data.life.endedAt ? new Date(data.life.endedAt) : null;
  const alive = endedAt === null;
  const label = (at: Date) => `${elapsedLabel(at, startedAt)} IN`;

  const killObjs = data.kills.map((k: PlayerKill) => ({ ...k, at: new Date(k.occurredAt) }));
  const longest = longestOf(killObjs);
  const timeAlive = alive ? liveTimeAlive(data.sessions, now) : data.life.playtimeSeconds;

  const events: TimelineEvent[] = [];

  // Birth (oldest)
  events.push({ kind: "birth", at: startedAt, marker: "gray", timeLabel: "00:00", title: "Washed ashore — life begins", line: "Session 1. Grace period active." });

  // Qualified
  if (data.qualifiedAt) {
    const qAt = new Date(data.qualifiedAt.at);
    events.push({ kind: "qualified", at: qAt, marker: "blue", timeLabel: label(qAt), title: "Life qualified", line: qualifiedLine(data.qualifiedAt.by) });
  }

  // Sessions (skip session 1 = birth); group quiet consecutive runs
  const ordered = [...data.sessions].sort((a, b) => connMs(a) - connMs(b));
  const killMs = killObjs.map((k) => k.at.getTime());
  const hasKill = (s: Session) => killMs.some((t) => t >= connMs(s) && t <= endMs(s, now));
  let i = 1;
  while (i < ordered.length) {
    if (!hasKill(ordered[i]!)) {
      let j = i;
      while (j < ordered.length && !hasKill(ordered[j]!)) j++;
      if (j - i >= 2) {
        const first = ordered[i]!;
        events.push({ kind: "session-group", at: new Date(connMs(first)), marker: "gray", timeLabel: label(new Date(connMs(first))), title: `Sessions ${i + 1}–${j}`, line: `${j - i} logins` });
      } else {
        const s = ordered[i]!;
        events.push({ kind: "session", at: new Date(connMs(s)), marker: "gray", timeLabel: label(new Date(connMs(s))), title: `Session ${i + 1} began`, line: "Logged in." });
      }
      i = j;
    } else {
      const s = ordered[i]!;
      events.push({ kind: "session", at: new Date(connMs(s)), marker: "gray", timeLabel: label(new Date(connMs(s))), title: `Session ${i + 1} began`, line: "Logged in." });
      i++;
    }
  }

  // Kills
  for (const k of killObjs) {
    events.push({ kind: "kill", at: k.at, marker: "red", timeLabel: label(k.at), victimGamertag: k.victimGamertag, weapon: k.weapon, distanceMeters: k.distanceMeters, longestKill: longest !== null && k === longest });
  }

  // Terminal: now (alive) or death (dead)
  if (alive) {
    events.push({ kind: "now", at: now, marker: "blue", timeLabel: "NOW", title: "Still drawing breath", line: `${formatDuration(timeAlive)} and counting` });
  } else {
    events.push({ kind: "death", at: endedAt, marker: "red", timeLabel: label(endedAt), cause: data.life.deathCause, byGamertag: data.life.deathByGamertag, weapon: data.life.deathWeapon, distanceMeters: data.life.deathDistance, vitals: vitalsLine(data.life) });
  }

  // Newest-first
  events.sort((a, b) => b.at.getTime() - a.at.getTime());

  return {
    alive,
    events,
    hero: { timeAliveSeconds: timeAlive, kills: killObjs.length, longestKillMeters: longest?.distanceMeters ?? null, sessions: data.sessions.length, qualified: data.qualifiedAt !== null },
  };
}
```

> Note: the `longestKill` reference-equality check compares against the `killObjs` array elements (same objects pushed as events), so `k === longest` holds.

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @onelife/web test -- life-timeline`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/life-timeline.ts apps/web/src/lib/life-timeline.test.ts
git commit -m "feat(r4): buildTimeline pure helper (ordered, grouped, factual captions)"
```

---

### Task 6: `LifeHero` component

The hero: back link, character portrait, over-line, alive/died chip, factual h1, and the 5-stat band.

**Files:**
- Create: `apps/web/src/components/life/hero.tsx`
- Test: `apps/web/src/components/life/hero.test.tsx`

**Interfaces:**
- Consumes: `LifeTimelineData` (`@/lib/types`), `LifeTimelineView` (`@/lib/life-timeline`), `CharacterImage` (`@/components/character-image`), `GamertagLink` (`@/components/gamertag-link`), `mapLabel`/`formatDuration` (`@/components/player/format`), `playerSlug` (`@/lib/slug`).
- Produces: `LifeHero({ data, view })`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/components/life/hero.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { LifeHero } from "./hero";
import { buildTimeline } from "@/lib/life-timeline";
import type { LifeTimelineData } from "@/lib/types";

const start = "2026-07-14T00:00:00Z";
function data(over: Partial<LifeTimelineData> = {}): LifeTimelineData {
  return {
    gamertag: "YrJustBad", map: "sakhal", slug: "sakhal",
    life: { id: 1, serverId: 1, playerId: 1, lifeNumber: 4, startedAt: start, endedAt: null, deathCause: null, deathByGamertag: null, deathWeapon: null, deathDistance: null, energyAtDeath: null, waterAtDeath: null, bleedSourcesAtDeath: null, playtimeSeconds: 0 },
    sessions: [{ id: 1, serverId: 1, playerId: 1, lifeId: 1, connectedAt: start, disconnectedAt: null, durationSeconds: null, closeReason: null }],
    kills: [], qualifiedAt: { at: start, by: "playtime" },
    character: { charId: 1, characterClass: "SurvivorM_Cyril", name: "Cyril", gender: "male", sightings: 3, confidence: "exact" },
    ...over,
  };
}

describe("LifeHero", () => {
  test("alive: factual h1, Alive badge, gamertag links to dossier, QUALIFIED check", () => {
    const now = new Date(Date.parse(start) + 100 * 60_000);
    render(<LifeHero data={data()} view={buildTimeline(data(), now)} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Life 4 · Sakhal");
    expect(screen.getByText("Alive")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "YrJustBad" })).toHaveAttribute("href", "/players/yrjustbad");
    expect(screen.getByText("Qualified")).toBeInTheDocument();
  });

  test("dead: Died chip instead of Alive", () => {
    const now = new Date(Date.parse(start) + 400 * 60_000);
    const d = data({ life: { ...data().life, endedAt: "2026-07-14T06:00:00Z", deathCause: "pvp", playtimeSeconds: 21600 } });
    render(<LifeHero data={d} view={buildTimeline(d, now)} />);
    expect(screen.getByText("Died")).toBeInTheDocument();
    expect(screen.queryByText("Alive")).not.toBeInTheDocument();
  });

  test("portrait falls back to silhouette when no character", () => {
    const now = new Date(Date.parse(start) + 100 * 60_000);
    const d = data({ character: null });
    const { container } = render(<LifeHero data={d} view={buildTimeline(d, now)} />);
    expect(container.querySelector("img")).toBeNull(); // silhouette svg, not an img
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @onelife/web test -- components/life/hero`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `LifeHero`**

`apps/web/src/components/life/hero.tsx`:

```tsx
import Link from "next/link";
import type { LifeTimelineData } from "@/lib/types";
import type { LifeTimelineView } from "@/lib/life-timeline";
import { CharacterImage } from "@/components/character-image";
import { GamertagLink } from "@/components/gamertag-link";
import { mapLabel, formatDuration } from "@/components/player/format";
import { playerSlug } from "@/lib/slug";

function Stat({ value, label, blue = false }: { value: string; label: string; blue?: boolean }) {
  return (
    <div>
      <div className={`font-display text-[28px] font-bold leading-none ${blue ? "text-blue" : "text-ink"}`}>{value}</div>
      <div className="mt-[3px] font-mono text-[10px] uppercase tracking-[.07em] text-ink-muted">{label}</div>
    </div>
  );
}

export function LifeHero({ data, view }: { data: LifeTimelineData; view: LifeTimelineView }) {
  const map = mapLabel(data.map);
  const dossier = `/players/${playerSlug(data.gamertag)}`;
  const h = view.hero;

  return (
    <div>
      <Link href={dossier} className="font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted hover:text-red">
        <span aria-hidden>← </span>
        {data.gamertag}&apos;s dossier
      </Link>

      <div className="mt-3 flex gap-6 border-b-[3px] border-ink pb-5">
        <div className="w-[132px] flex-none">
          <CharacterImage character={{ name: data.character?.name ?? null }} size={132} dim={!view.alive} />
          <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-[.05em] text-ink-muted">Snapshot · this life</p>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
              A life of <GamertagLink gamertag={data.gamertag} className="font-bold text-ink underline" /> · {map}
            </span>
            {view.alive ? (
              <span className="bg-blue px-2 pb-0.5 pt-1 font-display text-[11px] font-bold uppercase tracking-[.1em] text-white">Alive</span>
            ) : (
              <span className="bg-red px-2 pb-0.5 pt-1 font-display text-[11px] font-bold uppercase tracking-[.1em] text-white">Died</span>
            )}
          </div>
          <h1 className="mt-1 font-display text-5xl font-bold uppercase leading-[.92] text-ink md:text-6xl">
            Life {data.life.lifeNumber} · {map}
          </h1>
          <div className="mt-4 grid grid-cols-[repeat(5,auto)] justify-start gap-x-8 gap-y-0">
            <Stat value={formatDuration(h.timeAliveSeconds)} label="Time alive" />
            <Stat value={String(h.kills)} label="Kills" />
            <Stat value={h.longestKillMeters == null ? "—" : `${Math.round(h.longestKillMeters)}m`} label="Longest kill" />
            <Stat value={String(h.sessions)} label="Sessions" />
            <Stat value={h.qualified ? "✓" : "—"} label="Qualified" blue={h.qualified} />
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @onelife/web test -- components/life/hero`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/life/hero.tsx apps/web/src/components/life/hero.test.tsx
git commit -m "feat(r4): LifeHero component (portrait, factual h1, stat band)"
```

---

### Task 7: `Timeline` component (withheld bar + event rows)

Renders the "Positions withheld" bar (alive only) and the vertical event list.

**Files:**
- Create: `apps/web/src/components/life/timeline.tsx`
- Test: `apps/web/src/components/life/timeline.test.tsx`

**Interfaces:**
- Consumes: `LifeTimelineView`/`TimelineEvent` (`@/lib/life-timeline`), `GamertagLink` (`@/components/gamertag-link`).
- Produces: `Timeline({ view })`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/components/life/timeline.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Timeline } from "./timeline";
import { buildTimeline } from "@/lib/life-timeline";
import type { LifeTimelineData } from "@/lib/types";

const start = "2026-07-14T00:00:00Z";
const at = (m: number) => new Date(Date.parse(start) + m * 60_000).toISOString();
function data(over: Partial<LifeTimelineData> = {}): LifeTimelineData {
  return {
    gamertag: "YrJustBad", map: "sakhal", slug: "sakhal",
    life: { id: 1, serverId: 1, playerId: 1, lifeNumber: 4, startedAt: start, endedAt: null, deathCause: null, deathByGamertag: null, deathWeapon: null, deathDistance: null, energyAtDeath: null, waterAtDeath: null, bleedSourcesAtDeath: null, playtimeSeconds: 0 },
    sessions: [{ id: 1, serverId: 1, playerId: 1, lifeId: 1, connectedAt: start, disconnectedAt: null, durationSeconds: null, closeReason: null }],
    kills: [{ victimGamertag: "Tomahawked11", weapon: "VSS", distanceMeters: 5, occurredAt: at(90) }],
    qualifiedAt: { at: at(5), by: "playtime" }, character: null,
    ...over,
  };
}

describe("Timeline", () => {
  test("alive: shows the Positions withheld bar and a NOW label", () => {
    const now = new Date(Date.parse(start) + 200 * 60_000);
    render(<Timeline view={buildTimeline(data(), now)} />);
    expect(screen.getByText("Positions withheld")).toBeInTheDocument();
    expect(screen.getByText("NOW")).toBeInTheDocument();
    expect(screen.getByText("Still drawing breath")).toBeInTheDocument();
  });

  test("kill row links the victim and shows weapon · distance", () => {
    const now = new Date(Date.parse(start) + 200 * 60_000);
    render(<Timeline view={buildTimeline(data(), now)} />);
    expect(screen.getByRole("link", { name: "Tomahawked11" })).toBeInTheDocument();
    expect(screen.getByText(/VSS · 5m/)).toBeInTheDocument();
  });

  test("dead: no withheld bar, death row shows killer + vitals", () => {
    const now = new Date(Date.parse(start) + 400 * 60_000);
    const d = data({
      kills: [],
      life: { ...data().life, endedAt: at(360), deathCause: "pvp", deathByGamertag: "SomeKiller", deathWeapon: "VSD", deathDistance: 126, energyAtDeath: 42, waterAtDeath: 18, bleedSourcesAtDeath: 2, playtimeSeconds: 21600 },
    });
    render(<Timeline view={buildTimeline(d, now)} />);
    expect(screen.queryByText("Positions withheld")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "SomeKiller" })).toBeInTheDocument();
    expect(screen.getByText(/Energy 42 · Water 18 · bleeding ×2/)).toBeInTheDocument();
  });

  test("longest kill row shows the Longest kill chip", () => {
    const now = new Date(Date.parse(start) + 500 * 60_000);
    const d = data({ kills: [{ victimGamertag: "V", weapon: "KAS-74U", distanceMeters: 25, occurredAt: at(120) }] });
    render(<Timeline view={buildTimeline(d, now)} />);
    expect(screen.getByText("Longest kill")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @onelife/web test -- components/life/timeline`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `Timeline`**

`apps/web/src/components/life/timeline.tsx`:

```tsx
import type { LifeTimelineView, TimelineEvent } from "@/lib/life-timeline";
import { GamertagLink } from "@/components/gamertag-link";

const DOT: Record<TimelineEvent["marker"], string> = {
  blue: "bg-blue",
  red: "bg-red",
  gray: "bg-dash",
  yellow: "bg-yellow",
};

function meters(d: number | null): string | null {
  return d == null ? null : `${Math.round(d)}m`;
}

function killDetail(weapon: string | null, distanceMeters: number | null): string {
  return [weapon, meters(distanceMeters)].filter(Boolean).join(" · ");
}

function WithheldBar() {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 border border-hairline bg-bone px-4 py-3">
      <span className="flex-none font-display text-xs font-bold uppercase tracking-[.1em] text-ink">Positions withheld</span>
      <span className="font-mono text-[11px] leading-relaxed tracking-[.03em] text-ink-soft">
        This survivor is alive. The desk does not print the coordinates of the living.
      </span>
    </div>
  );
}

function EventRow({ e }: { e: TimelineEvent }) {
  const timeColor = e.marker === "blue" ? "font-bold text-blue" : "text-ink-muted";
  return (
    <div className="grid grid-cols-[72px_1fr] gap-x-4 md:grid-cols-[96px_1fr] md:gap-x-[22px]">
      <div className={`pt-0.5 text-right font-mono text-[11px] tracking-[.03em] ${timeColor}`}>{e.timeLabel}</div>
      <div className="relative border-l-2 border-hairline pb-6 pl-6">
        <span aria-hidden className={`absolute -left-[7px] top-[3px] h-3.5 w-3.5 rounded-full border-2 border-paper ${DOT[e.marker]}`} />
        {e.kind === "kill" ? (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-display text-xl font-bold uppercase leading-none text-ink">
                Kill — <GamertagLink gamertag={e.victimGamertag} />
              </span>
              {e.longestKill && (
                <span className="-skew-x-[5deg] bg-yellow px-2 pb-0.5 pt-1 font-display text-[10px] font-bold uppercase tracking-[.08em] text-ink">Longest kill</span>
              )}
            </div>
            <p className="mt-1.5 font-mono text-xs leading-relaxed text-ink-soft">{killDetail(e.weapon, e.distanceMeters)}</p>
          </>
        ) : e.kind === "death" ? (
          <>
            <p className="font-display text-xl font-bold uppercase leading-none text-ink">
              {e.cause === "pvp" ? (
                <>Killed by {e.byGamertag ? <GamertagLink gamertag={e.byGamertag} /> : "unknown"}</>
              ) : (
                <>Died — {e.cause ?? "unknown"}</>
              )}
            </p>
            <p className="mt-1.5 font-mono text-xs leading-relaxed text-ink-soft">
              {[killDetail(e.weapon, e.distanceMeters) || null, e.vitals].filter(Boolean).join(" · ") || "—"}
            </p>
          </>
        ) : (
          <>
            <p className={`font-display font-bold uppercase leading-none text-ink ${e.kind === "session" || e.kind === "session-group" ? "text-base" : "text-xl"}`}>{e.title}</p>
            <p className="mt-1.5 font-mono text-xs leading-relaxed text-ink-soft">{e.line}</p>
          </>
        )}
      </div>
    </div>
  );
}

export function Timeline({ view }: { view: LifeTimelineView }) {
  return (
    <div>
      {view.alive && <WithheldBar />}
      <h2 className="mt-7 font-display text-xl font-bold uppercase tracking-[.1em] text-ink">The record so far</h2>
      <div className="mt-4">
        {view.events.map((e, idx) => (
          <EventRow key={`${e.kind}-${idx}`} e={e} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @onelife/web test -- components/life/timeline`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/life/timeline.tsx apps/web/src/components/life/timeline.test.tsx
git commit -m "feat(r4): Timeline component (withheld bar + event rows)"
```

---

### Task 8: Timeline page route + loading skeleton

Wires the page at `/players/[slug]/[map]/lives/[n]` with metadata and a loading skeleton.

**Files:**
- Create: `apps/web/src/app/players/[slug]/[map]/lives/[n]/page.tsx`
- Create: `apps/web/src/app/players/[slug]/[map]/lives/[n]/loading.tsx`
- Modify: `apps/web/src/components/skeletons.tsx` (add `LifeSkeleton`)
- Test: `apps/web/src/components/skeletons.test.tsx` (add a `LifeSkeleton` render case — or create if absent)

**Interfaces:**
- Consumes: `getPlayerLife` (`@/lib/api`), `buildTimeline` (`@/lib/life-timeline`), `LifeHero` (`@/components/life/hero`), `Timeline` (`@/components/life/timeline`), `mapLabel` (`@/components/player/format`), `absoluteUrl` (`@/lib/seo`). **Read the sibling `apps/web/src/app/players/[slug]/page.tsx` first** to match its async-`params` signature, `notFound()` usage, `generateMetadata` shape, and `<main>` wrapper classes.

- [ ] **Step 1: Add `LifeSkeleton` + its render test**

In `apps/web/src/components/skeletons.tsx` add (mirror the existing `DossierSkeleton` pulse-block style there):

```tsx
export function LifeSkeleton() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10" aria-hidden>
      <div className="h-3 w-40 animate-pulse bg-bone" />
      <div className="mt-3 flex gap-6 border-b-[3px] border-ink pb-5">
        <div className="h-[132px] w-[132px] animate-pulse bg-bone" />
        <div className="flex-1 space-y-3">
          <div className="h-3 w-56 animate-pulse bg-bone" />
          <div className="h-12 w-3/4 animate-pulse bg-bone" />
          <div className="h-7 w-full animate-pulse bg-bone" />
        </div>
      </div>
      <div className="mt-8 space-y-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-pulse bg-bone" />
        ))}
      </div>
    </main>
  );
}
```

Add to `apps/web/src/components/skeletons.test.tsx` (create the file with the shared imports if it does not exist):

```tsx
import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { LifeSkeleton } from "./skeletons";

describe("LifeSkeleton", () => {
  test("renders without crashing", () => {
    const { container } = render(<LifeSkeleton />);
    expect(container.querySelector("main")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the skeleton test**

Run: `pnpm --filter @onelife/web test -- skeletons`
Expected: PASS.

- [ ] **Step 3: Add `loading.tsx`**

`apps/web/src/app/players/[slug]/[map]/lives/[n]/loading.tsx`:

```tsx
import { LifeSkeleton } from "@/components/skeletons";

export default function Loading() {
  return <LifeSkeleton />;
}
```

- [ ] **Step 4: Add the page**

`apps/web/src/app/players/[slug]/[map]/lives/[n]/page.tsx` (align async-`params` + metadata style to the sibling dossier page):

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPlayerLife } from "@/lib/api";
import { buildTimeline } from "@/lib/life-timeline";
import { LifeHero } from "@/components/life/hero";
import { Timeline } from "@/components/life/timeline";
import { mapLabel } from "@/components/player/format";
import { absoluteUrl } from "@/lib/seo";

type Params = { slug: string; map: string; n: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug, map, n } = await params;
  const num = Number(n);
  if (!Number.isInteger(num) || num < 1) return { title: "Life — One Life" };
  const data = await getPlayerLife(slug, map, num);
  if (!data) return { title: "Life — One Life" };
  const label = mapLabel(data.map);
  const title = `Life ${data.life.lifeNumber} · ${label} — ${data.gamertag} — One Life`;
  return {
    title,
    description: `The record of ${data.gamertag}'s life ${data.life.lifeNumber} on ${label} — every session, kill, and the death that ended it.`,
    alternates: { canonical: absoluteUrl(`/players/${slug}/${map}/lives/${num}`) },
  };
}

export default async function LifePage({ params }: { params: Promise<Params> }) {
  const { slug, map, n } = await params;
  const num = Number(n);
  if (!Number.isInteger(num) || num < 1) notFound();
  const data = await getPlayerLife(slug, map, num);
  if (!data) notFound();
  const now = new Date();
  const view = buildTimeline(data, now);
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10">
      <LifeHero data={data} view={view} />
      <div className="mt-6">
        <Timeline view={view} />
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Typecheck + web tests**

Run: `pnpm --filter @onelife/web typecheck && pnpm --filter @onelife/web test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/players/[slug]/[map]/lives/[n]/page.tsx" "apps/web/src/app/players/[slug]/[map]/lives/[n]/loading.tsx" apps/web/src/components/skeletons.tsx apps/web/src/components/skeletons.test.tsx
git commit -m "feat(r4): life timeline page route + loading skeleton"
```

---

### Task 9: `lifeNumber` on AliveStanding + `TIMELINE →` links on standing/funeral cards

Adds the current-life number to the alive standing (so the card can link its timeline) and wires `TIMELINE →` links on both card types.

**Files:**
- Modify: `packages/read-models/src/player-page.ts` (add `lifeNumber` to `AliveStanding` + populate it)
- Modify: `apps/web/src/lib/types.ts` (`AliveStanding` gains `lifeNumber: number`)
- Modify: `apps/web/src/components/player/standing-card.tsx`
- Modify: `apps/web/src/components/player/past-life-card.tsx`
- Modify: `apps/web/src/components/player/player-profile.tsx` (pass `gamertag` to `PastLifeCard`)
- Test: `packages/read-models/test/player-page.test.ts` (assert `lifeNumber` present on an alive standing — extend an existing alive case)
- Test: `apps/web/src/components/player/standing-card.test.tsx` (assert TIMELINE link — create/extend)
- Test: `apps/web/src/components/player/past-life-card.test.tsx` (add `gamertag` prop + assert TIMELINE link)

**Interfaces:**
- Consumes: `lifeHref` (`@/lib/life-href`), the `AliveStanding.lifeNumber` field, `BanStanding.triggeringLifeNumber`.
- Produces: standing/funeral cards each rendering a `TIMELINE →` link.

- [ ] **Step 1: Add `lifeNumber` to the read-model `AliveStanding`**

In `packages/read-models/src/player-page.ts`: add `lifeNumber: number;` to the `AliveStanding` interface (line 11), and populate it where the alive standing is built from the open life row (the life row has `.lifeNumber`). Find the `alive: { ... }` object construction in the standing builder and add `lifeNumber: <that life row>.lifeNumber`. Do not change any other field.

- [ ] **Step 2: Update the read-model test + run it**

In `packages/read-models/test/player-page.test.ts`, in an existing test that asserts an alive standing, add:

```ts
    expect(aliveStanding.alive?.lifeNumber).toBeGreaterThanOrEqual(1);
```

(Bind `aliveStanding` to the alive `ServerStanding` the test already computes.) Run:
`TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test -- player-page`
Expected: PASS.

- [ ] **Step 3: Update the web `AliveStanding` type**

In `apps/web/src/lib/types.ts` line 133, add `lifeNumber: number;` to `AliveStanding`:

```ts
export type AliveStanding = { lifeId: number; lifeNumber: number; startedAt: string; timeAliveSeconds: number; kills: number; longestKillMeters: number | null; killList: PlayerKill[] };
```

- [ ] **Step 4: Write failing card tests**

Extend `apps/web/src/components/player/past-life-card.test.tsx` — update the `life()` factory call sites to pass a `gamertag` prop and add:

```tsx
  test("links to the life timeline", () => {
    render(<PastLifeCard life={life()} now={now} gamertag="YrJustBad" />);
    expect(screen.getByRole("link", { name: /timeline/i })).toHaveAttribute("href", "/players/yrjustbad/sakhal/lives/2");
  });
```

Create `apps/web/src/components/player/standing-card.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { StandingCard } from "./standing-card";
import type { ServerStanding } from "@/lib/types";

const now = new Date("2026-07-16T12:00:00Z");
function alive(): ServerStanding {
  return {
    serverId: 1, map: "sakhal", slug: "sakhal", state: "alive", character: null,
    alive: { lifeId: 5, lifeNumber: 3, startedAt: "2026-07-16T00:00:00Z", timeAliveSeconds: 3600, kills: 0, longestKillMeters: null, killList: [] },
    ban: null,
  };
}

describe("StandingCard timeline link", () => {
  test("alive standing links to that life's timeline", () => {
    render(<StandingCard standing={alive()} now={now} pageGamertag="YrJustBad" />);
    expect(screen.getByRole("link", { name: /timeline/i })).toHaveAttribute("href", "/players/yrjustbad/sakhal/lives/3");
  });
});
```

Run: `pnpm --filter @onelife/web test -- standing-card` — Expected: FAIL (no link yet).

- [ ] **Step 5: Add the link to `StandingCard`**

In `apps/web/src/components/player/standing-card.tsx`: add the import `import { lifeHref } from "@/lib/life-href";`, then compute a timeline target and render it after the sub-line. Replace the sub-line block (lines 21-24) with:

```tsx
        <div className="min-w-0 flex-1">
          <p className="font-display text-[19px] font-bold uppercase leading-none text-ink">{mapLabel(standing.map)}</p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[.05em] text-ink-muted">
            {sub}
            {timelineLifeNumber != null && (
              <>
                {" · "}
                <Link href={lifeHref(pageGamertag, standing.slug, timelineLifeNumber)} className="underline hover:text-red">
                  Timeline <span aria-hidden>→</span>
                </Link>
              </>
            )}
          </p>
        </div>
```

Add `import Link from "next/link";` at the top, and just before the `return`, compute:

```tsx
  const timelineLifeNumber = alive && standing.alive ? standing.alive.lifeNumber : banned ? standing.ban?.triggeringLifeNumber ?? null : null;
```

- [ ] **Step 6: Add the link to `PastLifeCard`**

In `apps/web/src/components/player/past-life-card.tsx`: add `import Link from "next/link";` and `import { lifeHref } from "@/lib/life-href";`; change the signature to accept `gamertag`:

```tsx
export function PastLifeCard({ life, now, gamertag }: { life: PastLife; now: Date; gamertag: string }) {
```

Then add a timeline link at the end of the counts strip — replace the closing of the counts `<p>` (line 33) by appending a link row right after it, before `</section>`:

```tsx
      <p className="mt-2 text-right">
        <Link href={lifeHref(gamertag, life.slug, life.lifeNumber)} className="font-mono text-[10px] uppercase tracking-[.06em] text-ink-muted underline hover:text-red">
          Timeline <span aria-hidden>→</span>
        </Link>
      </p>
```

- [ ] **Step 7: Pass `gamertag` from `player-profile.tsx`**

In `apps/web/src/components/player/player-profile.tsx` line 50, add the prop:

```tsx
              <PastLifeCard key={`${l.serverId}:${l.lifeId}`} life={l} now={now} gamertag={page.gamertag} />
```

- [ ] **Step 8: Run web tests + typecheck**

Run: `pnpm --filter @onelife/web test -- "player/" && pnpm --filter @onelife/web typecheck`
Expected: PASS (standing-card + past-life-card link tests green).

- [ ] **Step 9: Commit**

```bash
git add packages/read-models/src/player-page.ts packages/read-models/test/player-page.test.ts apps/web/src/lib/types.ts apps/web/src/components/player/standing-card.tsx apps/web/src/components/player/past-life-card.tsx apps/web/src/components/player/past-life-card.test.tsx apps/web/src/components/player/standing-card.test.tsx apps/web/src/components/player/player-profile.tsx
git commit -m "feat(r4): AliveStanding.lifeNumber + TIMELINE links on standing/funeral cards"
```

---

## Final verification (after all tasks)

- [ ] Full suite: `pnpm turbo run test --concurrency=1` with `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test` exported. Expected: all packages green.
- [ ] Typecheck: `pnpm turbo run typecheck`. Expected: all green.
- [ ] Grep gates: no raw hex in new files (`grep -rn "#[0-9A-Fa-f]\{6\}" apps/web/src/components/life apps/web/src/app/players/\[slug\]/\[map\]` → empty); no `role="img"` on portraits; timeline links nowhere near `/obituaries` or `/fresh-spawns` (`grep -rn "obituaries\|fresh-spawns" apps/web/src/components/life` → empty).
- [ ] Chrome visual sweep at 1440px + 390px against `onelife_visual`: an **alive** life (withheld bar + NOW row + grouped sessions), a **dead** life (death terminal row + vitals, no bar), the new `TIMELINE →` links from a dossier's standing + funeral cards. Console clean.
- [ ] Finishing step (finishing-a-feature): CHANGELOG.md Unreleased bullets + CLAUDE.md updates, then PR into `develop`.

## Notes for the executor

- **Next 15 async APIs:** `params` is a `Promise` — `await` it. Mirror the sibling `players/[slug]/page.tsx` exactly for the param + metadata conventions; if that page uses a different `<main>` wrapper or `absoluteUrl` import path, follow it.
- **`QualifiedAt` export:** if `qualified.ts` doesn't already `export` the `QualifiedAt` type, add the `export` (Task 1) — it is imported by `life-timeline.ts`.
- **`PlayerAvatar` vs `CharacterImage`:** the standing card uses `PlayerAvatar` for its portrait; leave that untouched — Task 9 only adds a text link. The timeline hero uses `CharacterImage` directly.
- **Barrel-first for read-models:** the API imports read-models from the `@onelife/read-models` barrel, so every new read-model must be exported from `packages/read-models/src/index.ts` before the API can see it.
- **DB fixtures:** insert `servers` with a unique random `nitradoServiceId`/`slug` per test file (the harness DB is shared); clean up in `afterAll` and call `sql.end()`.
