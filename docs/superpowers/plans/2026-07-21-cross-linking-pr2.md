# Cross-linking PR-2 ("In The Paper") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, on a player's public profile, every published article that names them — as its subject, or as the killer in someone else's obituary.

**Architecture:** No new table. `articles.gamertag` already holds the subject on all 168 published rows, and `facts->>'killerGamertag'` holds the killer. PR-2 adds two partial expression indexes, one read model that unions the two arms, one public API route, and one section on the player page.

**Tech Stack:** TypeScript/ESM, Next.js 15 App Router, React 19, Tailwind, Drizzle + Postgres, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-21-cross-linking-design.md` §5 (revised — read it, the child table was dropped).

## Global Constraints

- Branch is `feature/article-subjects`, already created from `origin/develop`. Do not create another. (The name predates the decision to drop the table; leave it.)
- **Only `status = 'published'` articles are ever surfaced.** A retracted article is a public correction; a draft or failed stub has no page.
- **Gamertag comparison is case-insensitive** everywhere, matching the rest of the codebase.
- **The new section MUST NOT use the `page` query param.** The player page's past-lives pagination already owns `page` end to end (`parsePage` in `apps/web/src/app/players/[slug]/page.tsx`, and the href builder in `player-pagination.tsx`). Use **`ap`**. Two sections sharing one param would move together.
- **A failed fetch must never render as an empty section.** Loading/error is not an authoritative zero — this is an established invariant in this codebase. Use `settleFeed` (`apps/web/src/lib/settle-feed.ts`) and render an explicit failure line.
- **Use the vitest entry point the target file already imports.** `packages/read-models/test/*` import and use `it(`; `apps/web/src/**` import and use `test(`. The wrong one passes at runtime via vitest globals but fails `tsc` with TS2582.
- **`pnpm turbo run typecheck` is a required gate, not a formality.** A green vitest run does not imply a clean typecheck in this repo. Run it, do not infer it.
- Read-model tests need `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test` prefixed on the command. The repo `.env` points at the wrong postgres. Do not edit `.env`.
- Do not run `git add -A`; stage explicit paths.

---

### Task 1: Migration `0017` — the two indexes

**⚠️ Hand-write this migration. Do NOT run `drizzle-kit generate`.** The drizzle snapshot chain is already broken: `packages/db/drizzle/meta/` stops at `0014_snapshot.json`, while `0015_notifications.sql` and `0016_editorial_articles.sql` exist as `.sql` files with hand-appended `_journal.json` entries and no snapshots. Running `generate` would diff against a stale snapshot and emit wrong SQL. Follow the `0015`/`0016` practice. Do not attempt to repair the snapshot gap — that is pre-existing and out of scope.

**Files:**
- Create: `packages/db/drizzle/0017_article_subject_indexes.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/db/src/schema.ts` (index declarations on the `articles` table)

**Interfaces:**
- Produces: indexes `articles_subject_idx` and `articles_killer_idx`

- [ ] **Step 1: Write the migration SQL**

Create `packages/db/drizzle/0017_article_subject_indexes.sql`:

```sql
-- In The Paper: the two lookups behind "which published articles name this player".
-- Partial on status='published' because nothing else is ever surfaced, and expression-based
-- because both comparisons are case-insensitive.
CREATE INDEX IF NOT EXISTS "articles_subject_idx"
  ON "articles" (lower("gamertag"), "created_at" DESC)
  WHERE "status" = 'published';

CREATE INDEX IF NOT EXISTS "articles_killer_idx"
  ON "articles" (lower("facts"->>'killerGamertag'), "created_at" DESC)
  WHERE "status" = 'published' AND "facts"->>'killerGamertag' IS NOT NULL;
```

- [ ] **Step 2: Append the journal entry**

Open `packages/db/drizzle/meta/_journal.json` and append one entry to the `entries` array, matching the shape of the `0016` entry exactly (same keys, same order). Use `"idx": 17`, `"tag": "0017_article_subject_indexes"`, `"version": "7"`, `"breakpoints": true`, and a `"when"` value larger than `0016`'s. Do not create a snapshot file.

- [ ] **Step 3: Declare the indexes in `schema.ts`**

In `packages/db/src/schema.ts`, in the `articles` table's index block (alongside `feedIdx`, `bornIdx`, `createdIdx`, `discordUnpostedIdx`, `imageMissingIdx`), add:

```ts
  // In The Paper (player profile): "which published articles name this player".
  // Expression indexes because both comparisons are case-insensitive; partial because nothing
  // but a published article is ever surfaced.
  subjectIdx: index("articles_subject_idx")
    .on(sql`lower(${t.gamertag})`, t.createdAt.desc())
    .where(sql`${t.status} = 'published'`),
  killerIdx: index("articles_killer_idx")
    .on(sql`lower(${t.facts}->>'killerGamertag')`, t.createdAt.desc())
    .where(sql`${t.status} = 'published' AND ${t.facts}->>'killerGamertag' IS NOT NULL`),
```

If drizzle's typings reject an expression inside `.on(...)` for this version, fall back to declaring the indexes ONLY in the `.sql` migration and add a comment in `schema.ts`'s articles index block naming both indexes and stating they are defined in `0017` because they are expression indexes. Report which route you took — do not silently skip the declaration.

- [ ] **Step 4: Apply and verify against the real database**

```bash
cd packages/db && DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm db:migrate
docker exec one-life-postgres-1 psql -U onelife -d onelife_test -c "\di articles*"
```
Expected: both `articles_subject_idx` and `articles_killer_idx` listed.

- [ ] **Step 5: Prove the indexes are actually used**

The point of an expression index is that the query planner picks it. Against the test database, run:
```bash
docker exec one-life-postgres-1 psql -U onelife -d onelife_test -c "EXPLAIN SELECT slug FROM articles WHERE status='published' AND lower(gamertag)=lower('X') ORDER BY created_at DESC LIMIT 20;"
```
On a nearly-empty table Postgres will legitimately choose a sequential scan, so a Seq Scan here is NOT a failure. Record the actual output in your report. If you can, repeat it against the `onelife_prod` database (168 rows, read-only — never write to it) for a more meaningful plan.

- [ ] **Step 6: Commit**

```bash
git add packages/db/drizzle/0017_article_subject_indexes.sql packages/db/drizzle/meta/_journal.json packages/db/src/schema.ts
git commit -m "feat(db): index the two In The Paper lookups"
```

---

### Task 2: `getPlayerArticles` read model

**Files:**
- Create: `packages/read-models/src/player-articles.ts`
- Modify: `packages/read-models/src/index.ts` (barrel — it is `export *`, so check whether the new file needs an explicit line or is picked up)
- Test: `packages/read-models/test/player-articles.test.ts`

**Interfaces:**
- Produces:
```ts
export type PlayerArticleRole = "subject" | "killer";
export interface PlayerArticleRow {
  kind: string; slug: string; headline: string;
  createdAt: Date; role: PlayerArticleRole; mapSlug: string | null;
}
export interface PlayerArticlesFeed {
  rows: PlayerArticleRow[]; total: number; page: number; pageSize: number;
}
export const PLAYER_ARTICLES_PAGE_SIZE = 10;
export async function getPlayerArticles(
  db: Database, gamertag: string, opts: { page: number; pageSize?: number },
): Promise<PlayerArticlesFeed>;
```

- [ ] **Step 1: Write the failing tests**

Create `packages/read-models/test/player-articles.test.ts`. Follow the seeding style of `packages/read-models/test/life-timeline.test.ts` — a module-scoped random `svc`, a `beforeAll` that inserts a server and articles, and an `afterAll` that deletes exactly what it inserted (that database is shared across suites; a leaked published article would make an unrelated suite see one).

Tests to write:

```ts
it("returns nothing for a player the paper has never written about", async () => {
  const feed = await getPlayerArticles(db, `Nobody-${svc}`, { page: 1 });
  expect(feed.rows).toEqual([]);
  expect(feed.total).toBe(0);
});

it("returns an article whose subject is the player, tagged subject", async () => {
  const feed = await getPlayerArticles(db, `Hero-${svc}`, { page: 1 });
  expect(feed.rows.map((r) => [r.slug, r.role])).toContainEqual([`pa-obit-${svc}`, "subject"]);
});

it("matches the gamertag case-insensitively", async () => {
  const feed = await getPlayerArticles(db, `hero-${svc}`.toUpperCase(), { page: 1 });
  expect(feed.total).toBeGreaterThan(0);
});

it("returns an article where the player is the killer, tagged killer", async () => {
  const feed = await getPlayerArticles(db, `Killer-${svc}`, { page: 1 });
  expect(feed.rows.map((r) => [r.slug, r.role])).toContainEqual([`pa-victim-${svc}`, "killer"]);
});

it("excludes a retracted article", async () => {
  // A retraction is a public correction, not a credit. It must not appear on anyone's profile.
  const feed = await getPlayerArticles(db, `Retracted-${svc}`, { page: 1 });
  expect(feed.rows).toEqual([]);
});

it("excludes a draft article", async () => {
  const feed = await getPlayerArticles(db, `Drafted-${svc}`, { page: 1 });
  expect(feed.rows).toEqual([]);
});

it("orders newest first", async () => {
  const feed = await getPlayerArticles(db, `Multi-${svc}`, { page: 1 });
  const times = feed.rows.map((r) => r.createdAt.getTime());
  expect(times).toEqual([...times].sort((a, b) => b - a));
});

it("paginates, and total counts every match not just the page", async () => {
  const feed = await getPlayerArticles(db, `Multi-${svc}`, { page: 1, pageSize: 2 });
  expect(feed.rows).toHaveLength(2);
  expect(feed.total).toBeGreaterThan(2);
  expect(feed.page).toBe(1);
  expect(feed.pageSize).toBe(2);
  const p2 = await getPlayerArticles(db, `Multi-${svc}`, { page: 2, pageSize: 2 });
  expect(p2.rows[0]!.slug).not.toBe(feed.rows[0]!.slug);
});

it("lists an article once, as subject, when the player is both subject and killer", async () => {
  // Does not occur in the live corpus (no published obituary has a self-kill), but the union
  // must not emit the same article twice.
  const feed = await getPlayerArticles(db, `Selfkill-${svc}`, { page: 1 });
  const forArticle = feed.rows.filter((r) => r.slug === `pa-self-${svc}`);
  expect(forArticle).toHaveLength(1);
  expect(forArticle[0]!.role).toBe("subject");
});
```

Seed accordingly in `beforeAll`: a published obituary for `Hero-${svc}`; a published obituary for a victim with `facts: { killerGamertag: \`Killer-${svc}\` }`; a `retracted` article for `Retracted-${svc}`; a `draft` article for `Drafted-${svc}`; at least three published articles for `Multi-${svc}` with distinct `createdAt`; and one published article whose `gamertag` is `Selfkill-${svc}` AND whose `facts.killerGamertag` is also `Selfkill-${svc}`. Every article needs the columns `articles` requires — check the schema for NOT NULL columns (`kind`, `status`, `headline`, `body` at minimum) and supply them.

- [ ] **Step 2: Run and verify they fail**

```bash
cd packages/read-models && TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm vitest run test/player-articles.test.ts
```
Expected: FAIL — module `../src/player-articles.js` does not exist.

- [ ] **Step 3: Implement the read model**

Create `packages/read-models/src/player-articles.ts`. Copy the shape of `getPublishedObituaries` in `obituary-articles.ts`: a column subset, a paginated rows query, and a SEPARATE count query (not a window function).

The two arms differ only in their predicate:
- subject: `sql\`lower(${articles.gamertag}) = lower(${gamertag})\``
- killer: `sql\`lower(${articles.facts}->>'killerGamertag') = lower(${gamertag})\``

Implement as one query with a derived `role` column so ordering and pagination happen once across the combined set — a `UNION ALL` of the two arms wrapped in an outer ordered/paginated select, with the self-kill duplicate collapsed by preferring `subject`. Expressing this through drizzle's query builder may not be practical; a raw `db.execute(sql\`…\`)` is acceptable and has precedent in this repo (the Long Form candidate query in `apps/newsdesk` is raw for the same reason). If you go raw, map the returned rows explicitly to `PlayerArticleRow` and be careful that `created_at` comes back as a `Date`.

Both arms must filter `status = 'published'`.

- [ ] **Step 4: Run and verify they pass**

Same command as Step 2. Expected: PASS, 9 tests.

- [ ] **Step 5: Prove cleanup, then commit**

Run the whole read-model suite TWICE consecutively; both runs must pass identically.

```bash
git add packages/read-models/src/player-articles.ts packages/read-models/test/player-articles.test.ts packages/read-models/src/index.ts
git commit -m "feat(read-models): getPlayerArticles — published articles naming a player"
```

---

### Task 3: `GET /players/:gamertag/articles`

**Files:**
- Modify: `apps/api/src/routes/player-aggregate.ts` (or add a route file beside it — follow whatever the existing player routes do)
- Test: the matching API test file

**Interfaces:**
- Consumes: `getPlayerArticles` (Task 2)
- Produces: `GET /players/:gamertag/articles?page=` returning `PlayerArticlesFeed`

- [ ] **Step 1: Write the failing test**

Follow the existing API tests' style. Assert: a known player returns their articles; `?page=` is honoured; a garbage `?page=abc` falls back to page 1 rather than erroring (matching the obituaries route's `.catch(1)`); and an unknown gamertag returns an empty feed with `total: 0` rather than a 404 (an unknown player simply has no articles).

- [ ] **Step 2: Run and verify it fails**

- [ ] **Step 3: Implement**

Mirror `apps/api/src/routes/obituaries.ts` exactly for validation:

```ts
const query = z.object({ page: z.coerce.number().int().positive().catch(1) });
```

Resolve the gamertag the same way the existing `GET /players/:gamertag` route does — check whether it slug-resolves via `resolveGamertagBySlug` and match that behaviour, so `/players/dead-eye-jim/articles` works with the same identifier the profile page already uses. Report what you found.

- [ ] **Step 4: Run and verify it passes, then commit**

```bash
git add apps/api/src
git commit -m "feat(api): GET /players/:gamertag/articles"
```

---

### Task 4: The In The Paper section

**Files:**
- Create: `apps/web/src/components/player/in-the-paper.tsx`
- Create: `apps/web/src/components/player/in-the-paper.test.tsx`
- Modify: `apps/web/src/lib/types.ts` (DTO), `apps/web/src/lib/api.ts` (fetcher)
- Modify: `apps/web/src/app/players/[slug]/page.tsx` (read `?ap=`, fetch, render)
- Modify: `apps/web/src/components/player/player-profile.tsx` (mount the section)

**Interfaces:**
- Consumes: `GET /players/:gamertag/articles` (Task 3)
- Produces: `<InThePaper rows total page pageSize slug failed />`

- [ ] **Step 1: Write the failing component tests**

`in-the-paper.test.tsx` — presentational, props-only, using `test(` (this file imports from vitest like its siblings):

```tsx
test("renders a row per article, linking to the interior", () => {
  render(<InThePaper slug="dead-eye-jim" rows={[{ kind: "obituary", slug: "last-light", headline: "Last Light On The Ridge", createdAt: "2026-07-12T00:00:00Z", role: "subject", mapSlug: "sakhal" }]} total={1} page={1} pageSize={10} failed={false} />);
  expect(screen.getByRole("link", { name: /last light on the ridge/i })).toHaveAttribute("href", "/obituaries/last-light");
});

test("tags the role so a killer credit is not mistaken for their own obituary", () => {
  render(<InThePaper slug="x" rows={[{ kind: "obituary", slug: "s", headline: "H", createdAt: "2026-07-12T00:00:00Z", role: "killer", mapSlug: null }]} total={1} page={1} pageSize={10} failed={false} />);
  expect(screen.getByText(/killer/i)).toBeInTheDocument();
});

test("renders nothing at all when the player has no articles", () => {
  const { container } = render(<InThePaper slug="x" rows={[]} total={0} page={1} pageSize={10} failed={false} />);
  expect(container).toBeEmptyDOMElement();
});

test("a failed fetch is reported, never rendered as an empty section", () => {
  // Loading/error must not be presented as an authoritative zero — a player whose articles
  // failed to load must not be told the paper never wrote about them.
  render(<InThePaper slug="x" rows={[]} total={0} page={1} pageSize={10} failed />);
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.queryByText(/never/i)).toBeNull();
});
```

Route each article kind to its correct interior: `obituary` → `/obituaries/{slug}`, `birth_notice` → `/fresh-spawns/{slug}`, `news` → `/news/{slug}`. Write a pure helper for this mapping and test it — an unknown kind must not produce a broken href; return null and render the headline as plain text.

- [ ] **Step 2: Run and verify they fail**

- [ ] **Step 3: Implement the component**

Light paper surface (the player profile), so `red-deep` is the correct red here, never `red-soft`. Match the visual language of the existing funeral cards in `past-life-card.tsx` — mono uppercase overline, display headline — rather than inventing a new one.

- [ ] **Step 4: Wire the page**

In `apps/web/src/app/players/[slug]/page.tsx`, add a SECOND page parser for `ap` alongside the existing `page` parser, fetch with `settleFeed`, and pass `failed` through. Mount the section in `player-profile.tsx` between the current-standing block and the past-lives block.

Pagination hrefs must preserve the OTHER param: a link that changes `ap` must keep the current `page`, and vice versa. Write a pure href builder for this and unit-test it with both params present, only one present, and neither.

- [ ] **Step 5: Run the full web suite and typecheck, then commit**

```bash
cd apps/web && pnpm vitest run && pnpm tsc --noEmit
cd ../.. && pnpm turbo run typecheck
git add apps/web/src
git commit -m "feat(web): In The Paper section on the player profile"
```

---

### Task 5: Changelog, CLAUDE.md, and the PR

The guard blocks the PR unless both `CHANGELOG.md` and `CLAUDE.md` changed on this branch.

- [ ] **Step 1: Changelog** — under `Unreleased` → `Added`, in user-facing terms: a player's profile now lists every article the paper has published about them, including obituaries where they were the killer.

- [ ] **Step 2: CLAUDE.md** — record: the section reads `articles` directly (no `article_subjects` table — say why, and that `news-facts.ts`'s `NewsSubject` is shaped for one if multi-subject news ever ships); the two expression indexes; the `ap` query param and why it must not be `page`; published-only.

- [ ] **Step 3: Verify the whole repo is green**

```bash
pnpm turbo run typecheck
pnpm turbo run test --concurrency=1
```

- [ ] **Step 4: Commit and open the PR into `develop`** via the `finishing-a-feature` skill.

---

## Deployment

Plain `./deploy/deploy.sh`. Migration `0017` adds two indexes and touches no projection table, so **no `--rebuild`**. Index creation on a 168-row table is instant; no `CONCURRENTLY` needed.

## Follow-on

PR-3 (prose gamertag linkification) is unblocked by this and does not depend on it — its roster is per-article (`articles.gamertag` + `facts.killerGamertag`), both already on the row.
