# Editorial Newsroom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the shipped `/news` surface into a human-in-the-loop editorial desk: a recurring Claude Code session explores the data, drafts an article, reviews it rendered on the real page behind a token gate, then publishes it.

**Architecture:** A delta on already-shipped code. R5d PR-C1/C2/C3 shipped the trigger read-models, the `newsTick` pass (disabled), and the whole public `/news` surface in v0.23.0–v0.25.0. This plan adds: migration `0016` (nullable subject columns, so an institutional piece needs no fake subject), a `newsFormatOf` classifier that teaches the surface a third article family, an editorial rendering arm, a token-gated draft preview, and a validated `newsroom` CLI that is the only write path. `newsTick` is never deleted — it stays shipped-and-disabled as the fallback if volume ever outgrows the desk.

**Tech Stack:** TypeScript/ESM, pnpm + turbo, Postgres + Drizzle, Fastify (API), Next.js App Router (web), vitest, zod.

## Global Constraints

- **Next free migration number is `0016`.** `0015` is `0015_notifications.sql` (v0.26.0).
- **`articles` is durable** — never truncated by the projector rebuild. **No `--rebuild` for this release.**
- **Never persist a row id** in `natural_key` or `facts` — `lives.id`/`players.id` do not survive a projector rebuild. Gamertags and ISO timestamps only.
- **No coordinates cross the boundary.** Nothing in this plan reads `events.payload` or `hit_events.x/y`.
- **Timestamps serialize as `toISOString()`** (UTC, ms precision). Gamertags appear **verbatim** as stored in `players`, never lowercased.
- **`kind` stays `'news'`.** Editorial formats (Almanac, Ledger) are `facts.format` values, never new `articles.kind` values.
- **Any `onConflictDoUpdate` targeting `articles_kind_server_gamertag_life_uniq` MUST pass `targetWhere: inArray(articles.kind, ["obituary","birth_notice"])`** or Postgres raises 42P10 and article publishing dies. Four existing call sites; this plan adds none.
- **A verdict that names a mechanism must be added to BOTH `ENTITY_MECHANISMS` (`@onelife/domain`) and `ENTITY_VERDICTS` (`apps/web/src/lib/cause-format.ts`).** They are duplicated deliberately — `apps/web` has no dependency on `@onelife/domain`.
- **The rail is paper; the mobile `ControlsSheet` is `bg-dark`.** Any component rendered on both needs a surface variant. RTL asserts the DOM, not contrast.
- Test command: `pnpm turbo run test --concurrency=1` (DB suites need `TEST_DATABASE_URL`). Typecheck: `pnpm turbo run typecheck`.
- Work happens in the worktree `/home/acab/worktrees/editorial-newsroom` on branch `feature/editorial-newsroom`. **Never `git checkout` in `/var/www/dayzonelife.com`** — it is the serving prod checkout and moving it makes `deploy.sh` silently no-op.

---

## File Structure

**Created:**

| Path | Responsibility |
| --- | --- |
| `packages/db/drizzle/0016_editorial_articles.sql` | Drop NOT NULL on the five subject columns |
| `apps/newsdesk/src/newsroom/contract.ts` | The zod payload schema + slug/body derivation. The format's documentation. |
| `apps/newsdesk/src/newsroom/lint.ts` | Brand-bible §9 Tier-1 bans, vendored verbatim |
| `apps/newsdesk/src/newsroom/store.ts` | draft/publish/unpublish/spike/list DB operations |
| `apps/newsdesk/src/newsroom/main.ts` | CLI arg parsing and output |
| `apps/newsdesk/test/newsroom-contract.test.ts` | Validation matrix |
| `apps/newsdesk/test/newsroom-store.test.ts` | State transitions (DB) |
| `apps/web/src/components/news/editorial-article.tsx` | The editorial interior arm |
| `apps/web/src/components/news/editorial-article.test.tsx` | Its unit tests |
| `.claude/skills/drafting-an-article/SKILL.md` | The session ritual |

**Modified:**

| Path | Change |
| --- | --- |
| `packages/db/src/schema.ts` | Five columns lose `.notNull()` |
| `packages/read-models/src/news-articles.ts` | `newsFormatOf`, nullable card fields, `includeDraft` |
| `packages/read-models/src/obituary-articles.ts`, `birth-notice-articles.ts` | `assertSubjectful` guard |
| `apps/api/src/routes/news.ts` | `?preview=` token gate |
| `apps/api/src/config.ts` | `NEWS_PREVIEW_TOKEN` |
| `apps/web/src/lib/types.ts` | Nullable `NewsCard` subject fields, `format`, `status` |
| `apps/web/src/lib/api.ts` | `getNewsArticle(slug, preview?)` |
| `apps/web/src/app/news/[slug]/page.tsx` | Editorial arm + preview passthrough + DRAFT banner |
| `apps/web/src/components/news/news-card.tsx` | Degrade when subject fields are null |
| `apps/newsdesk/package.json` | `"newsroom": "tsx src/newsroom/main.ts"` |
| `CHANGELOG.md`, `CLAUDE.md`, `.env.example` | Docs (CLAUDE.md last) |

---

### Task 1: Migration 0016 — nullable subject columns

**Files:**
- Create: `packages/db/drizzle/0016_editorial_articles.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/db/src/schema.ts:359-364`
- Test: `packages/read-models/test/articles-schema.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `articles.server_id`, `gamertag`, `map`, `life_number`, `life_started_at` accept NULL. Drizzle infers these as `number | null` / `string | null` / `Date | null` repo-wide.

- [ ] **Step 1: Write the failing test**

Append to `packages/read-models/test/articles-schema.test.ts`:

```ts
// An institutional editorial piece (an Almanac census) has no subject at all. Before 0016 these
// five columns were NOT NULL and a subject-less article could only be stored by inventing a fake
// subject — which would then be rendered, linked, and indexed as if it were a real player.
it("accepts a news row with no subject columns at all", async () => {
  const [row] = await db.insert(articles).values({
    kind: "news",
    status: "draft",
    slug: `almanac-schema-${Date.now()}`,
    naturalKey: `almanac:week:2026-W29-schema-${Date.now()}`,
    headline: "The Coldest Map Keeps Its People Longest",
    lede: "The registry has finished counting.",
  }).returning();

  expect(row!.gamertag).toBeNull();
  expect(row!.serverId).toBeNull();
  expect(row!.map).toBeNull();
  expect(row!.lifeNumber).toBeNull();
  expect(row!.lifeStartedAt).toBeNull();

  await db.delete(articles).where(eq(articles.id, row!.id));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/acab/worktrees/editorial-newsroom && TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5432/onelife_test" npx vitest run --root packages/read-models test/articles-schema.test.ts -t "no subject columns"`

Expected: FAIL — Postgres error `null value in column "server_id" of relation "articles" violates not-null constraint`.

- [ ] **Step 3: Write the migration**

Create `packages/db/drizzle/0016_editorial_articles.sql`:

```sql
-- The editorial desk writes institutional articles — an Almanac census covering every server, a
-- Ledger item about a token transfer between two people — which have no single (server, gamertag,
-- life) subject. Before this, storing one meant inventing a fake subject that the web surface would
-- then render, link, and index as though it were a real player.
--
-- Only these five columns relax. The partial unique index
-- `articles_kind_server_gamertag_life_uniq` covers `kind IN ('obituary','birth_notice')` only, and
-- both of those writers always supply a full tuple, so no NULL can enter the constraint's domain.
-- The `server_id` FK tolerates NULL natively. `articles` is durable, so no --rebuild.
ALTER TABLE "articles" ALTER COLUMN "server_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "articles" ALTER COLUMN "gamertag" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "articles" ALTER COLUMN "map" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "articles" ALTER COLUMN "life_number" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "articles" ALTER COLUMN "life_started_at" DROP NOT NULL;
```

Add to `packages/db/drizzle/meta/_journal.json` `entries` array (after the `0015_notifications` entry — copy the `when` value from `Date.now()` at authoring time, it is informational only):

```json
{ "idx": 16, "version": "7", "when": 1784600000000, "tag": "0016_editorial_articles", "breakpoints": true }
```

- [ ] **Step 4: Update the Drizzle schema**

In `packages/db/src/schema.ts`, five columns lose `.notNull()`:

```ts
  serverId: integer("server_id").references(() => servers.id),
  gamertag: text("gamertag"),                                        // NULL for an institutional editorial piece
  map: text("map"),                                                  // servers.map codename; NULL when no single server
  mapSlug: text("map_slug"),                                         // servers.slug (nullable)
  lifeNumber: integer("life_number"),
  lifeStartedAt: timestamp("life_started_at", { withTimezone: true }),
```

- [ ] **Step 5: Apply the migration and run the test**

Run: `cd /home/acab/worktrees/editorial-newsroom && TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5432/onelife_test" pnpm --filter @onelife/db run db:migrate`

Then: `TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5432/onelife_test" npx vitest run --root packages/read-models test/articles-schema.test.ts`

Expected: PASS.

- [ ] **Step 6: Run the mandatory blast-radius regression**

The riskiest thing about touching this table is the partial unique index. Run the existing double-publish guards:

Run: `TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5432/onelife_test" npx vitest run --root apps/newsdesk test/pg-store.test.ts test/birth-pg-store.test.ts test/news-pg-store.test.ts`

Expected: PASS — publishing an obituary and a birth notice twice each still upserts rather than raising 42P10.

- [ ] **Step 7: Commit**

```bash
cd /home/acab/worktrees/editorial-newsroom && git add packages/db packages/read-models/test/articles-schema.test.ts && git commit -m "feat(db): 0016 — articles subject columns become nullable"
```

---

### Task 2: `newsFormatOf` — teach the surface a third article family

**Files:**
- Modify: `packages/read-models/src/news-articles.ts:8-23`
- Test: `packages/read-models/test/news-articles.test.ts`

**Interfaces:**
- Consumes: Task 1's nullable columns.
- Produces:
  - `export type NewsFormat = "standing_dead" | "long_form" | "editorial"`
  - `export function newsFormatOf(naturalKey: string | null): NewsFormat`
  - `EDITORIAL_PREFIXES: readonly string[]` (exported for the CLI's registry in Task 6)
  - `newsTriggerOf` is **kept** and unchanged (it is part of the shipped public surface).

- [ ] **Step 1: Write the failing test**

Append to `packages/read-models/test/news-articles.test.ts`:

```ts
describe("newsFormatOf", () => {
  // The shipped classifier was binary: standing_dead, else long_form. Its "unreachable" fallback
  // becomes reachable the day an almanac: row publishes — and would render a census as a Long
  // Form, complete with a dossier and two timelines it has no subjects for.
  it("routes editorial prefixes away from the trigger formats", () => {
    expect(newsFormatOf("almanac:week:2026-W29")).toBe("editorial");
    expect(newsFormatOf("ledger:transfer:166e8e87-61df-4193-bc84-bd6c2f7c3846")).toBe("editorial");
    expect(newsFormatOf("editorial:one-off-thing")).toBe("editorial");
  });

  it("keeps both shipped triggers exactly as they were", () => {
    expect(newsFormatOf("standing_dead:2:Boots:2026-07-11T16:55:26.000Z")).toBe("standing_dead");
    expect(newsFormatOf("long_form:1:2026-07-13T18:48:58.000Z:A+B")).toBe("long_form");
  });

  // The shipped fallback must not change: a null or unrecognised key still reads long_form, which
  // turns the Standing-Dead-only status line OFF rather than on for a subject with no idle figure.
  it("leaves the unrecognised-key fallback alone", () => {
    expect(newsFormatOf(null)).toBe("long_form");
    expect(newsFormatOf("something_else:1")).toBe("long_form");
  });
});
```

Add `newsFormatOf` to the file's existing import from `../src/news-articles.js`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/acab/worktrees/editorial-newsroom && TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5432/onelife_test" npx vitest run --root packages/read-models test/news-articles.test.ts -t newsFormatOf`

Expected: FAIL — `newsFormatOf is not a function`.

- [ ] **Step 3: Implement**

In `packages/read-models/src/news-articles.ts`, directly below the existing `newsTriggerOf`:

```ts
/** Article families the news surface can render. The two triggers are written by `newsTick`
 *  (shipped, disabled); `editorial` is written by hand through the `newsroom` CLI. */
export type NewsFormat = "standing_dead" | "long_form" | "editorial";

/** Natural-key prefixes owned by the editorial desk. Disjoint from `standing_dead:`/`long_form:`
 *  by construction, so a hand-written article can never collide with a generated one. The CLI
 *  validates every payload's key against this list (apps/newsdesk/src/newsroom/contract.ts). */
export const EDITORIAL_PREFIXES = ["almanac:", "ledger:", "editorial:"] as const;

/**
 * Which family a row belongs to, from its natural_key PREFIX — the same rebuild-stable signal
 * `newsTriggerOf` uses, and the same one the newsdesk's retraction sweep reads
 * (`starts_with(natural_key, 'standing_dead:')`), so page and sweep agree by construction.
 *
 * The unrecognised-key fallback is deliberately still `long_form`, matching `newsTriggerOf`
 * exactly: a null or malformed key must not newly classify as `editorial` and lose its dossier.
 * Editorial is a POSITIVE match on an owned prefix, never a default.
 */
export function newsFormatOf(naturalKey: string | null): NewsFormat {
  if (naturalKey?.startsWith("standing_dead:")) return "standing_dead";
  if (EDITORIAL_PREFIXES.some((p) => naturalKey?.startsWith(p))) return "editorial";
  return "long_form";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5432/onelife_test" npx vitest run --root packages/read-models test/news-articles.test.ts`

Expected: PASS, including every pre-existing test.

- [ ] **Step 5: Commit**

```bash
git add packages/read-models && git commit -m "feat(read-models): newsFormatOf routes editorial keys away from the triggers"
```

---

### Task 3: Read-model — nullable subjects, draft fetch, and a loud guard

**Files:**
- Modify: `packages/read-models/src/news-articles.ts` (`NewsCard`, `cardOf`, `getNewsArticleBySlug`)
- Modify: `packages/read-models/src/obituary-articles.ts`, `packages/read-models/src/birth-notice-articles.ts`
- Test: `packages/read-models/test/news-articles.test.ts`

**Interfaces:**
- Consumes: `newsFormatOf` (Task 2), nullable columns (Task 1).
- Produces:
  - `NewsCard.gamertag/map/mapSlug/lifeNumber` are `string | null` / `number | null`; `NewsCard.format: NewsFormat`; `NewsCard.editorialFormat: string | null` (from `facts.format`, e.g. `"almanac"`).
  - `NewsArticleDetail.status: "published" | "draft" | "retracted"`.
  - `getNewsArticleBySlug(db, slug, opts?: { includeDraft?: boolean })`.
  - `assertSubjectful(row, kind)` throwing guard in the two life-keyed read-models.

- [ ] **Step 1: Write the failing tests**

Append to `packages/read-models/test/news-articles.test.ts` (inside the existing DB describe block that has `db`, `serverId` fixtures):

```ts
describe("editorial articles", () => {
  const key = `almanac:week:2026-W29-rm-${Date.now()}`;
  const slug = `almanac-rm-${Date.now()}`;

  it("serves a subject-less draft only when a draft is explicitly requested", async () => {
    await db.insert(articles).values({
      kind: "news", status: "draft", slug, naturalKey: key,
      headline: "The Coldest Map Keeps Its People Longest",
      lede: "The registry has finished counting.",
      body: "Forty-five souls against seventy.",
      facts: { format: "almanac" },
    });

    // A draft is invisible by default — that is the entire point of drafting on the live site.
    expect(await getNewsArticleBySlug(db, slug)).toBeNull();

    const draft = await getNewsArticleBySlug(db, slug, { includeDraft: true });
    expect(draft).not.toBeNull();
    expect(draft!.status).toBe("draft");
    expect(draft!.format).toBe("editorial");
    expect(draft!.editorialFormat).toBe("almanac");
    // No invented subject: the fields are null, not "" and not a placeholder gamertag.
    expect(draft!.gamertag).toBeNull();
    expect(draft!.map).toBeNull();
    expect(draft!.subjects).toEqual([]);
    // A Standing-Dead-only status line must stay off for a piece with no subject.
    expect(draft!.subjectStatus).toBeNull();

    await db.delete(articles).where(eq(articles.naturalKey, key));
  });

  it("never lets a draft into the feed", async () => {
    await db.insert(articles).values({
      kind: "news", status: "draft", slug: `${slug}-feed`, naturalKey: `${key}-feed`,
      headline: "Draft", lede: "Draft", facts: { format: "almanac" },
    });
    const feed = await getPublishedNews(db, { page: 1 });
    expect(feed.rows.some((r) => r.slug === `${slug}-feed`)).toBe(false);
    await db.delete(articles).where(eq(articles.naturalKey, `${key}-feed`));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5432/onelife_test" npx vitest run --root packages/read-models test/news-articles.test.ts -t editorial`

Expected: FAIL — `getNewsArticleBySlug` takes two arguments, so the draft is not returned (`expected null not to be null`).

- [ ] **Step 3: Implement the read-model changes**

In `packages/read-models/src/news-articles.ts`:

Replace the `NewsCard` interface:

```ts
export interface NewsCard {
  slug: string;
  trigger: NewsTrigger;
  format: NewsFormat;
  /** `facts.format` for an editorial piece ("almanac" | "ledger" | …) — drives the interior
   *  kicker. NULL for the two generated triggers, which use `triggerLabel` instead. */
  editorialFormat: string | null;
  /** NULL for an institutional editorial piece. A census of three servers has no one subject,
   *  and inventing one would render, link and index a player who is not in the story. */
  gamertag: string | null;
  map: string | null;
  mapSlug: string | null;
  lifeNumber: number | null;
  headline: string;
  lede: string;
  tags: string[];
  subjectCount: number;
  createdAt: Date;
}
```

Extend the facts snapshot type and `cardOf`:

```ts
type NewsFactsSnapshot = {
  subjectCount?: number;
  idleSeconds?: number | null;
  spanSeconds?: number | null;
  format?: string;
  subjects?: { gamertag?: string; mapSlug?: string | null; lifeNumber?: number }[];
};

function cardOf(r: {
  slug: string | null; naturalKey: string | null; gamertag: string | null; map: string | null;
  mapSlug: string | null; lifeNumber: number | null; headline: string | null; lede: string | null;
  tags: string[] | null; facts: unknown; createdAt: Date;
}): NewsCard {
  const facts = (r.facts ?? {}) as NewsFactsSnapshot;
  const format = newsFormatOf(r.naturalKey);
  return {
    slug: r.slug!,
    trigger: newsTriggerOf(r.naturalKey),
    format,
    editorialFormat: format === "editorial" ? facts.format ?? null : null,
    gamertag: r.gamertag,
    map: r.map,
    mapSlug: r.mapSlug,
    lifeNumber: r.lifeNumber,
    headline: r.headline!,
    lede: r.lede!,
    tags: r.tags ?? [],
    // An editorial piece has no subjects unless it names some; default 0, not 1.
    subjectCount: facts.subjectCount ?? (format === "editorial" ? 0 : 1),
    createdAt: r.createdAt,
  };
}
```

Add `status` to `NewsArticleDetail`:

```ts
export interface NewsArticleDetail extends NewsCard {
  /** Drafts are served ONLY through the preview gate; the feed never contains one. */
  status: "published" | "draft" | "retracted";
  body: string;
  // …everything else unchanged
```

Replace `getNewsArticleBySlug`'s signature, status predicate, subject fallback, and return:

```ts
const READABLE_PUBLIC = ["published", "retracted"] as const;
const READABLE_PREVIEW = ["published", "retracted", "draft"] as const;

/** A single news feature by slug, or null. `includeDraft` is the preview gate's key — the API
 *  sets it only for a request carrying a valid NEWS_PREVIEW_TOKEN. */
export async function getNewsArticleBySlug(
  db: Database,
  slug: string,
  opts: { includeDraft?: boolean } = {},
): Promise<NewsArticleDetail | null> {
  const readable = inArray(articles.status, [...(opts.includeDraft ? READABLE_PREVIEW : READABLE_PUBLIC)]);
  const rows = await db
    .select({ /* …unchanged column list… */ })
    .from(articles)
    .where(and(eq(articles.kind, "news"), readable, eq(articles.slug, slug)))
    .limit(1);

  const r = rows[0];
  if (!r) return null;
  const card = cardOf(r);
  const facts = (r.facts ?? {}) as NewsFactsSnapshot;

  const subjects: NewsSubjectRef[] = (facts.subjects ?? [])
    .filter((s): s is { gamertag: string; mapSlug?: string | null; lifeNumber?: number } =>
      typeof s?.gamertag === "string")
    .map((s) => ({
      gamertag: s.gamertag,
      mapSlug: s.mapSlug ?? null,
      lifeNumber: s.lifeNumber ?? card.lifeNumber ?? 1,
    }));

  // The self-subject fallback reconstructs a subject from the row's own identity columns — but an
  // editorial piece HAS no identity columns, and a fabricated subject there would render a
  // timeline link for a player who is not in the story. Empty is the correct answer.
  const selfSubject: NewsSubjectRef[] = card.gamertag && card.lifeNumber != null
    ? [{ gamertag: card.gamertag, mapSlug: card.mapSlug, lifeNumber: card.lifeNumber }]
    : [];

  return {
    ...card,
    status: r.status as NewsArticleDetail["status"],
    // …unchanged fields…
    subjects: subjects.length > 0 ? subjects : selfSubject,
    // The status line needs a real (server, gamertag, life) tuple; an editorial piece has none.
    subjectStatus: card.trigger === "standing_dead" && r.serverId != null && card.gamertag && r.lifeStartedAt
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

- [ ] **Step 4: Add the loud guard to the two life-keyed read-models**

Create the guard in `packages/read-models/src/obituary-articles.ts` (exported, imported by `birth-notice-articles.ts`):

```ts
/**
 * Migration 0016 made the subject columns nullable for institutional editorial pieces. For an
 * obituary or a birth notice a null subject is DATA CORRUPTION, not a valid state — the article
 * is keyed by that tuple. Throwing is deliberate: rendering an empty gamertag onto a public page
 * is worse than a 500, because it looks like a real article about nobody.
 */
export function assertSubjectful<T extends { gamertag: string | null; slug: string | null }>(
  row: T, kind: string,
): T & { gamertag: string } {
  if (row.gamertag == null) {
    throw new Error(`${kind} article ${row.slug ?? "(no slug)"} has a null gamertag — corrupt row`);
  }
  return row as T & { gamertag: string };
}
```

Call it in each row-mapping function in both files (where an obituary/birth-notice row is turned into a card or detail), e.g. `const r = assertSubjectful(raw, "obituary");`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5432/onelife_test" npx vitest run --root packages/read-models`

Expected: PASS — all read-model suites, including the pre-existing obituary/birth-notice/news tests.

- [ ] **Step 6: Commit**

```bash
git add packages/read-models && git commit -m "feat(read-models): nullable news subjects, draft fetch, assertSubjectful guard"
```

---

### Task 4: API — the preview gate

**Files:**
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/routes/news.ts`
- Test: `apps/api/test/news.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `getNewsArticleBySlug(db, slug, { includeDraft })` (Task 3).
- Produces: `GET /news/:slug?preview=<token>` serves a draft when the token matches `NEWS_PREVIEW_TOKEN`; `config.newsPreviewToken: string`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/news.test.ts`:

```ts
describe("draft preview gate", () => {
  // Fixture: a draft article inserted in beforeAll of this describe, slug `draft-preview-test`.
  it("404s a draft with no token", async () => {
    const res = await app.inject({ method: "GET", url: "/news/draft-preview-test" });
    expect(res.statusCode).toBe(404);
  });

  it("404s a draft with the wrong token", async () => {
    const res = await app.inject({ method: "GET", url: "/news/draft-preview-test?preview=nope" });
    expect(res.statusCode).toBe(404);
  });

  it("serves a draft with the right token, marked as a draft", async () => {
    const res = await app.inject({ method: "GET", url: "/news/draft-preview-test?preview=test-token" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("draft");
  });

  // FAIL CLOSED. An unset token must disable preview entirely, never match an empty ?preview=.
  // Precedent: MAGIC_LINK_ENABLED — absence of config is not permission.
  it("disables preview entirely when the token is unset", async () => {
    const bare = await buildApp({ ...testConfig, newsPreviewToken: "" });
    const res = await bare.inject({ method: "GET", url: "/news/draft-preview-test?preview=" });
    expect(res.statusCode).toBe(404);
    await bare.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/acab/worktrees/editorial-newsroom && TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5432/onelife_test" npx vitest run --root apps/api test/news.test.ts -t preview`

Expected: FAIL — the token-carrying request returns 404 (drafts are never served).

- [ ] **Step 3: Add the config key**

In `apps/api/src/config.ts`, add to the schema and the returned object:

```ts
  // Empty = preview disabled entirely. Never a default value: a guessable default would publish
  // every draft to anyone who typed ?preview=preview.
  NEWS_PREVIEW_TOKEN: z.string().default(""),
```
```ts
    newsPreviewToken: p.NEWS_PREVIEW_TOKEN,
```
and to the `Config` type: `newsPreviewToken: string;`

- [ ] **Step 4: Implement the gate**

In `apps/api/src/routes/news.ts`:

```ts
import { timingSafeEqual } from "node:crypto";

const query = z.object({ page: z.coerce.number().int().positive().catch(1) });
const params = z.object({ slug: z.string().min(1) });
const previewQuery = z.object({ preview: z.string().optional() });

/**
 * Constant-time compare. An empty configured token means preview is OFF — checked BEFORE the
 * comparison, because timingSafeEqual on two empty buffers returns true, which would serve every
 * draft to any request carrying `?preview=`.
 */
function previewAllowed(supplied: string | undefined, configured: string): boolean {
  if (!configured || !supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(configured);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function registerNewsRoutes(app: FastifyInstance, db: Database, previewToken = ""): void {
  app.get("/news", async (req) => {
    const { page } = query.parse(req.query);
    return getPublishedNews(db, { page });
  });

  app.get("/news/:slug", async (req, reply) => {
    const p = params.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "bad_request" });
    const { preview } = previewQuery.parse(req.query);
    const includeDraft = previewAllowed(preview, previewToken);
    const article = await getNewsArticleBySlug(db, p.data.slug, { includeDraft });
    if (!article) return reply.code(404).send({ error: "not_found" });
    return article;
  });
}
```

Update the call site in the API's app builder to pass `config.newsPreviewToken`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5432/onelife_test" npx vitest run --root apps/api`

Expected: PASS.

- [ ] **Step 6: Document the env var**

Add to `.env.example`:

```
# Editorial desk: the secret that makes an unpublished draft visible at its real URL
# (GET /news/<slug>?preview=<token>). EMPTY = preview disabled entirely. Generate with:
#   openssl rand -hex 16
NEWS_PREVIEW_TOKEN=
```

- [ ] **Step 7: Commit**

```bash
git add apps/api .env.example && git commit -m "feat(api): token-gated draft preview for news articles"
```

---

### Task 5: Web — the editorial arm, degraded cards, and the DRAFT banner

**Files:**
- Modify: `apps/web/src/lib/types.ts:256-293`
- Modify: `apps/web/src/lib/api.ts:164-166`
- Create: `apps/web/src/components/news/editorial-article.tsx`
- Create: `apps/web/src/components/news/editorial-article.test.tsx`
- Modify: `apps/web/src/components/news/news-card.tsx`
- Modify: `apps/web/src/app/news/[slug]/page.tsx`

**Interfaces:**
- Consumes: the API DTO from Task 4 (`format`, `editorialFormat`, `status`, nullable subject fields).
- Produces: `EditorialArticleView({ article, more, now })`; `getNewsArticle(slug, preview?)`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/news/editorial-article.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EditorialArticleView } from "./editorial-article";
import type { NewsArticle } from "@/lib/types";

const NOW = new Date("2026-07-20T12:00:00Z");

const almanac = (over: Partial<NewsArticle> = {}): NewsArticle => ({
  slug: "almanac-week-29", trigger: "long_form", format: "editorial", editorialFormat: "almanac",
  status: "published", gamertag: null, map: null, mapSlug: null, lifeNumber: null,
  headline: "The Coldest Map Keeps Its People Longest",
  lede: "The registry has finished counting.",
  body: "Forty-five souls against seventy.", bodyBlocks: null, pullQuote: null,
  imageUrl: null, imageCaption: null, retracted: false, timeAliveSeconds: 0, kills: 0,
  idleSeconds: null, spanSeconds: null, subjects: [], subjectStatus: null,
  tags: ["The Almanac"], subjectCount: 0, createdAt: "2026-07-20T09:00:00Z", ...over,
});

describe("EditorialArticleView", () => {
  it("kicks off with the editorial format, not a trigger label", () => {
    render(<EditorialArticleView article={almanac()} more={[]} now={NOW} />);
    expect(screen.getByText(/THE ALMANAC/i)).toBeInTheDocument();
    expect(screen.queryByText(/standing dead|long form/i)).toBeNull();
  });

  // The shipped byline renders <GamertagLink gamertag={article.gamertag}> unconditionally. An
  // institutional piece has no subject, so that link would be an empty link to /players/.
  it("bylines to the desk alone when there is no subject", () => {
    render(<EditorialArticleView article={almanac()} more={[]} now={NOW} />);
    expect(screen.getByText(/Filed by The Desk/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /players/i })).toBeNull();
  });

  it("renders the prose and shows no dossier, status line, or timeline", () => {
    render(<EditorialArticleView article={almanac()} more={[]} now={NOW} />);
    expect(screen.getByText(/Forty-five souls/)).toBeInTheDocument();
    expect(screen.queryByText(/the record so far/i)).toBeNull();
    expect(screen.queryByText(/without a sighting/i)).toBeNull();
  });

  // A draft must never be mistaken for a live page in a screenshot.
  it("banners a draft", () => {
    render(<EditorialArticleView article={almanac({ status: "draft" })} more={[]} now={NOW} />);
    expect(screen.getByText(/draft/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/acab/worktrees/editorial-newsroom/apps/web && npx vitest run src/components/news/editorial-article.test.tsx`

Expected: FAIL — `Failed to resolve import "./editorial-article"`.

- [ ] **Step 3: Extend the web DTOs**

In `apps/web/src/lib/types.ts`, update `NewsCard` and `NewsArticle`:

```ts
export type NewsFormat = "standing_dead" | "long_form" | "editorial";

export type NewsCard = {
  slug: string;
  trigger: NewsTrigger;
  format: NewsFormat;
  editorialFormat: string | null;
  gamertag: string | null;
  map: string | null;
  mapSlug: string | null;
  lifeNumber: number | null;
  headline: string;
  lede: string;
  tags: string[];
  subjectCount: number;
  createdAt: string;
};
```
```ts
export type NewsArticle = NewsCard & {
  status: "published" | "draft" | "retracted";
  // …rest unchanged
};
```

- [ ] **Step 4: Thread the preview token through the client**

In `apps/web/src/lib/api.ts`:

```ts
export const getNewsArticle = (slug: string, preview?: string) =>
  getOrNull<NewsArticle>(
    `/api/news/${encodeURIComponent(slug)}${preview ? `?preview=${encodeURIComponent(preview)}` : ""}`,
  );
```

- [ ] **Step 5: Implement the editorial view**

Create `apps/web/src/components/news/editorial-article.tsx`:

```tsx
import type { ReactNode } from "react";
import { ArticleBody } from "@/components/shared/article-body";
import { ArticleHero } from "@/components/shared/article-hero";
import { MoreFromTheDesk } from "./more-from-the-desk";
import { newsDateline } from "@/lib/news-format";
import type { NewsArticle, NewsCard } from "@/lib/types";

/** Kicker for an editorial piece. Unknown formats title-case rather than throwing, so a format
 *  added by a future session renders sanely before anyone ships a label for it. */
export function editorialKicker(format: string | null): string {
  if (!format) return "THE DESK";
  return `THE ${format.replace(/[-_]/g, " ").toUpperCase()}`;
}

/**
 * The interior for an institutional editorial piece: no dossier, no status line, no timelines —
 * it has no subject to build them from. Prose, a pull quote, tags, and the related rail.
 */
export function EditorialArticleView({
  article, more, now,
}: {
  article: NewsArticle;
  more: NewsCard[];
  now: Date;
}): ReactNode {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10 md:px-10">
      {article.status === "draft" && (
        <p className="mb-5 border-[3px] border-red bg-red px-3 py-1.5 text-center font-display text-[13px] font-bold uppercase tracking-[.14em] text-paper">
          Draft — not published
        </p>
      )}
      {article.retracted && (
        <p className="mb-5 border-[3px] border-red px-3 py-1.5 text-center font-display text-[13px] font-bold uppercase tracking-[.14em] text-red">
          Retracted
        </p>
      )}

      <div className="border-b-[3px] border-ink pb-5">
        <p className="font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted">
          {editorialKicker(article.editorialFormat)} · {newsDateline(article.map, article.createdAt, now)}
        </p>
        <h1 className="mt-2 font-display text-5xl font-bold uppercase leading-[.92] text-ink md:text-6xl">
          {article.headline}
        </h1>
        {/* No GamertagLink: an institutional piece has no subject, and an empty link would
            resolve to /players/ and read as a real player who is not in the story. */}
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
          Filed by The Desk
        </p>
      </div>

      {article.imageUrl && (
        <ArticleHero src={article.imageUrl} caption={article.imageCaption} accent="ink" />
      )}

      <p className="mt-6 font-display text-xl leading-snug text-ink">{article.lede}</p>

      <div className="mt-5">
        <ArticleBody blocks={article.bodyBlocks ?? null} fallback={article.body} />
      </div>

      {article.pullQuote && (
        <blockquote className="my-7 border-l-[5px] border-ink pl-5">
          <p className="font-display text-2xl uppercase leading-tight text-ink">{article.pullQuote.text}</p>
          <footer className="mt-2 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
            — {article.pullQuote.attribution}
          </footer>
        </blockquote>
      )}

      {article.tags.length > 0 && (
        <ul className="mt-7 flex flex-wrap gap-2 border-t border-hairline pt-4">
          {article.tags.map((t) => (
            <li key={t} className="border border-ink px-2 py-0.5 font-mono text-[10px] uppercase tracking-[.06em] text-ink">
              {t}
            </li>
          ))}
        </ul>
      )}

      <MoreFromTheDesk items={more} />
    </main>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/components/news/editorial-article.test.tsx`

Expected: PASS (4 tests).

- [ ] **Step 7: Route the interior and degrade the feed card**

In `apps/web/src/app/news/[slug]/page.tsx`, accept the preview param, pass it through, and branch:

```tsx
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ preview?: string }> };

export default async function NewsArticlePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { preview } = await searchParams;
  const article = await getNewsArticle(slug, preview);
  if (!article) notFound();
  const now = new Date();

  const feed = await getNewsFeed(1).catch(() => ({ rows: [], total: 0, page: 1, pageSize: 20 }));
  const more = feed.rows.filter((r) => r.slug !== article.slug).slice(0, 4);
  const ld = newsLd(article, absoluteUrl(newsArticleHref(slug)));

  if (article.format === "editorial") {
    return (
      <>
        {/* A draft is never indexable, and neither is a retraction. */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldScript(ld) }} />
        <EditorialArticleView article={article} more={more} now={now} />
      </>
    );
  }

  const timelines = await loadTimelines(article, now);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldScript(ld) }} />
      <NewsArticleView article={article} more={more} timelines={timelines} now={now} />
    </>
  );
}
```

Also add to `generateMetadata`: `...(a.status === "draft" || a.retracted ? { robots: { index: false, follow: false } } : {})`.

In `loadTimelines`, guard the standing-dead branch on a non-null subject:

```ts
  const refs: NewsSubjectRef[] = a.trigger === "long_form"
    ? a.subjects.slice(0, NEWS_TIMELINE_LIMIT)
    : a.gamertag && a.lifeNumber != null
      ? [{ gamertag: a.gamertag, mapSlug: a.mapSlug, lifeNumber: a.lifeNumber }]
      : [];
```

In `apps/web/src/components/news/news-card.tsx`, guard the subject chips — render the gamertag/map line only when `card.gamertag` is non-null, and the headline/lede/tags/thumb otherwise unchanged.

- [ ] **Step 8: Run the full web suite**

Run: `cd /home/acab/worktrees/editorial-newsroom/apps/web && npx vitest run && npx tsc --noEmit`

Expected: PASS, typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add apps/web && git commit -m "feat(web): editorial interior arm, draft banner, degraded subject-less cards"
```

---

### Task 6: The `newsroom` CLI — contract, lint, store, commands

**Files:**
- Create: `apps/newsdesk/src/newsroom/contract.ts`, `lint.ts`, `store.ts`, `main.ts`
- Create: `apps/newsdesk/test/newsroom-contract.test.ts`, `apps/newsdesk/test/newsroom-store.test.ts`
- Modify: `apps/newsdesk/package.json`

**Interfaces:**
- Consumes: `EDITORIAL_PREFIXES` (Task 2); nullable columns (Task 1).
- Produces: `parsePayload(raw: unknown): EditorialPayload` (throws `ContractError` with a single-line message); `editorialSlug(format, headline, naturalKey): string`; `flattenBlocks(blocks): string`; `draftArticle/publishArticle/unpublishArticle/spikeArticle/listArticles`.

- [ ] **Step 1: Write the failing contract tests**

Create `apps/newsdesk/test/newsroom-contract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parsePayload, editorialSlug, flattenBlocks } from "../src/newsroom/contract.js";

const valid = {
  format: "almanac",
  naturalKey: "almanac:week:2026-W29",
  headline: "The Coldest Map Keeps Its People Longest",
  lede: "The registry has finished counting.",
  blocks: [{ type: "para", text: "Sakhal is the punishing one." }],
  tags: ["The Almanac"],
  factCheck: [{ claim: "45 vs 70 players", source: "sessions grouped by server" }],
};

describe("parsePayload", () => {
  it("accepts a complete institutional payload", () => {
    expect(parsePayload(valid).format).toBe("almanac");
  });

  // Provenance is not optional. Live aggregates drift as data grows, so an article without a
  // claim->source table cannot be checked after the fact — and the automated desks freeze their
  // facts at publish, so the editorial desk must too.
  it("rejects a payload with no fact check", () => {
    expect(() => parsePayload({ ...valid, factCheck: [] })).toThrow(/factCheck/i);
  });

  it("rejects a natural key outside the editorial namespace", () => {
    expect(() => parsePayload({ ...valid, naturalKey: "standing_dead:1:X" })).toThrow(/natural key/i);
  });

  it("rejects a banned Tier-1 phrase in the prose", () => {
    const bad = { ...valid, blocks: [{ type: "para", text: "Our data shows he was gone too soon." }] };
    expect(() => parsePayload(bad)).toThrow(/our data shows|gone too soon/i);
  });

  it("requires at least one block", () => {
    expect(() => parsePayload({ ...valid, blocks: [] })).toThrow(/blocks/i);
  });
});

describe("editorialSlug", () => {
  it("prefixes with the format and stays URL and media-route safe", () => {
    const s = editorialSlug("almanac", "The Coldest Map Keeps Its People Longest", "almanac:week:2026-W29");
    expect(s).toMatch(/^[a-z0-9-]+$/);
    expect(s.startsWith("almanac-")).toBe(true);
  });

  it("is deterministic for the same input", () => {
    const a = editorialSlug("ledger", "Raygun Paid His Debt", "ledger:transfer:abc");
    const b = editorialSlug("ledger", "Raygun Paid His Debt", "ledger:transfer:abc");
    expect(a).toBe(b);
  });
});

describe("flattenBlocks", () => {
  // The OG card and the meta description quote `body`. Deriving it from the blocks means they can
  // never quote a sentence that is not on the page — the same rule newsTick follows.
  it("joins only para blocks, with a blank line between them", () => {
    expect(flattenBlocks([
      { type: "para", text: "One." },
      { type: "subhead", text: "Ignored" },
      { type: "para", text: "Two." },
    ])).toBe("One.\n\nTwo.");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/acab/worktrees/editorial-newsroom && npx vitest run --root apps/newsdesk test/newsroom-contract.test.ts`

Expected: FAIL — `Failed to resolve import "../src/newsroom/contract.js"`.

- [ ] **Step 3: Write the Tier-1 lint**

Create `apps/newsdesk/src/newsroom/lint.ts`:

```ts
/**
 * Brand bible §9, BAN Tier 1 — vendored VERBATIM. Source of truth: ../brand/brand-bible.md.
 * Change the brand repo first, then re-vendor (the IMAGE_STYLE rule).
 *
 * TIER 2 IS DELIBERATELY ABSENT. Punching down and the Fog Rule are judgment calls; a lint that
 * claims to check ethics manufactures false confidence. The session ritual and the human review
 * gate own Tier 2.
 */
const BANNED: { pattern: RegExp; why: string }[] = [
  { pattern: /\brip\b|gone too soon|rest in peace|taken from us|in a better place/i,
    why: "sincere grief cliché (§9 Tier 1) — the paper mourns in deadpan" },
  { pattern: /just a game|\bjk\b|\blol\b|obviously we'?re kidding/i,
    why: "wink/meta phrase (§9 Tier 1) — never explain or apologise for the joke" },
  { pattern: /\busers\b|\bengagement\b|content pipeline|our data shows|\bleverage\b|\butilize\b/i,
    why: "corporate/data-speak (§9 Tier 1)" },
  { pattern: /\bbased\b|poggers|\bgg ez\b|\brekt\b/i, why: "dated meme slang (§9 Tier 1)" },
  { pattern: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, why: "emoji (§9 Tier 1)" },
  { pattern: /!/, why: "exclamation point — loudness lives in the layout, never the prose (§6.1)" },
  { pattern: /\b[A-Z]{4,}\b/, why: "ALL-CAPS in prose (§9 Tier 1)" },
];

export function lintProse(text: string): string[] {
  return BANNED.filter((b) => b.pattern.test(text)).map((b) => b.why);
}
```

- [ ] **Step 4: Write the contract**

Create `apps/newsdesk/src/newsroom/contract.ts`:

```ts
import { z } from "zod";
import { EDITORIAL_PREFIXES } from "@onelife/read-models";
import { lintProse } from "./lint.js";

export class ContractError extends Error {}

const block = z.discriminatedUnion("type", [
  z.object({ type: z.literal("para"), text: z.string().min(1) }),
  z.object({ type: z.literal("subhead"), text: z.string().min(1) }),
  z.object({ type: z.literal("quote"), text: z.string().min(1), attribution: z.string().optional() }),
  z.object({ type: z.literal("list"), items: z.array(z.string().min(1)).min(1).max(20) }),
]);
export type ArticleBlock = z.infer<typeof block>;

const schema = z.object({
  format: z.string().regex(/^[a-z][a-z0-9-]*$/, "format must be lowercase kebab-case"),
  naturalKey: z.string().min(1),
  headline: z.string().min(1).max(90),
  lede: z.string().min(1),
  blocks: z.array(block).min(1, "blocks must contain at least one block").max(40),
  pullQuote: z.object({ text: z.string().min(1), attribution: z.string().min(1) }).nullish(),
  tags: z.array(z.string().min(1)).max(2).default([]),
  // REQUIRED. See the test — provenance is the editorial desk's parity with the automated desks.
  factCheck: z.array(z.object({ claim: z.string().min(1), source: z.string().min(1) }))
    .min(1, "factCheck must have at least one claim→source row"),
  subjects: z.array(z.object({
    gamertag: z.string().min(1),
    mapSlug: z.string().nullish(),
    lifeNumber: z.number().int().positive().nullish(),
  })).default([]),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
});

export type EditorialPayload = z.infer<typeof schema>;

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Deterministic, format-prefixed, `[a-z0-9-]+` so the media route serves its hero unchanged.
 *  The natural key's tail disambiguates two articles that share a headline. */
export function editorialSlug(format: string, headline: string, naturalKey: string): string {
  const h = slugify(headline).slice(0, 60).replace(/-+$/g, "") || "dispatch";
  const tail = slugify(naturalKey.split(":").slice(1).join("-")).slice(0, 24).replace(/-+$/g, "");
  return [slugify(format), h, tail].filter(Boolean).join("-");
}

/** Flat `body` is DERIVED, never authored — the OG card and meta description read it, so they
 *  can never quote a sentence that is not on the page. Mirrors newsTick's rule exactly. */
export function flattenBlocks(blocks: ArticleBlock[]): string {
  return blocks.filter((b): b is Extract<ArticleBlock, { type: "para" }> => b.type === "para")
    .map((b) => b.text).join("\n\n");
}

export function parsePayload(raw: unknown): EditorialPayload {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ContractError(parsed.error.issues.map((i) => `${i.path.join(".") || "payload"}: ${i.message}`).join("; "));
  }
  const p = parsed.data;

  if (!EDITORIAL_PREFIXES.some((prefix) => p.naturalKey.startsWith(prefix))) {
    throw new ContractError(
      `natural key must start with one of ${EDITORIAL_PREFIXES.join(", ")} — got "${p.naturalKey}". ` +
      `standing_dead:/long_form: belong to the automated triggers.`);
  }

  const prose = [p.headline, p.lede, ...p.blocks.flatMap((b) => b.type === "list" ? b.items : [b.text]),
    p.pullQuote?.text ?? ""].join("\n");
  const hits = lintProse(prose);
  if (hits.length) throw new ContractError(`brand voice: ${hits.join("; ")}`);

  return p;
}
```

- [ ] **Step 5: Run contract tests to verify they pass**

Run: `npx vitest run --root apps/newsdesk test/newsroom-contract.test.ts`

Expected: PASS (8 tests).

- [ ] **Step 6: Write the store**

Create `apps/newsdesk/src/newsroom/store.ts`:

```ts
import type { Database } from "@onelife/db";
import { articles } from "@onelife/db";
import { and, desc, eq } from "drizzle-orm";
import { editorialSlug, flattenBlocks, type EditorialPayload } from "./contract.js";

export async function draftArticle(db: Database, p: EditorialPayload): Promise<string> {
  const slug = p.slug ?? editorialSlug(p.format, p.headline, p.naturalKey);

  const clash = await db.select({ slug: articles.slug }).from(articles).where(eq(articles.slug, slug)).limit(1);
  if (clash[0]) throw new Error(`slug "${slug}" already exists — pass an explicit slug to override`);
  const dupe = await db.select({ slug: articles.slug }).from(articles).where(eq(articles.naturalKey, p.naturalKey)).limit(1);
  if (dupe[0]) throw new Error(`story already covered: natural key "${p.naturalKey}" is article "${dupe[0].slug}"`);

  await db.insert(articles).values({
    kind: "news",
    status: "draft",
    slug,
    naturalKey: p.naturalKey,
    headline: p.headline,
    lede: p.lede,
    body: flattenBlocks(p.blocks),
    bodyBlocks: p.blocks,
    pullQuoteText: p.pullQuote?.text ?? null,
    pullQuoteAttribution: p.pullQuote?.attribution ?? null,
    tags: p.tags,
    facts: { format: p.format, factCheck: p.factCheck, subjects: p.subjects, subjectCount: p.subjects.length },
    promptVersion: "editorial-v1",
    model: null,                       // no OpenRouter call is ever made for an editorial piece
    generatedAt: new Date(),
  });
  return slug;
}

/** draft -> published. `created_at` is bumped: the feed orders by it, and a draft reviewed for
 *  three days must not publish already buried under newer stories. */
export async function publishArticle(db: Database, slug: string): Promise<"published" | "noop"> {
  const rows = await db.select({ status: articles.status }).from(articles)
    .where(and(eq(articles.kind, "news"), eq(articles.slug, slug))).limit(1);
  const row = rows[0];
  if (!row) throw new Error(`no article with slug "${slug}"`);
  if (row.status === "published") return "noop";
  if (row.status !== "draft") throw new Error(`"${slug}" is ${row.status}, not a draft`);
  await db.update(articles).set({ status: "published", createdAt: new Date() })
    .where(and(eq(articles.kind, "news"), eq(articles.slug, slug)));
  return "published";
}

/** published -> draft. The mistake hatch. NEVER writes `retracted`: retraction is a public
 *  correction with a banner and an overprinted OG card, owned by the newsdesk's own sweep. */
export async function unpublishArticle(db: Database, slug: string): Promise<void> {
  const res = await db.update(articles).set({ status: "draft" })
    .where(and(eq(articles.kind, "news"), eq(articles.slug, slug), eq(articles.status, "published")))
    .returning({ slug: articles.slug });
  if (!res[0]) throw new Error(`no PUBLISHED article with slug "${slug}"`);
}

/** Deletes a DRAFT. A published row is never deleted — the archive promise is permanent. */
export async function spikeArticle(db: Database, slug: string): Promise<void> {
  const res = await db.delete(articles)
    .where(and(eq(articles.kind, "news"), eq(articles.slug, slug), eq(articles.status, "draft")))
    .returning({ slug: articles.slug });
  if (!res[0]) throw new Error(`no DRAFT with slug "${slug}" (a published article cannot be spiked)`);
}

export async function listArticles(db: Database, draftsOnly = false) {
  return db.select({
    slug: articles.slug, status: articles.status, facts: articles.facts,
    headline: articles.headline, createdAt: articles.createdAt,
  }).from(articles)
    .where(draftsOnly ? and(eq(articles.kind, "news"), eq(articles.status, "draft")) : eq(articles.kind, "news"))
    .orderBy(desc(articles.createdAt));
}
```

- [ ] **Step 7: Write and run the store tests**

Create `apps/newsdesk/test/newsroom-store.test.ts` covering: draft inserts with `status='draft'` and derived body; a second draft with the same natural key throws `story already covered`; `publish` flips status and bumps `createdAt`; `publish` twice is a no-op; `unpublish` returns it to draft; `spike` deletes a draft; `spike` on a published row throws; `unpublish` never produces `retracted`.

Run: `TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5432/onelife_test" npx vitest run --root apps/newsdesk test/newsroom-store.test.ts`

Expected: PASS.

- [ ] **Step 8: Write the CLI entry point**

Create `apps/newsdesk/src/newsroom/main.ts` with commands `draft <file.json>`, `publish <slug>`, `unpublish <slug>`, `spike <slug>`, `list [--drafts]`. `draft` prints the preview URL built from `SITE_URL` + `NEWS_PREVIEW_TOKEN` (warning loudly when the token is unset, since the URL will 404); `publish` prints the live URL. Errors print one line and `process.exit(1)` — no stack traces.

Add to `apps/newsdesk/package.json` scripts:

```json
    "newsroom": "tsx src/newsroom/main.ts"
```

- [ ] **Step 9: Smoke-test the CLI end to end**

```bash
cd /home/acab/worktrees/editorial-newsroom
cat > /tmp/almanac.json <<'JSON'
{"format":"almanac","naturalKey":"almanac:week:2026-W29","headline":"The Coldest Map Keeps Its People Longest","lede":"The registry has finished counting.","blocks":[{"type":"para","text":"Sakhal is the punishing one."}],"tags":["The Almanac"],"factCheck":[{"claim":"45 vs 70 players","source":"sessions grouped by server"}]}
JSON
pnpm --filter @onelife/newsdesk run newsroom -- draft /tmp/almanac.json
pnpm --filter @onelife/newsdesk run newsroom -- list --drafts
pnpm --filter @onelife/newsdesk run newsroom -- spike almanac-the-coldest-map-keeps-its-people-longest-week-2026-w29
```

Expected: draft prints a preview URL; list shows one draft; spike removes it.

- [ ] **Step 10: Commit**

```bash
git add apps/newsdesk && git commit -m "feat(newsdesk): the newsroom CLI — the only write path for editorial articles"
```

---

### Task 7: `newsroom scout` — story tips from the shelved triggers

**Files:**
- Create: `apps/newsdesk/src/newsroom/scout.ts`
- Modify: `apps/newsdesk/src/newsroom/main.ts`
- Test: `apps/newsdesk/test/newsroom-scout.test.ts`

**Interfaces:**
- Consumes: `findStandingDeadTargets` / `findLongFormTargets` from `apps/newsdesk/src/news-targets.js`; `parsePayload` unused here.
- Produces: `scout(db, now, opts): Promise<ScoutReport>` where `ScoutReport = { standingDead: {gamertag, map, idleDays}[]; longForm: {map, subjectCount, earliestDeathAt}[]; aggregates: { map, players, medianLifeMinutes, singleSessionPct }[] }`.

- [ ] **Step 1: Write the failing test**

Create `apps/newsdesk/test/newsroom-scout.test.ts` asserting: `scout` returns the two trigger lists plus per-map aggregates; **suppressed gamertags are excluded**; and — the Fog Rule rail — **no key anywhere in the report is `x`, `y`, or matches a coordinate shape**, using the recursive key-presence walk the PR-C1 tests established (not the vacuous `/\d{4}\.\d/` regex those tests originally used).

- [ ] **Step 2: Run to verify it fails**

Run: `TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5432/onelife_test" npx vitest run --root apps/newsdesk test/newsroom-scout.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `scout`**

Calls the two shipped finders (unchanged), strips them to display fields, and adds the per-map aggregate digest (unique players, session count, median non-suicide life minutes, single-session percentage) — the queries from the founding session, as SQL in this module. Excludes `NEWSDESK_NEWS_SUPPRESSED_GAMERTAGS`.

- [ ] **Step 4: Run to verify it passes, then wire the command**

Run the test, then add `scout` to `main.ts`, printing a compact digest.

- [ ] **Step 5: Commit**

```bash
git add apps/newsdesk && git commit -m "feat(newsdesk): newsroom scout — trigger tips plus the aggregate digest"
```

---

### Task 8: The `drafting-an-article` skill

**Files:**
- Create: `.claude/skills/drafting-an-article/SKILL.md`

**Interfaces:**
- Consumes: everything above (`newsroom scout|draft|publish`).
- Produces: the repeatable session ritual.

- [ ] **Step 1: Write the skill**

Frontmatter `name: drafting-an-article`, description triggering on "draft an article", "write an Almanac", "newsroom session". Body follows spec §9 in order: `scout` → explore (with the founding session's query cookbook and the two standing rails: *check whether one player is moving your aggregate* — the Livonia 1.0-minute-median lesson — and *state n when it is small*) → consent pass (suppression list; living subjects get the Standing Dead rails; banned subjects get the Ledger rule) → **voice: read `/var/www/brand/brand-bible.md` §6 and §9 live**, falling back to a scratchpad shallow-clone of `git@github.com:dayz-one-life/brand.git`; read `recentProse` and treat recent attributions as burned → compose the payload with a `factCheck` row for every claim → `draft` → review the preview URL → `publish` on human approval.

- [ ] **Step 2: Verify it loads**

Run: `ls .claude/skills/drafting-an-article/SKILL.md && head -5 .claude/skills/drafting-an-article/SKILL.md`

Expected: frontmatter present and well-formed.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills && git commit -m "docs(skills): drafting-an-article — the editorial session ritual"
```

---

### Task 9: Full verification, changelog, CLAUDE.md, PR

**Files:**
- Modify: `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: Run the full monorepo suite, uncached**

Run: `cd /home/acab/worktrees/editorial-newsroom && TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5432/onelife_test" pnpm turbo run test typecheck --concurrency=1 --force`

Expected: all tasks successful. Do not proceed on failure.

- [ ] **Step 2: Update CHANGELOG.md**

Under `## [Unreleased]` → `### Added`: the editorial desk (migration `0016`, the preview gate, the editorial interior arm, the `newsroom` CLI, the skill). Note explicitly: **`newsTick` remains shipped and disabled — `NEWSDESK_NEWS_ENABLED`/`NEWSDESK_NEWS_SINCE` stay unset**; one new env var `NEWS_PREVIEW_TOKEN`; **no `--rebuild`**.

- [ ] **Step 3: Update CLAUDE.md (LAST)**

Add an "Editorial newsroom" entry to the Tabloid redesign section covering: the desk replaces `newsTick` operationally but not in code; `kind='news'` with `facts.format` for flavour; `EDITORIAL_PREFIXES` and the rule that `newsFormatOf`'s unrecognised-key fallback stays `long_form`; the CLI is the **only** write path; `unpublish` ≠ `retracted`; `factCheck` is required; and the brand bible at `/var/www/brand` governs voice, read live.

- [ ] **Step 4: Commit and open the PR**

```bash
git add CHANGELOG.md CLAUDE.md && git commit -m "docs: editorial newsroom changelog + CLAUDE.md"
git push -u origin feature/editorial-newsroom
gh pr create --repo dayz-one-life/one-life --base develop --head feature/editorial-newsroom --title "feat: the editorial newsroom" --body "<what/why + changelog excerpt>"
```

---

## Self-Review

**Spec coverage:** §4 → Task 1. §5 (`newsFormatOf`, contract) → Tasks 2, 6. §6 (read-model, API, web) → Tasks 3, 4, 5. §7 (CLI) → Tasks 6, 7. §8 (brand binding) → Tasks 6 (lint), 8 (live read). §9 (ritual) → Task 8. §10 (error handling) → Tasks 4 (fail-closed), 6 (named errors). §11 (testing) → every task. §12 (rollout) → Task 9. §13 (`ink` accent) → resolved: shipped in v0.25.0, so Task 5 uses it rather than adding it.

**Placeholders:** Tasks 7 and 8 describe deliverables at a higher level than Tasks 1–6, which carry complete code. That is deliberate — `scout`'s SQL is the founding session's cookbook (reproduced in the skill) and the skill body is prose, not code. Every step that changes code shows the code.

**Type consistency:** `newsFormatOf` returns `NewsFormat` (Task 2), consumed as `article.format` in Tasks 3 and 5. `NewsCard.gamertag` is `string | null` in both the read-model (Task 3) and the web DTO (Task 5). `getNewsArticleBySlug(db, slug, { includeDraft })` matches between Tasks 3 and 4. `EDITORIAL_PREFIXES` is exported in Task 2 and imported in Task 6. `ArticleBlock` in the CLI contract mirrors the existing union in `packages/read-models/src/obituary-articles.ts` and `apps/web/src/lib/types.ts`.
