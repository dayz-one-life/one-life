# Retire the Content Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the LLM content engine — obituaries, birth notices, the news vertical, the editorial newsroom, the Discord notifier and the article image pipeline — so that One Life is a player tool with no generated prose.

**Architecture:** A deletion, in two releases. Release 1 (Tasks 1–10) removes every line of code, route, worker and env var; the `articles` and `article_images` tables remain in the database, unread. Release 2 (Task 11) drops them. Tasks are ordered **leaf-first** so the tree compiles and the suite passes at every commit: web surfaces → API routes → notifier → read-models → the two surgical edits → docs.

**Tech Stack:** pnpm + turbo monorepo, TypeScript ESM, Next.js 15 (App Router), Fastify, Drizzle + Postgres, vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-24-content-engine-removal-design.md`
**Branch:** `feature/retire-content-engine` (already exists, specs committed at `82b0d69`)

## Global Constraints

- **This is a deletion. Nothing is replaced.** If a task tempts you to write a new feature, stop — that belongs to sub-project B or C.
- **TDD is inverted here.** For a pure deletion the test cycle is: delete → run `pnpm turbo run typecheck` and `pnpm turbo run test --concurrency=1` → both pass. For the two surgical edits (Tasks 8 and 9) you remove the obsolete assertions *first*, watch the suite go red on the code that still references them, then remove the code.
- **Every task ends green.** Never commit a state where `typecheck` or `test` fails. If a task leaves a dangling import, it is not finished.
- **Do not delete anything not named in this plan.** The inventory behind it was built deliberately; several files are *named* like article code but are not (see Task 7's warning), and several are shared (`player/format.ts`, `components/tabloid/*`, `settle-feed.ts`, `life-dossier.ts`, `player-priors.ts`).
- **Test DB:** suites need `TEST_DATABASE_URL`. To migrate it: `DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate` — `drizzle-kit` reads `DATABASE_URL` and nothing else.
- **Local Postgres** may be on a non-default port (this dev machine uses 5434). Check `docker ps`.
- **Commit per task**, with the `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` and `Claude-Session:` trailers this repo uses.
- **Do not touch** `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` — those are Discord OAuth login in `packages/auth/src/config.ts`, unrelated to the content engine.

---

## File Structure

**Deleted wholesale:** `apps/newsdesk/` · `apps/web/src/app/(site)/{obituaries,fresh-spawns,news}/` · `apps/web/src/components/{obituaries,birth-notices,news}/` · `.claude/skills/drafting-an-article/` · 4 API route files · 4 article read-models + 2 orphans · 1 notifier generator · ~12 individual web components and lib files.

**Edited (mixed responsibility, must survive):** `packages/read-models/src/{life-timeline,sitemap,index}.ts` · `apps/api/src/{app,main,config}.ts` + `routes/{player-aggregate,sitemap}.ts` · `apps/notifier/src/main.ts` · `apps/web/src/lib/{nav,api,types,seo}.ts` · `apps/web/src/app/(site)/page.tsx` · `apps/web/src/app/(site)/players/[slug]/page.tsx` · `apps/web/src/app/sitemap.ts` · `apps/web/src/components/{header,footer}` (no change — they render `NAV_ITEMS`) · `apps/web/src/components/player/player-profile.tsx` · `apps/web/src/components/life/hero.tsx` · `apps/web/src/components/notifications/row.tsx` · `apps/web/src/components/skeletons.tsx` · `packages/test-support/src/global-setup.ts` · `deploy/deploy.sh` · `deploy/README.md` · `.env.example` · `CLAUDE.md` · `CHANGELOG.md`.

---

### Task 1: Delete the newsdesk app

Nothing imports `apps/newsdesk`, so it goes first and independently.

**Files:**
- Delete: `apps/newsdesk/` (entire directory — 40 src files, 44 test files, Dockerfile, tsconfig.json, vitest.config.ts, package.json, `.turbo/`)
- Delete: `.claude/skills/drafting-an-article/`
- Modify: `deploy/deploy.sh` (the `SERVICES` array)
- Modify: `.env.example`
- Modify: `deploy/README.md`

- [ ] **Step 1: Confirm nothing imports the newsdesk**

```bash
grep -rn "@onelife/newsdesk\|apps/newsdesk" --include='*.ts' --include='*.tsx' --include='*.json' \
  apps packages turbo.json package.json pnpm-workspace.yaml 2>/dev/null | grep -v node_modules | grep -v '^apps/newsdesk/'
```

Expected: no output (the workspace uses an `apps/*` glob, so there is no explicit listing to remove).

- [ ] **Step 2: Delete the app and the skill**

```bash
git rm -r -q apps/newsdesk .claude/skills/drafting-an-article
```

- [ ] **Step 3: Remove `newsdesk` from the deploy service list**

In `deploy/deploy.sh`, find the `SERVICES=(...)` array (around L31) and remove the `newsdesk` entry only. It should read:

```bash
SERVICES=(web api verifier enforcer granter rebooter notifier ingest projector)
```

- [ ] **Step 4: Remove the newsdesk env vars**

In `.env.example`, delete every line whose key begins `NEWSDESK_`, plus `DISCORD_OBITUARY_WEBHOOK_URL`, `OPENROUTER_API_KEY` and `NEWS_PREVIEW_TOKEN`, together with the explanatory comment blocks that belong only to them. Verify nothing else consumed `OPENROUTER_API_KEY`:

```bash
grep -rn "OPENROUTER_API_KEY" apps packages deploy 2>/dev/null | grep -v node_modules
```

Expected after deletion: no output.

**Leave `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` alone.**

- [ ] **Step 5: Remove the newsdesk from the deploy runbook**

In `deploy/README.md`, remove the newsdesk row from the worker table (~L15), its entry in the systemd loop (~L33), the whole `onelife-newsdesk` section (~L54–69), and the unit from the systemctl list (~L277). Add a line to the release notes section of that file:

```markdown
### One-time operator step for the content-engine removal

The `onelife-newsdesk` systemd unit is not checked into the repo, so `deploy.sh` cannot remove
it. On the host, once:

    sudo systemctl disable --now onelife-newsdesk
    sudo rm /etc/systemd/system/onelife-newsdesk.service
    sudo systemctl daemon-reload
```

- [ ] **Step 6: Verify the workspace still builds**

Run: `pnpm install && pnpm turbo run typecheck`
Expected: PASS. (`pnpm install` refreshes the lockfile now that a workspace package is gone.)

- [ ] **Step 7: Run the full suite**

Run: `pnpm turbo run test --concurrency=1`
Expected: PASS, with the newsdesk's 44 test files no longer collected.

- [ ] **Step 8: Commit**

```bash
git add -A apps deploy .env.example .claude pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
chore: delete the newsdesk app

Removes apps/newsdesk (40 src files, 44 test files), the drafting-an-article
skill, the NEWSDESK_*/OPENROUTER/DISCORD_OBITUARY env vars, and the newsdesk
entries in deploy.sh and the runbook.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LdxFbn9daL8XyXdX4VRV9F
EOF
)"
```

---

### Task 2: Delete the web article routes and components

**Interfaces:**
- Produces: nothing. This removes leaf render surfaces only; `apps/web/src/lib/*` still exports the now-unused article helpers, which Task 4 removes.

**Files:**
- Delete: `apps/web/src/app/(site)/obituaries/`, `apps/web/src/app/(site)/fresh-spawns/`, `apps/web/src/app/(site)/news/`
- Delete: `apps/web/src/components/obituaries/`, `apps/web/src/components/birth-notices/`, `apps/web/src/components/news/`
- Delete: `apps/web/src/components/shared/article-body.tsx`, `article-body.test.tsx`, `article-hero.tsx`, `article-hero.test.tsx`, `pull-quote.tsx`, `pull-quote.test.tsx`, `numbered-pager.tsx`
- Delete: `apps/web/src/components/front-page/news-lead.tsx`, `news-lead.test.tsx`, `latest-obituaries.tsx`, `latest-fresh-spawns.tsx`, `latest-blocks.test.tsx`

- [ ] **Step 1: Confirm `pull-quote` and `numbered-pager` have only article consumers**

```bash
grep -rln "pull-quote\|PullQuote" apps/web/src | grep -v node_modules
grep -rln "numbered-pager\|NumberedPager" apps/web/src | grep -v node_modules
```

Expected: every hit is inside `components/{obituaries,birth-notices,news}/` or `shared/article-body.tsx` — i.e. files this task deletes. **If any other consumer appears, stop and report it** rather than deleting those two files.

- [ ] **Step 2: Delete the directories and files**

```bash
git rm -r -q \
  "apps/web/src/app/(site)/obituaries" \
  "apps/web/src/app/(site)/fresh-spawns" \
  "apps/web/src/app/(site)/news" \
  apps/web/src/components/obituaries \
  apps/web/src/components/birth-notices \
  apps/web/src/components/news
git rm -q \
  apps/web/src/components/shared/article-body.tsx \
  apps/web/src/components/shared/article-body.test.tsx \
  apps/web/src/components/shared/article-hero.tsx \
  apps/web/src/components/shared/article-hero.test.tsx \
  apps/web/src/components/shared/pull-quote.tsx \
  apps/web/src/components/shared/pull-quote.test.tsx \
  apps/web/src/components/shared/numbered-pager.tsx \
  apps/web/src/components/front-page/news-lead.tsx \
  apps/web/src/components/front-page/news-lead.test.tsx \
  apps/web/src/components/front-page/latest-obituaries.tsx \
  apps/web/src/components/front-page/latest-fresh-spawns.tsx \
  apps/web/src/components/front-page/latest-blocks.test.tsx
```

- [ ] **Step 3: Typecheck to find the dangling references**

Run: `pnpm --filter @onelife/web run typecheck`
Expected: **FAIL**, with errors in `app/(site)/page.tsx` (imports `NewsLead`, `LatestObituaries`, `LatestFreshSpawns`) and `components/skeletons.tsx` (article skeletons referencing `ArticleHero`). This is expected — Task 3 fixes the home page and Task 4 the skeletons.

> Tasks 2–5 are one compiling unit: this task deliberately leaves the tree red, and it does not go green again until Task 5. Do **not** commit here — the single commit for all four is at the end of Task 5.

---

### Task 3: Revert the home page to the manifesto fallback

The home page already contains the branch that renders when the newsroom is empty. Deleting the article arms leaves exactly that.

**Files:**
- Modify: `apps/web/src/app/(site)/page.tsx`
- Modify: `apps/web/src/components/front-page/front-page.test.tsx`

**Interfaces:**
- Consumes: `getSurvivors`, `settleFeed`, `Hero`, `TopSurvivors` — all unchanged and all staying.

- [ ] **Step 1: Rewrite the home page**

Replace the entire contents of `apps/web/src/app/(site)/page.tsx` with:

```tsx
import { getSurvivors } from "@/lib/api";
import { settleFeed } from "@/lib/settle-feed";
import { Hero } from "@/components/front-page/hero";
import { TopSurvivors } from "@/components/front-page/top-survivors";
import { SignInCta } from "@/components/front-page/signin-cta";

/** A REJECTED fetch degrades to the same empty board as a genuinely quiet one, so this banner
 *  keeps the two distinguishable instead of collapsing "we don't know" into "nothing happened"
 *  (live-data honesty §5). */
function FeedFailedBanner({ children }: { children: string }) {
  return (
    <p
      role="status"
      className="border-b border-hairline bg-bone px-4 py-2 text-center font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted"
    >
      {children}
    </p>
  );
}

export default async function Home() {
  const survivors = await settleFeed(getSurvivors({ sort: "time", page: 1 }));

  return (
    <main className="mx-auto w-full max-w-5xl">
      <Hero />
      {survivors.failed && (
        <FeedFailedBanner>The survivors board is temporarily unreachable.</FeedFailedBanner>
      )}
      <TopSurvivors rows={survivors.data?.rows.slice(0, 5) ?? []} />
      <SignInCta />
    </main>
  );
}
```

- [ ] **Step 2: Update the front-page test**

Open `apps/web/src/components/front-page/front-page.test.tsx` and delete every test case that asserts on the news lead, latest obituaries or latest fresh spawns. Keep the cases covering the hero, the top-5 board and the failed-fetch banner. If the file's mocks stub `getNewsFeed` / `getObituariesFeed` / `getBirthNoticesFeed`, remove those stubs too.

---

### Task 4: Remove article types, API client methods, SEO builders and skeletons

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/types.ts`
- Modify: `apps/web/src/lib/seo.ts`, `apps/web/src/lib/seo.test.ts`
- Modify: `apps/web/src/components/skeletons.tsx`, `skeletons.test.tsx`
- Delete: `apps/web/src/lib/article-roster.ts`, `article-roster.test.ts`, `linkify-gamertags.tsx`, `linkify-gamertags.test.tsx`, `obituary-format.ts`, `obituary-format.test.ts`, `birth-format.ts`, `birth-format.test.ts`, `news-format.ts`, `news-format.test.ts`

- [ ] **Step 1: Delete the article-only lib files**

```bash
git rm -q \
  apps/web/src/lib/article-roster.ts apps/web/src/lib/article-roster.test.ts \
  apps/web/src/lib/linkify-gamertags.tsx apps/web/src/lib/linkify-gamertags.test.tsx \
  apps/web/src/lib/obituary-format.ts apps/web/src/lib/obituary-format.test.ts \
  apps/web/src/lib/birth-format.ts apps/web/src/lib/birth-format.test.ts \
  apps/web/src/lib/news-format.ts apps/web/src/lib/news-format.test.ts
```

- [ ] **Step 2: Strip `api.ts`**

Remove the functions `getPlayerArticles`, `getObituariesFeed`, `getObituary`, `getBirthNoticesFeed`, `getBirthNotice`, `getNewsFeed`, `getNewsArticle`, and any now-unused type imports at the top of the file. **Keep** `getSitemapData` and `getServersCached` — Task 9 edits the former's shape but it survives.

- [ ] **Step 3: Strip `types.ts`**

Remove `PlayerArticleRow`, `PlayerArticlesFeed`, `ArticleBlock`, and the obituary, birth-notice and news type blocks. Also remove the `obituarySlug` field from the life-timeline type.

- [ ] **Step 4: Strip `seo.ts` and its test**

Remove `articleLd`, `birthNoticeLd` and `newsLd`, plus their cases in `seo.test.ts`. **Keep** `ldScript`, `absoluteUrl`, `SITE_URL` and the player/profile builders.

- [ ] **Step 5: Strip the article skeletons**

In `apps/web/src/components/skeletons.tsx` remove `ArticleHeroSkeleton`, `ObituariesSkeleton` and any news / fresh-spawn skeleton variants. Remove their assertions from `skeletons.test.tsx`. **Keep** the board and dossier skeletons.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @onelife/web run typecheck`
Expected: **PASS.** If it fails, the error names the remaining dangling reference — fix it before continuing. Expect hits in `player-profile.tsx`, `players/[slug]/page.tsx`, `life/hero.tsx` and `sitemap.ts`; those are Tasks 5, 6 and 9. If so, **continue to Task 5 before committing.**

---

### Task 5: Remove "In The Paper" from the player profile

**Files:**
- Modify: `apps/web/src/app/(site)/players/[slug]/page.tsx`
- Modify: `apps/web/src/components/player/player-profile.tsx`
- Modify: `apps/web/src/lib/player-page-href.ts` and its test
- Modify: `apps/web/src/components/player/player-pagination.tsx` (drop `ap` awareness)
- Delete: `apps/web/src/components/player/in-the-paper.tsx`, `in-the-paper.test.tsx`, `paper-pagination.tsx`, `paper-pagination.test.tsx`

- [ ] **Step 1: Delete the section components**

```bash
git rm -q \
  apps/web/src/components/player/in-the-paper.tsx \
  apps/web/src/components/player/in-the-paper.test.tsx \
  apps/web/src/components/player/paper-pagination.tsx \
  apps/web/src/components/player/paper-pagination.test.tsx
```

- [ ] **Step 2: Strip the page**

In `apps/web/src/app/(site)/players/[slug]/page.tsx`: remove the `getPlayerArticles` import, the `?ap=` search-param parsing, the article arm of the `Promise.all`, and the `articles` / `articlesFailed` / `articlesPage` props passed to `PlayerProfile`.

- [ ] **Step 3: Strip the profile component**

In `player-profile.tsx`: remove the three article props from the component's prop type and the `<InThePaper …>` render between the standing cards and the funeral cards.

- [ ] **Step 4: Collapse the two-pagination rule**

`playerPageHref` exists to build both paginations while preserving the other's param. With `ap` gone there is only `page`. Simplify `apps/web/src/lib/player-page-href.ts` so it takes just the slug and page, and update its test to drop every `ap` case. Update `player-pagination.tsx` to stop accepting or forwarding `ap`.

> Keep the "omit the param when it is 1" behaviour — canonical URLs depend on it.

- [ ] **Step 5: Run the web suite**

Run: `pnpm --filter @onelife/web run test`
Expected: **PASS.** Player profile tests should still cover the hero, standing cards, funeral cards and pagination.

- [ ] **Step 6: Commit Tasks 2–5 together**

```bash
git add -A apps/web
git commit -m "$(cat <<'EOF'
feat!: remove the obituaries, fresh-spawns and news web surfaces

Deletes the three route trees, their component directories, the shared
article body/hero/pull-quote/pager, the front-page article blocks and the
article lib helpers. The home page reverts to the manifesto hero plus the
top-5 board — the branch it already rendered for an empty newsroom.

Also removes In The Paper from the player profile, which collapses that
page back to a single pagination.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LdxFbn9daL8XyXdX4VRV9F
EOF
)"
```

---

### Task 6: Remove the article nav items and the life-page obituary link

**Files:**
- Modify: `apps/web/src/lib/nav.ts`, `apps/web/src/lib/nav.test.ts`
- Modify: `apps/web/src/components/life/hero.tsx`, `hero.test.tsx`
- Modify: `apps/web/src/components/life/timeline.test.tsx`, `apps/web/src/lib/life-timeline.test.ts`

- [ ] **Step 1: Update the nav test first**

In `apps/web/src/lib/nav.test.ts`, remove every assertion referencing `news`, `obituaries` or `fresh-spawns` — including the `activeNavKey` cases for those paths. Add an assertion pinning the new shape:

```ts
it("lists exactly the three surviving sections", () => {
  expect(NAV_ITEMS.map((i) => i.key)).toEqual(["survivors", "maps", "about"]);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @onelife/web run test -- nav.test`
Expected: **FAIL** — `NAV_ITEMS` still contains five keys.

- [ ] **Step 3: Strip `nav.ts`**

Replace the contents of `apps/web/src/lib/nav.ts` with:

```ts
export const NAV_ITEMS = [
  { key: "survivors", href: "/survivors", label: "Survivors" },
  // `/maps` is a redirect that resolves the viewer's last-opened map — see lib/last-map.ts.
  // The item is deliberately a plain static href: the nav renders in two places (the desktop
  // row and the mobile menu) and a stateful item would have to be threaded through both.
  { key: "maps", href: "/maps", label: "Maps" },
  { key: "about", href: "/about", label: "About" },
] as const;

export type NavKey = (typeof NAV_ITEMS)[number]["key"];

const inSection = (pathname: string, base: string) => pathname === base || pathname.startsWith(base + "/");

/** Which nav item a pathname lights up. Player pages belong to the Survivors section. */
export function activeNavKey(pathname: string): NavKey | null {
  if (inSection(pathname, "/survivors") || inSection(pathname, "/players")) return "survivors";
  if (inSection(pathname, "/maps")) return "maps";
  if (inSection(pathname, "/about")) return "about";
  return null;
}
```

> Sub-project B renames Survivors to Leaderboard and reorders. This pass only removes.

- [ ] **Step 4: Run the nav test**

Run: `pnpm --filter @onelife/web run test -- nav.test`
Expected: **PASS.**

- [ ] **Step 5: Remove the obituary link from the life hero**

In `apps/web/src/components/life/hero.tsx`, remove the block (~L73–76) that renders the link to `/obituaries/{obituarySlug}`, and the `obituarySlug` field from the component's prop type. Then remove the `obituarySlug` fixtures from `hero.test.tsx` (L10, 76, 86), `timeline.test.tsx` (L11) and `apps/web/src/lib/life-timeline.test.ts` (L14), plus any assertion that the link renders.

- [ ] **Step 6: Run the web suite and commit**

Run: `pnpm --filter @onelife/web run test`
Expected: PASS.

```bash
git add -A apps/web
git commit -m "$(cat <<'EOF'
feat!: drop the article nav items and the life-page obituary link

Nav becomes Survivors / Maps / About. Sub-project B renames and reorders.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LdxFbn9daL8XyXdX4VRV9F
EOF
)"
```

---

### Task 7: Delete the API article routes

**Files:**
- Delete: `apps/api/src/routes/obituaries.ts`, `birth-notices.ts`, `news.ts`, `media.ts`, `fresh-spawns.ts`
- Delete: `apps/api/test/obituaries.test.ts`, `birth-notices.test.ts`, `news.test.ts`, `media-routes.test.ts`, `fresh-spawns.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/main.ts`, `apps/api/src/config.ts`
- Modify: `apps/api/src/routes/player-aggregate.ts`

> **`fresh-spawns.ts` is not article code** — it serves the `lives`-based `getFreshSpawns` feed. It goes because Task 2 deleted its only consumer, leaving it fully orphaned. It is listed here so the deletion is deliberate rather than accidental.

- [ ] **Step 1: Delete the route files and their tests**

```bash
git rm -q \
  apps/api/src/routes/obituaries.ts apps/api/src/routes/birth-notices.ts \
  apps/api/src/routes/news.ts apps/api/src/routes/media.ts \
  apps/api/src/routes/fresh-spawns.ts \
  apps/api/test/obituaries.test.ts apps/api/test/birth-notices.test.ts \
  apps/api/test/news.test.ts apps/api/test/media-routes.test.ts \
  apps/api/test/fresh-spawns.test.ts
```

- [ ] **Step 2: Unregister them in `app.ts`**

Remove the five imports (~L16–20) and the five `register*Routes(app, …)` calls (~L62–66): `registerObituariesRoutes`, `registerBirthNoticesRoutes`, `registerNewsRoutes`, `registerFreshSpawnsRoutes`, `registerMediaRoutes`. Also remove the `newsPreviewToken` parameter from `buildApp`'s options type and body, and the explanatory comment above it (~L35–36).

- [ ] **Step 3: Remove the preview token from config and main**

In `apps/api/src/config.ts` remove the `NEWS_PREVIEW_TOKEN` field from the zod schema and the returned config object. In `apps/api/src/main.ts` remove it from the `buildApp({...})` call.

- [ ] **Step 4: Remove the player-articles route**

In `apps/api/src/routes/player-aggregate.ts` remove the `getPlayerArticles` import (~L9) and the `GET /players/:slug/articles` handler (~L54). Everything else in the file stays.

- [ ] **Step 5: Verify no route references remain**

```bash
grep -rn "obituar\|birth-notice\|birthNotice\|/news\|media/heroes\|newsPreviewToken\|getPlayerArticles" apps/api/src apps/api/test | grep -v node_modules
```

Expected: no output.

- [ ] **Step 6: Run the API suite and commit**

Run: `pnpm --filter @onelife/api run test`
Expected: PASS.

```bash
git add -A apps/api
git commit -m "$(cat <<'EOF'
feat!: remove the article API routes

Deletes GET /obituaries, /birth-notices, /news, /media/heroes/:file and the
orphaned /fresh-spawns feed, unthreads newsPreviewToken from buildApp, and
drops GET /players/:slug/articles.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LdxFbn9daL8XyXdX4VRV9F
EOF
)"
```

---

### Task 8: Remove the article notification kinds

Takes the catalogue from twelve kinds to ten.

**Files:**
- Delete: `apps/notifier/src/generators/articles.ts`, `apps/notifier/test/generators-articles.test.ts`
- Modify: `apps/notifier/src/main.ts`
- Modify: `apps/web/src/components/notifications/row.tsx`, `row.test.tsx`

> There is no kind union to edit — `notifications.kind` is a plain `text` column, and the two kind strings live only in `KIND_MAP` inside the deleted generator.

- [ ] **Step 1: Update `row.test.tsx` first**

Delete the assertion at L25 (`expect(accentFor("obituary_published")).toBe("border-l-red")`). Keep the cases for `ban_applied` and the blue kinds.

- [ ] **Step 2: Delete the generator**

```bash
git rm -q apps/notifier/src/generators/articles.ts apps/notifier/test/generators-articles.test.ts
```

- [ ] **Step 3: Unregister it**

In `apps/notifier/src/main.ts` remove the `articleGenerator` import (L11) and its entry in the `generators` array (L25). The array becomes:

```ts
const generators = [
  gamertagVerifiedGenerator,
  tokensGenerator,
  banAppliedGenerator,
  banLiftedGenerator,
  lifeQualifiedGenerator,
  survivalMilestoneGenerator,
  presenceGenerator,
];
```

- [ ] **Step 4: Drop the kind from the web accent map**

In `apps/web/src/components/notifications/row.tsx` L19, change:

```ts
const RED = new Set(["ban_applied", "obituary_published"]);
```

to:

```ts
const RED = new Set(["ban_applied"]);
```

and remove `birth_notice_published` from the `BLUE` set on the following line.

- [ ] **Step 5: Verify and commit**

```bash
grep -rn "obituary_published\|birth_notice_published\|articleGenerator" apps packages 2>/dev/null | grep -v node_modules
```

Expected: no output.

Run: `pnpm turbo run test --concurrency=1 --filter @onelife/notifier --filter @onelife/web`
Expected: PASS.

```bash
git add -A apps/notifier apps/web
git commit -m "$(cat <<'EOF'
feat!: drop the obituary_published and birth_notice_published notifications

The notification catalogue goes from twelve kinds to ten. Existing rows of
these kinds are deleted by the Release 2 migration.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LdxFbn9daL8XyXdX4VRV9F
EOF
)"
```

---

### Task 9: Surgical edit — `life-timeline.ts`

The first of the two files that query `articles` while serving a feature that stays. **Review this one carefully.**

**Files:**
- Modify: `packages/read-models/src/life-timeline.ts`
- Modify: `packages/read-models/test/life-timeline.test.ts`

**Interfaces:**
- Produces: `LifeTimeline` without its `obituarySlug` field. Consumed by `apps/api/src/routes/player-aggregate.ts` (the per-life route) and the web life page — both already updated in Tasks 6 and 7.

- [ ] **Step 1: Delete the obsolete test block**

In `packages/read-models/test/life-timeline.test.ts`, delete the whole `describe("obituarySlug")` block (~L106–143).

- [ ] **Step 2: Run the suite to confirm it is still green**

Run: `pnpm --filter @onelife/read-models run test -- life-timeline`
Expected: PASS. (Removing a test cannot break the others; this is the baseline before the edit.)

- [ ] **Step 3: Edit the read-model**

Make exactly four changes to `packages/read-models/src/life-timeline.ts`:

1. Change the import on L2 from `import { players, articles } from "@onelife/db";` to `import { players } from "@onelife/db";`
2. Change the drizzle import to drop the now-unused helpers: `import { eq } from "drizzle-orm";` (`and` and `sql` were used only by the obituary sub-select — verify with a search before removing them).
3. Delete the `obituarySlug` field and its doc comment from the `LifeTimeline` interface (~L22–25).
4. In `getLifeTimeline`, remove `obituaryRows` from the destructured `Promise.all` result and delete the entire `db.select({ slug: articles.slug })…limit(1)` element from the array. Remove `obituarySlug: obituaryRows[0]?.slug ?? null,` from the returned object.

The `Promise.all` destructure becomes:

```ts
const [character, kills, playerRow, dossier] = await Promise.all([
  getLifeCharacter(db, serverId, gamertag, life.startedAt, life.endedAt),
  getLifeKills(db, serverId, gamertag, life.startedAt, life.endedAt),
  db.select({ lastSeenAt: players.lastSeenAt }).from(players).where(eq(players.gamertag, gamertag)),
  life.endedAt ? dossierForLife(db, gamertag, life) : Promise.resolve(null),
]);
```

and the return becomes:

```ts
return {
  life, sessions, character, kills, qualifiedAt,
  verdict: dossier ? dossierVerdict(dossier) : null,
  ordeals: dossier?.ordeals ?? null,
  hpLow: dossier?.hpLow ?? null,
  lastSeenAt: playerRow[0]?.lastSeenAt ?? null,
};
```

- [ ] **Step 4: Run the read-models suite**

Run: `pnpm --filter @onelife/read-models run test -- life-timeline`
Expected: PASS, with the remaining cases (sessions, kills, character, qualifiedAt, verdict, ordeals, hpLow, lastSeenAt) unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/read-models/src/life-timeline.ts packages/read-models/test/life-timeline.test.ts
git commit -m "$(cat <<'EOF'
refactor: drop obituarySlug from the life timeline read-model

Removes the only articles query in a read-model that serves a surviving
feature.

This deletes the regression test that pinned "match an article to a life by
(server_id, gamertag, life_started_at), never life_number". That convention
still governs bans and is recorded in CLAUDE.md.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LdxFbn9daL8XyXdX4VRV9F
EOF
)"
```

---

### Task 10: Surgical edit — the sitemap chain, then delete the article read-models

The second file that must survive, plus the read-model deletions it unblocks.

**Files:**
- Modify: `packages/read-models/src/sitemap.ts`, `packages/read-models/test/sitemap.test.ts`
- Modify: `apps/api/test/sitemap-route.test.ts`
- Modify: `apps/web/src/app/sitemap.ts`, `apps/web/src/app/sitemap.test.ts`
- Modify: `apps/web/src/lib/api.ts` (the `getSitemapData` return type)
- Modify: `packages/read-models/src/index.ts`
- Delete: `packages/read-models/src/obituary-articles.ts`, `birth-notice-articles.ts`, `news-articles.ts`, `player-articles.ts`, `obituaries.ts`, `fresh-spawns.ts`
- Delete: `packages/read-models/test/obituary-articles.test.ts`, `birth-notice-articles.test.ts`, `news-articles.test.ts`, `player-articles.test.ts`, `articles-schema.test.ts`, `obituaries.test.ts`, `fresh-spawns.test.ts`
- Modify: `packages/test-support/src/global-setup.ts`

- [ ] **Step 1: Update the sitemap tests first**

In `packages/read-models/test/sitemap.test.ts`, delete every case asserting on `articles` and any fixture inserting article rows.

**Keep the case pinning that the two fetches degrade independently** — it is unrelated to articles and was proven red against a shared try/catch. In `apps/web/src/app/sitemap.test.ts`, delete the article-URL cases and any assertion that `/obituaries`, `/fresh-spawns` or `/news` appear in the static paths.

- [ ] **Step 2: Edit the sitemap read-model**

In `packages/read-models/src/sitemap.ts`: change the import to `import { players, lives, servers } from "@onelife/db";`, delete the `SitemapArticle` interface, delete `articles: SitemapArticle[];` from `SitemapEntries`, delete the `articleRows` query, delete the `articles:` key from the returned object, and delete the third bullet ("only published articles — retracted ones are deliberately `noindex`") from the doc comment.

Drop `eq` from the drizzle import only if nothing else uses it — the player and life joins do, so **keep it**.

- [ ] **Step 3: Edit the web sitemap route**

In `apps/web/src/app/sitemap.ts`: change `STATIC_PATHS` to `["/", "/about"]`, delete the `ARTICLE_PATHS` map, and delete the `for (const a of data.articles)` loop. Update the `<loc>` safety comment to drop its mention of "every article-slug generator".

**Leave `export const dynamic = "force-dynamic"` and its warning comment exactly as they are.**

- [ ] **Step 4: Update the API sitemap route test**

In `apps/api/test/sitemap-route.test.ts`, remove assertions on the `articles` key of the payload.

- [ ] **Step 5: Delete the article read-models and the two orphans**

```bash
git rm -q \
  packages/read-models/src/obituary-articles.ts \
  packages/read-models/src/birth-notice-articles.ts \
  packages/read-models/src/news-articles.ts \
  packages/read-models/src/player-articles.ts \
  packages/read-models/src/obituaries.ts \
  packages/read-models/src/fresh-spawns.ts \
  packages/read-models/test/obituary-articles.test.ts \
  packages/read-models/test/birth-notice-articles.test.ts \
  packages/read-models/test/news-articles.test.ts \
  packages/read-models/test/player-articles.test.ts \
  packages/read-models/test/articles-schema.test.ts \
  packages/read-models/test/obituaries.test.ts \
  packages/read-models/test/fresh-spawns.test.ts
```

- [ ] **Step 6: Update the barrel**

In `packages/read-models/src/index.ts`, delete these six lines:

```ts
export * from "./obituaries.js";
export * from "./fresh-spawns.js";
export * from "./obituary-articles.js";
export * from "./birth-notice-articles.js";
export * from "./news-articles.js";
export * from "./player-articles.js";
```

**Keep `export * from "./player-priors.js";`** — it becomes temporarily unconsumed but sub-project C uses it for the alive card's "previous best".

- [ ] **Step 7: Update the test harness table list**

In `packages/test-support/src/global-setup.ts`, remove `"articles"` and `"article_images"` from `APP_TABLES` (L30–31).

- [ ] **Step 8: Update the web API client's sitemap type**

In `apps/web/src/lib/api.ts`, remove `articles` from `getSitemapData`'s return type so it matches the new payload.

- [ ] **Step 9: Full typecheck and suite**

Run: `pnpm turbo run typecheck`
Expected: PASS.

Run: `pnpm turbo run test --concurrency=1`
Expected: PASS. **This is the first run of the whole suite with the engine fully removed** — if anything is red here, it is a real regression in a feature that was meant to survive.

- [ ] **Step 10: Verify no code references the tables**

```bash
grep -rn "articleImages\|article_images" apps packages --include='*.ts' --include='*.tsx' | grep -v node_modules
grep -rln "\barticles\b" apps packages --include='*.ts' --include='*.tsx' | grep -v node_modules
```

Expected: the only remaining hits are `packages/db/src/schema.ts` (the table definitions, dropped in Task 11) and possibly `packages/db/drizzle/` migration SQL, which is history and stays.

- [ ] **Step 11: Commit**

```bash
git add -A packages apps
git commit -m "$(cat <<'EOF'
feat!: delete the article read-models and drop articles from the sitemap

Removes the four article read-models plus the two orphaned lives-based
feeds (getObituaries, getFreshSpawns) whose consumers are gone, and strips
the articles arm from the sitemap read-model, its API route and the Next
route.

The two sitemap fetches still degrade independently — that rule is
unrelated to articles and stays pinned.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LdxFbn9daL8XyXdX4VRV9F
EOF
)"
```

---

### Task 11: Update the docs and open the Release 1 PR

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Rewrite the CLAUDE.md content-engine sections**

Remove, at roughly L295–500 and L1622–1663:
- the R5a / R5b / R5c / R5d sub-project entries and the editorial newsroom entry
- the cross-linking PR-2 ("In The Paper") and PR-3 ("gamertags in prose") entries in full
- the `apps/newsdesk` entry in the **apps** list
- the article-related clauses in the `db` package entry (the `articles` table, `article_images`, the `targetWhere` partial-index rule, migrations 0009–0014/0016/0017 commentary)
- the article read-models from the `read-models` description
- the two article notification kinds from the Player notifications entry

Amend, do not delete:
- the **Tabloid redesign** entry — keep R1–R4, delete R5a–R5d and the §15 news-led home page paragraph
- the **Sitemap** entry — remove articles from the URL inventory and the `status='published'` clause

Add a short entry recording what was removed and the one rule that lost its test:

```markdown
- **Content engine retired** (2026-07-24): obituaries, birth notices, the news vertical, the
  editorial newsroom, the Discord notifier and the article image pipeline are **deleted**. One Life
  is a player tool; nothing generates prose. `apps/newsdesk`, the `articles`/`article_images`
  tables, the article read-models and the three route trees are gone. See
  `docs/superpowers/specs/2026-07-24-content-engine-removal-design.md`; the historical R5a–R5d and
  editorial specs are left in `docs/superpowers/` as a record.
  **⚠️ One rule lost its only executable proof:** an article was matched to a life by the
  rebuild-stable tuple `(server_id, gamertag, life_started_at)`, **never `life_number`** — which is
  nullable, unconstrained, and a fold-derived count that renumbers. The regression test lived in
  `life-timeline.test.ts` and went with the feature. **The convention still governs `bans`**, which
  keys the same way for the same reason.
```

- [ ] **Step 2: Add the changelog entry**

`requireChangelog` is `true`, and keel's CI gate checks for a committed entry. Under `## [Unreleased]` in `CHANGELOG.md`:

```markdown
### Removed

- **The content engine.** Obituaries, birth notices, the news vertical, the editorial newsroom, the
  Discord obituary notifier and the article image pipeline are removed entirely. `apps/newsdesk`,
  the article read-models, the `/obituaries`, `/fresh-spawns` and `/news` routes, the "In The Paper"
  section of the player profile, and the `obituary_published` / `birth_notice_published`
  notification kinds all go. The home page reverts to the manifesto hero plus the top-5 survivors
  board; nav becomes Survivors / Maps / About.
- The `NEWSDESK_*`, `OPENROUTER_API_KEY`, `DISCORD_OBITUARY_WEBHOOK_URL` and `NEWS_PREVIEW_TOKEN`
  environment variables, and the `onelife-newsdesk` worker.

### Note

- The `articles` and `article_images` tables are **retained** by this release and dropped in the
  next one, so a problem here is a revert rather than a restore.
```

- [ ] **Step 3: Final full verification**

Run: `pnpm turbo run typecheck && pnpm turbo run test --concurrency=1`
Expected: PASS.

- [ ] **Step 4: Commit and open the PR**

```bash
git add CLAUDE.md CHANGELOG.md
git commit -m "$(cat <<'EOF'
docs: record the content-engine removal

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LdxFbn9daL8XyXdX4VRV9F
EOF
)"
```

Then use the `keel:finish-work` skill to open the PR against `main`.

- [ ] **Step 5: Manual verification before merge**

jsdom cannot see rendering, so check these by hand against a dev server (`pnpm --filter @onelife/web run dev`):

1. `/` renders the manifesto hero and the top-5 board.
2. `/players/<a-real-slug>` renders hero, standing cards and funeral cards, with **no** In The Paper section and working pagination.
3. `/players/<slug>/<map>/lives/<n>` renders the timeline with **no** obituary link.
4. `/survivors`, `/maps`, `/about` and `/notifications` all render.
5. The masthead and mobile menu show **Survivors · Maps · About** only.
6. `/obituaries`, `/fresh-spawns` and `/news` return 404.
7. `/sitemap.xml` returns XML containing player and life URLs and **no** article URLs.

---

### Task 12 (Release 2, separate PR): Drop the tables

**Do not start this until Release 1 has been deployed and observed in production.**

**Files:**
- Create: `packages/db/drizzle/0027_drop_articles.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/db/src/schema.ts`
- Modify: `CHANGELOG.md`

> Migration numbering: confirm the next free number with `ls packages/db/drizzle/*.sql | tail -3`. The plan assumes `0027`.

- [ ] **Step 1: Take and VERIFY a backup**

On the production host:

```bash
pg_dump "$DATABASE_URL" -Fc -f onelife-pre-article-drop.dump
pg_restore --list onelife-pre-article-drop.dump | grep -c article
```

Expected: a non-zero count. Then restore it into a scratch database and confirm `SELECT count(*) FROM article_images WHERE bytes IS NOT NULL;` is non-zero. **`article_images` is `bytea`, and a dump that silently truncated it looks identical to a good one until you need it.**

- [ ] **Step 2: Write the migration**

Create `packages/db/drizzle/0027_drop_articles.sql`:

```sql
-- Retire the content engine. Release 1 removed every reader of these tables; this drops them.
-- article_images is dropped FIRST: its article_id FK references articles, and ON DELETE CASCADE
-- governs row deletion, not DROP TABLE.
DROP TABLE IF EXISTS article_images;
DROP TABLE IF EXISTS articles;

-- The two article notification kinds no longer have interior routes to link to. `notifications`
-- is durable and never truncated, so these rows would otherwise sit in players' inboxes
-- pointing at 404s.
DELETE FROM notifications WHERE kind IN ('obituary_published', 'birth_notice_published');
```

- [ ] **Step 3: Hand-append the journal entry**

The drizzle snapshot chain has been broken since `0015` — `drizzle-kit generate` diffs against a stale snapshot and emits wrong SQL. Follow the hand-written practice: add an entry to `packages/db/drizzle/meta/_journal.json` matching the shape of the `0026` entry, with `idx` incremented, the new `tag` (`0027_drop_articles`), and a `when` timestamp in the same units as its neighbours.

- [ ] **Step 4: Remove the table definitions from the schema**

In `packages/db/src/schema.ts`, delete the `articles` `pgTable` block (~L386–452) and the `articleImages` block (~L454–465). Leave the unrelated comment at ~L496 that merely *mentions* `articles_subject_idx` as a precedent — or reword it, but do not delete the index it describes.

- [ ] **Step 5: Migrate the test database and run the suite**

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate
pnpm turbo run typecheck && pnpm turbo run test --concurrency=1
```

Expected: PASS. If a suite reports a missing relation, something still references the tables and Release 1 was incomplete.

- [ ] **Step 6: Changelog and commit**

Add under `## [Unreleased]`:

```markdown
### Removed

- The `articles` and `article_images` tables, and the orphaned
  `obituary_published` / `birth_notice_published` notification rows. Migration `0027`.
```

```bash
git add packages/db CHANGELOG.md
git commit -m "$(cat <<'EOF'
feat!: drop the articles and article_images tables

Migration 0027. article_images is dropped first — its FK to articles blocks
the reverse order. Also deletes the two orphaned notification kinds, whose
hrefs now 404.

Deploys with a plain ./deploy/deploy.sh — neither table is a projection and
neither appears in REBUILD_TRUNCATE_TABLES, so no --rebuild.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LdxFbn9daL8XyXdX4VRV9F
EOF
)"
```

---

## Deploy notes

**Release 1:** plain `./deploy/deploy.sh`, **no `--rebuild`**. Afterwards, on the host:

```bash
sudo systemctl disable --now onelife-newsdesk
sudo rm /etc/systemd/system/onelife-newsdesk.service
sudo systemctl daemon-reload
```

**Release 2:** plain `./deploy/deploy.sh`, **no `--rebuild`**. Neither table is a projection, and the rebuild-before-migrate hazard does not apply — that rule forbids naming a *newly created* table in `REBUILD_TRUNCATE_TABLES`, and this migration only drops tables absent from that list.
