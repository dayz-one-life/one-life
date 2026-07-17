# R5a — Newsdesk + Obituaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn every qualified death into an LLM-written obituary via a dry-run-gated background worker, and render those obituaries as a public feed + full interior article, retiring the static teaser.

**Architecture:** A new `articles` table stores one row per (kind, life). A new `apps/newsdesk` sweep worker (co-located pure `voice`/`prompt`/`facts`/`generate` modules, mirroring the enforcer's `decide.ts`) selects qualified deaths lacking a published obituary, builds facts from R4 read-models, generates prose via OpenRouter behind a dry-run gate, and upserts the article. Two read-models (`getPublishedObituaries`, `getObituaryBySlug`) back two public API routes, consumed by an `/obituaries` feed and an `/obituaries/[slug]` interior article on the web.

**Tech Stack:** TypeScript/ESM, Drizzle + Postgres, Fastify + Zod, Next.js 15 App Router + React 19 + Tailwind v3, Vitest 2, pino, OpenRouter chat-completions (plain `fetch`).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-17-r5a-newsdesk-obituaries-design.md` — every task's requirements implicitly include it.
- **Voice-first:** the page renders **only published obituaries**. No dry placeholder rows, no templated fallback prose, ever. A death without a published article simply isn't listed.
- **Receipts are real:** the Rap Sheet and the Final Reload are **facts only** (R4 read-models). The LLM writes voice, never invents events, stats, kills, or locations.
- **Fog Rule:** map/dateline only; **no coordinates** anywhere (consistent with R4). Deaths are past-tense so cause/killer/weapon are fair.
- **Ethics bans (hard):** no slurs; no real-person attacks; punch **up** at big killers, never **down** at fresh-spawn victims; pull-quote attributions stay anonymous/in-voice; no sincerity clichés / wink / corporate-speak.
- **Dry-run default:** the worker ships `NEWSDESK_DRY_RUN` defaulting **true** (no OpenRouter call, no write) — flip to `false` to spend. Mirrors `enforcer`/`granter`.
- **Durable table:** `articles` is NEVER added to `apps/projector/src/rebuild.ts`'s `TRUNCATE` list; it IS added to `packages/test-support/src/global-setup.ts`'s `APP_TABLES`.
- **Idempotency:** one obituary per death — unique `(kind, life_id)`. Re-runs never duplicate.
- **Test command:** package-scoped `pnpm --filter <name> test` / `pnpm --filter <name> typecheck`; whole repo `pnpm turbo run test --concurrency=1` + `pnpm turbo run typecheck`. DB suites need `TEST_DATABASE_URL` (name must end `_test`); this dev machine's Postgres is on host **:5434** (`docker compose up -d postgres`, gitignored override). ESM import idiom: `.js` extensions on TS source imports.
- **No `Date.now()` in pure/render code** — pass `now: Date` explicitly (repo convention).

---

## File map

- **Create** `packages/db` migration `drizzle/0009_create_articles.sql` (+ meta) via `db:generate`.
- **Modify** `packages/db/src/schema.ts` (add `articles`), `packages/test-support/src/global-setup.ts` (`APP_TABLES`).
- **Create** `packages/read-models/src/obituary-articles.ts` (+ barrel line): `getPublishedObituaries`, `getObituaryBySlug`.
- **Create** `apps/newsdesk/` — `package.json`, `tsconfig.json`, `vitest.config.ts`, `Dockerfile`, `src/{pg-store,facts,voice,prompt,openrouter,generate,config,tick,main}.ts`, `test/*`.
- **Modify** `apps/api/src/routes/obituaries.ts` (repurpose feed + add `:slug`).
- **Modify** `apps/web/src/lib/{types,api,seo}.ts`; **create** `apps/web/src/lib/obituary-format.ts` (+ href).
- **Create** `apps/web/src/app/obituaries/{page,loading}.tsx`, `.../obituaries/[slug]/{page,opengraph-image}.tsx`, `apps/web/src/components/obituaries/*`, `apps/web/src/components/skeletons.tsx` (add `ObituariesSkeleton`).

---

## Task 1: `articles` table + migration + test truncation

**Files:**
- Modify: `packages/db/src/schema.ts` (append after the `characters` table, end of file)
- Create: `packages/db/drizzle/0009_create_articles.sql` + `drizzle/meta/0009_snapshot.json` + updated `drizzle/meta/_journal.json` (generated, not hand-edited)
- Modify: `packages/test-support/src/global-setup.ts` (add `"articles"` to `APP_TABLES`)
- Test: `packages/read-models/test/articles-schema.test.ts` (schema smoke test)

**Interfaces:**
- Produces: the `articles` Drizzle table, importable as `import { articles } from "@onelife/db"`. Columns (JS keys): `id, kind, status, slug, playerId, serverId, lifeId, gamertag, map, mapSlug, lifeNumber, deathAt, timeAliveSeconds, kills, longestKillMeters, cause, headline, lede, body, pullQuoteText, pullQuoteAttribution, tags, facts, promptVersion, model, attempts, lastError, imageUrl, imagePrompt, imageKind, generatedAt, createdAt`.

> **TDD order (execute test-first):** write the schema smoke test in **Step 5 FIRST** and run `pnpm --filter @onelife/read-models test -- articles-schema` — Expected: **FAIL** with `relation "articles" does not exist` (the table/migration don't exist yet). Only then do Steps 1–4 (schema + APP_TABLES + migration), and Step 6 re-runs it to green. The steps are ordered schema-first only for reading; the fail-first run must happen before the schema lands.

- [ ] **Step 1: Add the `articles` table to `schema.ts`** (append at end of file — `bigserial, integer, text, timestamp, jsonb, doublePrecision, uniqueIndex, index` are already imported):

```ts
// ── Content engine (R5). Durable side-table — generated editorial content (obituaries first);
// never truncated by projector rebuild. One row per (kind, life); a failed generation writes a
// status='failed' stub (content null, attempts bumped) so retries are bounded. ──
export const articles = pgTable("articles", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  kind: text("kind").notNull(),                                       // 'obituary'
  status: text("status").notNull().default("published"),             // published|failed
  slug: text("slug"),                                                // null on a failed stub
  playerId: bigint("player_id", { mode: "number" }).notNull().references(() => players.id),
  serverId: integer("server_id").notNull().references(() => servers.id),
  lifeId: bigint("life_id", { mode: "number" }).notNull().references(() => lives.id),
  gamertag: text("gamertag").notNull(),
  map: text("map").notNull(),                                         // servers.map codename
  mapSlug: text("map_slug"),                                         // servers.slug (nullable)
  lifeNumber: integer("life_number").notNull(),
  deathAt: timestamp("death_at", { withTimezone: true }).notNull(),  // lives.ended_at — feed ordering
  timeAliveSeconds: integer("time_alive_seconds").notNull().default(0),
  kills: integer("kills").notNull().default(0),
  longestKillMeters: doublePrecision("longest_kill_meters"),
  cause: text("cause"),
  headline: text("headline"),
  lede: text("lede"),
  body: text("body"),
  pullQuoteText: text("pull_quote_text"),
  pullQuoteAttribution: text("pull_quote_attribution"),
  tags: text("tags").array(),
  facts: jsonb("facts"),                                             // ObituaryFacts snapshot
  promptVersion: text("prompt_version"),
  model: text("model"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  imageUrl: text("image_url"),                                       // reserved for R5c
  imagePrompt: text("image_prompt"),                                // reserved for R5c
  imageKind: text("image_kind"),                                    // reserved for R5c
  generatedAt: timestamp("generated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqKindLife: uniqueIndex("articles_kind_life_uniq").on(t.kind, t.lifeId),
  uniqSlug: uniqueIndex("articles_slug_uniq").on(t.slug),
  feedIdx: index("articles_kind_status_death_idx").on(t.kind, t.status, t.deathAt),
}));
```

- [ ] **Step 2: Add `"articles"` to `APP_TABLES`** in `packages/test-support/src/global-setup.ts` (append to the array, e.g. after `"characters"`) so tests get a clean table each run:

```ts
  "rpt_files", "character_sightings", "characters", "articles",
```

- [ ] **Step 3: Generate the migration (offline, deterministic from schema).** Run from repo root:

```bash
pnpm --filter @onelife/db exec drizzle-kit generate --name=create_articles
```
Expected: writes `packages/db/drizzle/0009_create_articles.sql`, `drizzle/meta/0009_snapshot.json`, and appends `{ "idx": 9, ... "tag": "0009_create_articles" ... }` to `drizzle/meta/_journal.json`. **Do NOT hand-edit the snapshot/journal.** The emitted `.sql` must contain `CREATE TABLE IF NOT EXISTS "articles"` with the 3 indexes and 3 FK `DO $$ ... duplicate_object ...` blocks. If `drizzle-kit` cannot run in this environment, STOP and report BLOCKED (do not hand-author the meta files — a mismatched snapshot breaks the next migration).

- [ ] **Step 4: Do NOT touch `apps/projector/src/rebuild.ts`.** Verify (read it) that its `TRUNCATE TABLE` list does not and will not include `articles` — obituaries are durable.

- [ ] **Step 5: Write the schema smoke test** at `packages/read-models/test/articles-schema.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, articles } from "@onelife/db";
import { eq } from "drizzle-orm";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 52e7;
let serverId: number, lifeId: number, playerId: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "ar", map: "chernarusplus", slug: `ar-${svc}`, active: true }).returning();
  serverId = s!.id;
  const [p] = await db.insert(players).values({ gamertag: `ar-${svc}` }).returning();
  playerId = p!.id;
  const [l] = await db.insert(lives).values({ serverId, playerId, lifeNumber: 1, startedAt: new Date("2026-07-10T00:00:00Z"), endedAt: new Date("2026-07-10T02:00:00Z"), deathCause: "pvp", playtimeSeconds: 7200 }).returning();
  lifeId = l!.id;
});
afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(players).where(eq(players.id, playerId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("articles table", () => {
  it("stores a published obituary row with tags + facts jsonb and reads it back", async () => {
    await db.insert(articles).values({
      kind: "obituary", status: "published", slug: `the-end-${lifeId}`,
      playerId, serverId, lifeId, gamertag: `ar-${svc}`, map: "chernarusplus", mapSlug: `ar-${svc}`,
      lifeNumber: 1, deathAt: new Date("2026-07-10T02:00:00Z"), timeAliveSeconds: 7200, kills: 3,
      longestKillMeters: 210.5, cause: "pvp", headline: "H", lede: "L", body: "B",
      pullQuoteText: "q", pullQuoteAttribution: "a rival", tags: ["Obituaries", "Chernarus"],
      facts: { sessions: 2, killerGamertag: "Killer", weapon: "M4" }, promptVersion: "obituary-v1",
      model: "test", attempts: 1, generatedAt: new Date("2026-07-10T03:00:00Z"),
    });
    const [row] = await db.select().from(articles).where(eq(articles.lifeId, lifeId));
    expect(row!.tags).toEqual(["Obituaries", "Chernarus"]);
    expect((row!.facts as { sessions: number }).sessions).toBe(2);
    expect(row!.imageUrl).toBeNull(); // reserved R5c column present + nullable
  });
});
```

- [ ] **Step 6: Run the test.** `pnpm --filter @onelife/read-models test -- articles-schema` — Expected: PASS (globalSetup runs `migrateDb`, applying `0009`). Then `pnpm --filter @onelife/db typecheck` — Expected: clean.

- [ ] **Step 7: Commit** — `git add packages/db packages/test-support packages/read-models/test/articles-schema.test.ts && git commit -m "feat(db): articles table + migration for the content engine"`

---

## Task 2: Published-obituary read-models

**Files:**
- Create: `packages/read-models/src/obituary-articles.ts`
- Modify: `packages/read-models/src/index.ts` (add barrel line)
- Test: `packages/read-models/test/obituary-articles.test.ts`

**Interfaces:**
- Consumes: `articles` (Task 1).
- Produces:
  - `OBITUARIES_FEED_PAGE_SIZE = 20`
  - `interface ObituaryCard { slug: string; gamertag: string; map: string; mapSlug: string | null; lifeNumber: number; headline: string; lede: string; tags: string[]; timeAliveSeconds: number; kills: number; longestKillMeters: number | null; cause: string | null; deathAt: Date; }`
  - `interface ObituariesFeed { rows: ObituaryCard[]; total: number; page: number; pageSize: number; }`
  - `interface ObituaryArticle extends ObituaryCard { body: string; pullQuote: { text: string; attribution: string } | null; sessions: number; killerGamertag: string | null; weapon: string | null; }`
  - `getPublishedObituaries(db, { page, pageSize? }): Promise<ObituariesFeed>`
  - `getObituaryBySlug(db, slug): Promise<ObituaryArticle | null>`

- [ ] **Step 1: Write the failing test** at `packages/read-models/test/obituary-articles.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, articles } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { getPublishedObituaries, getObituaryBySlug } from "../src/obituary-articles.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 52e7;
const t0 = new Date("2026-07-12T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
let serverId: number;
const pids: number[] = [];
const lifeIds: number[] = [];

async function seedLife(tag: string, endH: number) {
  const [p] = await db.insert(players).values({ gamertag: tag }).returning();
  pids.push(p!.id);
  const [l] = await db.insert(lives).values({ serverId, playerId: p!.id, lifeNumber: 1, startedAt: hrs(endH - 1), endedAt: hrs(endH), deathCause: "pvp", playtimeSeconds: 3600 }).returning();
  lifeIds.push(l!.id);
  return { playerId: p!.id, lifeId: l!.id };
}

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "ob", map: "chernarusplus", slug: `oa-${svc}`, active: true }).returning();
  serverId = s!.id;
  const early = await seedLife(`oa-early-${svc}`, 2);
  const late = await seedLife(`oa-late-${svc}`, 5);
  const failed = await seedLife(`oa-failed-${svc}`, 9);
  const base = (o: { playerId: number; lifeId: number }, over: Record<string, unknown>) => ({
    kind: "obituary", playerId: o.playerId, serverId, lifeId: o.lifeId, gamertag: `oa-${svc}`,
    map: "chernarusplus", mapSlug: `oa-${svc}`, lifeNumber: 1, ...over,
  });
  await db.insert(articles).values([
    base(early, { status: "published", slug: `early-${early.lifeId}`, deathAt: hrs(2), timeAliveSeconds: 3600, kills: 1, longestKillMeters: 12, cause: "pvp", headline: "Early Death", lede: "e-lede", body: "e-body", tags: ["Obituaries", "Chernarus"], pullQuoteText: "q1", pullQuoteAttribution: "a coast source", facts: { sessions: 2, killerGamertag: "K1", weapon: "AK" }, generatedAt: hrs(2) }),
    base(late, { status: "published", slug: `late-${late.lifeId}`, deathAt: hrs(5), timeAliveSeconds: 3600, kills: 4, longestKillMeters: 300, cause: "pvp", headline: "Late Death", lede: "l-lede", body: "l-body", tags: ["Obituaries"], facts: { sessions: 1, killerGamertag: null, weapon: null }, generatedAt: hrs(5) }),
    base(failed, { status: "failed", slug: null, deathAt: hrs(9), attempts: 3, lastError: "boom" }),
  ]);
});
afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(lives).where(inArray(lives.id, lifeIds));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("getPublishedObituaries", () => {
  it("returns published obituaries newest death first, excluding failed stubs", async () => {
    const res = await getPublishedObituaries(db, { page: 1, pageSize: 50 });
    const mine = res.rows.filter((r) => r.gamertag === `oa-${svc}`);
    expect(mine.map((r) => r.headline)).toEqual(["Late Death", "Early Death"]);
    expect(mine.every((r) => typeof r.slug === "string")).toBe(true);
  });
  it("paginates", async () => {
    const res = await getPublishedObituaries(db, { page: 1, pageSize: 1 });
    expect(res.pageSize).toBe(1);
    expect(res.rows).toHaveLength(1);
    expect(res.total).toBeGreaterThanOrEqual(2);
  });
});

describe("getObituaryBySlug", () => {
  it("returns the full article (body, pull quote, killer/weapon/sessions from facts)", async () => {
    const feed = await getPublishedObituaries(db, { page: 1, pageSize: 50 });
    const slug = feed.rows.find((r) => r.headline === "Early Death")!.slug;
    const a = await getObituaryBySlug(db, slug);
    expect(a).not.toBeNull();
    expect(a!.body).toBe("e-body");
    expect(a!.pullQuote).toEqual({ text: "q1", attribution: "a coast source" });
    expect(a!.sessions).toBe(2);
    expect(a!.killerGamertag).toBe("K1");
    expect(a!.weapon).toBe("AK");
  });
  it("returns null for an unknown or failed slug", async () => {
    expect(await getObituaryBySlug(db, "no-such-slug")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `pnpm --filter @onelife/read-models test -- obituary-articles` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `packages/read-models/src/obituary-articles.ts`:

```ts
import type { Database } from "@onelife/db";
import { articles } from "@onelife/db";
import { and, eq, desc, sql } from "drizzle-orm";

export const OBITUARIES_FEED_PAGE_SIZE = 20;

export interface ObituaryCard {
  slug: string;
  gamertag: string;
  map: string;
  mapSlug: string | null;
  lifeNumber: number;
  headline: string;
  lede: string;
  tags: string[];
  timeAliveSeconds: number;
  kills: number;
  longestKillMeters: number | null;
  cause: string | null;
  deathAt: Date;
}

export interface ObituariesFeed {
  rows: ObituaryCard[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ObituaryArticle extends ObituaryCard {
  body: string;
  pullQuote: { text: string; attribution: string } | null;
  sessions: number;
  killerGamertag: string | null;
  weapon: string | null;
}

type FactsSnapshot = { sessions?: number; killerGamertag?: string | null; weapon?: string | null };

const CARD_COLS = {
  slug: articles.slug,
  gamertag: articles.gamertag,
  map: articles.map,
  mapSlug: articles.mapSlug,
  lifeNumber: articles.lifeNumber,
  headline: articles.headline,
  lede: articles.lede,
  tags: articles.tags,
  timeAliveSeconds: articles.timeAliveSeconds,
  kills: articles.kills,
  longestKillMeters: articles.longestKillMeters,
  cause: articles.cause,
  deathAt: articles.deathAt,
} as const;

const publishedObituary = and(eq(articles.kind, "obituary"), eq(articles.status, "published"));

/** Published obituaries, newest death first. Paginated. Failed stubs are excluded. */
export async function getPublishedObituaries(
  db: Database,
  opts: { page: number; pageSize?: number },
): Promise<ObituariesFeed> {
  const pageSize = opts.pageSize ?? OBITUARIES_FEED_PAGE_SIZE;
  const page = Math.max(1, Math.trunc(opts.page) || 1);

  const rows = await db
    .select(CARD_COLS)
    .from(articles)
    .where(publishedObituary)
    .orderBy(desc(articles.deathAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const totalRow = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(articles)
    .where(publishedObituary);

  return {
    rows: rows.map((r) => ({
      ...r,
      slug: r.slug!,
      headline: r.headline!,
      lede: r.lede!,
      tags: r.tags ?? [],
    })),
    total: totalRow[0]?.c ?? 0,
    page,
    pageSize,
  };
}

/** A single published obituary by its slug, or null (unknown/failed). */
export async function getObituaryBySlug(db: Database, slug: string): Promise<ObituaryArticle | null> {
  const rows = await db
    .select({
      ...CARD_COLS,
      body: articles.body,
      pullQuoteText: articles.pullQuoteText,
      pullQuoteAttribution: articles.pullQuoteAttribution,
      facts: articles.facts,
    })
    .from(articles)
    .where(and(publishedObituary, eq(articles.slug, slug)))
    .limit(1);

  const r = rows[0];
  if (!r) return null;
  const facts = (r.facts ?? {}) as FactsSnapshot;
  return {
    slug: r.slug!,
    gamertag: r.gamertag,
    map: r.map,
    mapSlug: r.mapSlug,
    lifeNumber: r.lifeNumber,
    headline: r.headline!,
    lede: r.lede!,
    tags: r.tags ?? [],
    timeAliveSeconds: r.timeAliveSeconds,
    kills: r.kills,
    longestKillMeters: r.longestKillMeters,
    cause: r.cause,
    deathAt: r.deathAt,
    body: r.body ?? "",
    pullQuote: r.pullQuoteText ? { text: r.pullQuoteText, attribution: r.pullQuoteAttribution ?? "" } : null,
    sessions: facts.sessions ?? 0,
    killerGamertag: facts.killerGamertag ?? null,
    weapon: facts.weapon ?? null,
  };
}
```

- [ ] **Step 4: Add the barrel line** to `packages/read-models/src/index.ts`:

```ts
export * from "./obituary-articles.js";
```

- [ ] **Step 5: Run tests + typecheck** — `pnpm --filter @onelife/read-models test -- obituary-articles` (PASS), `pnpm --filter @onelife/read-models typecheck` (clean).

- [ ] **Step 6: Commit** — `git add packages/read-models && git commit -m "feat(read-models): published-obituary feed + by-slug queries"`

---

## Task 3: `apps/newsdesk` scaffold + DB store

**Files:**
- Create: `apps/newsdesk/package.json`, `apps/newsdesk/tsconfig.json`, `apps/newsdesk/vitest.config.ts`, `apps/newsdesk/Dockerfile`
- Create: `apps/newsdesk/src/pg-store.ts`
- Test: `apps/newsdesk/test/pg-store.test.ts`

**Interfaces:**
- Consumes: `articles`, `lives`, `players`, `servers` (`@onelife/db`); `qualifiedLifeCondition` (`@onelife/read-models`).
- Produces:
  - `interface ObituaryTarget { lifeId: number; serverId: number; playerId: number; gamertag: string; map: string; mapSlug: string | null; lifeNumber: number; endedAt: Date; }`
  - `findObituaryTargets(db, { limit, maxAttempts }): Promise<ObituaryTarget[]>` — qualified dead lives with no published obituary and no exhausted failed stub, newest death first.
  - `obituarySlug(headline: string, lifeId: number): string`
  - `interface PublishInput { target: ObituaryTarget; facts: ObituaryFacts; obituary: Obituary; promptVersion: string; model: string; now: Date; }` (types imported from Task 4/5 — see note)
  - `publishObituary(db, input: PublishInput): Promise<void>` — upsert a published row on `(kind, life_id)`.
  - `recordObituaryFailure(db, input: { target: ObituaryTarget; error: string }): Promise<void>` — upsert a `status='failed'` stub, `attempts += 1`.

> **Sequencing note:** `PublishInput` references `ObituaryFacts` (Task 4) and `Obituary` (Task 5). To keep this task self-contained and testable first, define `publishObituary` against a **structural input** it needs directly (below) — it does not import Task 4/5 types; the tick (Task 7) passes matching objects. This avoids a forward type dependency.

- [ ] **Step 1: Scaffold the package.** Create `apps/newsdesk/package.json`:

```json
{
  "name": "@onelife/newsdesk",
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

`apps/newsdesk/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`apps/newsdesk/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import { GLOBAL_SETUP_PATH } from "@onelife/test-support/setup-path";

export default defineConfig({
  test: { globalSetup: [GLOBAL_SETUP_PATH], fileParallelism: false },
});
```

`apps/newsdesk/Dockerfile`:
```dockerfile
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/newsdesk ./apps/newsdesk
RUN pnpm install --frozen-lockfile
WORKDIR /repo/apps/newsdesk
CMD ["pnpm", "start"]
```

Then run `pnpm install` from repo root so the workspace links `@onelife/newsdesk`.

- [ ] **Step 2: Write the failing test** at `apps/newsdesk/test/pg-store.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, articles } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { findObituaryTargets, publishObituary, recordObituaryFailure, obituarySlug, type ObituaryTarget } from "../src/pg-store.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 52e7;
const t0 = new Date("2026-07-13T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
let serverId: number;
const pids: number[] = [];
const lifeIds: number[] = [];

async function seedLife(tag: string, over: Record<string, unknown>) {
  const [p] = await db.insert(players).values({ gamertag: tag }).returning();
  pids.push(p!.id);
  const [l] = await db.insert(lives).values({ serverId, playerId: p!.id, lifeNumber: 1, startedAt: hrs(0), ...over }).returning();
  lifeIds.push(l!.id);
  return { playerId: p!.id, lifeId: l!.id, gamertag: tag };
}

let qualified: { playerId: number; lifeId: number; gamertag: string };
let unqualified: { playerId: number; lifeId: number; gamertag: string };

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "nd", map: "chernarusplus", slug: `nd-${svc}`, active: true }).returning();
  serverId = s!.id;
  // qualified: pvp death, 2h alive
  qualified = await seedLife(`nd-q-${svc}`, { lifeNumber: 1, endedAt: hrs(2), deathCause: "pvp", deathByGamertag: "Killer", deathWeapon: "M4", deathDistance: 90, playtimeSeconds: 7200 });
  // NOT qualified: 60s environment death, no kills
  unqualified = await seedLife(`nd-u-${svc}`, { lifeNumber: 1, endedAt: hrs(3), deathCause: "environment", playtimeSeconds: 60 });
});
afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(lives).where(inArray(lives.id, lifeIds));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

const targetFor = (o: { playerId: number; lifeId: number; gamertag: string }, endH: number): ObituaryTarget => ({
  lifeId: o.lifeId, serverId, playerId: o.playerId, gamertag: o.gamertag,
  map: "chernarusplus", mapSlug: `nd-${svc}`, lifeNumber: 1, endedAt: hrs(endH),
});

describe("obituarySlug", () => {
  it("slugifies the headline and appends the life id for uniqueness", () => {
    expect(obituarySlug("The King Is Dead. A Chicken Is Wanted.", 42)).toBe("the-king-is-dead-a-chicken-is-wanted-42");
  });
});

describe("findObituaryTargets", () => {
  it("returns qualified ungenerated deaths, excludes unqualified", async () => {
    const targets = await findObituaryTargets(db, { limit: 50, maxAttempts: 3 });
    const mine = targets.filter((t) => t.mapSlug === `nd-${svc}`);
    expect(mine.map((t) => t.gamertag)).toContain(qualified.gamertag);
    expect(mine.map((t) => t.gamertag)).not.toContain(unqualified.gamertag);
  });

  it("excludes a life that already has a published obituary", async () => {
    await publishObituary(db, {
      target: targetFor(qualified, 2),
      facts: { sessions: 1, killerGamertag: "Killer", weapon: "M4", timeAliveSeconds: 7200, kills: 0, longestKillMeters: null, cause: "pvp" },
      obituary: { headline: "Gone", lede: "l", body: "b", pullQuote: null, tags: ["Obituaries"] },
      promptVersion: "obituary-v1", model: "test", now: hrs(4),
    });
    const targets = await findObituaryTargets(db, { limit: 50, maxAttempts: 3 });
    expect(targets.find((t) => t.lifeId === qualified.lifeId)).toBeUndefined();
    const [row] = await db.select().from(articles).where(eq(articles.lifeId, qualified.lifeId));
    expect(row!.status).toBe("published");
    expect(row!.slug).toBe(`gone-${qualified.lifeId}`);
    expect(row!.attempts).toBe(1);
  });

  it("re-includes a failed life until maxAttempts, then drops it", async () => {
    const un = targetFor(unqualified, 3); // reuse row as a generic life; force qualification via a fresh qualified life
    const q2 = await seedLife(`nd-q2-${svc}`, { lifeNumber: 1, endedAt: hrs(5), deathCause: "pvp", playtimeSeconds: 7200 });
    await recordObituaryFailure(db, { target: targetFor(q2, 5), error: "boom-1" });
    let targets = await findObituaryTargets(db, { limit: 50, maxAttempts: 3 });
    expect(targets.find((t) => t.lifeId === q2.lifeId)).toBeDefined(); // attempts 1 < 3
    await recordObituaryFailure(db, { target: targetFor(q2, 5), error: "boom-2" });
    await recordObituaryFailure(db, { target: targetFor(q2, 5), error: "boom-3" });
    targets = await findObituaryTargets(db, { limit: 50, maxAttempts: 3 });
    expect(targets.find((t) => t.lifeId === q2.lifeId)).toBeUndefined(); // attempts 3 >= 3
    void un;
  });
});
```

- [ ] **Step 3: Run it to verify it fails** — `pnpm --filter @onelife/newsdesk test -- pg-store` — Expected: FAIL (module not found).

- [ ] **Step 4: Implement** `apps/newsdesk/src/pg-store.ts`:

```ts
import type { Database } from "@onelife/db";
import { articles, lives, players, servers } from "@onelife/db";
import { and, eq, desc, isNotNull, notExists, sql } from "drizzle-orm";
import { qualifiedLifeCondition } from "@onelife/read-models";

export interface ObituaryTarget {
  lifeId: number;
  serverId: number;
  playerId: number;
  gamertag: string;
  map: string;
  mapSlug: string | null;
  lifeNumber: number;
  endedAt: Date;
}

/** Structural inputs publishObituary needs — the tick passes the full ObituaryFacts object, which
 *  has these fields plus more; the extra fields ride into the `facts` jsonb at runtime. No index
 *  signature (that would make a named interface like ObituaryFacts fail to assign). */
export interface PublishFacts {
  sessions: number;
  killerGamertag: string | null;
  weapon: string | null;
  timeAliveSeconds: number;
  kills: number;
  longestKillMeters: number | null;
  cause: string | null;
}
export interface PublishObituary {
  headline: string;
  lede: string;
  body: string;
  pullQuote: { text: string; attribution: string } | null;
  tags: string[];
}
export interface PublishInput {
  target: ObituaryTarget;
  facts: PublishFacts;
  obituary: PublishObituary;
  promptVersion: string;
  model: string;
  now: Date;
}

/** Deterministic, unique per obituary (one obituary per life): slugified headline + life id. */
export function obituarySlug(headline: string, lifeId: number): string {
  const base = headline
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70)
    .replace(/-+$/g, "");
  return `${base || "obituary"}-${lifeId}`;
}

/** Qualified dead lives that need an obituary: no published article and no exhausted failed stub. */
export async function findObituaryTargets(
  db: Database,
  opts: { limit: number; maxAttempts: number },
): Promise<ObituaryTarget[]> {
  const rows = await db
    .select({
      lifeId: lives.id,
      serverId: lives.serverId,
      playerId: lives.playerId,
      gamertag: players.gamertag,
      map: servers.map,
      mapSlug: servers.slug,
      lifeNumber: lives.lifeNumber,
      endedAt: lives.endedAt,
    })
    .from(lives)
    .innerJoin(players, eq(players.id, lives.playerId))
    .innerJoin(servers, eq(servers.id, lives.serverId))
    .where(
      and(
        isNotNull(lives.endedAt),
        qualifiedLifeCondition(db),
        // no blocking article row: published, or failed-but-exhausted
        notExists(
          db
            .select({ x: sql`1` })
            .from(articles)
            .where(
              and(
                eq(articles.kind, "obituary"),
                eq(articles.lifeId, lives.id),
                sql`(${articles.status} = 'published' OR ${articles.attempts} >= ${opts.maxAttempts})`,
              ),
            ),
        ),
      ),
    )
    .orderBy(desc(lives.endedAt))
    .limit(opts.limit);

  return rows.map((r) => ({ ...r, endedAt: r.endedAt! }));
}

const IDENTITY = (t: ObituaryTarget, deathAt: Date) => ({
  kind: "obituary" as const,
  playerId: t.playerId,
  serverId: t.serverId,
  lifeId: t.lifeId,
  gamertag: t.gamertag,
  map: t.map,
  mapSlug: t.mapSlug,
  lifeNumber: t.lifeNumber,
  deathAt,
});

/** Upsert a published obituary on (kind, life_id). Bumps attempts, sets status='published'. */
export async function publishObituary(db: Database, input: PublishInput): Promise<void> {
  const { target: t, facts, obituary: o } = input;
  const values = {
    ...IDENTITY(t, t.endedAt),
    status: "published" as const,
    slug: obituarySlug(o.headline, t.lifeId),
    timeAliveSeconds: facts.timeAliveSeconds,
    kills: facts.kills,
    longestKillMeters: facts.longestKillMeters,
    cause: facts.cause,
    headline: o.headline,
    lede: o.lede,
    body: o.body,
    pullQuoteText: o.pullQuote?.text ?? null,
    pullQuoteAttribution: o.pullQuote?.attribution ?? null,
    tags: o.tags,
    facts: facts as unknown,
    promptVersion: input.promptVersion,
    model: input.model,
    generatedAt: input.now,
  };
  await db
    .insert(articles)
    .values({ ...values, attempts: 1 })
    .onConflictDoUpdate({
      target: [articles.kind, articles.lifeId],
      set: { ...values, attempts: sql`${articles.attempts} + 1`, lastError: null },
    });
}

/** Upsert a failed stub on (kind, life_id): attempts += 1, status='failed'. */
export async function recordObituaryFailure(
  db: Database,
  input: { target: ObituaryTarget; error: string },
): Promise<void> {
  const id = IDENTITY(input.target, input.target.endedAt);
  await db
    .insert(articles)
    .values({ ...id, status: "failed", attempts: 1, lastError: input.error })
    .onConflictDoUpdate({
      target: [articles.kind, articles.lifeId],
      set: { status: "failed", attempts: sql`${articles.attempts} + 1`, lastError: input.error },
    });
}
```

- [ ] **Step 5: Run tests + typecheck** — `pnpm --filter @onelife/newsdesk test -- pg-store` (PASS), `pnpm --filter @onelife/newsdesk typecheck` (clean).

- [ ] **Step 6: Commit** — `git add apps/newsdesk pnpm-lock.yaml && git commit -m "feat(newsdesk): scaffold + obituary target/publish/failure store"`

---

## Task 4: Obituary facts derivation (pure)

**Files:**
- Create: `apps/newsdesk/src/facts.ts`
- Test: `apps/newsdesk/test/facts.test.ts`

**Interfaces:**
- Consumes: `ObituaryTarget` (Task 3, `../src/pg-store.js`); `LifeTimeline` (`@onelife/read-models`).
- Produces:
  - `interface ObituaryFacts { gamertag: string; map: string; mapSlug: string | null; lifeNumber: number; timeAliveSeconds: number; timeAliveLabel: string; kills: number; longestKillMeters: number | null; sessions: number; cause: string | null; causeCategory: "pvp" | "environment" | "unknown"; killerGamertag: string | null; weapon: string | null; isLegend: boolean; freshSpawnVictim: boolean; endedAt: string; }`
  - `LEGEND_KILLS = 20`, `LEGEND_SECONDS = 604800`, `FRESH_SPAWN_SECONDS = 1800`
  - `buildObituaryFacts(target: ObituaryTarget, timeline: LifeTimeline): ObituaryFacts`
  - `timeAliveLabel(seconds: number): string`

- [ ] **Step 1: Write the failing test** at `apps/newsdesk/test/facts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildObituaryFacts, timeAliveLabel } from "../src/facts.js";
import type { ObituaryTarget } from "../src/pg-store.js";

const target: ObituaryTarget = {
  lifeId: 1, serverId: 1, playerId: 1, gamertag: "Boots", map: "chernarusplus",
  mapSlug: "chernarus", lifeNumber: 3, endedAt: new Date("2026-07-10T02:00:00Z"),
};

function timeline(over: Partial<{ life: Record<string, unknown>; kills: unknown[]; sessions: unknown[] }> = {}) {
  return {
    life: { deathCause: "pvp", deathByGamertag: "Sn1per", deathWeapon: "M4", playtimeSeconds: 7200, ...(over.life ?? {}) },
    sessions: over.sessions ?? [{}, {}],
    kills: over.kills ?? [{ distanceMeters: 120 }, { distanceMeters: 300 }, { distanceMeters: null }],
    character: null,
    qualifiedAt: null,
  } as unknown as import("@onelife/read-models").LifeTimeline;
}

describe("timeAliveLabel", () => {
  it("uses days over 24h, else h/m", () => {
    expect(timeAliveLabel(7200)).toBe("2h 0m");
    expect(timeAliveLabel(90000)).toBe("1d 1h");
    expect(timeAliveLabel(90)).toBe("1m");
  });
});

describe("buildObituaryFacts", () => {
  it("derives kills, longest kill, sessions, cause category, killer, weapon", () => {
    const f = buildObituaryFacts(target, timeline());
    expect(f.kills).toBe(3);
    expect(f.longestKillMeters).toBe(300);
    expect(f.sessions).toBe(2);
    expect(f.causeCategory).toBe("pvp");
    expect(f.killerGamertag).toBe("Sn1per");
    expect(f.weapon).toBe("M4");
    expect(f.timeAliveSeconds).toBe(7200);
    expect(f.endedAt).toBe("2026-07-10T02:00:00.000Z");
  });

  it("flags a legend by kills", () => {
    const f = buildObituaryFacts(target, timeline({ kills: Array.from({ length: 25 }, () => ({ distanceMeters: 10 })) }));
    expect(f.isLegend).toBe(true);
  });

  it("flags a fresh-spawn victim (short pvp life) and NOT a legend", () => {
    const f = buildObituaryFacts(target, timeline({ life: { deathCause: "pvp", deathByGamertag: "Camper", deathWeapon: "SKS", playtimeSeconds: 600 }, kills: [] }));
    expect(f.freshSpawnVictim).toBe(true);
    expect(f.isLegend).toBe(false);
  });

  it("classifies a non-pvp death as environment, killer null", () => {
    const f = buildObituaryFacts(target, timeline({ life: { deathCause: "bled_out", deathByGamertag: null, deathWeapon: null, playtimeSeconds: 3600 }, kills: [] }));
    expect(f.causeCategory).toBe("environment");
    expect(f.killerGamertag).toBeNull();
    expect(f.freshSpawnVictim).toBe(false);
  });

  it("classifies a missing cause as unknown", () => {
    const f = buildObituaryFacts(target, timeline({ life: { deathCause: null, deathByGamertag: null, deathWeapon: null, playtimeSeconds: 3600 }, kills: [] }));
    expect(f.causeCategory).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `pnpm --filter @onelife/newsdesk test -- facts` — Expected: FAIL.

- [ ] **Step 3: Implement** `apps/newsdesk/src/facts.ts`:

```ts
import type { LifeTimeline } from "@onelife/read-models";
import type { ObituaryTarget } from "./pg-store.js";

export const LEGEND_KILLS = 20;
export const LEGEND_SECONDS = 604800; // 7 days
export const FRESH_SPAWN_SECONDS = 1800; // 30 min

export interface ObituaryFacts {
  gamertag: string;
  map: string;
  mapSlug: string | null;
  lifeNumber: number;
  timeAliveSeconds: number;
  timeAliveLabel: string;
  kills: number;
  longestKillMeters: number | null;
  sessions: number;
  cause: string | null;
  causeCategory: "pvp" | "environment" | "unknown";
  killerGamertag: string | null;
  weapon: string | null;
  isLegend: boolean;
  freshSpawnVictim: boolean;
  endedAt: string;
}

/** Human duration: days once past 24h, else "Hh Mm", else "Mm". */
export function timeAliveLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const days = Math.floor(s / 86400);
  if (days >= 1) {
    const h = Math.floor((s % 86400) / 3600);
    return h ? `${days}d ${h}h` : `${days}d`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** Compose the factual snapshot the obituary prompt and Rap Sheet are built from. */
export function buildObituaryFacts(target: ObituaryTarget, timeline: LifeTimeline): ObituaryFacts {
  const life = timeline.life;
  const kills = timeline.kills.length;
  const longestKillMeters = timeline.kills.reduce<number | null>((max, k) => {
    if (k.distanceMeters == null) return max;
    return max == null || k.distanceMeters > max ? k.distanceMeters : max;
  }, null);
  const timeAliveSeconds = life.playtimeSeconds ?? 0;
  const cause = life.deathCause;
  const killerGamertag = life.deathByGamertag ?? null;
  const causeCategory: ObituaryFacts["causeCategory"] =
    cause === "pvp" || killerGamertag ? "pvp" : cause ? "environment" : "unknown";

  return {
    gamertag: target.gamertag,
    map: target.map,
    mapSlug: target.mapSlug,
    lifeNumber: target.lifeNumber,
    timeAliveSeconds,
    timeAliveLabel: timeAliveLabel(timeAliveSeconds),
    kills,
    longestKillMeters,
    sessions: timeline.sessions.length,
    cause,
    causeCategory,
    killerGamertag,
    weapon: life.deathWeapon ?? null,
    isLegend: kills >= LEGEND_KILLS || timeAliveSeconds >= LEGEND_SECONDS,
    freshSpawnVictim: causeCategory === "pvp" && timeAliveSeconds < FRESH_SPAWN_SECONDS,
    endedAt: target.endedAt.toISOString(),
  };
}
```

- [ ] **Step 4: Run tests + typecheck** — `pnpm --filter @onelife/newsdesk test -- facts` (PASS), `pnpm --filter @onelife/newsdesk typecheck` (clean).

- [ ] **Step 5: Commit** — `git add apps/newsdesk/src/facts.ts apps/newsdesk/test/facts.test.ts && git commit -m "feat(newsdesk): obituary facts derivation"`

---

## Task 5: Voice + prompt builder + output parser (pure)

**Files:**
- Create: `apps/newsdesk/src/voice.ts` (the system-prompt constant)
- Create: `apps/newsdesk/src/prompt.ts` (builder + parser + `Obituary` type)
- Test: `apps/newsdesk/test/prompt.test.ts`

**Interfaces:**
- Consumes: `ObituaryFacts` (Task 4).
- Produces:
  - `OBITUARY_PROMPT_VERSION = "obituary-v1"`
  - `interface Obituary { headline: string; lede: string; body: string; pullQuote: { text: string; attribution: string } | null; tags: string[]; }`
  - `buildObituaryPrompt(facts: ObituaryFacts): { system: string; user: string }`
  - `parseObituary(raw: string): Obituary` — throws on malformed/empty/invalid-shape.
  - `causeCategoryTag(cat): string`, `composeTags(facts: ObituaryFacts, llmTags: string[]): string[]` — the **deterministic** stored tag set (`Obituaries` + map label + cause category + ≤1 LLM flavor tag); the LLM never controls the reserved tags.
  - `OBITUARY_SYSTEM` (string, from `voice.ts`).

- [ ] **Step 1: Write the failing test** at `apps/newsdesk/test/prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildObituaryPrompt, parseObituary, composeTags, OBITUARY_PROMPT_VERSION } from "../src/prompt.js";
import type { ObituaryFacts } from "../src/facts.js";

const facts: ObituaryFacts = {
  gamertag: "xX_Sn1per_Xx", map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 4,
  timeAliveSeconds: 3456000, timeAliveLabel: "40d", kills: 212, longestKillMeters: 410,
  sessions: 30, cause: "pvp", causeCategory: "pvp", killerGamertag: "Chicken", weapon: "Reload",
  isLegend: true, freshSpawnVictim: false, endedAt: "2026-07-10T22:16:00.000Z",
};

describe("buildObituaryPrompt", () => {
  it("puts the voice + JSON contract in system and the facts in user", () => {
    const { system, user } = buildObituaryPrompt(facts);
    expect(system).toMatch(/deadpan/i);
    expect(system).toMatch(/Fog Rule/i);
    expect(system).toMatch(/json/i);
    expect(user).toContain("xX_Sn1per_Xx");
    expect(user).toContain("Chernarus"); // labeled map, not codename
    expect(user).toContain("212");
    expect(user).toMatch(/legend/i); // isLegend -> reverent-tone directive
  });

  it("directs protective framing for a fresh-spawn victim", () => {
    const { user } = buildObituaryPrompt({ ...facts, isLegend: false, freshSpawnVictim: true, kills: 0, killerGamertag: "Camper" });
    expect(user).toMatch(/protect|dignity|victim/i);
  });
});

describe("parseObituary", () => {
  const valid = JSON.stringify({
    headline: "The King Is Dead", lede: "He arrived with a flare.", body: "He left 212 kills.",
    pullQuote: { text: "You do not get a second life.", attribution: "a rival" }, tags: ["Obituaries", "Chernarus"],
  });

  it("parses a valid obituary object", () => {
    const o = parseObituary(valid);
    expect(o.headline).toBe("The King Is Dead");
    expect(o.pullQuote).toEqual({ text: "You do not get a second life.", attribution: "a rival" });
    expect(o.tags).toEqual(["Obituaries", "Chernarus"]);
  });

  it("accepts a null pull quote", () => {
    const o = parseObituary(JSON.stringify({ headline: "H", lede: "L", body: "B", pullQuote: null, tags: ["Obituaries"] }));
    expect(o.pullQuote).toBeNull();
  });

  it("throws on non-JSON", () => {
    expect(() => parseObituary("not json at all")).toThrow();
  });

  it("throws on an empty headline", () => {
    expect(() => parseObituary(JSON.stringify({ headline: "", lede: "L", body: "B", pullQuote: null, tags: ["Obituaries"] }))).toThrow();
  });

  it("throws when tags is missing", () => {
    expect(() => parseObituary(JSON.stringify({ headline: "H", lede: "L", body: "B", pullQuote: null }))).toThrow();
  });

  it("exposes a stable prompt version", () => {
    expect(OBITUARY_PROMPT_VERSION).toBe("obituary-v1");
  });
});

describe("composeTags", () => {
  it("always leads with Obituaries + map + cause and adds at most one flavor tag", () => {
    expect(composeTags(facts, ["Poultry", "Chernarus", "Obituaries"])).toEqual(["Obituaries", "Chernarus", "PvP", "Poultry"]);
  });
  it("drops flavor tags that duplicate the reserved set, and works with no flavor", () => {
    expect(composeTags(facts, ["Chernarus"])).toEqual(["Obituaries", "Chernarus", "PvP"]);
    expect(composeTags(facts, [])).toEqual(["Obituaries", "Chernarus", "PvP"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `pnpm --filter @onelife/newsdesk test -- prompt` — Expected: FAIL.

- [ ] **Step 3: Implement `apps/newsdesk/src/voice.ts`** (the system prompt — faithful to `../brand/brand-bible.md` §6/§9; keep verbatim):

```ts
/**
 * The One Life obituary-desk voice. Distilled verbatim-faithfully from
 * ../brand/brand-bible.md §6 (Voice & Tone), §8 (Obituaries vertical), §9 (Vocabulary / Fog Rule).
 * The governing rule above all: roast the play, never the person.
 */
export const OBITUARY_SYSTEM = `You write obituaries for One Life — the paper of record for a hardcore permadeath DayZ world where everyone dies. Your voice is a wire-service editor covering a war zone he finds darkly hilarious, crossed with a TMZ gossip desk that has sources everywhere. Dignified sentence structure, unhinged subject matter, survivors treated as celebrities.

SIX VOICE CONSTANTS (never break):
1. Deadpan. Never an exclamation point where a cold full stop hurts more. Loudness lives in the layout, never the prose.
2. Literate and precise. Real sentences, real vocabulary — a genuinely smart writer wrote this.
3. Sensational in judgment. If it bleeds, it leads; every death is an EXCLUSIVE — in framing, never in grammar.
4. In character, always. Never wink, never explain the joke, never apologize.
5. Principled savagery. Punch up at the geared and the arrogant, protect the helpless, prosecute coast-farmers.
6. Specific over generic. Use the real gamertag, cause of death, and dateline — never a live location (see Fog Rule).

TONE:
- Default (a typical player, a typical death): dry mock-gravity — a state funeral for an idiot. Mock the circumstances, never the person's worth.
- A true legend (long life, high kills, a notable end): reverent, with exactly ONE small needle. Never a straight eulogy.
- When the deceased was killed by another player and was clearly a fresh spawn or badly outmatched: the story is about the KILLER, not the victim. Protect the victim's dignity (they may stay anonymous — "a man, 19 minutes old"); if the killer is named, they are the subject of any mockery. Never mock a victim for being new, unlucky, or preyed-upon.

HARD BANS:
- No sincere grief clichés: never "RIP", "gone too soon", "rest in peace", "taken from us", "in a better place". Mourn only in deadpan ("Rest easy, champ").
- No wink/meta: never "just a game", "jk", "lol", "obviously we're kidding".
- No corporate/data-speak: never "users", "engagement", "leverage", "utilize", "content".
- No dated meme slang ("based", "poggers", "GG EZ", "rekt"), no emoji, no ALL-CAPS in prose, no exclamation soup.
- Never slurs, real-world identity attacks, harassment, doxxing, or any punch-down mockery.
- THE FOG RULE: a death is past tense, so you MAY name the map/dateline and the general circumstance of death, but NEVER give coordinates, a base layout, or anything that reads as a live/actionable location. Datelines set a scene; they never drop a pin.
- Pull-quote attributions stay anonymous and in-voice ("a rival", "sources on the coast", "reps for the deceased did not respond, on account of the deceased") — never attribute a quote to a real out-of-game identity.

OUTPUT: respond with a single JSON object and nothing else, exactly this shape:
{"headline": string, "lede": string, "body": string, "pullQuote": {"text": string, "attribution": string} | null, "tags": string[]}
- headline: the Oswald screamer — punchy, ≤ ~90 characters, no trailing period required.
- lede: one opening paragraph (1–2 sentences).
- body: 1–3 short paragraphs. Do not repeat the headline verbatim.
- pullQuote: one in-voice quote with an anonymous attribution, or null if none earns its place.
- tags: an array of 0–2 short, specific FLAVOR tags only (a locale like "Elektro", a theme like "Poultry"). Do NOT include "Obituaries", the map name, or the cause of death — those are added automatically.
The governing rule above all: roast the play, never the person.`;
```

- [ ] **Step 4: Implement `apps/newsdesk/src/prompt.ts`:**

```ts
import { z } from "zod";
import type { ObituaryFacts } from "./facts.js";
import { OBITUARY_SYSTEM } from "./voice.js";

export const OBITUARY_PROMPT_VERSION = "obituary-v1";

export interface Obituary {
  headline: string;
  lede: string;
  body: string;
  pullQuote: { text: string; attribution: string } | null;
  tags: string[];
}

const MAP_LABEL: Record<string, string> = { chernarusplus: "Chernarus", sakhal: "Sakhal", enoch: "Livonia" };
const mapLabel = (map: string): string => MAP_LABEL[map] ?? map.replace(/\b\w/g, (c) => c.toUpperCase());

/** Build the {system, user} messages for one obituary from the factual snapshot. */
export function buildObituaryPrompt(facts: ObituaryFacts): { system: string; user: string } {
  const lines: string[] = [];
  lines.push(`Write the obituary for this life. Facts (all past tense, all confirmed):`);
  lines.push(`- Callsign: ${facts.gamertag}`);
  lines.push(`- Dateline (map only, never a pin): ${mapLabel(facts.map)}`);
  lines.push(`- Time survived this life: ${facts.timeAliveLabel}`);
  lines.push(`- Confirmed kills this life: ${facts.kills}`);
  if (facts.longestKillMeters != null) lines.push(`- Longest kill: ${Math.round(facts.longestKillMeters)}m`);
  lines.push(`- Sessions played: ${facts.sessions}`);
  if (facts.causeCategory === "pvp") {
    lines.push(`- Cause of death: killed by another player${facts.killerGamertag ? ` (${facts.killerGamertag})` : ""}${facts.weapon ? `, ${facts.weapon}` : ""}.`);
  } else if (facts.causeCategory === "environment") {
    lines.push(`- Cause of death: ${facts.cause ?? "the environment"} (not a player kill).`);
  } else {
    lines.push(`- Cause of death: unknown.`);
  }
  lines.push("");
  if (facts.isLegend) {
    lines.push(`This was a LEGEND (a long life and/or a high kill count). Use the reverent tone — a sincere send-off with exactly one small needle.`);
  } else if (facts.freshSpawnVictim) {
    lines.push(`This was a fresh spawn or badly outmatched player killed by another player. PROTECT the victim's dignity — do not mock them for dying. If the killer is named, they are the subject of any mockery, not the victim.`);
  } else {
    lines.push(`Use the default tone: dry mock-gravity — a state funeral for an idiot. Mock the circumstances, never the person's worth.`);
  }
  lines.push("");
  lines.push(`Respond with only the JSON object described in your instructions.`);
  return { system: OBITUARY_SYSTEM, user: lines.join("\n") };
}

const schema = z.object({
  headline: z.string().trim().min(1).max(200),
  lede: z.string().trim().min(1),
  body: z.string().trim().min(1),
  pullQuote: z
    .object({ text: z.string().trim().min(1), attribution: z.string().trim().min(1) })
    .nullable(),
  // The key must be present, but may be an empty array — flavor tags are optional; the reserved
  // tags (Obituaries / map / cause) are composed deterministically, not from the model.
  tags: z.array(z.string().trim().min(1)).max(6),
});

/** Parse + validate the model's JSON. Throws on non-JSON or a shape violation. */
export function parseObituary(raw: string): Obituary {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    // Some models wrap JSON in prose or fences; salvage the first {...} block before giving up.
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("obituary response was not JSON");
    json = JSON.parse(match[0]);
  }
  const parsed = schema.parse(json);
  return parsed;
}

export function causeCategoryTag(cat: ObituaryFacts["causeCategory"]): string {
  return cat === "pvp" ? "PvP" : cat === "environment" ? "Environment" : "Unknown";
}

/**
 * The stored tag set — deterministic, spec-bounded: "Obituaries" + the map label + the cause
 * category, plus at most one non-reserved LLM flavor tag. The model never controls the reserved
 * tags (it only supplies optional flavor).
 */
export function composeTags(facts: ObituaryFacts, llmTags: string[]): string[] {
  const base = ["Obituaries", mapLabel(facts.map), causeCategoryTag(facts.causeCategory)];
  const taken = new Set(base.map((t) => t.toLowerCase()));
  const flavor = llmTags.map((t) => t.trim()).find((t) => t && !taken.has(t.toLowerCase()));
  return flavor ? [...base, flavor] : base;
}
```

- [ ] **Step 5: Run tests + typecheck** — `pnpm --filter @onelife/newsdesk test -- prompt` (PASS), `pnpm --filter @onelife/newsdesk typecheck` (clean).

- [ ] **Step 6: Commit** — `git add apps/newsdesk/src/voice.ts apps/newsdesk/src/prompt.ts apps/newsdesk/test/prompt.test.ts && git commit -m "feat(newsdesk): obituary voice, prompt builder, output parser"`

---

## Task 6: OpenRouter client + generate orchestrator

**Files:**
- Create: `apps/newsdesk/src/openrouter.ts`
- Create: `apps/newsdesk/src/generate.ts`
- Test: `apps/newsdesk/test/openrouter.test.ts`, `apps/newsdesk/test/generate.test.ts`

**Interfaces:**
- Consumes: `buildObituaryPrompt`, `parseObituary`, `Obituary` (Task 5); `ObituaryFacts` (Task 4).
- Produces:
  - `interface CompletionClient { complete(req: { system: string; user: string }): Promise<string>; }`
  - `openrouterComplete(args: { apiKey: string; model: string; system?: string; user: string; temperature?: number }): Promise<string>`
  - `openrouterClient(cfg: { apiKey: string; model: string; temperature?: number }): CompletionClient`
  - `generateObituary(client: CompletionClient, facts: ObituaryFacts): Promise<Obituary>`

- [ ] **Step 1: Write the failing tests.** `apps/newsdesk/test/openrouter.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { openrouterComplete } from "../src/openrouter.js";

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; vi.restoreAllMocks(); });

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

describe("openrouterComplete", () => {
  it("returns choices[0].message.content on 200 and sends auth + json mode", async () => {
    const f = mockFetch(200, { choices: [{ message: { content: "{\"ok\":true}" } }] });
    global.fetch = f as unknown as typeof fetch;
    const out = await openrouterComplete({ apiKey: "k", model: "m", user: "hi" });
    expect(out).toBe('{"ok":true}');
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const i = init as RequestInit;
    expect((i.headers as Record<string, string>).Authorization).toBe("Bearer k");
    const sent = JSON.parse(i.body as string);
    expect(sent.model).toBe("m");
    expect(sent.response_format).toEqual({ type: "json_object" });
  });

  it("throws on a non-2xx with the error message", async () => {
    global.fetch = mockFetch(429, { error: { message: "rate limited" } }) as unknown as typeof fetch;
    await expect(openrouterComplete({ apiKey: "k", model: "m", user: "hi" })).rejects.toThrow(/rate limited/);
  });

  it("throws on empty completion content", async () => {
    global.fetch = mockFetch(200, { choices: [{ message: { content: "  " } }] }) as unknown as typeof fetch;
    await expect(openrouterComplete({ apiKey: "k", model: "m", user: "hi" })).rejects.toThrow(/empty/i);
  });
});
```

`apps/newsdesk/test/generate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateObituary, type CompletionClient } from "../src/generate.js";
import type { ObituaryFacts } from "../src/facts.js";

const facts: ObituaryFacts = {
  gamertag: "Boots", map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 1, timeAliveSeconds: 3600,
  timeAliveLabel: "1h 0m", kills: 0, longestKillMeters: null, sessions: 1, cause: "environment",
  causeCategory: "environment", killerGamertag: null, weapon: null, isLegend: false, freshSpawnVictim: false,
  endedAt: "2026-07-10T02:00:00.000Z",
};

const stub = (payload: unknown): CompletionClient => ({ complete: async () => JSON.stringify(payload) });

describe("generateObituary", () => {
  it("builds the prompt, calls the client, parses the result", async () => {
    let seenSystem = "";
    const client: CompletionClient = {
      complete: async ({ system }) => {
        seenSystem = system;
        return JSON.stringify({ headline: "H", lede: "L", body: "B", pullQuote: null, tags: ["Obituaries"] });
      },
    };
    const o = await generateObituary(client, facts);
    expect(o.headline).toBe("H");
    expect(seenSystem).toMatch(/deadpan/i);
  });

  it("propagates a parse error from a malformed completion", async () => {
    await expect(generateObituary(stub("not an obituary object"), facts)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @onelife/newsdesk test -- openrouter generate` — Expected: FAIL.

- [ ] **Step 3: Implement `apps/newsdesk/src/openrouter.ts`** (from the grounded client):

```ts
import type { CompletionClient } from "./generate.js";

/** Minimal OpenRouter chat-completions call. Returns choices[0].message.content; throws on
 *  non-2xx or empty content. No SDK — global fetch (Node 20+). */
export async function openrouterComplete(args: {
  apiKey: string;
  model: string;
  system?: string;
  user: string;
  temperature?: number;
}): Promise<string> {
  const messages = [
    ...(args.system ? [{ role: "system" as const, content: args.system }] : []),
    { role: "user" as const, content: args.user },
  ];
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "One Life Newsdesk",
    },
    body: JSON.stringify({
      model: args.model,
      messages,
      temperature: args.temperature ?? 0.7,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body?.error?.message ?? JSON.stringify(body);
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(`OpenRouter request failed (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error("OpenRouter returned empty completion content");
  }
  return content;
}

/** Adapt openrouterComplete to the injectable CompletionClient the generator/tick depend on. */
export function openrouterClient(cfg: { apiKey: string; model: string; temperature?: number }): CompletionClient {
  return {
    complete: ({ system, user }) =>
      openrouterComplete({ apiKey: cfg.apiKey, model: cfg.model, system, user, temperature: cfg.temperature }),
  };
}
```

- [ ] **Step 4: Implement `apps/newsdesk/src/generate.ts`:**

```ts
import type { ObituaryFacts } from "./facts.js";
import { buildObituaryPrompt, parseObituary, type Obituary } from "./prompt.js";

/** The one capability the generator needs — real OpenRouter in prod, a stub in tests. */
export interface CompletionClient {
  complete(req: { system: string; user: string }): Promise<string>;
}

/** Build the prompt, call the model, parse + validate. Throws on client or parse failure. */
export async function generateObituary(client: CompletionClient, facts: ObituaryFacts): Promise<Obituary> {
  const { system, user } = buildObituaryPrompt(facts);
  const raw = await client.complete({ system, user });
  return parseObituary(raw);
}
```

- [ ] **Step 5: Run tests + typecheck** — `pnpm --filter @onelife/newsdesk test -- openrouter generate` (PASS), `pnpm --filter @onelife/newsdesk typecheck` (clean).

- [ ] **Step 6: Commit** — `git add apps/newsdesk/src/openrouter.ts apps/newsdesk/src/generate.ts apps/newsdesk/test/openrouter.test.ts apps/newsdesk/test/generate.test.ts && git commit -m "feat(newsdesk): OpenRouter client + generate orchestrator"`

---

## Task 7: config + tick + main loop + deploy wiring

**Files:**
- Create: `apps/newsdesk/src/config.ts`, `apps/newsdesk/src/tick.ts`, `apps/newsdesk/src/main.ts`
- Modify: `deploy/README.md` (document the `onelife-newsdesk` unit + env)
- Test: `apps/newsdesk/test/config.test.ts`, `apps/newsdesk/test/tick.test.ts`

**Interfaces:**
- Consumes: `findObituaryTargets`, `publishObituary`, `recordObituaryFailure` (Task 3); `buildObituaryFacts` (Task 4); `generateObituary`, `CompletionClient` (Task 6); `OBITUARY_PROMPT_VERSION` (Task 5); `getLifeTimeline` (`@onelife/read-models`); `openrouterClient` (Task 6).
- Produces: `loadConfig(env)`, `Config`; `newsdeskTick(db, deps): Promise<NewsdeskResult>`; `NewsdeskDeps`, `NewsdeskResult`.

- [ ] **Step 1: Write the config test** at `apps/newsdesk/test/config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const BASE = { DATABASE_URL: "postgres://x/y" };

describe("newsdesk config — dry-run safety default", () => {
  it("defaults dryRun TRUE and the model slug when unset", () => {
    const c = loadConfig({ ...BASE });
    expect(c.dryRun).toBe(true);
    expect(c.model).toBe("anthropic/claude-sonnet-5");
    expect(c.batchCap).toBe(10);
    expect(c.maxAttempts).toBe(3);
  });
  it("stays dry-run for any value that is not exactly 'false'", () => {
    expect(loadConfig({ ...BASE, NEWSDESK_DRY_RUN: "" }).dryRun).toBe(true);
    expect(loadConfig({ ...BASE, NEWSDESK_DRY_RUN: "true" }).dryRun).toBe(true);
  });
  it("generates for real ONLY when NEWSDESK_DRY_RUN is exactly 'false'", () => {
    expect(loadConfig({ ...BASE, NEWSDESK_DRY_RUN: "false" }).dryRun).toBe(false);
  });
  it("honors an overridden model slug", () => {
    expect(loadConfig({ ...BASE, NEWSDESK_MODEL: "anthropic/claude-opus-4.5" }).model).toBe("anthropic/claude-opus-4.5");
  });
});
```

- [ ] **Step 1b: Run it to verify it fails** — `pnpm --filter @onelife/newsdesk test -- config` — Expected: FAIL (module not found).

- [ ] **Step 2: Implement `apps/newsdesk/src/config.ts`:**

```ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  OPENROUTER_API_KEY: z.string().default(""),
  NEWSDESK_MODEL: z.string().default("anthropic/claude-sonnet-5"),
  NEWSDESK_DRY_RUN: z.string().optional(),
  NEWSDESK_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),
  NEWSDESK_BATCH_CAP: z.coerce.number().int().positive().default(10),
  NEWSDESK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  NEWSDESK_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.7),
  LOG_LEVEL: z.string().default("info"),
});

export type Config = {
  databaseUrl: string;
  openrouterApiKey: string;
  model: string;
  dryRun: boolean;
  intervalSeconds: number;
  batchCap: number;
  maxAttempts: number;
  temperature: number;
  logLevel: string;
};

export function loadConfig(env: Record<string, string | undefined>): Config {
  const p = schema.parse(env);
  return {
    databaseUrl: p.DATABASE_URL,
    openrouterApiKey: p.OPENROUTER_API_KEY,
    model: p.NEWSDESK_MODEL,
    // SAFE DEFAULT: dry-run unless explicitly disabled with "false".
    dryRun: p.NEWSDESK_DRY_RUN !== "false",
    intervalSeconds: p.NEWSDESK_INTERVAL_SECONDS,
    batchCap: p.NEWSDESK_BATCH_CAP,
    maxAttempts: p.NEWSDESK_MAX_ATTEMPTS,
    temperature: p.NEWSDESK_TEMPERATURE,
    logLevel: p.LOG_LEVEL,
  };
}
```

- [ ] **Step 3: Write the tick test** at `apps/newsdesk/test/tick.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, articles } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { newsdeskTick } from "../src/tick.js";
import type { CompletionClient } from "../src/generate.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 52e7;
const t0 = new Date("2026-07-14T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
let serverId: number;
const pids: number[] = [];
const lifeIds: number[] = [];
const log = { info: () => {}, error: () => {} };

async function seedQualifiedDeath(tag: string, endH: number) {
  const [p] = await db.insert(players).values({ gamertag: tag }).returning();
  pids.push(p!.id);
  const [l] = await db.insert(lives).values({ serverId, playerId: p!.id, lifeNumber: 1, startedAt: hrs(endH - 2), endedAt: hrs(endH), deathCause: "pvp", deathByGamertag: "Killer", deathWeapon: "M4", deathDistance: 100, playtimeSeconds: 7200 }).returning();
  lifeIds.push(l!.id);
  return l!.id;
}

function okClient(): CompletionClient {
  return { complete: async () => JSON.stringify({ headline: "A Death On The Coast", lede: "L", body: "B", pullQuote: { text: "q", attribution: "a rival" }, tags: ["Obituaries", "Chernarus"] }) };
}
function failClient(): CompletionClient {
  return { complete: async () => { throw new Error("api boom"); } };
}
function calls(client: CompletionClient) {
  let n = 0;
  return { client: { complete: (r: { system: string; user: string }) => { n++; return client.complete(r); } }, count: () => n };
}

const deps = (over: Partial<Parameters<typeof newsdeskTick>[1]>) => ({
  client: okClient(), dryRun: false, batchCap: 10, maxAttempts: 3,
  promptVersion: "obituary-v1", model: "test", now: hrs(24), log, ...over,
});

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "tk", map: "chernarusplus", slug: `tk-${svc}`, active: true }).returning();
  serverId = s!.id;
});
afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(lives).where(inArray(lives.id, lifeIds));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("newsdeskTick", () => {
  it("dry-run: never calls the client and writes nothing", async () => {
    const lid = await seedQualifiedDeath(`tk-dry-${svc}`, 2);
    const c = calls(okClient());
    const r = await newsdeskTick(db, deps({ client: c.client, dryRun: true }));
    expect(r.dryRun).toBe(true);
    expect(c.count()).toBe(0);
    const rows = await db.select().from(articles).where(eq(articles.lifeId, lid));
    expect(rows).toHaveLength(0);
  });

  it("live: generates and publishes an obituary, and is idempotent on re-run", async () => {
    const lid = await seedQualifiedDeath(`tk-live-${svc}`, 3);
    const r1 = await newsdeskTick(db, deps({ batchCap: 50 }));
    expect(r1.generated).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(articles).where(eq(articles.lifeId, lid));
    expect(row!.status).toBe("published");
    expect(row!.headline).toBe("A Death On The Coast");
    expect(row!.slug).toBe(`a-death-on-the-coast-${lid}`);
    const before = (await db.select().from(articles).where(eq(articles.serverId, serverId))).length;
    await newsdeskTick(db, deps({ batchCap: 50 }));
    const after = (await db.select().from(articles).where(eq(articles.serverId, serverId))).length;
    expect(after).toBe(before); // nothing new — published lives are skipped
  });

  it("failure: records a failed stub with an incremented attempt", async () => {
    const lid = await seedQualifiedDeath(`tk-fail-${svc}`, 5);
    const r = await newsdeskTick(db, deps({ client: failClient(), batchCap: 50 }));
    expect(r.failed).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(articles).where(eq(articles.lifeId, lid));
    expect(row!.status).toBe("failed");
    expect(row!.attempts).toBe(1);
    expect(row!.lastError).toMatch(/boom/);
  });
});
```

- [ ] **Step 3b: Run it to verify it fails** — `pnpm --filter @onelife/newsdesk test -- tick` — Expected: FAIL (module not found).

- [ ] **Step 4: Implement `apps/newsdesk/src/tick.ts`:**

```ts
import type { Database } from "@onelife/db";
import { getLifeTimeline } from "@onelife/read-models";
import { findObituaryTargets, publishObituary, recordObituaryFailure } from "./pg-store.js";
import { buildObituaryFacts } from "./facts.js";
import { composeTags } from "./prompt.js";
import { generateObituary, type CompletionClient } from "./generate.js";

export type NewsdeskDeps = {
  client: CompletionClient;
  dryRun: boolean;
  batchCap: number;
  maxAttempts: number;
  promptVersion: string;
  model: string;
  now: Date;
  log: { info: (obj: unknown, msg?: string) => void; error?: (obj: unknown, msg?: string) => void };
};

export type NewsdeskResult = { generated: number; failed: number; skipped: number; dryRun: boolean };

/**
 * One newsdesk cycle: find qualified deaths lacking a published obituary, generate each in the
 * One Life voice, and publish it. Every OpenRouter call + write is behind the dryRun gate.
 */
export async function newsdeskTick(db: Database, deps: NewsdeskDeps): Promise<NewsdeskResult> {
  const targets = await findObituaryTargets(db, { limit: deps.batchCap, maxAttempts: deps.maxAttempts });
  let generated = 0;
  let failed = 0;
  let skipped = 0;

  for (const t of targets) {
    const timeline = await getLifeTimeline(db, t.serverId, t.gamertag, t.lifeId);
    if (!timeline) {
      skipped++;
      continue;
    }
    const facts = buildObituaryFacts(t, timeline);

    if (deps.dryRun) {
      deps.log.info({ gamertag: t.gamertag, lifeId: t.lifeId, map: t.map }, "DRY RUN: would generate obituary");
      continue;
    }

    try {
      const obituary = await generateObituary(deps.client, facts);
      // Reserved tags (Obituaries / map / cause) are composed deterministically; the LLM only
      // contributes at most one flavor tag.
      const tagged = { ...obituary, tags: composeTags(facts, obituary.tags) };
      await publishObituary(db, {
        target: t,
        facts,
        obituary: tagged,
        promptVersion: deps.promptVersion,
        model: deps.model,
        now: deps.now,
      });
      generated++;
    } catch (e) {
      await recordObituaryFailure(db, { target: t, error: e instanceof Error ? e.message : String(e) });
      deps.log.error?.({ err: e, lifeId: t.lifeId }, "obituary generation failed (will retry)");
      failed++;
    }
  }

  return { generated, failed, skipped, dryRun: deps.dryRun };
}
```

> Note: `publishObituary`'s `facts` param is structurally satisfied by `ObituaryFacts` (it has `sessions`, `killerGamertag`, `weapon`, `timeAliveSeconds`, `kills`, `longestKillMeters`, `cause` plus the index signature). No cast needed.

- [ ] **Step 5: Implement `apps/newsdesk/src/main.ts`:**

```ts
import pino from "pino";
import { getDb } from "@onelife/db";
import { loadConfig } from "./config.js";
import { newsdeskTick } from "./tick.js";
import { openrouterClient } from "./openrouter.js";
import { OBITUARY_PROMPT_VERSION } from "./prompt.js";

const cfg = loadConfig(process.env);
const log = pino({ level: cfg.logLevel });
const { db } = getDb(cfg.databaseUrl);
const client = openrouterClient({ apiKey: cfg.openrouterApiKey, model: cfg.model, temperature: cfg.temperature });

async function loop(): Promise<void> {
  log.info({ dryRun: cfg.dryRun, model: cfg.model, interval: cfg.intervalSeconds, batchCap: cfg.batchCap }, "newsdesk starting");
  if (cfg.dryRun) log.warn("NEWSDESK_DRY_RUN is on — obituaries are logged, not generated or stored. Set NEWSDESK_DRY_RUN=false to generate.");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const r = await newsdeskTick(db, {
        client,
        dryRun: cfg.dryRun,
        batchCap: cfg.batchCap,
        maxAttempts: cfg.maxAttempts,
        promptVersion: OBITUARY_PROMPT_VERSION,
        model: cfg.model,
        now: new Date(),
        log,
      });
      if (r.generated || r.failed) log.info(r, "newsdesk tick");
    } catch (err) {
      log.error({ err }, "newsdesk tick failed");
    }
    await new Promise((r) => setTimeout(r, cfg.intervalSeconds * 1000));
  }
}

loop();
```

- [ ] **Step 6: Document deploy** — append to `deploy/README.md` a `onelife-newsdesk` systemd unit entry alongside the other workers, noting it needs `DATABASE_URL`, `OPENROUTER_API_KEY`, `NEWSDESK_MODEL` (default `anthropic/claude-sonnet-5`), and ships **`NEWSDESK_DRY_RUN` defaulting true** (set `false` to spend). Follow the exact format of the existing `onelife-granter`/`onelife-enforcer` entries.

- [ ] **Step 7: Run tests + typecheck** — `pnpm --filter @onelife/newsdesk test` (all newsdesk suites PASS), `pnpm --filter @onelife/newsdesk typecheck` (clean).

- [ ] **Step 8: Commit** — `git add apps/newsdesk deploy/README.md && git commit -m "feat(newsdesk): config, sweep tick, worker loop, deploy docs"`

---

## Task 8: API — repurpose `GET /obituaries` + add `GET /obituaries/:slug`

**Files:**
- Modify: `apps/api/src/routes/obituaries.ts` (replace the R4 body)
- Test: `apps/api/test/obituaries.test.ts` (extend)

**Interfaces:**
- Consumes: `getPublishedObituaries`, `getObituaryBySlug` (`@onelife/read-models`, Task 2).
- Produces: `GET /obituaries?page=N` → `ObituariesFeed`; `GET /obituaries/:slug` → `ObituaryArticle` (404 `{ error: "not_found" }` on miss; 400 `{ error: "bad_request" }` on a blank slug).

- [ ] **Step 1: Replace the test** at `apps/api/test/obituaries.test.ts` with a seeded feed + slug test:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, articles } from "@onelife/db";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";

const { db, sql } = getTestDb();
const app = buildApp(db);
const svc = Math.floor(Math.random() * 1e8) + 52e7;
let serverId: number, playerId: number, lifeId: number;
const slug = `obit-api-${svc}`;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "oa", map: "chernarusplus", slug: `oa-${svc}`, active: true }).returning();
  serverId = s!.id;
  const [p] = await db.insert(players).values({ gamertag: `oa-${svc}` }).returning();
  playerId = p!.id;
  const [l] = await db.insert(lives).values({ serverId, playerId, lifeNumber: 1, startedAt: new Date("2026-07-10T00:00:00Z"), endedAt: new Date("2026-07-10T02:00:00Z"), deathCause: "pvp", playtimeSeconds: 7200 }).returning();
  lifeId = l!.id;
  await db.insert(articles).values({
    kind: "obituary", status: "published", slug, playerId, serverId, lifeId, gamertag: `oa-${svc}`,
    map: "chernarusplus", mapSlug: `oa-${svc}`, lifeNumber: 1, deathAt: new Date("2026-07-10T02:00:00Z"),
    timeAliveSeconds: 7200, kills: 2, longestKillMeters: 90, cause: "pvp", headline: "H", lede: "L", body: "B",
    pullQuoteText: "q", pullQuoteAttribution: "a rival", tags: ["Obituaries"],
    facts: { sessions: 1, killerGamertag: "K", weapon: "M4" }, generatedAt: new Date("2026-07-10T03:00:00Z"),
  });
});
afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(players).where(eq(players.id, playerId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("GET /obituaries", () => {
  it("returns a published-obituary feed with defaults", async () => {
    const res = await app.inject({ method: "GET", url: "/obituaries" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ page: 1, pageSize: 20 });
    expect(body.rows.some((r: { slug: string }) => r.slug === slug)).toBe(true);
  });
  it("coerces invalid page to 1", async () => {
    const res = await app.inject({ method: "GET", url: "/obituaries?page=-3" });
    expect(res.statusCode).toBe(200);
    expect(res.json().page).toBe(1);
  });
});

describe("GET /obituaries/:slug", () => {
  it("returns the full article", async () => {
    const res = await app.inject({ method: "GET", url: `/obituaries/${slug}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.headline).toBe("H");
    expect(body.pullQuote).toEqual({ text: "q", attribution: "a rival" });
    expect(body.sessions).toBe(1);
  });
  it("unknown slug → 404", async () => {
    const res = await app.inject({ method: "GET", url: "/obituaries/no-such-slug" });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @onelife/api test -- obituaries` — Expected: FAIL (`getObituaryBySlug` not imported; `/obituaries` still returns raw deaths).

- [ ] **Step 3: Replace** `apps/api/src/routes/obituaries.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import { z } from "zod";
import { getPublishedObituaries, getObituaryBySlug } from "@onelife/read-models";

const query = z.object({ page: z.coerce.number().int().positive().catch(1) });
const params = z.object({ slug: z.string().min(1) });

export function registerObituariesRoutes(app: FastifyInstance, db: Database): void {
  app.get("/obituaries", async (req) => {
    const { page } = query.parse(req.query);
    return getPublishedObituaries(db, { page });
  });

  app.get("/obituaries/:slug", async (req, reply) => {
    const p = params.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "bad_request" });
    const article = await getObituaryBySlug(db, p.data.slug);
    if (!article) return reply.code(404).send({ error: "not_found" });
    return article;
  });
}
```

(Registration in `apps/api/src/app.ts` is unchanged — `registerObituariesRoutes(app, db)` already covers both routes.)

- [ ] **Step 4: Run tests + typecheck** — `pnpm --filter @onelife/api test -- obituaries` (PASS), `pnpm --filter @onelife/api typecheck` (clean).

- [ ] **Step 5: Commit** — `git add apps/api && git commit -m "feat(api): obituaries feed returns published articles + by-slug route"`

---

## Task 9: Web plumbing — DTOs, API client, format helpers

**Files:**
- Modify: `apps/web/src/lib/types.ts` (add DTOs), `apps/web/src/lib/api.ts` (add client fns), `apps/web/src/lib/seo.ts` (add `articleLd`)
- Create: `apps/web/src/lib/obituary-format.ts`
- Test: `apps/web/src/lib/obituary-format.test.ts`

**Interfaces:**
- Produces (types.ts, HTTP-serialized — dates are strings):
  - `ObituaryCard { slug; gamertag; map; mapSlug: string|null; lifeNumber; headline; lede; tags: string[]; timeAliveSeconds; kills; longestKillMeters: number|null; cause: string|null; deathAt: string }`
  - `ObituariesFeed { rows: ObituaryCard[]; total; page; pageSize }`
  - `ObituaryArticle extends ObituaryCard { body; pullQuote: { text; attribution } | null; sessions; killerGamertag: string|null; weapon: string|null }`
- Produces (api.ts): `getObituariesFeed(page: number): Promise<ObituariesFeed>`, `getObituary(slug: string): Promise<ObituaryArticle | null>`
- Produces (obituary-format.ts): `obituariesHref(page)`, `obituaryHref(slug)`, `dateline(map, deathAtIso, now)`, `rapSheetFacts(a)`, `obituaryShowingLine(page, pageSize, total)`
- Produces (seo.ts): `articleLd(a, url)`

- [ ] **Step 1: Add DTOs to `apps/web/src/lib/types.ts`** (append near the other DTOs):

```ts
export type ObituaryCard = {
  slug: string;
  gamertag: string;
  map: string;
  mapSlug: string | null;
  lifeNumber: number;
  headline: string;
  lede: string;
  tags: string[];
  timeAliveSeconds: number;
  kills: number;
  longestKillMeters: number | null;
  cause: string | null;
  deathAt: string;
};
export type ObituariesFeed = { rows: ObituaryCard[]; total: number; page: number; pageSize: number };
export type ObituaryArticle = ObituaryCard & {
  body: string;
  pullQuote: { text: string; attribution: string } | null;
  sessions: number;
  killerGamertag: string | null;
  weapon: string | null;
};
```

- [ ] **Step 2: Add client fns to `apps/web/src/lib/api.ts`** (import the new types in the top import block; add the `export const`s near the other endpoints; `getOrNull` already exists):

```ts
export const getObituariesFeed = (page: number) =>
  apiGet<ObituariesFeed>(`/api/obituaries?page=${page}`);
export const getObituary = (slug: string) =>
  getOrNull<ObituaryArticle>(`/api/obituaries/${encodeURIComponent(slug)}`);
```

- [ ] **Step 3: Write the failing test** at `apps/web/src/lib/obituary-format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { obituariesHref, obituaryHref, dateline, rapSheetFacts, obituaryShowingLine } from "./obituary-format";
import type { ObituaryCard } from "./types";

const now = new Date("2026-07-12T00:00:00Z");
const card: ObituaryCard = {
  slug: "gone-42", gamertag: "Boots", map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 3,
  headline: "H", lede: "L", tags: ["Obituaries"], timeAliveSeconds: 7200, kills: 3,
  longestKillMeters: 210, cause: "pvp", deathAt: "2026-07-10T00:00:00Z",
};

describe("obituary hrefs", () => {
  it("feed href omits page 1", () => {
    expect(obituariesHref(1)).toBe("/obituaries");
    expect(obituariesHref(3)).toBe("/obituaries?page=3");
  });
  it("article href", () => {
    expect(obituaryHref("gone-42")).toBe("/obituaries/gone-42");
  });
});

describe("dateline", () => {
  it("labels the map (codename → name) and adds a relative time", () => {
    expect(dateline("chernarusplus", "2026-07-10T00:00:00Z", now)).toMatch(/^CHERNARUS BUREAU · /);
  });
});

describe("rapSheetFacts", () => {
  it("builds Survived/Kills/Longest kill/Cause, cause hot", () => {
    const facts = rapSheetFacts(card);
    expect(facts.map((f) => f.label)).toEqual(["Survived", "Kills", "Longest kill", "Cause"]);
    expect(facts.find((f) => f.label === "Longest kill")!.value).toBe("210m");
    expect(facts.find((f) => f.label === "Cause")!.hot).toBe(true);
  });
  it("omits longest kill when null", () => {
    const facts = rapSheetFacts({ ...card, longestKillMeters: null });
    expect(facts.map((f) => f.label)).not.toContain("Longest kill");
  });
});

describe("obituaryShowingLine", () => {
  it("reads in-voice", () => {
    expect(obituaryShowingLine(1, 20, 45)).toBe("Showing 1–20 of 45 filed");
  });
});
```

- [ ] **Step 3b: Run it to verify it fails** — `pnpm --filter @onelife/web test -- obituary-format` — Expected: FAIL (module not found).

- [ ] **Step 4: Implement `apps/web/src/lib/obituary-format.ts`:**

```ts
import { mapLabel, formatDuration, relativeDate } from "@/components/player/format";
import type { ObituaryCard } from "./types";

export function obituariesHref(page: number): string {
  return page > 1 ? `/obituaries?page=${page}` : "/obituaries";
}

export function obituaryHref(slug: string): string {
  return `/obituaries/${slug}`;
}

/** "CHERNARUS BUREAU · 2 days ago" */
export function dateline(map: string, deathAtIso: string, now: Date): string {
  return `${mapLabel(map).toUpperCase()} BUREAU · ${relativeDate(deathAtIso, now)}`;
}

export type RapFact = { label: string; value: string; hot: boolean };

function causeLabel(cause: string | null): string {
  if (cause === "pvp") return "Killed";
  if (!cause) return "Unknown";
  return cause.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The factual Rap Sheet — never the LLM. Cause is the red (hot) stat. */
export function rapSheetFacts(a: Pick<ObituaryCard, "timeAliveSeconds" | "kills" | "longestKillMeters" | "cause">): RapFact[] {
  const out: RapFact[] = [
    { label: "Survived", value: formatDuration(a.timeAliveSeconds), hot: false },
    { label: "Kills", value: String(a.kills), hot: false },
  ];
  if (a.longestKillMeters != null) out.push({ label: "Longest kill", value: `${Math.round(a.longestKillMeters)}m`, hot: false });
  out.push({ label: "Cause", value: causeLabel(a.cause), hot: true });
  return out;
}

export function obituaryShowingLine(page: number, pageSize: number, total: number): string {
  const to = Math.min(page * pageSize, total);
  const from = Math.min((page - 1) * pageSize + 1, to);
  return `Showing ${from}–${to} of ${total} filed`;
}
```

- [ ] **Step 5: Add `articleLd` to `apps/web/src/lib/seo.ts`** (append after `breadcrumbLd`):

```ts
export function articleLd(
  a: { headline: string; lede: string; gamertag: string; deathAt: string },
  url: string,
) {
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: a.headline,
    description: a.lede,
    url,
    datePublished: a.deathAt,
    about: { "@type": "Person", name: a.gamertag },
    isPartOf: { "@type": "CollectionPage", name: "Obituaries", url: absoluteUrl("/obituaries") },
  };
}
```

- [ ] **Step 6: Run tests + typecheck** — `pnpm --filter @onelife/web test -- obituary-format` (PASS), `pnpm --filter @onelife/web typecheck` (clean).

- [ ] **Step 7: Commit** — `git add apps/web/src/lib && git commit -m "feat(web): obituary DTOs, API client, format helpers, article JSON-LD"`

---

## Task 10: Web — the `/obituaries` feed page

**Files:**
- Create: `apps/web/src/components/obituaries/obituary-card.tsx`, `apps/web/src/components/obituaries/obituaries-pagination.tsx`
- Modify: `apps/web/src/components/skeletons.tsx` (add `ObituariesSkeleton`)
- Create: `apps/web/src/app/obituaries/loading.tsx`
- Replace: `apps/web/src/app/obituaries/page.tsx`
- Test: `apps/web/src/components/obituaries/obituary-card.test.tsx`, `apps/web/src/components/obituaries/obituaries-pagination.test.tsx`

**Interfaces:**
- Consumes: `ObituaryCard`, `ObituariesFeed` (Task 9); `getObituariesFeed` (Task 9); `GamertagLink`; `rapSheetFacts`, `dateline`, `obituariesHref`, `obituaryHref`, `obituaryShowingLine` (Task 9); `pageBox`/`pageBoxLink`/`pageBoxOff` (`@/components/pagination-box`).
- Produces: `ObituaryCard` component, `ObituariesPagination`, `ObituariesSkeleton`.

- [ ] **Step 1: Write the card test** at `apps/web/src/components/obituaries/obituary-card.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ObituaryCard } from "./obituary-card";
import type { ObituaryCard as Card } from "@/lib/types";

const card: Card = {
  slug: "the-king-is-dead-9", gamertag: "xX_Sn1per_Xx", map: "chernarusplus", mapSlug: "chernarus",
  lifeNumber: 4, headline: "The King Is Dead. A Chicken Is Wanted.", lede: "He arrived with a flare.",
  tags: ["Obituaries", "Chernarus"], timeAliveSeconds: 3456000, kills: 212, longestKillMeters: 410,
  cause: "pvp", deathAt: "2026-07-10T22:16:00Z",
};

describe("ObituaryCard", () => {
  test("headline links to the interior article; gamertag to the dossier", () => {
    render(<ObituaryCard card={card} now={new Date("2026-07-12T00:00:00Z")} />);
    expect(screen.getByRole("link", { name: /The King Is Dead/ })).toHaveAttribute("href", "/obituaries/the-king-is-dead-9");
    expect(screen.getByRole("link", { name: "xX_Sn1per_Xx" })).toHaveAttribute("href", "/players/xx-sn1per-xx");
  });
  test("shows the dek, dateline, and a Rap Sheet strip (kills, cause)", () => {
    render(<ObituaryCard card={card} now={new Date("2026-07-12T00:00:00Z")} />);
    expect(screen.getByText("He arrived with a flare.")).toBeInTheDocument();
    expect(screen.getByText(/CHERNARUS BUREAU/)).toBeInTheDocument();
    expect(screen.getByText("212")).toBeInTheDocument();
  });
});
```

- [ ] **Step 1b: Run it to verify it fails** — `pnpm --filter @onelife/web test -- obituary-card` — Expected: FAIL (module not found).

- [ ] **Step 2: Implement `apps/web/src/components/obituaries/obituary-card.tsx`:**

```tsx
import Link from "next/link";
import type { ObituaryCard as Card } from "@/lib/types";
import { GamertagLink } from "@/components/gamertag-link";
import { cn } from "@/lib/utils";
import { obituaryHref, dateline, rapSheetFacts } from "@/lib/obituary-format";

/** One obituary in the reverse-chron feed — headline → interior, dek, dateline, Rap Sheet strip. */
export function ObituaryCard({ card, now }: { card: Card; now: Date }) {
  const facts = rapSheetFacts(card);
  return (
    <article className="border-b border-hairline py-6">
      <p className="font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted">{dateline(card.map, card.deathAt, now)}</p>
      <h2 className="mt-1.5 font-display text-3xl font-bold uppercase leading-[.95] text-ink md:text-4xl">
        <Link href={obituaryHref(card.slug)} className="hover:text-red">{card.headline}</Link>
      </h2>
      <p className="mt-2 max-w-2xl font-mono text-[13px] leading-relaxed text-ink-soft">{card.lede}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <span className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          <GamertagLink gamertag={card.gamertag} className="font-bold text-ink underline" />
        </span>
        {facts.map((f) => (
          <span key={f.label} className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
            {f.label} <span className={cn("font-bold", f.hot ? "text-red" : "text-ink")}>{f.value}</span>
          </span>
        ))}
      </div>
    </article>
  );
}
```

- [ ] **Step 3: Write the pagination test** at `apps/web/src/components/obituaries/obituaries-pagination.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ObituariesPagination } from "./obituaries-pagination";

describe("ObituariesPagination", () => {
  test("range line, page links, current page not a link", () => {
    render(<ObituariesPagination page={2} total={56} pageSize={20} />);
    expect(screen.getByText("Showing 21–40 of 56 filed")).toBeInTheDocument();
    expect(screen.getByText("2")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "1" })).toHaveAttribute("href", "/obituaries");
    expect(screen.getByRole("link", { name: "3" })).toHaveAttribute("href", "/obituaries?page=3");
  });
  test("renders nothing when empty", () => {
    const { container } = render(<ObituariesPagination page={1} total={0} pageSize={20} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 3b: Run it to verify it fails** — `pnpm --filter @onelife/web test -- obituaries-pagination` — Expected: FAIL (module not found).

- [ ] **Step 4: Implement `apps/web/src/components/obituaries/obituaries-pagination.tsx`** (mirrors the survivors pager's visual idiom, flat `?page` href):

```tsx
import Link from "next/link";
import { cn } from "@/lib/utils";
import { pageBox, pageBoxLink, pageBoxOff } from "@/components/pagination-box";
import { obituariesHref, obituaryShowingLine } from "@/lib/obituary-format";

const WINDOW = 2;

function pageWindow(page: number, totalPages: number): number[] {
  const start = Math.max(1, page - WINDOW);
  const end = Math.min(totalPages, page + WINDOW);
  const pages: number[] = [];
  for (let n = start; n <= end; n++) pages.push(n);
  return pages;
}

export function ObituariesPagination({ page, total, pageSize }: { page: number; total: number; pageSize: number }) {
  if (total === 0) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const showPrev = page > 1;
  const showNext = page * pageSize < total;
  return (
    <nav aria-label="Pagination" className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t-[3px] border-ink pt-3">
      <span className="font-mono text-[11.5px] uppercase tracking-[.05em] text-ink-muted">{obituaryShowingLine(page, pageSize, total)}</span>
      <div className="flex flex-wrap gap-2">
        {showPrev ? (
          <Link href={obituariesHref(page - 1)} className={cn(pageBox, pageBoxLink)}><span aria-hidden>← </span>Prev</Link>
        ) : (
          <span aria-hidden className={cn(pageBox, pageBoxOff)}>← Prev</span>
        )}
        {pageWindow(page, totalPages).map((n) =>
          n === page ? (
            <span key={n} aria-current="page" className={cn(pageBox, "bg-ink text-paper")}>{n}</span>
          ) : (
            <Link key={n} href={obituariesHref(n)} className={cn(pageBox, pageBoxLink)}>{n}</Link>
          ),
        )}
        {showNext ? (
          <Link href={obituariesHref(page + 1)} className={cn(pageBox, pageBoxLink)}>Next<span aria-hidden> →</span></Link>
        ) : (
          <span aria-hidden className={cn(pageBox, pageBoxOff)}>Next →</span>
        )}
      </div>
    </nav>
  );
}
```

- [ ] **Step 5: Add `ObituariesSkeleton`** to `apps/web/src/components/skeletons.tsx` (reuse the file's existing `Bar` helper; append this export):

```tsx
/** Route-level loading state for the obituaries feed. */
export function ObituariesSkeleton() {
  return (
    <main aria-busy="true" className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10">
      <div className="border-b-[3px] border-ink pb-4">
        <Bar className="h-9 w-56 max-w-full" />
        <Bar className="mt-3 h-3 w-80 max-w-full" />
      </div>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="border-b border-hairline py-6">
          <Bar className="h-3 w-40" />
          <Bar className="mt-2 h-8 w-full max-w-xl" />
          <Bar className="mt-3 h-3 w-96 max-w-full" />
        </div>
      ))}
    </main>
  );
}
```

- [ ] **Step 6: Create `apps/web/src/app/obituaries/loading.tsx`:**

```tsx
import { ObituariesSkeleton } from "@/components/skeletons";

export default function Loading() {
  return <ObituariesSkeleton />;
}
```

- [ ] **Step 7: Replace `apps/web/src/app/obituaries/page.tsx`** (drop the teaser + `noindex`):

```tsx
import type { Metadata } from "next";
import { getObituariesFeed } from "@/lib/api";
import { Kicker } from "@/components/tabloid/kicker";
import { ObituaryCard } from "@/components/obituaries/obituary-card";
import { ObituariesPagination } from "@/components/obituaries/obituaries-pagination";
import { obituariesHref } from "@/lib/obituary-format";
import { absoluteUrl } from "@/lib/seo";
import { parsePage } from "@/lib/board-params";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const page = parsePage((await searchParams).page);
  const title = page > 1 ? `Obituaries · Page ${page}` : "Obituaries";
  const description = "The dead of One Life, written up by the morgue desk — every qualified death gets its obituary.";
  const canonical = absoluteUrl(obituariesHref(page));
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

export default async function ObituariesPage({ searchParams }: Props) {
  const page = parsePage((await searchParams).page);
  const feed = await getObituariesFeed(page);
  const now = new Date();

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10">
      <div className="border-b-[3px] border-ink pb-4">
        <Kicker>The Morgue</Kicker>
        <h1 className="mt-2 font-display text-5xl font-bold uppercase leading-[.95] text-ink md:text-6xl">Obituaries</h1>
      </div>

      {feed.rows.length === 0 ? (
        <p className="py-16 font-mono text-sm uppercase tracking-[.05em] text-ink-muted">
          The morgue desk is quiet. Give it time — everyone dies here.
        </p>
      ) : (
        <>
          {feed.rows.map((card) => (
            <ObituaryCard key={card.slug} card={card} now={now} />
          ))}
          <ObituariesPagination page={feed.page} total={feed.total} pageSize={feed.pageSize} />
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 8: Run tests + typecheck** — `pnpm --filter @onelife/web test -- obituaries` (PASS), `pnpm --filter @onelife/web typecheck` (clean).

- [ ] **Step 9: Commit** — `git add apps/web/src/components/obituaries apps/web/src/components/skeletons.tsx apps/web/src/app/obituaries && git commit -m "feat(web): obituaries feed page, card, pagination, skeleton"`

---

## Task 11: Web — the `/obituaries/[slug]` interior article

**Files:**
- Create: `apps/web/src/components/obituaries/rap-sheet.tsx`, `.../pull-quote.tsx`, `.../more-from-morgue.tsx`, `.../obituary-article.tsx`
- Modify: `apps/web/src/components/life/timeline.tsx` (add optional `heading` prop)
- Create: `apps/web/src/app/obituaries/[slug]/page.tsx`
- Test: `apps/web/src/components/obituaries/obituary-article.test.tsx`

**Interfaces:**
- Consumes: `ObituaryArticle` (Task 9); `getObituary`, `getObituariesFeed`, `getPlayerLife` (api); `buildTimeline` + `Timeline` (R4); `rapSheetFacts`, `dateline`, `obituaryHref` (Task 9); `articleLd` (Task 9); `GamertagLink`; `lifeHref` (R4); `playerSlug`; `mapLabel` (`@/components/player/format`).
- Produces: `RapSheet`, `PullQuote`, `MoreFromMorgue`, `ObituaryArticleView` presentational components; the `/obituaries/[slug]` route.

- [ ] **Step 1: Add an optional `heading` prop to `apps/web/src/components/life/timeline.tsx`.** Change the `Timeline` signature to accept `heading` (default preserves current behavior — existing R4 tests still pass):

```tsx
export function Timeline({ view, heading = "The record so far" }: { view: LifeTimelineView; heading?: string }) {
```
and render `{heading}` where the hardcoded `"The record so far"` string was in its `<h2>`.

- [ ] **Step 2: Implement `apps/web/src/components/obituaries/rap-sheet.tsx`:**

```tsx
import { cn } from "@/lib/utils";
import { rapSheetFacts } from "@/lib/obituary-format";
import type { ObituaryArticle } from "@/lib/types";

/** The factual Rap Sheet box — deterministic facts, never the LLM. */
export function RapSheet({ article }: { article: ObituaryArticle }) {
  const facts = rapSheetFacts(article);
  const sessions = { label: "Sessions", value: String(article.sessions), hot: false };
  const all = [...facts.slice(0, facts.length - 1), sessions, facts[facts.length - 1]!]; // Cause last
  return (
    <section className="border-2 border-ink bg-bone p-5">
      <p className="font-display text-xs font-bold uppercase tracking-[.16em] text-ink">The Rap Sheet · Deceased</p>
      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
        {all.map((f) => (
          <div key={f.label}>
            <dd className={cn("font-display text-[26px] font-bold leading-none", f.hot ? "text-red" : "text-ink")}>{f.value}</dd>
            <dt className="mt-1 font-mono text-[10px] uppercase tracking-[.07em] text-ink-muted">{f.label}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}
```

- [ ] **Step 3: Implement `apps/web/src/components/obituaries/pull-quote.tsx`:**

```tsx
/** In-voice pull quote — attribution stays anonymous per the voice rules. */
export function PullQuote({ text, attribution }: { text: string; attribution: string }) {
  return (
    <blockquote className="my-6 border-l-[3px] border-red pl-5">
      <p className="font-display text-2xl font-bold uppercase leading-tight text-ink md:text-3xl">“{text}”</p>
      <footer className="mt-2 font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted">— {attribution}</footer>
    </blockquote>
  );
}
```

- [ ] **Step 4: Implement `apps/web/src/components/obituaries/more-from-morgue.tsx`:**

```tsx
import Link from "next/link";
import type { ObituaryCard } from "@/lib/types";
import { obituaryHref } from "@/lib/obituary-format";
import { mapLabel } from "@/components/player/format";

/** Related-rail: other recent obituaries (self already excluded by the caller). */
export function MoreFromMorgue({ rows }: { rows: ObituaryCard[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-10 border-t-[3px] border-ink pt-4">
      <h2 className="font-display text-sm font-bold uppercase tracking-[.14em] text-ink">More From the Morgue</h2>
      <ul className="mt-3 flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.slug}>
            <Link href={obituaryHref(r.slug)} className="group block">
              <span className="font-display text-lg font-bold uppercase leading-tight text-ink group-hover:text-red">{r.headline}</span>
              <span className="mt-0.5 block font-mono text-[10.5px] uppercase tracking-[.05em] text-ink-muted">{r.gamertag} · {mapLabel(r.map)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 5: Write the article test** at `apps/web/src/components/obituaries/obituary-article.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ObituaryArticleView } from "./obituary-article";
import type { ObituaryArticle } from "@/lib/types";

const article: ObituaryArticle = {
  slug: "the-king-is-dead-9", gamertag: "xX_Sn1per_Xx", map: "chernarusplus", mapSlug: "chernarus",
  lifeNumber: 4, headline: "The King Is Dead", lede: "He arrived with a flare.",
  tags: ["Obituaries", "Chernarus"], timeAliveSeconds: 3456000, kills: 212, longestKillMeters: 410,
  cause: "pvp", deathAt: "2026-07-10T22:16:00Z", body: "He left 212 kills behind.",
  pullQuote: { text: "You do not get a second life.", attribution: "a rival" }, sessions: 30,
  killerGamertag: "Chicken", weapon: "Reload",
};

describe("ObituaryArticleView", () => {
  test("renders headline, byline, body, pull quote, Rap Sheet, tags, gamertag link", () => {
    render(<ObituaryArticleView article={article} more={[]} finalReload={null} now={new Date("2026-07-12T00:00:00Z")} />);
    expect(screen.getByRole("heading", { level: 1, name: /The King Is Dead/ })).toBeInTheDocument();
    expect(screen.getByText(/CHERNARUS BUREAU/)).toBeInTheDocument();
    expect(screen.getByText("He left 212 kills behind.")).toBeInTheDocument();
    expect(screen.getByText(/You do not get a second life/)).toBeInTheDocument();
    expect(screen.getByText("212")).toBeInTheDocument(); // Rap Sheet kills
    expect(screen.getByText("Chernarus")).toBeInTheDocument(); // a tag
    expect(screen.getByRole("link", { name: "xX_Sn1per_Xx" })).toHaveAttribute("href", "/players/xx-sn1per-xx");
  });
});
```

- [ ] **Step 5b: Run it to verify it fails** — `pnpm --filter @onelife/web test -- obituary-article` — Expected: FAIL (module not found).

- [ ] **Step 6: Implement `apps/web/src/components/obituaries/obituary-article.tsx`** (`finalReload` is a `LifeTimelineView | null`; when null — un-slugged server or fetch miss — the section is omitted):

```tsx
import type { ReactNode } from "react";
import { GamertagLink } from "@/components/gamertag-link";
import { RapSheet } from "./rap-sheet";
import { PullQuote } from "./pull-quote";
import { MoreFromMorgue } from "./more-from-morgue";
import { Timeline } from "@/components/life/timeline";
import type { ObituaryArticle, ObituaryCard } from "@/lib/types";
import type { LifeTimelineView } from "@/lib/life-timeline";
import { dateline } from "@/lib/obituary-format";
import { mapLabel } from "@/components/player/format";

export function ObituaryArticleView({
  article,
  more,
  finalReload,
  now,
}: {
  article: ObituaryArticle;
  more: ObituaryCard[];
  finalReload: LifeTimelineView | null;
  now: Date;
}): ReactNode {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10 md:px-10">
      <div className="border-b-[3px] border-red pb-5">
        <p className="font-mono text-[11px] uppercase tracking-[.06em] text-red">Obituary · {dateline(article.map, article.deathAt, now)}</p>
        <h1 className="mt-2 font-display text-5xl font-bold uppercase leading-[.92] text-ink md:text-6xl">{article.headline}</h1>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          Filed by The Desk · A life of <GamertagLink gamertag={article.gamertag} className="font-bold text-ink underline" /> · Life {article.lifeNumber} · {mapLabel(article.map)}
        </p>
      </div>

      <p className="mt-6 font-mono text-[15px] font-bold leading-relaxed text-ink">{article.lede}</p>

      <div className="mt-5">
        <RapSheet article={article} />
      </div>

      {article.pullQuote && <PullQuote text={article.pullQuote.text} attribution={article.pullQuote.attribution} />}

      <div className="mt-5 space-y-4 font-mono text-[14px] leading-relaxed text-ink-soft">
        {article.body.split(/\n{2,}/).map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>

      {article.tags.length > 0 && (
        <p className="mt-6 flex flex-wrap gap-2">
          {article.tags.map((t) => (
            <span key={t} className="border border-dash px-2 py-1 font-mono text-[10px] uppercase tracking-[.06em] text-ink-muted">{t}</span>
          ))}
        </p>
      )}

      {finalReload && (
        <div className="mt-8">
          <Timeline view={finalReload} heading="The Final Reload" />
        </div>
      )}

      <MoreFromMorgue rows={more} />
    </main>
  );
}
```

- [ ] **Step 7: Create the route `apps/web/src/app/obituaries/[slug]/page.tsx`:**

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getObituary, getObituariesFeed, getPlayerLife } from "@/lib/api";
import { buildTimeline, type LifeTimelineView } from "@/lib/life-timeline";
import { ObituaryArticleView } from "@/components/obituaries/obituary-article";
import { articleLd, absoluteUrl } from "@/lib/seo";
import { obituaryHref } from "@/lib/obituary-format";
import { playerSlug } from "@/lib/slug";
import { mapLabel } from "@/components/player/format";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const a = await getObituary(slug).catch(() => null);
  if (!a) return { title: "Obituary — One Life" };
  const title = `${a.headline} — ${a.gamertag} — One Life`;
  return {
    title,
    description: a.lede,
    alternates: { canonical: absoluteUrl(obituaryHref(slug)) },
    openGraph: { title, description: a.lede, url: absoluteUrl(obituaryHref(slug)), type: "article" },
    twitter: { card: "summary_large_image", title, description: a.lede },
  };
}

async function loadFinalReload(a: { gamertag: string; mapSlug: string | null; lifeNumber: number }, now: Date): Promise<LifeTimelineView | null> {
  if (!a.mapSlug) return null; // un-slugged server: omit the Final Reload gracefully
  const life = await getPlayerLife(playerSlug(a.gamertag), a.mapSlug, a.lifeNumber).catch(() => null);
  return life ? buildTimeline(life, now) : null;
}

export default async function ObituaryPage({ params }: Props) {
  const { slug } = await params;
  const article = await getObituary(slug);
  if (!article) notFound();
  const now = new Date();
  const [finalReload, feed] = await Promise.all([
    loadFinalReload(article, now),
    getObituariesFeed(1).catch(() => ({ rows: [], total: 0, page: 1, pageSize: 20 })),
  ]);
  const more = feed.rows.filter((r) => r.slug !== article.slug).slice(0, 4);
  const ld = articleLd(article, absoluteUrl(obituaryHref(slug)));

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <ObituaryArticleView article={article} more={more} finalReload={finalReload} now={now} />
    </>
  );
}

void mapLabel; // (imported for parity with other pages; safe to drop if unused)
```

> Remove the trailing `void mapLabel;` line if the linter flags it — it's only there to note `mapLabel` is available; the article view imports its own copy.

- [ ] **Step 8: Run tests + typecheck** — `pnpm --filter @onelife/web test -- obituary-article` (PASS), `pnpm --filter @onelife/web test -- timeline` (R4 timeline tests still PASS with the new default prop), `pnpm --filter @onelife/web typecheck` (clean).

- [ ] **Step 9: Commit** — `git add apps/web/src/components/obituaries apps/web/src/components/life/timeline.tsx apps/web/src/app/obituaries/\[slug\] && git commit -m "feat(web): obituary interior article (rap sheet, pull quote, final reload, morgue rail)"`

---

## Task 12: Web — the interior OG image

**Files:**
- Create: `apps/web/src/app/obituaries/[slug]/opengraph-image.tsx`
- Create (copy assets): `apps/web/src/app/obituaries/[slug]/oswald-700.ttf`, `plex-mono-400.ttf`, `plex-mono-700.ttf` (copy the identical files from `apps/web/src/app/players/[slug]/`)

**Interfaces:**
- Consumes: `getObituary` (api), `rapSheetFacts`/`dateline` (Task 9).
- Produces: a 1200×630 PNG OG image per obituary. No test (image renderer; verified visually in the sweep).

> Next requires OG assets co-located with `opengraph-image.tsx` — the `players/[slug]/` copies are not shared across route folders, so the 3 `.ttf` files must be duplicated into this directory (`readFile(new URL('./name', import.meta.url))` resolves relative to the file). `next/og`'s Satori renderer uses inline `style={{}}` objects only (no Tailwind), literal hex colors, and `display: "flex"` on every multi-child container.

- [ ] **Step 1: Copy the font assets:**

```bash
cp apps/web/src/app/players/\[slug\]/oswald-700.ttf apps/web/src/app/players/\[slug\]/plex-mono-400.ttf apps/web/src/app/players/\[slug\]/plex-mono-700.ttf apps/web/src/app/obituaries/\[slug\]/
```

- [ ] **Step 2: Create `apps/web/src/app/obituaries/[slug]/opengraph-image.tsx`:**

```tsx
import { readFile } from "node:fs/promises";
import { ImageResponse } from "next/og";
import { getObituary } from "@/lib/api";
import { rapSheetFacts, dateline } from "@/lib/obituary-format";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "One Life obituary";

const asset = (name: string) => readFile(new URL(`./${name}`, import.meta.url));

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [article, oswald, mono, monoBold] = await Promise.all([
    getObituary(slug).catch(() => null),
    asset("oswald-700.ttf"),
    asset("plex-mono-400.ttf"),
    asset("plex-mono-700.ttf"),
  ]);

  const headline = article?.headline ?? "An Obituary";
  const line = article ? dateline(article.map, article.deathAt, new Date()) : "ONE LIFE · THE MORGUE";
  const facts = article ? rapSheetFacts(article) : [];

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0C0C08", color: "#FBFAF2", padding: 64 }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontFamily: "IBM Plex Mono", fontSize: 22, letterSpacing: 2, color: "#FF6B63", textTransform: "uppercase" }}>Obituary · {line}</div>
          <div style={{ display: "flex", fontFamily: "Oswald", fontWeight: 700, fontSize: 78, lineHeight: 1.02, textTransform: "uppercase", marginTop: 20, maxWidth: 1000 }}>{headline}</div>
        </div>
        <div style={{ display: "flex", gap: 48 }}>
          {facts.map((f) => (
            <div key={f.label} style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontFamily: "Oswald", fontWeight: 700, fontSize: 44, color: f.hot ? "#FF6B63" : "#FBFAF2" }}>{f.value}</div>
              <div style={{ display: "flex", fontFamily: "IBM Plex Mono", fontSize: 18, letterSpacing: 1.5, color: "#8A8878", textTransform: "uppercase", marginTop: 4 }}>{f.label}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Oswald", data: oswald, weight: 700, style: "normal" },
        { name: "IBM Plex Mono", data: mono, weight: 400, style: "normal" },
        { name: "IBM Plex Mono", data: monoBold, weight: 700, style: "normal" },
      ],
    },
  );
}
```

- [ ] **Step 3: Verify it typechecks** — `pnpm --filter @onelife/web typecheck` (clean). (No unit test; the OG renders in the visual sweep.)

- [ ] **Step 4: Commit** — `git add apps/web/src/app/obituaries/\[slug\] && git commit -m "feat(web): dynamic OG image for obituary articles"`

---

## Task 13: Final integration — full suite, grep gates, docs

**Files:**
- Modify: `CHANGELOG.md` (Unreleased → Added), `CLAUDE.md` (env + sub-project notes)

- [ ] **Step 1: Whole-repo suite + typecheck** — `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm turbo run test --concurrency=1` (all packages PASS) and `pnpm turbo run typecheck` (clean). Fix any regressions before proceeding.

- [ ] **Step 2: Grep gates** (each must return nothing):
  - `grep -rn "TODO\|FIXME\|placeholder" apps/newsdesk apps/web/src/components/obituaries apps/web/src/app/obituaries packages/read-models/src/obituary-articles.ts` — no leftover markers.
  - `grep -rn "robots.*index.*false\|noindex" apps/web/src/app/obituaries` — the teaser's noindex is gone.
  - `grep -rn "articles" apps/projector/src/rebuild.ts` — `articles` must NOT appear in the rebuild truncate list.
  - `grep -rn "\"articles\"" packages/test-support/src/global-setup.ts` — `articles` MUST appear in `APP_TABLES`.

- [ ] **Step 3: Update `CHANGELOG.md`** — under `## [Unreleased]` → `### Added`:

```markdown
- Tabloid redesign R5a — the newsdesk + Obituaries. A new `articles` table + `apps/newsdesk`
  sweep worker turn every qualified death into an obituary written in the One Life tabloid voice
  via OpenRouter, behind a dry-run gate (`NEWSDESK_DRY_RUN` defaults `true`). The Obituaries
  section goes live (retiring the static teaser): a reverse-chron `/obituaries` feed and a full
  interior article at `/obituaries/[slug]` — headline, byline, lede/body, an in-voice pull quote,
  a factual Rap Sheet, the R4-powered "Final Reload" timeline, tags, "More From the Morgue," a
  `NewsArticle` JSON-LD block, and a dynamic OG image. Facts (Rap Sheet, Final Reload) are read
  models only — the LLM writes voice, never invents events (Fog Rule: map dateline, never
  coordinates). Backed by `getPublishedObituaries`/`getObituaryBySlug` and public `GET /obituaries`
  (now published articles) + `GET /obituaries/:slug`.
```

- [ ] **Step 4: Update `CLAUDE.md`** (last content step before the PR):
  - In the `apps:` list, add `newsdesk` (obituary generation sweep; **`NEWSDESK_DRY_RUN` defaults `true`** — logs intended obituaries without calling OpenRouter or writing; set `false` to generate; needs `OPENROUTER_API_KEY` + `NEWSDESK_MODEL`, default `anthropic/claude-sonnet-5`).
  - In the `packages:` note, mention the new `articles` table (durable; content engine).
  - In the tabloid redesign section, change "R5+ content engine" to record **R5a shipped** — the newsdesk + Obituaries — with a one-paragraph summary matching the changelog, and note R5b (Birth Notices / Fresh Spawns) is next.
  - Note the voice-first rule now retires the **Obituaries** teaser (News + Fresh Spawns stay static until R5b/R5d).

- [ ] **Step 5: Commit** — `git add CHANGELOG.md CLAUDE.md && git commit -m "docs: R5a changelog + CLAUDE.md (newsdesk, obituaries, articles table)"`

- [ ] **Step 6: Hand off to `finishing-a-feature`** — open the PR into `develop`.

---

## Self-review checklist (author, before execution)

1. **Spec coverage:** articles table ✓ (T1); generation lib in-app ✓ (T4–T6); dry-run worker ✓ (T3,T7); read-models ✓ (T2); API routes ✓ (T8); feed page ✓ (T10); interior article ✓ (T11); OG ✓ (T12); voice-first / receipts-real / Fog Rule as Global Constraints ✓; reserved image columns ✓ (T1); **spec-bounded tags enforced deterministically via `composeTags` — the LLM only supplies ≤1 flavor tag** ✓ (T5,T7).

**Adversarial verification (5-agent workflow):** 0 critical; the compile-against-reality, cross-task type-consistency (opus), and web-import verifiers returned clean. 8 important findings all applied: `composeTags` deterministic-tags enforcement (was: LLM-controlled) + seven added TDD fail-first steps (T1 reordered test-first; T7 config/tick, T9, T10 ×2, T11).
2. **Type consistency:** `ObituaryFacts` (T4) → `PublishFacts` structural match (T3) → tick (T7) ✓; `Obituary` (T5) → `PublishObituary` structural match (T3) ✓; `CompletionClient` defined in `generate.ts` (T6), imported by `openrouter.ts` + `tick.ts` ✓; web DTOs (T9) mirror read-model shapes with string dates ✓; `getPublishedObituaries`/`getObituaryBySlug` names consistent across T2/T8 ✓.
3. **Placeholders:** none — every code step is complete. The one `void mapLabel;` note in T11 is flagged for removal.
4. **Sequencing:** T3 avoids a forward dependency on T4/T5 by using structural `PublishFacts`/`PublishObituary`; T6 owns `CompletionClient`; T7 wires everything. No task references a symbol defined only in a later task.
