# Drop images from obituaries & birth notices — design

**Date:** 2026-07-18
**Status:** approved (brainstorming)
**Author:** maintainer (solo)

## Motivation

R5c (v0.17.0) gave every published obituary and birth notice an AI-generated tabloid hero
photo. In practice the images read as **repetitive** and add little to those two verticals. We are
**removing images from obituaries and birth notices** and **reserving image generation for future
news / editorial content** (R5d). The image *infrastructure* stays; only these two article kinds
stop using it.

This is a product decision, not a bug. There is nothing wrong with the R5c pipeline — we simply
don't want photos on death/birth notices.

## Scope

**In scope**
1. **Stop generating** hero images for `obituary` and `birth_notice` articles.
2. **Delete the 165 existing images** and clear the image provenance fields on those articles, and
   reclaim the ~298 MB they occupy.
3. **Remove the image display** from every obituary and fresh-spawns surface (clean removal — no
   dead image branches left behind).

**Out of scope / explicitly retained for R5d news**
- The `article_images` table + the `image_*` columns on `articles` (schema unchanged).
- The API media route `GET /media/heroes/:file` (`apps/api/src/routes/media.ts`).
- The `next.config.ts` `/media/:path*` rewrite and `next/image` usage.
- The entire newsdesk image-generation pipeline (`image-tick`, `image-scene`, `image-prompt`,
  `image-categories`, `openrouter` image client, `saveArticleImage`, …). It goes **dormant**, gated
  off by kind (see below), ready for a future `news` kind.
- The presentational `ArticleHero` + `ArticleHeroSkeleton` components (they encode the brand 4:5
  crop + caption treatment R5d will reuse). They become temporarily unused and are retained with a
  documenting comment.

No `NEWSDESK_IMAGES_ENABLED` change: it stays default-on so the pipeline is live the moment a
future image-eligible kind exists. No new env vars.

## Design

### 1. Generation gate (newsdesk)

The image pass selects work in one query, `findImageTargets` (`apps/newsdesk/src/image-pg-store.ts`):
currently `status = 'published' AND image_url IS NULL AND image_attempts < maxAttempts` across **all
kinds**. Add a **kind exclusion**:

```
... AND articles.kind NOT IN ('obituary', 'birth_notice')
```

Effect today: the two current kinds are excluded, so `findImageTargets` returns nothing and
`imageTick` is a no-op. Effect at R5d: a new `news` kind is **not** in the exclusion list, so it is
image-eligible automatically — which is exactly "save images for news." An exclude-list (rather than
an allow-list of a `news` kind that does not exist yet) avoids speculative code while making the
future kind eligible by default.

`ImageTarget.kind` (`"obituary" | "birth_notice"`) is now vestigial but harmless; R5d widens it when
it adds the news kind. Leave it.

### 2. Data cleanup + space reclaim (migration `0013`)

A **data-only** migration `packages/db/drizzle/0013_*.sql` (next number after `0012`). Because it
changes no schema, `drizzle-kit generate` (which diffs the schema) emits nothing — author it as a
custom migration: `pnpm --filter @onelife/db exec drizzle-kit generate --custom --name=drop_obituary_birth_images`,
then fill the generated empty file with the SQL below and let `_journal.json`/snapshot update
automatically:

```sql
DELETE FROM article_images
 WHERE article_id IN (SELECT id FROM articles WHERE kind IN ('obituary', 'birth_notice'));

UPDATE articles
   SET image_url = NULL, image_caption = NULL, image_prompt = NULL, image_kind = NULL,
       image_model = NULL, image_attempts = 0, image_error = NULL
 WHERE kind IN ('obituary', 'birth_notice');
```

- Deletes all 165 `article_images` rows (only obituary/birth notices have images today) and clears
  the provenance/retry fields so no orphan metadata remains.
- **Backup shrinks immediately:** `pg_dump` serializes only live rows, so the next checkpoint drops
  from ~581 MB back to ~5 MB the moment this runs — no VACUUM required for that win.
- **On-disk reclaim is a separate, post-deploy step:** a plain `DELETE` leaves dead tuples, so the
  table file stays ~298 MB until a one-time **`VACUUM FULL article_images;`** (and its TOAST table).
  `VACUUM FULL` cannot run inside a migration transaction, so it is a documented post-deploy command,
  run once after the release deploys. It is quick (~seconds on 298 MB) and locks only
  `article_images`, which nothing reads or writes for obituary/birth notices anymore.
- **Not** a `--rebuild` deploy: no projection-table shape changes; `article_images` is a durable
  table (in `APP_TABLES`, never truncated).

Irreversibility is accepted (approved): regenerating would re-spend OpenRouter credits.

### 3. Display removal (web — "1A clean removal")

Because the display is already null-safe, clearing the data alone would render every surface
text-only. But leaving image code in components that can provably never have an image is
misleading cruft, so we **remove** it. Exact touch-points (all reverting to the pre-R5c text-only
DOM):

**Article interiors** — drop the `ArticleHero` render + its import:
- `apps/web/src/components/obituaries/obituary-article.tsx` (import + line 34 conditional)
- `apps/web/src/components/birth-notices/birth-notice-article.tsx` (import + line 32 conditional)

**Feed cards** — drop the 1:1 thumbnail block (and the `next/image` import if now unused):
- `apps/web/src/components/obituaries/obituary-card.tsx`
- `apps/web/src/components/birth-notices/birth-notice-card.tsx`

**Home blocks** — drop the thumbnail block:
- `apps/web/src/components/front-page/latest-obituaries.tsx`
- `apps/web/src/components/front-page/latest-fresh-spawns.tsx`

**OpenGraph cards** — remove the `heroDataUri` fetch + the photo panel, reverting to the text-only
OG card:
- `apps/web/src/app/obituaries/[slug]/opengraph-image.tsx`
- `apps/web/src/app/fresh-spawns/[slug]/opengraph-image.tsx`

**JSON-LD** — stop passing the image; remove the `image?` param from both LD builders:
- `apps/web/src/app/obituaries/[slug]/page.tsx` (`ldImage` line)
- `apps/web/src/app/fresh-spawns/[slug]/page.tsx` (`ldImage` line)
- `apps/web/src/lib/seo.ts` (`articleLd` + `birthNoticeLd`: remove the `image` param + `image` field)

**Skeletons** — drop the feed thumb boxes from `ObituariesSkeleton` (used by both `obituaries` and
`fresh-spawns` `loading.tsx`) so the loading state matches the now-thumbnail-less feed:
- `apps/web/src/components/skeletons.tsx`

**Web types** — remove `imageUrl` / `imageCaption`:
- `apps/web/src/lib/types.ts` (the obituary + birth-notice card/article types)

**Read-models** — remove `imageUrl` / `imageCaption` from the interfaces, `CARD_COLS`, and mappers
(this also removes them from the public API responses, which pass through):
- `packages/read-models/src/obituary-articles.ts`
- `packages/read-models/src/birth-notice-articles.ts`

**Retained (documented as unused-pending-R5d):**
- `apps/web/src/components/shared/article-hero.tsx` + `ArticleHeroSkeleton` in
  `apps/web/src/components/skeletons.tsx`.

## Testing

Deletions are mostly reverting to a known-good pre-R5c layout; the existing tests already cover both
the with-image and without-image branches, so most edits are removing the "with image" assertions
and the `imageUrl`/`imageCaption` fixture fields (which otherwise become TS errors once the types
drop those keys).

- **newsdesk:** `apps/newsdesk/test/image-pg-store.test.ts` — add a case proving `findImageTargets`
  **excludes** `obituary` + `birth_notice` (seed one published imageless obituary → expect 0 targets;
  optionally seed a non-excluded kind → expect it selected, guarding the future news path).
- **web components:** update `obituary-article.test.tsx`, `birth-notice-article.test.tsx`,
  `obituary-card.test.tsx`, `birth-notice-card.test.tsx`, `front-page/latest-blocks.test.tsx` — drop
  the "renders the hero image / thumbnail when present" cases; keep the text-only assertions.
- **fixtures:** remove `imageUrl`/`imageCaption` from fixtures in `more-fresh-meat.test.tsx`,
  `priors-box.test.tsx`, `birth-format.test.ts`, `obituary-format.test.ts` (TS-driven).
- **seo:** `seo.test.ts` — drop the `ld.image` assertions.
- **read-models:** `obituary-articles.test.ts`, `birth-notice-articles.test.ts` — drop `imageUrl`
  assertions.
- **`ArticleHero`/`ArticleHeroSkeleton` tests stay green** (the components are unchanged).
- Full gates: `pnpm turbo run typecheck` and `pnpm turbo run test --concurrency=1`
  (DB suites need `TEST_DATABASE_URL`).

## Shipping (solo-maintainer workflow)

1. Develop in the isolated worktree `feature/drop-obituary-birth-images` (off `develop`) — prod
   checkout stays on `v0.18.0`.
2. Implement §1–§3, update tests, run typecheck + tests green.
3. Update `CHANGELOG.md` (Removed/Changed) and `CLAUDE.md` (R5c → note images retired for
   obit/birth, retained for news).
4. PR → `develop`; self-review (a `COMMENTED` review counts in solo mode); squash-merge.
5. Release `develop` → `main` (v0.19.0), tag, deploy via `./deploy/deploy.sh` (migrate applies
   `0013`; no `--rebuild`).
6. **Post-deploy:** run `VACUUM FULL article_images;` once to return the ~298 MB to the OS; verify
   `SELECT count(*) FROM article_images;` = 0 and the DB/backup sizes dropped.

## Rollback

- Pre-deploy: standard code rollback (deploy.sh reverts code if it fails before migrate).
- Post-migrate: the image bytes are gone (accepted). Reverting the *display* code is a normal code
  revert; the data is not restored (would require regeneration). Given the images are being retired
  deliberately, this is acceptable.
