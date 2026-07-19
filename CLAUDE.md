# CLAUDE.md

This project was created from the Claude Code workflow template. The workflow below is
enforced by committed hooks in `.claude/` and streamlined by repo-level skills.

## On session start

A SessionStart hook injects a role-aware orientation. **Present that orientation to the
user at the start of a fresh session.**

## The workflow

1. All feature work happens on a **fork**, on a `feature/*` branch.
2. Updating this file (`CLAUDE.md`) is the **last step** before opening a PR.
3. `CHANGELOG.md` is updated on **every** PR.
4. PRs go into the canonical repo's **`develop`** branch.
5. Reviews are done in Claude Code and posted back to the contributor.
6. Approved PRs are **squash-merged** into `develop`.
7. Production releases go out via a **`develop` → `main`** PR.
8. Merging that PR **cuts a release** with notes.

## Skills

- Contributor: `starting-work`, `finishing-a-feature`.
- Maintainer: `reviewing-a-contribution`, `merging-a-contribution`, `drafting-a-release`, `cutting-a-release`.
- Setup: `workflow-setup` (run once).

## Guardrails (enforced by `.claude/hooks/guard.py`)

- No commits, pushes, or merges on `main`/`develop` (tag pushes and the one-time `workflow.json` setup commit are exempt).
- On a fork: PRs must target `develop` and require CHANGELOG.md + CLAUDE.md updates.
- On the canonical repo: feature work is blocked (fork instead). Fork contributions into `develop` must be squash-merged and approved; the maintainer's own same-repo release/back-merge PRs are exempt from that gate.
- Once the project is initialized (`workflow-setup` run), write/git actions are blocked unless the Superpowers plugin is installed.
- **Solo maintainer mode:** setting `soloMaintainer: true` in `.claude/workflow.json` activates a `solo` role that holds the union of contributor + maintainer permissions from a single clone (no remote swapping). Protected branches stay PR-only; contribution merges into `develop` still require `--squash` + a posted review (a `COMMENTED` review counts, since self-approval is impossible); release (`develop`→`main`) and back-merge (`main`→`develop`) PRs are exempt from the changelog/review gates. Off by default.

## Honest limitations

- Hooks only bind inside Claude Code; plain `git`/`gh` in a shell bypasses them.
- Superpowers/role detection are filesystem/remote heuristics; they fail with clear messages.
- Approved-review detection needs the canonical repo to be a real GitHub remote.
- **Orphan roots (reconciled 2026-07-14):** `main` and `develop` were originally created as
  independent orphan commits with no shared history, which forced a one-off `git rebase --onto` on
  every cross-branch PR through the v0.1.0 release. After v0.1.0, `develop` was re-rooted onto
  `main` so they now share history — feature→`develop`, release→`main`, and `main`→`develop`
  back-merge PRs no longer need any rebasing.

## Configuration

`.claude/workflow.json` holds `canonicalRepo`, branch names, the optional `soloMaintainer` flag (default `false`), and optional `commands.test`/`commands.lint`.

---

# One Life MVP

DayZ community platform: tracks each player's single life (birth→death across sessions),
24h-bans them when a qualified life dies, and lets them earn back in via emote verification +
an unban-token economy. Single-tenant, multi-server (Xbox). Ported lean from the archived
`../one-life-platform` (news/LLM stack dropped). MVP scope + decomposition:
`docs/superpowers/specs/2026-07-13-one-life-mvp-definition-design.md`.

## Sub-projects

- **SP1 — Foundation + ADM ingest + lives** ✅: multi-server Nitrado ADM-log ingest → event log
  → life/player/session/kill projections + qualified-lives read model.
- **SP2 — Auth + web + gamertag verification** ✅: Better Auth (Discord/Google/GitHub/magic-link),
  gamertag linking, emote verification (verifier loop), Fastify API, and an auth-focused web surface
  (login + account/claim + minimal landing). Stats dashboard deferred. The login page renders only
  **configured** sign-in methods — social providers appear only when both `<P>_CLIENT_ID`/`<P>_CLIENT_SECRET`
  are set, and email/magic-link is gated by `MAGIC_LINK_ENABLED` (default `true`). The backend is the source
  of truth via `enabledAuthMethods()`, served at `GET /api/auth/providers` (a static route that wins over the
  `/api/auth/*` Better Auth catch-all); the login page is a server component that fetches it before render.
  **One gamertag per user:** a user holds at most one active (`pending`|`verified`) `gamertag_links` row —
  enforced by partial unique index `gamertag_links_user_active_uniq` (migration `0007`) + a
  `409 active_link_exists` guard in `POST /me/gamertag-links`; a `verified` link is admin-release-only.
  **Account surface = the controls rail (R3, replaced the status banner + masthead slot).** The whole
  onboarding/account surface is the R3 controls rail — see the Tabloid redesign section. One pure
  derivation `accountStatus({ signedIn, loading, links })` (`@/lib/account-status`, union
  `loading|signedOut|unlinked|pending|verified`) remains the single source of truth, read via
  `useAccountStatus()` (`useSession` + `useGamertagLinks` + `activeLink`). **`/account` and
  `/account/claim` no longer exist** (404); the link/verify flows moved in-rail.
  No backend change — `GET /me/gamertag-links` already serializes the challenge, so
  `useGamertagLinks` adds a **5s `refetchInterval` while a link is pending** (progress ticks live, stops
  when nothing is pending, and never polls signed-out visitors). `QueryProvider` lives at the **root
  layout** (one app-wide TanStack Query cache), and `useGamertagLinks(enabled)` gates its fetch so
  logged-out visitors don't 401 on `/api/me/gamertag-links` every page.
- **SP3 — Death-ban enforcement** ✅: `apps/enforcer` bans a player 24h when a qualified life dies
  (per-server Nitrado ban list, name-based). **`ENFORCER_DRY_RUN` defaults to `true`** — logs
  intended bans without writing to Nitrado; set `false` to enforce. `bans` table is durable
  (never rebuilt).
- **SP4 — Unban-token economy** ✅: `@onelife/tokens` (ledger; balance = SUM of deltas; idempotent
  grants) + `apps/granter` sweeps. Token on verification, monthly + referral grants, self-unban
  (redeem → ban `lift_pending` → enforcer removes under the dry-run gate), and transfers. API
  routes + a web wallet on the account page.
- **SP5 — RPT ingest + character mapping** ✅: `@onelife/rpt-parser` correlation state machine +
  survivor roster; the `ingest-worker` RPT pass writes `character_sightings` + a `characters` rollup
  (charID inheritance); `getLifeCharacter` read-model + API life-detail `character` field. Web
  display deferred with the stats dashboard.
  **Character class = `create_entity` only:** a character's persona is taken solely from the game's
  authoritative `Create entity type 'Survivor[MF]_<Name>'` RPT line. The old `head_asset` signal was
  **removed** — head-warning lines carry no player identity and mis-attribute across players (even
  cross-gender), producing phantoms (e.g. head `m_adam` → non-existent "Adam"). `rosterByClass`
  (`@onelife/domain`) resolves real `Survivor[MF]_<Name>` classes to the 31 shipped personas by name;
  unknown/undetermined → `null` → silhouette. (Migration `0008` rebuilt the `characters` rollup from
  `create_entity`-only sightings.)
  **Character headshots:** the 31 default survivor portraits live at `apps/web/public/characters/<name>.webp`
  (lowercase names, served by Next.js at `/characters/<name>.webp`, e.g. `/characters/lewis.webp`), staged for
  the deferred per-life character-head display — map a life's character name via `/characters/${name.toLowerCase()}.webp`.
  Sourced from the DayZ Fandom wiki (CC BY-SA; attribution required if shipped public-facing).
- **Survivors leaderboard** ✅: public, mobile-first live leaderboard of every currently-alive
  survivor (**alive** = open qualified life: `lives.endedAt IS NULL` and `isLifeQualified`), one row
  per (player × server). **Sort lives in the URL path, not a query string** (page stays `?page=`,
  25/page): `/survivors` (combined, all active slugged servers) and `/survivors/[map]` (single
  server, by `servers.slug`) show the **default sort = time-alive descending**; a non-default sort is
  a trailing path segment — `/survivors/kills`, `/survivors/sakhal/longest` (route
  `/survivors/[map]/[sort]`). One pure `resolveSurvivorsRoute(segments, slugs)`
  (`apps/web/src/lib/board-params.ts`) drives resolution: a depth-1 segment is a **reserved sort
  word** (`kills|time|longest` → combined board sorted by it) or a **server slug** (→ that map,
  default sort), else `notFound()`; an explicit-default path (`/survivors/time`,
  `/survivors/[map]/time`) `redirect()`s to the bare path (preserving `?page`). **The three sort
  words are reserved — a server's `servers.slug` must never be `kills`/`time`/`longest`** (slugs are
  hand-set; such a slug would be shadowed by the sort route). All board URLs are built by the pure
  `boardHref` (path-based; drives `SurvivorControls`, `Pagination`, canonical/OG/JSON-LD). The
  `SurvivorControls` map tabs are alphabetical by label with **All maps** first (`buildTabs`), and the
  sort pills are ordered **Time alive → Kills → Longest kill**. Old
  `?sort=` query links are ignored (render the default). **R2 restyle:** the visible `<h1>` is
  `Survivors` / `{Map} survivors` (the full SEO phrase `Top {Map} survivors by {sort}` lives only in
  `<title>`/OG via `survivor-metadata.ts`); rows are **tiered by global rank** (`tierFor`,
  `@/components/survivors/format`): rank 1 = hero row on tint with a 76px square portrait and the
  only stat label, ranks 2–3 = podium rows with 60px portraits, 4+ (and all of pages 2+) = compact
  text rows with no portrait. Every row still shows **only the stat being sorted by** (kills / time
  alive / longest kill, all **this-life** since `life.startedAt`); portraits are decorative
  (`alt=""`, no img role — tests query the DOM directly). Pagination is a mono-box bar with a
  clamped `showingLine` and non-focusable disabled edges; board + dossier routes have `loading.tsx`
  skeletons (`@/components/skeletons`). Backed by the `getAliveSurvivors` read-model
  (`packages/read-models/src/survivors.ts`; **sort-aware tie-break** — primary sort → the other two
  metrics in a fixed order → gamertag, via a NaN-safe skip-if-equal comparator) and the public
  `GET /survivors[/:slug]` API route (Zod `sort` default `time`). Avatars resolve via
  `rosterByClass(characterClass).name` → `/characters/<name>.webp` (silhouette fallback for an
  unknown/no character). Gamertag filtering was scoped out of this pass.
- **Player pages** ✅: a public, SEO-optimized profile at `/players/[slug]` — a cross-server totals
  hero, per-server current standing (alive / banned / idle) with a live ban countdown, paginated
  past-life history (since R2: compact **funeral cards** — map, dateline, death line, and a
  kills/longest-kill/sessions counts strip only; the per-life kill lists + vitals now live on the
  R4 life-timeline page, reached via `TIMELINE →` links on the standing + funeral cards), a
  dynamic OpenGraph share image, and
  `ProfilePage` JSON-LD. The slug is the gamertag slugified (`playerSlug`, `@/lib/slug`) and resolved
  back via `resolveGamertagBySlug` (`packages/read-models/src/player-aggregate.ts`); the page is
  powered by a new `getPlayerPage` read-model (`packages/read-models/src/player-page.ts`) and an
  extended `GET /players/:gamertag` API route. **Owner-only self-unban:** the page's signed-in owner
  (session gamertag matches the page, and their link is **verified** — pending/unverified visitors
  never see the control) can spend an unban token to lift their own ban, in four states
  (`UnbanState`: hidden/ready/no-tokens/pending) driven by `SelfUnbanButton`/`UnbanView`
  (`apps/web/src/components/player/self-unban-button.tsx`). Gamertags across the site (survivor
  board rows, kill lists, death-by attributions) now route through a shared `GamertagLink` component
  to `/players/{slug}`. A `/welcome` post-login resolver (`apps/web/src/app/welcome/page.tsx`)
  sends a verified user straight to their player page and everyone else to `/` (the rail carries the
  next action). Since R3, `SelfUnbanButton` reads the balance from the shared `["tokens"]` query and
  invalidates `["tokens"]`+`["player-page"]` on redeem, so the dossier and the rail stay in sync.
  **Redesign (v0.11.0):** single roomy column, everything always visible (no `<details>`
  expand/collapse). The hero is **avatar-free** with a full-width stat band via the shared
  `heroStats` helper (`@/components/player/format`) — always Lives / Deaths / Longest life; **Kills
  only when > 0**; since R2, **Deaths is the red-highlighted (`hot`) stat** (the OG card inherits
  this via `heroStats`), plus a first-seen over-line (`aliveMaps` helper), a blue `Alive ×N` skew
  badge, and a red rubber-stamp Verified mark. Current-standing cards are
  **state-colored** (green alive / red banned / neutral idle); past-life cards are **muted archive**
  styling to read as history. Past lives are **paginated** — `getPlayerPage(db, gamertag, now, { page,
  pageSize })` (`PLAYER_PAST_LIVES_PAGE_SIZE = 10`) gathers the lightweight full set for totals +
  ordering but **enriches only the visible slice** (O(pageSize) kills/sessions/character), returns
  `pastLivesTotal/Page/PageSize`, and **no longer returns `heroCharacter`**; `GET /players/:gamertag`
  takes `?page=` (Zod `.catch(1)`) and the page route's canonical is page-aware
  (`?page=N` for N>1, `PlayerPagination` control). The OpenGraph image (`opengraph-image.tsx`) is a
  **survivor dossier** — the real logo + the **logo-skull only** motif, callsign in real casing,
  "Surviving since {MON YYYY}," and the same `heroStats` readout, rendered in Oswald/Space Mono from
  co-located `.ttf`/`logo.png`/`skull.png` assets (read via `fs.readFile`, since the Node OG runtime's
  `fetch` can't read `file:` URLs).
  **Map naming:** a server's `servers.map` is the DayZ mission **codename** (`chernarusplus`, `sakhal`,
  `enoch`); player-page display labels come from `mapLabel` (`@/components/player/format` — `enoch` →
  "Livonia", unknown codenames title-case as a fallback). The per-life API route
  `GET /players/:gamertag/:map/lives/:n` takes a server **slug** (not a codename) and resolves it via
  `resolveServerBySlug` — **no hardcoded map allow-list**, so adding a server (e.g. Livonia) stays a
  pure `servers` insert; an unknown slug is a `404`.
- *(historical)* Device-based alt detection (RPT Feature A): the device signal
  is **cut** — DayZ removed the `[MAM]` device-hash log lines in 1.29; alts fall back to Nitrado's
  built-in Multi-Account Mitigation.
- **UP1+UP2 — Universal Player** ✅: a player is a **global identity** keyed by gamertag (one row per
  gamertag across all servers; **lives stay per-server**). **UP1** rebuilds the `players` projection
  globally (migration `0005`: drops `server_id`/`current_life_id`, unique on `gamertag`; fold/stores/
  read-models resolve by gamertag and scope per-server via `lives.server_id`; rebuilt from `events`).
  **UP2** makes the gamertag claim server-agnostic (migration `0006`: `gamertag_links` drops
  `server_id`, verified-unique on `gamertag`) — verified once per gamertag across all servers, emote
  completable on any server; the claim UI replaces the server dropdown with a gamertag autocomplete
  over unverified players (`searchClaimableGamertags` read-model + `GET /players/search`).
  `@onelife/tokens` `redeem` establishes ban ownership by verified gamertag alone (bans stay
  per-server). **Prod deploy** needs the gated projection rebuild **and** the `gamertag_links`
  duplicate precheck in the UP1 plan's runbook (`0005`/`0006` are separate transactions).
- **Tabloid redesign** (R1+R2+R3+R4+R5a+R5b+R5c shipped): a five-tier visual relaunch replacing the old
  dark "field journal" theme with a light "Clean Glossy" tabloid look. Roadmap + full R1 design:
  `docs/superpowers/specs/2026-07-16-tabloid-redesign-design.md` — **R1** design system + shell,
  **R2** boards restyle (survivors + player dossier;
  spec `docs/superpowers/specs/2026-07-16-r2-boards-restyle-design.md`), **R3** controls rail
  (spec `docs/superpowers/specs/2026-07-16-r3-controls-rail-design.md`), **R4** life timeline +
  obituary/birth read-model groundwork (spec
  `docs/superpowers/specs/2026-07-17-r4-life-timeline-design.md`), **R5a** the newsdesk + Obituaries
  content engine (spec `docs/superpowers/specs/2026-07-17-r5a-newsdesk-obituaries-design.md`), **R5b**
  Birth Notices / Fresh Spawns (spec
  `docs/superpowers/specs/2026-07-17-r5b-birth-notices-fresh-spawns-design.md`), **R5c** article
  images, and **R5d** (the News vertical) ✅ —
  spec `docs/superpowers/specs/2026-07-18-r5d-news-vertical-design.md`, shipped in three PRs.
  The news-led home page was cut from the slice and is a §15 follow-up; `/news` is a section, not
  the front page.
  **PR-A shipped (v0.21.2): prose fixes.** **PR-B is the plumbing**, no new vertical yet:
  migration `0014` (`natural_key`, `body_blocks`, the `(kind, status, created_at)` feed index, and
  the life natural-key unique index narrowed to `kind IN ('obituary','birth_notice')` — see the
  `db` package entry for the `targetWhere` rule that narrowing imposes on every upsert), plus a
  shared **`ArticleBody`** (`apps/web/src/components/shared/article-body.tsx`). `ArticleBody` takes
  `blocks: ArticleBlock[] | null` — a union of `{type:"para"}` / `{type:"subhead"}` /
  `{type:"quote"}` / `{type:"list"}` — and a `fallback: string`; with `blocks === null` it renders
  the historical `body.split(/\n{2,}/)` paragraph path, so all 168 pre-0014 rows render
  byte-identically. Its switch ends in `default: return null`, so a block type added by a future
  vertical is dropped rather than crashing an interior. **Both shipped interiors (obituary + birth
  notice) render through it** — three renderers collapsed into one before a third kind exists; add
  new article kinds to `ArticleBody`, never a fourth inline `.split()`. `ArticleBlock` is declared
  twice on purpose — once in `packages/read-models/src/obituary-articles.ts` (imported by
  `birth-notice-articles.ts`; the barrel is `export *`, so one declaration only) and once in
  `apps/web/src/lib/types.ts` for the DTO. `getObituaryBySlug`/`getBirthNoticeBySlug` select and
  cast `articles.bodyBlocks` (interior only — never on feed `CARD_COLS`), but **no writer populates
  the column yet**, so every live interior still takes the flat fallback.
  **R5d shipped — PR-C1 (inert engine), PR-C2 (`newsTick`, shipped disabled) and PR-C3 (the public
  surface) all landed. The pass is still OFF in production** until an operator sets both
  `NEWSDESK_NEWS_ENABLED=true` and an ISO `NEWSDESK_NEWS_SINCE`; `/news` renders an honest empty
  state until then. The news
  vertical's targeting layer, image prerequisites and worker pass all exist; there is still **no
  article row, no model call, and no external write**, because the pass is off unless an operator
  sets **both** `NEWSDESK_NEWS_ENABLED=true` and an ISO `NEWSDESK_NEWS_SINCE`. Two trigger
  read-models live in `apps/newsdesk/src`, behind one barrel `news-targets.ts`: **Standing Dead**
  (`standing-dead-targets.ts` — a qualified *open* life whose player has been idle 72h, measured by
  `MAX(COALESCE(sessions.disconnected_at, sessions.connected_at))` so the crash-and-never-returned
  case is caught, gated on **earned coverage**: a prior life OR >= 100 absorbed `hit_events`) and
  **The Long Form** (`long-form-targets.ts` + the pure `long-form-cluster.ts` — a *clique*, never a
  chain: a death joins only if it is inside both the time window and the radius of **every** current
  member, with inclusive boundaries; four named exclusions with per-reason counts). Two rails are
  structural, not stylistic: **`natural_key` is produced only by `toISOString()` in TypeScript** and
  the article anti-join is a **second TS-side query**, never a SQL-rendered key — a `to_char()` that
  drifted from JS would make the anti-join a silent no-op and re-publish the same subject forever;
  and **no coordinate ever crosses the boundary** — `DeathCandidate` carries `x`/`y` internally,
  `LongFormSubject` and `StandingDeadTarget` do not (spec §11, asserted at runtime). The Long Form
  candidate query is a raw `db.execute(sql\`…\`)` because `JOIN LATERAL … ON TRUE` cannot be
  expressed through drizzle's `innerJoin`. Alongside it, `ArticleKind` is now a **three**-member
  union and the two binary ternaries that keyed off it (`eligibleCategories`, `buildScenePrompt`'s
  label) are guarded `Record` lookups — the old ternaries gave every non-obituary kind the Nursery
  menu and the "birth notice" label. `NEWSROOM_CATEGORIES` (13 entries) is the news image menu,
  weighted to **absence and vacancy** because a Standing Dead subject is **alive and
  non-consenting** — no framing may imply a death, a fix, a route, or a recognisable locale.
  Image eligibility is `findImageTargets`' `notInArray(articles.kind, ["obituary",
  "birth_notice"])`, so a published news row becomes image-eligible automatically — enabling the
  news pass therefore also un-dormants `imageTick`.
  **PR-C2 shipped — `newsTick`, disabled.** `apps/newsdesk/src/news-tick.ts` is the fifth pass:
  Standing Dead arm → Long Form arm → retraction sweep, each target failure-isolated into a
  `status='failed'` stub. **Two independent off-states** (`NEWSDESK_NEWS_ENABLED !== "true"`, or an
  unset/invalid `NEWSDESK_NEWS_SINCE`) return zeros *before* any query and any model call, and
  `NEWSDESK_DRY_RUN` gates every write on top. `NewsFacts` (`news-facts.ts`) is the frozen
  `articles.facts` snapshot for both triggers and is declared as
  `NewsImageFacts & {…}` — intersecting the image menu's fact vocabulary, so a builder that stops
  emitting a gated field is a **compile error** rather than an image gate that silently stops
  firing. **News dedupes on `natural_key`, not the life tuple**, so both its upserts pass
  `targetWhere: isNotNull(articles.naturalKey)` (`articles_natural_key_uniq` is partial —
  `WHERE natural_key IS NOT NULL`); the **failure stub writes the key too**, or every retry would
  insert a fresh row forever. The slug is **trigger-prefixed** (`standing-dead-…` / `long-form-…`)
  so a feature about the same life as an obituary cannot collide on `articles_slug_uniq`.
  **Rich body:** the model emits `blocks` only and `body` is derived as the `para` blocks joined
  by a blank line, so the share card can never quote text that is not on the page; zod validates
  shape only and **never a minimum length** (§5 — length is funded by fact density, and a floor is
  a padding instruction that would also burn an attempt on a thin cluster).
  **Retraction:** a published `standing_dead` article whose subject has a session that *connected*
  after `created_at` moves to `status='retracted'` — never deleted, so the prose and its hero image
  survive rather than cascade away (and `findImageTargets` filters `status='published'`, so it can
  never acquire a photo). **Durability comes from the anti-join, not from the row existing:** the
  PR-C1 predicate in `standing-dead-targets.ts` / `long-form-targets.ts` was widened — the sole
  sanctioned change to that layer — from `status = 'published'` to
  `status IN ('published','retracted')`. Narrow it back and the pass regenerates the identical
  feature every tick (a paid model call each time) only for the sweep to retract it again, forever;
  spec §4.1.3 requires that the prose is never regenerated.
  **The expressive-emote slot of §4.1.4 was cut** — ~49 events
  corpus-wide is no signal, and reaching it means querying `events.payload`, the coordinate column;
  `NewsFacts` has no emote field, asserted structurally. `unqualified_subject` is **omitted from
  the observability log line**: the qualified gate lives in the candidate SQL, so the counter is
  structurally always 0 and printing it would be a lie an operator would act on.
  **Go-live pacing (read this before flipping `NEWSDESK_DRY_RUN=false` on news):**
  `NEWSDESK_NEWS_MAX_PER_TICK` is a per-tick batch size, applied **per arm** (`news-tick.ts` passes
  it to both the Standing Dead finder and the Long Form finder), not a combined per-tick cap and not
  a rate limit — at the shipped defaults (`MAX_PER_TICK=2`, `NEWSDESK_INTERVAL_SECONDS=300`) a
  7-subject Standing Dead backlog drains in `ceil(7/2)=4` ticks, roughly **20 minutes**, not the
  "over ~4 days" figure this feature's spec (§13.2) once assumed. `NEWSDESK_DRY_RUN` is also
  **worker-global**, so the documented "dry-run for one interval" go-live step suspends obituaries,
  birth notices, the Discord notifier and the image pass for that interval too (benign — all resume
  next tick). And because a published news row is image-eligible the instant it publishes
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
  whatever loaded. A Long Form subject degraded out this way (no `mapSlug`, or the fetch throws) is
  named only in the prose and the JSON-LD `about` array, never in rendered page chrome — the dossier
  shows a bare subject count. This does **not** match the obituary interior's behaviour, which has
  only one subject and can never reach this state; the fix (render callsigns from
  `article.subjects` independent of timeline availability) is a follow-up, not shipped here.
  **Retraction on the surface:** a retracted feature drops out of the feed (and
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
  **Update (v0.21.0): images retired for obituaries + birth notices — the image pass is kind-gated off
  for both (reserved for future news); the 165 existing images were deleted (migration 0013). The
  pipeline, article_images table, media route, and ArticleHero are retained.**
  **R5c shipped — Article Images.** Every published obituary and birth notice gets **one** AI
  tabloid photo (`image_kind='hero'`; `card`/`breaking` are reserved for later verticals) via a
  **fourth** `apps/newsdesk` pass (`imageTick`) — forward (fresh articles first) + backfill,
  behind the shared `NEWSDESK_DRY_RUN` gate plus its own **`NEWSDESK_IMAGES_ENABLED`** kill switch
  (default `true`; a broken image pipeline must never stop the prose). **Art direction is
  vendored VERBATIM** from brand-bible §10.4 into `apps/newsdesk/src/image-prompt.ts`
  (`IMAGE_STYLE` + `IMAGE_ANTISLOP` constants — source of truth
  `../brand/content-engine/image_prompt.py`; change the brand repo first, then re-vendor).
  **Scene variety** is a
  facts-gated category menu (`apps/newsdesk/src/image-categories.ts` — 16 Morgue categories for
  obituaries, 13 Nursery categories for birth notices) plus an LLM escape hatch and a
  last-8-covers recency exclusion (`recentCovers`, `apps/newsdesk/src/image-pg-store.ts`); the
  scene-writer call returns `{caption, scene}` — the caption is stored verbatim in
  `articles.image_caption` and rendered under the hero photo. Cause-substring category gates: the
  wolf/bear/animal and fall gates are **live** as of death-cause fidelity stage 2 (the parser emits
  `wolf|bear|animal|infected|fall|vehicle`); the vehicle (`driver-not-pictured`) gate is **live** too
  — the parser emits `vehicle` from the base-game vehicle dict; `explosion` stays reserved. **Hard rails ride every
  prompt:** imply-don't-depict (never a corpse or gore — also doubles as the image-model
  content-filter workaround), the Fog Rule for images (generic unidentifiable locales, a living
  subject stays deniable), and no legible text/logos/real-person likenesses. **Models:**
  `NEWSDESK_IMAGE_MODEL` (default `openai/gpt-5-image-mini`) for the workhorse pass,
  `NEWSDESK_IMAGE_MODEL_FLAGSHIP` (default `openai/gpt-5.4-image-2`) reserved for legends,
  `NEWSDESK_IMAGE_QUALITY` (default `low`, ~$0.003/image measured, ~$0.004/article all-in).
  **gpt-image models return a square ~1024 canvas — no aspect-ratio parameter exists**; the 4:5
  hero crop and 1:1 feed thumbnails are render-side `object-cover` crops, not model output.
  **Storage is bytes in Postgres**, a new durable `article_images` table (migration `0012`;
  `article_id` PK/FK to `articles.id` ON DELETE CASCADE, `bytea` + `content_type` +
  `width`/`height`; in `APP_TABLES`, never truncated on rebuild — `pg_dump` covers images the same
  as prose). The full assembled prompt is stored in `articles.image_prompt` for provenance (no
  separate prompt-version string), `articles.image_model` records which model generated it, and
  `articles.image_attempts`/`image_error` are retry counters **independent of** the text-generation
  attempt counter. **Serving:** API `GET /media/heroes/:file` (`apps/api/src/routes/media.ts`) —
  a filename allow-list regex doubles as the traversal guard, an immutable long-cache header, and
  the query requires `articles.image_url IS NOT NULL` so a half-written row 404s instead of
  serving orphan bytes; this finally exercises the long-dangling `/media/:path*` rewrite in
  `apps/web/next.config.ts` and is the **first `next/image` use in the repo** (automatic webp +
  resize; same-origin needs no `remotePatterns` config). **Web:** a shared `ArticleHero`
  (`apps/web/src/components/shared/article-hero.tsx` — 4:5 crop + mono caption, red for obituaries/
  blue for birth notices) renders on both `/obituaries/[slug]` and `/fresh-spawns/[slug]`; 1:1
  thumbnails render on the feed cards and the two home content blocks (a text-only article — no
  image yet — renders the prior DOM exactly, unchanged); the OG cards for both kinds gain a 38%
  photo panel (fetch → data URI; any fetch failure falls back to the prior text-only card); the
  `NewsArticle` JSON-LD block gains an `image` field; feed skeletons gained matching thumb boxes.
  **R5b shipped — Birth Notices / Fresh Spawns.** The `apps/newsdesk` worker gains a second pass that
  writes an in-voice **Birth Notice** ("The Nursery") for every qualified life going forward, behind
  the shared dry-run gate and a **forward-only** `NEWSDESK_BIRTH_SINCE` cutoff (unset ⇒ birth pass
  off). Reuses the durable `articles` table with a new `kind='birth_notice'` (migration `0010`:
  `death_at` nullable + a born-order index, since a birth notice has no death yet). The story material
  is the player's **global cross-life priors** (`getPlayerPriors`,
  `packages/read-models/src/player-priors.ts`), not the thin current life — a first-lifer with
  `livesLived === 0` gets a dedicated "No priors" branch, never a mocking tone. The `/fresh-spawns`
  teaser is retired for a real reverse-chron feed and a slim interior at `/fresh-spawns/[slug]` (one
  paragraph + pull quote + "The Priors" box + a "still drawing breath" status line, since the subject
  is alive), a `NewsArticle` JSON-LD block, and a dynamic OG image. Backed by
  `getPublishedBirthNotices`/`getBirthNoticeBySlug`
  (`packages/read-models/src/birth-notice-articles.ts`) and public `GET /birth-notices` +
  `GET /birth-notices/:slug`. The home page gains two content blocks, **Latest Obituaries** and
  **Latest Fresh Spawns** — laid out **side by side in a two-column grid from `lg` up** (hairline
  rule between them via `lg:divide-x lg:divide-hairline`, the same idiom as `about/page.tsx`), and
  stacked below `lg` so a half-width column doesn't crowd the uppercase display headlines. The
  two-column wrapper lives at the `page.tsx` call site; both block components stay layout-agnostic.
  Facts come from read-models only; the LLM writes voice (Fog Rule: map
  dateline, never coordinates — the subject is still alive).
  **R5a shipped — the newsdesk + Obituaries.** A new durable `articles` table + the `apps/newsdesk`
  sweep worker turn every qualified death into an obituary written in the One Life tabloid voice via
  OpenRouter, behind a dry-run gate (`NEWSDESK_DRY_RUN` defaults `true`). The Obituaries section goes
  live, retiring the static teaser: a reverse-chron `/obituaries` feed and a full interior article at
  `/obituaries/[slug]` — headline, byline, lede/body, an in-voice pull quote, a factual Rap Sheet, the
  R4-powered "Final Reload" timeline, tags, "More From the Morgue," a `NewsArticle` JSON-LD block, and
  a dynamic OG image. Facts (Rap Sheet, Final Reload) are read models only — the LLM writes voice,
  never invents events (Fog Rule: map dateline, never coordinates). Backed by
  `getPublishedObituaries`/`getObituaryBySlug` (`packages/read-models/src/obituary-articles.ts`) and
  public `GET /obituaries` (now published articles) + `GET /obituaries/:slug`. (News stayed a static
  teaser until R5d PR-C3 retired it.)
  **Discord obituary notifier:** the newsdesk worker also posts a plain link to each published
  obituary into Discord via an incoming webhook (Discord unfurls the OG card), tracked/retried
  through `articles.discord_posted_at` (migration `0011`) so nothing is dropped and the
  back-catalogue drains on first live run — see the `newsdesk` app entry for env vars + the
  at-least-once/single-instance delivery boundary.
  **R4 shipped — the life timeline + R5 groundwork.** A public per-life page at
  `/players/[slug]/[map]/lives/[n]` (canvas 14a): a character-portrait hero (`LifeHero`, the life's
  resolved `getLifeCharacter` → `/characters/<name>.webp`) with a **factual** `Life {n} · {mapLabel}`
  headline (editorial headlines are R5) + a Time-alive/Kills/Longest-kill/Sessions/Qualified stat
  band, and a newest-first event **`Timeline`** (`@/components/life/`). The event list is built by a
  pure **`buildTimeline(data, now)`** (`@/lib/life-timeline`): birth → life qualified → session
  starts (consecutive **kill-free** sessions collapse into one `Sessions N–M` row) → kills (a yellow
  **Longest kill** chip on the max-distance kill) → the terminal `death` row (carrying the
  **vitals at death** — energy/water/bleed — this is where R2's dropped per-life detail returns) or,
  for an open life, a live **Still drawing breath** row. **Captions are deterministic + factual — no
  LLM** (voice-first; editorial prose is R5). **Location is voice-only:** a "Positions withheld"
  notice renders **only while a life is alive**; no coordinates are stored or shown anywhere (kills/
  deaths carry no coords). Standing + funeral cards link in via a pure **`lifeHref(gamertag, mapSlug,
  lifeNumber)`** (`@/lib/life-href`); `AliveStanding` gained a `lifeNumber` for the alive-standing
  link. Backed by **`getLifeTimeline`** (`packages/read-models/src/life-timeline.ts`, composing
  `getLifeDetail` + `getLifeKills` + `getLifeCharacter` + `lifeQualifiedAt`) and the extended
  `GET /players/:gamertag/:map/lives/:n` route (now returns `kills` + `qualifiedAt` + `gamertag`/`map`/
  `slug`). **R5 groundwork behind the still-static teasers:** `getObituaries` (qualified deaths,
  `endedAt` desc) + `getFreshSpawns` (qualified births — alive or dead — newest `startedAt` first,
  `qualifiedAt` enriched on the page slice), sharing a **`qualifiedLifeCondition(db)`** SQL predicate
  (`pvp OR playtimeSeconds>=300 OR a kill in [startedAt, endedAt]`; `servers.slug` passes through
  nullable, un-slugged servers are **not** dropped), served at public `GET /obituaries` +
  `GET /fresh-spawns`. No UI consumes those two yet — the News/Obituaries/Fresh Spawns teasers stay
  static until R5.
  **R3 shipped — the controls rail is the whole account surface.** Root layout is an `xl:`
  two-column grid (`max-w-[1440px]`, `[minmax(0,1fr)_380px]`): pages flow in the main column
  (ink right-border at `xl`), the **`ControlsRail`** (`@/components/controls/`) is the sticky right
  column, and below `xl` a fixed **`ControlsPill` + `ControlsSheet`** (bottom sheet) replace it. All
  three surfaces are driven by **`useControls`/`useControlsActions`** over the `accountStatus` union:
  signed-out → sign-in CTA (rail; on mobile a fixed **`SignInPill`** floating box → `/login`, so
  logged-out mobile visitors don't scroll to the footer to sign in); unlinked → identity + in-rail
  gamertag link panel (autocomplete over `GET /players/search`, race-guarded); pending → in-rail
  "prove it's you" emote challenge (live via the 5s poll); verified → identity + Verified stamp +
  **tokens panel** (balance, send-by-gamertag, quiet referrer) + **server cards** (alive/no-life/banned;
  banned shows a live ban countdown + the shared `SelfUnbanButton` spend CTA). The **sign-out footer
  renders in every signed-in state** (rail `SignedInFooter` + mobile sheet) — the profile link only
  appears when verified — so an unlinked/pending user can always log out. Presentational
  pieces are props-only + unit-tested; `useControls`/containers are thin (untested, per convention).
  The web API client **`apiSend` attaches `content-type: application/json` only when a body is present** —
  a bodyless `DELETE` (cancel claim) with the header set is rejected by Fastify as an empty JSON body (400).
  The mobile menu and sheet share **`useModalBehavior`** (`@/lib/use-modal-behavior` — focus trap,
  Escape, scroll lock, focus restore; keyed on `open` only via an `onCloseRef` so parent re-renders
  don't steal focus). **`POST /me/tokens/transfer` and `POST /me/referrer` take a verified gamertag**
  (`{ toGamertag }`/`{ referrerGamertag }`, resolved case-insensitively against verified
  `gamertag_links`; `not_verified` on miss), not a raw user id. **Both token fields (send + referrer)
  autocomplete over verified players, excluding the signed-in user** — a `searchVerifiedGamertags`
  read-model (`packages/read-models/src/claimable.ts`, verified mirror of `searchClaimableGamertags`)
  served at public `GET /players/search/verified` (a static route alongside `/players/search`), with
  client-side case-insensitive self-exclusion. The claim field and both token fields share one
  presentational **`<GamertagAutocomplete>`** (`@/components/controls/gamertag-autocomplete` — debounce,
  race guard, skip-after-pick, absolutely-positioned overlay dropdown; `fetchSuggestions` is injected,
  so pass a **stable** reference); `TokensPanel` takes `myGamertag?` (from `rail`/`mobile-controls`)
  as its `exclude`. **R3 also closed the R1 compat-shim
  story:** the legacy token aliases and `font-hand` are deleted, `--tint` was renamed **`--bone`**
  (brand "Bone" surface), the `ui/` primitives (Button/Input/Table) are gone, and the login page was
  restyled into the tabloid language. **R1 shipped:** Paper/Ink/Red RGB-triple design tokens
  (`globals.css` + `tailwind.config.ts`); a dark masthead with a raster wordmark and the full 5-item nav
  (News · Obituaries · Fresh Spawns · Survivors · About) plus a full-screen mobile menu; a dark
  mono footer; a front-page shell (manifesto hero, top-5 survivors, sign-in CTA); a live About
  page with bureau/server cards; `noindex` in-voice teaser pages for News/Obituaries/Fresh Spawns;
  a brand favicon kit + wordmarks vendored
  from the sibling `../brand` repo (source of truth, no cross-repo build dependency); and the
  player OG card moved onto the brand palette. Fonts are Oswald + IBM Plex Mono via
  `next/font/google`; Anton (the wordmark's display face) ships only inside the raster wordmark
  assets, never as a webfont. **Voice-first rule:** each section's static teaser — no fake counts,
  no dry copy — stays up until the content engine can actually write it; the underlying
  read-models land ahead of the UI (R4) but a teaser doesn't retire until its content-engine slice
  ships. **Obituaries' teaser retired as of R5a; Fresh Spawns' as of R5b; News' as of R5d PR-C3** —
  all three teasers are now gone.
- **Death-cause fidelity, stage 1** ✅: the archived platform's interpretation layer, ported.
  `classifyDeath` (`@onelife/domain`, pure, mechanism-first ladder + side-effect subtraction,
  thresholds 1/1/120s) turns mechanism + death vitals + a 120 s `hit_events` window into a verdict
  (`starvation|dehydration|bled_out|mauled|…`, `high|low` confidence, conditions). Computed lazily —
  never materialized (no migration/rebuild; the `isLifeQualified` precedent) — by the new
  `life-dossier` read-model (`dossierForLife`/`getLifeDossier`/`dossierVerdict`, plus ordeals:
  encounter-collapsed infected/fire/pvp hits, hpLow, builds). Surfaces: `getLifeTimeline` +
  `getPlayerPage` visible slice → API → web (`verdictPhrase`, shared `@/lib/cause-format`) on the
  timeline death row, funeral cards, Rap Sheet + obituary OG; newsdesk facts/prompt (qualitative
  death line, hedged when low; ordeal color; `deathDistance`; prompt `obituary-v2`) freeze
  `verdict` into `articles.facts`, where the `suspect-at-large` image gate reads it. **PvP keeps the
  literal `"pvp"` everywhere.**
  **Stage 2 shipped — richer parser vocabulary + backfill.** The parser's non-player `killed by X`
  branch maps entities through an ordered dict (`Animal_CanisLupus*`→`wolf`,
  `Animal_UrsusArctos*`→`bear`, other `Animal_*`→`animal`, `Zmb*`→`infected`, `FallDamage`→`fall`,
  **base-game vehicles (`CivilianSedan`/Olga, `Hatchback_02`/Gunter, `Sedan_02`/Sarka,
  `Offroad_02`/Humvee, `OffroadHatchback`/Ada, `Truck_01_Covered`/M3S, `Boat_01`; prefix-matched)
  →`vehicle`**; unmapped→`environment`; `explosion` still reserved) and
  captures the raw entity as `deathEntity` on the event payload (no `lives` column, zod `nullish`).
  The dormant image gates fire on the new tokens with zero gate changes; `classifyDeath` passes
  them through as stated mechanisms; priors' `usualDeathCause` aggregates over `causeFamily`
  (`@onelife/domain` — wolf/bear/animal → "animal"); `causeLabel` reads `fall` as "Fell" and a
  bare `died` as "Unknown". **Deploy runbook (stage-2 release):** normal deploy → on the host run
  `apps/projector` `backfill-death-causes` (re-parses `raw_lines`, upgrade-only, prints the
  unmapped-entity survey — feed it back into the dict) → projection rebuild
  (`./deploy/deploy.sh --rebuild`, or `pnpm --filter @onelife/projector run rebuild` directly on
  the host). Frozen `articles.facts` stay coarse (forward-only); lives,
  priors, and web surfaces update retroactively.
  **Unrecorded causes are `unknown`, never `environment` (R5d PR-B).** `buildObituaryFacts`
  (`apps/newsdesk/src/facts.ts`) derives `causeCategory` in the order killer/`pvp` → `suicide` →
  a cause that names a real mechanism → `unknown`. "Names a real mechanism" is the shared predicate
  `isUnrecordedCause` — which **lives in `facts.ts`** (it moved out of `prompt.ts`, which imports
  it; `facts.ts` must never import `prompt.ts`) and rejects `""`, `died`, `environment`,
  `environmental`, `unknown`. The invariant is `causeCategory === "unknown"` ⟺
  `causeUnrecorded(facts)` for a non-pvp death, so the public tag (**Unknown**) and the prose
  (which is forbidden by `NO_MECHANISM_DIRECTIVE` from naming terrain/exposure/weather) finally
  agree. A verdict from `classifyDeath` counts as a named mechanism and rescues the category to
  `environment`. Tags are frozen into `articles.tags` at publish, so this is **forward-only** —
  already-published bare-`died` obituaries keep their stale **Environment** tag until backfilled.
- **Player notifications**: a new `apps/notifier` worker + web surface that tells a signed-in player
  about things that happened to their own account — a **nine-kind catalogue**: gamertag verified,
  tokens received/granted, ban applied/lifted, life qualified, survival milestone, and
  obituary/birth-notice published (the last two only for the player who is the subject). Every kind
  is generated **per user, scoped to their own gamertag/verified links** — the feature never
  surfaces another player's activity, matching the same verified-link boundary the account rail
  already enforces for self-unban and tokens. Rows land in a new durable `notifications` table (fed
  by seven generator functions across `apps/notifier/src/generators/` producing the nine kinds —
  the two ban kinds and the two life kinds each pair up in one file — deduped by a unique
  `natural_key` per notification instance) and are delivered two ways: an in-app feed (bell icon +
  unread badge in the R3 controls rail, `GET /me/notifications` + `POST /me/notifications/read`) and
  opt-in browser Web Push (`push_subscriptions` table, VAPID-signed via `web-push`, a service worker
  + PWA manifest, `POST`/`DELETE /me/push-subscriptions`, public `GET /push/vapid-key`). The worker
  runs two independently-gated passes per tick: **generate** (forward-only `NOTIFIER_SINCE` cutoff —
  unset means OFF, never a silent epoch default that would flood every player with their whole
  history — plus `NOTIFIER_DRY_RUN`, defaults `true`) and **push** (its own `NOTIFIER_PUSH_ENABLED`
  kill switch, so delivery can be staged on after generation is already live; a subscription retires
  itself after repeated failures). **`life_qualified` windows on the qualification instant DERIVED at
  read time** — `apps/notifier/src/generators/lives.ts` loads every open life owned by a verified
  user on a slugged server (with its sessions + kills) and calls `lifeQualifiedAt()`
  (`@onelife/read-models`), not `startedAt`, which would miss a life that qualifies long after it
  started. **Qualification is deliberately never materialized** (the `isLifeQualified` precedent) —
  one source of truth, shared with the survivors board, the enforcer and the newsdesk. There is
  **no SQL qualification prefilter**: `lives.playtime_seconds` only advances at session close, so
  `qualifiedLifeCondition` is stale mid-session and would blind the generator to exactly the case it
  exists for. The candidate set (currently-alive verified players) is small. Migration `0015` adds
  only the two new tables, so **this release deploys normally, without `--rebuild`**. Single-instance, at-least-once delivery (the push pass reads
  unpushed rows without a row lock) — the same boundary as the Discord obituary notifier. Runbook +
  env vars: `deploy/README.md` and the `NOTIFIER_*` block in `.env.example`.
  **Invariants a future change would break by accident (each one shipped as a review fix — don't
  "tidy" them back):**
  1. **The ban generators window on `bans.created_at` and `bans.lifted_at`, never `banned_at` or
     `expires_at`.** `banned_at` is the *death* time, so if ingest/projector lag exceeds
     `NOTIFIER_LOOKBACK_HOURS` the ban row lands already outside the window and the player is never
     told. `expires_at` is merely `banned_at + BAN_DURATION_HOURS`, which both announces old bans at
     go-live and drops one the enforcer expires late. `lifted_at` is stamped by
     `markExpired`/`markLifted`/`redeem`, including under `ENFORCER_DRY_RUN`.
  2. **`ban_applied` has no status or `applied_at` filter.** Under `ENFORCER_DRY_RUN` — the
     production default — `markApplied()` is never called, so rows sit at `pending` with a NULL
     `applied_at`; either filter would be always-false in the configuration we actually run.
  3. **Every generator floors its query at `windowStart(deps)`** (`max(since, now - lookback)`,
     `apps/notifier/src/types.ts`). Survival milestones shipped without it and would have fired all
     crossed thresholds at go-live and re-derived them every tick forever.
  4. **`NOTIFIER_DRY_RUN` / `NOTIFIER_PUSH_ENABLED` are `z.string().optional()` + `!== "false"`, not
     a `z.enum`.** `.default()` fires only on `undefined`, so a blank/mis-cased value threw out of
     `loadConfig` at module scope and crash-looped the unit. Unparseable input must land on the safe
     side. Same idiom as `apps/newsdesk/src/config.ts`.
  5. **The sender is built through the guarded `buildSender()`, never at module top level.**
     `webpush.setVapidDetails()` throws *synchronously* on a bad key or a subject missing `mailto:`;
     built eagerly, one typo killed the process before the loop and took generation down with it.
     Invalid VAPID ⇒ `null` ⇒ push off, generation continues.
  6. **`POST /me/notifications/read` marks only the ids the client rendered.** A blanket
     mark-all-unread against a feed that serves one page silently destroys any deeper backlog. The
     feed is paginated (`?page=`) and the ownership predicate stays in the WHERE clause.
  7. **Sign-out deletes the push subscription row *before* `signOut()`**
     (`signOutAndTeardownPush`, `apps/web/src/lib/push.ts`, shared by the rail and the mobile
     sheet). After sign-out the DELETE is scoped to a dead session and matches zero rows, leaving a
     shared browser delivering the previous user's notifications. It never throws — a failed
     teardown must not trap anyone in a session.

## Monorepo (pnpm + turbo, TS/ESM, Postgres + Drizzle)

- **packages:** `db` (schema + migrations, now including the durable `articles` table — the content
  engine's store for LLM-generated obituaries/birth notices; never truncated on rebuild; gained
  `discord_posted_at` + the `articles_discord_unposted_idx` partial index in migration `0010` for
  the Discord obituary notifier; gained the durable `article_images` table (bytes in Postgres) plus
  `image_caption`/`image_model`/`image_attempts`/`image_error` columns on `articles` in migration
  `0012` for R5c article images — also never truncated on rebuild; gained `natural_key` (unique
  WHERE NOT NULL), `body_blocks` (jsonb), and the `articles_kind_status_created_idx` feed index in
  migration `0014`, which also made `articles_kind_server_gamertag_life_uniq` **partial**
  (`WHERE kind IN ('obituary','birth_notice')`) — **⚠️ any `onConflictDoUpdate` targeting that index
  MUST pass `targetWhere: inArray(articles.kind, ["obituary","birth_notice"])`, or Postgres raises
  "no unique or exclusion constraint matching the ON CONFLICT specification" and article publishing
  dies on the next tick**. There are four such sites today: publish + failure-stub in each of
  `apps/newsdesk/src/pg-store.ts` and `apps/newsdesk/src/birth-pg-store.ts`. A news article, which
  has no (server, gamertag, life) tuple, is deduped on `natural_key` instead), gained two new durable
  tables, `notifications` and `push_subscriptions`, in migration `0015` for player notifications —
  see the Player notifications sub-project entry. Migration `0015` touches **no projection table**,
  so it ships with a plain `./deploy/deploy.sh` (no `--rebuild`); life qualification stays derived at
  read time via `lifeQualifiedAt()` and is never materialized on `lives`.
  `notifications`/`push_subscriptions` are durable — absent from
  `apps/projector/src/rebuild.ts`'s truncate list, present in `APP_TABLES`
  (`packages/test-support/src/global-setup.ts`),
  `domain` (zod events, emote/weapon dicts),
  `nitrado` (log-file client), `adm-parser` (pure ADM line parser), `event-log` (append/cursor over
  `events`), `projections` (fold logic), `read-models` (stats queries, including
  `player-priors` — global cross-life reputation via `getPlayerPriors` — and
  `birth-notice-articles` — the published birth-notice feed + by-slug via
  `getPublishedBirthNotices`/`getBirthNoticeBySlug`), `test-support` (Postgres
  test harness), `auth` (Better Auth), `verification` (emote-sequence challenges),
  `tokens` (unban-token ledger + grants/redeem/transfer), `rpt-parser` (RPT login-correlation →
  character sightings).
- **apps:** `ingest-worker` (ADM+RPT poll→events loop; **DB-driven** — sweeps every `servers` row with
  `active=true` using the shared `NITRADO_TOKEN`, no `NITRADO_SERVICE_ID` env), `projector` (events→projections fold),
  `verifier` (emote-verification loop), `api` (Fastify REST + auth), `web` (Next.js frontend),
  `enforcer` (24h death-ban reconciler; dry-run by default), `granter` (token grant sweeps),
  `newsdesk` (obituary + birth-notice + news generation sweep, run as **five passes** each interval
  — obituary, birth notice, Discord notify, news (off by default), images; **`NEWSDESK_DRY_RUN`
  defaults `true`** — logs intended articles without calling OpenRouter or writing; set `false` to
  generate; needs `OPENROUTER_API_KEY` + `NEWSDESK_MODEL`, default `anthropic/claude-sonnet-5`.
  **Prose-quality Phase 0 (R5d PR-A)** — four defects found by reading 168 real published articles out of a
  prod dump, all fixed forward-only (`articles.facts` is frozen, so already-published articles keep their
  errors): (1) **the prompts seeded their own repetition** — 89 of 123 birth notices reused the byte-identical
  attribution `"a voice on the coast"` because that string was an *example* in `birth-voice.ts`; examples
  deleted, and both desks now get a do-not-reuse block built by `recentProse` (`prose-pg-store.ts`, the
  `recentCovers` pattern applied to prose) → `recentProseBlock` (`prose-block.ts`), fetched **once per tick**
  above the loop, plus a deterministic `dedupePullQuote` backstop (`prose-backstop.ts`) that nulls a repeated
  attribution post-parse. (2) **obituaries lacked the priors block birth notices get**, so the model inferred
  "rookie" and shipped an 11th life headlined *"Livonia Debut"*; `tick.ts` now calls `getPlayerPriors` and
  `ObituaryFacts` carries `priors`/`isKnownQuantity`, mirroring `birth-facts.ts` exactly. (3) **suicide has
  its own `causeCategory`** (the union is now `pvp|suicide|environment|unknown`) + a `Self-Inflicted` tag,
  explicit stances in all six `causeCategory`-gated image predicates, and a `SUICIDE_RESET_SECONDS` (300)
  tone split — a spawn reroll reads as paperwork, a long run that ends by choice gets the record but never
  speculation about a state of mind. (4) **an unrecorded cause says so** — `isUnrecordedCause`/
  `UNKNOWN_DEATH_PHRASE` replace the bare `environment` token the model dressed into *"Loses Fight With
  Terrain"*, and `NO_MECHANISM_DIRECTIVE` (gated by `causeUnrecorded`, which requires **both** the raw cause
  and `verdict.cause` unrecorded) forbids inventing one. The low-confidence hedge line is an `else if` on
  that gate — the two contradict each other if both render. (**Resolved in PR-B**: a bare `died` cause used
  to bucket to `causeCategory:"environment"` and ship an `Environment` tag while the prose said no cause was
  recorded, on ~23% of deaths. It now categorises `unknown`. Tags are frozen at publish, so the fix is
  forward-only — obituaries published before it keep the stale tag until backfilled.) The
  birth-notice pass is additionally gated by **`NEWSDESK_BIRTH_SINCE`** — an ISO-8601 cutoff
  timestamp; unset/empty/invalid ⇒ the pass is **off** (0 targets, no client call) — set it once to a
  go-live instant to begin **forward-only** coverage. Now in the `deploy.sh` restart fleet, so
  releases pick it up — still needs a `onelife-newsdesk` systemd unit authored on the host.
  **Also runs the Discord obituary notifier**: a third sweep (`notifyDiscord`, its own try/catch
  sibling in the loop) posts a plain link to each published obituary into a Discord channel via an
  incoming webhook — Discord unfurls the page's OG card. Delivery is tracked/retried via
  `articles.discord_posted_at` (migration `0011`; stamped on success only; oldest-death-first; never
  drops, drains the back-catalogue on first live run). Gated by `DISCORD_OBITUARY_WEBHOOK_URL`
  (empty = disabled) + `NEWSDESK_DRY_RUN` (dry-run logs, does not send); per-tick cap
  `NEWSDESK_DISCORD_MAX_PER_TICK` (default 10). Delivery is **at-least-once** and assumes a **single
  newsdesk instance** — the sweep reads unposted rows without a row lock. The webhook client uses
  global `fetch` (no SDK). Design: `docs/superpowers/specs/2026-07-17-discord-obituary-notifier-design.md`.
  **Fourth pass — article images (R5c):** `imageTick` generates the one AI hero photo per published
  article (forward first with fresh articles, backfill trailing), under `NEWSDESK_DRY_RUN` plus its own
  **`NEWSDESK_IMAGES_ENABLED`** kill switch (default `true`). Image env vars: `NEWSDESK_IMAGE_MODEL`
  (default `openai/gpt-5-image-mini`), `NEWSDESK_IMAGE_MODEL_FLAGSHIP` (default
  `openai/gpt-5.4-image-2`, reserved for legends), `NEWSDESK_IMAGE_QUALITY` (default `low`). See the
  Tabloid redesign R5c entry for the full art-direction/storage/serving picture. **As of v0.21.0,
  `imageTick` currently has no eligible kinds** — `findImageTargets` excludes `obituary`/`birth_notice`,
  so this pass is dormant until a `news` kind ships),
  `rebooter` (restarts every `active` server on the top of each **even UTC hour** — 00:00,02:00,…,22:00
  — best-effort per server; **no dry-run, live on deploy**; needs `NITRADO_TOKEN` + a `onelife-rebooter`
  systemd unit),
  `notifier` (player-notifications worker, two passes per tick: **generate** — nine notification
  kinds (gamertag verified, tokens received/granted, ban applied/lifted, life qualified, survival
  milestone, obituary/birth-notice published) written to the `notifications` table, deduped by a
  unique `natural_key` (a **plain** unique index, unlike `articles`' partial one — its
  `onConflictDoNothing` takes no `targetWhere`, do not copy the newsdesk pattern) — and **push** —
  delivers unread, recent rows as browser Web Push, retiring a subscription after repeated
  delivery failures. Generation is gated by a forward-only **`NOTIFIER_SINCE`** cutoff (unset =
  OFF, never a silent epoch default) plus **`NOTIFIER_DRY_RUN`** (defaults `true`); push has its own
  independent **`NOTIFIER_PUSH_ENABLED`** kill switch, so generation and delivery can be staged on
  separately. Needs `DATABASE_URL` + `SITE_URL` (the latter is required by the config schema but
  **currently unused** — every notification `href` is a relative path), and (for push) `VAPID_PUBLIC_KEY`/
  `VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` — `VAPID_PUBLIC_KEY` is also read by the **api** unit, which
  serves it publicly at `GET /push/vapid-key`. **Single-instance, at-least-once delivery** — the
  push pass reads unpushed rows without a row lock, same boundary as the Discord obituary notifier.
  Needs a `onelife-notifier` systemd unit; deploy runbook in `deploy/README.md`).

## Commands

- Test: `pnpm turbo run test --concurrency=1` (DB suites need `TEST_DATABASE_URL`).
  Typecheck: `pnpm turbo run typecheck`.
- Local Postgres: `docker compose up -d postgres`. **Note:** a gitignored
  `docker-compose.override.yml` may remap the host port (this dev machine uses 5434, not 5432).
  `.gitignore` covers OS cruft (`.DS_Store`); prefer `git add -p`/explicit paths over `git add -A`
  at the repo root so stray untracked files don't ride into a commit.
- Deploy (prod): `./deploy/deploy.sh` deploys the latest release tag (build → backup → migrate →
  restart fleet → health-check); add `--rebuild` for releases that change projection-table shape
  (truncate + re-fold from the event log). See `deploy/README.md`.
