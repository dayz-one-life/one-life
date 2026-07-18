# Drop images from obituaries & birth notices — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop generating and displaying AI hero images on obituaries and birth notices, delete the existing images to reclaim ~298 MB, and keep the image pipeline intact for future news/editorial content.

**Architecture:** Three seams. (1) Newsdesk `findImageTargets` gains a kind exclusion so the image pass finds no obituary/birth work (auto-enables for a future `news` kind). (2) A data-only migration `0013` deletes the `article_images` rows and clears the `image_*` fields for those two kinds. (3) The web reverts every obituary/fresh-spawns surface to the pre-R5c text-only DOM; the shared `ArticleHero` + media route + `article_images` table are retained for news.

**Tech Stack:** pnpm + turbo monorepo, TypeScript/ESM, Postgres + Drizzle, Next.js 15 (App Router, `next/image`, `next/og`), Vitest + Testing Library.

## Global Constraints

- Work entirely in the existing worktree `feature/drop-obituary-birth-images` at
  `/var/www/dayzonelife.com/.claude/worktrees/drop-obit-birth-images` (branch off `develop`). The prod
  checkout at `/var/www/dayzonelife.com` stays on `v0.18.0` — do not touch it.
- Run once before starting: `pnpm install` in the worktree (fresh node_modules; uses the shared pnpm store).
- Test gate: `pnpm turbo run test --concurrency=1` (DB suites need `TEST_DATABASE_URL`; the dev Postgres is on host port **5434**, not 5432 — see `docker-compose.override.yml`). Typecheck gate: `pnpm turbo run typecheck`.
- `articles.kind` is a free-text column (`text("kind").notNull()`), not an enum — a test may seed `kind: "news"` as a stand-in for any future image-eligible kind.
- **Keep, never delete:** `article_images` table + `image_*` columns; `apps/api/src/routes/media.ts` (`/media/heroes/:file`); the `next.config.ts` `/media/:path*` rewrite; the entire newsdesk image pipeline (`image-tick`, `image-scene`, `image-prompt`, `image-categories`, `openrouter` image client, `saveArticleImage`/`recordImageFailure`/`recentCovers`); and the presentational `ArticleHero` + `ArticleHeroSkeleton` (retained for R5d news).
- Conventional-commit messages; append the repo's `Co-Authored-By:` + `Claude-Session:` trailers to every commit (as elsewhere in this repo). Keep each git command single-line.
- Deploy is a normal migrate — **no `--rebuild`** (no projection-table shape change).

---

### Task 1: Newsdesk generation gate

**Files:**
- Modify: `apps/newsdesk/src/image-pg-store.ts` (`findImageTargets`, the `.where(...)` around lines 35-42)
- Test: `apps/newsdesk/test/image-pg-store.test.ts` (rewrite the two `findImageTargets` cases, lines 72-113)

**Interfaces:**
- Produces: `findImageTargets(db, { limit, maxAttempts })` — unchanged signature; now returns only articles whose `kind` is **not** `obituary`/`birth_notice`.

- [ ] **Step 1: Rewrite the failing tests**

Replace the entire `describe("findImageTargets", …)` block (lines 72-113) with:

```ts
describe("findImageTargets", () => {
  it("excludes obituary and birth_notice kinds; an image-eligible kind is selected", async () => {
    // 'news' stands in for any future image-eligible kind (kind is a free-text column).
    const obit = await seedArticle({ kind: "obituary", createdAt: hrs(101) });
    const birth = await seedArticle({ kind: "birth_notice", createdAt: hrs(102) });
    const news = await seedArticle({ kind: "news", createdAt: hrs(103) });

    const targets = await findImageTargets(db, { limit: 500, maxAttempts: 3 });
    const mineIds = targets
      .filter((t) => [obit.id, birth.id, news.id].includes(t.articleId))
      .map((t) => t.articleId);

    expect(mineIds).toContain(news.id);
    expect(mineIds).not.toContain(obit.id);
    expect(mineIds).not.toContain(birth.id);
  });

  it("skips already-imaged, failed stubs, and exhausted attempts (for an image-eligible kind)", async () => {
    const imaged = await seedArticle({ kind: "news", imageUrl: "/media/heroes/already-imaged.png" });
    const failed = await seedArticle({ kind: "news", status: "failed" });
    const exhausted = await seedArticle({ kind: "news", imageAttempts: 3 });

    const targets = await findImageTargets(db, { limit: 500, maxAttempts: 3 });
    const mine = targets.filter((t) => [imaged.id, failed.id, exhausted.id].includes(t.articleId));
    expect(mine).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests — verify they fail**

Run: `pnpm --filter @onelife/newsdesk exec vitest run test/image-pg-store.test.ts -t "findImageTargets"`
Expected: FAIL — the first case still returns obituary/birth_notice rows (gate not yet added).

- [ ] **Step 3: Add the kind exclusion**

In `apps/newsdesk/src/image-pg-store.ts`, add `notInArray` to the drizzle import on line 3 and extend the `.where(and(...))` in `findImageTargets`:

```ts
import { and, eq, desc, isNull, isNotNull, notInArray, sql } from "drizzle-orm";
```

```ts
    .where(
      and(
        eq(articles.status, "published"),
        isNull(articles.imageUrl),
        isNotNull(articles.slug),
        sql`${articles.imageAttempts} < ${opts.maxAttempts}`,
        // Images are reserved for news/editorial — obituaries and birth notices never get one.
        // A future 'news' kind is not excluded here, so it becomes image-eligible automatically.
        notInArray(articles.kind, ["obituary", "birth_notice"]),
      ),
    )
```

- [ ] **Step 4: Run the tests — verify they pass**

Run: `pnpm --filter @onelife/newsdesk exec vitest run test/image-pg-store.test.ts`
Expected: PASS (all `findImageTargets`, `recentCovers`, `saveArticleImage/recordImageFailure` suites green).

- [ ] **Step 5: Commit**

```bash
git add apps/newsdesk/src/image-pg-store.ts apps/newsdesk/test/image-pg-store.test.ts
git commit -m "feat(newsdesk): stop generating images for obituaries and birth notices"
```

---

### Task 2: Read-models drop image fields

**Files:**
- Modify: `packages/read-models/src/obituary-articles.ts` (interface lines 21-22, `CARD_COLS` 60-61, mapper 133-134)
- Modify: `packages/read-models/src/birth-notice-articles.ts` (interface lines 20-21, `CARD_COLS` 54-55, mappers 108-109 + 148-149)
- Test: `packages/read-models/test/obituary-articles.test.ts`, `packages/read-models/test/birth-notice-articles.test.ts`

**Interfaces:**
- Produces: `ObituaryCard`, `BirthNoticeCard` (read-model) — no longer carry `imageUrl` / `imageCaption`. This also drops those keys from the public `GET /obituaries*` and `GET /birth-notices*` API responses (the API passes the read-model object through).

- [ ] **Step 1: Update the read-model tests**

In `packages/read-models/test/obituary-articles.test.ts` and `birth-notice-articles.test.ts`, remove every assertion referencing `imageUrl` / `imageCaption` (e.g. `expect(card.imageUrl).toBe(...)`, and any `imageUrl`/`imageCaption` keys in expected-object literals). Do not add replacements.

- [ ] **Step 2: Run the read-model tests — verify they still compile/run against current code**

Run: `pnpm --filter @onelife/read-models exec vitest run test/obituary-articles.test.ts test/birth-notice-articles.test.ts`
Expected: PASS (assertions removed; fields still present in code — this step just confirms the tests are green before the code edit).

- [ ] **Step 3: Remove the fields from `obituary-articles.ts`**

Delete these lines:
- Interface `ObituaryCard`: `  imageUrl: string | null;` and `  imageCaption: string | null;` (21-22).
- `CARD_COLS`: `  imageUrl: articles.imageUrl,` and `  imageCaption: articles.imageCaption,` (60-61).
- `getObituaryBySlug` return mapper: `    imageUrl: r.imageUrl,` and `    imageCaption: r.imageCaption,` (133-134).

- [ ] **Step 4: Remove the fields from `birth-notice-articles.ts`**

Delete these lines:
- Interface `BirthNoticeCard`: `  imageUrl: string | null;` / `  imageCaption: string | null;` (20-21).
- `CARD_COLS`: `  imageUrl: articles.imageUrl,` / `  imageCaption: articles.imageCaption,` (54-55).
- `getPublishedBirthNotices` mapper: `        imageUrl: r.imageUrl,` / `        imageCaption: r.imageCaption,` (108-109).
- `getBirthNoticeBySlug` mapper: `    imageUrl: r.imageUrl,` / `    imageCaption: r.imageCaption,` (148-149).

- [ ] **Step 5: Typecheck + test**

Run: `pnpm --filter @onelife/read-models run typecheck && pnpm --filter @onelife/read-models exec vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/read-models/src/obituary-articles.ts packages/read-models/src/birth-notice-articles.ts packages/read-models/test/obituary-articles.test.ts packages/read-models/test/birth-notice-articles.test.ts
git commit -m "refactor(read-models): drop image fields from obituary/birth-notice cards"
```

---

### Task 3: Web article interiors — remove ArticleHero

**Files:**
- Modify: `apps/web/src/components/obituaries/obituary-article.tsx` (import line 5, render line 34)
- Modify: `apps/web/src/components/birth-notices/birth-notice-article.tsx` (import line 4, render line 32)
- Test: `apps/web/src/components/obituaries/obituary-article.test.tsx`, `apps/web/src/components/birth-notices/birth-notice-article.test.tsx`

- [ ] **Step 1: Update the tests**

In `obituary-article.test.tsx`: delete the test `test("renders the hero image and caption when imageUrl is present", …)` (around lines 37-40, the block that builds `withImage` and asserts an `img`). Keep `test("renders no hero image when imageUrl is absent", …)`. Leave the fixture's `imageUrl: null, imageCaption: null` line for now (removed in Task 7).

In `birth-notice-article.test.tsx`: same — delete `test("renders the hero image and caption when imageUrl is present", …)` (around 47-49); keep the "renders no hero image when imageUrl is absent" case.

- [ ] **Step 2: Run tests — verify still green on current code**

Run: `pnpm --filter @onelife/web exec vitest run src/components/obituaries/obituary-article.test.tsx src/components/birth-notices/birth-notice-article.test.tsx`
Expected: PASS.

- [ ] **Step 3: Remove ArticleHero from `obituary-article.tsx`**

Delete the import line 5 (`import { ArticleHero } from "@/components/shared/article-hero";`) and the render line 34 (`      {article.imageUrl ? <ArticleHero src={article.imageUrl} caption={article.imageCaption} accent="red" /> : null}`) plus the blank line it leaves.

- [ ] **Step 4: Remove ArticleHero from `birth-notice-article.tsx`**

Delete the import line 4 and the render line 32 (`      {article.imageUrl ? <ArticleHero src={article.imageUrl} caption={article.imageCaption} accent="blue" /> : null}`) plus the blank line.

- [ ] **Step 5: Typecheck + test**

Run: `pnpm --filter @onelife/web run typecheck && pnpm --filter @onelife/web exec vitest run src/components/obituaries/obituary-article.test.tsx src/components/birth-notices/birth-notice-article.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/obituaries/obituary-article.tsx apps/web/src/components/birth-notices/birth-notice-article.tsx apps/web/src/components/obituaries/obituary-article.test.tsx apps/web/src/components/birth-notices/birth-notice-article.test.tsx
git commit -m "refactor(web): remove hero image from obituary/birth-notice interiors"
```

---

### Task 4: Web feed cards + home blocks — remove thumbnails

**Files:**
- Modify: `apps/web/src/components/obituaries/obituary-card.tsx`
- Modify: `apps/web/src/components/birth-notices/birth-notice-card.tsx`
- Modify: `apps/web/src/components/front-page/latest-obituaries.tsx`
- Modify: `apps/web/src/components/front-page/latest-fresh-spawns.tsx`
- Test: `apps/web/src/components/obituaries/obituary-card.test.tsx`, `apps/web/src/components/birth-notices/birth-notice-card.test.tsx`, `apps/web/src/components/front-page/latest-blocks.test.tsx`

- [ ] **Step 1: Update the tests**

- `obituary-card.test.tsx`: delete `test("renders a thumbnail inside a flex row when imageUrl is present", …)` (≈36-37); keep `test("renders no thumbnail and no wrapper divs when imageUrl is absent", …)`.
- `birth-notice-card.test.tsx`: delete the "renders a thumbnail inside a flex row when imageUrl is present" case (≈38-39); keep the "no thumbnail" case.
- `latest-blocks.test.tsx`: in both `it("renders a thumbnail when imageUrl is present, no wrapper when absent", …)` cases (≈35-39 and 55-59), delete the `rerender(...)` line that sets `imageUrl: "/media/thumbs/x.png"` and its thumbnail assertion; keep the no-image assertion. Rename each `it(...)` to `"renders no thumbnail wrapper"`.

- [ ] **Step 2: Run tests — verify green on current code**

Run: `pnpm --filter @onelife/web exec vitest run src/components/obituaries/obituary-card.test.tsx src/components/birth-notices/birth-notice-card.test.tsx src/components/front-page/latest-blocks.test.tsx`
Expected: PASS.

- [ ] **Step 3: `obituary-card.tsx` — drop the thumbnail branch**

Remove `import Image from "next/image";` (line 2). Replace the `return (...)` (lines 30-43) with:

```tsx
  return (
    <article className="border-b border-hairline py-6">
      {content}
    </article>
  );
```

- [ ] **Step 4: `birth-notice-card.tsx` — drop the thumbnail branch**

Remove `import Image from "next/image";` (line 2). Replace the `return (...)` (lines 35-48) with:

```tsx
  return (
    <article className="border-b border-hairline py-6">
      {content}
    </article>
  );
```

- [ ] **Step 5: `latest-obituaries.tsx` — drop the thumbnail branch**

Remove `import Image from "next/image";` (line 2). Replace the `<li>` (lines 37-50) with:

```tsx
            return (
              <li key={r.slug} className="border-b border-hairline py-3">
                {content}
              </li>
            );
```

- [ ] **Step 6: `latest-fresh-spawns.tsx` — drop the thumbnail branch**

Remove `import Image from "next/image";` (line 2). Replace the `<li>` (lines 37-50) with:

```tsx
            return (
              <li key={r.slug} className="border-b border-hairline py-3">
                {content}
              </li>
            );
```

- [ ] **Step 7: Typecheck + test**

Run: `pnpm --filter @onelife/web run typecheck && pnpm --filter @onelife/web exec vitest run src/components/obituaries/obituary-card.test.tsx src/components/birth-notices/birth-notice-card.test.tsx src/components/front-page/latest-blocks.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/obituaries/obituary-card.tsx apps/web/src/components/birth-notices/birth-notice-card.tsx apps/web/src/components/front-page/latest-obituaries.tsx apps/web/src/components/front-page/latest-fresh-spawns.tsx apps/web/src/components/obituaries/obituary-card.test.tsx apps/web/src/components/birth-notices/birth-notice-card.test.tsx apps/web/src/components/front-page/latest-blocks.test.tsx
git commit -m "refactor(web): remove feed/home thumbnails for obituaries and birth notices"
```

---

### Task 5: OpenGraph cards — remove the photo panel

**Files:**
- Modify: `apps/web/src/app/obituaries/[slug]/opengraph-image.tsx`
- Modify: `apps/web/src/app/fresh-spawns/[slug]/opengraph-image.tsx`

(No unit tests — OG images are integration-rendered; the typecheck + `next build` in Task 7 covers them.)

- [ ] **Step 1: `obituaries/[slug]/opengraph-image.tsx` — revert to text-only**

Delete: `const API_ORIGIN = …` (line 12); the `EMBEDDABLE_CONTENT_TYPES` comment + const (14-17); the whole `heroDataUri` function (19-31); and the `const hero = await heroDataUri(...)` line (41). Then replace the `return new ImageResponse( hero ? (...) : (...), {...})` so it renders only the text-only layout:

```tsx
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0C0C08", color: "#FBFAF2", padding: 64 }}>
        {textColumn}
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
```

- [ ] **Step 2: `fresh-spawns/[slug]/opengraph-image.tsx` — revert to text-only**

Identical edit: delete `API_ORIGIN`, `EMBEDDABLE_CONTENT_TYPES`, `heroDataUri`, and the `const hero = …` line; replace the `ImageResponse` first arg with the text-only `<div>` (as above). Everything else (the `readout`/`textColumn` construction) stays.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @onelife/web run typecheck`
Expected: PASS (no unused-import/`hero`/`API_ORIGIN` errors).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/obituaries/[slug]/opengraph-image.tsx apps/web/src/app/fresh-spawns/[slug]/opengraph-image.tsx
git commit -m "refactor(web): revert obituary/birth OG cards to text-only"
```

---

### Task 6: JSON-LD — stop passing the image

**Files:**
- Modify: `apps/web/src/lib/seo.ts` (`articleLd` 31-47, `birthNoticeLd` 49-65)
- Modify: `apps/web/src/app/obituaries/[slug]/page.tsx` (lines 42-43)
- Modify: `apps/web/src/app/fresh-spawns/[slug]/page.tsx` (lines 31-32)
- Test: `apps/web/src/lib/seo.test.ts`

**Interfaces:**
- Produces: `articleLd(a, url)` and `birthNoticeLd(a, url)` — the third `image?` parameter is removed; the returned object no longer has an `image` field.

- [ ] **Step 1: Update `seo.test.ts`**

Delete the two assertions that pass an image URL and expect `ld.image` (≈48-49 for `birthNoticeLd`, ≈73-74 for `articleLd`), plus the `image` argument in those `articleLd(...)` / `birthNoticeLd(...)` calls. Keep the rest of each test (headline/description/url/about assertions).

- [ ] **Step 2: Run — verify fails**

Run: `pnpm --filter @onelife/web exec vitest run src/lib/seo.test.ts`
Expected: PASS after edit if you removed the image assertions (they were the only image coverage). If you left any `ld.image` assertion it FAILs — remove it.

- [ ] **Step 3: Edit `seo.ts`**

`articleLd`: remove the `  image?: string,` parameter (line 34) and the `    ...(image ? { image: [image] } : {}),` line (45). `birthNoticeLd`: remove `  image?: string,` (52) and `    ...(image ? { image: [image] } : {}),` (63).

- [ ] **Step 4: Edit the two pages**

`obituaries/[slug]/page.tsx`: delete `const ldImage = article.imageUrl ? absoluteUrl(article.imageUrl) : undefined;` (42) and change the next line to `const ld = articleLd(article, absoluteUrl(obituaryHref(slug)));`.

`fresh-spawns/[slug]/page.tsx`: delete `const ldImage = article.imageUrl ? absoluteUrl(article.imageUrl) : undefined;` (31) and change the next line to `const ld = birthNoticeLd(article, absoluteUrl(birthNoticeHref(slug)));`.

- [ ] **Step 5: Typecheck + test**

Run: `pnpm --filter @onelife/web run typecheck && pnpm --filter @onelife/web exec vitest run src/lib/seo.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/seo.ts apps/web/src/app/obituaries/[slug]/page.tsx apps/web/src/app/fresh-spawns/[slug]/page.tsx apps/web/src/lib/seo.test.ts
git commit -m "refactor(web): drop image from obituary/birth JSON-LD"
```

---

### Task 7: Web types, skeletons, fixture sweep, full green

**Files:**
- Modify: `apps/web/src/lib/types.ts` (ObituaryCard 177-178, BirthNoticeCard 202-203)
- Modify: `apps/web/src/components/skeletons.tsx` (`ObituariesSkeleton` 99-120; doc-comment `ArticleHero`/`ArticleHeroSkeleton` as retained)
- Test/fixtures to sweep (remove now-invalid `imageUrl`/`imageCaption` keys): `apps/web/src/components/birth-notices/more-fresh-meat.test.tsx`, `apps/web/src/components/birth-notices/priors-box.test.tsx`, `apps/web/src/lib/birth-format.test.ts`, `apps/web/src/lib/obituary-format.test.ts`, plus any remaining `imageUrl: null` lines in the Task 3/4 test files.
- Test: `apps/web/src/components/skeletons.test.tsx`

- [ ] **Step 1: Remove the fields from `types.ts`**

Delete `  imageUrl: string | null;` / `  imageCaption: string | null;` from `ObituaryCard` (177-178) and from `BirthNoticeCard` (202-203).

- [ ] **Step 2: Typecheck to surface every fixture that still sets the fields**

Run: `pnpm --filter @onelife/web run typecheck`
Expected: FAIL — each remaining `imageUrl: null, imageCaption: null` (and any `imageUrl: "…"`) in a fixture is now `Object literal may only specify known properties`. Note the file:line list.

- [ ] **Step 3: Sweep the fixtures**

Remove the `imageUrl` / `imageCaption` keys from every fixture the typecheck flagged — at minimum: `more-fresh-meat.test.tsx:9`, `priors-box.test.tsx:9`, `birth-format.test.ts:17`, `obituary-format.test.ts:9`, `latest-blocks.test.tsx:15` & `:22`, `obituary-card.test.tsx:15`, `birth-notice-card.test.tsx:16`, `obituary-article.test.tsx:17`, `birth-notice-article.test.tsx:19`. Delete only the two keys; leave the surrounding object intact.

- [ ] **Step 4: Trim `ObituariesSkeleton` thumb boxes + document retained pieces**

In `skeletons.tsx`, replace the `ObituariesSkeleton` feed-row map body (108-115, the `<div className="flex gap-4"> … </div>`) with the thumbnail-less rows:

```tsx
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="border-b border-hairline py-6">
          <Bar className="h-3 w-40" />
          <Bar className="mt-2 h-8 w-full max-w-xl" />
          <Bar className="mt-3 h-3 w-96 max-w-full" />
        </div>
      ))}
```

Update the `ArticleHeroSkeleton` doc comment (lines 92-93) to note it is retained for future news/editorial interiors, currently unused. (`ArticleHero` in `article-hero.tsx` is already comment-documented as generic; add "Retained for future news/editorial; currently no article kind uses it." to its top comment.)

- [ ] **Step 5: Update `skeletons.test.tsx` if it asserts the thumb structure**

Open `skeletons.test.tsx`. If any `ObituariesSkeleton` test asserts the presence of a 24×24 thumb `Bar` (e.g. `h-24 w-24`), update it to assert the row no longer renders that thumb. The `ArticleHeroSkeleton` test (≈25-26) stays unchanged.

- [ ] **Step 6: Full typecheck + full test suite**

Run: `pnpm turbo run typecheck && pnpm turbo run test --concurrency=1`
Expected: PASS across all packages (with `TEST_DATABASE_URL` set).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/types.ts apps/web/src/components/skeletons.tsx apps/web/src/components/skeletons.test.tsx apps/web/src/components/shared/article-hero.tsx apps/web/src/components/birth-notices/more-fresh-meat.test.tsx apps/web/src/components/birth-notices/priors-box.test.tsx apps/web/src/lib/birth-format.test.ts apps/web/src/lib/obituary-format.test.ts apps/web/src/components/obituaries/obituary-card.test.tsx apps/web/src/components/birth-notices/birth-notice-card.test.tsx apps/web/src/components/front-page/latest-blocks.test.tsx apps/web/src/components/obituaries/obituary-article.test.tsx apps/web/src/components/birth-notices/birth-notice-article.test.tsx
git commit -m "refactor(web): drop image fields from card types + skeletons; retain ArticleHero for news"
```

---

### Task 8: Data migration 0013 — delete images + clear fields

**Files:**
- Create: `packages/db/drizzle/0013_drop_obituary_birth_images.sql` (+ the auto-updated `packages/db/drizzle/meta/_journal.json` and `0013_snapshot.json`)

**Testing note:** this repo does not unit-test data migrations (e.g. the `0008` character-rollup rebuild was verified in prod, not by a test); its correctness is a reviewed WHERE clause plus a post-deploy check. Follow that pattern — no unit test; verification is in the deploy runbook below.

- [ ] **Step 1: Generate an empty custom migration**

Run: `pnpm --filter @onelife/db exec drizzle-kit generate --custom --name=drop_obituary_birth_images`
Expected: creates `packages/db/drizzle/0013_drop_obituary_birth_images.sql` (empty) and appends an entry to `meta/_journal.json`. (If the flag name differs in this drizzle-kit version, run `drizzle-kit generate --help` and use the custom/empty-migration option; the goal is an empty `0013_*.sql` registered in the journal.)

- [ ] **Step 2: Fill the migration SQL**

Write into `packages/db/drizzle/0013_drop_obituary_birth_images.sql`:

```sql
-- R5c images are retired for obituaries and birth notices (reserved for news/editorial).
-- Delete the stored image bytes and clear the provenance/retry fields on those two kinds.
DELETE FROM "article_images"
 WHERE "article_id" IN (
   SELECT "id" FROM "articles" WHERE "kind" IN ('obituary', 'birth_notice')
 );
--> statement-breakpoint
UPDATE "articles"
   SET "image_url" = NULL,
       "image_caption" = NULL,
       "image_prompt" = NULL,
       "image_kind" = NULL,
       "image_model" = NULL,
       "image_attempts" = 0,
       "image_error" = NULL
 WHERE "kind" IN ('obituary', 'birth_notice');
```

- [ ] **Step 3: Apply against the local test/dev DB to prove it runs clean**

Run: `pnpm --filter @onelife/db run db:migrate`
Expected: `migrations applied successfully!` with no error (0013 applies; on an already-migrated DB it is a no-op DELETE/UPDATE).

- [ ] **Step 4: Sanity-check the SQL locally (optional but recommended)**

Against the dev DB, confirm the targeting is kind-scoped: seed a throwaway `news` article + `article_images` row, run the two statements, and confirm the `news` image row survives while an `obituary`/`birth_notice` one would be removed. (Manual psql check; no committed test.)

- [ ] **Step 5: Commit**

```bash
git add packages/db/drizzle/0013_drop_obituary_birth_images.sql packages/db/drizzle/meta/_journal.json packages/db/drizzle/meta/0013_snapshot.json
git commit -m "feat(db): migration 0013 — delete obituary/birth-notice images"
```

---

### Task 9: Docs — CHANGELOG + CLAUDE.md

**Files:**
- Modify: `CHANGELOG.md` (new `## [Unreleased]` entries)
- Modify: `CLAUDE.md` (R5c entry + newsdesk app entry)

- [ ] **Step 1: CHANGELOG**

Under `## [Unreleased]`, add:

```markdown
### Changed
- Obituaries and birth notices no longer carry an AI hero image — the R5c image pass is gated off for
  those two kinds (`findImageTargets` excludes them) and image generation is now reserved for future
  news/editorial content. The image infrastructure (article_images table, /media/heroes route,
  next/image, ArticleHero, the newsdesk image pipeline) is retained.

### Removed
- Image display on every obituary/fresh-spawns surface (article hero, feed/home thumbnails, OG photo
  panel, JSON-LD image) and the `imageUrl`/`imageCaption` fields from the obituary/birth-notice
  read-models and API responses.

### Fixed
- Migration `0013` deletes the previously-generated obituary/birth-notice images and clears their
  `image_*` fields, reclaiming ~298 MB (run `VACUUM FULL article_images;` post-deploy to return the
  space to the OS).
```

- [ ] **Step 2: CLAUDE.md**

In the **R5c shipped — Article Images** paragraph, prepend a one-line status note: `**Update (v0.19.0): images retired for obituaries + birth notices — the image pass is kind-gated off for both (reserved for future news); the 165 existing images were deleted (migration 0013). The pipeline, article_images table, media route, and ArticleHero are retained.**` In the `newsdesk` **Fourth pass** entry, note that `imageTick` currently has no eligible kinds (obituary/birth_notice excluded) and lights up when a `news` kind ships.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: changelog + CLAUDE.md for retiring obituary/birth images"
```

---

## Post-implementation: shipping (workflow skills, not code tasks)

1. **Finish the feature** (`superpowers:finishing-a-feature` / repo `finishing-a-feature`): final `pnpm turbo run typecheck` + `pnpm turbo run test --concurrency=1` green; push the branch; open a PR into `develop`.
2. **Self-review + merge** (`reviewing-a-contribution` → `merging-a-contribution`): post a review (a `COMMENTED` review satisfies the solo gate), then **squash-merge** into `develop`.
3. **Release** (`drafting-a-release` → `cutting-a-release`): `develop` → `main` PR (v0.19.0), tag, notes.
4. **Deploy:** from the prod checkout `cd /var/www/dayzonelife.com && ./deploy/deploy.sh` (migrate applies `0013`; **no `--rebuild`**).
5. **Post-deploy reclaim + verify:**
   - `VACUUM FULL article_images;` (returns ~298 MB to the OS; brief exclusive lock on that table only).
   - Verify: `SELECT count(*) FROM article_images;` → `0`; `SELECT count(*) FROM articles WHERE image_url IS NOT NULL;` → `0`; `pg_database_size` back to ~23 MB.
   - Spot-check a live `/obituaries/<slug>` and `/fresh-spawns/<slug>` render text-only (200, no `<img>`), and the next `pg_dump` checkpoint is ~5 MB.
6. Remove the worktree: `git worktree remove /var/www/dayzonelife.com/.claude/worktrees/drop-obit-birth-images`.

## Self-review (author checklist — completed)

- **Spec coverage:** generation gate → Task 1; data delete + reclaim → Task 8 + shipping §5; clean display removal (interiors, cards, home, OG, JSON-LD, skeletons, types, read-models) → Tasks 2–7; retained infra → Global Constraints + Tasks 5/7; ship path → shipping section. ✓
- **Placeholder scan:** no TBD/TODO; every code step shows the exact edit. The one "if the flag name differs" branch (Task 8 Step 1) is a documented fallback with a concrete goal, not a placeholder. ✓
- **Type consistency:** `findImageTargets` signature unchanged; `articleLd`/`birthNoticeLd` lose the third arg consistently across `seo.ts` + both pages + `seo.test.ts`; `imageUrl`/`imageCaption` removed from read-model types (Task 2) and web types (Task 7) with matching fixture sweeps. ✓
