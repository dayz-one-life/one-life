# R5b — Birth Notices / Fresh Spawns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the static Fresh Spawns teaser and turn it into a live editorial vertical — the newsdesk engine writes a short, in-voice Birth Notice for every qualified life going forward, surfaced at `/fresh-spawns` (feed + slim interior) plus two new home-page content blocks.

**Architecture:** A sibling "birth pass" is added to the existing `apps/newsdesk` worker, mirroring the R5a obituary pass one file for one file. Birth notices live in the same durable `articles` table under a new `kind='birth_notice'` (one small migration for a nullable `death_at` + a born-order index). Because the current life is thin (the subject just qualified and is still alive), the story material comes from the player's **global cross-life priors**, not the current life. Everything factual is read-model-derived; the LLM writes only voice.

**Tech Stack:** pnpm + turbo monorepo, TypeScript ESM (`.js` import extensions), Postgres + Drizzle, Fastify + Zod, Next.js 15 App Router + React 19 + Tailwind v3, Vitest, pino, OpenRouter.

**Spec:** `docs/superpowers/specs/2026-07-17-r5b-birth-notices-fresh-spawns-design.md`.

## Global Constraints

Every task's requirements implicitly include this section.

- **ESM:** all relative imports use `.js` extensions. Follow the exact import style of the R5a template files.
- **Durable table:** `articles` is never truncated/rebuilt — excluded from `apps/projector/src/rebuild.ts` and present in test-support `APP_TABLES`. Do not add it to any rebuild path.
- **New kind:** birth notices use `kind = 'birth_notice'`. Natural key stays `(kind, serverId, gamertag, lifeStartedAt)` — one life can hold BOTH an obituary and a birth notice.
- **Feed order:** birth-notice feed orders by `lifeStartedAt DESC` (freshest first). Backed by the new index `articles_kind_status_born_idx (kind, status, life_started_at)`.
- **`death_at` becomes nullable** (migration `0010`): a living spawn has no death. Obituary reads (which order by `death_at`) keep their non-null values and are unaffected.
- **Dry-run safety:** the birth pass honors the single existing `NEWSDESK_DRY_RUN` gate (`dryRun = value !== "false"`). The dry-run `continue` sits structurally BEFORE any OpenRouter call or DB write.
- **Forward-only cutoff:** `NEWSDESK_BIRTH_SINCE` is an ISO-8601 timestamp; **unset/empty/unparseable ⇒ `config.birthSince = null` ⇒ the birth pass returns 0 targets and never calls the client.** Parallel to the dry-run safety.
- **Fog Rule (hard):** map is the dateline; **NEVER a coordinate/pin**. The subject is alive.
- **Voice:** deterministic facts come from read-models ONLY; the LLM writes only headline/lede/body/pull-quote/flavor-tags. Hard bans (carried from R5a): no sincerity clichés, no wink/meta, no corporate/data-speak, no slurs or real-person attacks, anonymous pull-quote attributions. **Never mock a first-lifer for being new**; mockery targets a repeat offender's record.
- **Priors = every prior life** the player has lived on any server (`startedAt < beforeLifeStartedAt`), NOT filtered to qualified. First-lifer (`livesLived === 0`) → the "No priors. A stranger to these shores." branch.
- **JSON-LD:** every JSON-LD sink uses the shared `ldScript()` helper (`apps/web/src/lib/seo.ts`), never raw `JSON.stringify` in `dangerouslySetInnerHTML`.
- **Section identity:** "The Nursery" (parallel to Obituaries' "The Morgue"); nav label stays "Fresh Spawns" → `/fresh-spawns`. Accent color is brand **blue** (birth/alive semantic), paralleling obituary red.
- **Tests:** Vitest. DB-backed suites use `getTestDb` from `@onelife/test-support` and require `TEST_DATABASE_URL` (this dev box remaps Postgres to **port 5434** via a gitignored `docker-compose.override.yml`; the committed default is 5432). Prefer the per-package `pnpm --filter <pkg> test <file-substring>` form with `TEST_DATABASE_URL` inlined — `pnpm turbo run test` strips it under strict envMode. Never fabricate a vacuous test; Next.js pages / OG routes / `main.ts` are gated by `pnpm --filter <pkg> typecheck` (+ build), not forced unit tests, exactly as R5a leaves them.
- **Deploy:** migration `0010` auto-applies via `./deploy/deploy.sh` (plain, **NOT** `--rebuild` — the table is durable).

## File Structure

**Create:**
- `packages/db/drizzle/0010_*.sql` (+ drizzle meta snapshot)
- `packages/read-models/src/player-priors.ts` (+ `test/player-priors.test.ts`)
- `packages/read-models/src/birth-notice-articles.ts` (+ `test/birth-notice-articles.test.ts`)
- `apps/newsdesk/src/{birth-facts,birth-voice,birth-prompt,birth-pg-store,birth-tick}.ts` (+ `test/{birth-facts,birth-prompt,birth-pg-store,birth-tick}.test.ts`)
- `apps/api/src/routes/birth-notices.ts` (+ `test/birth-notices.test.ts`)
- `apps/web/src/lib/birth-format.ts` (+ `birth-format.test.ts`)
- `apps/web/src/components/birth-notices/{birth-notice-card,birth-notice-article,priors-box,more-fresh-meat,birth-notices-pagination}.tsx` (+ tests)
- `apps/web/src/components/shared/{pull-quote,numbered-pager}.tsx` (promoted from obituaries)
- `apps/web/src/app/fresh-spawns/loading.tsx`
- `apps/web/src/app/fresh-spawns/[slug]/{page,opengraph-image}.tsx`
- `apps/web/src/components/front-page/{latest-obituaries,latest-fresh-spawns}.tsx` (+ tests)

**Modify:**
- `packages/db/src/schema.ts` (`death_at` nullable + new index)
- `packages/read-models/src/index.ts` (barrel: `player-priors`, `birth-notice-articles`)
- `apps/newsdesk/src/{config,generate,main,prompt}.ts` (`prompt.ts`: export `mapLabel`) + `test/config.test.ts`
- `apps/api/src/app.ts` (register birth-notices routes)
- `apps/web/src/lib/{types,api,seo}.ts` (+ `seo.test.ts`)
- `apps/web/src/app/fresh-spawns/page.tsx` (replace teaser, drop `noindex`)
- `apps/web/src/app/page.tsx` (wire the two home blocks)
- `apps/web/src/components/obituaries/{obituary-article,obituaries-pagination}.tsx` (re-point to shared `pull-quote`/`numbered-pager`)
- `CHANGELOG.md`, `CLAUDE.md`

## Ratified coherence decisions (read before implementing)

These were resolved during plan authoring and are binding — do not "fix" them back:

1. **`birth-pg-store.ts` is created in two steps.** Task 04 creates it containing ONLY the `BirthNoticeTarget` interface (so `birth-facts.ts` can import the type); Task 07 adds `birthNoticeSlug`, `findBirthNoticeTargets`, `publishBirthNotice`, `recordBirthNoticeFailure`, and the `PublishBirthInput`/`PublishBirthFacts`/`PublishBirthNotice` types. This mirrors R5a's `facts.ts → pg-store.ts` type-import direction (no cycle).
2. **`mapLabel` is exported** from `apps/newsdesk/src/prompt.ts` (Task 05, one-line, non-breaking) and imported by `birth-prompt.ts` — the DRY way to satisfy "reuse the obituary helper."
3. **`PublishBirthInput` = `{ target, facts, notice, promptVersion, model, now }`** (mirrors R5a's `PublishInput`, with `notice` where R5a has `obituary`). `BirthFacts` rides into the `facts` jsonb whole.
4. **`getPlayerPriors` counts every prior life** (not qualified-only) and computes `totalKills` as a global count of kills scored before the current life began. First-lifer → all zero/null.
5. **`findBirthNoticeTargets` orders ASC** (oldest-first from the cutoff — process forward). The feed read-model stays DESC.
6. **`birthShowingLine(page, total, pageSize)`** — note the arg order differs from R5a's `obituaryShowingLine(page, pageSize, total)`. `birthDateline` is hours/minutes-granular (a private `bornAgo` helper; falls back to the day-granular `relativeDate` at ≥24h). The interior `PriorsBox` arrival note is clock-free (`monthYear(bornAt)` + `minutesToQualify`), since the client `BirthNoticeArticle` type carries no `persona` and the box takes no `now`.
7. **Shared promotion:** `pull-quote.tsx` is `git mv`'d to `components/shared/`, the numbered pager is extracted to `components/shared/numbered-pager.tsx`, and BOTH obituary components are re-pointed with identical rendered DOM so the shipped obituary tests pass unchanged.
8. **`0010` is applied by test globalSetup** before Tasks 03/07/08/11 DB tests run; the linear task order 01→17 satisfies every cross-task dependency (02 before 04/05/08; 01 before 03/07/08/11).

## Task Index

Execute in numeric order (01→17). Each task ends with a passing test cycle (or a stated typecheck/build gate) and a commit.

1. Migration `0010` + schema (`death_at` nullable, born index)
2. `getPlayerPriors` read-model
3. `birth-notice-articles` read-model + barrel
4. `birth-facts.ts` (+ `BirthNoticeTarget` type stub in `birth-pg-store.ts`)
5. `birth-voice.ts` (`BIRTH_SYSTEM`) + `birth-prompt.ts` (+ export `mapLabel`)
6. `generateBirthNotice`
7. `birth-pg-store.ts` (slug, find-targets, publish, failure)
8. `birth-tick.ts`
9. `config.ts` — `NEWSDESK_BIRTH_SINCE`
10. `main.ts` — run both passes
11. `birth-notices` API routes + register
12. Web lib — types / api / birth-format / seo
13. `components/birth-notices/` + shared pull-quote/pager promotion
14. `/fresh-spawns` feed page + loading
15. `/fresh-spawns/[slug]` interior + OG image
16. Home-page blocks (Latest Obituaries + Latest Fresh Spawns)
17. Docs — CHANGELOG + CLAUDE.md

---

### Task 01: Migration 0010 + schema — birth-notice column nullability + feed index

**Files:**
- Modify: `packages/db/src/schema.ts` (articles def: `deathAt` drops `.notNull()`; add `bornIdx`; lines 354–390)
- Create: `packages/db/drizzle/0010_birth_notice_columns.sql` (generated by drizzle-kit)
- Create: `packages/db/drizzle/meta/0010_snapshot.json` (generated by drizzle-kit)
- Modify: `packages/db/drizzle/meta/_journal.json` (drizzle-kit appends the 0010 entry)
- Test: `packages/read-models/test/articles-schema.test.ts` (extend the existing round-trip suite)

**Interfaces:**
- Consumes: the existing `articles` `pgTable` (schema.ts:354) with natural-key unique index
  `articles_kind_server_gamertag_life_uniq` on `(kind, serverId, gamertag, lifeStartedAt)` and the
  existing `articles_kind_status_death_idx`. `getTestDb()` from `@onelife/test-support` (applies
  drizzle migrations at globalSetup, then truncates `articles` — it is in `APP_TABLES`).
- Produces (bind verbatim — the whole R5b plan depends on these):
  - `articles.deathAt` is **NULLABLE** (`timestamp("death_at", { withTimezone: true })`, no `.notNull()`).
    A living birth-notice subject stores `death_at = NULL`; obituary rows keep a non-null `death_at`.
  - New index `articles_kind_status_born_idx` on `(kind, status, life_started_at)` (Drizzle key `bornIdx`).
  - Migration `0010_birth_notice_columns` auto-applies via plain `./deploy/deploy.sh` (durable table — NOT `--rebuild`).

---

- [ ] **Step 1: Write the failing test**

Extend `packages/read-models/test/articles-schema.test.ts` to its complete new form below. It adds a
`birth_notice` describe block that (a) round-trips a row with `death_at = NULL` + a `facts` snapshot,
and (b) asserts a raw feed query orders `birth_notice` rows by `life_started_at DESC`. The pre-existing
obituary case (non-null `death_at`) stays, proving obituary rows still round-trip.

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, articles } from "@onelife/db";
import { eq, and, desc } from "drizzle-orm";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 52e7;
const startedAt = new Date("2026-07-10T00:00:00Z");
const bornEarly = new Date("2026-07-11T00:00:00Z");
const bornLate = new Date("2026-07-11T06:00:00Z");
let serverId: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "ar", map: "chernarusplus", slug: `ar-${svc}`, active: true }).returning();
  serverId = s!.id;
});
afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("articles table", () => {
  it("stores a published obituary keyed on the natural life tuple, with tags + facts jsonb", async () => {
    await db.insert(articles).values({
      kind: "obituary", status: "published", slug: `the-end-${svc}`,
      serverId, gamertag: `ar-${svc}`, map: "chernarusplus", mapSlug: `ar-${svc}`,
      lifeNumber: 1, lifeStartedAt: startedAt, deathAt: new Date("2026-07-10T02:00:00Z"),
      timeAliveSeconds: 7200, kills: 3, longestKillMeters: 210.5, cause: "pvp",
      headline: "H", lede: "L", body: "B", pullQuoteText: "q", pullQuoteAttribution: "a rival",
      tags: ["Obituaries", "Chernarus"], facts: { sessions: 2, killerGamertag: "Killer", weapon: "M4" },
      promptVersion: "obituary-v1", model: "test", attempts: 1, generatedAt: new Date("2026-07-10T03:00:00Z"),
    });
    const [row] = await db.select().from(articles).where(and(eq(articles.serverId, serverId), eq(articles.kind, "obituary")));
    expect(row!.tags).toEqual(["Obituaries", "Chernarus"]);
    expect((row!.facts as { sessions: number }).sessions).toBe(2);
    expect(row!.deathAt).not.toBeNull(); // obituary rows keep a non-null death_at
    expect(row!.imageUrl).toBeNull(); // reserved R5c column present + nullable
  });
});

describe("articles birth notices (nullable death_at + born feed order)", () => {
  const priors = {
    livesLived: 3, longestLifeSeconds: 12000, totalKills: 5,
    usualDeathCause: "pvp", lastDeathCause: "starvation", bestLifeMap: "sakhal",
  };
  beforeAll(async () => {
    await db.insert(articles).values([
      // died before the sweep → death_at set
      { kind: "birth_notice", status: "published", slug: `bn-early-${svc}`, serverId, gamertag: `bn-${svc}`,
        map: "chernarusplus", mapSlug: `ar-${svc}`, lifeNumber: 1, lifeStartedAt: bornEarly,
        deathAt: new Date("2026-07-11T02:00:00Z"), headline: "Born Early", lede: "e-lede", body: "e-body",
        tags: ["Fresh Spawns", "Chernarus", "Repeat Offender"],
        facts: { minutesToQualify: 12, priors, isKnownQuantity: true }, generatedAt: bornEarly },
      // still alive → death_at NULL (the new nullability under test)
      { kind: "birth_notice", status: "published", slug: `bn-late-${svc}`, serverId, gamertag: `bn2-${svc}`,
        map: "chernarusplus", mapSlug: `ar-${svc}`, lifeNumber: 1, lifeStartedAt: bornLate,
        deathAt: null, headline: "Born Late", lede: "l-lede", body: "l-body",
        tags: ["Fresh Spawns", "Chernarus", "First Life"],
        facts: { minutesToQualify: 5, priors: { livesLived: 0, longestLifeSeconds: 0, totalKills: 0, usualDeathCause: null, lastDeathCause: null, bestLifeMap: null }, isKnownQuantity: false },
        generatedAt: bornLate },
    ]);
  });

  it("round-trips a birth_notice with a NULL death_at and its facts jsonb", async () => {
    const [row] = await db.select().from(articles).where(and(eq(articles.serverId, serverId), eq(articles.slug, `bn-late-${svc}`)));
    expect(row!.deathAt).toBeNull();
    expect((row!.facts as { minutesToQualify: number }).minutesToQualify).toBe(5);
    expect((row!.facts as { isKnownQuantity: boolean }).isKnownQuantity).toBe(false);
  });

  it("feeds birth notices newest spawn first (life_started_at desc)", async () => {
    const rows = await db
      .select({ slug: articles.slug, lifeStartedAt: articles.lifeStartedAt })
      .from(articles)
      .where(and(eq(articles.serverId, serverId), eq(articles.kind, "birth_notice")))
      .orderBy(desc(articles.lifeStartedAt));
    expect(rows.map((r) => r.slug)).toEqual([`bn-late-${svc}`, `bn-early-${svc}`]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test articles-schema
```
(Committed default port is 5432; this dev machine's docker-compose.override maps Postgres to **5434**.)

Expected failure: the `beforeAll` insert of the `bn-late` row throws a Postgres
`null value in column "death_at" of relation "articles" violates not-null constraint` (23502) — the
test DB is migrated only through `0009`, where `death_at` is still `NOT NULL`. Both new `it`s error out.

- [ ] **Step 3: Write the implementation**

3a. Edit `packages/db/src/schema.ts` — drop `.notNull()` on `deathAt` and widen its comment:

```ts
  deathAt: timestamp("death_at", { withTimezone: true }),               // obituaries: lives.ended_at (feed order); birth notices: NULL while alive
```
(was `timestamp("death_at", { withTimezone: true }).notNull(),  // lives.ended_at — feed ordering`)

3b. Widen the `kind` column comment (same table, purely documentary):

```ts
  kind: text("kind").notNull(),                                       // 'obituary' | 'birth_notice'
```

3c. Add the born-feed index to the articles index object (after `feedIdx`):

```ts
}, (t) => ({
  uniqLife: uniqueIndex("articles_kind_server_gamertag_life_uniq").on(t.kind, t.serverId, t.gamertag, t.lifeStartedAt),
  uniqSlug: uniqueIndex("articles_slug_uniq").on(t.slug),
  feedIdx: index("articles_kind_status_death_idx").on(t.kind, t.status, t.deathAt),
  bornIdx: index("articles_kind_status_born_idx").on(t.kind, t.status, t.lifeStartedAt),
}));
```

3d. Generate the migration + meta snapshot with drizzle-kit (offline diff — no DB connection needed):

```
pnpm --filter @onelife/db exec drizzle-kit generate --name birth_notice_columns
```

This writes `packages/db/drizzle/0010_birth_notice_columns.sql`, `packages/db/drizzle/meta/0010_snapshot.json`,
and appends the `0010_birth_notice_columns` entry to `packages/db/drizzle/meta/_journal.json`. No
column renames are involved (nullability + additive index only), so generation is non-interactive.

3e. Verify the generated SQL matches intent (both statements present, no destructive drops):

```
cat packages/db/drizzle/0010_birth_notice_columns.sql
```
Expected (statement order may vary; both must be present):
```sql
ALTER TABLE "articles" ALTER COLUMN "death_at" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_kind_status_born_idx" ON "articles" USING btree ("kind","status","life_started_at");
```
If the file contains any `DROP COLUMN`/`DROP TABLE` or touches a table other than `articles`, discard it
(`git checkout`/`rm` the generated files), re-check the schema edit, and regenerate.

- [ ] **Step 4: Run tests to verify they pass**

```
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test articles-schema
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/db test
pnpm --filter @onelife/db typecheck
```
Expected: globalSetup now applies `0010` (drops the not-null on `death_at`, adds `articles_kind_status_born_idx`);
the `bn-late` null-`death_at` insert succeeds; both new `it`s PASS and the obituary round-trip still PASSES.
`@onelife/db test` passes (`--passWithNoTests`) and typecheck is clean.

- [ ] **Step 5: Commit**

```
git add packages/db/src/schema.ts \
        packages/db/drizzle/0010_birth_notice_columns.sql \
        packages/db/drizzle/meta/0010_snapshot.json \
        packages/db/drizzle/meta/_journal.json \
        packages/read-models/test/articles-schema.test.ts
git commit -m "feat(db): migration 0010 — nullable articles.death_at + born feed index for birth notices"
```


### Task 02: getPlayerPriors — global cross-server prior-lives read-model

**Files:**
- Create: `packages/read-models/src/player-priors.ts`
- Create: `packages/read-models/test/player-priors.test.ts`
- Modify: `packages/read-models/src/index.ts` (barrel export, after line 15)

**Interfaces:**
- Consumes: `Database` + the `players`/`lives`/`servers`/`kills` tables from `@onelife/db`; drizzle
  `and`/`eq`/`lt`/`sql`. `getTestDb()` from `@onelife/test-support`.
- Produces (bind verbatim — the newsdesk birth pass and the article read-model depend on these):
```ts
export interface PlayerPriors {
  livesLived: number;              // count of PRIOR lives (startedAt < beforeLifeStartedAt); excludes current
  longestLifeSeconds: number;      // best prior life; 0 if none
  totalKills: number;              // confirmed kills across all prior lives
  usualDeathCause: string | null;  // most-common death cause across prior lives; null if none
  lastDeathCause: string | null;   // cause of most-recent prior death; null if none
  bestLifeMap: string | null;      // servers.map of the longest prior life; null if none
}
export function getPlayerPriors(
  db: Database, gamertag: string, beforeLifeStartedAt: Date,
): Promise<PlayerPriors>;
```
  Re-exported from `packages/read-models/src/index.ts` (so newsdesk can `import { PlayerPriors } from "@onelife/read-models"`).

---

- [ ] **Step 1: Write the failing test**

`packages/read-models/test/player-priors.test.ts`. Seeds one player with prior lives across TWO
servers (one Chernarus, one Sakhal), a still-open current life that must be excluded, and kills on
both sides of the current-life boundary. A second player is a genuine first-lifer.

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, kills } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { getPlayerPriors } from "../src/player-priors.js";

const { db, sql } = getTestDb();
const now = new Date("2026-07-14T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);
const svcA = Math.floor(Math.random() * 1e8) + 47e7;
const svcB = Math.floor(Math.random() * 1e8) + 48e7;
const tag = `priors-${svcA}`;
const firstTag = `firstlifer-${svcA}`;
const currentLifeStart = hoursAgo(10); // beforeLifeStartedAt for the main player
let chern: number; let sakh: number;
const pids: number[] = [];

beforeAll(async () => {
  const [a] = await db.insert(servers).values({ nitradoServiceId: svcA, name: "pr-chern", map: "chernarusplus", slug: `pr-chern-${svcA}`, active: true }).returning();
  const [b] = await db.insert(servers).values({ nitradoServiceId: svcB, name: "pr-sakh", map: "sakhal", slug: `pr-sakh-${svcB}`, active: true }).returning();
  chern = a!.id; sakh = b!.id;

  const [p] = await db.insert(players).values({ gamertag: tag, firstSeenAt: hoursAgo(200), lastSeenAt: now }).returning();
  pids.push(p!.id);
  const [fp] = await db.insert(players).values({ gamertag: firstTag, firstSeenAt: hoursAgo(3), lastSeenAt: now }).returning();
  pids.push(fp!.id);

  await db.insert(lives).values([
    // prior life 1 (chern): 1h playtime, pvp
    { serverId: chern, playerId: p!.id, lifeNumber: 1, startedAt: hoursAgo(100), endedAt: hoursAgo(96), playtimeSeconds: 3600, deathCause: "pvp" },
    // prior life 2 (sakh): 10h playtime — LONGEST → bestLifeMap = sakhal, pvp
    { serverId: sakh, playerId: p!.id, lifeNumber: 1, startedAt: hoursAgo(90), endedAt: hoursAgo(80), playtimeSeconds: 36000, deathCause: "pvp" },
    // prior life 3 (chern): most-recent prior DEATH → lastDeathCause = starvation
    { serverId: chern, playerId: p!.id, lifeNumber: 2, startedAt: hoursAgo(70), endedAt: hoursAgo(60), playtimeSeconds: 1800, deathCause: "starvation" },
    // CURRENT life (chern): open, started at the boundary → EXCLUDED from priors
    { serverId: chern, playerId: p!.id, lifeNumber: 3, startedAt: currentLifeStart, endedAt: null, playtimeSeconds: 0 },
    // first-lifer: a single (only) life
    { serverId: chern, playerId: fp!.id, lifeNumber: 1, startedAt: hoursAgo(3), endedAt: null, playtimeSeconds: 0 },
  ]);

  await db.insert(kills).values([
    { serverId: sakh, killerGamertag: tag, victimGamertag: "V1", weapon: "M4", distance: 40, occurredAt: hoursAgo(85) },   // prior
    { serverId: chern, killerGamertag: tag, victimGamertag: "V2", weapon: "AK", distance: 60, occurredAt: hoursAgo(65) },   // prior
    { serverId: chern, killerGamertag: tag, victimGamertag: "V3", weapon: "SVD", distance: 300, occurredAt: hoursAgo(5) },  // current life → excluded
  ]);
});
afterAll(async () => {
  await db.delete(kills).where(inArray(kills.serverId, [chern, sakh]));
  await db.delete(lives).where(inArray(lives.serverId, [chern, sakh]));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(inArray(servers.id, [chern, sakh]));
  await sql.end();
});

describe("getPlayerPriors", () => {
  it("aggregates prior lives globally across servers, excluding the current life", async () => {
    const pr = await getPlayerPriors(db, tag, currentLifeStart);
    expect(pr.livesLived).toBe(3);              // 3 priors, not 4 (current life excluded)
    expect(pr.longestLifeSeconds).toBe(36000);  // the sakhal life
    expect(pr.bestLifeMap).toBe("sakhal");      // cross-server: longest lived elsewhere
    expect(pr.totalKills).toBe(2);              // kills before the boundary only
  });

  it("distinguishes the usual death cause from the last death cause", async () => {
    const pr = await getPlayerPriors(db, tag, currentLifeStart);
    expect(pr.usualDeathCause).toBe("pvp");         // 2 pvp vs 1 starvation
    expect(pr.lastDeathCause).toBe("starvation");   // most-recent prior death (life 3)
  });

  it("returns zeros/nulls for a first-lifer (no prior lives)", async () => {
    const pr = await getPlayerPriors(db, firstTag, hoursAgo(3));
    expect(pr).toEqual({
      livesLived: 0, longestLifeSeconds: 0, totalKills: 0,
      usualDeathCause: null, lastDeathCause: null, bestLifeMap: null,
    });
  });

  it("returns zeros/nulls for an unknown gamertag", async () => {
    const pr = await getPlayerPriors(db, "nobody-xyz-123", now);
    expect(pr.livesLived).toBe(0);
    expect(pr.bestLifeMap).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test player-priors
```
Expected failure: `Failed to resolve import "../src/player-priors.js"` — the module does not exist yet,
so Vitest cannot collect the suite.

- [ ] **Step 3: Write the implementation**

`packages/read-models/src/player-priors.ts` — a global-by-gamertag aggregation of the player's prior
lives. Deterministic (ordered by `startedAt`); the LLM never touches this. `totalKills` counts kills
scored before the current life started (kills happen only during a life, so this equals kills across
all prior lives, across all servers). `usualDeathCause`/`longestLife` tie-break on earliest-started
prior life via the query order.

```ts
import type { Database } from "@onelife/db";
import { players, lives, servers, kills } from "@onelife/db";
import { and, eq, lt, sql } from "drizzle-orm";

export interface PlayerPriors {
  livesLived: number;              // count of PRIOR lives (startedAt < beforeLifeStartedAt); excludes current
  longestLifeSeconds: number;      // best prior life; 0 if none
  totalKills: number;              // confirmed kills across all prior lives
  usualDeathCause: string | null;  // most-common death cause across prior lives; null if none
  lastDeathCause: string | null;   // cause of most-recent prior death; null if none
  bestLifeMap: string | null;      // servers.map of the longest prior life; null if none
}

const EMPTY: PlayerPriors = {
  livesLived: 0, longestLifeSeconds: 0, totalKills: 0,
  usualDeathCause: null, lastDeathCause: null, bestLifeMap: null,
};

/**
 * The player's reputation before `beforeLifeStartedAt` — every life they lived earlier, on any
 * server (players are one identity per gamertag; lives are per-server). Excludes the current life.
 * A first-lifer (no prior lives) → all zeros/nulls.
 */
export async function getPlayerPriors(
  db: Database,
  gamertag: string,
  beforeLifeStartedAt: Date,
): Promise<PlayerPriors> {
  const p = (await db.select({ id: players.id }).from(players).where(eq(players.gamertag, gamertag)))[0];
  if (!p) return { ...EMPTY };

  // All prior lives across all servers, oldest first (deterministic tie-breaks below).
  const priorLives = await db
    .select({
      endedAt: lives.endedAt,
      playtimeSeconds: lives.playtimeSeconds,
      deathCause: lives.deathCause,
      map: servers.map,
    })
    .from(lives)
    .innerJoin(servers, eq(servers.id, lives.serverId))
    .where(and(eq(lives.playerId, p.id), lt(lives.startedAt, beforeLifeStartedAt)))
    .orderBy(lives.startedAt);

  if (priorLives.length === 0) return { ...EMPTY };

  // longest prior life + its map (first strict-max wins → oldest on a tie)
  let longestLifeSeconds = 0;
  let bestLifeMap: string | null = null;
  for (const l of priorLives) {
    if (l.playtimeSeconds > longestLifeSeconds) {
      longestLifeSeconds = l.playtimeSeconds;
      bestLifeMap = l.map;
    }
  }

  // usual death cause = mode across non-null causes (first-inserted wins on a tie → oldest life)
  const counts = new Map<string, number>();
  for (const l of priorLives) {
    if (l.deathCause) counts.set(l.deathCause, (counts.get(l.deathCause) ?? 0) + 1);
  }
  let usualDeathCause: string | null = null;
  let bestCount = 0;
  for (const [cause, c] of counts) {
    if (c > bestCount) { bestCount = c; usualDeathCause = cause; }
  }

  // last death cause = cause of the most-recently ended prior life
  const ended = priorLives.filter((l) => l.endedAt !== null && l.deathCause !== null);
  ended.sort((a, b) => b.endedAt!.getTime() - a.endedAt!.getTime());
  const lastDeathCause = ended[0]?.deathCause ?? null;

  // confirmed kills across all prior lives = kills scored before the current life began (any server)
  const kc = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(kills)
    .where(and(eq(kills.killerGamertag, gamertag), lt(kills.occurredAt, beforeLifeStartedAt)));
  const totalKills = kc[0]?.c ?? 0;

  return {
    livesLived: priorLives.length,
    longestLifeSeconds,
    totalKills,
    usualDeathCause,
    lastDeathCause,
    bestLifeMap,
  };
}
```

Add the barrel export to `packages/read-models/src/index.ts` (append after the last line
`export * from "./obituary-articles.js";`):

```ts
export * from "./player-priors.js";
```

- [ ] **Step 4: Run tests to verify they pass**

```
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test player-priors
pnpm --filter @onelife/read-models typecheck
```
Expected: all four `it`s PASS (multi-server aggregation with `livesLived=3`, `bestLifeMap=sakhal`,
`totalKills=2`; `usualDeathCause=pvp` vs `lastDeathCause=starvation`; first-lifer + unknown → empty).
Typecheck clean.

- [ ] **Step 5: Commit**

```
git add packages/read-models/src/player-priors.ts \
        packages/read-models/test/player-priors.test.ts \
        packages/read-models/src/index.ts
git commit -m "feat(read-models): getPlayerPriors — global cross-server prior-lives aggregation"
```


### Task 03: birth-notice-articles read-model — feed + slug hydration

**Files:**
- Create: `packages/read-models/src/birth-notice-articles.ts`
- Create: `packages/read-models/test/birth-notice-articles.test.ts`
- Modify: `packages/read-models/src/index.ts` (barrel export, after the `player-priors.js` line from Task 02)

**Interfaces:**
- Consumes: `articles` from `@onelife/db` (with the Task 01 nullable `deathAt` + `articles_kind_status_born_idx`);
  `PlayerPriors` from `./player-priors.js` (Task 02); drizzle `and`/`eq`/`desc`/`sql`. `getTestDb()`.
  The `facts` jsonb column holds the newsdesk `BirthFacts` snapshot — `{ minutesToQualify: number|null,
  priors: PlayerPriors, ... }`. `articles.deathAt` (nullable) is the birth notice's `endedAt`.
- Produces (bind verbatim — API routes + web client mirror these):
```ts
export const BIRTH_NOTICES_FEED_PAGE_SIZE = 20;
export interface BirthNoticeCard {
  slug: string; gamertag: string; map: string; mapSlug: string | null; lifeNumber: number;
  headline: string; lede: string; tags: string[];
  bornAt: Date; minutesToQualify: number | null; priorLives: number;
}
export interface BirthNoticesFeed { rows: BirthNoticeCard[]; total: number; page: number; pageSize: number; }
export interface BirthNoticeArticle extends BirthNoticeCard {
  body: string; pullQuote: { text: string; attribution: string } | null;
  priors: PlayerPriors; endedAt: Date | null;
}
export function getPublishedBirthNotices(
  db: Database, opts: { page: number; pageSize?: number },
): Promise<BirthNoticesFeed>;
export function getBirthNoticeBySlug(db: Database, slug: string): Promise<BirthNoticeArticle | null>;
```
  Re-exported from `packages/read-models/src/index.ts`.

---

- [ ] **Step 1: Write the failing test**

`packages/read-models/test/birth-notice-articles.test.ts` (mirrors `obituary-articles.test.ts`).
Seeds `birth_notice` rows directly against a server: an alive freshest spawn (`death_at` null, known
quantity), an older spawn that has since died (`death_at` set, first-lifer), and a failed stub that
must be excluded. Requires the Task 01 migration (null `death_at`).

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, articles } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getPublishedBirthNotices, getBirthNoticeBySlug } from "../src/birth-notice-articles.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 52e7;
const t0 = new Date("2026-07-12T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
let serverId: number;

const knownPriors = {
  livesLived: 4, longestLifeSeconds: 12000, totalKills: 7,
  usualDeathCause: "pvp", lastDeathCause: "starvation", bestLifeMap: "sakhal",
};
const noPriors = {
  livesLived: 0, longestLifeSeconds: 0, totalKills: 0,
  usualDeathCause: null, lastDeathCause: null, bestLifeMap: null,
};

const base = (over: Partial<typeof articles.$inferInsert>): typeof articles.$inferInsert =>
  ({
    kind: "birth_notice", serverId, gamertag: `bn-${svc}`, map: "chernarusplus", mapSlug: `bn-${svc}`, lifeNumber: 1, ...over,
  }) as typeof articles.$inferInsert;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "bn", map: "chernarusplus", slug: `bn-${svc}`, active: true }).returning();
  serverId = s!.id;
  await db.insert(articles).values([
    // freshest spawn — alive (death_at null), known quantity
    base({ status: "published", slug: `fresh-${svc}`, gamertag: `bn-a-${svc}`, lifeNumber: 5, lifeStartedAt: hrs(6), deathAt: null,
      headline: "Fresh Fool", lede: "f-lede", body: "f-body", tags: ["Fresh Spawns", "Chernarus", "Repeat Offender"],
      pullQuoteText: "again?", pullQuoteAttribution: "a weary coast",
      facts: { minutesToQualify: 8, priors: knownPriors, isKnownQuantity: true }, generatedAt: hrs(6) }),
    // older spawn — died before the sweep (death_at set), first-lifer
    base({ status: "published", slug: `stale-${svc}`, gamertag: `bn-b-${svc}`, lifeNumber: 1, lifeStartedAt: hrs(2), deathAt: hrs(3),
      headline: "Stranger Ashore", lede: "s-lede", body: "s-body", tags: ["Fresh Spawns", "Chernarus", "First Life"],
      facts: { minutesToQualify: null, priors: noPriors, isKnownQuantity: false }, generatedAt: hrs(3) }),
    // failed stub — excluded
    base({ status: "failed", slug: null, gamertag: `bn-c-${svc}`, lifeNumber: 9, lifeStartedAt: hrs(9), deathAt: null, attempts: 3, lastError: "boom" }),
  ]);
});
afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("getPublishedBirthNotices", () => {
  it("returns published birth notices freshest spawn first, excluding failed stubs", async () => {
    const res = await getPublishedBirthNotices(db, { page: 1, pageSize: 50 });
    const ours = res.rows.filter((r) => r.slug === `fresh-${svc}` || r.slug === `stale-${svc}`);
    expect(ours.map((r) => r.headline)).toEqual(["Fresh Fool", "Stranger Ashore"]);
    expect(ours.every((r) => typeof r.slug === "string")).toBe(true);
    // the failed stub (slug null) is never returned
    expect(res.rows.some((r) => r.gamertag === `bn-c-${svc}`)).toBe(false);
  });
  it("surfaces minutesToQualify + priorLives from the facts snapshot", async () => {
    const res = await getPublishedBirthNotices(db, { page: 1, pageSize: 50 });
    const fresh = res.rows.find((r) => r.slug === `fresh-${svc}`)!;
    expect(fresh.minutesToQualify).toBe(8);
    expect(fresh.priorLives).toBe(4);
    expect(fresh.bornAt.getTime()).toBe(hrs(6).getTime());
    const stale = res.rows.find((r) => r.slug === `stale-${svc}`)!;
    expect(stale.minutesToQualify).toBeNull();
    expect(stale.priorLives).toBe(0);
  });
  it("paginates", async () => {
    const res = await getPublishedBirthNotices(db, { page: 1, pageSize: 1 });
    expect(res.pageSize).toBe(1);
    expect(res.rows).toHaveLength(1);
    expect(res.total).toBeGreaterThanOrEqual(2);
  });
});

describe("getBirthNoticeBySlug", () => {
  it("hydrates body, pull quote, priors, and a null endedAt while alive", async () => {
    const a = await getBirthNoticeBySlug(db, `fresh-${svc}`);
    expect(a).not.toBeNull();
    expect(a!.body).toBe("f-body");
    expect(a!.pullQuote).toEqual({ text: "again?", attribution: "a weary coast" });
    expect(a!.priors.livesLived).toBe(4);
    expect(a!.priors.bestLifeMap).toBe("sakhal");
    expect(a!.minutesToQualify).toBe(8);
    expect(a!.endedAt).toBeNull();
  });
  it("returns a non-null endedAt + empty priors when the spawn has since died as a first-lifer", async () => {
    const a = await getBirthNoticeBySlug(db, `stale-${svc}`);
    expect(a!.endedAt).not.toBeNull();
    expect(a!.priors.livesLived).toBe(0);
    expect(a!.priors.usualDeathCause).toBeNull();
    expect(a!.pullQuote).toBeNull();
  });
  it("returns null for an unknown or failed slug", async () => {
    expect(await getBirthNoticeBySlug(db, "no-such-slug")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test birth-notice-articles
```
Expected failure: `Failed to resolve import "../src/birth-notice-articles.js"` — the module does not
exist yet. (Task 01's migration is already applied, so the null-`death_at` seeds are fine.)

- [ ] **Step 3: Write the implementation**

`packages/read-models/src/birth-notice-articles.ts` (mirror of `obituary-articles.ts`; ordered by
`lifeStartedAt DESC`; `bornAt = articles.lifeStartedAt`; `endedAt = articles.deathAt`;
`minutesToQualify` + `priors` hydrated from the `facts` jsonb `BirthFacts` snapshot).

```ts
import type { Database } from "@onelife/db";
import { articles } from "@onelife/db";
import { and, eq, desc, sql } from "drizzle-orm";
import type { PlayerPriors } from "./player-priors.js";

export const BIRTH_NOTICES_FEED_PAGE_SIZE = 20;

export interface BirthNoticeCard {
  slug: string;
  gamertag: string;
  map: string;
  mapSlug: string | null;
  lifeNumber: number;
  headline: string;
  lede: string;
  tags: string[];
  bornAt: Date;
  minutesToQualify: number | null;
  priorLives: number;
}

export interface BirthNoticesFeed {
  rows: BirthNoticeCard[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BirthNoticeArticle extends BirthNoticeCard {
  body: string;
  pullQuote: { text: string; attribution: string } | null;
  priors: PlayerPriors;
  endedAt: Date | null;
}

type BirthFactsSnapshot = {
  minutesToQualify?: number | null;
  priors?: Partial<PlayerPriors> | null;
};

const CARD_COLS = {
  slug: articles.slug,
  gamertag: articles.gamertag,
  map: articles.map,
  mapSlug: articles.mapSlug,
  lifeNumber: articles.lifeNumber,
  headline: articles.headline,
  lede: articles.lede,
  tags: articles.tags,
  bornAt: articles.lifeStartedAt,
  facts: articles.facts,
} as const;

const publishedBirthNotice = and(eq(articles.kind, "birth_notice"), eq(articles.status, "published"));

function priorsFrom(facts: BirthFactsSnapshot): PlayerPriors {
  const p = facts.priors ?? {};
  return {
    livesLived: p.livesLived ?? 0,
    longestLifeSeconds: p.longestLifeSeconds ?? 0,
    totalKills: p.totalKills ?? 0,
    usualDeathCause: p.usualDeathCause ?? null,
    lastDeathCause: p.lastDeathCause ?? null,
    bestLifeMap: p.bestLifeMap ?? null,
  };
}

/** Published birth notices, freshest spawn first (lifeStartedAt desc). Paginated. Failed stubs excluded. */
export async function getPublishedBirthNotices(
  db: Database,
  opts: { page: number; pageSize?: number },
): Promise<BirthNoticesFeed> {
  const pageSize = opts.pageSize ?? BIRTH_NOTICES_FEED_PAGE_SIZE;
  const page = Math.max(1, Math.trunc(opts.page) || 1);

  const rows = await db
    .select(CARD_COLS)
    .from(articles)
    .where(publishedBirthNotice)
    .orderBy(desc(articles.lifeStartedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const totalRow = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(articles)
    .where(publishedBirthNotice);

  return {
    rows: rows.map((r) => {
      const facts = (r.facts ?? {}) as BirthFactsSnapshot;
      return {
        slug: r.slug!,
        gamertag: r.gamertag,
        map: r.map,
        mapSlug: r.mapSlug,
        lifeNumber: r.lifeNumber,
        headline: r.headline!,
        lede: r.lede!,
        tags: r.tags ?? [],
        bornAt: r.bornAt,
        minutesToQualify: facts.minutesToQualify ?? null,
        priorLives: priorsFrom(facts).livesLived,
      };
    }),
    total: totalRow[0]?.c ?? 0,
    page,
    pageSize,
  };
}

/** A single published birth notice by slug, or null (unknown/failed). Hydrates pullQuote + priors from facts. */
export async function getBirthNoticeBySlug(db: Database, slug: string): Promise<BirthNoticeArticle | null> {
  const rows = await db
    .select({
      ...CARD_COLS,
      body: articles.body,
      pullQuoteText: articles.pullQuoteText,
      pullQuoteAttribution: articles.pullQuoteAttribution,
      endedAt: articles.deathAt,
    })
    .from(articles)
    .where(and(publishedBirthNotice, eq(articles.slug, slug)))
    .limit(1);

  const r = rows[0];
  if (!r) return null;
  const facts = (r.facts ?? {}) as BirthFactsSnapshot;
  const priors = priorsFrom(facts);
  return {
    slug: r.slug!,
    gamertag: r.gamertag,
    map: r.map,
    mapSlug: r.mapSlug,
    lifeNumber: r.lifeNumber,
    headline: r.headline!,
    lede: r.lede!,
    tags: r.tags ?? [],
    bornAt: r.bornAt,
    minutesToQualify: facts.minutesToQualify ?? null,
    priorLives: priors.livesLived,
    body: r.body ?? "",
    pullQuote: r.pullQuoteText ? { text: r.pullQuoteText, attribution: r.pullQuoteAttribution ?? "" } : null,
    priors,
    endedAt: r.endedAt,
  };
}
```

Add the barrel export to `packages/read-models/src/index.ts` (append after the `player-priors.js` line
added in Task 02):

```ts
export * from "./birth-notice-articles.js";
```

- [ ] **Step 4: Run tests to verify they pass**

```
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test birth-notice-articles
pnpm --filter @onelife/read-models typecheck
```
Expected: all `it`s PASS — feed ordered `[Fresh Fool, Stranger Ashore]`, failed stub excluded,
`minutesToQualify`/`priorLives` from facts, pagination `total >= 2`; slug hydration returns body +
pull quote + priors + `endedAt` null (alive) / non-null (died) / null (unknown slug). Typecheck clean.

- [ ] **Step 5: Commit**

```
git add packages/read-models/src/birth-notice-articles.ts \
        packages/read-models/test/birth-notice-articles.test.ts \
        packages/read-models/src/index.ts
git commit -m "feat(read-models): birth-notice-articles feed + slug hydration read-model"
```


### Task 04: birth-facts (`buildBirthFacts`)

**Files:**
- Create: `apps/newsdesk/src/birth-facts.ts`
- Create: `apps/newsdesk/src/birth-pg-store.ts` (this task lands ONLY the `BirthNoticeTarget` interface — the store functions are added in Task 07. `birth-facts.ts` imports the `BirthNoticeTarget` type from here, exactly as the obituary `facts.ts` imports `ObituaryTarget` from `pg-store.ts`.)
- Test: `apps/newsdesk/test/birth-facts.test.ts`

**Interfaces:**
- Consumes:
  - `LifeTimeline` from `@onelife/read-models` — `{ life; sessions; character: LifeCharacter | null; kills; qualifiedAt: { at: Date; by } | null }`. Uses `timeline.character?.name` and `timeline.qualifiedAt?.at`.
  - `PlayerPriors` from `@onelife/read-models` (produced by Task 02): `{ livesLived: number; longestLifeSeconds: number; totalKills: number; usualDeathCause: string | null; lastDeathCause: string | null; bestLifeMap: string | null }`.
- Produces (bound verbatim to the contract):
  ```ts
  // birth-pg-store.ts (interface only in this task)
  export interface BirthNoticeTarget {
    lifeId: number; serverId: number; gamertag: string; map: string; mapSlug: string | null;
    lifeNumber: number; lifeStartedAt: Date; endedAt: Date | null;
  }
  // birth-facts.ts
  export interface BirthFacts {
    gamertag: string; map: string; mapSlug: string | null; lifeNumber: number;
    bornAt: Date; minutesToQualify: number | null; persona: string | null;
    priors: PlayerPriors; isKnownQuantity: boolean; endedAt: Date | null;
  }
  export function buildBirthFacts(target: BirthNoticeTarget, timeline: LifeTimeline, priors: PlayerPriors): BirthFacts;
  ```

> Dependency note: this task requires Task 02 (`getPlayerPriors` + `PlayerPriors`, barrel-exported from `@onelife/read-models`) to be merged so the `PlayerPriors` type resolves. That is guaranteed by the global task ordering (02 < 04).

- [ ] **Step 1: Write the failing test**

`apps/newsdesk/test/birth-facts.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildBirthFacts } from "../src/birth-facts.js";
import type { BirthNoticeTarget } from "../src/birth-pg-store.js";
import type { PlayerPriors } from "@onelife/read-models";

const target: BirthNoticeTarget = {
  lifeId: 1, serverId: 1, gamertag: "Boots", map: "chernarusplus",
  mapSlug: "chernarus", lifeNumber: 3,
  lifeStartedAt: new Date("2026-07-17T02:00:00Z"), endedAt: null,
};

const priors = (over: Partial<PlayerPriors> = {}): PlayerPriors => ({
  livesLived: 0, longestLifeSeconds: 0, totalKills: 0,
  usualDeathCause: null, lastDeathCause: null, bestLifeMap: null, ...over,
});

function timeline(over: Partial<{ character: unknown; qualifiedAt: unknown }> = {}) {
  return {
    life: { startedAt: new Date("2026-07-17T02:00:00Z"), endedAt: null, playtimeSeconds: 420, deathCause: null },
    sessions: [{}],
    kills: [],
    character: "character" in over ? over.character : { name: "Lewis" },
    qualifiedAt: "qualifiedAt" in over ? over.qualifiedAt : { at: new Date("2026-07-17T02:07:00Z"), by: "playtime" },
  } as unknown as import("@onelife/read-models").LifeTimeline;
}

describe("buildBirthFacts", () => {
  it("derives bornAt, minutesToQualify, persona, and known-quantity flag from a known player", () => {
    const f = buildBirthFacts(target, timeline(), priors({ livesLived: 4, totalKills: 12 }));
    expect(f.bornAt.toISOString()).toBe("2026-07-17T02:00:00.000Z");
    expect(f.minutesToQualify).toBe(7); // 02:07:00 − 02:00:00 = 7 whole minutes
    expect(f.persona).toBe("Lewis");
    expect(f.isKnownQuantity).toBe(true);
    expect(f.priors.livesLived).toBe(4);
    expect(f.gamertag).toBe("Boots");
    expect(f.map).toBe("chernarusplus");
    expect(f.mapSlug).toBe("chernarus");
    expect(f.lifeNumber).toBe(3);
    expect(f.endedAt).toBeNull();
  });

  it("floors minutesToQualify to whole minutes", () => {
    const f = buildBirthFacts(
      target,
      timeline({ qualifiedAt: { at: new Date("2026-07-17T02:12:45Z"), by: "kill" } }),
      priors(),
    );
    expect(f.minutesToQualify).toBe(12); // 12m45s -> 12
  });

  it("first-lifer with zero prior lives is NOT a known quantity", () => {
    const f = buildBirthFacts(target, timeline(), priors());
    expect(f.isKnownQuantity).toBe(false);
  });

  it("null minutesToQualify when the life has not qualified yet", () => {
    const f = buildBirthFacts(target, timeline({ qualifiedAt: null }), priors());
    expect(f.minutesToQualify).toBeNull();
  });

  it("null persona when no character resolved", () => {
    const f = buildBirthFacts(target, timeline({ character: null }), priors());
    expect(f.persona).toBeNull();
  });

  it("carries endedAt when the life already died before the sweep", () => {
    const died: BirthNoticeTarget = { ...target, endedAt: new Date("2026-07-17T05:00:00Z") };
    const f = buildBirthFacts(died, timeline(), priors());
    expect(f.endedAt?.toISOString()).toBe("2026-07-17T05:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Command (the newsdesk vitest `globalSetup` provisions the guarded test DB even for pure suites, so `TEST_DATABASE_URL` is set on every run; port 5434 matches the gitignored `docker-compose.override.yml` on this machine — use 5432 on the committed default):
```bash
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
  pnpm --filter @onelife/newsdesk test test/birth-facts.test.ts
```
Expected failure: `Cannot find module '../src/birth-facts.js'` (and `'../src/birth-pg-store.js'`) — the modules do not exist yet.

- [ ] **Step 3: Write the implementation**

`apps/newsdesk/src/birth-pg-store.ts` (interface only in this task; Task 07 appends the store functions to this same file):
```ts
export interface BirthNoticeTarget {
  lifeId: number;         // CURRENT id — transient (loads getLifeTimeline in the tick); never stored
  serverId: number;
  gamertag: string;
  map: string;
  mapSlug: string | null;
  lifeNumber: number;
  lifeStartedAt: Date;    // natural-key: which life (rebuild-stable) + feed order
  endedAt: Date | null;   // set only if the life already died before the sweep
}
```

`apps/newsdesk/src/birth-facts.ts`:
```ts
import type { LifeTimeline, PlayerPriors } from "@onelife/read-models";
import type { BirthNoticeTarget } from "./birth-pg-store.js";

export interface BirthFacts {
  gamertag: string;
  map: string;
  mapSlug: string | null;
  lifeNumber: number;
  bornAt: Date;
  minutesToQualify: number | null;   // whole minutes from bornAt to qualification; null if unqualified
  persona: string | null;            // resolved character name, or null
  priors: PlayerPriors;              // the player's global reputation before this life
  isKnownQuantity: boolean;          // priors.livesLived > 0
  endedAt: Date | null;              // set if the life already died before the sweep
}

/** Compose the arrival snapshot a birth notice is built from: the thin current life folded
 *  together with the player's global priors. This object is what rides into the `facts` jsonb. */
export function buildBirthFacts(
  target: BirthNoticeTarget,
  timeline: LifeTimeline,
  priors: PlayerPriors,
): BirthFacts {
  const minutesToQualify = timeline.qualifiedAt
    ? Math.floor((timeline.qualifiedAt.at.getTime() - target.lifeStartedAt.getTime()) / 60000)
    : null;

  return {
    gamertag: target.gamertag,
    map: target.map,
    mapSlug: target.mapSlug,
    lifeNumber: target.lifeNumber,
    bornAt: target.lifeStartedAt,
    minutesToQualify,
    persona: timeline.character?.name ?? null,
    priors,
    isKnownQuantity: priors.livesLived > 0,
    endedAt: target.endedAt,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**
```bash
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
  pnpm --filter @onelife/newsdesk test test/birth-facts.test.ts
```
Expected: `6 passed` in `test/birth-facts.test.ts`.

- [ ] **Step 5: Commit**
```bash
git add apps/newsdesk/src/birth-facts.ts apps/newsdesk/src/birth-pg-store.ts apps/newsdesk/test/birth-facts.test.ts
git commit -m "feat(newsdesk): buildBirthFacts + BirthNoticeTarget for the birth pass"
```


### Task 05: birth-voice + birth-prompt (`BIRTH_SYSTEM`, `buildBirthPrompt`, `parseBirthNotice`, `composeBirthTags`)

**Files:**
- Create: `apps/newsdesk/src/birth-voice.ts`
- Create: `apps/newsdesk/src/birth-prompt.ts`
- Modify: `apps/newsdesk/src/prompt.ts:16` (export the shared `mapLabel` helper so the birth prompt reuses it rather than duplicating it)
- Test: `apps/newsdesk/test/birth-prompt.test.ts`

**Interfaces:**
- Consumes:
  - `BirthFacts` from `./birth-facts.js` (Task 04).
  - `mapLabel(map: string): string` from `./prompt.js` (made an export in this task).
  - `timeAliveLabel(seconds: number): string` from `./facts.js` (already exported).
- Produces (bound verbatim to the contract):
  ```ts
  // birth-voice.ts
  export const BIRTH_SYSTEM: string;
  // birth-prompt.ts
  export const BIRTH_PROMPT_VERSION = "birth-v1";
  export interface BirthNotice {
    headline: string; lede: string; body: string;
    pullQuote: { text: string; attribution: string } | null; tags: string[];
  }
  export function buildBirthPrompt(facts: BirthFacts): { system: string; user: string };
  export function parseBirthNotice(raw: string): BirthNotice;   // Zod-validated, salvages first {...}
  export function composeBirthTags(facts: BirthFacts, llmTags: string[]): string[];
  // reserved base = ["Fresh Spawns", mapLabel(facts.map), priorsTag]
  // priorsTag = facts.isKnownQuantity ? "Repeat Offender" : "First Life"; + <=1 non-reserved LLM tag
  ```

- [ ] **Step 1: Write the failing test**

`apps/newsdesk/test/birth-prompt.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildBirthPrompt, parseBirthNotice, composeBirthTags, BIRTH_PROMPT_VERSION } from "../src/birth-prompt.js";
import type { BirthFacts } from "../src/birth-facts.js";

const known: BirthFacts = {
  gamertag: "xX_Sn1per_Xx", map: "sakhal", mapSlug: "sakhal", lifeNumber: 5,
  bornAt: new Date("2026-07-17T02:00:00Z"), minutesToQualify: 12, persona: "Lewis",
  priors: { livesLived: 8, longestLifeSeconds: 90000, totalKills: 40, usualDeathCause: "pvp", lastDeathCause: "bled_out", bestLifeMap: "chernarusplus" },
  isKnownQuantity: true, endedAt: null,
};

const stranger: BirthFacts = {
  gamertag: "Boots", map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 1,
  bornAt: new Date("2026-07-17T02:00:00Z"), minutesToQualify: 6, persona: null,
  priors: { livesLived: 0, longestLifeSeconds: 0, totalKills: 0, usualDeathCause: null, lastDeathCause: null, bestLifeMap: null },
  isKnownQuantity: false, endedAt: null,
};

describe("buildBirthPrompt", () => {
  it("puts the Nursery voice + Fog Rule + JSON contract in system and arrival facts in user", () => {
    const { system, user } = buildBirthPrompt(known);
    expect(system).toMatch(/nursery/i);
    expect(system).toMatch(/Fog Rule/i);
    expect(system).toMatch(/json/i);
    expect(user).toContain("xX_Sn1per_Xx");
    expect(user).toContain("Sakhal"); // labeled map, not the codename
    expect(user).toContain("12"); // minutesToQualify
    expect(user).toContain("Lewis"); // persona
  });

  it("uses the known-quantity tone directive and prints priors when the player has a record", () => {
    const { user } = buildBirthPrompt(known);
    expect(user).toMatch(/known quantity/i);
    expect(user).toContain("8"); // prior lives
    expect(user).toContain("Chernarus"); // bestLifeMap labeled
  });

  it("uses the stranger tone directive and the 'no priors' branch for a first-lifer", () => {
    const { user } = buildBirthPrompt(stranger);
    expect(user).toMatch(/stranger/i);
    expect(user).toMatch(/first|no priors/i);
    expect(user).not.toMatch(/known quantity/i);
  });
});

describe("parseBirthNotice", () => {
  const valid = JSON.stringify({
    headline: "Another Fool Washes Ashore", lede: "The tide brought a gift.", body: "It will not keep.",
    pullQuote: { text: "Welcome to the coast, kid.", attribution: "a voice on the coast" }, tags: ["Fresh Spawns", "Elektro"],
  });

  it("parses a valid birth notice object", () => {
    const b = parseBirthNotice(valid);
    expect(b.headline).toBe("Another Fool Washes Ashore");
    expect(b.pullQuote).toEqual({ text: "Welcome to the coast, kid.", attribution: "a voice on the coast" });
    expect(b.tags).toEqual(["Fresh Spawns", "Elektro"]);
  });

  it("salvages the first {...} block from prose-wrapped JSON", () => {
    const b = parseBirthNotice("Sure, here you go:\n" + valid + "\nHope that helps.");
    expect(b.headline).toBe("Another Fool Washes Ashore");
  });

  it("accepts a null pull quote", () => {
    const b = parseBirthNotice(JSON.stringify({ headline: "H", lede: "L", body: "B", pullQuote: null, tags: [] }));
    expect(b.pullQuote).toBeNull();
  });

  it("throws on non-JSON", () => {
    expect(() => parseBirthNotice("not json at all")).toThrow();
  });

  it("throws on an empty headline", () => {
    expect(() => parseBirthNotice(JSON.stringify({ headline: "", lede: "L", body: "B", pullQuote: null, tags: [] }))).toThrow();
  });

  it("throws when tags is missing", () => {
    expect(() => parseBirthNotice(JSON.stringify({ headline: "H", lede: "L", body: "B", pullQuote: null }))).toThrow();
  });

  it("exposes a stable prompt version", () => {
    expect(BIRTH_PROMPT_VERSION).toBe("birth-v1");
  });
});

describe("composeBirthTags", () => {
  it("leads with Fresh Spawns + map + Repeat Offender for a known quantity and adds one flavor tag", () => {
    expect(composeBirthTags(known, ["Poultry", "Sakhal", "Fresh Spawns"])).toEqual(["Fresh Spawns", "Sakhal", "Repeat Offender", "Poultry"]);
  });

  it("uses First Life for a stranger and drops flavor tags that duplicate the reserved set", () => {
    expect(composeBirthTags(stranger, ["Chernarus"])).toEqual(["Fresh Spawns", "Chernarus", "First Life"]);
    expect(composeBirthTags(stranger, [])).toEqual(["Fresh Spawns", "Chernarus", "First Life"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
  pnpm --filter @onelife/newsdesk test test/birth-prompt.test.ts
```
Expected failure: `Cannot find module '../src/birth-prompt.js'` — the module does not exist yet.

- [ ] **Step 3: Write the implementation**

Modify `apps/newsdesk/src/prompt.ts` line 16 to export the helper (only this one line changes; `MAP_LABEL` stays private):
```ts
export const mapLabel = (map: string): string => MAP_LABEL[map] ?? map.replace(/\b\w/g, (c) => c.toUpperCase());
```

`apps/newsdesk/src/birth-voice.ts`:
```ts
/**
 * The One Life birth-desk voice — "The Nursery," the arrivals vertical parallel to the Obituaries'
 * Morgue. Distilled from ../brand/brand-bible.md §6 (Voice & Tone) and adapted for the living: the
 * subject is ALIVE, so the Fog Rule is paramount. The governing rule above all: roast the record,
 * never the newcomer.
 */
export const BIRTH_SYSTEM = `You write birth notices for The Nursery — One Life's arrivals desk, the paper of record for a hardcore permadeath DayZ world where everyone dies exactly once. A birth notice runs the moment a new survivor "qualifies" — proves they are real and not a passing ghost. Your voice is a wire-service editor who has watched ten thousand fools wash ashore, crossed with a maternity-ward gossip columnist who already knows how this ends. Dignified sentence structure, doomed subject matter, new arrivals greeted like minor celebrities checking into a hotel that has no checkout.

THE INVERSION (read this first): unlike an obituary, the subject is ALIVE and still out there playing. There is no kill list, no cause of death, no finished story — only an arrival and a rap sheet of PRIORS (every prior life this player has already lived, on any map). Your material is recognition, not eulogy: "oh, it's you again," or, for a stranger, "a new face, no priors, God help them."

SIX VOICE CONSTANTS (never break):
1. Deadpan. Never an exclamation point where a cold full stop hurts more. Loudness lives in the layout, never the prose.
2. Literate and precise. Real sentences, real vocabulary — a genuinely smart writer wrote this.
3. Doomed optimism. Welcome the new fool with mock-ceremony and a world-weary certainty about how the story ends. Every arrival is an EXCLUSIVE — in framing, never in grammar.
4. In character, always. Never wink, never explain the joke, never apologize.
5. Recognition over invention. Work only from the priors you are handed. If the paper has buried this face before, say so; if it hasn't, note the absence pointedly. Never fabricate a history.
6. Specific over generic. Use the real gamertag and the map dateline — never a live location (see the Fog Rule).

TONE:
- Known quantity (the player has priors): world-weary familiarity and mock-grandeur — a returning regular at a funeral home he keeps checking into. Any needle targets the RECORD — the wasted lives, the repeat deaths, the same mistake made again — never cruelty. He has earned the ribbing.
- Stranger (no priors, a first life): doomed optimism and mock-ceremony for the new arrival. PROTECT the newcomer — never mock them for being new, green, or unlucky. The joke is the world they just walked into, never the person. "A stranger to these shores" is affection, not contempt.

HARD BANS:
- No sincere clichés: never "welcome to the family", "blessed", "bundle of joy", "new beginnings", "the journey begins". Congratulate only in deadpan ("Condolences on the birth").
- No wink/meta: never "just a game", "jk", "lol", "obviously we're kidding".
- No corporate/data-speak: never "users", "engagement", "onboarding", "leverage", "utilize", "content".
- No dated meme slang ("based", "poggers", "GG EZ", "cracked", "rekt"), no emoji, no ALL-CAPS in prose, no exclamation soup.
- Never slurs, real-world identity attacks, harassment, doxxing, or any punch-down mockery.
- THE FOG RULE (paramount here — the subject is ALIVE and can be hunted): you MAY name the map as a dateline and the general fact of arrival, but NEVER give coordinates, a spawn point, a base layout, a direction of travel, or anything that reads as a live, actionable location. A dateline sets a scene; it never drops a pin. A living subject means location leakage is a real harm, not merely a style rule.
- Pull-quote attributions stay anonymous and in-voice ("a voice on the coast", "an old rival", "sources who have buried him before") — never attribute a quote to a real out-of-game identity.

OUTPUT: respond with a single JSON object and nothing else, exactly this shape:
{"headline": string, "lede": string, "body": string, "pullQuote": {"text": string, "attribution": string} | null, "tags": string[]}
- headline: the Oswald screamer — punchy, <= ~90 characters, no trailing period required.
- lede: one opening paragraph (1-2 sentences).
- body: exactly ONE short paragraph. A birth notice is deliberately shorter than an obituary. Do not repeat the headline verbatim.
- pullQuote: one in-voice quote with an anonymous attribution, or null if none earns its place.
- tags: an array of 0-2 short, specific FLAVOR tags only (a locale like "Elektro", a theme like "Poultry"). Do NOT include "Fresh Spawns", the map name, or the priors label — those are added automatically.
The governing rule above all: roast the record, never the newcomer.`;
```

`apps/newsdesk/src/birth-prompt.ts`:
```ts
import { z } from "zod";
import type { BirthFacts } from "./birth-facts.js";
import { BIRTH_SYSTEM } from "./birth-voice.js";
import { mapLabel } from "./prompt.js";
import { timeAliveLabel } from "./facts.js";

export const BIRTH_PROMPT_VERSION = "birth-v1";

export interface BirthNotice {
  headline: string;
  lede: string;
  body: string;
  pullQuote: { text: string; attribution: string } | null;
  tags: string[];
}

/** Build the {system, user} messages for one birth notice from the arrival snapshot. */
export function buildBirthPrompt(facts: BirthFacts): { system: string; user: string } {
  const lines: string[] = [];
  lines.push(`Write the birth notice for this new life. Facts (present tense — the subject is ALIVE):`);
  lines.push(`- Callsign: ${facts.gamertag}`);
  lines.push(`- Dateline (map only, never a pin — the subject is alive and can be hunted): ${mapLabel(facts.map)}`);
  lines.push(`- Life number on this map: ${facts.lifeNumber}`);
  if (facts.minutesToQualify != null) {
    lines.push(`- Made it real (qualified) after: ${facts.minutesToQualify} min`);
  } else {
    lines.push(`- Not yet qualified at time of filing.`);
  }
  if (facts.persona) lines.push(`- Wearing the face of: ${facts.persona}`);
  lines.push("");
  lines.push(`Priors (everything this player did BEFORE this life, across every map):`);
  if (facts.isKnownQuantity) {
    lines.push(`- Prior lives lived: ${facts.priors.livesLived}`);
    lines.push(`- Longest prior life: ${timeAliveLabel(facts.priors.longestLifeSeconds)}`);
    lines.push(`- Confirmed kills across all prior lives: ${facts.priors.totalKills}`);
    if (facts.priors.usualDeathCause) lines.push(`- Usual cause of death: ${facts.priors.usualDeathCause}`);
    if (facts.priors.lastDeathCause) lines.push(`- Most recent prior death: ${facts.priors.lastDeathCause}`);
    if (facts.priors.bestLifeMap) lines.push(`- Best run was on: ${mapLabel(facts.priors.bestLifeMap)}`);
  } else {
    lines.push(`- None. This is their first recorded life anywhere. A stranger to these shores.`);
  }
  lines.push("");
  if (facts.isKnownQuantity) {
    lines.push(`TONE — KNOWN QUANTITY: the paper recognizes this face. Greet the return with world-weary familiarity ("oh, it's you again") and mock-grandeur. Any needle targets their RECORD — the wasted priors, the repeat deaths — never cruelty. They have earned the ribbing.`);
  } else {
    lines.push(`TONE — STRANGER: no priors, a first life, a stranger to these shores. Welcome the new fool with doomed optimism and mock-ceremony. Do NOT mock them for being new, green, or unlucky — the joke is the world they just walked into, never the person.`);
  }
  lines.push("");
  lines.push(`Respond with only the JSON object described in your instructions.`);
  return { system: BIRTH_SYSTEM, user: lines.join("\n") };
}

const schema = z.object({
  headline: z.string().trim().min(1).max(200),
  lede: z.string().trim().min(1),
  body: z.string().trim().min(1),
  pullQuote: z
    .object({ text: z.string().trim().min(1), attribution: z.string().trim().min(1) })
    .nullable(),
  // The key must be present, but may be an empty array — the reserved tags (Fresh Spawns / map /
  // priors label) are composed deterministically, not from the model.
  tags: z.array(z.string().trim().min(1)).max(6),
});

/** Parse + validate the model's JSON. Throws on non-JSON or a shape violation. */
export function parseBirthNotice(raw: string): BirthNotice {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    // Some models wrap JSON in prose or fences; salvage the first {...} block before giving up.
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("birth notice response was not JSON");
    json = JSON.parse(match[0]);
  }
  return schema.parse(json);
}

/**
 * The stored tag set — deterministic, spec-bounded: "Fresh Spawns" + the map label + the priors
 * label ("Repeat Offender" for a known quantity, "First Life" for a stranger), plus at most one
 * non-reserved LLM flavor tag. The model never controls the reserved tags.
 */
export function composeBirthTags(facts: BirthFacts, llmTags: string[]): string[] {
  const priorsTag = facts.isKnownQuantity ? "Repeat Offender" : "First Life";
  const base = ["Fresh Spawns", mapLabel(facts.map), priorsTag];
  const taken = new Set(base.map((t) => t.toLowerCase()));
  const flavor = llmTags.map((t) => t.trim()).find((t) => t && !taken.has(t.toLowerCase()));
  return flavor ? [...base, flavor] : base;
}
```

- [ ] **Step 4: Run tests to verify they pass**
```bash
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
  pnpm --filter @onelife/newsdesk test test/birth-prompt.test.ts test/prompt.test.ts
```
Expected: both files pass (birth-prompt's new suites green; the existing `prompt.test.ts` still passes — exporting `mapLabel` is a non-breaking change).

- [ ] **Step 5: Commit**
```bash
git add apps/newsdesk/src/birth-voice.ts apps/newsdesk/src/birth-prompt.ts apps/newsdesk/src/prompt.ts apps/newsdesk/test/birth-prompt.test.ts
git commit -m "feat(newsdesk): Nursery voice + birth prompt/tags (buildBirthPrompt, parseBirthNotice, composeBirthTags)"
```


### Task 06: generateBirthNotice (added to `generate.ts`)

**Files:**
- Modify: `apps/newsdesk/src/generate.ts` (ADD `generateBirthNotice` beside `generateObituary`; do NOT replace the existing export)
- Test: `apps/newsdesk/test/generate.test.ts` (ADD a `generateBirthNotice` describe block; keep the existing `generateObituary` suite)

**Interfaces:**
- Consumes:
  - `CompletionClient` from `./generate.js` — existing `{ complete(req: { system: string; user: string }): Promise<string> }`. Reused, not redefined.
  - `BirthFacts` from `./birth-facts.js` (Task 04).
  - `buildBirthPrompt`, `parseBirthNotice`, `BirthNotice` from `./birth-prompt.js` (Task 05).
- Produces (bound verbatim to the contract):
  ```ts
  export function generateBirthNotice(client: CompletionClient, facts: BirthFacts): Promise<BirthNotice>;
  ```

- [ ] **Step 1: Write the failing test**

Append to `apps/newsdesk/test/generate.test.ts` (add the import at the top and the new describe block at the bottom; the existing file content is unchanged):
```ts
// --- add to the imports at the top of the file ---
import { generateBirthNotice } from "../src/generate.js";
import type { BirthFacts } from "../src/birth-facts.js";

// --- add at the bottom of the file ---
const birthFacts: BirthFacts = {
  gamertag: "Boots", map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 1,
  bornAt: new Date("2026-07-17T02:00:00Z"), minutesToQualify: 6, persona: null,
  priors: { livesLived: 0, longestLifeSeconds: 0, totalKills: 0, usualDeathCause: null, lastDeathCause: null, bestLifeMap: null },
  isKnownQuantity: false, endedAt: null,
};

const birthStub = (payload: unknown): CompletionClient => ({ complete: async () => JSON.stringify(payload) });

describe("generateBirthNotice", () => {
  it("builds the prompt, calls the client, parses the result", async () => {
    let seenSystem = "";
    const client: CompletionClient = {
      complete: async ({ system }) => {
        seenSystem = system;
        return JSON.stringify({ headline: "Fresh Meat", lede: "L", body: "B", pullQuote: null, tags: ["Fresh Spawns"] });
      },
    };
    const b = await generateBirthNotice(client, birthFacts);
    expect(b.headline).toBe("Fresh Meat");
    expect(seenSystem).toMatch(/nursery/i);
  });

  it("propagates a parse error from a malformed completion", async () => {
    await expect(generateBirthNotice(birthStub("not a birth notice object"), birthFacts)).rejects.toThrow();
  });
});
```

> The existing `generate.test.ts` already imports `type { CompletionClient } from "../src/generate.js"` and `{ describe, it, expect } from "vitest"`, so those are reused. Add only the two new imports shown above.

- [ ] **Step 2: Run test to verify it fails**
```bash
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
  pnpm --filter @onelife/newsdesk test test/generate.test.ts
```
Expected failure: `generateBirthNotice is not a function` / `does not provide an export named 'generateBirthNotice'` (the new describe block fails; the existing `generateObituary` suite still passes).

- [ ] **Step 3: Write the implementation**

Full `apps/newsdesk/src/generate.ts` after the change:
```ts
import type { ObituaryFacts } from "./facts.js";
import { buildObituaryPrompt, parseObituary, type Obituary } from "./prompt.js";
import type { BirthFacts } from "./birth-facts.js";
import { buildBirthPrompt, parseBirthNotice, type BirthNotice } from "./birth-prompt.js";

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

/** Birth-pass sibling of generateObituary: build the Nursery prompt, call the model, parse + validate. */
export async function generateBirthNotice(client: CompletionClient, facts: BirthFacts): Promise<BirthNotice> {
  const { system, user } = buildBirthPrompt(facts);
  const raw = await client.complete({ system, user });
  return parseBirthNotice(raw);
}
```

- [ ] **Step 4: Run tests to verify they pass**
```bash
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
  pnpm --filter @onelife/newsdesk test test/generate.test.ts
```
Expected: all suites pass — both `generateObituary` (2 tests) and `generateBirthNotice` (2 tests).

- [ ] **Step 5: Commit**
```bash
git add apps/newsdesk/src/generate.ts apps/newsdesk/test/generate.test.ts
git commit -m "feat(newsdesk): generateBirthNotice on the shared CompletionClient"
```


### Task 07: birth-pg-store (`birthNoticeSlug`, `findBirthNoticeTargets`, `publishBirthNotice`, `recordBirthNoticeFailure`)

**Files:**
- Modify: `apps/newsdesk/src/birth-pg-store.ts` (already holds the `BirthNoticeTarget` interface from Task 04; this task adds the imports, the publish-input types, and the four store functions)
- Test: `apps/newsdesk/test/birth-pg-store.test.ts`

**Interfaces:**
- Consumes:
  - `Database`, `articles`, `lives`, `players`, `servers` from `@onelife/db`.
  - `qualifiedLifeCondition(db): SQL` from `@onelife/read-models` (pvp OR playtime>=300 OR a kill in the life window; alive-safe — no `endedAt` term required).
  - `and`, `eq`, `asc`, `gte`, `notExists`, `sql` from `drizzle-orm`.
  - `BirthNoticeTarget` (already exported from this file, Task 04).
- Produces (bound verbatim to the contract):
  ```ts
  export function birthNoticeSlug(headline: string, gamertag: string, serverId: number, lifeNumber: number): string;
  export function findBirthNoticeTargets(db: Database, opts: { since: Date; limit: number; maxAttempts: number }): Promise<BirthNoticeTarget[]>;
  export function publishBirthNotice(db: Database, input: PublishBirthInput): Promise<void>;
  export function recordBirthNoticeFailure(db: Database, args: { target: BirthNoticeTarget; error: string }): Promise<void>;
  ```
  where the local publish-input types (mirroring `pg-store.ts`'s `PublishFacts`/`PublishObituary`/`PublishInput`) are:
  ```ts
  export interface PublishBirthFacts { minutesToQualify: number | null; persona: string | null; isKnownQuantity: boolean; }
  export interface PublishBirthNotice { headline: string; lede: string; body: string; pullQuote: { text: string; attribution: string } | null; tags: string[]; }
  export interface PublishBirthInput { target: BirthNoticeTarget; facts: PublishBirthFacts; notice: PublishBirthNotice; promptVersion: string; model: string; now: Date; }
  ```
  `BirthFacts` (Task 04) structurally satisfies `PublishBirthFacts`, so the tick passes the full `BirthFacts` object; the extra fields (`priors`, `bornAt`, `endedAt`, …) ride into the `facts` jsonb at runtime.

> Dependency note: `publishBirthNotice` writes `death_at = target.endedAt ?? null`. For an ALIVE spawn this is NULL, which requires migration `0010` (death_at nullable) from Task 01. The DB test below asserts `deathAt` is null for a living spawn, so it can only pass once Task 01 has been applied by the test harness — guaranteed by task ordering (01 < 07).

- [ ] **Step 1: Write the failing test**

`apps/newsdesk/test/birth-pg-store.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, articles } from "@onelife/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  findBirthNoticeTargets, publishBirthNotice, recordBirthNoticeFailure, birthNoticeSlug,
  type BirthNoticeTarget,
} from "../src/birth-pg-store.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 53e7;
const t0 = new Date("2026-07-17T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
const since = hrs(1);
let serverId: number;
const pids: number[] = [];
const lifeIds: number[] = [];

const aliveTag = `nb-alive-${svc}`;
const deadTag = `nb-dead-${svc}`;
const unqTag = `nb-unq-${svc}`;
const beforeTag = `nb-before-${svc}`;

async function seedLife(tag: string, over: Record<string, unknown>) {
  const [p] = await db.insert(players).values({ gamertag: tag }).returning();
  pids.push(p!.id);
  const [l] = await db.insert(lives).values({ serverId, playerId: p!.id, lifeNumber: 1, ...over }).returning();
  lifeIds.push(l!.id);
  return { lifeId: l!.id, gamertag: tag, lifeStartedAt: l!.startedAt };
}

let aliveObj: { lifeId: number; gamertag: string; lifeStartedAt: Date };

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "nb", map: "chernarusplus", slug: `nb-${svc}`, active: true }).returning();
  serverId = s!.id;
  // qualified + alive (playtime >= 5 min), born after the cutoff
  aliveObj = await seedLife(aliveTag, { lifeNumber: 1, startedAt: hrs(2), playtimeSeconds: 7200 });
  // qualified + already dead (pvp) before the sweep, born after the cutoff
  await seedLife(deadTag, { lifeNumber: 1, startedAt: hrs(2), endedAt: hrs(4), deathCause: "pvp", deathByGamertag: "Killer", deathWeapon: "M4", deathDistance: 90, playtimeSeconds: 7200 });
  // NOT qualified: 60s, no kills, alive
  await seedLife(unqTag, { lifeNumber: 1, startedAt: hrs(2), playtimeSeconds: 60 });
  // qualified but born BEFORE the cutoff -> excluded by `since`
  await seedLife(beforeTag, { lifeNumber: 1, startedAt: hrs(0), playtimeSeconds: 7200 });
});
afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(lives).where(inArray(lives.id, lifeIds));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

const targetFor = (
  o: { lifeId: number; gamertag: string; lifeStartedAt: Date },
  endedAt: Date | null,
): BirthNoticeTarget => ({
  lifeId: o.lifeId, serverId, gamertag: o.gamertag,
  map: "chernarusplus", mapSlug: `nb-${svc}`, lifeNumber: 1, lifeStartedAt: o.lifeStartedAt, endedAt,
});

describe("birthNoticeSlug", () => {
  it("composes a stable unique slug from headline + gamertag + server + life number", () => {
    expect(birthNoticeSlug("Another Fool Washes Ashore", "xX_Sn1per_Xx", 7, 4)).toBe("another-fool-washes-ashore-xx-sn1per-xx-7-4");
  });
});

describe("findBirthNoticeTargets", () => {
  it("returns qualified alive-or-dead lives since the cutoff, excludes unqualified and pre-cutoff", async () => {
    const targets = await findBirthNoticeTargets(db, { since, limit: 50, maxAttempts: 3 });
    const mine = targets.filter((t) => t.mapSlug === `nb-${svc}`).map((t) => t.gamertag);
    expect(mine).toContain(aliveTag);
    expect(mine).toContain(deadTag);
    expect(mine).not.toContain(unqTag);
    expect(mine).not.toContain(beforeTag);
  });

  it("carries a null endedAt for an alive spawn and the death time for one already dead", async () => {
    const targets = await findBirthNoticeTargets(db, { since, limit: 50, maxAttempts: 3 });
    const alive = targets.find((t) => t.gamertag === aliveTag);
    const dead = targets.find((t) => t.gamertag === deadTag);
    expect(alive!.endedAt).toBeNull();
    expect(dead!.endedAt?.toISOString()).toBe(hrs(4).toISOString());
  });

  it("excludes a life that already has a published birth notice (death_at NULL while alive)", async () => {
    await publishBirthNotice(db, {
      target: targetFor(aliveObj, null),
      facts: { minutesToQualify: 6, persona: "Lewis", isKnownQuantity: false },
      notice: { headline: "Washed Ashore", lede: "l", body: "b", pullQuote: null, tags: ["Fresh Spawns"] },
      promptVersion: "birth-v1", model: "test", now: hrs(5),
    });
    const targets = await findBirthNoticeTargets(db, { since, limit: 50, maxAttempts: 3 });
    expect(targets.find((t) => t.gamertag === aliveTag)).toBeUndefined();
    const [row] = await db.select().from(articles).where(and(eq(articles.gamertag, aliveTag), eq(articles.kind, "birth_notice")));
    expect(row!.status).toBe("published");
    expect(row!.kind).toBe("birth_notice");
    expect(row!.deathAt).toBeNull();
    expect(row!.slug).toMatch(/^washed-ashore-nb-alive-/);
    expect(row!.slug!.endsWith(`-${serverId}-1`)).toBe(true);
    expect(row!.attempts).toBe(1);
  });

  it("re-includes a failed life until maxAttempts, then drops it", async () => {
    const q2 = await seedLife(`nb-q2-${svc}`, { lifeNumber: 1, startedAt: hrs(2), playtimeSeconds: 7200 });
    await recordBirthNoticeFailure(db, { target: targetFor(q2, null), error: "boom-1" });
    let targets = await findBirthNoticeTargets(db, { since, limit: 50, maxAttempts: 3 });
    expect(targets.find((t) => t.gamertag === q2.gamertag)).toBeDefined(); // attempts 1 < 3
    await recordBirthNoticeFailure(db, { target: targetFor(q2, null), error: "boom-2" });
    await recordBirthNoticeFailure(db, { target: targetFor(q2, null), error: "boom-3" });
    targets = await findBirthNoticeTargets(db, { since, limit: 50, maxAttempts: 3 });
    expect(targets.find((t) => t.gamertag === q2.gamertag)).toBeUndefined(); // attempts 3 >= 3
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
  pnpm --filter @onelife/newsdesk test test/birth-pg-store.test.ts
```
Expected failure: `does not provide an export named 'findBirthNoticeTargets'` (and `publishBirthNotice`, `recordBirthNoticeFailure`, `birthNoticeSlug`) — only `BirthNoticeTarget` exists so far.

- [ ] **Step 3: Write the implementation**

Full `apps/newsdesk/src/birth-pg-store.ts` after the change (the `BirthNoticeTarget` interface from Task 04 stays at the top; everything else is new):
```ts
import type { Database } from "@onelife/db";
import { articles, lives, players, servers } from "@onelife/db";
import { and, eq, asc, gte, notExists, sql } from "drizzle-orm";
import { qualifiedLifeCondition } from "@onelife/read-models";

export interface BirthNoticeTarget {
  lifeId: number;         // CURRENT id — transient (loads getLifeTimeline in the tick); never stored
  serverId: number;
  gamertag: string;
  map: string;
  mapSlug: string | null;
  lifeNumber: number;
  lifeStartedAt: Date;    // natural-key: which life (rebuild-stable) + feed order
  endedAt: Date | null;   // set only if the life already died before the sweep
}

/** Structural inputs publishBirthNotice needs — the tick passes the full BirthFacts object, which
 *  has these fields plus more; the extra fields ride into the `facts` jsonb at runtime. No index
 *  signature (that would make a named interface like BirthFacts fail to assign). */
export interface PublishBirthFacts {
  minutesToQualify: number | null;
  persona: string | null;
  isKnownQuantity: boolean;
}
export interface PublishBirthNotice {
  headline: string;
  lede: string;
  body: string;
  pullQuote: { text: string; attribution: string } | null;
  tags: string[];
}
export interface PublishBirthInput {
  target: BirthNoticeTarget;
  facts: PublishBirthFacts;
  notice: PublishBirthNotice;
  promptVersion: string;
  model: string;
  now: Date;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Deterministic, rebuild-stable, unique per life: headline + gamertag + serverId + lifeNumber
 *  (mirror of obituarySlug — all natural, rebuild-stable values, no projection row id). */
export function birthNoticeSlug(headline: string, gamertag: string, serverId: number, lifeNumber: number): string {
  const h = slugify(headline).slice(0, 60).replace(/-+$/g, "") || "birth-notice";
  const g = slugify(gamertag) || "survivor";
  return `${h}-${g}-${serverId}-${lifeNumber}`;
}

// The article's identity is the natural life tuple — the conflict target for both upserts.
const CONFLICT = [articles.kind, articles.serverId, articles.gamertag, articles.lifeStartedAt];

/** Qualified lives (alive OR dead) needing a birth notice: born on/after `since`, no published
 *  article and no exhausted failed stub. Anti-joins `articles` on the natural key with
 *  kind='birth_notice'. Unlike the obituary query there is NO `isNotNull(lives.endedAt)` filter —
 *  a living spawn is a valid target. */
export async function findBirthNoticeTargets(
  db: Database,
  opts: { since: Date; limit: number; maxAttempts: number },
): Promise<BirthNoticeTarget[]> {
  const rows = await db
    .select({
      lifeId: lives.id,
      serverId: lives.serverId,
      gamertag: players.gamertag,
      map: servers.map,
      mapSlug: servers.slug,
      lifeNumber: lives.lifeNumber,
      lifeStartedAt: lives.startedAt,
      endedAt: lives.endedAt,
    })
    .from(lives)
    .innerJoin(players, eq(players.id, lives.playerId))
    .innerJoin(servers, eq(servers.id, lives.serverId))
    .where(
      and(
        gte(lives.startedAt, opts.since),
        qualifiedLifeCondition(db),
        // no blocking article for this life (natural key): published, or failed-but-exhausted
        notExists(
          db
            .select({ x: sql`1` })
            .from(articles)
            .where(
              and(
                eq(articles.kind, "birth_notice"),
                eq(articles.serverId, lives.serverId),
                eq(articles.gamertag, players.gamertag),
                eq(articles.lifeStartedAt, lives.startedAt),
                sql`(${articles.status} = 'published' OR ${articles.attempts} >= ${opts.maxAttempts})`,
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(lives.startedAt)) // forward from the cutoff, oldest arrivals first
    .limit(opts.limit);

  return rows;
}

const IDENTITY = (t: BirthNoticeTarget) => ({
  kind: "birth_notice" as const,
  serverId: t.serverId,
  gamertag: t.gamertag,
  lifeStartedAt: t.lifeStartedAt,
  map: t.map,
  mapSlug: t.mapSlug,
  lifeNumber: t.lifeNumber,
  deathAt: t.endedAt ?? null, // NULL while alive (requires migration 0010: death_at nullable)
});

/** Upsert a published birth notice on the natural key. Bumps attempts, sets status='published',
 *  stores the full BirthFacts object in `facts` jsonb. */
export async function publishBirthNotice(db: Database, input: PublishBirthInput): Promise<void> {
  const { target: t, notice: n } = input;
  const values = {
    ...IDENTITY(t),
    status: "published" as const,
    slug: birthNoticeSlug(n.headline, t.gamertag, t.serverId, t.lifeNumber),
    headline: n.headline,
    lede: n.lede,
    body: n.body,
    pullQuoteText: n.pullQuote?.text ?? null,
    pullQuoteAttribution: n.pullQuote?.attribution ?? null,
    tags: n.tags,
    facts: input.facts as unknown, // full BirthFacts (incl. priors) rides into jsonb
    promptVersion: input.promptVersion,
    model: input.model,
    generatedAt: input.now,
  };
  await db
    .insert(articles)
    .values({ ...values, attempts: 1 })
    .onConflictDoUpdate({
      target: CONFLICT,
      set: { ...values, attempts: sql`${articles.attempts} + 1`, lastError: null },
    });
}

/** Upsert a failed stub on the natural key: attempts += 1, status='failed'. */
export async function recordBirthNoticeFailure(
  db: Database,
  args: { target: BirthNoticeTarget; error: string },
): Promise<void> {
  const id = IDENTITY(args.target);
  await db
    .insert(articles)
    .values({ ...id, status: "failed", attempts: 1, lastError: args.error })
    .onConflictDoUpdate({
      target: CONFLICT,
      set: { status: "failed", attempts: sql`${articles.attempts} + 1`, lastError: args.error },
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**
```bash
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
  pnpm --filter @onelife/newsdesk test test/birth-pg-store.test.ts
```
Expected: all `birthNoticeSlug` + `findBirthNoticeTargets` suites pass (5 tests).

- [ ] **Step 5: Commit**
```bash
git add apps/newsdesk/src/birth-pg-store.ts apps/newsdesk/test/birth-pg-store.test.ts
git commit -m "feat(newsdesk): birth-notice store (findBirthNoticeTargets, publishBirthNotice, failure, slug)"
```


### Task 08: birth-tick (`birthNoticeTick`)

**Files:**
- Create: `apps/newsdesk/src/birth-tick.ts`
- Test: `apps/newsdesk/test/birth-tick.test.ts`

**Interfaces:**
- Consumes:
  - `Database` from `@onelife/db`.
  - `getLifeTimeline`, `getPlayerPriors` from `@onelife/read-models` (`getPlayerPriors` from Task 02; `getLifeTimeline` returns null for a missing life).
  - `findBirthNoticeTargets`, `publishBirthNotice`, `recordBirthNoticeFailure` from `./birth-pg-store.js` (Task 07).
  - `buildBirthFacts` from `./birth-facts.js` (Task 04).
  - `composeBirthTags` from `./birth-prompt.js` (Task 05).
  - `generateBirthNotice` from `./generate.js` (Task 06).
  - `NewsdeskDeps`, `NewsdeskResult` from `./tick.js` (reused, not redefined).
- Produces (bound verbatim to the contract):
  ```ts
  export function birthNoticeTick(db: Database, deps: NewsdeskDeps & { since: Date | null }): Promise<NewsdeskResult>;
  // if deps.since is null -> return { generated:0, failed:0, skipped:0, dryRun } WITHOUT querying/generating
  ```

- [ ] **Step 1: Write the failing test**

`apps/newsdesk/test/birth-tick.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, articles } from "@onelife/db";
import { and, eq, inArray } from "drizzle-orm";
import { birthNoticeTick } from "../src/birth-tick.js";
import type { CompletionClient } from "../src/generate.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 54e7;
const t0 = new Date("2026-07-17T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
const since0 = new Date("2026-07-16T00:00:00Z"); // before every seeded life
let serverId: number;
const pids: number[] = [];
const lifeIds: number[] = [];
const log = { info: () => {}, error: () => {} };

async function seedQualifiedAlive(tag: string, startH: number) {
  const [p] = await db.insert(players).values({ gamertag: tag }).returning();
  pids.push(p!.id);
  const [l] = await db.insert(lives).values({ serverId, playerId: p!.id, lifeNumber: 1, startedAt: hrs(startH), playtimeSeconds: 7200 }).returning();
  lifeIds.push(l!.id);
  return l!.id;
}

function okClient(): CompletionClient {
  return { complete: async () => JSON.stringify({ headline: "Fresh Meat On The Coast", lede: "L", body: "B", pullQuote: { text: "q", attribution: "a voice on the coast" }, tags: ["Fresh Spawns", "Elektro"] }) };
}
function failClient(): CompletionClient {
  return { complete: async () => { throw new Error("api boom"); } };
}
function calls(client: CompletionClient) {
  let n = 0;
  return { client: { complete: (r: { system: string; user: string }) => { n++; return client.complete(r); } }, count: () => n };
}

const deps = (over: Partial<Parameters<typeof birthNoticeTick>[1]>) => ({
  client: okClient(), dryRun: false, batchCap: 10, maxAttempts: 3,
  promptVersion: "birth-v1", model: "test", now: hrs(24), log, since: since0, ...over,
});

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "bt", map: "chernarusplus", slug: `bt-${svc}`, active: true }).returning();
  serverId = s!.id;
});
afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(lives).where(inArray(lives.id, lifeIds));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("birthNoticeTick", () => {
  it("since=null: short-circuits to zeros without querying or calling the client", async () => {
    await seedQualifiedAlive(`bt-null-${svc}`, 2);
    const c = calls(okClient());
    const r = await birthNoticeTick(db, deps({ client: c.client, since: null }));
    expect(r).toEqual({ generated: 0, failed: 0, skipped: 0, dryRun: false });
    expect(c.count()).toBe(0);
    const rows = await db.select().from(articles).where(and(eq(articles.gamertag, `bt-null-${svc}`), eq(articles.kind, "birth_notice")));
    expect(rows).toHaveLength(0);
  });

  it("dry-run: never calls the client and writes nothing", async () => {
    await seedQualifiedAlive(`bt-dry-${svc}`, 3);
    const c = calls(okClient());
    const r = await birthNoticeTick(db, deps({ client: c.client, dryRun: true }));
    expect(r.dryRun).toBe(true);
    expect(c.count()).toBe(0);
    const rows = await db.select().from(articles).where(and(eq(articles.gamertag, `bt-dry-${svc}`), eq(articles.kind, "birth_notice")));
    expect(rows).toHaveLength(0);
  });

  it("live: generates and publishes a birth notice (First Life, death_at NULL), idempotent on re-run", async () => {
    await seedQualifiedAlive(`bt-live-${svc}`, 4);
    const r1 = await birthNoticeTick(db, deps({ batchCap: 50 }));
    expect(r1.generated).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(articles).where(and(eq(articles.gamertag, `bt-live-${svc}`), eq(articles.kind, "birth_notice")));
    expect(row!.status).toBe("published");
    expect(row!.kind).toBe("birth_notice");
    expect(row!.deathAt).toBeNull();
    expect(row!.headline).toBe("Fresh Meat On The Coast");
    expect(row!.slug).toMatch(/^fresh-meat-on-the-coast-bt-live-/);
    expect(row!.tags).toContain("Fresh Spawns");
    expect(row!.tags).toContain("First Life"); // no priors -> First Life
    const before = (await db.select().from(articles).where(eq(articles.serverId, serverId))).length;
    await birthNoticeTick(db, deps({ batchCap: 50 }));
    const after = (await db.select().from(articles).where(eq(articles.serverId, serverId))).length;
    expect(after).toBe(before); // published lives are skipped
  });

  it("failure: records a failed stub with an incremented attempt", async () => {
    await seedQualifiedAlive(`bt-fail-${svc}`, 6);
    const r = await birthNoticeTick(db, deps({ client: failClient(), batchCap: 50 }));
    expect(r.failed).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(articles).where(and(eq(articles.gamertag, `bt-fail-${svc}`), eq(articles.kind, "birth_notice")));
    expect(row!.status).toBe("failed");
    expect(row!.attempts).toBe(1);
    expect(row!.lastError).toMatch(/boom/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
  pnpm --filter @onelife/newsdesk test test/birth-tick.test.ts
```
Expected failure: `Cannot find module '../src/birth-tick.js'` — the module does not exist yet.

- [ ] **Step 3: Write the implementation**

`apps/newsdesk/src/birth-tick.ts`:
```ts
import type { Database } from "@onelife/db";
import { getLifeTimeline, getPlayerPriors } from "@onelife/read-models";
import { findBirthNoticeTargets, publishBirthNotice, recordBirthNoticeFailure } from "./birth-pg-store.js";
import { buildBirthFacts } from "./birth-facts.js";
import { composeBirthTags } from "./birth-prompt.js";
import { generateBirthNotice } from "./generate.js";
import type { NewsdeskDeps, NewsdeskResult } from "./tick.js";

/**
 * One birth-notice cycle, the sibling of newsdeskTick. Forward-only: `since` is the go-live cutoff.
 * When `since` is null the birth pass is OFF — return zeros immediately without querying the DB or
 * calling the model. Otherwise: find qualified lives (alive-or-dead) born since the cutoff lacking a
 * published notice, generate each in the Nursery voice, and publish it. Every OpenRouter call + write
 * is behind the dryRun gate.
 */
export async function birthNoticeTick(
  db: Database,
  deps: NewsdeskDeps & { since: Date | null },
): Promise<NewsdeskResult> {
  if (deps.since === null) {
    return { generated: 0, failed: 0, skipped: 0, dryRun: deps.dryRun };
  }

  const targets = await findBirthNoticeTargets(db, { since: deps.since, limit: deps.batchCap, maxAttempts: deps.maxAttempts });
  let generated = 0;
  let failed = 0;
  let skipped = 0;

  for (const t of targets) {
    const timeline = await getLifeTimeline(db, t.serverId, t.gamertag, t.lifeId);
    if (!timeline) {
      skipped++;
      continue;
    }
    const priors = await getPlayerPriors(db, t.gamertag, t.lifeStartedAt);
    const facts = buildBirthFacts(t, timeline, priors);

    if (deps.dryRun) {
      deps.log.info({ gamertag: t.gamertag, lifeId: t.lifeId, map: t.map }, "DRY RUN: would generate birth notice");
      continue;
    }

    try {
      const notice = await generateBirthNotice(deps.client, facts);
      // Reserved tags (Fresh Spawns / map / priors label) are composed deterministically; the LLM
      // only contributes at most one flavor tag.
      const tagged = { ...notice, tags: composeBirthTags(facts, notice.tags) };
      await publishBirthNotice(db, {
        target: t,
        facts,
        notice: tagged,
        promptVersion: deps.promptVersion,
        model: deps.model,
        now: deps.now,
      });
      generated++;
    } catch (e) {
      await recordBirthNoticeFailure(db, { target: t, error: e instanceof Error ? e.message : String(e) });
      deps.log.error?.({ err: e, lifeId: t.lifeId }, "birth notice generation failed (will retry)");
      failed++;
    }
  }

  return { generated, failed, skipped, dryRun: deps.dryRun };
}
```

- [ ] **Step 4: Run tests to verify they pass**
```bash
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
  pnpm --filter @onelife/newsdesk test test/birth-tick.test.ts
```
Expected: all 4 `birthNoticeTick` suites pass (since=null short-circuit, dry-run, live, failure).

- [ ] **Step 5: Commit**
```bash
git add apps/newsdesk/src/birth-tick.ts apps/newsdesk/test/birth-tick.test.ts
git commit -m "feat(newsdesk): birthNoticeTick (forward-only, dry-run-gated birth pass)"
```


### Task 09: config `NEWSDESK_BIRTH_SINCE` (`birthSince: Date | null`)

**Files:**
- Modify: `apps/newsdesk/src/config.ts` (add `NEWSDESK_BIRTH_SINCE` to the schema, `birthSince: Date | null` to `Config`, and the ISO parse)
- Test: `apps/newsdesk/test/config.test.ts` (add `NEWSDESK_BIRTH_SINCE` cases; keep the existing dry-run-safety cases untouched)

**Interfaces:**
- Consumes: `z` from `zod` (already imported in `config.ts`).
- Produces (bound verbatim to the contract):
  ```ts
  // Config gains:
  birthSince: Date | null;  // from NEWSDESK_BIRTH_SINCE; null when unset / empty / unparseable
  ```
  The existing `NEWSDESK_DRY_RUN` safety semantics (`dryRun = value !== "false"`) are unchanged.

- [ ] **Step 1: Write the failing test**

Append to `apps/newsdesk/test/config.test.ts` (new describe block; existing `dry-run safety default` block is unchanged):
```ts
describe("newsdesk config — NEWSDESK_BIRTH_SINCE (forward-only birth cutoff)", () => {
  it("defaults birthSince to null when unset (birth pass off)", () => {
    expect(loadConfig({ ...BASE }).birthSince).toBeNull();
  });
  it("is null for an empty or whitespace value", () => {
    expect(loadConfig({ ...BASE, NEWSDESK_BIRTH_SINCE: "" }).birthSince).toBeNull();
    expect(loadConfig({ ...BASE, NEWSDESK_BIRTH_SINCE: "   " }).birthSince).toBeNull();
  });
  it("parses a valid ISO-8601 timestamp into a Date", () => {
    const c = loadConfig({ ...BASE, NEWSDESK_BIRTH_SINCE: "2026-07-17T00:00:00Z" });
    expect(c.birthSince).toBeInstanceOf(Date);
    expect(c.birthSince?.toISOString()).toBe("2026-07-17T00:00:00.000Z");
  });
  it("is null for an unparseable value (safe: birth pass stays off)", () => {
    expect(loadConfig({ ...BASE, NEWSDESK_BIRTH_SINCE: "not-a-date" }).birthSince).toBeNull();
  });
  it("leaves the dry-run default untouched", () => {
    expect(loadConfig({ ...BASE, NEWSDESK_BIRTH_SINCE: "2026-07-17T00:00:00Z" }).dryRun).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
  pnpm --filter @onelife/newsdesk test test/config.test.ts
```
Expected failure: the new suite fails on `c.birthSince` being `undefined` (property does not exist on `Config` yet); the existing dry-run cases still pass.

- [ ] **Step 3: Write the implementation**

Full `apps/newsdesk/src/config.ts` after the change:
```ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  OPENROUTER_API_KEY: z.string().default(""),
  NEWSDESK_MODEL: z.string().default("anthropic/claude-sonnet-5"),
  NEWSDESK_DRY_RUN: z.string().optional(),
  NEWSDESK_BIRTH_SINCE: z.string().optional(),
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
  birthSince: Date | null;
  intervalSeconds: number;
  batchCap: number;
  maxAttempts: number;
  temperature: number;
  logLevel: string;
};

/** Parse the forward-only birth cutoff. Unset / empty / unparseable -> null (birth pass off) — a
 *  safe default parallel to the dry-run gate. */
function parseBirthSince(raw: string | undefined): Date | null {
  if (!raw || raw.trim() === "") return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const p = schema.parse(env);
  return {
    databaseUrl: p.DATABASE_URL,
    openrouterApiKey: p.OPENROUTER_API_KEY,
    model: p.NEWSDESK_MODEL,
    // SAFE DEFAULT: dry-run unless explicitly disabled with "false".
    dryRun: p.NEWSDESK_DRY_RUN !== "false",
    // SAFE DEFAULT: birth pass off unless a valid ISO cutoff is provided.
    birthSince: parseBirthSince(p.NEWSDESK_BIRTH_SINCE),
    intervalSeconds: p.NEWSDESK_INTERVAL_SECONDS,
    batchCap: p.NEWSDESK_BATCH_CAP,
    maxAttempts: p.NEWSDESK_MAX_ATTEMPTS,
    temperature: p.NEWSDESK_TEMPERATURE,
    logLevel: p.LOG_LEVEL,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**
```bash
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
  pnpm --filter @onelife/newsdesk test test/config.test.ts
```
Expected: both describe blocks pass (existing dry-run safety + the new `NEWSDESK_BIRTH_SINCE` cases).

- [ ] **Step 5: Commit**
```bash
git add apps/newsdesk/src/config.ts apps/newsdesk/test/config.test.ts
git commit -m "feat(newsdesk): NEWSDESK_BIRTH_SINCE cutoff (birthSince, off by default)"
```


### Task 10: main runs both passes (obituary tick, then birth tick)

**Files:**
- Modify: `apps/newsdesk/src/main.ts` (run `birthNoticeTick` after `newsdeskTick` each interval; log when the birth pass is off)
- Test: none.

> **No unit test — mirrors R5a exactly.** `main.ts` is the process entrypoint (a `while (true)` loop with `pino`, `getDb`, `openrouterClient` side effects) and has **no** test in the shipped newsdesk (`apps/newsdesk/test/` contains no `main.test.ts`). Fabricating a test here would only assert against mocks of the loop and prove nothing. The verification gate for this task is a typecheck plus the full package test run as a regression check.

**Interfaces:**
- Consumes:
  - `loadConfig` from `./config.js` (now returns `birthSince: Date | null` — Task 09).
  - `newsdeskTick` from `./tick.js`, `OBITUARY_PROMPT_VERSION` from `./prompt.js` (existing).
  - `birthNoticeTick` from `./birth-tick.js` (Task 08).
  - `BIRTH_PROMPT_VERSION` from `./birth-prompt.js` (Task 05).
- Produces: no new exported symbols (entrypoint only).

- [ ] **Step 1: Write the failing test** — N/A (no test file; see the note above).

- [ ] **Step 2: Run test to verify it fails** — N/A. Instead, before the change, confirm the new imports do not yet resolve is not needed; proceed to implement and gate on typecheck (Step 4).

- [ ] **Step 3: Write the implementation**

Full `apps/newsdesk/src/main.ts` after the change:
```ts
import pino from "pino";
import { getDb } from "@onelife/db";
import { loadConfig } from "./config.js";
import { newsdeskTick } from "./tick.js";
import { birthNoticeTick } from "./birth-tick.js";
import { openrouterClient } from "./openrouter.js";
import { OBITUARY_PROMPT_VERSION } from "./prompt.js";
import { BIRTH_PROMPT_VERSION } from "./birth-prompt.js";

const cfg = loadConfig(process.env);
const log = pino({ level: cfg.logLevel });
const { db } = getDb(cfg.databaseUrl);
const client = openrouterClient({ apiKey: cfg.openrouterApiKey, model: cfg.model, temperature: cfg.temperature });

async function loop(): Promise<void> {
  log.info(
    { dryRun: cfg.dryRun, model: cfg.model, interval: cfg.intervalSeconds, batchCap: cfg.batchCap, birthSince: cfg.birthSince?.toISOString() ?? null },
    "newsdesk starting",
  );
  if (cfg.dryRun) log.warn("NEWSDESK_DRY_RUN is on — obituaries and birth notices are logged, not generated or stored. Set NEWSDESK_DRY_RUN=false to generate.");
  if (cfg.birthSince === null) {
    log.warn("NEWSDESK_BIRTH_SINCE is unset — the birth-notice pass is OFF. Set it to an ISO-8601 go-live timestamp to begin coverage.");
  } else {
    log.info({ birthSince: cfg.birthSince.toISOString() }, "birth-notice pass is on (forward-only from this cutoff)");
  }
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Obituary pass.
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

    // Birth pass (a no-op when birthSince is null — birthNoticeTick short-circuits to zeros).
    try {
      const br = await birthNoticeTick(db, {
        client,
        dryRun: cfg.dryRun,
        batchCap: cfg.batchCap,
        maxAttempts: cfg.maxAttempts,
        promptVersion: BIRTH_PROMPT_VERSION,
        model: cfg.model,
        now: new Date(),
        log,
        since: cfg.birthSince,
      });
      if (br.generated || br.failed) log.info(br, "birth notice tick");
    } catch (err) {
      log.error({ err }, "birth notice tick failed");
    }

    await new Promise((r) => setTimeout(r, cfg.intervalSeconds * 1000));
  }
}

loop();
```

- [ ] **Step 4: Run tests to verify they pass** — typecheck + full package regression:
```bash
pnpm --filter @onelife/newsdesk typecheck
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
  pnpm --filter @onelife/newsdesk test
```
Expected: `typecheck` exits 0 (no type errors — the birth imports resolve and `deps.since` is supplied). The full test run stays green across every newsdesk suite (obituary + birth: config, facts, generate, prompt, pg-store, tick, birth-facts, birth-prompt, birth-pg-store, birth-tick, openrouter).

Optional manual smoke (not part of CI): with `NEWSDESK_DRY_RUN` unset (default on) and `NEWSDESK_BIRTH_SINCE` unset, `pnpm --filter @onelife/newsdesk start` should log `NEWSDESK_BIRTH_SINCE is unset — the birth-notice pass is OFF`; set `NEWSDESK_BIRTH_SINCE=<ISO>` and it should log the on-message and, per interval, `DRY RUN: would generate birth notice` for any qualified spawn since the cutoff.

- [ ] **Step 5: Commit**
```bash
git add apps/newsdesk/src/main.ts
git commit -m "feat(newsdesk): run the birth-notice pass each interval after obituaries"
```


### Task 11: birth-notices API routes — GET /birth-notices + /birth-notices/:slug

**Files:**
- Create: `apps/api/src/routes/birth-notices.ts`
- Create: `apps/api/test/birth-notices.test.ts`
- Modify: `apps/api/src/app.ts` (import + register beside `registerObituariesRoutes`; lines 16–17, 45–46)

**Interfaces:**
- Consumes: `getPublishedBirthNotices` / `getBirthNoticeBySlug` from `@onelife/read-models` (Task 03);
  `FastifyInstance`, `Database`, `z`. The Task 01 migration (nullable `articles.death_at`) so the
  test can seed an alive spawn. Mirrors `routes/obituaries.ts` exactly.
- Produces (bind verbatim):
```ts
export function registerBirthNoticesRoutes(app: FastifyInstance, db: Database): void;
// GET /birth-notices?page=  (z.coerce.number().int().positive().catch(1)) -> getPublishedBirthNotices
// GET /birth-notices/:slug  (zod slug; 400 bad, 404 null) -> getBirthNoticeBySlug
```
  Registered in `apps/api/src/app.ts` via `registerBirthNoticesRoutes(app, db)`.

---

- [ ] **Step 1: Write the failing test**

`apps/api/test/birth-notices.test.ts` (mirrors `apps/api/test/obituaries.test.ts`). Seeds a published
`birth_notice` with a `facts` snapshot (`minutesToQualify` + `priors`) and a null `death_at` (alive),
then drives the two routes through `app.inject`.

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, articles } from "@onelife/db";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";

const { db, sql } = getTestDb();
const app = buildApp(db);
const svc = Math.floor(Math.random() * 1e8) + 52e7;
let serverId: number;
const slug = `birth-api-${svc}`;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "bn", map: "chernarusplus", slug: `bn-${svc}`, active: true }).returning();
  serverId = s!.id;
  await db.insert(articles).values({
    kind: "birth_notice", status: "published", slug, serverId, gamertag: `bn-${svc}`,
    map: "chernarusplus", mapSlug: `bn-${svc}`, lifeNumber: 3, lifeStartedAt: new Date("2026-07-15T00:00:00Z"),
    deathAt: null, headline: "Fresh Fool", lede: "L", body: "B", pullQuoteText: "again?", pullQuoteAttribution: "a weary coast",
    tags: ["Fresh Spawns", "Chernarus", "Repeat Offender"],
    facts: { minutesToQualify: 9, priors: { livesLived: 4, longestLifeSeconds: 12000, totalKills: 7, usualDeathCause: "pvp", lastDeathCause: "starvation", bestLifeMap: "sakhal" }, isKnownQuantity: true },
    generatedAt: new Date("2026-07-15T00:05:00Z"),
  });
});
afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("GET /birth-notices", () => {
  it("returns a published birth-notice feed with defaults", async () => {
    const res = await app.inject({ method: "GET", url: "/birth-notices" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ page: 1, pageSize: 20 });
    const row = body.rows.find((r: { slug: string }) => r.slug === slug);
    expect(row).toBeDefined();
    expect(row.minutesToQualify).toBe(9);
    expect(row.priorLives).toBe(4);
  });
  it("coerces invalid page to 1", async () => {
    const res = await app.inject({ method: "GET", url: "/birth-notices?page=-3" });
    expect(res.statusCode).toBe(200);
    expect(res.json().page).toBe(1);
  });
});

describe("GET /birth-notices/:slug", () => {
  it("returns the full article with hydrated priors + null endedAt (alive)", async () => {
    const res = await app.inject({ method: "GET", url: `/birth-notices/${slug}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.headline).toBe("Fresh Fool");
    expect(body.pullQuote).toEqual({ text: "again?", attribution: "a weary coast" });
    expect(body.priors.livesLived).toBe(4);
    expect(body.priors.bestLifeMap).toBe("sakhal");
    expect(body.endedAt).toBeNull();
  });
  it("unknown slug → 404", async () => {
    const res = await app.inject({ method: "GET", url: "/birth-notices/no-such-slug" });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/api test birth-notices
```
Expected failure: `GET /birth-notices` returns **404** (no route registered yet), so the first
assertion `expect(res.statusCode).toBe(200)` fails.

- [ ] **Step 3: Write the implementation**

`apps/api/src/routes/birth-notices.ts` (a line-for-line mirror of `routes/obituaries.ts`):

```ts
import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import { z } from "zod";
import { getPublishedBirthNotices, getBirthNoticeBySlug } from "@onelife/read-models";

const query = z.object({ page: z.coerce.number().int().positive().catch(1) });
const params = z.object({ slug: z.string().min(1) });

export function registerBirthNoticesRoutes(app: FastifyInstance, db: Database): void {
  app.get("/birth-notices", async (req) => {
    const { page } = query.parse(req.query);
    return getPublishedBirthNotices(db, { page });
  });

  app.get("/birth-notices/:slug", async (req, reply) => {
    const p = params.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "bad_request" });
    const article = await getBirthNoticeBySlug(db, p.data.slug);
    if (!article) return reply.code(404).send({ error: "not_found" });
    return article;
  });
}
```

Wire it into `apps/api/src/app.ts`. Add the import beside the obituaries import (after line 16):

```ts
import { registerBirthNoticesRoutes } from "./routes/birth-notices.js";
```

And register it beside `registerObituariesRoutes(app, db)` (after line 45):

```ts
  registerObituariesRoutes(app, db);
  registerBirthNoticesRoutes(app, db);
  registerFreshSpawnsRoutes(app, db);
```

- [ ] **Step 4: Run tests to verify they pass**

```
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/api test birth-notices
pnpm --filter @onelife/api typecheck
```
Expected: all four `it`s PASS — feed `{ page: 1, pageSize: 20 }` with the seeded row exposing
`minutesToQualify: 9` + `priorLives: 4`; invalid page coerced to 1; slug route returns the hydrated
article (pull quote + `priors.bestLifeMap: "sakhal"`, `endedAt: null`); unknown slug → 404. Typecheck clean.

- [ ] **Step 5: Commit**

```
git add apps/api/src/routes/birth-notices.ts \
        apps/api/test/birth-notices.test.ts \
        apps/api/src/app.ts
git commit -m "feat(api): GET /birth-notices feed + /birth-notices/:slug routes"
```

---

**Note on the 400 branch (honest, mirrors R5a):** the `params` slug guard (`z.string().min(1)`) can only
fail on an empty segment, which Fastify does not route to `/:slug` (it 404s the bare `/birth-notices/`).
So — exactly like the shipped `obituaries.test.ts` — this suite asserts 200/404 + page coercion but does
not assert a reachable 400. The `reply.code(400)` guard is retained verbatim from the obituaries route as
defensive parity; writing a test that forced a 400 would be vacuous, so it is intentionally omitted.


### Task 12: Web lib — birth-notice types, API client, birth-format, and JSON-LD

**Files:**
- Create: `apps/web/src/lib/birth-format.ts`
- Create (test): `apps/web/src/lib/birth-format.test.ts`
- Modify: `apps/web/src/lib/types.ts` (append birth-notice client types after the obituary types, ~line 183)
- Modify: `apps/web/src/lib/api.ts` (extend the type import block line 1-6; add two getters after `getObituary`, ~line 138)
- Modify: `apps/web/src/lib/seo.ts` (add `birthNoticeLd` after `articleLd`, ~line 45)
- Modify (test): `apps/web/src/lib/seo.test.ts` (add a `birthNoticeLd` describe block)

**Interfaces:**
- Consumes (existing code):
  - `absoluteUrl(path: string): string`, `ldScript(obj: unknown): string` from `@/lib/seo`
  - `mapLabel(map: string): string`, `formatDuration(seconds: number): string`, `relativeDate(iso: string, now: Date): string` from `@/components/player/format`
  - `apiGet<T>(path)`, `getOrNull<T>(path)` from `@/lib/api`
- Produces (later tasks bind to these VERBATIM):
  - `lib/types.ts`: `BirthNoticeCard` `{ slug; gamertag; map; mapSlug: string|null; lifeNumber; headline; lede; tags: string[]; bornAt: string; minutesToQualify: number|null; priorLives: number }`; `BirthNoticesFeed { rows: BirthNoticeCard[]; total; page; pageSize }`; `BirthNoticeArticle extends BirthNoticeCard { body: string; pullQuote: {text;attribution}|null; priors: {livesLived; longestLifeSeconds; totalKills; usualDeathCause: string|null; lastDeathCause: string|null; bestLifeMap: string|null}; endedAt: string|null }`
  - `lib/api.ts`: `getBirthNoticesFeed(page: number): Promise<BirthNoticesFeed>`, `getBirthNotice(slug: string): Promise<BirthNoticeArticle | null>`
  - `lib/birth-format.ts`: `freshSpawnsHref(page: number): string`, `birthNoticeHref(slug: string): string`, `birthDateline(map: string, bornAtIso: string, now: Date): string`, `interface PriorFact { label: string; value: string; hot?: boolean }`, `priorsFacts(a: BirthNoticeArticle): PriorFact[]`, `birthShowingLine(page: number, total: number, pageSize: number): string`
  - `lib/seo.ts`: `birthNoticeLd(a: { headline; lede; gamertag; bornAt: string }, url: string): object`

> **Interface note (parameter order):** the contract pins `birthShowingLine(page, total, pageSize)` — this is a DIFFERENT order from the R5a `obituaryShowingLine(page, pageSize, total)`. Bind to `(page, total, pageSize)` exactly.
>
> **Design decision (bound to contract, noted for reviewers):** the contract example for `birthDateline` shows `"CHERNARUS BUREAU · 2 hours ago"`. The existing `relativeDate` helper is day-granular (returns `"today"` under 24h), so `birth-format.ts` adds a private hours/minutes-aware `bornAgo` helper and only falls back to `relativeDate` for ≥ 24h. This is the minimal deviation needed to honor the contract's documented output.

---

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/birth-format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  freshSpawnsHref,
  birthNoticeHref,
  birthDateline,
  priorsFacts,
  birthShowingLine,
} from "./birth-format";
import type { BirthNoticeArticle } from "./types";

const now = new Date("2026-07-17T12:00:00Z");

const base: BirthNoticeArticle = {
  slug: "new-fool-ashore-3", gamertag: "Boots", map: "chernarusplus", mapSlug: "chernarus",
  lifeNumber: 3, headline: "H", lede: "L", tags: ["Fresh Spawns"],
  bornAt: "2026-07-17T10:00:00Z", minutesToQualify: 6, priorLives: 2,
  body: "B", pullQuote: null, endedAt: null,
  priors: {
    livesLived: 2, longestLifeSeconds: 7200, totalKills: 9,
    usualDeathCause: "pvp", lastDeathCause: "starvation", bestLifeMap: "sakhal",
  },
};

describe("birth hrefs", () => {
  it("feed href omits page 1", () => {
    expect(freshSpawnsHref(1)).toBe("/fresh-spawns");
    expect(freshSpawnsHref(3)).toBe("/fresh-spawns?page=3");
  });
  it("article href", () => {
    expect(birthNoticeHref("new-fool-ashore-3")).toBe("/fresh-spawns/new-fool-ashore-3");
  });
});

describe("birthDateline", () => {
  it("labels the map (codename → name) and reads an hours-granular relative time", () => {
    // bornAt is 2h before `now`
    expect(birthDateline("chernarusplus", "2026-07-17T10:00:00Z", now)).toBe("CHERNARUS BUREAU · 2 hours ago");
  });
  it("reads minutes when under an hour old", () => {
    expect(birthDateline("sakhal", "2026-07-17T11:45:00Z", now)).toBe("SAKHAL BUREAU · 15 minutes ago");
  });
});

describe("priorsFacts", () => {
  it("returns lives lived / longest life / kills / usual end (usual end hot) for a returning player", () => {
    const facts = priorsFacts(base);
    expect(facts.map((f) => f.label)).toEqual(["Lives lived", "Longest life", "Kills, all lives", "Usual end"]);
    expect(facts.find((f) => f.label === "Lives lived")!.value).toBe("2");
    expect(facts.find((f) => f.label === "Usual end")!.value).toBe("Killed");
    expect(facts.find((f) => f.label === "Usual end")!.hot).toBe(true);
  });
  it("returns no rows for a first-lifer", () => {
    const first = { ...base, priorLives: 0, priors: { livesLived: 0, longestLifeSeconds: 0, totalKills: 0, usualDeathCause: null, lastDeathCause: null, bestLifeMap: null } };
    expect(priorsFacts(first)).toEqual([]);
  });
});

describe("birthShowingLine", () => {
  it("reads in-voice with (page, total, pageSize) argument order", () => {
    expect(birthShowingLine(2, 56, 20)).toBe("Showing 21–40 of 56 ashore");
  });
});
```

Add a `birthNoticeLd` block to `apps/web/src/lib/seo.test.ts`. Change the import line at the top from:

```ts
import { absoluteUrl, ldScript } from "./seo";
```

to:

```ts
import { absoluteUrl, ldScript, birthNoticeLd } from "./seo";
```

and append after the existing `describe("ldScript", ...)` block (before the final line of the file):

```ts
describe("birthNoticeLd", () => {
  const article = { headline: "New Fool Ashore", lede: "L", gamertag: "Boots", bornAt: "2026-07-17T10:00:00Z" };
  it("emits a NewsArticle with bornAt as datePublished and the Fresh Spawns collection", () => {
    const ld = birthNoticeLd(article, "https://x/fresh-spawns/new-fool-ashore-3") as Record<string, unknown>;
    expect(ld["@type"]).toBe("NewsArticle");
    expect(ld.datePublished).toBe("2026-07-17T10:00:00Z");
    expect((ld.isPartOf as Record<string, unknown>).name).toBe("Fresh Spawns");
    expect((ld.about as Record<string, unknown>).name).toBe("Boots");
  });
  it("escapes </script> when rendered through ldScript", () => {
    const out = ldScript(birthNoticeLd({ ...article, headline: "X </script><script>alert(1)</script>" }, "https://x/y"));
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<");
    expect(out).toContain("\\u003c");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm --filter web exec vitest run src/lib/birth-format.test.ts src/lib/seo.test.ts
```

Expected failure: `birth-format.test.ts` fails to resolve `./birth-format` (module not found), and `seo.test.ts` fails because `birthNoticeLd` is not exported from `./seo`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/birth-format.ts`:

```ts
import { mapLabel, formatDuration, relativeDate } from "@/components/player/format";
import type { BirthNoticeArticle } from "./types";

export function freshSpawnsHref(page: number): string {
  return page > 1 ? `/fresh-spawns?page=${page}` : "/fresh-spawns";
}

export function birthNoticeHref(slug: string): string {
  return `/fresh-spawns/${slug}`;
}

/** Hours/minutes-aware relative time; falls back to the day-granular relativeDate for >= 24h. */
function bornAgo(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  return relativeDate(iso, now);
}

/** "CHERNARUS BUREAU · 2 hours ago" — map is the dateline, never a coordinate (Fog Rule). */
export function birthDateline(map: string, bornAtIso: string, now: Date): string {
  return `${mapLabel(map).toUpperCase()} BUREAU · ${bornAgo(bornAtIso, now)}`;
}

export interface PriorFact { label: string; value: string; hot?: boolean }

function causeLabel(cause: string | null): string {
  if (cause === "pvp") return "Killed";
  if (!cause) return "Unknown";
  return cause.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The deterministic "Priors" box rows — never the LLM. Empty for a first-lifer (no priors). */
export function priorsFacts(a: BirthNoticeArticle): PriorFact[] {
  const p = a.priors;
  if (p.livesLived === 0) return [];
  const out: PriorFact[] = [
    { label: "Lives lived", value: String(p.livesLived) },
    { label: "Longest life", value: formatDuration(p.longestLifeSeconds) },
    { label: "Kills, all lives", value: String(p.totalKills) },
  ];
  if (p.usualDeathCause) out.push({ label: "Usual end", value: causeLabel(p.usualDeathCause), hot: true });
  return out;
}

export function birthShowingLine(page: number, total: number, pageSize: number): string {
  const to = Math.min(page * pageSize, total);
  const from = Math.min((page - 1) * pageSize + 1, to);
  return `Showing ${from}–${to} of ${total} ashore`;
}
```

Append to `apps/web/src/lib/types.ts` (after the `ObituaryArticle` type, end of file):

```ts
export type BirthNoticeCard = {
  slug: string;
  gamertag: string;
  map: string;
  mapSlug: string | null;
  lifeNumber: number;
  headline: string;
  lede: string;
  tags: string[];
  bornAt: string;
  minutesToQualify: number | null;
  priorLives: number;
};
export type BirthNoticesFeed = { rows: BirthNoticeCard[]; total: number; page: number; pageSize: number };
export type BirthNoticeArticle = BirthNoticeCard & {
  body: string;
  pullQuote: { text: string; attribution: string } | null;
  priors: {
    livesLived: number;
    longestLifeSeconds: number;
    totalKills: number;
    usualDeathCause: string | null;
    lastDeathCause: string | null;
    bestLifeMap: string | null;
  };
  endedAt: string | null;
};
```

Edit the type import block at the top of `apps/web/src/lib/api.ts` — change:

```ts
  ObituariesFeed, ObituaryArticle,
} from "./types";
```

to:

```ts
  ObituariesFeed, ObituaryArticle,
  BirthNoticesFeed, BirthNoticeArticle,
} from "./types";
```

Append after the `getObituary` export at the bottom of `apps/web/src/lib/api.ts`:

```ts

export const getBirthNoticesFeed = (page: number) =>
  apiGet<BirthNoticesFeed>(`/api/birth-notices?page=${page}`);
export const getBirthNotice = (slug: string) =>
  getOrNull<BirthNoticeArticle>(`/api/birth-notices/${encodeURIComponent(slug)}`);
```

Append `birthNoticeLd` to `apps/web/src/lib/seo.ts` (after `articleLd`, end of file):

```ts

export function birthNoticeLd(
  a: { headline: string; lede: string; gamertag: string; bornAt: string },
  url: string,
) {
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: a.headline,
    description: a.lede,
    url,
    datePublished: a.bornAt,
    about: { "@type": "Person", name: a.gamertag },
    isPartOf: { "@type": "CollectionPage", name: "Fresh Spawns", url: absoluteUrl("/fresh-spawns") },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
pnpm --filter web exec vitest run src/lib/birth-format.test.ts src/lib/seo.test.ts
pnpm --filter web typecheck
```

Expected: both test files PASS (birth-format's 8 assertions + seo's obituary/birth blocks), and `typecheck` reports no errors.

- [ ] **Step 5: Commit**

```
git add apps/web/src/lib/birth-format.ts apps/web/src/lib/birth-format.test.ts \
        apps/web/src/lib/types.ts apps/web/src/lib/api.ts \
        apps/web/src/lib/seo.ts apps/web/src/lib/seo.test.ts
git commit -m "feat(web): birth-notice web lib (types, api client, birth-format, JSON-LD)"
```


### Task 13: birth-notices components + promote shared pull-quote / numbered pager

**Files:**
- Move: `apps/web/src/components/obituaries/pull-quote.tsx` → `apps/web/src/components/shared/pull-quote.tsx` (via `git mv`)
- Create: `apps/web/src/components/shared/numbered-pager.tsx`
- Modify: `apps/web/src/components/obituaries/obituary-article.tsx:4` (re-point the `PullQuote` import)
- Modify: `apps/web/src/components/obituaries/obituaries-pagination.tsx` (delegate to `NumberedPager` — identical rendered DOM)
- Create: `apps/web/src/components/birth-notices/birth-notice-card.tsx`
- Create: `apps/web/src/components/birth-notices/priors-box.tsx`
- Create: `apps/web/src/components/birth-notices/more-fresh-meat.tsx`
- Create: `apps/web/src/components/birth-notices/birth-notices-pagination.tsx`
- Create: `apps/web/src/components/birth-notices/birth-notice-article.tsx`
- Create (test): `apps/web/src/components/birth-notices/birth-notice-card.test.tsx`
- Create (test): `apps/web/src/components/birth-notices/priors-box.test.tsx`
- Create (test): `apps/web/src/components/birth-notices/more-fresh-meat.test.tsx`
- Create (test): `apps/web/src/components/birth-notices/birth-notices-pagination.test.tsx`
- Create (test): `apps/web/src/components/birth-notices/birth-notice-article.test.tsx`

**Interfaces:**
- Consumes (from Task 12 + existing code):
  - `BirthNoticeCard` (aliased `Card`), `BirthNoticeArticle` from `@/lib/types`
  - `birthNoticeHref`, `birthDateline`, `priorsFacts`, `freshSpawnsHref`, `birthShowingLine` from `@/lib/birth-format`
  - `obituariesHref`, `obituaryShowingLine` from `@/lib/obituary-format`
  - `GamertagLink` from `@/components/gamertag-link`; `mapLabel`, `monthYear` from `@/components/player/format`
  - `cn` from `@/lib/utils`; `pageBox`, `pageBoxLink`, `pageBoxOff` from `@/components/pagination-box`
- Produces (Tasks 14/15/16 bind to these VERBATIM):
  - `BirthNoticeCard({ card, now }: { card: Card; now: Date })`
  - `PriorsBox({ article }: { article: BirthNoticeArticle })`
  - `MoreFreshMeat({ rows }: { rows: Card[] })`
  - `BirthNoticesPagination({ page, total, pageSize }: { page: number; total: number; pageSize: number })`
  - `BirthNoticeArticleView({ article, more, now }: { article: BirthNoticeArticle; more: Card[]; now: Date })`
  - shared `PullQuote({ text, attribution })`, `NumberedPager({ page, total, pageSize, hrefFor, showingLine })`

> **Contract binding:** `PriorsBox` takes ONLY `{ article }` (no `now`), so the arrival note is built from `monthYear(article.bornAt)` + `article.minutesToQualify` — deterministic without a clock. First-lifer branch renders `"No priors. A stranger to these shores."` per the spec.

---

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/components/birth-notices/birth-notice-card.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { BirthNoticeCard } from "./birth-notice-card";
import type { BirthNoticeCard as Card } from "@/lib/types";

const now = new Date("2026-07-17T12:00:00Z");
const card: Card = {
  slug: "new-fool-ashore-3", gamertag: "xX_Sn1per_Xx", map: "chernarusplus", mapSlug: "chernarus",
  lifeNumber: 3, headline: "Another Fool Washes Ashore", lede: "The tide brought us one more.",
  tags: ["Fresh Spawns", "Chernarus"], bornAt: "2026-07-17T10:00:00Z", minutesToQualify: 6, priorLives: 2,
};

describe("BirthNoticeCard", () => {
  test("headline links to the interior notice; gamertag to the dossier; shows dek + dateline + prior lives", () => {
    render(<BirthNoticeCard card={card} now={now} />);
    expect(screen.getByRole("link", { name: /Another Fool Washes Ashore/ })).toHaveAttribute("href", "/fresh-spawns/new-fool-ashore-3");
    expect(screen.getByRole("link", { name: "xX_Sn1per_Xx" })).toHaveAttribute("href", "/players/xx-sn1per-xx");
    expect(screen.getByText("The tide brought us one more.")).toBeInTheDocument();
    expect(screen.getByText(/CHERNARUS BUREAU/)).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // prior lives
  });
  test("first-lifer shows the First life badge instead of a prior-lives count", () => {
    render(<BirthNoticeCard card={{ ...card, priorLives: 0 }} now={now} />);
    expect(screen.getByText("First life")).toBeInTheDocument();
  });
});
```

Create `apps/web/src/components/birth-notices/priors-box.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { PriorsBox } from "./priors-box";
import type { BirthNoticeArticle } from "@/lib/types";

const returning: BirthNoticeArticle = {
  slug: "s", gamertag: "Boots", map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 3,
  headline: "H", lede: "L", tags: [], bornAt: "2026-07-10T00:00:00Z", minutesToQualify: 6, priorLives: 2,
  body: "B", pullQuote: null, endedAt: null,
  priors: { livesLived: 2, longestLifeSeconds: 7200, totalKills: 9, usualDeathCause: "pvp", lastDeathCause: "starvation", bestLifeMap: "sakhal" },
};

describe("PriorsBox", () => {
  test("returning player shows the deterministic prior rows + arrival note", () => {
    render(<PriorsBox article={returning} />);
    expect(screen.getByText("Lives lived")).toBeInTheDocument();
    expect(screen.getByText("Usual end")).toBeInTheDocument();
    expect(screen.getByText(/Washed ashore/)).toBeInTheDocument();
    expect(screen.getByText(/qualified in 6 min/)).toBeInTheDocument();
  });
  test("first-lifer shows the stranger line", () => {
    const first = { ...returning, priorLives: 0, priors: { livesLived: 0, longestLifeSeconds: 0, totalKills: 0, usualDeathCause: null, lastDeathCause: null, bestLifeMap: null } };
    render(<PriorsBox article={first} />);
    expect(screen.getByText("No priors. A stranger to these shores.")).toBeInTheDocument();
  });
});
```

Create `apps/web/src/components/birth-notices/more-fresh-meat.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { MoreFreshMeat } from "./more-fresh-meat";
import type { BirthNoticeCard } from "@/lib/types";

const row: BirthNoticeCard = {
  slug: "r-1", gamertag: "Boots", map: "sakhal", mapSlug: "sakhal", lifeNumber: 1,
  headline: "Ashore And Doomed", lede: "L", tags: [], bornAt: "2026-07-17T10:00:00Z", minutesToQualify: null, priorLives: 0,
};

describe("MoreFreshMeat", () => {
  test("renders related notice headlines linking to their interiors", () => {
    render(<MoreFreshMeat rows={[row]} />);
    expect(screen.getByRole("link", { name: /Ashore And Doomed/ })).toHaveAttribute("href", "/fresh-spawns/r-1");
  });
  test("renders nothing when there are no rows", () => {
    const { container } = render(<MoreFreshMeat rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

Create `apps/web/src/components/birth-notices/birth-notices-pagination.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { BirthNoticesPagination } from "./birth-notices-pagination";

describe("BirthNoticesPagination", () => {
  test("range line, page links, current page not a link", () => {
    render(<BirthNoticesPagination page={2} total={56} pageSize={20} />);
    expect(screen.getByText("Showing 21–40 of 56 ashore")).toBeInTheDocument();
    expect(screen.getByText("2")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "1" })).toHaveAttribute("href", "/fresh-spawns");
    expect(screen.getByRole("link", { name: "3" })).toHaveAttribute("href", "/fresh-spawns?page=3");
  });
  test("renders nothing when empty", () => {
    const { container } = render(<BirthNoticesPagination page={1} total={0} pageSize={20} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

Create `apps/web/src/components/birth-notices/birth-notice-article.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { BirthNoticeArticleView } from "./birth-notice-article";
import type { BirthNoticeArticle } from "@/lib/types";

const now = new Date("2026-07-17T12:00:00Z");
const article: BirthNoticeArticle = {
  slug: "new-fool-ashore-3", gamertag: "xX_Sn1per_Xx", map: "chernarusplus", mapSlug: "chernarus",
  lifeNumber: 3, headline: "Another Fool Washes Ashore", lede: "L",
  tags: ["Fresh Spawns", "Chernarus"], bornAt: "2026-07-17T10:00:00Z", minutesToQualify: 6, priorLives: 2,
  body: "The tide does not care who it drops on the sand.",
  pullQuote: { text: "It always begins with a flare.", attribution: "a bystander" }, endedAt: null,
  priors: { livesLived: 2, longestLifeSeconds: 7200, totalKills: 9, usualDeathCause: "pvp", lastDeathCause: "starvation", bestLifeMap: "sakhal" },
};

describe("BirthNoticeArticleView", () => {
  test("renders kicker, headline, byline, body, pull quote, priors, tags, gamertag link", () => {
    render(<BirthNoticeArticleView article={article} more={[]} now={now} />);
    expect(screen.getByRole("heading", { level: 1, name: /Another Fool Washes Ashore/ })).toBeInTheDocument();
    expect(screen.getByText(/Birth Notice ·/)).toBeInTheDocument();
    expect(screen.getByText("The tide does not care who it drops on the sand.")).toBeInTheDocument();
    expect(screen.getByText(/It always begins with a flare/)).toBeInTheDocument();
    expect(screen.getByText("Lives lived")).toBeInTheDocument(); // Priors box
    expect(screen.getByText("Chernarus")).toBeInTheDocument(); // a tag
    expect(screen.getByRole("link", { name: "xX_Sn1per_Xx" })).toHaveAttribute("href", "/players/xx-sn1per-xx");
  });
  test("status line reads 'Still drawing breath' while alive", () => {
    render(<BirthNoticeArticleView article={article} more={[]} now={now} />);
    expect(screen.getByText(/Still drawing breath/)).toBeInTheDocument();
  });
  test("status line flips to a past-tense note once the life has died", () => {
    render(<BirthNoticeArticleView article={{ ...article, endedAt: "2026-07-17T11:00:00Z" }} more={[]} now={now} />);
    expect(screen.getByText(/Didn't last the day/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
pnpm --filter web exec vitest run src/components/birth-notices/
```

Expected failure: all five test files fail to resolve their `./birth-notice-*` / `./priors-box` / `./more-fresh-meat` imports (modules do not exist yet).

- [ ] **Step 3: Write the implementation**

First promote the shared pieces. Move the pull-quote:

```
git mv apps/web/src/components/obituaries/pull-quote.tsx apps/web/src/components/shared/pull-quote.tsx
```

Re-point the obituary import — edit `apps/web/src/components/obituaries/obituary-article.tsx` line 4, change:

```tsx
import { PullQuote } from "./pull-quote";
```

to:

```tsx
import { PullQuote } from "@/components/shared/pull-quote";
```

Create `apps/web/src/components/shared/numbered-pager.tsx` (extracted verbatim from the current `ObituariesPagination` inner markup so obituaries' DOM/tests are unchanged):

```tsx
import Link from "next/link";
import { cn } from "@/lib/utils";
import { pageBox, pageBoxLink, pageBoxOff } from "@/components/pagination-box";

const WINDOW = 2;

function pageWindow(page: number, totalPages: number): number[] {
  const start = Math.max(1, page - WINDOW);
  const end = Math.min(totalPages, page + WINDOW);
  const pages: number[] = [];
  for (let n = start; n <= end; n++) pages.push(n);
  return pages;
}

/** Shared mono numbered pager: prev · windowed page numbers · next, with a caller-supplied showing line. */
export function NumberedPager({
  page, total, pageSize, hrefFor, showingLine,
}: {
  page: number; total: number; pageSize: number;
  hrefFor: (page: number) => string; showingLine: string;
}) {
  if (total === 0) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const showPrev = page > 1;
  const showNext = page * pageSize < total;
  return (
    <nav aria-label="Pagination" className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t-[3px] border-ink pt-3">
      <span className="font-mono text-[11.5px] uppercase tracking-[.05em] text-ink-muted">{showingLine}</span>
      <div className="flex flex-wrap gap-2">
        {showPrev ? (
          <Link href={hrefFor(page - 1)} className={cn(pageBox, pageBoxLink)}><span aria-hidden>← </span>Prev</Link>
        ) : (
          <span aria-hidden className={cn(pageBox, pageBoxOff)}>← Prev</span>
        )}
        {pageWindow(page, totalPages).map((n) =>
          n === page ? (
            <span key={n} aria-current="page" className={cn(pageBox, "bg-ink text-paper")}>{n}</span>
          ) : (
            <Link key={n} href={hrefFor(n)} className={cn(pageBox, pageBoxLink)}>{n}</Link>
          ),
        )}
        {showNext ? (
          <Link href={hrefFor(page + 1)} className={cn(pageBox, pageBoxLink)}>Next<span aria-hidden> →</span></Link>
        ) : (
          <span aria-hidden className={cn(pageBox, pageBoxOff)}>Next →</span>
        )}
      </div>
    </nav>
  );
}
```

Replace the whole body of `apps/web/src/components/obituaries/obituaries-pagination.tsx` with the thin delegate (renders identical DOM, so `obituaries-pagination.test.tsx` still passes):

```tsx
import { NumberedPager } from "@/components/shared/numbered-pager";
import { obituariesHref, obituaryShowingLine } from "@/lib/obituary-format";

export function ObituariesPagination({ page, total, pageSize }: { page: number; total: number; pageSize: number }) {
  return (
    <NumberedPager
      page={page}
      total={total}
      pageSize={pageSize}
      hrefFor={obituariesHref}
      showingLine={obituaryShowingLine(page, pageSize, total)}
    />
  );
}
```

Create `apps/web/src/components/birth-notices/birth-notice-card.tsx`:

```tsx
import Link from "next/link";
import type { BirthNoticeCard as Card } from "@/lib/types";
import { GamertagLink } from "@/components/gamertag-link";
import { birthNoticeHref, birthDateline } from "@/lib/birth-format";

/** One birth notice in the freshest-first feed — dateline, headline → interior, dek, arrival strip. */
export function BirthNoticeCard({ card, now }: { card: Card; now: Date }) {
  return (
    <article className="border-b border-hairline py-6">
      <p className="font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted">{birthDateline(card.map, card.bornAt, now)}</p>
      <h2 className="mt-1.5 font-display text-3xl font-bold uppercase leading-[.95] text-ink md:text-4xl">
        <Link href={birthNoticeHref(card.slug)} className="hover:text-blue">{card.headline}</Link>
      </h2>
      <p className="mt-2 max-w-2xl font-mono text-[13px] leading-relaxed text-ink-soft">{card.lede}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <span className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          <GamertagLink gamertag={card.gamertag} className="font-bold text-ink underline" />
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          {card.priorLives > 0 ? (
            <>Prior lives <span className="font-bold text-ink">{card.priorLives}</span></>
          ) : (
            <span className="font-bold text-blue">First life</span>
          )}
        </span>
        {card.minutesToQualify != null && (
          <span className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
            Qualified in <span className="font-bold text-ink">{card.minutesToQualify}m</span>
          </span>
        )}
      </div>
    </article>
  );
}
```

Create `apps/web/src/components/birth-notices/priors-box.tsx`:

```tsx
import { cn } from "@/lib/utils";
import { priorsFacts } from "@/lib/birth-format";
import { monthYear } from "@/components/player/format";
import type { BirthNoticeArticle } from "@/lib/types";

/** The deterministic "Priors" box — the player's global record, never the LLM. */
export function PriorsBox({ article }: { article: BirthNoticeArticle }) {
  const facts = priorsFacts(article);
  return (
    <section className="border-2 border-ink bg-bone p-5">
      <p className="font-display text-xs font-bold uppercase tracking-[.16em] text-ink">The Priors</p>
      {facts.length === 0 ? (
        <p className="mt-3 font-mono text-[13px] leading-relaxed text-ink-soft">No priors. A stranger to these shores.</p>
      ) : (
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
          {facts.map((f) => (
            <div key={f.label}>
              <dd className={cn("font-display text-[26px] font-bold leading-none", f.hot ? "text-red" : "text-ink")}>{f.value}</dd>
              <dt className="mt-1 font-mono text-[10px] uppercase tracking-[.07em] text-ink-muted">{f.label}</dt>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-4 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
        Washed ashore {monthYear(article.bornAt)}
        {article.minutesToQualify != null ? ` · qualified in ${article.minutesToQualify} min` : ""}
      </p>
    </section>
  );
}
```

Create `apps/web/src/components/birth-notices/more-fresh-meat.tsx`:

```tsx
import Link from "next/link";
import type { BirthNoticeCard } from "@/lib/types";
import { birthNoticeHref } from "@/lib/birth-format";
import { mapLabel } from "@/components/player/format";

/** Related-rail: other recent birth notices (self already excluded by the caller). */
export function MoreFreshMeat({ rows }: { rows: BirthNoticeCard[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-10 border-t-[3px] border-ink pt-4">
      <h2 className="font-display text-sm font-bold uppercase tracking-[.14em] text-ink">More Fresh Meat</h2>
      <ul className="mt-3 flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.slug}>
            <Link href={birthNoticeHref(r.slug)} className="group block">
              <span className="font-display text-lg font-bold uppercase leading-tight text-ink group-hover:text-blue">{r.headline}</span>
              <span className="mt-0.5 block font-mono text-[10.5px] uppercase tracking-[.05em] text-ink-muted">{r.gamertag} · {mapLabel(r.map)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

Create `apps/web/src/components/birth-notices/birth-notices-pagination.tsx`:

```tsx
import { NumberedPager } from "@/components/shared/numbered-pager";
import { freshSpawnsHref, birthShowingLine } from "@/lib/birth-format";

export function BirthNoticesPagination({ page, total, pageSize }: { page: number; total: number; pageSize: number }) {
  return (
    <NumberedPager
      page={page}
      total={total}
      pageSize={pageSize}
      hrefFor={freshSpawnsHref}
      showingLine={birthShowingLine(page, total, pageSize)}
    />
  );
}
```

Create `apps/web/src/components/birth-notices/birth-notice-article.tsx`:

```tsx
import type { ReactNode } from "react";
import { GamertagLink } from "@/components/gamertag-link";
import { PullQuote } from "@/components/shared/pull-quote";
import { PriorsBox } from "./priors-box";
import { MoreFreshMeat } from "./more-fresh-meat";
import type { BirthNoticeArticle, BirthNoticeCard } from "@/lib/types";
import { birthDateline } from "@/lib/birth-format";
import { cn } from "@/lib/utils";
import { mapLabel } from "@/components/player/format";

export function BirthNoticeArticleView({
  article,
  more,
  now,
}: {
  article: BirthNoticeArticle;
  more: BirthNoticeCard[];
  now: Date;
}): ReactNode {
  const dead = article.endedAt != null;
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10 md:px-10">
      <div className="border-b-[3px] border-blue pb-5">
        <p className="font-mono text-[11px] uppercase tracking-[.06em] text-blue">Birth Notice · {birthDateline(article.map, article.bornAt, now)}</p>
        <h1 className="mt-2 font-display text-5xl font-bold uppercase leading-[.92] text-ink md:text-6xl">{article.headline}</h1>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          Filed by The Desk · <GamertagLink gamertag={article.gamertag} className="font-bold text-ink underline" /> · Life {article.lifeNumber} · {mapLabel(article.map)}
        </p>
      </div>

      <div className="mt-6 space-y-4 font-mono text-[14px] leading-relaxed text-ink-soft">
        {article.body.split(/\n{2,}/).map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>

      {article.pullQuote && <PullQuote text={article.pullQuote.text} attribution={article.pullQuote.attribution} />}

      <div className="mt-5">
        <PriorsBox article={article} />
      </div>

      {article.tags.length > 0 && (
        <p className="mt-6 flex flex-wrap gap-2">
          {article.tags.map((t) => (
            <span key={t} className="border border-dash px-2 py-1 font-mono text-[10px] uppercase tracking-[.06em] text-ink-muted">{t}</span>
          ))}
        </p>
      )}

      <p className={cn("mt-6 font-mono text-[11px] uppercase tracking-[.06em]", dead ? "text-red" : "text-blue")}>
        {dead ? "Didn't last the day — already in the morgue." : "Still drawing breath — for now."}
      </p>

      <MoreFreshMeat rows={more} />
    </main>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
pnpm --filter web exec vitest run src/components/birth-notices/ src/components/obituaries/obituaries-pagination.test.tsx src/components/obituaries/obituary-article.test.tsx
pnpm --filter web typecheck
```

Expected: all five new birth-notices test files PASS; the two re-pointed obituaries tests still PASS (identical DOM after the shared-pager/pull-quote promotion); `typecheck` clean.

- [ ] **Step 5: Commit**

```
git add apps/web/src/components/shared/pull-quote.tsx apps/web/src/components/shared/numbered-pager.tsx \
        apps/web/src/components/obituaries/obituary-article.tsx apps/web/src/components/obituaries/obituaries-pagination.tsx \
        apps/web/src/components/birth-notices/
git commit -m "feat(web): birth-notices components; promote shared pull-quote + numbered pager"
```


### Task 14: Live `/fresh-spawns` feed page + loading skeleton

**Files:**
- Modify (full replace): `apps/web/src/app/fresh-spawns/page.tsx` (retire the `<TeaserPage>`, drop `robots:{index:false}`)
- Create: `apps/web/src/app/fresh-spawns/loading.tsx`
- Test: none — see the verification note below.

**Interfaces:**
- Consumes (from Tasks 12/13 + existing code):
  - `getBirthNoticesFeed(page: number): Promise<BirthNoticesFeed>` from `@/lib/api`
  - `BirthNoticeCard({ card, now })`, `BirthNoticesPagination({ page, total, pageSize })` from `@/components/birth-notices/*`
  - `freshSpawnsHref(page)` from `@/lib/birth-format`; `absoluteUrl` from `@/lib/seo`
  - `Kicker` from `@/components/tabloid/kicker`; `parsePage` from `@/lib/board-params`
  - `ObituariesSkeleton` (generic feed skeleton) from `@/components/skeletons`
- Produces: the public `/fresh-spawns` route (indexable) + its `loading.tsx`.

> **Testing approach (mirrors R5a exactly):** `app/obituaries/page.tsx` and `app/obituaries/loading.tsx` have NO unit tests — Next.js server components and route `loading.tsx` are verified by `pnpm --filter web typecheck` (and the production build), not a fabricated unit test. This task does the same: no test file; verification is typecheck.
>
> **Skeleton reuse:** the contract file map creates only `loading.tsx` (it does NOT modify `skeletons.tsx`), so this task reuses the generic `ObituariesSkeleton` (a kicker-bar + 5-row feed skeleton), exactly as `obituaries/loading.tsx` consumes it.

---

- [ ] **Step 1: Write the failing test** — N/A.

Server components + `loading.tsx` carry no fabricated unit test (mirroring R5a's `obituaries/page.tsx` + `obituaries/loading.tsx`, which have none). The failing signal for this task is `pnpm --filter web typecheck` failing to resolve the new imports (`getBirthNoticesFeed`, the birth-notices components, `freshSpawnsHref`) before the code is written — but those all land in Tasks 12/13 which precede this task, so proceed straight to the implementation and confirm with typecheck in Step 4.

- [ ] **Step 2: Run test to verify it fails** — N/A (no unit test). Baseline check that the current teaser still type-checks:

```
pnpm --filter web typecheck
```

Expected: clean (the old teaser page compiles). This is the pre-change baseline, not a red test.

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `apps/web/src/app/fresh-spawns/page.tsx` with:

```tsx
import type { Metadata } from "next";
import { getBirthNoticesFeed } from "@/lib/api";
import { Kicker } from "@/components/tabloid/kicker";
import { BirthNoticeCard } from "@/components/birth-notices/birth-notice-card";
import { BirthNoticesPagination } from "@/components/birth-notices/birth-notices-pagination";
import { freshSpawnsHref } from "@/lib/birth-format";
import { absoluteUrl } from "@/lib/seo";
import { parsePage } from "@/lib/board-params";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const page = parsePage((await searchParams).page);
  const title = page > 1 ? `Fresh Spawns · Page ${page}` : "Fresh Spawns";
  const description = "The newest fools to wash ashore in One Life — a birth notice from the nursery desk for every qualified life.";
  const canonical = absoluteUrl(freshSpawnsHref(page));
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

export default async function FreshSpawnsPage({ searchParams }: Props) {
  const page = parsePage((await searchParams).page);
  const feed = await getBirthNoticesFeed(page);
  const now = new Date();

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10">
      <div className="border-b-[3px] border-ink pb-4">
        <Kicker color="blue">The Nursery</Kicker>
        <h1 className="mt-2 font-display text-5xl font-bold uppercase leading-[.95] text-ink md:text-6xl">Fresh Spawns</h1>
      </div>

      {feed.rows.length === 0 ? (
        <p className="py-16 font-mono text-sm uppercase tracking-[.05em] text-ink-muted">
          The nursery is empty. No fool has washed ashore yet — give it time.
        </p>
      ) : (
        <>
          {feed.rows.map((card) => (
            <BirthNoticeCard key={card.slug} card={card} now={now} />
          ))}
          <BirthNoticesPagination page={feed.page} total={feed.total} pageSize={feed.pageSize} />
        </>
      )}
    </main>
  );
}
```

Notes on the replacement: the previous `export const metadata = { title: "Fresh Spawns", robots: { index: false } }` is gone — dropping `robots:{index:false}` makes the section indexable, and metadata is now dynamic via `generateMetadata`. `TeaserPage` is no longer imported.

Create `apps/web/src/app/fresh-spawns/loading.tsx`:

```tsx
import { ObituariesSkeleton } from "@/components/skeletons";

export default function Loading() {
  return <ObituariesSkeleton />;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
pnpm --filter web typecheck
pnpm --filter web build
```

Expected: `typecheck` reports no errors; `build` compiles the `/fresh-spawns` route (now a dynamic server page) and its `loading.tsx` with no errors. (Run the full suite to confirm nothing regressed: `pnpm --filter web test`.)

- [ ] **Step 5: Commit**

```
git add apps/web/src/app/fresh-spawns/page.tsx apps/web/src/app/fresh-spawns/loading.tsx
git commit -m "feat(web): live /fresh-spawns feed page + loading skeleton, drop teaser noindex"
```


### Task 15: `/fresh-spawns/[slug]` interior page + OpenGraph image

**Files:**
- Create: `apps/web/src/app/fresh-spawns/[slug]/page.tsx`
- Create: `apps/web/src/app/fresh-spawns/[slug]/opengraph-image.tsx`
- Create (assets): `apps/web/src/app/fresh-spawns/[slug]/oswald-700.ttf`, `plex-mono-400.ttf`, `plex-mono-700.ttf` (copied from the obituary OG dir — the Node OG runtime reads co-located `.ttf` via `fs`, and a strict setup means each route dir needs its own copy)
- Test: none — see the verification note below.

**Interfaces:**
- Consumes (from Tasks 12/13 + existing code):
  - `getBirthNotice(slug): Promise<BirthNoticeArticle | null>`, `getBirthNoticesFeed(1)` from `@/lib/api`
  - `BirthNoticeArticleView({ article, more, now })` from `@/components/birth-notices/birth-notice-article`
  - `birthNoticeLd(a, url)`, `absoluteUrl(path)`, `ldScript(obj)` from `@/lib/seo`
  - `birthNoticeHref(slug)`, `birthDateline(map, bornAtIso, now)`, `priorsFacts(a)` from `@/lib/birth-format`
  - `notFound` from `next/navigation`; `ImageResponse` from `next/og`; `readFile` from `node:fs/promises`
- Produces: the public interior route `/fresh-spawns/[slug]` + its dynamic OG image.

> **Testing approach (mirrors R5a exactly):** `app/obituaries/[slug]/page.tsx` and `app/obituaries/[slug]/opengraph-image.tsx` have NO unit tests — an interior server page and an `ImageResponse` route are verified by `pnpm --filter web typecheck` (and the build), not a fabricated unit test. This task does the same: no test file; verification is typecheck + build.
>
> **No Final Reload:** unlike the obituary interior, a birth notice has no timeline (the subject is alive/thin), so `page.tsx` does NOT load `getPlayerLife`/`buildTimeline`. `BirthNoticeArticleView` takes only `{ article, more, now }`.

---

- [ ] **Step 1: Write the failing test** — N/A.

Interior server page + OG image route carry no fabricated unit test (mirroring R5a's obituary `[slug]/page.tsx` + `opengraph-image.tsx`, which have none). Verification is typecheck/build in Step 4.

- [ ] **Step 2: Run test to verify it fails** — N/A (no unit test). The pre-existence signal is that `pnpm --filter web build` has no `/fresh-spawns/[slug]` route yet; after Step 3 it does.

- [ ] **Step 3: Write the implementation**

Copy the OG font assets into the new route dir (the OG runtime reads them co-located, exactly as the obituary route does):

```
cp "apps/web/src/app/obituaries/[slug]/oswald-700.ttf"   "apps/web/src/app/fresh-spawns/[slug]/oswald-700.ttf"
cp "apps/web/src/app/obituaries/[slug]/plex-mono-400.ttf" "apps/web/src/app/fresh-spawns/[slug]/plex-mono-400.ttf"
cp "apps/web/src/app/obituaries/[slug]/plex-mono-700.ttf" "apps/web/src/app/fresh-spawns/[slug]/plex-mono-700.ttf"
```

Create `apps/web/src/app/fresh-spawns/[slug]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBirthNotice, getBirthNoticesFeed } from "@/lib/api";
import { BirthNoticeArticleView } from "@/components/birth-notices/birth-notice-article";
import { birthNoticeLd, absoluteUrl, ldScript } from "@/lib/seo";
import { birthNoticeHref } from "@/lib/birth-format";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const a = await getBirthNotice(slug).catch(() => null);
  if (!a) return { title: "Birth Notice — One Life" };
  const title = `${a.headline} — ${a.gamertag} — One Life`;
  return {
    title,
    description: a.lede,
    alternates: { canonical: absoluteUrl(birthNoticeHref(slug)) },
    openGraph: { title, description: a.lede, url: absoluteUrl(birthNoticeHref(slug)), type: "article" },
    twitter: { card: "summary_large_image", title, description: a.lede },
  };
}

export default async function BirthNoticePage({ params }: Props) {
  const { slug } = await params;
  const article = await getBirthNotice(slug);
  if (!article) notFound();
  const now = new Date();
  const feed = await getBirthNoticesFeed(1).catch(() => ({ rows: [], total: 0, page: 1, pageSize: 20 }));
  const more = feed.rows.filter((r) => r.slug !== article.slug).slice(0, 4);
  const ld = birthNoticeLd(article, absoluteUrl(birthNoticeHref(slug)));

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldScript(ld) }} />
      <BirthNoticeArticleView article={article} more={more} now={now} />
    </>
  );
}
```

Create `apps/web/src/app/fresh-spawns/[slug]/opengraph-image.tsx` (the birth variant of the obituary dossier card):

```tsx
import { readFile } from "node:fs/promises";
import { ImageResponse } from "next/og";
import { getBirthNotice } from "@/lib/api";
import { priorsFacts, birthDateline } from "@/lib/birth-format";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "One Life birth notice";

const asset = (name: string) => readFile(new URL(`./${name}`, import.meta.url));

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [article, oswald, mono, monoBold] = await Promise.all([
    getBirthNotice(slug).catch(() => null),
    asset("oswald-700.ttf"),
    asset("plex-mono-400.ttf"),
    asset("plex-mono-700.ttf"),
  ]);

  const headline = article?.headline ?? "A Birth Notice";
  const line = article ? birthDateline(article.map, article.bornAt, new Date()) : "ONE LIFE · THE NURSERY";
  const facts = article ? priorsFacts(article) : [];
  const readout = facts.length > 0 ? facts : [{ label: "Priors", value: "First life", hot: false }];

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0C0C08", color: "#FBFAF2", padding: 64 }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontFamily: "IBM Plex Mono", fontSize: 22, letterSpacing: 2, color: "#7FA8FF", textTransform: "uppercase" }}>Birth Notice · {line}</div>
          <div style={{ display: "flex", fontFamily: "Oswald", fontWeight: 700, fontSize: 78, lineHeight: 1.02, textTransform: "uppercase", marginTop: 20, maxWidth: 1000 }}>{headline}</div>
        </div>
        <div style={{ display: "flex", gap: 48 }}>
          {readout.map((f) => (
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

- [ ] **Step 4: Run tests to verify they pass**

```
pnpm --filter web typecheck
pnpm --filter web build
```

Expected: `typecheck` clean; `build` emits the `/fresh-spawns/[slug]` route and its `opengraph-image` with no errors (confirming the co-located `.ttf` reads resolve and the JSX is valid). Full suite unaffected: `pnpm --filter web test`.

- [ ] **Step 5: Commit**

```
git add "apps/web/src/app/fresh-spawns/[slug]/page.tsx" \
        "apps/web/src/app/fresh-spawns/[slug]/opengraph-image.tsx" \
        "apps/web/src/app/fresh-spawns/[slug]/oswald-700.ttf" \
        "apps/web/src/app/fresh-spawns/[slug]/plex-mono-400.ttf" \
        "apps/web/src/app/fresh-spawns/[slug]/plex-mono-700.ttf"
git commit -m "feat(web): /fresh-spawns/[slug] interior notice + OG image"
```


### Task 16: Home-page blocks — Latest Obituaries + Latest Fresh Spawns

**Files:**
- Create: `apps/web/src/components/front-page/latest-obituaries.tsx`
- Create: `apps/web/src/components/front-page/latest-fresh-spawns.tsx`
- Create (test): `apps/web/src/components/front-page/latest-blocks.test.tsx`
- Modify (full replace): `apps/web/src/app/page.tsx` (fetch both feeds, slice 3, render both blocks below `<TopSurvivors/>`)

**Interfaces:**
- Consumes (from Tasks 12/13 + existing code):
  - `getObituariesFeed(1)`, `getBirthNoticesFeed(1)`, `getSurvivors({sort,page})` from `@/lib/api`
  - `ObituaryCard`, `BirthNoticeCard` (client types) from `@/lib/types`
  - `SectionHeader` from `@/components/tabloid/section-header`
  - `obituaryHref(slug)` from `@/lib/obituary-format`; `birthNoticeHref(slug)` from `@/lib/birth-format`
  - `mapLabel(map)` from `@/components/player/format`
- Produces:
  - `LatestObituaries({ rows }: { rows: ObituaryCard[] })`
  - `LatestFreshSpawns({ rows }: { rows: BirthNoticeCard[] })`

> **Testing approach:** the two front-page blocks are presentational (props-only) — unit-tested with vitest + testing-library, mirroring `front-page.test.tsx`'s `TopSurvivors` cases (rows render + quiet empty state). The wired `app/page.tsx` is a server component with no fabricated unit test (mirroring R5a's pages); it is verified by `pnpm --filter web typecheck` / build.

---

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/front-page/latest-blocks.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import type { ObituaryCard, BirthNoticeCard } from "@/lib/types";
import { LatestObituaries } from "./latest-obituaries";
import { LatestFreshSpawns } from "./latest-fresh-spawns";

const obit: ObituaryCard = {
  slug: "gone-42", gamertag: "Boots", map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 3,
  headline: "The King Is Dead", lede: "L", tags: ["Obituaries"], timeAliveSeconds: 7200, kills: 3,
  longestKillMeters: 210, cause: "pvp", deathAt: "2026-07-10T00:00:00Z",
};

const spawn: BirthNoticeCard = {
  slug: "new-fool-1", gamertag: "Khushie", map: "sakhal", mapSlug: "sakhal", lifeNumber: 1,
  headline: "Another Fool Washes Ashore", lede: "L", tags: ["Fresh Spawns"],
  bornAt: "2026-07-17T10:00:00Z", minutesToQualify: 6, priorLives: 0,
};

describe("LatestObituaries", () => {
  it("renders headlines linking to interiors and an ALL link to the section", () => {
    render(<LatestObituaries rows={[obit]} />);
    expect(screen.getByRole("link", { name: /The King Is Dead/ })).toHaveAttribute("href", "/obituaries/gone-42");
    expect(screen.getByRole("link", { name: "ALL →" })).toHaveAttribute("href", "/obituaries");
  });
  it("shows a quiet empty state when there are no rows", () => {
    render(<LatestObituaries rows={[]} />);
    expect(screen.getByText(/NOTHING FILED YET/)).toBeInTheDocument();
  });
});

describe("LatestFreshSpawns", () => {
  it("renders headlines linking to interiors and an ALL link to the section", () => {
    render(<LatestFreshSpawns rows={[spawn]} />);
    expect(screen.getByRole("link", { name: /Another Fool Washes Ashore/ })).toHaveAttribute("href", "/fresh-spawns/new-fool-1");
    expect(screen.getByRole("link", { name: "ALL →" })).toHaveAttribute("href", "/fresh-spawns");
  });
  it("shows a quiet empty state when there are no rows", () => {
    render(<LatestFreshSpawns rows={[]} />);
    expect(screen.getByText(/NO FOOL HAS WASHED ASHORE YET/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm --filter web exec vitest run src/components/front-page/latest-blocks.test.tsx
```

Expected failure: the test file fails to resolve `./latest-obituaries` and `./latest-fresh-spawns` (modules do not exist yet).

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/components/front-page/latest-obituaries.tsx`:

```tsx
import Link from "next/link";
import type { ObituaryCard } from "@/lib/types";
import { SectionHeader } from "@/components/tabloid/section-header";
import { obituaryHref } from "@/lib/obituary-format";
import { mapLabel } from "@/components/player/format";

/** Home-page block: the most recent obituaries (top 3), linking into The Morgue. */
export function LatestObituaries({ rows }: { rows: ObituaryCard[] }) {
  return (
    <section className="px-6 py-8 md:px-10">
      <SectionHeader
        title="Fresh from the morgue"
        action={
          <Link href="/obituaries" className="font-mono text-xs font-bold uppercase tracking-[.06em] text-ink hover:text-red">
            ALL →
          </Link>
        }
      />
      {rows.length === 0 ? (
        <p className="py-6 font-mono text-sm uppercase tracking-[.05em] text-ink-muted">
          THE MORGUE DESK IS QUIET. NOTHING FILED YET.
        </p>
      ) : (
        <ol>
          {rows.map((r) => (
            <li key={r.slug} className="border-b border-hairline py-3">
              <Link href={obituaryHref(r.slug)} className="font-display text-lg font-bold uppercase leading-tight text-ink hover:text-red">
                {r.headline}
              </Link>
              <span className="mt-0.5 block font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
                {r.gamertag} · {mapLabel(r.map)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
```

Create `apps/web/src/components/front-page/latest-fresh-spawns.tsx`:

```tsx
import Link from "next/link";
import type { BirthNoticeCard } from "@/lib/types";
import { SectionHeader } from "@/components/tabloid/section-header";
import { birthNoticeHref } from "@/lib/birth-format";
import { mapLabel } from "@/components/player/format";

/** Home-page block: the most recent birth notices (top 3), linking into The Nursery. */
export function LatestFreshSpawns({ rows }: { rows: BirthNoticeCard[] }) {
  return (
    <section className="px-6 py-8 md:px-10">
      <SectionHeader
        title="Just washed ashore"
        action={
          <Link href="/fresh-spawns" className="font-mono text-xs font-bold uppercase tracking-[.06em] text-ink hover:text-blue">
            ALL →
          </Link>
        }
      />
      {rows.length === 0 ? (
        <p className="py-6 font-mono text-sm uppercase tracking-[.05em] text-ink-muted">
          THE NURSERY IS EMPTY. NO FOOL HAS WASHED ASHORE YET.
        </p>
      ) : (
        <ol>
          {rows.map((r) => (
            <li key={r.slug} className="border-b border-hairline py-3">
              <Link href={birthNoticeHref(r.slug)} className="font-display text-lg font-bold uppercase leading-tight text-ink hover:text-blue">
                {r.headline}
              </Link>
              <span className="mt-0.5 block font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
                {r.gamertag} · {mapLabel(r.map)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
```

Replace the entire contents of `apps/web/src/app/page.tsx` with:

```tsx
import { getSurvivors, getObituariesFeed, getBirthNoticesFeed } from "@/lib/api";
import { Hero } from "@/components/front-page/hero";
import { TopSurvivors } from "@/components/front-page/top-survivors";
import { LatestObituaries } from "@/components/front-page/latest-obituaries";
import { LatestFreshSpawns } from "@/components/front-page/latest-fresh-spawns";
import { SignInCta } from "@/components/front-page/signin-cta";

export default async function Home() {
  const [survivors, obituaries, freshSpawns] = await Promise.all([
    getSurvivors({ sort: "time", page: 1 }).catch(() => null),
    getObituariesFeed(1).catch(() => null),
    getBirthNoticesFeed(1).catch(() => null),
  ]);
  return (
    <main className="mx-auto w-full max-w-5xl">
      <Hero />
      <TopSurvivors rows={survivors?.rows.slice(0, 5) ?? []} />
      <LatestObituaries rows={obituaries?.rows.slice(0, 3) ?? []} />
      <LatestFreshSpawns rows={freshSpawns?.rows.slice(0, 3) ?? []} />
      <SignInCta />
    </main>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
pnpm --filter web exec vitest run src/components/front-page/latest-blocks.test.tsx
pnpm --filter web typecheck
```

Expected: the block tests PASS (rows render with correct hrefs + both empty states); `typecheck` clean (confirming `app/page.tsx` wires both feeds and blocks correctly). Full suite unaffected: `pnpm --filter web test`.

- [ ] **Step 5: Commit**

```
git add apps/web/src/components/front-page/latest-obituaries.tsx \
        apps/web/src/components/front-page/latest-fresh-spawns.tsx \
        apps/web/src/components/front-page/latest-blocks.test.tsx \
        apps/web/src/app/page.tsx
git commit -m "feat(web): home-page Latest Obituaries + Latest Fresh Spawns blocks"
```


### Task 17: Docs — CHANGELOG + CLAUDE.md

**Files:**
- Modify: `CHANGELOG.md` (the `[Unreleased]` section)
- Modify: `CLAUDE.md` (Tabloid redesign section, newsdesk app bullet, packages/read-models list, apps/api routes)

**Interfaces:**
- Consumes: the shipped R5b surface from Tasks 01–16 (kind `birth_notice`, `getPublishedBirthNotices`/`getBirthNoticeBySlug`, `getPlayerPriors`, the birth pass + `NEWSDESK_BIRTH_SINCE`, `GET /birth-notices`, `/fresh-spawns` feed+interior, the two home blocks).
- Produces: nothing consumed by code. This is the guard-required docs step (the guard blocks the PR unless CHANGELOG.md and CLAUDE.md both changed on this branch). No test — verified by `git diff` showing both files changed; a final `pnpm --filter web typecheck` confirms no doc-embedded code drift.

> This task is deliberately last (CLAUDE.md is the final content step before the PR). The `finishing-a-feature` flow re-checks these, so keep the entries accurate to what actually shipped.

- [ ] **Step 1: Add the CHANGELOG entry**

Under `## [Unreleased]` → `### Added` in `CHANGELOG.md`, add:

```markdown
- Tabloid redesign R5b — Birth Notices / Fresh Spawns. The newsdesk worker gains a second pass that
  writes an in-voice **Birth Notice** ("The Nursery") for every qualified life going forward, behind
  the shared dry-run gate and a **forward-only** `NEWSDESK_BIRTH_SINCE` cutoff (unset ⇒ birth pass
  off). Reuses the durable `articles` table with a new `kind='birth_notice'` (migration `0010`:
  `death_at` nullable + a born-order index). The story material is the player's **global cross-life
  priors** (`getPlayerPriors`), not the thin current life. The `/fresh-spawns` teaser is retired for a
  real feed + slim interior at `/fresh-spawns/[slug]` (one paragraph + pull quote + "The Priors" box +
  a "still drawing breath" status line), a `NewsArticle` JSON-LD block, and a dynamic OG image. New
  public `GET /birth-notices` + `GET /birth-notices/:slug`. The home page gains two content blocks —
  Latest Obituaries and Latest Fresh Spawns. Facts come from read-models only; the LLM writes voice
  (Fog Rule: map dateline, never coordinates — the subject is still alive).
```

If a `0010` migration line belongs under a separate group, keep it inside this single Added bullet — the migration is part of the R5b slice.

- [ ] **Step 2: Update CLAUDE.md**

In `CLAUDE.md`:
1. **Tabloid redesign section** — change the roadmap line to record **R5b shipped** (Birth Notices /
   Fresh Spawns) with a one-paragraph summary matching the changelog; note the voice-first rule now
   retires the **Fresh Spawns** teaser, and **News stays static until R5d**. Update the "(R1+R2+...
   shipped)" tier list to include R5b.
2. **apps list → `newsdesk`** — note it now runs **two passes** (obituaries + birth notices); document
   `NEWSDESK_BIRTH_SINCE` (ISO cutoff; unset ⇒ birth pass off; forward-only) alongside the existing
   `NEWSDESK_DRY_RUN`.
3. **packages → `read-models`** — add `player-priors` (global cross-life reputation) and
   `birth-notice-articles` (published birth-notice feed + by-slug) to the read-models description.
4. **Sub-projects / redesign prose** — add the birth-notice route pair (`GET /birth-notices[/:slug]`)
   and the `/fresh-spawns` feed+interior + the two home-page content blocks where the obituary
   equivalents are described.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs(r5b): changelog + CLAUDE.md for birth notices / fresh spawns"
```

