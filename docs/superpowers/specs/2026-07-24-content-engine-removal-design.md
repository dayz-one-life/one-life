# Sub-project A — Retire the content engine

**Date:** 2026-07-24
**Roadmap:** `2026-07-24-pure-player-app-decomposition.md`
**Depends on:** nothing. Blocks B.

## Goal

Remove the LLM content engine entirely — obituaries, birth notices, the news vertical, the
editorial newsroom, the Discord notifier and the article image pipeline. One Life becomes a player
tool; nothing generates prose, calls a model, or publishes an article.

This is a **deletion**, not a migration. Nothing is replaced. The measure of success is that the
site does less and every remaining feature behaves exactly as it did.

## Why it goes first, and alone

It is the only purely subtractive sub-project, so doing it before B means B is not designing a nav
and a tab bar around routes that are about to vanish. It is also the only irreversible one: the
`articles` table holds 168+ rows of generated prose that cannot be regenerated once the prompts are
gone, and `article_images` holds bytes that cost real money to produce. It gets its own release and
its own verified backup.

## Two releases, not one

**Release 1 — remove the code.** Every route, component, read-model, worker and env var goes. The
`articles` and `article_images` tables **remain in the database, unread by anything.**

**Release 2 — drop the tables.** A separate migration, cut only after Release 1 has run in
production long enough to be confident nothing depends on them.

This mirrors the `0025`/`0026` precedent in this repo: the schema change that cannot be undone lands
in its own release, after the code change that makes it safe. It also means a mistake in Release 1
is a revert, not a restore-from-backup.

**Before Release 2:** take a `pg_dump` and *verify it restores*, because `article_images` is bytes in
Postgres — a dump that silently truncated them is indistinguishable from a good one until you need
it.

---

## What is deleted

### Whole directories and apps

| Path | Size |
|---|---|
| `apps/newsdesk/` | 40 src files (4,119 lines), 44 test files (5,925 lines), Dockerfile, tsconfig, vitest config |
| `apps/web/src/app/(site)/obituaries/` | page, loading, `[slug]`, OG image + 3 `.ttf` |
| `apps/web/src/app/(site)/fresh-spawns/` | same shape |
| `apps/web/src/app/(site)/news/` | same shape, plus `[slug]/loading.tsx` |
| `apps/web/src/components/obituaries/` | 5 components + tests |
| `apps/web/src/components/birth-notices/` | 5 components + tests |
| `apps/web/src/components/news/` | 7 components + tests |
| `.claude/skills/drafting-an-article/` | the editorial session skill |

### Individual files

**`packages/read-models/src/`** — `obituary-articles.ts`, `birth-notice-articles.ts`,
`news-articles.ts`, `player-articles.ts`, and their four tests plus
`test/articles-schema.test.ts`.

**`apps/api/src/routes/`** — `obituaries.ts`, `birth-notices.ts`, `news.ts`, `media.ts` and their
four tests.

**`apps/notifier/src/generators/articles.ts`** and `test/generators-articles.test.ts`.

**`apps/web/src/components/`** — `front-page/news-lead.tsx`, `front-page/latest-obituaries.tsx`,
`front-page/latest-fresh-spawns.tsx`, `front-page/latest-blocks.test.tsx`,
`player/in-the-paper.tsx`, `player/paper-pagination.tsx`, `shared/article-body.tsx`,
`shared/article-hero.tsx`, `shared/pull-quote.tsx`, `shared/numbered-pager.tsx` (all with tests).

**`apps/web/src/lib/`** — `article-roster.ts`, `linkify-gamertags.tsx`, `obituary-format.ts`,
`birth-format.ts`, `news-format.ts` (all with tests).

> `pull-quote.tsx` and `numbered-pager.tsx` live in `shared/` but every consumer is an article
> component. They go. `player/paper-pagination.tsx` uses `pagination-box`, and survivors/friends
> have their own pagers, so nothing else regresses.

### Also orphaned by this change — delete

`packages/read-models/src/obituaries.ts` (`getObituaries`) and
`packages/read-models/src/fresh-spawns.ts` (`getFreshSpawns`), plus
`apps/api/src/routes/fresh-spawns.ts` and its test.

**These are not article code** — they are R4-era `lives` feeds that were built as groundwork and
then superseded by the real article feeds. `getObituaries` already has **zero production
consumers**; `getFreshSpawns` is served by an API route with no web consumer. They survive today
only because their names look like they matter. They go with the rest.

### Kept, despite the name or the association

- **`packages/read-models/src/player-priors.ts`** (`getPlayerPriors`). Its only consumers today are
  the newsdesk and `birth-notice-articles.ts`, so it becomes unconsumed — but it is a genuine
  player-facing read-model, and sub-project C already uses it: the alive card's
  *"Your longest run yet. Previous best: 3d 11h."* is priors data. Keep, and note it is
  temporarily unconsumed.
- **`packages/read-models/src/life-dossier.ts`, `classifyDeath`, `dossierForLife`.** Death-cause
  fidelity is a player feature the newsdesk happened to consume. Untouched.
- **`apps/web/src/components/player/format.ts`** (`mapLabel`, `monthYear`, `relativeDate`,
  `formatDuration`) and **`apps/web/src/components/tabloid/*`** (`Kicker` is used by `/about` and
  the front-page hero; `SectionHeader` by `top-survivors`).
- **`apps/web/src/lib/settle-feed.ts`.** Born from the news honesty work, now used by the survivors
  and player feeds.

---

## Surgical edits

These files are mixed. They are edited, never deleted.

### `packages/read-models/src/life-timeline.ts`

The only non-article read-model that queries `articles`. Remove the `articles` import, the
`obituarySlug: string | null` field on `LifeTimeline`, the published-obituary sub-select, and the
mapping. Drop the `describe("obituarySlug")` block from its test.

> This deletes the regression test pinning that an article is matched to a life by the
> rebuild-stable tuple `(server_id, gamertag, life_started_at)` rather than `life_number`. That
> convention still governs `bans`, so the rule survives — but its only executable proof does not.
> Note it in `CLAUDE.md` rather than leaving it to be rediscovered.

### `packages/read-models/src/sitemap.ts`

Remove the `articles` import, `SitemapArticle`, the `articles` field on `SitemapEntries`, the
published-articles query and its mapping. **The two remaining fetches must still degrade
independently** — that invariant is unrelated to articles and is pinned by a test proven red.

Then `apps/api/src/routes/sitemap.ts`, `apps/web/src/app/sitemap.ts` (drop `/obituaries`,
`/fresh-spawns`, `/news` from `STATIC_PATHS` and the whole `ARTICLE_PATHS` map and article loop),
and the three corresponding tests.

### `apps/api/src/app.ts` and friends

Remove the four `register*Routes` imports and calls, **and the `newsPreviewToken` parameter threaded
through `buildApp`** — which also means `apps/api/src/main.ts` and `apps/api/src/config.ts`
(`NEWS_PREVIEW_TOKEN`).

### `apps/api/src/routes/player-aggregate.ts`

Remove the `getPlayerArticles` import and the `GET /players/:slug/articles` route. The rest of the
file serves player data and stays.

### `apps/notifier/`

Remove the `articles` generator from the import list and the `generators` array in `main.ts`.
**The catalogue goes from twelve kinds to ten.**

> There is no kind union to edit: `notifications.kind` is a plain `text` column, and the two kind
> strings live only in `KIND_MAP` inside `generators/articles.ts`, which is deleted wholesale. The
> only other reference in the codebase is `row.tsx`'s `RED` set.

Web side: `apps/web/src/components/notifications/row.tsx` drops `obituary_published` from `RED` and
`birth_notice_published` from `BLUE`, plus the assertion in `row.test.tsx`.

**Existing rows of those two kinds must be deleted** in Release 2's migration. `notifications` is
durable and never truncated, so they would otherwise sit in players' inboxes linking to routes that
404.

### `apps/web/src/lib/nav.ts`

Remove the `news`, `obituaries` and `fresh-spawns` entries from `NAV_ITEMS` and the three matching
branches in `activeNavKey`. Update `nav.test.ts`. `header.tsx` and `footer.tsx` render `NAV_ITEMS`
and need no change.

**Nav becomes Home · Maps · Survivors · About.** Sub-project B renames Survivors to Leaderboard;
this pass only removes.

### `apps/web/src/app/(site)/page.tsx`

Remove the three article feed imports, reduce the four-way `Promise.all` to `getSurvivors` alone,
and delete the `NewsLead` / `LatestObituaries` / `LatestFreshSpawns` rendering with their failure
banners.

**The home page reverts to the manifesto hero + top-5 board** — the fallback that already exists in
this file for an empty newsroom. It is a known-good render, not a new one. Sub-project C replaces it
properly.

### `apps/web/src/app/(site)/players/[slug]/page.tsx` + `player-profile.tsx`

Remove `getPlayerArticles`, the `?ap=` param parsing, the article arm of the `Promise.all`, the
`articles` / `articlesFailed` / `articlesPage` props, and the In The Paper section.

**The profile page returns to one pagination.** `playerPageHref`'s `ap` parameter and
`PlayerPagination`'s knowledge of it are removed — the two-pagination rule that exists so one
control does not silently reset the other no longer has a second param to preserve.

### `apps/web/src/components/life/hero.tsx`

Remove the `/obituaries/{obituarySlug}` link (L73–76) and the `obituarySlug` fixtures in
`hero.test.tsx`, `timeline.test.tsx` and `life-timeline.test.ts`.

### `apps/web/src/lib/`

- `api.ts` — remove `getPlayerArticles`, `getObituariesFeed`, `getObituary`,
  `getBirthNoticesFeed`, `getBirthNotice`, `getNewsFeed`, `getNewsArticle` and their type imports.
- `types.ts` — remove `PlayerArticleRow`, `PlayerArticlesFeed`, `ArticleBlock`, the obituary,
  birth-notice and news type blocks, and `obituarySlug` from the life-timeline type.
- `seo.ts` — remove `articleLd`, `birthNoticeLd`, `newsLd` and their tests.

### `apps/web/src/components/skeletons.tsx`

Remove `ArticleHeroSkeleton`, `ObituariesSkeleton` and the news / fresh-spawn variants, plus their
assertions in `skeletons.test.tsx`.

### `packages/read-models/src/index.ts`

Remove the four article `export *` lines, plus `./obituaries.js` and `./fresh-spawns.js`.

### `packages/test-support/src/global-setup.ts`

Remove `"articles"` and `"article_images"` from `APP_TABLES` in **Release 1**. The tables still
exist at that point, so listing them is harmless either way — but no test writes them once the code
is gone, so the harness should stop truncating them.

---

## Config, deploy and docs

**`.env.example`** — remove every `NEWSDESK_*` and `DISCORD_OBITUARY_WEBHOOK_URL` line, and
`OPENROUTER_API_KEY` (the newsdesk is its only consumer). Also `NEWS_PREVIEW_TOKEN`.

> **Do not touch `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`.** Those are Discord OAuth login in
> `packages/auth/src/config.ts` and are unrelated.

**`deploy/deploy.sh`** — remove `newsdesk` from `SERVICES`.

**`deploy/README.md`** — remove the worker-table row, the systemd loop entry, the whole
`onelife-newsdesk` section and the unit from the systemctl list. **The operator must
`systemctl disable --now onelife-newsdesk` and delete the unit file by hand** — no `.service` files
are checked in, so the deploy script cannot do it. This is a runbook step, not a code change.

**`CLAUDE.md`** — the content engine occupies roughly L295–500 and L1622–1663. Removing it is a
substantial rewrite, not a delete: the surrounding sub-project entries reference articles in passing
(cross-linking PR-2 and PR-3 are *entirely* about articles and go; the R5a–R5d and editorial
newsroom entries go; the Tabloid redesign entry keeps R1–R4 and loses R5). Historical specs and
plans under `docs/superpowers/` are **left in place** — they are a record of what was built and
why it was removed, and rewriting history helps nobody.

---

## Release 2 — the migration

A single hand-written migration (the drizzle snapshot chain has been broken since `0015`; follow the
hand-written practice and hand-append `meta/_journal.json`, per `CLAUDE.md`):

1. `DROP TABLE article_images;` — dropped first, or its FK to `articles` blocks the second drop.
   (`ON DELETE CASCADE` governs row deletion, not table drops.)
2. `DROP TABLE articles;`
3. `DELETE FROM notifications WHERE kind IN ('obituary_published', 'birth_notice_published');`

Remove the `articles` and `articleImages` definitions from `packages/db/src/schema.ts` in the same
release.

**Deploys with a plain `./deploy/deploy.sh` — no `--rebuild`.** Neither table is a projection;
neither appears in `REBUILD_TRUNCATE_TABLES`, which is correct and unchanged.

**One note on the rebuild-before-migrate hazard:** it does not apply here. That rule forbids naming a
*newly created* table in the truncate list; this migration only drops tables that are absent from
that list entirely.

---

## What must still be true afterwards

A short list to verify, because a deletion this wide is easy to over-apply:

1. **Player pages render**, including per-server standing, funeral cards and the OG card.
2. **Life timeline pages render** — with no obituary link, and every other row unchanged.
3. **The survivors board and its per-map routes** are untouched.
4. **The map, friends, tokens and notifications** all work; the notification catalogue is ten kinds
   and the remaining eight generators are unchanged.
5. **`GET /sitemap` returns**, with static + board + player + life URLs and no article URLs, and the
   two fetches still degrade independently.
6. **`pnpm turbo run test` and `typecheck` pass** with roughly 6,000 lines of newsdesk tests and
   ~30 web test files removed. The remaining suite must not shrink in coverage of anything kept.
7. **The projector rebuild is unaffected** — `REBUILD_TRUNCATE_TABLES` never mentioned articles.

## Risks

**The suite shrinks by more than the code does.** ~5,900 lines of newsdesk tests go, which will make
the diff look alarming and could mask an accidental deletion of a test covering something kept. The
guard is item 6 above: every remaining feature's tests must still exist and still pass.

**`life-timeline.ts` and `sitemap.ts` are the two places to get wrong.** Both are consumed by
features that are staying, and both are easy to over-delete. They deserve individual review.

**Release 2 is irreversible.** The backup must be verified by restoring it, not merely taken.

## Out of scope

Everything in sub-projects B–G. In particular this pass does **not** introduce the tab bar, the page
header, the new home page or the leaderboard changes — the home page reverts to its existing
manifesto fallback and waits for C.
