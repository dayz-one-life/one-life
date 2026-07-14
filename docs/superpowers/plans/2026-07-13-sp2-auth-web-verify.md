# SP2 — Auth + Web + Gamertag Verify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add player identity to the platform — multi-provider login (Better Auth: Discord/Google/GitHub/magic-link), gamertag linking, emote-based verification, and a slimmed web frontend (login + account/claim + verification UI + basic stats dashboard) — porting from `one-life-platform` with all news pages/routes dropped.

**Architecture:** Mostly a port on top of SP1, with three real deviations: (1) re-add the 6 auth/verification tables that SP1 trimmed out of the `db` schema + a new migration; (2) `api` and `web` drop their news routes/pages and trim news references out of shared files; (3) the web homepage (currently an article grid) is **replaced** with a new landing/dashboard page — the only authored (non-ported) code in SP2.

**Tech Stack:** Better Auth 1.6, Fastify 5, Next.js 15 (App Router) + React 19 + TanStack Query + Tailwind, Drizzle, vitest. Same pnpm/turbo/Postgres workspace as SP1.

## Global Constraints

- **SOURCE (`PLAT`):** `/Users/steveharmeyer/Development/dayz-one-life/one-life-platform` — read-only.
- **DEST:** `/Users/steveharmeyer/Development/dayz-one-life/one-life` — branch `feature/sp2-auth-web-verify` (off `develop`).
- **SP1 packages already present** (do NOT re-port): db, domain, nitrado, adm-parser, event-log, projections, read-models, test-support, ingest-worker, projector.
- **read-models has NO `articles`/`births`/`dossier` exports** (news cut in SP1). Any file importing those must be dropped or trimmed — this is the hard constraint forcing the api/web trim.
- **Local Postgres on host port 5434** (gitignored `docker-compose.override.yml`); DB suites need `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test`.
- **Commit after every task.** Conventional commits. Same Co-Authored-By/Claude-Session trailers as SP1.
- **NEVER re-add** `articles`/`newsroom_state` tables or port `generator`/`newsroom`/`openrouter`.

---

### Task 1: Re-add auth + verification schema (6 tables) + migration

**Files:**
- Modify: `packages/db/src/schema.ts` — add `import { sql } from "drizzle-orm";` and append 6 tables after `positions`, in order: `user`, `session`, `account`, `verification`, `gamertagLinks`, `verificationChallenges` (verbatim from the SP2 manifest §6 / `PLAT` schema lines 180–251).
- Modify: `packages/test-support/src/global-setup.ts` — add the 6 table names to `APP_TABLES` (order: after `positions` add `gamertag_links`, `verification_challenges`, `user`, `account`, `session`, `verification`).
- Create: new `packages/db/drizzle/0001_*.sql` migration.

**Interfaces:**
- Produces: Drizzle tables `user, session, account, verification, gamertagLinks, verificationChallenges` from `@onelife/db`. Consumed by auth, verifier, api.

- [ ] **Step 1:** Add `import { sql } from "drizzle-orm";` at the top of `schema.ts` (the trimmed file dropped it; `gamertag_links`' partial unique index needs it).
- [ ] **Step 2:** Append the 6 table declarations verbatim (manifest §6). camelCase JS keys are required by the Better Auth adapter — keep exactly.
- [ ] **Step 3:** Add the 6 table names to `test-support` `APP_TABLES`.
- [ ] **Step 4:** `pnpm --filter @onelife/db typecheck`. Expected: PASS.
- [ ] **Step 5:** `docker compose up -d postgres`; generate migration: `pnpm --filter @onelife/db db:generate`. Expected: a new `0001_*.sql` creating exactly the 6 tables (no drops/changes to the 12 core).
- [ ] **Step 6:** Apply to a scratch DB to prove it runs: `DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife pnpm --filter @onelife/db db:migrate`. Expected: 6 new tables. (If `onelife` already has them from a prior run, use a fresh DB.)
- [ ] **Step 7:** Commit: `feat(db): re-add auth + gamertag verification schema (6 tables) + migration`

---

### Task 2: `@onelife/verification` (pure port)

**Files:** copy `PLAT/packages/verification/` → DEST: `package.json`, `tsconfig.json`, `src/{index,match,sequence}.ts`, `test/{match,sequence}.test.ts`. No trims (pure; depends only on `@onelife/domain`).

**Interfaces:** Produces `generateSequence(rng, length=3)`, `advance(sequence, progressIndex, token)`, `isExpired()`. Consumed by verifier + api.

- [ ] **Step 1:** Copy all files verbatim.
- [ ] **Step 2:** `pnpm install`.
- [ ] **Step 3:** `pnpm --filter @onelife/verification test`. Expected: PASS (match + sequence suites).
- [ ] **Step 4:** Commit: `feat(verification): port emote-sequence generation + matching`

---

### Task 3: `@onelife/auth` (port; needs schema from Task 1)

**Files:** copy `PLAT/packages/auth/` → DEST: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/{index,auth,config,mailer}.ts`, `test/{auth,config,mailer}.test.ts`. No trims.

**Interfaces:** Produces the Better Auth instance factory (Drizzle adapter over `user/session/account/verification`; discord/google/github socials; `magicLink` + `bearer` plugins) + `loadAuthConfig` + `consoleMailer`. Consumed by api.

- [ ] **Step 1:** Copy all files verbatim.
- [ ] **Step 2:** `pnpm install` (adds `better-auth` ^1.6.23).
- [ ] **Step 3:** `pnpm --filter @onelife/auth typecheck`. Expected: PASS (auth tables now exist from Task 1).
- [ ] **Step 4:** `TEST_DATABASE_URL=… pnpm --filter @onelife/auth test`. Expected: PASS (auth/config/mailer).
- [ ] **Step 5:** Commit: `feat(auth): port Better Auth (discord/google/github + magic link)`

---

### Task 4: `@onelife/verifier` (port + author Dockerfile)

**Files:** copy `PLAT/apps/verifier/` → DEST: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/{main,config,tick,pg-store}.ts`, `test/{config,tick}.test.ts`. **Author** `apps/verifier/Dockerfile` (none exists upstream — base it on `PLAT/apps/ingest-worker/Dockerfile`, swap the `--filter` target to `@onelife/verifier` and the start command to `src/main.ts`).

**Interfaces:** Consumes db, domain, event-log, verification. The loop: read `"verifier"` cursor → batch of `emote.performed` events → `advance()` matching challenges → mark `gamertag_links.status = verified` on completion (idempotent via `lastMatchedEventId`, one txn).

- [ ] **Step 1:** Copy the src/test/config files verbatim.
- [ ] **Step 2:** Author `Dockerfile` mirroring ingest-worker's (multi-stage pnpm, `node:20-alpine`, `CMD ["node","apps/verifier/dist/main.js"]` or tsx start — match ingest-worker's exact pattern).
- [ ] **Step 3:** `pnpm install`.
- [ ] **Step 4:** `TEST_DATABASE_URL=… pnpm --filter @onelife/verifier test`. Expected: PASS (config + tick).
- [ ] **Step 5:** Commit: `feat(verifier): port emote-verification consumer loop`

---

### Task 5: `@onelife/api` (port core routes, drop news)

**Files (port from `PLAT/apps/api/`):**
- Infra: `package.json` (remove the `db:seed` script), `tsconfig.json`, `Dockerfile`, `vitest.config.ts`, `src/{main,config,auth-plugin}.ts`, `src/lib/resolve-server.ts`.
- Routes (CORE): `src/routes/{servers,players,boards,me,gamertag-links,player-aggregate,global}.ts`.
- `src/app.ts` — **port with edits** (below).
- Tests (CORE): `test/{auth,boards,gamertag-links,global-routes,player-aggregate-routes,players,resolve-server,servers}.test.ts`.

**DROP (news — do not copy):** `src/routes/articles.ts`, `src/routes/media.ts`, `src/articles/` (seed.ts, types.ts), `src/seed.ts`, `data/media/`, `test/articles-routes.test.ts`, `test/media-routes.test.ts`.

**`src/app.ts` edits:** remove the `registerArticleRoutes` import + call and the `registerMediaRoutes` import + call, and drop the `mediaDir` param from the app factory signature + its usages.

**Interfaces:** Consumes db, domain, read-models, auth, verification. Produces the Fastify app mounting Better Auth at `/api/auth/*` + the core REST routes (servers/players/boards/me/gamertag-links/player-aggregate/global). Consumed by web over HTTP.

- [ ] **Step 1:** Copy the infra files + 7 core route files + 8 core test files. Do NOT copy the news files listed above.
- [ ] **Step 2:** Edit `src/app.ts` to remove article + media registration and the `mediaDir` param.
- [ ] **Step 3:** Remove the `"db:seed"` script from `package.json`.
- [ ] **Step 4:** `pnpm install`.
- [ ] **Step 5:** `pnpm --filter @onelife/api typecheck`. Expected: PASS (no imports of dropped read-models news fns or `articles` table).
- [ ] **Step 6:** `TEST_DATABASE_URL=… pnpm --filter @onelife/api test`. Expected: PASS (8 core suites).
- [ ] **Step 7:** Commit: `feat(api): port core REST + Better Auth mount (news routes dropped)`

---

### Task 6: `@onelife/web` (port core, drop news, author landing page)

**Files (port from `PLAT/apps/web/`):**
- Root config: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `tailwind.config.ts`, `vitest.config.ts`, `vitest.setup.ts`, `next-env.d.ts`, `public/`, `.env.example` (`API_ORIGIN`, `NEXT_PUBLIC_APP_URL`), `Dockerfile` if present.
- App (CORE): `src/app/{layout,globals.css,fonts.ts,fonts/*,error,not-found}`, `src/app/login/*`, `src/app/account/*` (incl. `account/claim/page.tsx` — the emote verification UI), `src/app/robots.ts`, `src/app/sitemap.ts` (trim news), and the stats subtrees `src/app/boards/*`, `src/app/players/*`, `src/app/servers/*`.
- Components (CORE): `claim-form`, `claim-status`, `emote-sequence`, `gamertag-link`, `links-list`, `login-form`, `header` (trim nav), `footer`, `json-ld`, `leaderboard-table`, `roster-table`, `map-filter-bar`, `query-provider`, `ui/{button,input,table}` (+ their `.test.tsx`).
- lib (CORE): `auth-client.ts`, `api.ts` (trim news fns), `format.ts`, `server-by-id.ts`, `servers.ts`, `slug.ts`, `types.ts` (trim news types), `use-gamertag-links.ts`, `utils.ts`, `seo.ts` (trim).

**DROP (news):** entire `src/app/[map]/`, `src/app/the-fallen/`, `src/app/the-living/`, `src/app/dayz-watch/`, `src/app/news-sitemap.xml/`, `src/app/rss/`, `src/app/servers/[serverId]/feed/`, `src/app/page.tsx` (replaced — see below); components `article-body`, `article-card`, `beat-eyebrow`, `treated-image`; lib `feed.ts`, `api.articles.test.ts`.

**Trim edits (CORE files with news refs):** `header.tsx` (drop News/the-fallen/the-living nav; keep login/account + boards), `lib/api.ts` (remove `getArticles/getArticle/getDayzWatch`, ~lines 97–115), `lib/types.ts` (remove `Article/Beat/ArticleSection/MapSlug`), `lib/seo.ts` (drop article helpers, keep `SITE_URL`/`absoluteUrl`), `sitemap.ts`/`robots.ts` (drop news entries).

**AUTHOR (new — not a port):** `src/app/page.tsx` — a simple landing/dashboard: product intro + a login/account CTA (use `useSession` from `auth-client`) + link to boards. Keep it minimal; this replaces the article-grid homepage. (If richer visual design is wanted, invoke the frontend-design skill — for MVP a clean, plain page suffices.)

**Interfaces:** No `@onelife/*` deps — talks to `api` over HTTP via `API_ORIGIN`. Produces the user-facing app.

- [ ] **Step 1:** Copy root config + CORE app routes + CORE components + CORE lib. Do NOT copy any news file listed above.
- [ ] **Step 2:** Apply the trim edits to `header.tsx`, `lib/api.ts`, `lib/types.ts`, `lib/seo.ts`, `sitemap.ts`, `robots.ts`.
- [ ] **Step 3:** Author `src/app/page.tsx` (minimal landing/dashboard, per above).
- [ ] **Step 4:** `pnpm install`.
- [ ] **Step 5:** `pnpm --filter @onelife/web typecheck`. Expected: PASS (no imports of dropped news components/types).
- [ ] **Step 6:** `pnpm --filter @onelife/web test`. Expected: PASS (core component/lib suites; news tests were not ported).
- [ ] **Step 7:** `pnpm --filter @onelife/web build`. Expected: Next build succeeds (no dangling news route imports).
- [ ] **Step 8:** Commit: `feat(web): port login/account/verify + stats, new landing page (news dropped)`

---

### Task 7: Full-repo verification + auth smoke

**Files:** none (verification only).

- [ ] **Step 1:** `pnpm turbo run typecheck`. Expected: PASS across all packages (SP1 + SP2).
- [ ] **Step 2:** `TEST_DATABASE_URL=… pnpm turbo run test --concurrency=1`. Expected: PASS across all suites.
- [ ] **Step 3:** Auth smoke: start `api` against the local DB, hit `GET /api/auth/*` health / a public route, and exercise the gamertag-link claim endpoint to confirm a `verification_challenges` row + emote sequence is issued. Document the exact commands in the commit body.
- [ ] **Step 4:** Update `CHANGELOG.md` (Unreleased → Added: SP2 auth + web + emote verification).
- [ ] **Step 5:** Update `CLAUDE.md` (mark SP2 done; add auth/web/verifier to the package list + any new commands).
- [ ] **Step 6:** Commit: `test: verify SP2 workspace green + auth smoke`. Then this branch is ready for the finishing-a-feature → PR-into-develop flow.

---

## Self-Review

- **Spec coverage (items 9–12):** login providers (Task 3 auth) ✓; gamertag link unverified (Task 5 gamertag-links route + Task 1 schema) ✓; emote verification (Task 2 verification + Task 4 verifier + Task 6 claim UI) ✓; basic web frontend (Task 6) ✓.
- **Placeholder scan:** none — exact paths + exact drop/trim lists from the manifest; the one authored file (`web/src/app/page.tsx`) is explicitly scoped.
- **Order safety:** schema (Task 1) precedes auth/verifier/api that depend on the tables; verification (Task 2) precedes verifier/api; web (Task 6) last (no build-time dep on the others, HTTP only).
- **Hard constraint honored:** every file importing dropped read-models news fns or the `articles` table is in a DROP list (api articles/media/seed; web [map]/the-fallen/etc.).
