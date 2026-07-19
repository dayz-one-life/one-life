# R5d PR-C3 — The News Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the public `/news` read-model, API and web surface for the R5d News vertical, retire the static News teaser, and repair two defects carried forward from PR-C1.

**Architecture:** A new `packages/read-models/src/news-articles.ts` mirrors the obituary pair (`getPublishedNews` / `getNewsArticleBySlug`) but orders by `created_at DESC` (a Standing Dead article has no death) and computes the §4.1.3 **live status line** at request time from `lives`/`sessions`/`articles`. Two Fastify routes are structural twins of `/obituaries`. The web surface is a mirror of `apps/web/src/app/obituaries/` — feed, interior, `loading.tsx`, `opengraph-image.tsx`, and a new `components/news/` — and is the **first surface in the repo to render `ArticleBody`'s blocks path in production**, because PR-C2's `parseNewsArticle` is the first writer to populate `articles.body_blocks`.

**Tech Stack:** TypeScript/ESM, pnpm + turbo monorepo, Postgres + Drizzle, Fastify, Next.js App Router (RSC), Zod, Vitest + @testing-library/react.

## Global Constraints

These apply to **every** task in this plan. They are not optional and are not restated per task.

- **SECURITY.** The tables `user`, `account`, `session`, `verification` hold Better Auth data including **real email addresses**. Never query them, never output their contents, never join to them. Gamertags are public and fine. Production DB dumps at the repo root are gitignored and must never be committed.
- **The Fog Rule reaches the rendered page, not just the facts object.** Spec §11 requires asserting no coordinate-shaped value appears in the *rendered interior*, over a fixture whose source rows do contain coordinates. A Standing Dead subject is a living player whose character stands unattended; the article must never imply where. This is discharged in **two halves, both mandatory**: Task 5 seeds real `positions` rows for the subject's life and asserts the read-model output carries no coordinate key and no coordinate-shaped value; Task 10 asserts the same over the rendered interior's DOM text. **Both halves must be given coordinate-BEARING input.** An assertion that nothing coordinate-shaped renders, over a fixture that never held a coordinate, cannot fail — that is the exact defect Task 1 exists to repair, and reproducing it in new code is worse than not writing it.
- **Read-models project named columns only** — never `SELECT payload` and never `SELECT *`. `events.payload` holds 5,633 coordinate rows.
- **Ordering is `created_at DESC`** for the news feed, never `death_at`. The `articles_kind_status_created_idx` added in migration `0014` serves it.
- **`ldScript()` is mandatory for JSON-LD.** LLM-authored headlines can contain `</script>`; raw `JSON.stringify` in `dangerouslySetInnerHTML` is a defect.
- **Retracted articles:** `noindex` the interior, absent from the feed, absent from "More From the Desk".
- **Follow the *birth* `showingLine` argument order:** `(page, total, pageSize)`. `obituaryShowingLine` is `(page, pageSize, total)`. All three args are `number`, so a wrong order compiles and renders plausible-but-wrong text.
- **Never print wall-clock as survival time.** Always `playtime_seconds` (`articles.time_alive_seconds`). Idle time is its own labelled field and is never presented as endurance.
- **Anchor every edit on quoted code, never a line number.** Where the same literal line appears twice in a file, extend the anchor until it is unique.

### Environment

- Test: `pnpm turbo run test --concurrency=1 --force`. Typecheck: `pnpm turbo run typecheck --force`. **Always `--force`** — the turbo cache key omits `TEST_DATABASE_URL`, so an unforced run can report a stale green.
- DB suites need `TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5434/onelife_test"`. Postgres is on port **5434**; **5432 is a different project's database**.
- `vitest` strips types via esbuild, so a red step expecting a *type* error will **not** fail under vitest — only under `typecheck`. No TDD step in this plan asks vitest to catch a type error.
- `packages/read-models/vitest.config.ts` and `apps/api/vitest.config.ts` set `fileParallelism: false`; `apps/web/vitest.config.ts` does **not** (its tests are jsdom-only and touch no database).
- BSD `sed` on macOS does not support `\b`. Use `Edit`/`Write`, not `sed`, for source changes.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `packages/read-models/src/news-articles.ts` | `getPublishedNews`, `getNewsArticleBySlug`, `getNewsSubjectStatus`, `newsTriggerOf`, DTO types |
| `packages/read-models/test/news-articles.test.ts` | Feed ordering/retraction + detail + status line + Fog rail (positions seeded) |
| `apps/api/src/routes/news.ts` | `GET /news`, `GET /news/:slug` |
| `apps/api/test/news.test.ts` | Route contract tests |
| `apps/web/src/lib/news-format.ts` | `newsHref`, `newsArticleHref`, `newsDateline`, `newsShowingLine`, `newsUpdateDate`, `newsDossierFacts`, `triggerLabel` |
| `apps/web/src/lib/news-format.test.ts` | Pure-format tests, incl. the `showingLine` arg-order pin |
| `apps/web/src/components/news/news-card.tsx` + `.test.tsx` | One feed row |
| `apps/web/src/components/news/news-pagination.tsx` + `.test.tsx` | Feed pager |
| `apps/web/src/components/news/more-from-the-desk.tsx` | Related rail |
| `apps/web/src/components/news/news-status-line.tsx` + `.test.tsx` | The §4.1.3 live status line |
| `apps/web/src/components/news/news-dossier.tsx` | Factual dossier strip |
| `apps/web/src/components/news/news-article.tsx` + `.test.tsx` | The interior view |
| `apps/web/src/app/news/[slug]/page.tsx` | Interior route + timeline fetch |
| `apps/web/src/app/news/[slug]/opengraph-image.tsx` | Dynamic OG card |
| `apps/web/src/app/news/[slug]/{oswald-700,plex-mono-400,plex-mono-700}.ttf` | OG fonts (copied) |
| `apps/web/src/app/news/loading.tsx` | Feed-segment skeleton |
| `apps/web/src/app/news/[slug]/loading.tsx` | Interior skeleton (`ArticleHeroSkeleton`) |

**Modified**

| File | Change |
|---|---|
| `apps/newsdesk/test/long-form-cluster.test.ts` | Replace the vacuous regex Fog rail |
| `apps/newsdesk/test/long-form-targets.test.ts` | Replace the vacuous regex Fog rail |
| `apps/newsdesk/test/standing-dead-targets.test.ts` | Replace the vacuous regex Fog rail |
| `apps/web/src/components/shared/article-hero.tsx` + `.test.tsx` | Widen `accent` to include `"ink"` |
| `apps/web/src/components/skeletons.tsx` | Correct the now-stale "no article kind renders a hero" comment |
| `packages/read-models/src/index.ts` | Export the new module |
| `apps/api/src/app.ts` | Register the news routes |
| `apps/web/src/lib/types.ts` | News DTOs |
| `apps/web/src/lib/api.ts` | `getNewsFeed`, `getNewsArticle` |
| `apps/web/src/lib/seo.ts` + `.test.ts` | `newsLd`, qualified when retracted |
| `apps/web/src/app/news/page.tsx` | Teaser → real feed (drops `robots: { index: false }`) |
| `CHANGELOG.md`, `CLAUDE.md` | Required by the committed guard before `gh pr create` |

**Deleted**

| File | Why |
|---|---|
| `apps/web/src/components/teaser-page.tsx` + `.test.tsx` | `/news` was its last consumer; all three teasers are now retired |

---

## Task 1: Repair the vacuous Fog-Rule rail in three PR-C1 test files

Three PR-C1 test files lean on `/\d{4}\.\d/` as their Fog Rule assertion. In `long-form-cluster.test.ts` and `long-form-targets.test.ts` it is the **sole** assertion; `standing-dead-targets.test.ts` adds two `Object.keys(rows[0] ?? {})` checks, but those inspect only the **top level** of each row, so a nested leak is invisible to them (Step 7 replaces all three assertions there). That regex returns `false` for a short coordinate like `812.4` (a real value near a map's low edge), so every one of these rails would pass vacuously on an actual leak. `long-form-targets.test.ts` is the important one — it guards the `LongFormSubject` boundary, which is exactly what spec §11 exists to protect. PR-C2 established the correct idiom (a recursive key-presence walk) in `apps/newsdesk/test/news-facts.test.ts`. Port it; keep the regex only as a documented cheap secondary signal.

**Files:**
- Modify: `apps/newsdesk/test/long-form-cluster.test.ts`
- Modify: `apps/newsdesk/test/long-form-targets.test.ts`
- Modify: `apps/newsdesk/test/standing-dead-targets.test.ts`

**Interfaces:**
- Consumes: nothing. First task, no dependencies.
- Produces: nothing consumed by later tasks. This task is independently revertable.

- [ ] **Step 1: Read the established idiom**

Read `apps/newsdesk/test/news-facts.test.ts` lines 1–40. It defines `COORDINATE_KEYS`, `collectKeys` and `assertNoCoordinateKeys`. You are porting those three declarations verbatim into each of the three files below. They are duplicated per-file on purpose — these are test-local helpers and the newsdesk test suite has no shared helper module.

- [ ] **Step 2: Add the walk to `long-form-cluster.test.ts`**

This file's existing assertion is:

```ts
  it("carries no coordinate-shaped number in the returned clusters", () => {
    const rows = [
      cand({ gamertag: "A", endedAt: at(0), x: 7423.51, y: 9210.88 }),
      cand({ gamertag: "B", endedAt: at(20), x: 7443.19, y: 9245.02 }),
    ];
    const out = buildLongFormClusters(rows, OPTS);
    expect(JSON.stringify(out)).not.toMatch(/\d{4}\.\d/);
  });
```

Replace it with:

```ts
  it("carries no coordinate key and no coordinate-shaped number in the returned clusters", () => {
    const rows = [
      // A high fix AND a low-edge fix: 812.4 is a real value near a map's edge and does NOT
      // match /\d{4}\.\d/, which is exactly why the key walk below is the primary rail.
      cand({ gamertag: "A", endedAt: at(0), x: 7423.51, y: 9210.88 }),
      cand({ gamertag: "B", endedAt: at(20), x: 812.4, y: 9245.02 }),
    ];
    const out = buildLongFormClusters(rows, OPTS);
    assertNoCoordinateKeys(out);
    // Cheap secondary signal only. It is NOT sufficient on its own (see the fixture comment).
    expect(JSON.stringify(out)).not.toMatch(/\d{4}\.\d/);
  });
```

- [ ] **Step 3: Add the three helper declarations to `long-form-cluster.test.ts`**

Insert them immediately after that file's import block, before the first `describe`. Read the file to find the last import line, and insert directly below it:

```ts
/** Key names that would carry a raw map coordinate if one leaked through. Ported from
 *  news-facts.test.ts — test-local by convention; the newsdesk suite has no shared helper module. */
const COORDINATE_KEYS = new Set(["x", "y", "posX", "posY", "coordX", "coordY", "lat", "lon"]);

/**
 * Recursively collects every object key at any depth, including inside arrays. Value-independent
 * by design: it proves the Fog Rule by SHAPE, not by pattern-matching a coordinate-looking number,
 * which is exactly what `/\d{4}\.\d/` fails to do near a map's low edge (e.g. "812.4").
 */
function collectKeys(value: unknown, keys: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (value !== null && typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      keys.add(key);
      collectKeys(val, keys);
    }
  }
  return keys;
}

function assertNoCoordinateKeys(value: unknown): void {
  const keys = collectKeys(value);
  for (const forbidden of COORDINATE_KEYS) {
    expect(keys.has(forbidden)).toBe(false);
  }
}
```

- [ ] **Step 4: Run the file — expect PASS**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5434/onelife_test" \
  pnpm --filter @onelife/newsdesk exec vitest run test/long-form-cluster.test.ts
```

Expected: PASS. `buildLongFormClusters` is already coordinate-free, so the strengthened rail is green — the point of this task is that it would now *catch* a regression, which the old regex would not.

- [ ] **Step 5: Prove the new rail actually bites**

Temporarily add `x: c.x` to the object literal returned by `strip` in `apps/newsdesk/src/long-form-cluster.ts` — the per-subject literal is `const strip = (c: DeathCandidate): LongFormSubject => ({ … })`, so the parameter is **`c`**. Re-run the command from Step 4 and confirm it now **FAILS** on `expect(keys.has("x")).toBe(false)`. Note that `x` is also an excess property on a `LongFormSubject`-annotated return and therefore a *type* error, but vitest strips types via esbuild, so it is the runtime key assertion that goes red — which is exactly what this step is demonstrating. Then revert that temporary edit with `git checkout -- apps/newsdesk/src/long-form-cluster.ts` and re-run to confirm PASS. Do not commit the temporary edit.

- [ ] **Step 6: Apply the same treatment to `long-form-targets.test.ts`**

Insert the same three helper declarations (`COORDINATE_KEYS`, `collectKeys`, `assertNoCoordinateKeys`, byte-identical to Step 3) after that file's import block. Then replace:

```ts
  it("returns a coordinate-free target — the fixture rows DO contain coordinates", async () => {
    const r = await findLongFormTargets(db, T_OPTS);
    expect(JSON.stringify(mineC(r))).not.toMatch(/\d{4}\.\d/);
  });
```

with:

```ts
  it("returns a coordinate-free target — the fixture rows DO contain coordinates", async () => {
    const r = await findLongFormTargets(db, T_OPTS);
    // THE §11 BOUNDARY ASSERTION. DeathCandidate carries x/y; LongFormSubject must not. The key
    // walk is the primary rail — the old sole assertion here was /\d{4}\.\d/, which returns false
    // for a low-edge coordinate like 812.4 and would therefore have passed on a real leak.
    assertNoCoordinateKeys(mineC(r));
    expect(JSON.stringify(mineC(r))).not.toMatch(/\d{4}\.\d/);   // cheap secondary signal only
  });
```

- [ ] **Step 7: Apply the same treatment to `standing-dead-targets.test.ts`**

Insert the same three helper declarations after that file's import block. Then replace:

```ts
  it("returns no coordinate-shaped number — a Standing Dead target carries no fix at all", async () => {
    const rows = await findStandingDeadTargets(db, OPTS);
    expect(JSON.stringify(rows)).not.toMatch(/\d{4}\.\d/);
    expect(Object.keys(rows[0] ?? {})).not.toContain("x");
    expect(Object.keys(rows[0] ?? {})).not.toContain("y");
  });
```

with:

```ts
  it("returns no coordinate key at any depth — a Standing Dead target carries no fix at all", async () => {
    const rows = await findStandingDeadTargets(db, OPTS);
    // The previous version checked Object.keys of the TOP LEVEL only, so a nested leak was
    // invisible; and its regex misses a low-edge coordinate like 812.4. Both are fixed here.
    assertNoCoordinateKeys(rows);
    expect(JSON.stringify(rows)).not.toMatch(/\d{4}\.\d/);   // cheap secondary signal only
  });
```

- [ ] **Step 8: Run all three files**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5434/onelife_test" \
  pnpm --filter @onelife/newsdesk run test
```

Expected: PASS, all newsdesk test files.

- [ ] **Step 9: Commit**

```bash
git add apps/newsdesk/test/long-form-cluster.test.ts apps/newsdesk/test/long-form-targets.test.ts apps/newsdesk/test/standing-dead-targets.test.ts
git commit -m "test(newsdesk): replace the vacuous coordinate regex rail with the key walk

/\\d{4}\\.\\d/ returns false for a low-edge coordinate like 812.4, so all three
PR-C1 Fog Rule assertions would have passed on a real leak. long-form-targets is
the load-bearing one: it guards the LongFormSubject boundary that spec 11 exists
to protect. The recursive key-presence walk from news-facts.test.ts is now the
primary rail in each; the regex is kept as a documented secondary signal."
```

---

## Task 2: Widen `ArticleHero`'s accent to include `"ink"`

Morgue is red, Nursery is blue, and yellow already means beef (spec §7). Ink lets the photograph carry the page, which is what a feature wants. `ink` is an existing brand token in `apps/web/tailwind.config.ts` (`ink: v("ink")`), so `border-ink` needs no new token.

**Files:**
- Modify: `apps/web/src/components/shared/article-hero.tsx`
- Modify: `apps/web/src/components/shared/article-hero.test.tsx`
- Modify: `apps/web/src/components/skeletons.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `ArticleHero({ src: string; caption: string | null; accent: "red" | "blue" | "ink" })`. Task 10 renders it with `accent="ink"`.

- [ ] **Step 1: Write the failing test**

Append this to `apps/web/src/components/shared/article-hero.test.tsx`, inside the existing `describe("ArticleHero", …)` block — insert it immediately before the block's closing `});`, after the existing `renders without a caption line when caption is null` test:

```tsx
  it("renders the ink accent on the caption rule", () => {
    render(<ArticleHero src="/media/heroes/x.png" caption="A ROOM, RECENTLY LEFT" accent="ink" />);
    expect(screen.getByText("A ROOM, RECENTLY LEFT")).toHaveClass("border-ink");
  });
```

- [ ] **Step 2: Run it — expect FAIL**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
pnpm --filter @onelife/web exec vitest run src/components/shared/article-hero.test.tsx
```

Expected: FAIL — the rendered `figcaption` carries `border-blue` (the current ternary's else-branch), not `border-ink`.

Note: the `accent="ink"` prop is also a *type* error today, but vitest strips types via esbuild and will not report it. The runtime class assertion above is what makes this step red.

- [ ] **Step 3: Widen the component**

Replace the whole of `apps/web/src/components/shared/article-hero.tsx` with:

```tsx
import Image from "next/image";

/** Caption-rule accent per desk. Literal class strings (not interpolated) so Tailwind's JIT
 *  scanner sees them — the same idiom as the Kicker component's `colors` map.
 *  Morgue = red, Nursery = blue, Newsroom = ink: yellow already means beef, and on a news
 *  feature the photograph should carry the page rather than compete with a coloured rule. */
const ACCENT_BORDER = { red: "border-red", blue: "border-blue", ink: "border-ink" } as const;

export type ArticleHeroAccent = keyof typeof ACCENT_BORDER;

/** The generated tabloid photo atop an article interior. 4:5 render-side crop of the (square)
 *  source; next/image handles resizing/webp. alt is empty by convention — the visible caption is
 *  the accessible text. As of R5d PR-C3 the only kind that renders one is `news`. */
export function ArticleHero({ src, caption, accent }: {
  src: string;
  caption: string | null;
  accent: ArticleHeroAccent;
}) {
  return (
    <figure className="my-6">
      <div className="relative aspect-[4/5] w-full max-w-md overflow-hidden border border-hairline">
        <Image src={src} alt="" fill sizes="(min-width: 768px) 448px, 100vw" className="object-cover" />
      </div>
      {caption ? (
        <figcaption className={`mt-2 border-l-[3px] pl-2 font-mono text-[11px] uppercase tracking-[.14em] text-ink-muted ${ACCENT_BORDER[accent]}`}>
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
```

- [ ] **Step 4: Run the test — expect PASS**

```bash
pnpm --filter @onelife/web exec vitest run src/components/shared/article-hero.test.tsx
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Correct the now-stale skeleton comment**

`ArticleHeroSkeleton` is the component's only other reference. It needs no code change — it takes no `accent`. Its doc comment is now wrong. In `apps/web/src/components/skeletons.tsx`, replace:

```tsx
/** Placeholder for the generated tabloid photo atop an article interior, before it (or its
 *  absence) is known — mirrors ArticleHero's 4:5 max-w-md frame. Retained for future news/
 *  editorial interiors; currently unused (no article kind renders a hero image). */
```

with:

```tsx
/** Placeholder for the generated tabloid photo atop an article interior, before it (or its
 *  absence) is known — mirrors ArticleHero's 4:5 max-w-md frame. Since R5d PR-C3 the `news`
 *  kind is the only one that renders a hero image (obituaries/birth notices lost theirs in
 *  v0.21.0), so this is the news interior's placeholder: it is rendered by
 *  apps/web/src/app/news/[slug]/loading.tsx. */
```

That file is created in Task 11, Step 3. Until it exists this comment is a forward reference — do not stop at Task 2 and leave it unwired, or the step has merely swapped one stale comment for another.

- [ ] **Step 6: Typecheck and commit**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
pnpm --filter @onelife/web run typecheck
git add apps/web/src/components/shared/article-hero.tsx apps/web/src/components/shared/article-hero.test.tsx apps/web/src/components/skeletons.tsx
git commit -m "feat(web): widen ArticleHero accent to include ink for the newsroom

Morgue is red, Nursery is blue, yellow already means beef. Ink lets the
photograph carry a news feature. The ternary becomes a literal-class Record so
Tailwind's JIT still sees every class name."
```

---

## Task 3: The news feed read-model

`getPublishedNews`, ordered `created_at DESC` (a Standing Dead article has no death), excluding `retracted` and `failed`.

**Files:**
- Create: `packages/read-models/src/news-articles.ts`
- Create: `packages/read-models/test/news-articles.test.ts`
- Modify: `packages/read-models/src/index.ts`

**Interfaces:**
- Consumes: `ArticleBlock` from `./obituary-articles.js` (the single declaration; the barrel is `export *`, so it must not be redeclared).
- Produces:
  - `NEWS_FEED_PAGE_SIZE = 20`
  - `type NewsTrigger = "standing_dead" | "long_form"`
  - `newsTriggerOf(naturalKey: string | null): NewsTrigger`
  - `interface NewsCard { slug, trigger, gamertag, map, mapSlug, lifeNumber, headline, lede, tags, subjectCount, createdAt }`
  - `interface NewsFeed { rows: NewsCard[]; total: number; page: number; pageSize: number }`
  - `getPublishedNews(db, opts: { page: number; pageSize?: number }): Promise<NewsFeed>`

- [ ] **Step 1: Write the failing test**

Create `packages/read-models/test/news-articles.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, articles } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getPublishedNews } from "../src/news-articles.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 53e7;
const t0 = new Date("2026-07-12T00:00:00Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);
let serverId: number;

const tag = `na-${svc}`;

// `articles` no longer FKs to players/lives, so news rows can be seeded directly against a
// server. News dedupes on natural_key (partial-unique WHERE NOT NULL), NOT on the life tuple,
// so every seeded row needs a distinct natural_key.
const base = (over: Partial<typeof articles.$inferInsert>): typeof articles.$inferInsert =>
  ({
    kind: "news", serverId, gamertag: tag, map: "chernarusplus", mapSlug: `na-${svc}`,
    lifeNumber: 1, lifeStartedAt: hrs(0), headline: "H", lede: "L", body: "B",
    promptVersion: "news-v1", model: "test", attempts: 1, ...over,
  }) as typeof articles.$inferInsert;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({
    nitradoServiceId: svc, name: "na", map: "chernarusplus", slug: `na-${svc}`, active: true,
  }).returning();
  serverId = s!.id;

  await db.insert(articles).values([
    base({
      status: "published", slug: `sd-old-${svc}`, naturalKey: `standing_dead:${serverId}:${tag}:${hrs(0).toISOString()}`,
      headline: "The Man Who Did Not Come Back", lede: "sd-lede", tags: ["News", "Chernarus", "The Standing Dead"],
      createdAt: hrs(1), facts: { trigger: "standing_dead", subjectCount: 1 },
    }),
    base({
      status: "published", slug: `lf-new-${svc}`, naturalKey: `long_form:${serverId}:${hrs(3).toISOString()}:Ay+Zed`,
      headline: "Two Went Out Together", lede: "lf-lede", tags: ["News", "Chernarus", "The Long Form"],
      createdAt: hrs(4), deathAt: hrs(3), facts: { trigger: "long_form", subjectCount: 2 },
    }),
    base({
      status: "retracted", slug: `sd-retracted-${svc}`, naturalKey: `standing_dead:${serverId}:${tag}:${hrs(6).toISOString()}`,
      headline: "He Came Back", lede: "r-lede", createdAt: hrs(7), facts: { trigger: "standing_dead", subjectCount: 1 },
    }),
    base({
      status: "failed", slug: null, naturalKey: `standing_dead:${serverId}:${tag}:${hrs(9).toISOString()}`,
      headline: null, lede: null, body: null, attempts: 3, lastError: "boom", createdAt: hrs(9),
    }),
  ]);
});

afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

const mine = (rows: { gamertag: string }[]) => rows.filter((r) => r.gamertag === tag);

describe("getPublishedNews", () => {
  it("returns published news newest-CREATED first — not by death_at, which a Standing Dead row lacks", async () => {
    const res = await getPublishedNews(db, { page: 1, pageSize: 100 });
    expect(mine(res.rows).map((r) => r.headline)).toEqual([
      "Two Went Out Together",
      "The Man Who Did Not Come Back",
    ]);
  });

  it("excludes retracted and failed rows from the feed", async () => {
    const res = await getPublishedNews(db, { page: 1, pageSize: 100 });
    const heads = mine(res.rows).map((r) => r.headline);
    expect(heads).not.toContain("He Came Back");
    expect(mine(res.rows).every((r) => typeof r.slug === "string")).toBe(true);
  });

  it("derives the trigger from the natural_key prefix", async () => {
    const res = await getPublishedNews(db, { page: 1, pageSize: 100 });
    const byHead = new Map(mine(res.rows).map((r) => [r.headline, r]));
    expect(byHead.get("The Man Who Did Not Come Back")!.trigger).toBe("standing_dead");
    expect(byHead.get("Two Went Out Together")!.trigger).toBe("long_form");
  });

  it("reads subjectCount from facts, defaulting to 1", async () => {
    const res = await getPublishedNews(db, { page: 1, pageSize: 100 });
    const byHead = new Map(mine(res.rows).map((r) => [r.headline, r]));
    expect(byHead.get("Two Went Out Together")!.subjectCount).toBe(2);
    expect(byHead.get("The Man Who Did Not Come Back")!.subjectCount).toBe(1);
  });

  it("paginates", async () => {
    const res = await getPublishedNews(db, { page: 1, pageSize: 1 });
    expect(res.pageSize).toBe(1);
    expect(res.rows).toHaveLength(1);
    expect(res.total).toBeGreaterThanOrEqual(2);
  });

  it("defaults pageSize to NEWS_FEED_PAGE_SIZE and clamps a junk page to 1", async () => {
    const res = await getPublishedNews(db, { page: -4 });
    expect(res.page).toBe(1);
    expect(res.pageSize).toBe(20);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5434/onelife_test" \
  pnpm --filter @onelife/read-models exec vitest run test/news-articles.test.ts
```

Expected: FAIL — `Cannot find module '../src/news-articles.js'`.

- [ ] **Step 3: Create the read-model**

Create `packages/read-models/src/news-articles.ts`:

```ts
import type { Database } from "@onelife/db";
import { articles } from "@onelife/db";
import { and, desc, eq, sql } from "drizzle-orm";

export const NEWS_FEED_PAGE_SIZE = 20;

export type NewsTrigger = "standing_dead" | "long_form";

/**
 * The trigger comes from the natural_key PREFIX, which is produced by exactly one function per
 * trigger (standingDeadNaturalKey / longFormNaturalKey) and is rebuild-stable. `facts.trigger`
 * carries the same information, but having two sources means they can disagree after a schema
 * change; the newsdesk's own retraction sweep already reads the prefix
 * (`starts_with(natural_key, 'standing_dead:')`), so the page and the sweep now agree by
 * construction. A published news row always has a natural_key — both the publish path and the
 * failure-stub path write it — so the fallback below is unreachable in practice, and long_form is
 * the safe default because it turns off the Standing-Dead-only status line rather than turning it
 * on for a subject who has no idle figure.
 */
export function newsTriggerOf(naturalKey: string | null): NewsTrigger {
  return naturalKey?.startsWith("standing_dead:") ? "standing_dead" : "long_form";
}

export interface NewsCard {
  slug: string;
  trigger: NewsTrigger;
  gamertag: string;          // the PRIMARY subject; co-subjects live in the detail's `subjects`
  map: string;
  mapSlug: string | null;
  lifeNumber: number;
  headline: string;
  lede: string;
  tags: string[];
  subjectCount: number;
  createdAt: Date;
}

export interface NewsFeed {
  rows: NewsCard[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * The subset of `articles.facts` this module reads. NewsFacts is much wider, but a read-model must
 * project what it needs and nothing else — and nothing here is coordinate-shaped, because
 * NewsFacts carries no coordinate at any depth (spec §11, asserted in news-facts.test.ts).
 */
type NewsFactsSnapshot = {
  subjectCount?: number;
  idleSeconds?: number | null;
  spanSeconds?: number | null;
  subjects?: { gamertag?: string; mapSlug?: string | null; lifeNumber?: number }[];
};

// NAMED COLUMNS ONLY. Never `SELECT *` and never `events.payload` — that column holds 5,633
// coordinate rows and a Standing Dead subject is alive and can be hunted.
const CARD_COLS = {
  slug: articles.slug,
  naturalKey: articles.naturalKey,
  gamertag: articles.gamertag,
  map: articles.map,
  mapSlug: articles.mapSlug,
  lifeNumber: articles.lifeNumber,
  headline: articles.headline,
  lede: articles.lede,
  tags: articles.tags,
  facts: articles.facts,
  createdAt: articles.createdAt,
} as const;

const publishedNews = and(eq(articles.kind, "news"), eq(articles.status, "published"));

function cardOf(r: {
  slug: string | null; naturalKey: string | null; gamertag: string; map: string;
  mapSlug: string | null; lifeNumber: number; headline: string | null; lede: string | null;
  tags: string[] | null; facts: unknown; createdAt: Date;
}): NewsCard {
  const facts = (r.facts ?? {}) as NewsFactsSnapshot;
  return {
    slug: r.slug!,
    trigger: newsTriggerOf(r.naturalKey),
    gamertag: r.gamertag,
    map: r.map,
    mapSlug: r.mapSlug,
    lifeNumber: r.lifeNumber,
    headline: r.headline!,
    lede: r.lede!,
    tags: r.tags ?? [],
    subjectCount: facts.subjectCount ?? 1,
    createdAt: r.createdAt,
  };
}

/**
 * Published news features, newest FIRST BY created_at — not by death_at. A Standing Dead article
 * has no death and its death_at is NULL, so a death-ordered feed would sort every Standing Dead
 * piece to one end regardless of when it was filed. Served by articles_kind_status_created_idx
 * (migration 0014).
 *
 * `retracted` rows are excluded here and nowhere else needs to repeat that: the feed is also the
 * source for "More From the Desk". Failed stubs are excluded by the same predicate.
 */
export async function getPublishedNews(
  db: Database,
  opts: { page: number; pageSize?: number },
): Promise<NewsFeed> {
  const pageSize = opts.pageSize ?? NEWS_FEED_PAGE_SIZE;
  const page = Math.max(1, Math.trunc(opts.page) || 1);

  const rows = await db
    .select(CARD_COLS)
    .from(articles)
    .where(publishedNews)
    .orderBy(desc(articles.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const totalRow = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(articles)
    .where(publishedNews);

  return {
    rows: rows.map(cardOf),
    total: totalRow[0]?.c ?? 0,
    page,
    pageSize,
  };
}
```

- [ ] **Step 4: Export it from the barrel**

In `packages/read-models/src/index.ts`, replace:

```ts
export * from "./birth-notice-articles.js";
export * from "./life-dossier.js";
```

with:

```ts
export * from "./birth-notice-articles.js";
export * from "./news-articles.js";
export * from "./life-dossier.js";
```

- [ ] **Step 5: Run the test — expect PASS**

```bash
TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5434/onelife_test" \
  pnpm --filter @onelife/read-models exec vitest run test/news-articles.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Typecheck and commit**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
pnpm --filter @onelife/read-models run typecheck
git add packages/read-models/src/news-articles.ts packages/read-models/test/news-articles.test.ts packages/read-models/src/index.ts
git commit -m "feat(read-models): getPublishedNews, ordered created_at DESC

A Standing Dead article has no death, so death_at ordering would bucket every
one of them to a single end of the feed. Retracted and failed rows are excluded;
the trigger is derived from the natural_key prefix, matching the newsdesk
retraction sweep so the page and the sweep can never disagree."
```

---

## Task 4: The news interior read-model

`getNewsArticleBySlug` — the by-slug detail, including `body_blocks` (news is the **first kind to populate it**), the hero image fields, the `retracted` flag, and the co-subject refs.

**Files:**
- Modify: `packages/read-models/src/news-articles.ts` (append + one import edit)
- Modify: `packages/read-models/test/news-articles.test.ts` (append + one import edit)

**Interfaces:**
- Consumes: from Task 3 — `NewsCard`, `NewsFactsSnapshot`, `CARD_COLS`, `newsTriggerOf`, `cardOf`.
- Produces:
  - `interface NewsSubjectRef { gamertag: string; mapSlug: string | null; lifeNumber: number }`
  - `interface NewsArticleDetail extends NewsCard { body, bodyBlocks, pullQuote, imageUrl, imageCaption, retracted, timeAliveSeconds, kills, idleSeconds, spanSeconds, subjects, subjectStatus }`
  - `getNewsArticleBySlug(db, slug: string): Promise<NewsArticleDetail | null>`
  - `subjectStatus` is typed `NewsSubjectStatus | null` and is populated in **Task 5**; this task returns `null` for it unconditionally.

- [ ] **Step 1: Write the failing tests**

In `packages/read-models/test/news-articles.test.ts`, first widen the import. Replace:

```ts
import { getPublishedNews } from "../src/news-articles.js";
```

with:

```ts
import { getPublishedNews, getNewsArticleBySlug } from "../src/news-articles.js";
```

Then append the following at the **end of the file**, after the closing `});` of the `describe("getPublishedNews", …)` block. It seeds its own rows in a nested `beforeAll`, so it does not touch Task 3's fixture:

```ts
describe("getNewsArticleBySlug", () => {
  beforeAll(async () => {
    await db.insert(articles).values([
      base({
        status: "published", slug: `detail-${svc}`,
        naturalKey: `standing_dead:${serverId}:${tag}:${hrs(20).toISOString()}`,
        headline: "Still Standing, Somewhere", lede: "d-lede", body: "Para one.\n\nPara two.",
        // NEWS IS THE FIRST KIND TO POPULATE body_blocks. Every live interior before this took
        // the flat fallback, so this row is the first exercise of ArticleBody's blocks path.
        bodyBlocks: [
          { type: "para", text: "Para one." },
          { type: "subhead", text: "The Long Middle" },
          { type: "para", text: "Para two." },
        ],
        pullQuoteText: "He was here on Tuesday.", pullQuoteAttribution: "a quartermaster",
        tags: ["News", "Chernarus", "The Standing Dead"],
        timeAliveSeconds: 5600, kills: 0, createdAt: hrs(21),
        imageUrl: "/media/heroes/detail.png", imageCaption: "A ROOM, RECENTLY LEFT",
        facts: {
          trigger: "standing_dead", subjectCount: 1, idleSeconds: 259200, spanSeconds: null,
          subjects: [{ gamertag: tag, mapSlug: `na-${svc}`, lifeNumber: 1 }],
        },
      }),
      base({
        status: "published", slug: `detail-lf-${svc}`,
        naturalKey: `long_form:${serverId}:${hrs(24).toISOString()}:Ay+Zed`,
        headline: "They Went Out Inside A Minute", lede: "lf-d-lede", body: "Flat only.",
        tags: ["News"], timeAliveSeconds: 6660, kills: 1, createdAt: hrs(25), deathAt: hrs(24),
        facts: {
          trigger: "long_form", subjectCount: 2, idleSeconds: null, spanSeconds: 27,
          subjects: [
            { gamertag: "Ay", mapSlug: `na-${svc}`, lifeNumber: 1 },
            { gamertag: "Zed", mapSlug: null, lifeNumber: 3 },
          ],
        },
      }),
      base({
        status: "retracted", slug: `detail-retracted-${svc}`,
        naturalKey: `standing_dead:${serverId}:${tag}:${hrs(30).toISOString()}`,
        headline: "He Came Back After All", lede: "r-d-lede", body: "B", createdAt: hrs(31),
        imageUrl: "/media/heroes/detail-retracted.png", imageCaption: "SHOULD NOT SHIP",
        facts: { trigger: "standing_dead", subjectCount: 1 },
      }),
    ]);
  });

  it("returns the full article with the rich body blocks", async () => {
    const a = await getNewsArticleBySlug(db, `detail-${svc}`);
    expect(a).not.toBeNull();
    expect(a!.headline).toBe("Still Standing, Somewhere");
    expect(a!.body).toBe("Para one.\n\nPara two.");
    expect(a!.bodyBlocks).toEqual([
      { type: "para", text: "Para one." },
      { type: "subhead", text: "The Long Middle" },
      { type: "para", text: "Para two." },
    ]);
    expect(a!.pullQuote).toEqual({ text: "He was here on Tuesday.", attribution: "a quartermaster" });
    expect(a!.imageUrl).toBe("/media/heroes/detail.png");
    expect(a!.imageCaption).toBe("A ROOM, RECENTLY LEFT");
    expect(a!.retracted).toBe(false);
  });

  it("returns null bodyBlocks when the column is unset", async () => {
    const a = await getNewsArticleBySlug(db, `detail-lf-${svc}`);
    expect(a!.bodyBlocks).toBeNull();
    expect(a!.body).toBe("Flat only.");
  });

  it("carries the factual dossier figures, with the trigger-specific ones nulled out", async () => {
    const sd = await getNewsArticleBySlug(db, `detail-${svc}`);
    expect(sd!.timeAliveSeconds).toBe(5600);
    expect(sd!.kills).toBe(0);
    expect(sd!.idleSeconds).toBe(259200);
    expect(sd!.spanSeconds).toBeNull();

    const lf = await getNewsArticleBySlug(db, `detail-lf-${svc}`);
    expect(lf!.idleSeconds).toBeNull();
    expect(lf!.spanSeconds).toBe(27);
  });

  it("returns the co-subject refs for a Long Form piece, preserving a null mapSlug", async () => {
    const lf = await getNewsArticleBySlug(db, `detail-lf-${svc}`);
    expect(lf!.subjects).toEqual([
      { gamertag: "Ay", mapSlug: `na-${svc}`, lifeNumber: 1 },
      { gamertag: "Zed", mapSlug: null, lifeNumber: 3 },
    ]);
  });

  it("falls back to a single self-subject when facts carry no subjects array", async () => {
    const r = await getNewsArticleBySlug(db, `detail-retracted-${svc}`);
    expect(r!.subjects).toEqual([{ gamertag: tag, mapSlug: `na-${svc}`, lifeNumber: 1 }]);
  });

  it("RESOLVES a retracted article and flags it, so the interior can noindex rather than 404", async () => {
    const r = await getNewsArticleBySlug(db, `detail-retracted-${svc}`);
    expect(r).not.toBeNull();
    expect(r!.retracted).toBe(true);
  });

  // Named for what it actually asserts. A `failed` stub carries `slug: null`, so it is unreachable
  // by a by-slug lookup and cannot be pinned here; its exclusion is covered feed-side by Task 3's
  // `expect(mine(res.rows).every((r) => typeof r.slug === "string")).toBe(true)`.
  it("returns null for an unknown slug", async () => {
    expect(await getNewsArticleBySlug(db, "no-such-news-slug")).toBeNull();
  });

  it("never resolves an obituary or a birth notice through the news route", async () => {
    await db.insert(articles).values(base({
      kind: "obituary", status: "published", slug: `not-news-${svc}`,
      lifeStartedAt: hrs(40), deathAt: hrs(41), headline: "Not News", lede: "x", naturalKey: null,
    }));
    expect(await getNewsArticleBySlug(db, `not-news-${svc}`)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5434/onelife_test" \
  pnpm --filter @onelife/read-models exec vitest run test/news-articles.test.ts
```

Expected: FAIL — `getNewsArticleBySlug is not a function` (esbuild strips the type-only import failure; the runtime call is what breaks).

- [ ] **Step 3: Widen the imports in the read-model**

In `packages/read-models/src/news-articles.ts`, replace:

```ts
import type { Database } from "@onelife/db";
import { articles } from "@onelife/db";
import { and, desc, eq, sql } from "drizzle-orm";
```

with:

```ts
import type { Database } from "@onelife/db";
import { articles } from "@onelife/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { ArticleBlock } from "./obituary-articles.js";
```

`ArticleBlock` is declared once, in `obituary-articles.ts`. `index.ts` is a barrel of `export *`, so redeclaring it here would collide.

- [ ] **Step 4: Append the detail read-model**

Append to the **end** of `packages/read-models/src/news-articles.ts`, after the closing `}` of `getPublishedNews`:

```ts

/** One person in a news feature, as the web surface needs them: enough to build a life-timeline
 *  URL and nothing more. No row ids (they do not survive a projector rebuild) and no coordinates. */
export interface NewsSubjectRef {
  gamertag: string;
  mapSlug: string | null;
  lifeNumber: number;
}

/**
 * The §4.1.3 status line, computed at REQUEST time and never regenerated prose. Populated by
 * getNewsSubjectStatus for a Standing Dead article only; a Long Form subject is dead and the
 * question does not arise.
 */
export type NewsSubjectStatus =
  | { kind: "idle"; idleDaysAtPublication: number }
  | { kind: "returned"; seenAt: Date }
  | { kind: "died"; diedAt: Date; obituarySlug: string | null };

export interface NewsArticleDetail extends NewsCard {
  body: string;
  /** R5d rich body. News is the FIRST kind whose writer populates articles.body_blocks — every
   *  live interior before this took ArticleBody's flat fallback. Selected AND cast here; a
   *  missing select would yield `undefined` and silently take the fallback forever. */
  bodyBlocks: ArticleBlock[] | null;
  pullQuote: { text: string; attribution: string } | null;
  imageUrl: string | null;
  imageCaption: string | null;
  /** True when the subject came back and the newsdesk de-published the piece. The row still
   *  RESOLVES — retraction removes it from discovery (feed, related rail, search index), not from
   *  its URL — so the interior can render a truthful correction instead of a 404. */
  retracted: boolean;
  timeAliveSeconds: number;      // playtime_seconds of the primary. NEVER wall clock.
  kills: number;
  idleSeconds: number | null;    // Standing Dead only. The length of an ABSENCE, not of a life.
  spanSeconds: number | null;    // Long Form only. TIME between first and last death — never a distance.
  subjects: NewsSubjectRef[];
  subjectStatus: NewsSubjectStatus | null;
}

// A news interior resolves for BOTH statuses. `failed` is excluded (its slug is NULL anyway) and
// so is every other kind — an obituary slug must not resolve through the news route.
const readableNews = inArray(articles.status, ["published", "retracted"]);

/** A single news feature by slug, or null (unknown slug, failed stub, or another kind). */
export async function getNewsArticleBySlug(
  db: Database,
  slug: string,
): Promise<NewsArticleDetail | null> {
  const rows = await db
    .select({
      ...CARD_COLS,
      status: articles.status,
      body: articles.body,
      bodyBlocks: articles.bodyBlocks,
      pullQuoteText: articles.pullQuoteText,
      pullQuoteAttribution: articles.pullQuoteAttribution,
      imageUrl: articles.imageUrl,
      imageCaption: articles.imageCaption,
      timeAliveSeconds: articles.timeAliveSeconds,
      kills: articles.kills,
    })
    .from(articles)
    .where(and(eq(articles.kind, "news"), readableNews, eq(articles.slug, slug)))
    .limit(1);

  const r = rows[0];
  if (!r) return null;

  const card = cardOf(r);
  const facts = (r.facts ?? {}) as NewsFactsSnapshot;

  // A Standing Dead article has exactly one subject and its facts always carry it; the fallback
  // reconstructs a self-subject from the row's own identity columns so an older or malformed
  // facts blob degrades to a working timeline link rather than an empty interior.
  const subjects: NewsSubjectRef[] = (facts.subjects ?? [])
    .filter((s): s is { gamertag: string; mapSlug?: string | null; lifeNumber?: number } =>
      typeof s?.gamertag === "string")
    .map((s) => ({
      gamertag: s.gamertag,
      mapSlug: s.mapSlug ?? null,
      lifeNumber: s.lifeNumber ?? card.lifeNumber,
    }));

  return {
    ...card,
    body: r.body ?? "",
    bodyBlocks: (r.bodyBlocks as ArticleBlock[] | null) ?? null,
    pullQuote: r.pullQuoteText
      ? { text: r.pullQuoteText, attribution: r.pullQuoteAttribution ?? "" }
      : null,
    imageUrl: r.imageUrl,
    imageCaption: r.imageCaption,
    retracted: r.status === "retracted",
    timeAliveSeconds: r.timeAliveSeconds,
    kills: r.kills,
    idleSeconds: facts.idleSeconds ?? null,
    spanSeconds: facts.spanSeconds ?? null,
    subjects: subjects.length > 0
      ? subjects
      : [{ gamertag: card.gamertag, mapSlug: card.mapSlug, lifeNumber: card.lifeNumber }],
    // Populated in the next task; a Long Form article keeps it null permanently.
    subjectStatus: null,
  };
}
```

- [ ] **Step 5: Run the test — expect PASS**

```bash
TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5434/onelife_test" \
  pnpm --filter @onelife/read-models exec vitest run test/news-articles.test.ts
```

Expected: PASS, 14 tests.

- [ ] **Step 6: Typecheck and commit**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
pnpm --filter @onelife/read-models run typecheck
git add packages/read-models/src/news-articles.ts packages/read-models/test/news-articles.test.ts
git commit -m "feat(read-models): getNewsArticleBySlug with the rich body path

News is the first kind whose writer populates articles.body_blocks, so this is
the select-and-cast that makes ArticleBody's blocks path live. A retracted
article still resolves and is flagged, so the interior noindexes and corrects
itself rather than 404ing."
```

---

## Task 5: The live status line (spec §4.1.3) and the Fog rail

The Standing Dead article is the only thing the paper prints that its subject can falsify by acting. The prose is frozen; the status line is computed at request time in three branches — still idle, returned, or died since.

**Files:**
- Modify: `packages/read-models/src/news-articles.ts` (append + one import edit)
- Modify: `packages/read-models/test/news-articles.test.ts` (append + one import edit)

**Interfaces:**
- Consumes: from Task 4 — `NewsSubjectStatus`, `NewsArticleDetail`, `getNewsArticleBySlug`.
- Produces: `getNewsSubjectStatus(db, args: { serverId: number; gamertag: string; lifeStartedAt: Date; createdAt: Date; idleSecondsAtPublication: number | null }): Promise<NewsSubjectStatus>`, and `getNewsArticleBySlug` now returns a non-null `subjectStatus` for a Standing Dead article.

- [ ] **Step 1: Write the failing tests**

In `packages/read-models/test/news-articles.test.ts`, widen the drizzle-table import. Replace:

```ts
import { servers, articles } from "@onelife/db";
```

with:

```ts
import { servers, articles, players, lives, sessions, positions } from "@onelife/db";
```

Then append this at the **end of the file**, after the closing `});` of the `describe("getNewsArticleBySlug", …)` block:

```ts
describe("getNewsSubjectStatus (the §4.1.3 live status line)", () => {
  // Three real subjects on real projections: one still gone, one who came back, one who died.
  // Their lives carry REAL `positions` rows — the §11 rail is only meaningful over source data
  // that actually contains coordinates.
  const IDLE = `sub-idle-${svc}`;
  const BACK = `sub-back-${svc}`;
  const DEAD = `sub-dead-${svc}`;
  const born = hrs(50);
  const published = hrs(60);

  const seedSubject = async (gamertag: string, opts: { endedAt: Date | null; lastConnectAt: Date }) => {
    const [p] = await db.insert(players).values({ gamertag }).returning();
    const [l] = await db.insert(lives).values({
      serverId, playerId: p!.id, lifeNumber: 1, startedAt: born,
      endedAt: opts.endedAt, playtimeSeconds: 5600,
    }).returning();
    await db.insert(sessions).values({
      serverId, playerId: p!.id, lifeId: l!.id,
      connectedAt: opts.lastConnectAt, disconnectedAt: null,
    });
    // Coordinates DO exist for this subject. Nothing the read-model returns may carry them.
    // `positions` is (serverId, playerId, gamertag, x, y, recordedAt) — there is no z column.
    await db.insert(positions).values({
      serverId, playerId: p!.id, gamertag, recordedAt: opts.lastConnectAt, x: 7423.51, y: 812.4,
    });
    await db.insert(articles).values(base({
      status: "published", slug: `status-${gamertag}`,
      naturalKey: `standing_dead:${serverId}:${gamertag}:${born.toISOString()}`,
      // `new Date(born.toISOString())`, NOT `born`. In production this value travels
      // Date → toISOString() → new Date() through IDENTITY in apps/newsdesk/src/news-pg-store.ts,
      // i.e. truncated to millisecond precision, while lives.started_at is timestamptz
      // (microsecond). getNewsSubjectStatus joins on exact equality, so inserting the SAME Date
      // object into both tables would make the join hold trivially and the fixture could never
      // detect a precision mismatch — which would not throw, it would fall into the "missing life
      // row" branch and silently pin every Standing Dead interior to `idle` forever.
      gamertag, lifeStartedAt: new Date(born.toISOString()),
      headline: `Status ${gamertag}`, lede: "s-lede",
      body: "B", createdAt: published, timeAliveSeconds: 5600, kills: 0,
      facts: {
        trigger: "standing_dead", subjectCount: 1, idleSeconds: 259200,
        subjects: [{ gamertag, mapSlug: `na-${svc}`, lifeNumber: 1 }],
      },
    }));
    return l!.id;
  };

  beforeAll(async () => {
    // Idle: last connect BEFORE publication, life still open.
    await seedSubject(IDLE, { endedAt: null, lastConnectAt: hrs(52) });
    // Returned: a session that CONNECTED after publication, life still open.
    await seedSubject(BACK, { endedAt: null, lastConnectAt: hrs(70) });
    // Died: the life closed after publication.
    await seedSubject(DEAD, { endedAt: hrs(75), lastConnectAt: hrs(72) });
    // …and the morgue desk filed for them.
    await db.insert(articles).values(base({
      kind: "obituary", status: "published", slug: `obit-for-${DEAD}`, naturalKey: null,
      gamertag: DEAD, lifeStartedAt: born, deathAt: hrs(75),
      headline: "He Did Not Outlast The Correction", lede: "o-lede", body: "B", createdAt: hrs(76),
    }));
  });

  afterAll(async () => {
    for (const g of [IDLE, BACK, DEAD]) {
      await db.delete(sessions).where(eq(sessions.serverId, serverId));
      await db.delete(positions).where(eq(positions.serverId, serverId));
      await db.delete(lives).where(eq(lives.serverId, serverId));
      await db.delete(players).where(eq(players.gamertag, g));
    }
  });

  it("still idle → the frozen idle figure, in whole days, as of publication", async () => {
    const a = await getNewsArticleBySlug(db, `status-${IDLE}`);
    expect(a!.subjectStatus).toEqual({ kind: "idle", idleDaysAtPublication: 3 });
  });

  it("returned → the connect instant of the session that falsified the piece", async () => {
    const a = await getNewsArticleBySlug(db, `status-${BACK}`);
    expect(a!.subjectStatus).toMatchObject({ kind: "returned" });
    expect((a!.subjectStatus as { seenAt: Date }).seenAt.toISOString()).toBe(hrs(70).toISOString());
  });

  it("died since → the death instant and the obituary slug, death outranking the return", async () => {
    const a = await getNewsArticleBySlug(db, `status-${DEAD}`);
    expect(a!.subjectStatus).toEqual({
      kind: "died", diedAt: hrs(75), obituarySlug: `obit-for-${DEAD}`,
    });
  });

  it("a Long Form article never carries a status line", async () => {
    const lf = await getNewsArticleBySlug(db, `detail-lf-${svc}`);
    expect(lf!.subjectStatus).toBeNull();
  });

  it("falls back to idle when no life row matches — a rebuild must not break the page", async () => {
    const orphan = await getNewsArticleBySlug(db, `detail-${svc}`);
    expect(orphan!.subjectStatus).toEqual({ kind: "idle", idleDaysAtPublication: 3 });
  });

  // ── THE §11 FOG RAIL, SOURCE HALF ──
  // Every subject above has real `positions` rows carrying 7423.51 / 812.4. Note 812.4:
  // it is a legitimate near-edge coordinate that does NOT match /\d{4}\.\d/, which is why the key
  // walk is the primary assertion and the regex is only a secondary signal.
  it("returns no coordinate key and no coordinate-shaped value, over fixtures that HAVE coordinates", async () => {
    const detail = await getNewsArticleBySlug(db, `status-${IDLE}`);
    const feed = await getPublishedNews(db, { page: 1, pageSize: 100 });
    for (const out of [detail, feed]) {
      const keys = collectKeys(out);
      // The SAME eight keys as COORDINATE_KEYS in apps/newsdesk/test/news-facts.test.ts and in the
      // three files Task 1 repairs. One canonical set across the repo — there is no `z` column in
      // `positions`, and a divergent list would confuse the next person porting the helper.
      for (const forbidden of ["x", "y", "posX", "posY", "coordX", "coordY", "lat", "lon"]) {
        expect(keys.has(forbidden)).toBe(false);
      }
      expect(JSON.stringify(out)).not.toContain("7423.51");
      expect(JSON.stringify(out)).not.toContain("812.4");
      expect(JSON.stringify(out)).not.toMatch(/\d{4}\.\d/);   // secondary signal only
    }
  });
});
```

Add the `collectKeys` helper this block uses. Insert it immediately after the `const mine = …` line near the top of the file:

```ts
/** Recursively collects every object key at any depth, including inside arrays. Proves the Fog
 *  Rule by SHAPE rather than by pattern-matching a coordinate-looking number — the same walk
 *  apps/newsdesk/test/news-facts.test.ts uses. */
function collectKeys(value: unknown, keys: Set<string> = new Set()): Set<string> {
  if (value instanceof Date) return keys;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (value !== null && typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      keys.add(key);
      collectKeys(val, keys);
    }
  }
  return keys;
}
```

- [ ] **Step 2: Run it — expect FAIL**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5434/onelife_test" \
  pnpm --filter @onelife/read-models exec vitest run test/news-articles.test.ts
```

Expected: FAIL on the first three status tests — `subjectStatus` is hard-coded `null` by Task 4.

- [ ] **Step 3: Widen the read-model imports**

In `packages/read-models/src/news-articles.ts`, replace:

```ts
import { articles } from "@onelife/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
```

with:

```ts
import { articles, lives, players, sessions } from "@onelife/db";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
```

`gt` is the only new operator (`desc` and `inArray` are already imported by Tasks 3 and 4); `lives`, `players` and `sessions` are the new tables.

- [ ] **Step 4: Append the status query**

Append to the **end** of `packages/read-models/src/news-articles.ts`, after the closing `}` of `getNewsArticleBySlug`:

```ts

/**
 * Spec §4.1.3. The prose of a Standing Dead feature is never regenerated; only this line is live.
 *
 * Branch order is DEATH FIRST, deliberately. A subject who died must have returned to do it, so
 * both predicates can hold at once — and "he came back" is a footnote next to "he is in the
 * morgue now". Reporting the return in that case would be technically true and editorially false.
 *
 * The return predicate MIRRORS findReturnedStandingDead in apps/newsdesk/src/news-pg-store.ts:
 * scoped by (server, gamertag) rather than by life id, and keyed on `connected_at >`, never on
 * COALESCE(disconnected_at, connected_at) — a session that BEGAN before publication and ended
 * after it is the session the article was written about, not a return. Keeping the two identical
 * means the page and the de-publication sweep can never tell the reader different stories.
 *
 * A missing life row (the projections were rebuilt, or the life was folded away) degrades to
 * `idle` rather than throwing: an unavailable projection must not 500 a published page.
 */
export async function getNewsSubjectStatus(
  db: Database,
  args: {
    serverId: number;
    gamertag: string;
    lifeStartedAt: Date;
    createdAt: Date;
    idleSecondsAtPublication: number | null;
  },
): Promise<NewsSubjectStatus> {
  const idle: NewsSubjectStatus = {
    kind: "idle",
    idleDaysAtPublication: Math.floor((args.idleSecondsAtPublication ?? 0) / 86_400),
  };

  const lifeRows = await db
    .select({ endedAt: lives.endedAt })
    .from(lives)
    .innerJoin(players, eq(players.id, lives.playerId))
    .where(and(
      eq(lives.serverId, args.serverId),
      eq(players.gamertag, args.gamertag),
      eq(lives.startedAt, args.lifeStartedAt),
    ))
    .limit(1);

  const life = lifeRows[0];
  if (!life) return idle;

  if (life.endedAt) {
    const obit = await db
      .select({ slug: articles.slug })
      .from(articles)
      .where(and(
        eq(articles.kind, "obituary"),
        eq(articles.status, "published"),
        eq(articles.serverId, args.serverId),
        eq(articles.gamertag, args.gamertag),
        eq(articles.lifeStartedAt, args.lifeStartedAt),
      ))
      .limit(1);
    return { kind: "died", diedAt: life.endedAt, obituarySlug: obit[0]?.slug ?? null };
  }

  const seen = await db
    .select({ connectedAt: sessions.connectedAt })
    .from(sessions)
    .innerJoin(players, eq(players.id, sessions.playerId))
    .where(and(
      eq(sessions.serverId, args.serverId),
      eq(players.gamertag, args.gamertag),
      gt(sessions.connectedAt, args.createdAt),
    ))
    .orderBy(desc(sessions.connectedAt))
    .limit(1);

  const back = seen[0];
  return back ? { kind: "returned", seenAt: back.connectedAt } : idle;
}
```

- [ ] **Step 5: Wire it into the detail read-model**

In `packages/read-models/src/news-articles.ts`, inside `getNewsArticleBySlug`, replace:

```ts
    subjects: subjects.length > 0
      ? subjects
      : [{ gamertag: card.gamertag, mapSlug: card.mapSlug, lifeNumber: card.lifeNumber }],
    // Populated in the next task; a Long Form article keeps it null permanently.
    subjectStatus: null,
  };
}
```

with:

```ts
    subjects: subjects.length > 0
      ? subjects
      : [{ gamertag: card.gamertag, mapSlug: card.mapSlug, lifeNumber: card.lifeNumber }],
    // A Long Form subject is dead; the question does not arise, and the line stays off.
    subjectStatus: card.trigger === "standing_dead"
      ? await getNewsSubjectStatus(db, {
          serverId: r.serverId,
          gamertag: card.gamertag,
          lifeStartedAt: r.lifeStartedAt,
          createdAt: card.createdAt,
          idleSecondsAtPublication: facts.idleSeconds ?? null,
        })
      : null,
  };
}
```

`r.serverId` and `r.lifeStartedAt` are not in `CARD_COLS`. Add them to the detail select — replace:

```ts
      status: articles.status,
      body: articles.body,
```

with:

```ts
      status: articles.status,
      serverId: articles.serverId,
      lifeStartedAt: articles.lifeStartedAt,
      body: articles.body,
```

- [ ] **Step 6: Run the test — expect PASS**

```bash
TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5434/onelife_test" \
  pnpm --filter @onelife/read-models exec vitest run test/news-articles.test.ts
```

Expected: PASS, 20 tests.

- [ ] **Step 7: Typecheck and commit**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
pnpm --filter @onelife/read-models run typecheck
git add packages/read-models/src/news-articles.ts packages/read-models/test/news-articles.test.ts
git commit -m "feat(read-models): the live Standing Dead status line

Computed at request time in three branches, death outranking return. The return
predicate mirrors findReturnedStandingDead exactly so the page and the newsdesk
de-publication sweep can never tell the reader different stories. Fog rail:
fixtures seed real positions rows and the output carries no coordinate key."
```

---

## Task 6: The public API routes

**Files:**
- Create: `apps/api/src/routes/news.ts`
- Create: `apps/api/test/news.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: `getPublishedNews`, `getNewsArticleBySlug` from `@onelife/read-models`.
- Produces: `registerNewsRoutes(app: FastifyInstance, db: Database): void`; `GET /news?page=`, `GET /news/:slug`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/news.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, articles } from "@onelife/db";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";

const { db, sql } = getTestDb();
const app = buildApp(db);
const svc = Math.floor(Math.random() * 1e8) + 54e7;
let serverId: number;
const slug = `news-api-${svc}`;
const retractedSlug = `news-api-retracted-${svc}`;
const tag = `napi-${svc}`;
const born = new Date("2026-07-10T00:00:00Z");

beforeAll(async () => {
  const [s] = await db.insert(servers).values({
    nitradoServiceId: svc, name: "na", map: "chernarusplus", slug: `na-${svc}`, active: true,
  }).returning();
  serverId = s!.id;
  const row = (over: Partial<typeof articles.$inferInsert>) => ({
    kind: "news", serverId, gamertag: tag, map: "chernarusplus", mapSlug: `na-${svc}`,
    lifeNumber: 1, lifeStartedAt: born, headline: "H", lede: "L", body: "B",
    promptVersion: "news-v1", model: "test", attempts: 1, ...over,
  }) as typeof articles.$inferInsert;

  await db.insert(articles).values([
    row({
      status: "published", slug, naturalKey: `standing_dead:${serverId}:${tag}:${born.toISOString()}`,
      pullQuoteText: "q", pullQuoteAttribution: "a quartermaster", tags: ["News"],
      bodyBlocks: [{ type: "para", text: "B" }],
      createdAt: new Date("2026-07-13T00:00:00Z"),
      facts: { trigger: "standing_dead", subjectCount: 1, idleSeconds: 259200 },
    }),
    row({
      status: "retracted", slug: retractedSlug,
      naturalKey: `standing_dead:${serverId}:${tag}:2026-07-11T00:00:00.000Z`,
      lifeStartedAt: new Date("2026-07-11T00:00:00Z"),
      createdAt: new Date("2026-07-14T00:00:00Z"),
      facts: { trigger: "standing_dead", subjectCount: 1 },
    }),
  ]);
});

afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("GET /news", () => {
  it("returns a published-news feed with defaults", async () => {
    const res = await app.inject({ method: "GET", url: "/news" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ page: 1, pageSize: 20 });
    expect(body.rows.some((r: { slug: string }) => r.slug === slug)).toBe(true);
  });

  it("never serves a retracted article in the feed", async () => {
    const res = await app.inject({ method: "GET", url: "/news" });
    expect(res.json().rows.some((r: { slug: string }) => r.slug === retractedSlug)).toBe(false);
  });

  it("coerces an invalid page to 1", async () => {
    const res = await app.inject({ method: "GET", url: "/news?page=-3" });
    expect(res.statusCode).toBe(200);
    expect(res.json().page).toBe(1);
  });
});

describe("GET /news/:slug", () => {
  it("returns the full article including the rich body blocks", async () => {
    const res = await app.inject({ method: "GET", url: `/news/${slug}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.headline).toBe("H");
    expect(body.trigger).toBe("standing_dead");
    expect(body.bodyBlocks).toEqual([{ type: "para", text: "B" }]);
    expect(body.pullQuote).toEqual({ text: "q", attribution: "a quartermaster" });
    expect(body.retracted).toBe(false);
    expect(body.subjectStatus).toMatchObject({ kind: "idle", idleDaysAtPublication: 3 });
  });

  it("serves a retracted article flagged, so the interior can noindex it", async () => {
    const res = await app.inject({ method: "GET", url: `/news/${retractedSlug}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().retracted).toBe(true);
  });

  it("unknown slug → 404", async () => {
    const res = await app.inject({ method: "GET", url: "/news/no-such-slug" });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5434/onelife_test" \
  pnpm --filter @onelife/api exec vitest run test/news.test.ts
```

Expected: FAIL — every request 404s; the routes are not registered.

- [ ] **Step 3: Create the routes**

Create `apps/api/src/routes/news.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import { z } from "zod";
import { getPublishedNews, getNewsArticleBySlug } from "@onelife/read-models";

const query = z.object({ page: z.coerce.number().int().positive().catch(1) });
const params = z.object({ slug: z.string().min(1) });

/** Structural twin of registerObituariesRoutes. "/news" is declared above "/news/:slug" for
 *  readability, NOT for correctness: the two have different segment counts and could never
 *  collide, and find-my-way prioritises a static segment over a parametric one regardless of
 *  registration order. (The only wildcard in the whole API is "/api/auth/*", which cannot reach
 *  either.) Do not read a registration-order rule out of this comment — there isn't one. */
export function registerNewsRoutes(app: FastifyInstance, db: Database): void {
  app.get("/news", async (req) => {
    const { page } = query.parse(req.query);
    return getPublishedNews(db, { page });
  });

  app.get("/news/:slug", async (req, reply) => {
    const p = params.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "bad_request" });
    // A RETRACTED article resolves here on purpose and arrives carrying `retracted: true`. The
    // feed drops it and the interior noindexes it; the URL keeps working so a reader who followed
    // a shared link gets the correction instead of a 404.
    const article = await getNewsArticleBySlug(db, p.data.slug);
    if (!article) return reply.code(404).send({ error: "not_found" });
    return article;
  });
}
```

- [ ] **Step 4: Register them**

In `apps/api/src/app.ts`, replace:

```ts
import { registerBirthNoticesRoutes } from "./routes/birth-notices.js";
```

with:

```ts
import { registerBirthNoticesRoutes } from "./routes/birth-notices.js";
import { registerNewsRoutes } from "./routes/news.js";
```

and replace:

```ts
  registerBirthNoticesRoutes(app, db);
```

with:

```ts
  registerBirthNoticesRoutes(app, db);
  registerNewsRoutes(app, db);
```

- [ ] **Step 5: Run the test — expect PASS**

```bash
TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5434/onelife_test" \
  pnpm --filter @onelife/api exec vitest run test/news.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
pnpm --filter @onelife/api run typecheck
git add apps/api/src/routes/news.ts apps/api/test/news.test.ts apps/api/src/app.ts
git commit -m "feat(api): GET /news and GET /news/:slug

Structural twins of the obituaries routes. A retracted article resolves by slug
carrying retracted:true and is absent from the feed."
```

---

## Task 7: Web DTOs and API client

**Files:**
- Modify: `apps/web/src/lib/types.ts`
- Modify: `apps/web/src/lib/api.ts`

**Interfaces:**
- Consumes: the JSON shape produced by Task 6. Timestamps arrive as ISO strings over the wire.
- Produces: `NewsTrigger`, `NewsSubjectRef`, `NewsCard`, `NewsFeed`, `NewsSubjectStatus`, `NewsArticle` types; `getNewsFeed(page: number): Promise<NewsFeed>`, `getNewsArticle(slug: string): Promise<NewsArticle | null>`.

- [ ] **Step 1: Add the DTOs**

In `apps/web/src/lib/types.ts`, append at the **end of the file**, after the closing `};` of the `BirthNoticeArticle` type:

```ts

export type NewsTrigger = "standing_dead" | "long_form";

export type NewsSubjectRef = { gamertag: string; mapSlug: string | null; lifeNumber: number };

export type NewsCard = {
  slug: string;
  trigger: NewsTrigger;
  gamertag: string;
  map: string;
  mapSlug: string | null;
  lifeNumber: number;
  headline: string;
  lede: string;
  tags: string[];
  subjectCount: number;
  createdAt: string;
};
export type NewsFeed = { rows: NewsCard[]; total: number; page: number; pageSize: number };

/**
 * The §4.1.3 status line, computed server-side at request time. `idleDaysAtPublication` is the
 * FROZEN idle figure as of publication and is never recomputed against `now` — the whole point of
 * the line is that the paper reports what it knew when it printed, then corrects itself.
 */
export type NewsSubjectStatus =
  | { kind: "idle"; idleDaysAtPublication: number }
  | { kind: "returned"; seenAt: string }
  | { kind: "died"; diedAt: string; obituarySlug: string | null };

export type NewsArticle = NewsCard & {
  body: string;
  bodyBlocks?: ArticleBlock[] | null;
  pullQuote: { text: string; attribution: string } | null;
  imageUrl: string | null;
  imageCaption: string | null;
  retracted: boolean;
  timeAliveSeconds: number;
  kills: number;
  idleSeconds: number | null;
  spanSeconds: number | null;
  subjects: NewsSubjectRef[];
  subjectStatus: NewsSubjectStatus | null;
};
```

- [ ] **Step 2: Add the client calls**

In `apps/web/src/lib/api.ts`, replace:

```ts
  ObituariesFeed, ObituaryArticle,
  BirthNoticesFeed, BirthNoticeArticle,
} from "./types";
```

with:

```ts
  ObituariesFeed, ObituaryArticle,
  BirthNoticesFeed, BirthNoticeArticle,
  NewsFeed, NewsArticle,
} from "./types";
```

and replace:

```ts
export const getBirthNotice = (slug: string) =>
  getOrNull<BirthNoticeArticle>(`/api/birth-notices/${encodeURIComponent(slug)}`);
```

with:

```ts
export const getBirthNotice = (slug: string) =>
  getOrNull<BirthNoticeArticle>(`/api/birth-notices/${encodeURIComponent(slug)}`);

export const getNewsFeed = (page: number) =>
  apiGet<NewsFeed>(`/api/news?page=${page}`);
export const getNewsArticle = (slug: string) =>
  getOrNull<NewsArticle>(`/api/news/${encodeURIComponent(slug)}`);
```

- [ ] **Step 3: Typecheck and commit**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
pnpm --filter @onelife/web run typecheck
git add apps/web/src/lib/types.ts apps/web/src/lib/api.ts
git commit -m "feat(web): news DTOs and API client calls"
```

---

## Task 8: Pure news formatting, including the `showingLine` arg-order pin

`obituaryShowingLine` is `(page, pageSize, total)`; `birthShowingLine` is `(page, total, pageSize)`. All three parameters are `number`, so a wrong call order compiles cleanly and renders plausible-but-wrong pagination text. Spec §9 says follow the **birth** signature and test it. The test below is written so it **fails on a swap** — with `page=2, total=7, pageSize=3` the correct output is `Showing 4–6 of 7 filed`, while feeding those same three numbers in the obituary order, `(2, 7, 3)` read as `(page, pageSize, total)`, yields `Showing 3–3 of 3 filed`. Every figure differs — the range as well as the total — which is what makes the pin real.

**Files:**
- Create: `apps/web/src/lib/news-format.ts`
- Create: `apps/web/src/lib/news-format.test.ts`
- Modify: `apps/web/src/lib/seo.ts`
- Modify: `apps/web/src/lib/seo.test.ts` (append a `newsLd` describe)

**Interfaces:**
- Consumes: `mapLabel`, `formatDuration`, `relativeDate` from `@/components/player/format`; `NewsArticle`, `NewsCard`, `NewsTrigger` from `@/lib/types`.
- Produces:
  - `newsHref(page: number): string`
  - `newsArticleHref(slug: string): string`
  - `newsDateline(map: string, createdAtIso: string, now: Date): string`
  - `newsShowingLine(page: number, total: number, pageSize: number): string` — **birth order**
  - `newsUpdateDate(iso: string): string`
  - `triggerLabel(trigger: NewsTrigger): string`
  - `type NewsFact = { label: string; value: string; hot: boolean }`
  - `newsDossierFacts(a: NewsArticle): NewsFact[]`
  - `newsLd(a, url)` in `seo.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/news-format.test.ts`:

```tsx
import { describe, it, expect } from "vitest";
import {
  newsHref, newsArticleHref, newsDateline, newsShowingLine, newsUpdateDate,
  triggerLabel, newsDossierFacts,
} from "./news-format";
import type { NewsArticle } from "./types";

const article = (over: Partial<NewsArticle> = {}): NewsArticle => ({
  slug: "standing-dead-still-standing-somewhere-gabefox101-7-3",
  trigger: "standing_dead", gamertag: "GabeFox101", map: "chernarusplus", mapSlug: "chernarus",
  lifeNumber: 3, headline: "Still Standing, Somewhere", lede: "L", tags: ["News"],
  subjectCount: 1, createdAt: "2026-07-14T00:00:00Z", body: "B", bodyBlocks: null,
  pullQuote: null, imageUrl: null, imageCaption: null, retracted: false,
  timeAliveSeconds: 5600, kills: 0, idleSeconds: 259200, spanSeconds: null,
  subjects: [{ gamertag: "GabeFox101", mapSlug: "chernarus", lifeNumber: 3 }],
  subjectStatus: { kind: "idle", idleDaysAtPublication: 3 },
  ...over,
});

describe("hrefs", () => {
  it("omits ?page for page 1", () => {
    expect(newsHref(1)).toBe("/news");
    expect(newsHref(3)).toBe("/news?page=3");
  });
  it("builds an interior href", () => {
    expect(newsArticleHref("a-b-c")).toBe("/news/a-b-c");
  });
});

describe("newsDateline", () => {
  it("is map-only — never a coordinate", () => {
    expect(newsDateline("chernarusplus", "2026-07-12T00:00:00Z", new Date("2026-07-14T00:00:00Z")))
      .toBe("CHERNARUS BUREAU · 2 days ago");
  });
});

describe("newsShowingLine", () => {
  // THE ARG-ORDER PIN. Signature is (page, total, pageSize) — the BIRTH order, per spec §9.
  // obituaryShowingLine is (page, pageSize, total), and every argument is a number, so a swap is
  // type-silent. The assertion below distinguishes them: reading (2, 7, 3) in the obituary order
  // renders "Showing 3–3 of 3 filed" — a different range AND a different total.
  it("follows the BIRTH argument order (page, total, pageSize)", () => {
    expect(newsShowingLine(2, 7, 3)).toBe("Showing 4–6 of 7 filed");
  });
  it("clamps the final partial page", () => {
    expect(newsShowingLine(3, 7, 3)).toBe("Showing 7–7 of 7 filed");
  });
  it("reads sanely with nothing filed", () => {
    expect(newsShowingLine(1, 0, 20)).toBe("Showing 0–0 of 0 filed");
  });
});

describe("newsUpdateDate", () => {
  it("formats in UTC, deterministically — never toLocaleDateString", () => {
    expect(newsUpdateDate("2026-07-14T23:30:00Z")).toBe("14 JUL 2026");
  });
});

describe("triggerLabel", () => {
  it("names both desks", () => {
    expect(triggerLabel("standing_dead")).toBe("The Standing Dead");
    expect(triggerLabel("long_form")).toBe("The Long Form");
  });
});

describe("newsDossierFacts", () => {
  it("reports PLAYED time and idle time as separate, differently-labelled figures", () => {
    const facts = newsDossierFacts(article());
    expect(facts).toEqual([
      { label: "Played", value: "1h 33m", hot: false },
      { label: "Kills", value: "0", hot: false },
      { label: "Life", value: "3 · Chernarus", hot: false },
      { label: "Idle", value: "3 days", hot: true },
    ]);
  });

  it("swaps in the Long Form figures and never emits an idle row", () => {
    const facts = newsDossierFacts(article({
      trigger: "long_form", subjectCount: 2, idleSeconds: null, spanSeconds: 27, kills: 1,
    }));
    expect(facts).toEqual([
      { label: "Played", value: "1h 33m", hot: false },
      { label: "Kills", value: "1", hot: false },
      { label: "Life", value: "3 · Chernarus", hot: false },
      { label: "Subjects", value: "2", hot: true },
      { label: "Span", value: "27s", hot: false },
    ]);
    expect(facts.some((f) => f.label === "Idle")).toBe(false);
  });

  it("emits no distance, no landmark and no coordinate-shaped value", () => {
    const all = [...newsDossierFacts(article()), ...newsDossierFacts(article({ trigger: "long_form", spanSeconds: 27, idleSeconds: null }))];
    // METRES NEVER APPEAR ON A NEWS DOSSIER. The rail used to read /\bm\b/, which can never match:
    // `\b` needs a word/non-word transition and there is none between a digit and "m", so it
    // returned false for "412m" and "1h 33m" alike — the same vacuity class Task 1 exists to
    // repair. /\d\s?m\b/ does match, but it also matches a legitimate DURATION (formatDuration
    // renders 5600s as "1h 33m"), so it is asserted over the non-duration facts only.
    const DURATION_LABELS = new Set(["Played", "Idle", "Span"]);
    for (const f of all) {
      expect(f.value).not.toMatch(/\d{3,5}\.\d/);
      if (!DURATION_LABELS.has(f.label)) expect(f.value).not.toMatch(/\d\s?m\b/);
    }
    // A distance leak would arrive as its own fact, so no such label may exist either.
    expect(all.some((f) => /distance|metre|meter|range/i.test(f.label))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
pnpm --filter @onelife/web exec vitest run src/lib/news-format.test.ts
```

Expected: FAIL — `Failed to resolve import "./news-format"`.

- [ ] **Step 3: Create the module**

Create `apps/web/src/lib/news-format.ts`:

```ts
import { mapLabel, formatDuration, relativeDate } from "@/components/player/format";
import type { NewsArticle, NewsTrigger } from "./types";

export function newsHref(page: number): string {
  return page > 1 ? `/news?page=${page}` : "/news";
}

export function newsArticleHref(slug: string): string {
  return `/news/${slug}`;
}

/** "CHERNARUS BUREAU · 2 days ago" — keyed on created_at, because a Standing Dead feature has no
 *  death to date from. Map only, never a coordinate (Fog Rule §4.1.4). */
export function newsDateline(map: string, createdAtIso: string, now: Date): string {
  return `${mapLabel(map).toUpperCase()} BUREAU · ${relativeDate(createdAtIso, now)}`;
}

/**
 * ARGUMENT ORDER IS (page, total, pageSize) — the birthShowingLine order, per spec §9.
 * obituaryShowingLine is (page, pageSize, total). Every parameter is a `number`, so calling this
 * in the obituary order compiles and renders a plausible-but-wrong total. Pinned by a test.
 */
export function newsShowingLine(page: number, total: number, pageSize: number): string {
  const to = Math.min(page * pageSize, total);
  const from = Math.min((page - 1) * pageSize + 1, to);
  return `Showing ${from}–${to} of ${total} filed`;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "14 JUL 2026", in UTC. Deliberately NOT toLocaleDateString, whose output depends on the
 *  runtime's ICU data and would differ between the server render and a test. Mirrors the UTC
 *  discipline of `monthYear` in components/player/format.ts. */
export function newsUpdateDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const TRIGGER_LABEL: Record<NewsTrigger, string> = {
  standing_dead: "The Standing Dead",
  long_form: "The Long Form",
};

/** A guarded Record, not a ternary: a binary ternary on a widening union is exactly the defect
 *  spec §7 catalogues in the image pass. A fourth trigger must fail loudly here. */
export function triggerLabel(trigger: NewsTrigger): string {
  const label = TRIGGER_LABEL[trigger];
  if (!label) throw new Error(`unknown news trigger: ${trigger}`);
  return label;
}

export type NewsFact = { label: string; value: string; hot: boolean };

/**
 * The factual dossier strip — read-model figures only, never the LLM.
 *
 * "Played" is `time_alive_seconds` (playtime), never wall clock (§11). "Idle" is a SEPARATE row
 * with its own label, because it is the length of an absence and must never read as endurance.
 * "Span" is seconds between the first and last death — a TIME, never a distance: the distance
 * that made the cluster a cluster never leaves the newsdesk.
 */
export function newsDossierFacts(a: NewsArticle): NewsFact[] {
  const out: NewsFact[] = [
    { label: "Played", value: formatDuration(a.timeAliveSeconds), hot: false },
    { label: "Kills", value: String(a.kills), hot: false },
    { label: "Life", value: `${a.lifeNumber} · ${mapLabel(a.map)}`, hot: false },
  ];
  if (a.trigger === "standing_dead") {
    if (a.idleSeconds != null) {
      const days = Math.floor(a.idleSeconds / 86_400);
      out.push({ label: "Idle", value: `${days} day${days === 1 ? "" : "s"}`, hot: true });
    }
  } else {
    out.push({ label: "Subjects", value: String(a.subjectCount), hot: true });
    if (a.spanSeconds != null) out.push({ label: "Span", value: `${a.spanSeconds}s`, hot: false });
  }
  return out;
}
```

- [ ] **Step 4: Run the test — expect PASS**

```bash
pnpm --filter @onelife/web exec vitest run src/lib/news-format.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Add the JSON-LD builder**

In `apps/web/src/lib/seo.ts`, replace:

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

with:

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

/** The news feature's JSON-LD. `datePublished` is created_at: a Standing Dead feature has no
 *  death and its subject is alive, so there is no other honest date. `about` lists EVERY subject —
 *  a Long Form piece is about a shared ending, not about its primary. Must be emitted through
 *  ldScript(), like every other JSON-LD sink here.
 *
 *  A RETRACTED feature is QUALIFIED, never emitted bare. The interior is noindexed, but the block
 *  is still read by anything that parses the page directly, and an unqualified `NewsArticle` there
 *  asserts a headline the desk has withdrawn. `creativeWorkStatus` is schema.org's term for it. */
export function newsLd(
  a: {
    headline: string; lede: string; createdAt: string;
    subjects: { gamertag: string }[]; imageUrl: string | null; retracted: boolean;
  },
  url: string,
) {
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: a.headline,
    description: a.lede,
    url,
    datePublished: a.createdAt,
    ...(a.retracted ? { creativeWorkStatus: "Retracted" } : {}),
    // A retracted feature's hero bytes 404 behind the media route's published-only filter, so a
    // retracted piece never advertises an image it cannot serve.
    ...(a.imageUrl && !a.retracted ? { image: absoluteUrl(a.imageUrl) } : {}),
    about: a.subjects.map((s) => ({ "@type": "Person", name: s.gamertag })),
    isPartOf: { "@type": "CollectionPage", name: "News", url: absoluteUrl("/news") },
  };
}
```

Then pin it in the **existing** `apps/web/src/lib/seo.test.ts` (it already covers `birthNoticeLd` and `articleLd`). Widen its import — replace:

```ts
import { absoluteUrl, ldScript, birthNoticeLd, articleLd } from "./seo";
```

with:

```ts
import { absoluteUrl, ldScript, birthNoticeLd, articleLd, newsLd } from "./seo";
```

and append this `describe` at the **end of the file**, after the closing `});` of `describe("articleLd", …)`:

```ts
describe("newsLd", () => {
  const a = {
    headline: "Still Standing, Somewhere", lede: "L", createdAt: "2026-07-12T00:00:00Z",
    subjects: [{ gamertag: "GabeFox101" }, { gamertag: "CUPID18" }],
    imageUrl: "/media/heroes/x.png", retracted: false,
  };

  it("emits a NewsArticle about EVERY subject, dated created_at, in the News collection", () => {
    const ld = newsLd(a, "https://x/news/still-standing") as Record<string, unknown>;
    expect(ld["@type"]).toBe("NewsArticle");
    expect(ld.datePublished).toBe("2026-07-12T00:00:00Z");
    expect((ld.about as { name: string }[]).map((p) => p.name)).toEqual(["GabeFox101", "CUPID18"]);
    expect((ld.isPartOf as Record<string, unknown>).name).toBe("News");
    expect(ld).not.toHaveProperty("creativeWorkStatus");
  });

  // Retraction must reach the STRUCTURED DATA, not stop at the interior's visible banner. An
  // unqualified NewsArticle asserts a headline the desk has withdrawn.
  it("QUALIFIES a retracted feature and drops the image it can no longer serve", () => {
    const ld = newsLd({ ...a, retracted: true }, "https://x/news/still-standing") as Record<string, unknown>;
    expect(ld.creativeWorkStatus).toBe("Retracted");
    expect(ld).not.toHaveProperty("image");
  });

  it("escapes </script> when rendered through ldScript", () => {
    const out = ldScript(newsLd({ ...a, headline: "X </script><script>alert(1)</script>" }, "https://x/y"));
    expect(out).not.toContain("</script>");
    expect(out).toContain("\\u003c");
  });
});
```

Run it: `pnpm --filter @onelife/web exec vitest run src/lib/seo.test.ts` — expect PASS, with three more tests than before.

- [ ] **Step 6: Typecheck and commit**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
pnpm --filter @onelife/web run typecheck
git add apps/web/src/lib/news-format.ts apps/web/src/lib/news-format.test.ts apps/web/src/lib/seo.ts apps/web/src/lib/seo.test.ts
git commit -m "feat(web): news formatting helpers and JSON-LD

newsShowingLine follows the BIRTH argument order (page, total, pageSize), pinned
by a test that fails on a swap — obituaryShowingLine is (page, pageSize, total)
and all three args are numbers, so the mistake is type-silent."
```

---

## Task 9: The feed components

**Files:**
- Create: `apps/web/src/components/news/news-card.tsx` + `news-card.test.tsx`
- Create: `apps/web/src/components/news/news-pagination.tsx` + `news-pagination.test.tsx`
- Create: `apps/web/src/components/news/more-from-the-desk.tsx`
- Create: `apps/web/src/components/news/news-status-line.tsx` + `news-status-line.test.tsx`
- Create: `apps/web/src/components/news/news-dossier.tsx`

**Interfaces:**
- Consumes: Task 8's `newsArticleHref`, `newsDateline`, `newsShowingLine`, `newsHref`, `newsUpdateDate`, `triggerLabel`, `newsDossierFacts`; `NumberedPager`; `GamertagLink`; `obituaryHref` from `@/lib/obituary-format`.
- Produces:
  - `NewsCard({ card: NewsCard, now: Date })`
  - `NewsPagination({ page, total, pageSize }: { page: number; total: number; pageSize: number })`
  - `MoreFromTheDesk({ rows }: { rows: NewsCard[] })`
  - `NewsStatusLine({ status }: { status: NewsSubjectStatus })`
  - `NewsDossier({ article }: { article: NewsArticle })`

- [ ] **Step 1: Write the failing tests for the status line**

Create `apps/web/src/components/news/news-status-line.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { NewsStatusLine } from "./news-status-line";

describe("NewsStatusLine", () => {
  it("still idle — reports what the paper knew when it printed", () => {
    render(<NewsStatusLine status={{ kind: "idle", idleDaysAtPublication: 3 }} />);
    expect(screen.getByText(/AS OF PUBLICATION, 3 DAYS WITHOUT A SIGHTING/i)).toBeInTheDocument();
  });

  it("singularises one day", () => {
    render(<NewsStatusLine status={{ kind: "idle", idleDaysAtPublication: 1 }} />);
    expect(screen.getByText(/1 DAY WITHOUT A SIGHTING/i)).toBeInTheDocument();
  });

  it("returned — prints the correction with a UTC date", () => {
    render(<NewsStatusLine status={{ kind: "returned", seenAt: "2026-07-16T09:00:00Z" }} />);
    expect(screen.getByText(/UPDATE: SUBJECT WAS SEEN AGAIN ON 16 JUL 2026/i)).toBeInTheDocument();
  });

  it("died since — links to the obituary when one exists", () => {
    render(<NewsStatusLine status={{ kind: "died", diedAt: "2026-07-17T09:00:00Z", obituarySlug: "the-end-9" }} />);
    expect(screen.getByText(/UPDATE: SUBJECT HAS SINCE DIED, 17 JUL 2026/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /READ THE OBITUARY/i })).toHaveAttribute("href", "/obituaries/the-end-9");
  });

  it("died since — states the death without a link when the morgue has not filed yet", () => {
    render(<NewsStatusLine status={{ kind: "died", diedAt: "2026-07-17T09:00:00Z", obituarySlug: null }} />);
    expect(screen.getByText(/UPDATE: SUBJECT HAS SINCE DIED, 17 JUL 2026/i)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
pnpm --filter @onelife/web exec vitest run src/components/news/news-status-line.test.tsx
```

Expected: FAIL — `Failed to resolve import "./news-status-line"`.

- [ ] **Step 3: Create the status line**

Create `apps/web/src/components/news/news-status-line.tsx`:

```tsx
import Link from "next/link";
import type { NewsSubjectStatus } from "@/lib/types";
import { newsUpdateDate } from "@/lib/news-format";
import { obituaryHref } from "@/lib/obituary-format";

/**
 * Spec §4.1.3. A Standing Dead feature is the only thing the paper prints that its subject can
 * falsify by acting. The prose above it is frozen at publication; THIS line is computed at request
 * time, so the page corrects itself the moment the subject reappears — or dies.
 *
 * Mirrors the "still drawing breath" line the Fresh Spawns interior already ships.
 */
export function NewsStatusLine({ status }: { status: NewsSubjectStatus }) {
  if (status.kind === "idle") {
    const d = status.idleDaysAtPublication;
    return (
      <p className="mt-5 border-l-[3px] border-hairline pl-3 font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted">
        As of publication, {d} day{d === 1 ? "" : "s"} without a sighting.
      </p>
    );
  }

  if (status.kind === "returned") {
    return (
      <p className="mt-5 border-l-[3px] border-blue pl-3 font-mono text-[11px] uppercase tracking-[.06em] text-blue">
        Update: subject was seen again on {newsUpdateDate(status.seenAt)}. This filing stands as a record of the gap, not of a fate.
      </p>
    );
  }

  return (
    <p className="mt-5 border-l-[3px] border-red pl-3 font-mono text-[11px] uppercase tracking-[.06em] text-red">
      Update: subject has since died, {newsUpdateDate(status.diedAt)}.
      {status.obituarySlug ? (
        <>
          {" "}
          <Link href={obituaryHref(status.obituarySlug)} className="font-bold underline">
            Read the obituary
          </Link>
        </>
      ) : null}
    </p>
  );
}
```

- [ ] **Step 4: Run the test — expect PASS**

```bash
pnpm --filter @onelife/web exec vitest run src/components/news/news-status-line.test.tsx
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing test for the feed card**

Create `apps/web/src/components/news/news-card.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { NewsCard } from "./news-card";
import type { NewsCard as Card } from "@/lib/types";

const card: Card = {
  slug: "standing-dead-still-standing-somewhere-gabefox101-7-3",
  trigger: "standing_dead", gamertag: "GabeFox101", map: "chernarusplus", mapSlug: "chernarus",
  lifeNumber: 3, headline: "Still Standing, Somewhere", lede: "Nobody has had word since Tuesday.",
  tags: ["News", "Chernarus", "The Standing Dead"], subjectCount: 1,
  createdAt: "2026-07-12T00:00:00Z",
};

const now = new Date("2026-07-14T00:00:00Z");

describe("NewsCard", () => {
  it("links the headline to the interior and shows the dateline, lede and desk", () => {
    render(<NewsCard card={card} now={now} />);
    expect(screen.getByRole("link", { name: "Still Standing, Somewhere" }))
      .toHaveAttribute("href", "/news/standing-dead-still-standing-somewhere-gabefox101-7-3");
    expect(screen.getByText("CHERNARUS BUREAU · 2 days ago")).toBeInTheDocument();
    expect(screen.getByText("Nobody has had word since Tuesday.")).toBeInTheDocument();
    expect(screen.getByText("The Standing Dead")).toBeInTheDocument();
  });

  it("links the primary gamertag to their player page", () => {
    render(<NewsCard card={card} now={now} />);
    expect(screen.getByRole("link", { name: "GabeFox101" })).toHaveAttribute("href", "/players/gabefox101");
  });

  it("names the co-subject count on a multi-subject Long Form piece", () => {
    render(<NewsCard card={{ ...card, trigger: "long_form", subjectCount: 2, headline: "Two Went Out" }} now={now} />);
    expect(screen.getByText("The Long Form")).toBeInTheDocument();
    expect(screen.getByText("2 subjects")).toBeInTheDocument();
  });

  it("says nothing about subject count when there is only one", () => {
    render(<NewsCard card={card} now={now} />);
    expect(screen.queryByText(/subjects/)).toBeNull();
  });
});
```

- [ ] **Step 6: Run it — expect FAIL, then create the card**

```bash
pnpm --filter @onelife/web exec vitest run src/components/news/news-card.test.tsx
```

Expected: FAIL — module not found. Create `apps/web/src/components/news/news-card.tsx`:

```tsx
import Link from "next/link";
import type { NewsCard as Card } from "@/lib/types";
import { GamertagLink } from "@/components/gamertag-link";
import { newsArticleHref, newsDateline, triggerLabel } from "@/lib/news-format";

/** One feature in the reverse-chron news feed. Text-only: the hero photograph is the interior's
 *  signal that a piece is a feature, and repeating it at thumbnail size on the feed spends the
 *  rationing rule for nothing. */
export function NewsCard({ card, now }: { card: Card; now: Date }) {
  return (
    <article className="border-b border-hairline py-6">
      <p className="font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted">
        {newsDateline(card.map, card.createdAt, now)}
      </p>
      <h2 className="mt-1.5 font-display text-3xl font-bold uppercase leading-[.95] text-ink md:text-4xl">
        <Link href={newsArticleHref(card.slug)} className="hover:text-red">{card.headline}</Link>
      </h2>
      <p className="mt-2 max-w-2xl font-mono text-[13px] leading-relaxed text-ink-soft">{card.lede}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <span className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          <GamertagLink gamertag={card.gamertag} className="font-bold text-ink underline" />
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          {triggerLabel(card.trigger)}
        </span>
        {card.subjectCount > 1 && (
          <span className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
            {card.subjectCount} subjects
          </span>
        )}
      </div>
    </article>
  );
}
```

- [ ] **Step 7: Run it — expect PASS**

```bash
pnpm --filter @onelife/web exec vitest run src/components/news/news-card.test.tsx
```

Expected: PASS, 4 tests.

- [ ] **Step 8: Write the failing pagination test**

Create `apps/web/src/components/news/news-pagination.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { NewsPagination } from "./news-pagination";

describe("NewsPagination", () => {
  it("renders the showing line with the BIRTH argument order (page, total, pageSize)", () => {
    // 7 filed, 3 per page, page 2 → items 4–6 of 7. Called in the obituary order, the same three
    // numbers render "Showing 3–3 of 3 filed" — the pin lives here as well as in
    // news-format.test.ts, because the call SITE is where the swap actually happens.
    render(<NewsPagination page={2} total={7} pageSize={3} />);
    expect(screen.getByText("Showing 4–6 of 7 filed")).toBeInTheDocument();
  });
});
```

- [ ] **Step 9: Run it — expect FAIL, then create the pager**

```bash
pnpm --filter @onelife/web exec vitest run src/components/news/news-pagination.test.tsx
```

Expected: FAIL — module not found. Create `apps/web/src/components/news/news-pagination.tsx`:

```tsx
import { NumberedPager } from "@/components/shared/numbered-pager";
import { newsHref, newsShowingLine } from "@/lib/news-format";

export function NewsPagination({ page, total, pageSize }: { page: number; total: number; pageSize: number }) {
  return (
    <NumberedPager
      page={page}
      total={total}
      pageSize={pageSize}
      hrefFor={newsHref}
      // (page, total, pageSize) — the BIRTH order. obituaryShowingLine is (page, pageSize, total)
      // and all three are numbers, so swapping them here compiles silently. Pinned by a test.
      showingLine={newsShowingLine(page, total, pageSize)}
    />
  );
}
```

- [ ] **Step 10: Run it — expect PASS**

```bash
pnpm --filter @onelife/web exec vitest run src/components/news/news-pagination.test.tsx
```

Expected: PASS, 1 test.

- [ ] **Step 11: Create the related rail and the dossier**

These two are thin presentational wrappers over already-tested pure functions and are covered by the interior's tests in Task 10.

Create `apps/web/src/components/news/more-from-the-desk.tsx`:

```tsx
import Link from "next/link";
import type { NewsCard } from "@/lib/types";
import { newsArticleHref } from "@/lib/news-format";
import { mapLabel } from "@/components/player/format";

/** Related rail: other recent features. Its rows come from the published feed, which already
 *  excludes retracted articles — a retracted piece must never be recommended. The caller has
 *  already excluded the current article. */
export function MoreFromTheDesk({ rows }: { rows: NewsCard[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-10 border-t-[3px] border-ink pt-4">
      <h2 className="font-display text-sm font-bold uppercase tracking-[.14em] text-ink">More From the Desk</h2>
      <ul className="mt-3 flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.slug}>
            <Link href={newsArticleHref(r.slug)} className="group block">
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

Create `apps/web/src/components/news/news-dossier.tsx`:

```tsx
import type { NewsArticle } from "@/lib/types";
import { newsDossierFacts } from "@/lib/news-format";
import { cn } from "@/lib/utils";

/** The factual strip — read models only, never the LLM. The news analogue of the obituary's Rap
 *  Sheet and the birth notice's Priors box. */
export function NewsDossier({ article }: { article: NewsArticle }) {
  const facts = newsDossierFacts(article);
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-hairline py-3">
      {facts.map((f) => (
        <span key={f.label} className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          {f.label} <span className={cn("font-bold", f.hot ? "text-red" : "text-ink")}>{f.value}</span>
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 12: Run the whole news component directory and commit**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
pnpm --filter @onelife/web exec vitest run src/components/news
pnpm --filter @onelife/web run typecheck
git add apps/web/src/components/news
git commit -m "feat(web): news feed components and the live status line

The status line is the §4.1.3 correction mechanism: the prose is frozen, the
line is computed per request, and death outranks return. NewsPagination pins the
birth argument order at the call site, where the type-silent swap would happen."
```

---

## Task 10: The news interior view

The order per spec §9: masthead → `ArticleHero` → lede → status line (Standing Dead only) → dossier → `ArticleBody` → pull quote → tags → **timelines** → more-from-the-desk. The spec does not place the timeline embed; the obituary interior's precedent (`Timeline` after tags, before the related rail) is followed.

**Two timelines is not two copies of one component.** A Long Form piece renders up to `NEWS_TIMELINE_LIMIT = 2` timelines — parallel records converging on the same minute is the flagship's visual argument. They stack on mobile and sit side by side from `lg` up, with a hairline rule between them (the `lg:divide-x lg:divide-hairline` idiom the home page's two content blocks already use). Each is headed by its subject's callsign, because two unlabelled parallel timelines are unreadable. If one subject's timeline is unavailable (an un-slugged server, or a failed fetch), the ones that loaded still render — the interior degrades exactly as the obituary interior already does, and never fabricates the missing half.

**Files:**
- Create: `apps/web/src/components/news/news-article.tsx`
- Create: `apps/web/src/components/news/news-article.test.tsx`

**Interfaces:**
- Consumes: `ArticleHero` (Task 2, `accent="ink"`), `ArticleBody`, `PullQuote`, `Timeline`, `GamertagLink`, `NewsStatusLine`, `NewsDossier`, `MoreFromTheDesk` (Task 9), `newsDateline`/`triggerLabel` (Task 8).
- Produces:
  - `export type NewsTimeline = { gamertag: string; view: LifeTimelineView }`
  - `export const NEWS_TIMELINE_LIMIT = 2`
  - `NewsArticleView({ article, more, timelines, now }: { article: NewsArticle; more: NewsCard[]; timelines: NewsTimeline[]; now: Date })` — Task 11 supplies `timelines`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/news/news-article.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { NewsArticleView, type NewsTimeline } from "./news-article";
import type { NewsArticle } from "@/lib/types";
import type { LifeTimelineView } from "@/lib/life-timeline";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: Record<string, unknown>) => <img {...(props as object)} alt="" />,
}));

const now = new Date("2026-07-14T00:00:00Z");

const article = (over: Partial<NewsArticle> = {}): NewsArticle => ({
  slug: "standing-dead-still-standing-somewhere-gabefox101-7-3",
  trigger: "standing_dead", gamertag: "GabeFox101", map: "chernarusplus", mapSlug: "chernarus",
  lifeNumber: 3, headline: "Still Standing, Somewhere",
  lede: "Nobody has had word since Tuesday.", tags: ["News", "Chernarus", "The Standing Dead"],
  subjectCount: 1, createdAt: "2026-07-12T00:00:00Z",
  body: "Flat fallback paragraph.\n\nSecond flat paragraph.",
  bodyBlocks: null, pullQuote: { text: "He was here on Tuesday.", attribution: "a quartermaster" },
  imageUrl: null, imageCaption: null, retracted: false,
  timeAliveSeconds: 5600, kills: 0, idleSeconds: 259200, spanSeconds: null,
  subjects: [{ gamertag: "GabeFox101", mapSlug: "chernarus", lifeNumber: 3 }],
  subjectStatus: { kind: "idle", idleDaysAtPublication: 3 },
  ...over,
});

// Fully typed, no cast: TimelineEvent's `birth` arm is
// { kind, at: Date, marker: "gray", timeLabel, title, line }.
const view = (alive: boolean): LifeTimelineView => ({
  alive,
  hero: { timeAliveSeconds: 5600, kills: 0, longestKillMeters: null, sessions: 2, qualified: true },
  events: [{
    kind: "birth", at: new Date("2026-07-11T00:00:00Z"), marker: "gray",
    timeLabel: "0h 00m IN", title: "Washed ashore", line: "Chernarus",
  }],
});

describe("NewsArticleView — the masthead and the standard furniture", () => {
  it("renders headline, dateline, lede, dossier, pull quote, tags and the related rail", () => {
    render(<NewsArticleView article={article()} more={[]} timelines={[]} now={now} />);
    expect(screen.getByRole("heading", { level: 1, name: /Still Standing, Somewhere/ })).toBeInTheDocument();
    expect(screen.getByText(/CHERNARUS BUREAU/)).toBeInTheDocument();
    expect(screen.getByText("Nobody has had word since Tuesday.")).toBeInTheDocument();
    expect(screen.getByText("Idle")).toBeInTheDocument();          // dossier
    expect(screen.getByText(/He was here on Tuesday/)).toBeInTheDocument();
    expect(screen.getByText("The Standing Dead")).toBeInTheDocument();  // a tag
    expect(screen.getByRole("link", { name: "GabeFox101" })).toHaveAttribute("href", "/players/gabefox101");
  });

  it("renders no hero image when imageUrl is absent", () => {
    render(<NewsArticleView article={article()} more={[]} timelines={[]} now={now} />);
    expect(document.querySelector("img")).toBeNull();
  });

  it("renders the hero image and its caption when one exists", () => {
    render(<NewsArticleView
      article={article({ imageUrl: "/media/heroes/x.png", imageCaption: "A ROOM, RECENTLY LEFT" })}
      more={[]} timelines={[]} now={now} />);
    expect(document.querySelector("img")).toBeTruthy();
    expect(screen.getByText("A ROOM, RECENTLY LEFT")).toHaveClass("border-ink");
  });
});

describe("NewsArticleView — the rich body", () => {
  it("renders the FLAT fallback when bodyBlocks is null", () => {
    render(<NewsArticleView article={article()} more={[]} timelines={[]} now={now} />);
    expect(screen.getByText("Flat fallback paragraph.")).toBeInTheDocument();
    expect(screen.getByText("Second flat paragraph.")).toBeInTheDocument();
  });

  // NEWS IS THE FIRST KIND TO POPULATE body_blocks. Every live interior before this took the flat
  // fallback, so this is the first time ArticleBody's blocks path renders in production.
  it("renders the BLOCKS path when bodyBlocks is present, and drops an unknown block type", () => {
    render(<NewsArticleView
      article={article({
        bodyBlocks: [
          { type: "para", text: "Block prose." },
          { type: "subhead", text: "The Long Middle" },
          { type: "list", items: ["one", "two"] },
          // A block type this build does not know about. ArticleBody's switch ends in
          // `default: return null`, so it is DROPPED rather than crashing the page.
          { type: "future-kind", text: "should vanish" } as never,
        ],
      })}
      more={[]} timelines={[]} now={now} />);
    expect(screen.getByText("Block prose.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "The Long Middle" })).toBeInTheDocument();
    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.queryByText("should vanish")).toBeNull();
    // The flat body must NOT also render — blocks take precedence.
    expect(screen.queryByText("Flat fallback paragraph.")).toBeNull();
  });

  // PR-C2's schema admits a `quote` BLOCK and a standalone `pullQuote` INDEPENDENTLY, and nothing
  // in the prompt discourages using both. ArticleBody renders a `quote` block as a PullQuote, so
  // without the render-side guard a model that puts its best line in each place ships two
  // identical stacked blockquotes. This is the first PR where that can happen in production.
  it("renders exactly ONE pull quote when the blocks already carry a quote", () => {
    const { container } = render(<NewsArticleView
      article={article({
        bodyBlocks: [
          { type: "para", text: "Block prose." },
          { type: "quote", text: "He was here on Tuesday.", attribution: "a quartermaster" },
        ],
      })}
      more={[]} timelines={[]} now={now} />);
    // The base fixture's `pullQuote` carries the very same line — the realistic duplicate.
    expect(container.querySelectorAll("blockquote")).toHaveLength(1);
    expect(screen.getAllByText(/He was here on Tuesday/)).toHaveLength(1);
  });

  it("still renders the standalone pull quote when the blocks carry none", () => {
    const { container } = render(<NewsArticleView
      article={article({ bodyBlocks: [{ type: "para", text: "Block prose." }] })}
      more={[]} timelines={[]} now={now} />);
    expect(container.querySelectorAll("blockquote")).toHaveLength(1);
    expect(screen.getByText(/He was here on Tuesday/)).toBeInTheDocument();
  });
});

describe("NewsArticleView — the status line", () => {
  it("renders for a Standing Dead piece", () => {
    render(<NewsArticleView article={article()} more={[]} timelines={[]} now={now} />);
    expect(screen.getByText(/AS OF PUBLICATION, 3 DAYS WITHOUT A SIGHTING/i)).toBeInTheDocument();
  });

  it("is absent for a Long Form piece", () => {
    render(<NewsArticleView
      article={article({ trigger: "long_form", subjectStatus: null, idleSeconds: null, spanSeconds: 27, subjectCount: 2 })}
      more={[]} timelines={[]} now={now} />);
    expect(screen.queryByText(/WITHOUT A SIGHTING/i)).toBeNull();
  });

  it("prints a retraction banner when the piece has been de-published", () => {
    render(<NewsArticleView
      article={article({ retracted: true, subjectStatus: { kind: "returned", seenAt: "2026-07-16T09:00:00Z" } })}
      more={[]} timelines={[]} now={now} />);
    expect(screen.getByText(/RETRACTED/i)).toBeInTheDocument();
    expect(screen.getByText(/SUBJECT WAS SEEN AGAIN ON 16 JUL 2026/i)).toBeInTheDocument();
  });

  it("suppresses the hero photo on a retracted piece — its bytes 404 behind the published-only media route", () => {
    render(<NewsArticleView
      article={article({ retracted: true, imageUrl: "/media/heroes/x.png", imageCaption: "GONE" })}
      more={[]} timelines={[]} now={now} />);
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("NewsArticleView — the timeline embed", () => {
  it("renders ONE timeline for a Standing Dead piece, with the positions-withheld notice", () => {
    render(<NewsArticleView
      article={article()} more={[]}
      timelines={[{ gamertag: "GabeFox101", view: view(true) }]} now={now} />);
    expect(screen.getAllByText(/Washed ashore/)).toHaveLength(1);
    expect(screen.getByText("Positions withheld")).toBeInTheDocument();
  });

  it("renders TWO timelines for a Long Form piece, each headed by its subject", () => {
    const timelines: NewsTimeline[] = [
      { gamertag: "CUPID18", view: view(false) },
      { gamertag: "GabeFox101", view: view(false) },
    ];
    render(<NewsArticleView
      article={article({ trigger: "long_form", subjectCount: 2, subjectStatus: null, idleSeconds: null, spanSeconds: 27 })}
      more={[]} timelines={timelines} now={now} />);
    expect(screen.getByRole("heading", { level: 2, name: /CUPID18/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /GabeFox101/ })).toBeInTheDocument();
    expect(screen.getAllByText(/Washed ashore/)).toHaveLength(2);
  });

  it("degrades to the timelines that loaded when one subject's is unavailable", () => {
    render(<NewsArticleView
      article={article({ trigger: "long_form", subjectCount: 2, subjectStatus: null, idleSeconds: null, spanSeconds: 27 })}
      more={[]} timelines={[{ gamertag: "CUPID18", view: view(false) }]} now={now} />);
    expect(screen.getByRole("heading", { level: 2, name: /CUPID18/ })).toBeInTheDocument();
    expect(screen.getAllByText(/Washed ashore/)).toHaveLength(1);
  });

  it("renders no timeline section at all when none loaded", () => {
    render(<NewsArticleView article={article()} more={[]} timelines={[]} now={now} />);
    expect(screen.queryByText(/Washed ashore/)).toBeNull();
  });
});

// ── THE §11 FOG RAIL, RENDERED HALF ──
// The source half (fixtures whose `positions` rows DO carry coordinates) is asserted in
// packages/read-models/test/news-articles.test.ts. This half asserts nothing coordinate-shaped
// survives into the DOM, in two cases: a REALISTIC article with every optional field populated
// (which documents the shipped shape but, having no coordinate to leak, cannot itself fail), and a
// deliberately POISONED one that hands the component real coordinates on both of the interior's
// data sources. The second is the load-bearing one — see its comment.
describe("NewsArticleView — the Fog Rule reaches the rendered page", () => {
  // The SAME eight keys as COORDINATE_KEYS in apps/newsdesk/test/news-facts.test.ts and in the
  // three files Task 1 repairs. One canonical set across the repo — no `z`, since `positions` has
  // no such column and a divergent list confuses the next person porting the helper.
  const COORDINATE_KEYS = ["x", "y", "posX", "posY", "coordX", "coordY", "lat", "lon"];

  function collectKeys(value: unknown, keys: Set<string> = new Set()): Set<string> {
    if (value instanceof Date) return keys;
    if (Array.isArray(value)) {
      for (const item of value) collectKeys(item, keys);
    } else if (value !== null && typeof value === "object") {
      for (const [key, val] of Object.entries(value)) {
        keys.add(key);
        collectKeys(val, keys);
      }
    }
    return keys;
  }

  it("renders no coordinate key and no coordinate-shaped number anywhere in the interior", () => {
    const a = article({
      imageUrl: "/media/heroes/x.png", imageCaption: "A ROOM, RECENTLY LEFT",
      bodyBlocks: [{ type: "para", text: "Block prose." }, { type: "list", items: ["one"] }],
    });
    const keys = collectKeys(a);
    for (const forbidden of COORDINATE_KEYS) expect(keys.has(forbidden)).toBe(false);

    const { container } = render(<NewsArticleView
      article={a} more={[]}
      timelines={[{ gamertag: "GabeFox101", view: view(true) }]} now={now} />);
    const text = container.textContent ?? "";
    // 812.4 is a real near-edge coordinate that /\d{4}\.\d/ misses, so match ANY 3-to-5 digit
    // decimal — the interior legitimately renders no decimal number at all.
    expect(text).not.toMatch(/\d{3,5}\.\d/);
    expect(text).toContain("Positions withheld");
  });

  // THE ASSERTION ABOVE, ON ITS OWN, CANNOT FAIL. Its fixture contains no coordinate at any depth
  // — it proves that itself with the key walk — so `not.toMatch` holds for any implementation short
  // of one that fabricates a decimal from nothing. That is precisely the vacuity Task 1 exists to
  // repair. This second case supplies coordinate-BEARING input instead: the component is handed
  // real coordinates on both of the interior's two data sources (the article DTO and a timeline
  // event) and must render neither. It fails the moment NewsArticleView renders a field it was
  // handed rather than one it was designed to render — which is the property §11 actually needs.
  it("renders neither coordinate when it is HANDED coordinates on both data sources", () => {
    // `as unknown as Partial<NewsArticle>`, NOT `as never`: spreading a `never` is TS2698
    // ("Spread types may only be created from object types") and would fail `typecheck` even
    // though vitest strips it. These casts are the point of the fixture — they smuggle a field
    // past the type system that the component was never designed to receive.
    const poisoned = article({
      imageUrl: "/media/heroes/x.png", imageCaption: "A ROOM, RECENTLY LEFT",
      ...({ x: 7423.51, y: 812.4 } as unknown as Partial<NewsArticle>),
    });
    const poisonedView: LifeTimelineView = {
      ...view(true),
      events: [
        { ...view(true).events[0]!, x: 7423.51, y: 812.4 } as unknown as LifeTimelineView["events"][number],
      ],
    };

    // Guard the guard: if these ever stop holding, the fixture has silently gone clean again and
    // the assertions below revert to proving nothing.
    expect(collectKeys(poisoned).has("x")).toBe(true);
    expect(collectKeys(poisonedView).has("y")).toBe(true);

    const { container } = render(<NewsArticleView
      article={poisoned} more={[]}
      timelines={[{ gamertag: "GabeFox101", view: poisonedView }]} now={now} />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("7423.51");
    expect(text).not.toContain("812.4");   // the near-edge value /\d{4}\.\d/ would have missed
    expect(text).not.toMatch(/\d{3,5}\.\d/);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
pnpm --filter @onelife/web exec vitest run src/components/news/news-article.test.tsx
```

Expected: FAIL — `Failed to resolve import "./news-article"`.

- [ ] **Step 3: Create the interior view**

Create `apps/web/src/components/news/news-article.tsx`:

```tsx
import type { ReactNode } from "react";
import { GamertagLink } from "@/components/gamertag-link";
import { ArticleHero } from "@/components/shared/article-hero";
import { ArticleBody } from "@/components/shared/article-body";
import { PullQuote } from "@/components/shared/pull-quote";
import { Timeline } from "@/components/life/timeline";
import { NewsStatusLine } from "./news-status-line";
import { NewsDossier } from "./news-dossier";
import { MoreFromTheDesk } from "./more-from-the-desk";
import type { NewsArticle, NewsCard } from "@/lib/types";
import type { LifeTimelineView } from "@/lib/life-timeline";
import { newsDateline, triggerLabel } from "@/lib/news-format";
import { mapLabel } from "@/components/player/format";
import { cn } from "@/lib/utils";

/** One subject's record, already built by the route. The gamertag is carried alongside the view
 *  because two unlabelled parallel timelines are unreadable. */
export type NewsTimeline = { gamertag: string; view: LifeTimelineView };

/**
 * At most two records are embedded. A Long Form clique is a pair in every verified production
 * cluster, and beyond two the side-by-side comparison — the whole visual argument of the format —
 * stops being legible. A theoretical third subject is still named in the prose and the dossier's
 * subject count; only their timeline is omitted.
 */
export const NEWS_TIMELINE_LIMIT = 2;

export function NewsArticleView({
  article,
  more,
  timelines,
  now,
}: {
  article: NewsArticle;
  more: NewsCard[];
  timelines: NewsTimeline[];
  now: Date;
}): ReactNode {
  const shown = timelines.slice(0, NEWS_TIMELINE_LIMIT);
  const parallel = shown.length > 1;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10 md:px-10">
      <div className="border-b-[3px] border-ink pb-5">
        <p className="font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted">
          {triggerLabel(article.trigger)} · {newsDateline(article.map, article.createdAt, now)}
        </p>
        <h1 className="mt-2 font-display text-5xl font-bold uppercase leading-[.92] text-ink md:text-6xl">{article.headline}</h1>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          Filed by The Desk · <GamertagLink gamertag={article.gamertag} className="font-bold text-ink underline" /> · {mapLabel(article.map)}
        </p>
      </div>

      {/* A retracted piece never shows its photo: the media route serves bytes only for
          status='published', so the <img> would resolve to a 404 and render broken. The
          retraction banner is the honest replacement. */}
      {article.retracted ? (
        <p className="mt-6 border-[3px] border-red px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-[.08em] text-red">
          Retracted — the subject acted, and this filing no longer describes the world.
        </p>
      ) : article.imageUrl ? (
        <ArticleHero src={article.imageUrl} caption={article.imageCaption} accent="ink" />
      ) : null}

      <p className="mt-6 font-mono text-[15px] font-bold leading-relaxed text-ink">{article.lede}</p>

      {/* Spec §4.1.3: computed at request time, never regenerated prose. Standing Dead only. */}
      {article.subjectStatus && <NewsStatusLine status={article.subjectStatus} />}

      <div className="mt-5">
        <NewsDossier article={article} />
      </div>

      {/* News is the first kind whose writer populates body_blocks; `blocks` takes precedence and
          a null/absent value falls back to splitting the flat body, byte-identically to every
          pre-R5d article. */}
      <ArticleBody blocks={article.bodyBlocks} fallback={article.body} className="mt-5" />

      {/* ONE pull quote, never two. PR-C2's schema admits a `quote` BLOCK (news-prompt.ts) and a
          standalone `pullQuote` independently, and nothing in the prompt discourages using both —
          a model that puts its best line in each ships two identical stacked blockquotes.
          ArticleBody already renders a `quote` block AS a PullQuote, so the standalone one is
          suppressed when the blocks carry one. Fixed render-side rather than at the writer or the
          read-model: it repairs rows already written, needs no change to frozen article data, and
          is reversible. */}
      {article.pullQuote && !article.bodyBlocks?.some((b) => b.type === "quote") && (
        <PullQuote text={article.pullQuote.text} attribution={article.pullQuote.attribution} />
      )}

      {article.tags.length > 0 && (
        <p className="mt-6 flex flex-wrap gap-2">
          {article.tags.map((t) => (
            <span key={t} className="border border-dash px-2 py-1 font-mono text-[10px] uppercase tracking-[.06em] text-ink-muted">{t}</span>
          ))}
        </p>
      )}

      {shown.length > 0 && (
        <div className={cn("mt-8", parallel && "grid gap-x-8 gap-y-6 lg:grid-cols-2 lg:divide-x lg:divide-hairline")}>
          {shown.map((t, i) => (
            <div key={t.gamertag} className={cn(parallel && i > 0 && "lg:pl-8")}>
              <Timeline
                view={t.view}
                heading={parallel ? `${t.gamertag} — The Final Reload` : "The Record So Far"}
              />
            </div>
          ))}
        </div>
      )}

      <MoreFromTheDesk rows={more} />
    </main>
  );
}
```

- [ ] **Step 4: Run the test — expect PASS**

```bash
pnpm --filter @onelife/web exec vitest run src/components/news/news-article.test.tsx
```

Expected: PASS, 17 tests (3 masthead + 4 rich body + 4 status line + 4 timeline + 2 Fog Rule).

- [ ] **Step 5: Typecheck and commit**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
pnpm --filter @onelife/web run typecheck
git add apps/web/src/components/news/news-article.tsx apps/web/src/components/news/news-article.test.tsx
git commit -m "feat(web): the news interior view

One timeline for a Standing Dead piece, two side-by-side for a Long Form —
parallel records converging on the same minute are the flagship's visual
argument. Both degrade to whatever loaded. A retracted piece swaps its hero
photo for a retraction banner, because the media route serves bytes only for
status='published' and the image would 404."
```

---

## Task 11: The routes, and retiring the teaser

This is where the teaser retires and `robots: { index: false }` comes off `/news`. Per the repo's voice-first rule, a teaser retires only when its content-engine slice ships; this is that moment.

**Files:**
- Modify: `apps/web/src/app/news/page.tsx` (teaser → feed)
- Create: `apps/web/src/app/news/loading.tsx`
- Create: `apps/web/src/app/news/[slug]/loading.tsx`
- Create: `apps/web/src/app/news/[slug]/page.tsx`
- Create: `apps/web/src/app/news/[slug]/opengraph-image.tsx`
- Create: `apps/web/src/app/news/[slug]/{oswald-700,plex-mono-400,plex-mono-700}.ttf`
- Delete: `apps/web/src/components/teaser-page.tsx`, `apps/web/src/components/teaser-page.test.tsx`

**Interfaces:**
- Consumes: `getNewsFeed`/`getNewsArticle` (Task 7), `newsHref`/`newsArticleHref`/`newsDateline`/`newsDossierFacts`/`triggerLabel` (Task 8), `NewsCard`/`NewsPagination` (Task 9), `NewsArticleView`/`NewsTimeline`/`NEWS_TIMELINE_LIMIT` (Task 10), `newsLd`/`ldScript`/`absoluteUrl` (Task 8 + existing), `getPlayerLife`/`buildTimeline`/`playerSlug` (existing), `ObituariesSkeleton`/`ArticleHeroSkeleton` (existing — Step 3 is what finally renders the latter, making Task 2 Step 5's comment true).
- Produces: the public routes. Nothing later consumes them.

- [ ] **Step 1: Copy the OG font assets**

The OG runtime reads fonts from disk via `fs.readFile` on a co-located URL; each route segment needs its own copies (this is the existing pattern in both `obituaries/[slug]` and `fresh-spawns/[slug]`).

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
mkdir -p apps/web/src/app/news/\[slug\]
cp apps/web/src/app/obituaries/\[slug\]/oswald-700.ttf \
   apps/web/src/app/obituaries/\[slug\]/plex-mono-400.ttf \
   apps/web/src/app/obituaries/\[slug\]/plex-mono-700.ttf \
   apps/web/src/app/news/\[slug\]/
ls apps/web/src/app/news/\[slug\]/
```

Expected: three `.ttf` files listed.

- [ ] **Step 2: Replace the teaser with the real feed**

Replace the whole of `apps/web/src/app/news/page.tsx` with:

```tsx
import type { Metadata } from "next";
import { getNewsFeed } from "@/lib/api";
import { Kicker } from "@/components/tabloid/kicker";
import { NewsCard } from "@/components/news/news-card";
import { NewsPagination } from "@/components/news/news-pagination";
import { newsHref } from "@/lib/news-format";
import { absoluteUrl } from "@/lib/seo";
import { parsePage } from "@/lib/board-params";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// The static teaser is retired as of R5d PR-C3, so `robots: { index: false }` is GONE — the
// voice-first rule holds that a teaser stays up until its content-engine slice ships, and it has.
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const page = parsePage((await searchParams).page);
  const title = page > 1 ? `News · Page ${page}` : "News";
  const description = "Features from the One Life desk — the survivors who stopped, and the ones who ended together.";
  const canonical = absoluteUrl(newsHref(page));
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

export default async function NewsPage({ searchParams }: Props) {
  const page = parsePage((await searchParams).page);
  const feed = await getNewsFeed(page);
  const now = new Date();

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10">
      <div className="border-b-[3px] border-ink pb-4">
        <Kicker color="ink">The Desk</Kicker>
        <h1 className="mt-2 font-display text-5xl font-bold uppercase leading-[.95] text-ink md:text-6xl">News</h1>
      </div>

      {feed.rows.length === 0 ? (
        <p className="py-16 font-mono text-sm uppercase tracking-[.05em] text-ink-muted">
          Nothing filed this week. The desk does not pad — a slow week gets a shorter paper.
        </p>
      ) : (
        <>
          {feed.rows.map((card) => (
            <NewsCard key={card.slug} card={card} now={now} />
          ))}
          <NewsPagination page={feed.page} total={feed.total} pageSize={feed.pageSize} />
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Add the two route-level skeletons**

Create `apps/web/src/app/news/loading.tsx`:

```tsx
import { ObituariesSkeleton } from "@/components/skeletons";

/** The news feed's cards are the same shape as the morgue's — dateline, headline, dek — so it
 *  reuses the same skeleton, exactly as the fresh-spawns route does. */
export default function Loading() {
  return <ObituariesSkeleton />;
}
```

Then create `apps/web/src/app/news/[slug]/loading.tsx`:

```tsx
import { ArticleHeroSkeleton } from "@/components/skeletons";

/** The interior's own skeleton. Without this file the feed-segment `news/loading.tsx` above would
 *  serve `/news/[slug]` too — a FEED skeleton for an ARTICLE, which is what `obituaries/loading.tsx`
 *  currently does for the obituary interior. News is the only kind that renders a hero image, so a
 *  4:5 photo frame is the honest placeholder here. This is also what makes Task 2 Step 5's replacement
 *  comment on `ArticleHeroSkeleton` true: before this file, nothing rendered it. */
export default function Loading() {
  return (
    // aria-busy matches ObituariesSkeleton's own <main>, which this file's sibling reuses.
    <main aria-busy="true" className="mx-auto w-full max-w-3xl px-6 py-10 md:px-10">
      <ArticleHeroSkeleton />
    </main>
  );
}
```

Confirm `ArticleHeroSkeleton` is exported from `apps/web/src/components/skeletons.tsx` before writing this (it is — it is the declaration whose comment Task 2 Step 5 corrected).

- [ ] **Step 4: Create the interior route**

Create `apps/web/src/app/news/[slug]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getNewsArticle, getNewsFeed, getPlayerLife } from "@/lib/api";
import { buildTimeline } from "@/lib/life-timeline";
import { NewsArticleView, NEWS_TIMELINE_LIMIT, type NewsTimeline } from "@/components/news/news-article";
import { newsLd, absoluteUrl, ldScript } from "@/lib/seo";
import { newsArticleHref } from "@/lib/news-format";
import { playerSlug } from "@/lib/slug";
import type { NewsArticle, NewsSubjectRef } from "@/lib/types";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const a = await getNewsArticle(slug).catch(() => null);
  if (!a) return { title: "News — One Life" };
  const title = `${a.headline} — One Life`;
  const canonical = absoluteUrl(newsArticleHref(slug));
  return {
    title,
    description: a.lede,
    // A RETRACTED feature keeps its URL — a reader who followed a shared link deserves the
    // correction rather than a 404 — but it must leave the index. It is already absent from the
    // feed and from the related rail, both of which read the published-only feed query.
    ...(a.retracted ? { robots: { index: false, follow: false } } : {}),
    alternates: { canonical },
    openGraph: { title, description: a.lede, url: canonical, type: "article" },
    twitter: { card: "summary_large_image", title, description: a.lede },
  };
}

/**
 * Which records to embed. A Standing Dead piece has one subject — the article's own primary. A
 * Long Form piece embeds up to NEWS_TIMELINE_LIMIT subjects, in facts order (gamertag ascending),
 * fetched in parallel.
 *
 * Every ref guards on `mapSlug !== null` (an un-slugged server has no life-timeline URL) and every
 * fetch is individually caught, so one unavailable record degrades to the ones that loaded rather
 * than taking down the page — the same graceful degradation the obituary interior already does.
 */
async function loadTimelines(a: NewsArticle, now: Date): Promise<NewsTimeline[]> {
  const refs: NewsSubjectRef[] = a.trigger === "long_form"
    ? a.subjects.slice(0, NEWS_TIMELINE_LIMIT)
    : [{ gamertag: a.gamertag, mapSlug: a.mapSlug, lifeNumber: a.lifeNumber }];

  const loaded = await Promise.all(refs.map(async (r) => {
    if (!r.mapSlug) return null;
    const life = await getPlayerLife(playerSlug(r.gamertag), r.mapSlug, r.lifeNumber).catch(() => null);
    return life ? { gamertag: r.gamertag, view: buildTimeline(life, now) } : null;
  }));

  return loaded.filter((t): t is NewsTimeline => t !== null);
}

export default async function NewsArticlePage({ params }: Props) {
  const { slug } = await params;
  const article = await getNewsArticle(slug);
  if (!article) notFound();
  const now = new Date();

  const [timelines, feed] = await Promise.all([
    loadTimelines(article, now),
    getNewsFeed(1).catch(() => ({ rows: [], total: 0, page: 1, pageSize: 20 })),
  ]);
  // The feed is published-only, so a retracted feature can never be recommended here.
  const more = feed.rows.filter((r) => r.slug !== article.slug).slice(0, 4);

  const ld = newsLd(article, absoluteUrl(newsArticleHref(slug)));

  return (
    <>
      {/* ldScript(), never raw JSON.stringify: an LLM-authored headline can contain </script>. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldScript(ld) }} />
      <NewsArticleView article={article} more={more} timelines={timelines} now={now} />
    </>
  );
}
```

- [ ] **Step 5: Create the OG card**

Create `apps/web/src/app/news/[slug]/opengraph-image.tsx`:

```tsx
import { readFile } from "node:fs/promises";
import { ImageResponse } from "next/og";
import { getNewsArticle } from "@/lib/api";
import { newsDateline, newsDossierFacts, triggerLabel } from "@/lib/news-format";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "One Life news feature";

// The Node OG runtime's `fetch` cannot read file: URLs, so assets are read off disk.
const asset = (name: string) => readFile(new URL(`./${name}`, import.meta.url));

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [article, oswald, mono, monoBold] = await Promise.all([
    getNewsArticle(slug).catch(() => null),
    asset("oswald-700.ttf"),
    asset("plex-mono-400.ttf"),
    asset("plex-mono-700.ttf"),
  ]);

  const headline = article?.headline ?? "A News Feature";
  const line = article
    ? `${triggerLabel(article.trigger)} · ${newsDateline(article.map, article.createdAt, new Date())}`
    : "ONE LIFE · THE DESK";
  // Text-only in this slice — see the Self-Review's deferral note; the photo panel is out of scope
  // here, not a parity choice. The dossier figures are read-model facts: playtime and idle time,
  // never a coordinate.
  const facts = article ? newsDossierFacts(article) : [];
  // THE UNFURL IS A DISCOVERY SURFACE. `noindex` on the interior addresses crawlers and does
  // nothing for a Discord/Slack/X unfurl — and unfurling is load-bearing here, since the obituary
  // notifier depends on it. Without this stamp the first thing a reader of a shared link sees is
  // the now-false headline, unmarked, BEFORE they click through to the correction.
  const retracted = article?.retracted === true;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0C0C08", color: "#FBFAF2", padding: 64 }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {retracted ? (
            // The card's existing vocabulary: the mono kicker face, the red the interior's
            // retraction banner already uses, boxed like the dossier's hot figures.
            <div style={{ display: "flex", alignSelf: "flex-start", border: "4px solid #FF6B63", color: "#FF6B63", fontFamily: "IBM Plex Mono", fontWeight: 700, fontSize: 30, letterSpacing: 6, textTransform: "uppercase", padding: "6px 18px", marginBottom: 18 }}>
              Retracted
            </div>
          ) : null}
          <div style={{ display: "flex", fontFamily: "IBM Plex Mono", fontSize: 22, letterSpacing: 2, color: "#8A8878", textTransform: "uppercase" }}>{line}</div>
          <div style={{ display: "flex", fontFamily: "Oswald", fontWeight: 700, fontSize: 78, lineHeight: 1.02, textTransform: "uppercase", marginTop: 20, maxWidth: 1000, opacity: retracted ? 0.55 : 1 }}>{headline}</div>
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

**No automated test covers the retracted branch, and this plan does not pretend otherwise.** Nothing under `apps/web/src/app` has a test file — no route, page or `opengraph-image.tsx` in this repo is unit-tested, and `ImageResponse` needs the Next OG runtime, which the jsdom Vitest project does not provide. Inventing a bespoke harness for one branch is out of proportion to the change. Verify it by hand instead, once `pnpm --filter @onelife/web run build` in Step 9 has passed:

```bash
# In a separate shell, with the API running:
pnpm --filter @onelife/web run start
# Then open a published feature's card and a retracted one's, and confirm only the second is stamped:
#   http://localhost:3000/news/<published-slug>/opengraph-image
#   http://localhost:3000/news/<retracted-slug>/opengraph-image
```

If no retracted news row exists yet, `UPDATE articles SET status='retracted' WHERE slug='<a news slug>'` against the **local** database only, check the card, then set it back. Never against production.

The JSON-LD half of the same gap **is** covered — `newsLd`'s retracted qualification is pinned in `apps/web/src/lib/seo.test.ts` (Task 8, Step 5).

- [ ] **Step 6: Confirm there is no sitemap to update**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
find apps/web/src -name "sitemap*" -o -name "robots.ts" -o -name "robots.txt"
```

Expected: **no output.** The repo ships no `sitemap.ts` and no `robots.ts`, so there is no third discovery surface a retracted article could leak through. If this command prints a path, read that file and add a `status='published'` filter to any news enumeration in it before continuing.

- [ ] **Step 7: Delete the now-orphaned `TeaserPage` component**

`/news` was its **last** consumer — Obituaries retired its teaser in R5a and Fresh Spawns in R5b. Confirm, then delete:

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
grep -rn "TeaserPage" apps/web/src | grep -v "components/teaser-page"
```

Expected: **no output** (the only remaining matches are the component and its own test). If anything else prints, stop and leave the component in place.

```bash
git rm apps/web/src/components/teaser-page.tsx apps/web/src/components/teaser-page.test.tsx
```

All three teasers are gone and the voice-first rule plans no more, so this is dead code. `header.test.tsx` asserts the *nav label* "News", which still exists — do not touch it. If a future section ever wants a teaser again, the component is one `git show` away.

- [ ] **Step 8: Run the whole web suite and typecheck**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
pnpm --filter @onelife/web run typecheck
pnpm --filter @onelife/web run test
```

Expected: PASS.

- [ ] **Step 9: Build, to catch anything only the Next compiler sees**

```bash
pnpm --filter @onelife/web run build
```

Expected: a successful build with `/news` and `/news/[slug]` in the route list. A failure here is usually a server/client boundary mistake — `NewsArticleView` and every component under `components/news/` are server components and must not import a hook.

- [ ] **Step 10: Commit**

```bash
# ONLY the route tree is added here. Step 7's `git rm` ALREADY STAGED both teaser deletions, and
# after a `git rm` those paths exist in neither the worktree nor the index — naming them here
# would abort the whole `git add` with `fatal: pathspec ... did not match any files` (exit 128),
# having staged nothing, while the `git commit` below still ran and landed a commit containing the
# deletions but not the feed page, interior route, OG card, .ttf assets or the two loading.tsx.
git add apps/web/src/app/news
git commit -m "feat(web): the /news feed and interior, retiring the teaser

robots:{index:false} comes off /news — the voice-first rule holds that a teaser
retires when its content-engine slice ships, and R5d is that slice. A retracted
feature keeps its URL and gains noindex; it is absent from the feed, from the
related rail (which reads the same published-only query), and its hero bytes
already 404 behind the published-only media route. There is no sitemap."
```

---

## Task 12: Full verification, CHANGELOG and CLAUDE.md

Both files are required by a committed guard in `.claude/hooks/guard.py` before `gh pr create`. CLAUDE.md is updated **last**, per the workflow.

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: every prior task.
- Produces: a PR-ready branch.

- [ ] **Step 1: Run the full gate, forced**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5434/onelife_test" \
  pnpm turbo run test --concurrency=1 --force
pnpm turbo run typecheck --force
```

Expected: PASS across every package. `--force` is mandatory — the turbo cache key omits `TEST_DATABASE_URL`, so an unforced run can report a stale green.

- [ ] **Step 2: Update CHANGELOG.md**

Replace:

```markdown
## [Unreleased]

### Added

### Changed

### Fixed
```

with:

```markdown
## [Unreleased]

### Added
- R5d PR-C3 — **the News surface.** `/news` is live: a reverse-chron feed and a full interior for
  the `kind='news'` features PR-C2's `newsTick` writes. New read-model
  `packages/read-models/src/news-articles.ts` (`getPublishedNews` / `getNewsArticleBySlug` /
  `getNewsSubjectStatus`), ordered **`created_at DESC`** rather than `death_at` — a Standing Dead
  feature has no death — served by the `articles_kind_status_created_idx` from migration `0014`.
  Public `GET /news` and `GET /news/:slug` are structural twins of the obituaries routes. The web
  surface mirrors `apps/web/src/app/obituaries/`: feed, `[slug]` interior, `loading.tsx`, a dynamic
  OG card, a `NewsArticle` JSON-LD block (through `ldScript()`, since an LLM headline can contain
  `</script>`), and a new `components/news/`.
- **The live status line** (spec §4.1.3). A Standing Dead feature is the only thing the paper
  prints that its subject can falsify by acting, so the interior computes a status line **at
  request time** — still idle ("as of publication, N days without a sighting"), returned
  ("UPDATE: subject was seen again on …"), or died since (with a link to the obituary when the
  morgue has filed). The prose above it is never regenerated. Death outranks return, and the return
  predicate mirrors `findReturnedStandingDead` exactly, so the page and the newsdesk
  de-publication sweep can never tell the reader different stories.
- **Two timelines for a Long Form feature**, one for a Standing Dead. Parallel records converging
  on the same minute are the flagship's visual argument; they stack on mobile and sit side by side
  from `lg` up. Both guard on `mapSlug !== null` and degrade to whatever loaded.
- `ArticleHero` gains an **`ink`** accent alongside `red` and `blue`. Morgue is red, Nursery is
  blue, yellow already means beef; on a feature the photograph carries the page. News is the only
  kind that renders a hero image (obituaries and birth notices lost theirs in v0.21.0).

### Changed
- **The static News teaser is retired**, which removes `robots: { index: false }` from the `/news`
  route. Per the repo's voice-first rule a teaser stays up until its content-engine slice ships;
  this is that moment. News was the last of the three, so the shared `TeaserPage` component (and
  its test) are deleted as dead code.
- **`ArticleBody`'s blocks path is live in production for the first time.** PR-B built it and PR-C2
  became the first writer to populate `articles.body_blocks`, but no shipped interior had ever
  rendered it. The news read-model selects and casts the column, and the interior renders blocks
  when present and the flat `body` when absent — an unknown block type is dropped by the switch's
  `default: return null` rather than crashing the page.

### Fixed
- **Three PR-C1 Fog Rule test rails were vacuous.** `long-form-cluster.test.ts`,
  `long-form-targets.test.ts` and `standing-dead-targets.test.ts` each used `/\d{4}\.\d/` as their
  *sole* coordinate assertion. That regex returns false for a short near-edge coordinate like
  `812.4`, so all three would have passed on a real leak — `long-form-targets.test.ts` most
  seriously, since it guards the `LongFormSubject` boundary spec §11 exists to protect. Each now
  uses the recursive key-presence walk PR-C2 established, with the regex kept only as a documented
  secondary signal. `standing-dead-targets.test.ts` additionally checked only the *top level* of
  each row, so a nested leak was invisible.
- **A retracted feature no longer leaks into any discovery surface.** It is excluded from the feed
  query (and therefore from "More From the Desk", which reads it), its interior is `noindex`ed, its
  hero bytes already 404 behind the media route's `status='published'` filter — so the interior
  renders a retraction banner in place of a broken photo — and there is no sitemap. **The OG unfurl
  card is stamped `RETRACTED` and its JSON-LD carries `creativeWorkStatus: "Retracted"`**: `noindex`
  addresses crawlers and does nothing for a Discord/Slack/X unfurl, which is the first thing a
  reader of a shared link sees, before they click. The URL keeps working: a reader who follows that
  link gets the correction, not a 404.
- **The interior can no longer print the same pull quote twice.** PR-C2's schema admits a `quote`
  block and a standalone `pullQuote` independently and nothing in the prompt discourages using both,
  so a model putting its best line in each would have shipped two identical stacked blockquotes —
  invisible until now, because no shipped interior had ever rendered `ArticleBody`'s blocks path.
  The standalone quote is suppressed render-side when the blocks already carry one, which also
  repairs rows already written.
- `newsShowingLine` follows the **birth** argument order `(page, total, pageSize)`, pinned by a test
  that fails on a swap. `obituaryShowingLine` is `(page, pageSize, total)` and every parameter is a
  `number`, so the mistake is entirely type-silent.
```

- [ ] **Step 3: Update the CLAUDE.md roadmap line**

Spec §3 moved the news-led home page out of R5d and into follow-ups; that roadmap line still promises it. Replace:

```markdown
  images, with **R5d** (News feed + news-led home) in flight —
  spec `docs/superpowers/specs/2026-07-18-r5d-news-vertical-design.md`, shipping in three PRs.
```

with:

```markdown
  images, and **R5d** (the News vertical) ✅ —
  spec `docs/superpowers/specs/2026-07-18-r5d-news-vertical-design.md`, shipped in three PRs.
  The news-led home page was cut from the slice and is a §15 follow-up; `/news` is a section, not
  the front page.
```

- [ ] **Step 4: Update the CLAUDE.md R5d status paragraph**

Replace:

```markdown
  **R5d in flight, PR-C1 (inert engine) + PR-C2 (`newsTick`, shipped disabled) done.** The news
```

with:

```markdown
  **R5d shipped — PR-C1 (inert engine), PR-C2 (`newsTick`, shipped disabled) and PR-C3 (the public
  surface) all landed. The pass is still OFF in production** until an operator sets both
  `NEWSDESK_NEWS_ENABLED=true` and an ISO `NEWSDESK_NEWS_SINCE`; `/news` renders an honest empty
  state until then. The news
```

- [ ] **Step 5: Correct the PR-C3 forward-reference**

Replace:

```markdown
  (`findImageTargets` excludes only `obituary`/`birth_notice`) while PR-C3 (the web surface that
  would render a news hero image) hasn't shipped, pair `NEWSDESK_NEWS_ENABLED=true` with
  `NEWSDESK_IMAGES_ENABLED=false` until it does — otherwise every news article pays
  ~$0.004/article for a photo nothing displays. Full arithmetic and reasoning: `.env.example`.
  PR-C3 (read-model + API + web surface) follows.
```

with:

```markdown
  (`findImageTargets` excludes only `obituary`/`birth_notice`), and **PR-C3 has now shipped the
  surface that renders it** — the news interior displays the hero photo through `ArticleHero`
  (`accent="ink"`), so `NEWSDESK_IMAGES_ENABLED` may be left at its `true` default when news goes
  live. Full arithmetic and reasoning: `.env.example`.
  **PR-C3 shipped — the public surface.** Read-model `packages/read-models/src/news-articles.ts`
  (`getPublishedNews` / `getNewsArticleBySlug` / `getNewsSubjectStatus`), ordered **`created_at
  DESC`** because a Standing Dead feature has no death (served by
  `articles_kind_status_created_idx`); public `GET /news` + `GET /news/:slug`; and a web surface
  mirroring `apps/web/src/app/obituaries/` — feed, `[slug]` interior, `loading.tsx`, dynamic OG
  card, `NewsArticle` JSON-LD via `ldScript()`, and `apps/web/src/components/news/`. Interior
  order: masthead → `ArticleHero` → lede → **status line** → dossier → `ArticleBody` → pull quote →
  tags → timelines → More From the Desk. **The status line (spec §4.1.3) is computed at request
  time and the prose is never regenerated** — still idle / returned / died-since, with death
  outranking return, and the return predicate mirroring `findReturnedStandingDead` so the page and
  the de-publication sweep cannot disagree. **Timelines: one for a Standing Dead piece, two side by
  side (`lg:grid-cols-2 lg:divide-x`) for a Long Form** — parallel records converging on the same
  minute are the flagship's visual argument — both guarding on `mapSlug !== null` and degrading to
  whatever loaded. **Retraction on the surface:** a retracted feature drops out of the feed (and
  therefore out of More From the Desk, which reads it), `noindex`es its interior, and swaps its
  hero photo for a retraction banner because the media route serves bytes only for
  `status='published'`; its URL keeps working so a shared link yields the correction, not a 404.
  There is no sitemap. **This is also where `ArticleBody`'s blocks path goes live in production for
  the first time** — PR-B built it and PR-C2 became its first writer, but no shipped interior had
  ever rendered it; the news read-model is the first to select and cast `body_blocks`.
  **`ArticleHero`'s `accent` is now `"red" | "blue" | "ink"`** (news uses `ink`), and the static
  **News teaser is retired**, removing `robots: { index: false }` from the route — the last of the
  three teasers to go.
  **`newsShowingLine` follows the BIRTH argument order `(page, total, pageSize)`**, pinned by a
  test: `obituaryShowingLine` is `(page, pageSize, total)` and all three parameters are `number`,
  so a swap is entirely type-silent.
```

- [ ] **Step 6: Retire the last "News stays static until R5d" claims**

There are two. They are not identical lines — quote enough context to hit each exactly.

Replace:

```markdown
  public `GET /obituaries` (now published articles) + `GET /obituaries/:slug`. News stays a static
  teaser until R5d.
```

with:

```markdown
  public `GET /obituaries` (now published articles) + `GET /obituaries/:slug`. (News stayed a static
  teaser until R5d PR-C3 retired it.)
```

Then replace:

```markdown
  ships. **Obituaries' teaser retired as of R5a; Fresh Spawns' teaser retired as of R5b**; News stays
  static until R5d.
```

with:

```markdown
  ships. **Obituaries' teaser retired as of R5a; Fresh Spawns' as of R5b; News' as of R5d PR-C3** —
  all three teasers are now gone.
```

- [ ] **Step 7: Re-run the full gate**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5434/onelife_test" \
  pnpm turbo run test --concurrency=1 --force
pnpm turbo run typecheck --force
```

Expected: PASS.

- [ ] **Step 8: Confirm nothing untracked is about to ride along**

```bash
git status --porcelain
```

Expected: only `CHANGELOG.md` and `CLAUDE.md` modified. **Production DB dumps at the repo root are gitignored and must never be committed** — stage explicit paths, never `git add -A` at the repo root.

- [ ] **Step 9: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: CHANGELOG and CLAUDE.md for R5d PR-C3

Records the news surface, the live status line, the two-timeline Long Form
embed, the retraction leak paths, the first production use of ArticleBody's
blocks path, the ink hero accent, the teaser retirement, and the three repaired
Fog Rule rails. Also corrects the roadmap line that still promised a news-led
home page — spec §3 moved it to follow-ups."
```

---

## Self-Review

**Spec coverage (§ by §):**

| Spec section | Task |
|---|---|
| §4.1.3 status line — idle / returned / died | 5 (read-model), 9 (component), 10 (interior) |
| §4.1.3 retraction on the surface | 3 (feed excludes), 4 (`retracted` flag), 6 (route), 8 (`newsLd` qualified), 10 (banner + hero suppression), 11 (`noindex`, OG `RETRACTED` stamp, no sitemap) |
| §4.1.4 Fog Rule, live subject | 1 (newsdesk rails), 5 (read-model, positions seeded), 8 (dossier), 10 (rendered interior) |
| §7 `ArticleHero` accent `ink` + skeleton reference | 2 |
| §8 rich body, blocks path live | 4 (select + cast), 10 (renders blocks, drops unknown type, falls back, never doubles the pull quote) |
| §9 read-model, `created_at DESC` | 3 |
| §9 API twins, no route can shadow `/news` | 6 |
| §9 web mirror: feed, interior, loading, OG, `components/news/` | 9, 10, 11 |
| §9 interior order | 10 |
| §9 one timeline SD / two LF, `mapSlug` guard, graceful degrade | 10 (view), 11 (fetch) |
| §9 `showingLine` arg-order trap | 8 (pure), 9 (call site) |
| §11 read-models project named columns only | 3 (`CARD_COLS` comment), 5 |
| §11 never wall-clock as survival time | 8 (`newsDossierFacts`, separate Idle row) |
| Teaser retirement + `robots` removal | 11 |
| `ldScript()` mandatory | 8 (`newsLd`), 11 (call site) |
| CHANGELOG + CLAUDE.md | 12 |
| Carried defect 1 — vacuous coordinate rails ×3 | 1 |
| Carried defect 2 — `showingLine` signature pin | 8, 9 |

**Not covered, and why:**
- **A News block on the home page** — spec §15 explicitly defers it, and §3 says the CLAUDE.md roadmap line promising it is corrected in PR-C (done in Task 12, Step 3).
- **A photo panel on the news OG card — deferred for scope, and this is the weakest of the three deferrals.** Do not read it as parity with the obituary and birth-notice cards: those are text-only because **v0.21.0 took their images away**, a condition news does not share. Spec §7 makes news the **only** vertical with images and argues the photo is what signals a piece is a feature, so the cost of deferring is that every shared `/news` link unfurls without that signal. It is deferred anyway because it is purely additive, independently testable, and R5c already built the fetch→data-URI path once — not because the card is "meant" to be text-only.
- **Discord notification for news** — spec §3 "Out of scope"; §15 defers the kind→path resolver.

**Type consistency:** `NewsCard`, `NewsFeed`, `NewsSubjectRef`, `NewsSubjectStatus`, `NewsTrigger` are declared once in `packages/read-models/src/news-articles.ts` (Tasks 3–5) with `Date` fields, and once in `apps/web/src/lib/types.ts` (Task 7) with ISO `string` fields — the same deliberate two-declaration pattern `ObituaryCard`/`BirthNoticeCard` already follow across the API boundary. The read-model's detail type is `NewsArticleDetail` and the web's is `NewsArticle`; they are never imported into each other. `NewsTimeline` and `NEWS_TIMELINE_LIMIT` are declared once, in Task 10, and consumed by Task 11. `ArticleBlock` is declared once in `obituary-articles.ts` and once in the web's `types.ts`, and Task 4 imports rather than redeclares it.

**Anchor audit:** every `Edit` in this plan quotes source that exists at the moment its task runs. The two multi-edit files are `packages/read-models/src/news-articles.ts` (Task 3 creates it; Task 4 edits the exact import lines Task 3 wrote and otherwise appends; Task 5 edits the exact import lines Task 4 left, edits the exact `subjectStatus: null` block Task 4 wrote, and otherwise appends) and `packages/read-models/test/news-articles.test.ts` (same pattern, with each later task appending a `describe` carrying its own nested `beforeAll` so no earlier fixture is edited). In `CLAUDE.md`, Task 12 Step 6 targets two superficially similar "News stays static" sentences; each anchor carries a preceding line that makes it unique.
