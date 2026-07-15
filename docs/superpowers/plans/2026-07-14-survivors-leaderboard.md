# Survivors Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public, SEO-friendly, mobile-first live leaderboard of currently-alive survivors at `/survivors` (+ per-map routes), server-rendered with query-param sort and pagination.

**Architecture:** A new set-based read-model (`getAliveSurvivors`) computes one row per alive survivor (open qualified life) per map, enriched with the open life's character. A public Fastify route exposes it. The Next.js App Router page(s) are server components that read `searchParams`, render a responsive cards→rows leaderboard, and emit per-page SEO/OG metadata. Map filtering is real routing; sort and page are query params.

**Tech Stack:** pnpm + turbo monorepo, TypeScript/ESM, Postgres + Drizzle, Fastify (api), Next.js 15 App Router + React 19 + TanStack Query + Tailwind 3 (web), Vitest.

**Design spec:** `docs/superpowers/specs/2026-07-14-survivors-leaderboard-design.md` (read it first).

## Global Constraints

- **Alive = open qualified life:** `lives.endedAt IS NULL` AND `isLifeQualified` (`QUALIFY_SECONDS = 300`, or a kill in-life, or `deathCause = 'pvp'`). Reuse `isLifeQualified`/`lifeQualifiedAt` from `packages/read-models/src/qualified.ts`.
- **Rows are per (player × server).** A player alive on two maps = two rows on the combined board.
- **Time alive = active playtime** via `livePlaytime(storedSeconds, openSession, upTo)` (`packages/read-models/src/playtime.ts`), `upTo` capped at `players.lastSeenAt`. Never wall-clock.
- **Kills / longest kill are THIS-LIFE:** `kills` where `killerGamertag = gamertag AND serverId = server.id AND occurredAt >= life.startedAt`.
- **Only active, slugged servers** participate (`servers.active = true AND servers.slug IS NOT NULL`) — mirror `getGlobalRoster` (`packages/read-models/src/global.ts`).
- **Sort:** `kills` (default) | `time` | `longest`, always **descending**. Tie-break: metric desc → `timeAliveSeconds` desc → `gamertag` asc.
- **Page size = 25.** `page` is 1-based; invalid/out-of-range coerces to a valid page (never 500).
- **Avatar asset:** `/characters/${name.toLowerCase()}.webp` where `name` comes from `rosterByClass(characterClass).name` (`packages/domain/src/characters.ts`). Unknown class → silhouette fallback.
- **Web uses plain `<img>`** (not `next/image`); Tailwind semantic tokens (`bg-panel`, `border-line`, `text-bone`, `text-amber`, `text-muted`); `font-display` for the title.
- **API response types are duplicated** into `apps/web/src/lib/types.ts` (no shared type package); keep hand-synced with the read-model.
- **Test commands:** whole repo `pnpm turbo run test --concurrency=1` (DB suites need `TEST_DATABASE_URL`); single package `pnpm --filter <pkg> test`; typecheck `pnpm turbo run typecheck`.
- **Commits:** conventional prefixes; frequent. Do NOT touch `CHANGELOG.md`/`CLAUDE.md` until Task 9.

---

### Task 1: Read-model — `getAliveSurvivors` core (numeric stats, filter, sort, pagination)

**Files:**
- Create: `packages/read-models/src/survivors.ts`
- Modify: `packages/read-models/src/index.ts` (add `export * from "./survivors.js";`)
- Test: `packages/read-models/test/survivors.test.ts`

**Interfaces:**
- Consumes: `Database` type + Drizzle table objects exactly as imported in `packages/read-models/src/queries.ts`; `livePlaytime` (`./playtime.js`); `isLifeQualified` (`./qualified.js`).
- Produces:
```ts
export type SurvivorSort = "kills" | "time" | "longest";

export interface SurvivorCharacter {
  name: string | null;   // "Helga"
  head: string | null;   // roster head key, e.g. "f_helga"
  gender: string | null; // "female" | "male"
}

export interface SurvivorRow {
  gamertag: string;
  map: string;            // servers.map
  slug: string;           // servers.slug
  timeAliveSeconds: number;
  killsThisLife: number;
  longestKillMeters: number | null;
  character: SurvivorCharacter | null;   // Task 1 always sets null; Task 2 fills it
}

export interface SurvivorsPage {
  rows: SurvivorRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: SurvivorSort;
}

export const SURVIVORS_PAGE_SIZE = 25;

export function getAliveSurvivors(
  db: Database,
  opts: { slug?: string; sort: SurvivorSort; page: number; pageSize?: number },
  now: Date,
): Promise<SurvivorsPage>;
```
An internal (un-exported) row shape must also carry `serverId: number` and `startedAt: Date` for Task 2's character enrichment — keep them on an internal type, not on `SurvivorRow`.

- [ ] **Step 1: Write the failing tests**

Mirror the harness setup in existing DB suites (e.g. `packages/read-models/test/player-aggregate.test.ts`) — same imports, `TEST_DATABASE_URL` gating, per-test truncation, and server/player/life/kill/session insert helpers. Write to `packages/read-models/test/survivors.test.ts`:

```ts
// Uses the same Postgres test harness + insert helpers as player-aggregate.test.ts.
// Two active slugged servers: chern (id from insert, slug "chernarus", map "chernarusplus"),
// sakh (slug "sakhal", map "sakhal"). `now` is a fixed Date.

describe("getAliveSurvivors", () => {
  it("returns only players with an open QUALIFIED life", async () => {
    // alive+qualified: open life, playtimeSeconds=600 on chern
    await insertLife({ serverId: chern.id, gamertag: "Alive", endedAt: null, playtimeSeconds: 600, startedAt: hoursAgo(2) });
    // dead: closed life
    await insertLife({ serverId: chern.id, gamertag: "Dead", endedAt: hoursAgo(1), playtimeSeconds: 900, startedAt: hoursAgo(3) });
    // open but UNqualified: 60s, no kills, not pvp
    await insertLife({ serverId: chern.id, gamertag: "Fresh", endedAt: null, playtimeSeconds: 60, startedAt: minutesAgo(1) });

    const res = await getAliveSurvivors(db, { sort: "kills", page: 1 }, now);
    expect(res.rows.map(r => r.gamertag)).toEqual(["Alive"]);
    expect(res.total).toBe(1);
    expect(res.pageSize).toBe(25);
  });

  it("qualifies an open sub-300s life that has a kill in-window", async () => {
    await insertLife({ serverId: chern.id, gamertag: "Sniper", endedAt: null, playtimeSeconds: 120, startedAt: minutesAgo(5) });
    await insertKill({ serverId: chern.id, killerGamertag: "Sniper", victimGamertag: "X", distance: 210, occurredAt: minutesAgo(2) });
    const res = await getAliveSurvivors(db, { sort: "kills", page: 1 }, now);
    expect(res.rows.map(r => r.gamertag)).toContain("Sniper");
  });

  it("counts kills THIS LIFE and longest kill this life", async () => {
    await insertLife({ serverId: chern.id, gamertag: "Killer", endedAt: null, playtimeSeconds: 1800, startedAt: hoursAgo(1) });
    // in-life kills
    await insertKill({ serverId: chern.id, killerGamertag: "Killer", victimGamertag: "A", distance: 100, occurredAt: minutesAgo(30) });
    await insertKill({ serverId: chern.id, killerGamertag: "Killer", victimGamertag: "B", distance: 350, occurredAt: minutesAgo(10) });
    // BEFORE this life started — must be excluded
    await insertKill({ serverId: chern.id, killerGamertag: "Killer", victimGamertag: "C", distance: 999, occurredAt: hoursAgo(5) });
    const res = await getAliveSurvivors(db, { sort: "kills", page: 1 }, now);
    const row = res.rows.find(r => r.gamertag === "Killer")!;
    expect(row.killsThisLife).toBe(2);
    expect(row.longestKillMeters).toBe(350);
  });

  it("returns null longestKill when the life has no ranged kills", async () => {
    await insertLife({ serverId: chern.id, gamertag: "Pacifist", endedAt: null, playtimeSeconds: 700, startedAt: hoursAgo(1) });
    const res = await getAliveSurvivors(db, { sort: "kills", page: 1 }, now);
    expect(res.rows.find(r => r.gamertag === "Pacifist")!.longestKillMeters).toBeNull();
  });

  it("emits two rows for a player alive on both maps; slug filter narrows", async () => {
    await insertLife({ serverId: chern.id, gamertag: "Both", endedAt: null, playtimeSeconds: 700, startedAt: hoursAgo(1) });
    await insertLife({ serverId: sakh.id, gamertag: "Both", endedAt: null, playtimeSeconds: 700, startedAt: hoursAgo(1) });
    const all = await getAliveSurvivors(db, { sort: "kills", page: 1 }, now);
    expect(all.rows.filter(r => r.gamertag === "Both").map(r => r.slug).sort()).toEqual(["chernarus", "sakhal"]);
    const onlySakh = await getAliveSurvivors(db, { slug: "sakhal", sort: "kills", page: 1 }, now);
    expect(onlySakh.rows.every(r => r.slug === "sakhal")).toBe(true);
  });

  it("sorts by the chosen metric desc with deterministic tie-break", async () => {
    // two players with equal kills(0) — tie broken by timeAlive desc
    await insertLife({ serverId: chern.id, gamertag: "Longer", endedAt: null, playtimeSeconds: 3600, startedAt: hoursAgo(2) });
    await insertLife({ serverId: chern.id, gamertag: "Shorter", endedAt: null, playtimeSeconds: 600, startedAt: hoursAgo(1) });
    const byKills = await getAliveSurvivors(db, { sort: "kills", page: 1 }, now);
    expect(byKills.rows.map(r => r.gamertag)).toEqual(["Longer", "Shorter"]);
    const byLongest = await getAliveSurvivors(db, { sort: "longest", page: 1 }, now);
    expect(byLongest.rows[0].gamertag).toBeDefined(); // longest-kill sort runs without error
  });

  it("paginates with a stable total", async () => {
    for (let i = 0; i < 30; i++) {
      await insertLife({ serverId: chern.id, gamertag: `P${String(i).padStart(2, "0")}`, endedAt: null, playtimeSeconds: 600 + i, startedAt: hoursAgo(2) });
    }
    const p1 = await getAliveSurvivors(db, { sort: "time", page: 1 }, now);
    const p2 = await getAliveSurvivors(db, { sort: "time", page: 2 }, now);
    expect(p1.total).toBe(30);
    expect(p1.rows).toHaveLength(25);
    expect(p2.rows).toHaveLength(5);
    // no overlap
    const s1 = new Set(p1.rows.map(r => r.gamertag));
    expect(p2.rows.every(r => !s1.has(r.gamertag))).toBe(true);
  });

  it("character is null in the core query (enriched in Task 2)", async () => {
    await insertLife({ serverId: chern.id, gamertag: "Anon", endedAt: null, playtimeSeconds: 700, startedAt: hoursAgo(1) });
    const res = await getAliveSurvivors(db, { sort: "kills", page: 1 }, now);
    expect(res.rows[0].character).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @onelife/read-models test survivors`
Expected: FAIL — `getAliveSurvivors is not a function` / module not found.

- [ ] **Step 3: Implement the core read-model**

Write `packages/read-models/src/survivors.ts`. **Mirror the Drizzle query style of `getLeaderboard` in `leaderboards.ts`** (it already aggregates `kills` by `killerGamertag` and joins lives windows) and `getRoster`/`getPlayerProfile` in `queries.ts` (open-session live playtime). Approach:

1. Load candidate open lives: `select` from `lives` join `servers` (active, slug not null) where `lives.endedAt IS NULL`, optionally `servers.slug = opts.slug`. Join `players` for `gamertag` + `lastSeenAt`. Left join the player's open `sessions` row (`disconnectedAt IS NULL`, matching `lifeId`) for live playtime.
2. For each candidate compute `timeAliveSeconds = livePlaytime(playtimeSeconds, openSession, cap)` where `cap = min(now, lastSeenAt ?? now)`.
3. Apply the qualification gate with `isLifeQualified(...)` (needs the life row + whether it has an in-life kill + effective playtime — pass the same inputs the other read-models pass; check its signature in `qualified.ts`). Exclude unqualified.
4. Compute `killsThisLife` = count of `kills` (serverId + killerGamertag = gamertag + `occurredAt >= startedAt`); `longestKillMeters` = `max(distance)` over the same predicate (null if none). Do this as a correlated aggregate/LEFT JOIN in SQL, or a second grouped query keyed by `(serverId, gamertag, startedAt)` merged in JS — prefer set-based.
5. Sort by `opts.sort` (`kills` → killsThisLife, `time` → timeAliveSeconds, `longest` → longestKillMeters with nulls last) **descending**, tie-break `timeAliveSeconds` desc then `gamertag` asc. (Sorting in JS after building the small alive set is acceptable and simplest; SQL `ORDER BY … LIMIT/OFFSET` is fine too.)
6. `total = ` the qualified alive count for the filter; slice `[(page-1)*size, …]` for `rows`. Clamp `page` to ≥1; an out-of-range high page yields empty `rows` with the real `total`.
7. Set `character: null` on every row (Task 2 fills). Keep internal `serverId`/`startedAt` for Task 2 but do not expose them on `SurvivorRow`.

Export `SURVIVORS_PAGE_SIZE = 25`; default `opts.pageSize` to it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/read-models test survivors`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck & commit**

Run: `pnpm --filter @onelife/read-models typecheck` → clean.
```bash
git add packages/read-models/src/survivors.ts packages/read-models/src/index.ts packages/read-models/test/survivors.test.ts
git commit -m "feat(read-models): getAliveSurvivors core (alive-qualified filter, this-life stats, sort, pagination)"
```

---

### Task 2: Read-model — character enrichment for survivor rows

**Files:**
- Modify: `packages/read-models/src/survivors.ts`
- Test: `packages/read-models/test/survivors.test.ts` (add cases)

**Interfaces:**
- Consumes: `getLifeCharacter(db, serverId, gamertag, startedAt, endedAt)` → `LifeCharacter` (`./character.js`); `rosterByClass(cls)` → `SurvivorClass { class, name, gender, head }` (`@onelife/domain`).
- Produces: `SurvivorRow.character` populated for the returned page.

**Rationale:** enrich only the **paginated page** (≤25 rows) — resolve each row's open-life character with `getLifeCharacter`, map `characterClass` → `rosterByClass` → `{ name, head, gender }`. ≤25 lookups; unknown/modded class → `character: null`.

- [ ] **Step 1: Write the failing tests**

```ts
it("resolves character name/head/gender for the open life", async () => {
  await insertLife({ serverId: chern.id, gamertag: "Helga_Main", endedAt: null, playtimeSeconds: 700, startedAt: hoursAgo(1) });
  // sighting linking the gamertag+time window to a known class (mirror character.test.ts fixtures)
  await insertSighting({ serverId: chern.id, gamertag: "Helga_Main", charId: 42, characterClass: "SurvivorF_Helga", observedAt: minutesAgo(30) });
  await insertCharacterRollup({ serverId: chern.id, charId: 42, characterClass: "SurvivorF_Helga" });
  const res = await getAliveSurvivors(db, { sort: "kills", page: 1 }, now);
  const row = res.rows.find(r => r.gamertag === "Helga_Main")!;
  expect(row.character).toEqual({ name: "Helga", head: expect.any(String), gender: "female" });
});

it("leaves character null for an unknown/modded class", async () => {
  await insertLife({ serverId: chern.id, gamertag: "Modded", endedAt: null, playtimeSeconds: 700, startedAt: hoursAgo(1) });
  await insertSighting({ serverId: chern.id, gamertag: "Modded", charId: 7, characterClass: "SurvivorM_ModPack_Xyz", observedAt: minutesAgo(20) });
  await insertCharacterRollup({ serverId: chern.id, charId: 7, characterClass: "SurvivorM_ModPack_Xyz" });
  const res = await getAliveSurvivors(db, { sort: "kills", page: 1 }, now);
  expect(res.rows.find(r => r.gamertag === "Modded")!.character).toBeNull();
});
```
(Check `character.test.ts` for the exact sighting/rollup insert helper names and reuse them; adjust helper names above to match.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @onelife/read-models test survivors`
Expected: FAIL — `character` is `null` where a name is expected.

- [ ] **Step 3: Implement enrichment**

After pagination in `getAliveSurvivors`, `await Promise.all` over the page's internal rows: `const lc = await getLifeCharacter(db, row.serverId, row.gamertag, row.startedAt, null);` then `const rc = lc?.characterClass ? rosterByClass(lc.characterClass) : null;` and set `character = rc ? { name: rc.name, head: rc.head, gender: rc.gender } : null`. (Do NOT enrich before pagination — only the visible page.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @onelife/read-models test survivors`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/read-models/src/survivors.ts packages/read-models/test/survivors.test.ts
git commit -m "feat(read-models): enrich survivor rows with open-life character"
```

---

### Task 3: API — public `GET /survivors` and `GET /survivors/:slug`

**Files:**
- Create: `apps/api/src/routes/survivors.ts`
- Modify: `apps/api/src/app.ts` (register in the public block, alongside `registerPlayerAggregateRoutes`)
- Test: `apps/api/test/survivors.test.ts`

**Interfaces:**
- Consumes: `getAliveSurvivors`, `SURVIVORS_PAGE_SIZE`, `SurvivorSort` (`@onelife/read-models`); `resolveServerBySlug` (`apps/api/src/lib/resolve-server.ts`) for slug validation.
- Produces: `export function registerSurvivorsRoutes(app: FastifyInstance, db: Database): void`.

- [ ] **Step 1: Write failing tests**

Mirror `apps/api/test/player-aggregate-routes.test.ts` harness (build app, seed servers, inject requests).

```ts
it("GET /survivors returns a SurvivorsPage with defaults", async () => {
  const res = await app.inject({ method: "GET", url: "/survivors" });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body).toMatchObject({ page: 1, pageSize: 25, sort: "kills" });
  expect(Array.isArray(body.rows)).toBe(true);
});

it("validates sort + page, coercing invalid to defaults (no 500)", async () => {
  const res = await app.inject({ method: "GET", url: "/survivors?sort=bogus&page=-4" });
  expect(res.statusCode).toBe(200);
  expect(res.json().sort).toBe("kills");
  expect(res.json().page).toBe(1);
});

it("GET /survivors/:slug filters to that map", async () => {
  const res = await app.inject({ method: "GET", url: "/survivors/sakhal?sort=longest" });
  expect(res.statusCode).toBe(200);
  expect(res.json().sort).toBe("longest");
});

it("GET /survivors/:slug 404s an unknown map", async () => {
  const res = await app.inject({ method: "GET", url: "/survivors/atlantis" });
  expect(res.statusCode).toBe(404);
  expect(res.json()).toEqual({ error: "not_found" });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @onelife/api test survivors`
Expected: FAIL — 404/route not registered.

- [ ] **Step 3: Implement the route**

Mirror `apps/api/src/routes/player-aggregate.ts` style. zod query: `sort: z.enum(["kills","time","longest"]).catch("kills")`, `page: z.coerce.number().int().positive().catch(1)`. For `/survivors/:slug`, `resolveServerBySlug(db, slug)`; null → `reply.code(404).send({ error: "not_found" })`, else call `getAliveSurvivors(db, { slug, sort, page }, new Date())`. `/survivors` calls without `slug`. Return the object directly. Register `registerSurvivorsRoutes(app, db)` in `buildApp` next to the other public read routes in `app.ts`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @onelife/api test survivors`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/survivors.ts apps/api/src/app.ts apps/api/test/survivors.test.ts
git commit -m "feat(api): public GET /survivors[/:slug] alive leaderboard route"
```

---

### Task 4: Web — API client wrapper + types

**Files:**
- Modify: `apps/web/src/lib/types.ts` (add `SurvivorSort`, `SurvivorCharacter`, `SurvivorRow`, `SurvivorsPage`)
- Modify: `apps/web/src/lib/api.ts` (add `getSurvivors`)
- Test: `apps/web/src/lib/api.test.ts` if one exists for wrappers, else skip a dedicated test (covered by page tests).

**Interfaces:**
- Produces:
```ts
// types.ts — duplicate of the read-model interfaces (keep hand-synced)
export type SurvivorSort = "kills" | "time" | "longest";
export interface SurvivorCharacter { name: string | null; head: string | null; gender: string | null; }
export interface SurvivorRow { gamertag: string; map: string; slug: string; timeAliveSeconds: number; killsThisLife: number; longestKillMeters: number | null; character: SurvivorCharacter | null; }
export interface SurvivorsPage { rows: SurvivorRow[]; total: number; page: number; pageSize: number; sort: SurvivorSort; }

// api.ts
export const getSurvivors = (p: { slug?: string; sort: SurvivorSort; page: number }) =>
  apiGet<SurvivorsPage>(`/api/survivors${p.slug ? "/" + p.slug : ""}?sort=${p.sort}&page=${p.page}`);
```

- [ ] **Step 1: Add the types** to `apps/web/src/lib/types.ts` (verbatim above).
- [ ] **Step 2: Add `getSurvivors`** to `apps/web/src/lib/api.ts`, importing the new types; mirror existing wrappers (`getGlobalRoster`, `getPlayerAggregate`).
- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @onelife/web typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/types.ts apps/web/src/lib/api.ts
git commit -m "feat(web): survivors types + getSurvivors api wrapper"
```

---

### Task 5: Web — `MapBadge` + `SurvivorRow` (responsive) + avatar fallback

**Files:**
- Create: `apps/web/src/components/survivors/map-badge.tsx`
- Create: `apps/web/src/components/survivors/survivor-row.tsx`
- Create: `apps/web/src/components/survivors/format.ts` (pure helpers: `formatTimeAlive(seconds)`, `avatarSrc(character)`)
- Test: `apps/web/src/components/survivors/survivor-row.test.tsx`, `apps/web/src/components/survivors/format.test.ts`

**Interfaces:**
- Consumes: `SurvivorRow` from `@/lib/types`.
- Produces: `MapBadge({ slug }: { slug: string })`; `SurvivorRow({ row, rank, showMap }: { row: SurvivorRow; rank: number; showMap: boolean })`; `formatTimeAlive(s: number): string` (e.g. `6h 43m`, `0h 41m`); `avatarSrc(c: SurvivorCharacter | null): string` (`/characters/<name>.webp` or `/characters/_unknown.webp`).

- [ ] **Step 1: Write failing tests**

```tsx
// format.test.ts
import { formatTimeAlive, avatarSrc } from "./format";
test("formatTimeAlive", () => {
  expect(formatTimeAlive(6 * 3600 + 43 * 60)).toBe("6h 43m");
  expect(formatTimeAlive(41 * 60)).toBe("0h 41m");
});
test("avatarSrc lowercases the roster name, falls back on null", () => {
  expect(avatarSrc({ name: "Helga", head: "f_helga", gender: "female" })).toBe("/characters/helga.webp");
  expect(avatarSrc(null)).toBe("/characters/_unknown.webp");
});

// survivor-row.test.tsx (Testing Library)
test("renders gamertag, formatted stats, and map badge when showMap", () => {
  render(<SurvivorRow rank={1} showMap row={{ gamertag: "Chad", map: "chernarusplus", slug: "chernarus", timeAliveSeconds: 24180, killsThisLife: 11, longestKillMeters: 341, character: { name: "Boris", head: "m_boris", gender: "male" } }} />);
  expect(screen.getByText("Chad")).toBeInTheDocument();
  expect(screen.getByText("11")).toBeInTheDocument();
  expect(screen.getByText("341m")).toBeInTheDocument();
  expect(screen.getByText(/chernarus/i)).toBeInTheDocument();
  expect(screen.getByRole("img")).toHaveAttribute("src", "/characters/boris.webp");
});
test("hides map badge when showMap is false and shows dash for null longest kill", () => {
  render(<SurvivorRow rank={2} showMap={false} row={{ gamertag: "Pacifist", map: "sakhal", slug: "sakhal", timeAliveSeconds: 3600, killsThisLife: 0, longestKillMeters: null, character: null }} />);
  expect(screen.queryByText(/sakhal/i)).not.toBeInTheDocument();
  expect(screen.getByText("—")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @onelife/web test survivor-row format`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`format.ts`: pure functions as specified. `map-badge.tsx`: span with slug label; green tokens for `chernarus`, ice-blue for `sakhal`, neutral otherwise (Tailwind classes matching the mock palette). `survivor-row.tsx`: responsive — mobile stacked card (avatar+gamertag line, then a 3-tile strip Time/Kills/Longest), desktop horizontal row (rank → avatar → gamertag + `MapBadge` when `showMap` → right-aligned tiles) using Tailwind responsive prefixes (`sm:`); top-3 faint amber border (`rank <= 3`). Plain `<img src={avatarSrc(row.character)} alt={row.character?.name ?? "Unknown survivor"}>`. Longest kill renders `—` when null else `${meters}m`.

Also add a neutral silhouette asset `apps/web/public/characters/_unknown.webp` (reuse an existing neutral image or a simple gray placeholder committed here).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @onelife/web test survivor-row format`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/survivors/ apps/web/public/characters/_unknown.webp
git commit -m "feat(web): SurvivorRow + MapBadge + format helpers"
```

---

### Task 6: Web — `SurvivorControls` (map toggle + sort chips) + `Pagination`

**Files:**
- Create: `apps/web/src/components/survivors/survivor-controls.tsx`
- Create: `apps/web/src/components/survivors/pagination.tsx`
- Create: `apps/web/src/components/survivors/links.ts` (pure href builders)
- Test: `apps/web/src/components/survivors/links.test.ts`, `apps/web/src/components/survivors/survivor-controls.test.tsx`, `pagination.test.tsx`

**Interfaces:**
- Produces pure builders (easy to unit-test):
```ts
export function boardHref(slug: string | null, sort: SurvivorSort, page: number): string;
// slug null -> "/survivors", else "/survivors/<slug>"; omit ?page when page===1; always include ?sort unless kills+page1? -> ALWAYS include sort for clarity except default. Decide: include sort when !== "kills". Keep page param only when > 1.
export const MAP_TABS: { slug: string | null; label: string }[]; // built from active slugs; null = "All maps"
```
- `SurvivorControls({ slug, sort, tabs }: { slug: string | null; sort: SurvivorSort; tabs: {slug: string|null; label: string}[] })` — renders map tabs (Links via `boardHref(tab.slug, sort, 1)`, active when `tab.slug === slug`) and sort chips `Kills/Time alive/Longest kill` (Links via `boardHref(slug, chipSort, 1)` — **sort change resets page to 1**, active when `chipSort === sort`).
- `Pagination({ slug, sort, page, total, pageSize }: {...})` — Prev/Next + windowed numbers as Links via `boardHref(slug, sort, n)`; Prev hidden on page 1; Next hidden when `page*pageSize >= total`.

- [ ] **Step 1: Write failing tests**

```ts
// links.test.ts
test("boardHref builds canonical hrefs, omits page=1, keeps sort", () => {
  expect(boardHref(null, "kills", 1)).toBe("/survivors");
  expect(boardHref("chernarus", "kills", 1)).toBe("/survivors/chernarus");
  expect(boardHref("chernarus", "longest", 1)).toBe("/survivors/chernarus?sort=longest");
  expect(boardHref("sakhal", "time", 3)).toBe("/survivors/sakhal?sort=time&page=3");
  expect(boardHref(null, "kills", 2)).toBe("/survivors?page=2");
});
```
```tsx
// survivor-controls.test.tsx
test("sort chip links reset page and mark active", () => {
  render(<SurvivorControls slug="chernarus" sort="kills" tabs={[{slug:null,label:"All maps"},{slug:"chernarus",label:"Chernarus"},{slug:"sakhal",label:"Sakhal"}]} />);
  const longest = screen.getByRole("link", { name: /longest kill/i });
  expect(longest).toHaveAttribute("href", "/survivors/chernarus?sort=longest");
  const chern = screen.getByRole("link", { name: "Chernarus" });
  expect(chern).toHaveAttribute("aria-current", "page"); // active tab
});
// pagination.test.tsx
test("hides Prev on page 1, shows Next when more pages", () => {
  render(<Pagination slug={null} sort="kills" page={1} total={60} pageSize={25} />);
  expect(screen.queryByRole("link", { name: /prev/i })).toBeNull();
  expect(screen.getByRole("link", { name: /next/i })).toHaveAttribute("href", "/survivors?page=2");
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @onelife/web test links survivor-controls pagination` → FAIL.
- [ ] **Step 3: Implement** `links.ts` (pure), `survivor-controls.tsx`, `pagination.tsx` using `next/link` and Tailwind tokens matching the mock (amber active states). Active tab gets `aria-current="page"`.
- [ ] **Step 4: Run to verify pass** — same command → PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/survivors/survivor-controls.tsx apps/web/src/components/survivors/pagination.tsx apps/web/src/components/survivors/links.ts apps/web/src/components/survivors/*.test.*
git commit -m "feat(web): SurvivorControls (map/sort links) + Pagination"
```

---

### Task 7: Web — routes, board assembly, and SEO metadata

**Files:**
- Create: `apps/web/src/app/survivors/page.tsx` (combined board)
- Create: `apps/web/src/app/survivors/[map]/page.tsx` (single-map board)
- Create: `apps/web/src/components/survivors/survivors-board.tsx` (shared assembly: header, controls, list, empty state, pagination, JSON-LD)
- Create: `apps/web/src/lib/survivor-metadata.ts` (pure: title/description/canonical/prev-next/OG builder from `{ slug, sort, page, leaderName }`)
- Test: `apps/web/src/lib/survivor-metadata.test.ts`, `apps/web/src/components/survivors/survivors-board.test.tsx`

**Interfaces:**
- Consumes: `getSurvivors` (`@/lib/api`), `SurvivorControls`, `SurvivorRow`, `Pagination`, `boardHref`; active map tabs (fetch active slugs — reuse `MAP_SLUGS`/server list already in `apps/web/src/lib/servers.ts`, or derive from a small `/api/servers` fetch).
- Produces: `SurvivorsBoard({ page: SurvivorsPage; slug: string | null; tabs })`; `buildSurvivorMetadata(args): Metadata`.

- [ ] **Step 1: Write failing tests**

```ts
// survivor-metadata.test.ts
test("self-referential canonical, page in title, prev/next", () => {
  const m = buildSurvivorMetadata({ slug: "chernarus", sort: "kills", page: 2, total: 60, pageSize: 25, leaderName: "Chad" });
  expect(m.alternates?.canonical).toBe("/survivors/chernarus?page=2");
  expect(String(m.title)).toMatch(/Chernarus/);
  expect(String(m.title)).toMatch(/Page 2/);
  // prev/next surfaced (via alternates or other) — assert your chosen field
});
test("combined board default page has clean canonical and OG", () => {
  const m = buildSurvivorMetadata({ slug: null, sort: "kills", page: 1, total: 10, pageSize: 25, leaderName: "Chad" });
  expect(m.alternates?.canonical).toBe("/survivors");
  expect(m.openGraph?.title).toBeDefined();
});
```
```tsx
// survivors-board.test.tsx
test("renders rows and an empty state", () => {
  const empty = { rows: [], total: 0, page: 1, pageSize: 25, sort: "kills" as const };
  render(<SurvivorsBoard page={empty} slug="sakhal" tabs={[]} />);
  expect(screen.getByText(/no survivors/i)).toBeInTheDocument();
});
test("shows map badges only on the combined board", () => {
  const page = { rows: [{ gamertag: "Chad", map: "chernarusplus", slug: "chernarus", timeAliveSeconds: 3600, killsThisLife: 3, longestKillMeters: 200, character: null }], total: 1, page: 1, pageSize: 25, sort: "kills" as const };
  const { rerender } = render(<SurvivorsBoard page={page} slug={null} tabs={[]} />);
  expect(screen.getByText(/chernarus/i)).toBeInTheDocument();     // badge on combined
  rerender(<SurvivorsBoard page={page} slug="chernarus" tabs={[]} />);
  // on single-map board, the slug appears in controls but not as a per-row badge — assert via testid on the row badge
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @onelife/web test survivor-metadata survivors-board` → FAIL.

- [ ] **Step 3: Implement**
- `survivor-metadata.ts`: pure `buildSurvivorMetadata` returning a Next `Metadata` — title (`Top {Map} survivors by {sortLabel}` + `· Page N` when N>1), description, `alternates.canonical = boardHref(slug, sort, page)` (self-referential; note `boardHref` omits `sort=kills`/`page=1`), `openGraph`/`twitter` (title/description/url), and prev/next (via `alternates` or an `other` field — pick one and keep tests aligned). Optionally emit an `ItemList` JSON-LD object for the board component to render in a `<script type="application/ld+json">`.
- `survivors-board.tsx`: header (`font-display` amber title + alive count subtitle), `<SurvivorControls>`, the ranked list of `<SurvivorRow row rank showMap={slug === null}>` (rank = `(page-1)*pageSize + i + 1`), empty state ("No survivors alive right now."), `<Pagination>`, and the JSON-LD script.
- `survivors/page.tsx` (async server component): read `searchParams` (`sort`, `page`), fetch `getSurvivors({ sort, page })`, build tabs, render `<SurvivorsBoard slug={null} …>`; export `generateMetadata` using `buildSurvivorMetadata`.
- `survivors/[map]/page.tsx`: resolve/validate `params.map` against active slugs; unknown → `notFound()`. Fetch `getSurvivors({ slug: map, sort, page })`, render `<SurvivorsBoard slug={map} …>`; `generateMetadata` per map. (Optional `generateStaticParams` from active slugs.)

- [ ] **Step 4: Run to verify pass** — same command → PASS. Then full web suite `pnpm --filter @onelife/web test`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/survivors/ apps/web/src/components/survivors/survivors-board.tsx apps/web/src/lib/survivor-metadata.ts apps/web/src/components/survivors/survivors-board.test.tsx apps/web/src/lib/survivor-metadata.test.ts
git commit -m "feat(web): /survivors routes, board assembly, SEO/OG metadata"
```

---

### Task 8: Web — masthead `Survivors` nav link

**Files:**
- Modify: `apps/web/src/components/header.tsx`
- Test: `apps/web/src/components/header.test.tsx` (add a case if the file exists; else add a minimal one)

**Interfaces:** none new.

- [ ] **Step 1: Write failing test**

```tsx
test("masthead links to the survivors board", () => {
  render(<Masthead />); // reuse existing render/harness in header.test.tsx (mock session/hooks as it already does)
  expect(screen.getByRole("link", { name: /survivors/i })).toHaveAttribute("href", "/survivors");
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @onelife/web test header` → FAIL.
- [ ] **Step 3: Implement** — insert `<Link href="/survivors" className="text-sm text-dim hover:text-bone">Survivors</Link>` between the logo and the account CTA (CTA keeps `ml-auto`).
- [ ] **Step 4: Run to verify pass** — same → PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/header.tsx apps/web/src/components/header.test.tsx
git commit -m "feat(web): add Survivors nav link to masthead"
```

---

### Task 9: Docs — CHANGELOG + CLAUDE.md (pre-PR, last)

**Files:**
- Modify: `CHANGELOG.md` (bullet under `[Unreleased] › Added`)
- Modify: `CLAUDE.md` (document the new page + routes under the web app / SP-context)

- [ ] **Step 1: Full test + typecheck sweep**

Run: `pnpm turbo run typecheck` and `pnpm turbo run test --concurrency=1` (with `TEST_DATABASE_URL`). Expected: all pass.

- [ ] **Step 2: Update `CHANGELOG.md`** — add under `### Added`:
`- **Survivors leaderboard (`/survivors`).** Public, mobile-first live leaderboard of currently-alive survivors, one row per (player × map), ranked by kills / time alive / longest kill (this life). Server-rendered map routes (`/survivors`, `/survivors/:map`) with query-param sort + pagination and per-page SEO/OG metadata. New `getAliveSurvivors` read-model + public `GET /survivors[/:slug]` API.`

- [ ] **Step 3: Update `CLAUDE.md`** — under the web app description (or a new "Survivors leaderboard" note): routes `/survivors` + `/survivors/[map]`, alive-only semantics (open qualified life), fields, `getAliveSurvivors` read-model, and that avatars map via `rosterByClass(class).name` → `/characters/<name>.webp`.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: changelog + CLAUDE.md for survivors leaderboard"
```

- [ ] **Step 5: Open the PR** via `finishing-a-feature` (targets `develop`; guard requires the CHANGELOG + CLAUDE updates just made).

---

## Self-Review

**Spec coverage:** routing (Task 7) · query-param sort (Tasks 3,6,7) · server pagination links (Task 6) · alive+qualified semantics (Task 1) · this-life kills/longest (Task 1) · time-alive playtime (Task 1) · character/avatar + fallback (Tasks 2,5) · per-(player×map) rows & map filter (Task 1) · map badge combined-only (Tasks 5,7) · API public routes + 404 (Task 3) · SEO/OG/canonical/prev-next (Task 7) · masthead nav (Task 8) · gamertag filter DEFERRED (not built — correct) · docs (Task 9). No gaps.

**Placeholder scan:** implementation steps point at exact existing symbols to mirror (`getLeaderboard`, `getLifeCharacter`, `livePlaytime`, `isLifeQualified`, `resolveServerBySlug`, `rosterByClass`) rather than "handle it" hand-waving; tests are concrete. The two areas the executor must verify against real code — the Drizzle SQL shape (Task 1 Step 3) and the exact sighting/rollup test-helper names (Task 2) — are called out explicitly.

**Type consistency:** `SurvivorRow`/`SurvivorsPage`/`SurvivorSort`/`SurvivorCharacter` identical across read-model (Task 1), web types (Task 4), and component props (Tasks 5–7). `boardHref` signature consistent across Tasks 6–7. `getAliveSurvivors(db, {slug?,sort,page,pageSize?}, now)` consistent across Tasks 1–3.
