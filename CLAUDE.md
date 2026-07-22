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
  **⚠️ Bans are placed against `bans.dayz_id` (the stable DayZ account hash) AND the gamertag,
  via the batched `addBans`/`removeBans` — never the single-entry `addBan`/`removeBan`, which
  would be one whole-field read-modify-write of the Nitrado ban list per entry, with a
  lost-update window between them.** The ID is what survives a gamertag rename: an audit of
  production found two accounts using five gamertags between them and 22 connections under a
  different name during an active ban window. `dayz_id` is frozen onto the ban row at creation
  (migration `0023`), never resolved through `players` later, because the deferred identity-merge
  work will make a historical gamertag stop resolving. A null `dayz_id` degrades to name-only.
  **⚠️ Corollary — never enable `ENFORCER_DRY_RUN` while a ban is `applied`.** Under dry-run the
  expire/lift arms mark the row `expired`/`lifted` *without* calling Nitrado, and no query
  revisits a closed row — so the entries stay on the Banlist forever. Now that one of them is the
  account hash, that orphan is **permanent and unshakeable** (a rename used to shed the name-only
  orphan). Recovery is manual Banlist editing; the precheck is in `deploy/README.md`.
  Two further consequences of banning by ID, both bounded to one ban duration and both rooted in
  pre-existing behaviour rather than this feature: `players.dayz_id` is written once at
  `createPlayer` and never updated (`packages/projections/src/fold.ts`), so a **recycled gamertag**
  would attach the *previous* owner's hash to a new player's ban; and two simultaneously-`applied`
  bans for one account share a single list entry, so the earlier expiry frees the later ban (fails
  open, not closed).
  Nitrado's ban list accepting a player ID was **verified empirically** against a live server —
  public documentation says console servers are gamertag-only, and is wrong.
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
  The §15 news-led home page follow-up has since **shipped** (post-v0.27.2): when the desk has
  published, the front page leads with the newest feature (full-width 16:9 hero photo, kicker,
  display headline, lede) and the next two in a two-column rank (`NewsLead`,
  `@/components/front-page/news-lead`); the manifesto hero + top-5 board are the empty-newsroom
  fallback, byte-identical when no news exists. `getPublishedNews` cards carry a cache-versioned
  `imageUrl` for this; the `/news` section feed page itself stays text-only by choice.
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
  **Editorial newsroom** ✅ (spec `docs/superpowers/specs/2026-07-20-editorial-newsroom-design.md`):
  a human-written editorial desk for the News vertical. **It replaces `newsTick` operationally but
  not in code** — the automated pass, prompts and stores stay shipped and disabled
  (`NEWSDESK_NEWS_ENABLED`/`NEWSDESK_NEWS_SINCE` stay unset) as the fallback if volume outgrows the
  desk. An editorial piece is `articles.kind='news'` with `facts.format` (`almanac` | `ledger` | …)
  for flavour; migration `0016` made the five subject columns
  (`server_id`/`gamertag`/`map`/`life_number`/`life_started_at`) nullable because an institutional
  piece has no one subject (normal deploy, no `--rebuild`). Identity is the natural-key namespace:
  **`EDITORIAL_PREFIXES` (`almanac:`/`ledger:`/`editorial:`, `@onelife/read-models`) is the routing
  signal** — `newsFormatOf` classifies a row `editorial` only on a positive prefix match, and its
  unrecognised/null-key fallback **must stay `long_form`** (matching `newsTriggerOf`; a malformed
  key must not newly classify as editorial and lose its dossier). The retraction sweep and the
  editorial rows are mutually inert by prefix scoping. **The `newsroom` CLI
  (`pnpm --filter @onelife/newsdesk run newsroom <cmd>`, `apps/newsdesk/src/newsroom/`) is the ONLY
  write path** — sessions never hand-INSERT; the contract enforces the prefix registry, the
  vendored brand-bible §9 Tier-1 voice lint (Tier 2 is deliberately human), and a **required
  `factCheck` claim→source table** (publish-time truth frozen, the automated desks' `facts`
  parity). `draft` prints a preview URL served by the API's token-gated
  `GET /news/:slug?preview=<token>` (`NEWS_PREVIEW_TOKEN`; empty ⇒ preview off, **fail closed** —
  checked before `timingSafeEqual`, which returns true on two empty buffers). **`unpublish` returns
  a row to `draft` and never writes `retracted`** — retraction is a public correction owned by the
  sweep. `newsroom scout` runs the shipped trigger finders as story tips (same suppression list,
  same anti-join) plus a per-map aggregate digest; the session ritual is the
  `drafting-an-article` repo skill, and **voice comes from `/var/www/brand/brand-bible.md` §6/§9
  read live**, never from memory.
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
  **gpt-image models return a square ~1024 canvas — no aspect-ratio parameter exists**; the 16:9
  hero crop and 1:1 feed thumbnails are render-side `object-cover` crops, not model output.
  **Storage is bytes in Postgres**, a new durable `article_images` table (migration `0012`;
  `article_id` PK/FK to `articles.id` ON DELETE CASCADE, `bytea` + `content_type` +
  `width`/`height`; in `APP_TABLES`, never truncated on rebuild — `pg_dump` covers images the same
  as prose). The full assembled prompt is stored in `articles.image_prompt` for provenance (no
  separate prompt-version string), `articles.image_model` records which model generated it, and
  `articles.image_attempts`/`image_error` are retry counters **independent of** the text-generation
  attempt counter. **Serving:** API `GET /media/heroes/:file` (`apps/api/src/routes/media.ts`) —
  a filename allow-list regex doubles as the traversal guard, an immutable long-cache header
  (**which is why `getNewsArticleBySlug` serves `imageUrl` versioned as `?v=<article_images.created_at
  epoch>` — a hero regenerated under the same filename must change URL or next/image, the CDN and the
  browser keep the stale photo for a year; a missing image row falls back to the bare URL**), and
  the query requires `articles.image_url IS NOT NULL` so a half-written row 404s instead of
  serving orphan bytes; this finally exercises the long-dangling `/media/:path*` rewrite in
  `apps/web/next.config.ts` and is the **first `next/image` use in the repo** (automatic webp +
  resize; same-origin needs no `remotePatterns` config). **Web:** a shared `ArticleHero`
  (`apps/web/src/components/shared/article-hero.tsx` — since v0.27.x a **16:9 full-column-width**
  crop (was 4:5 `max-w-md`; `IMAGE_ASPECT.hero` prompt nudge updated to match — stored portrait
  canvases from the 4:5 era crop to their middle band, no regeneration) + mono caption, red for obituaries/
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
  LLM** (voice-first; editorial prose is R5). **Location was voice-only at R4 ship time; it no
  longer is.** A "Positions withheld" notice still renders **only while a life is alive** to
  everyone except the verified owner of that gamertag — coordinates **have always been stored**
  (the `positions` table, populated since SP1) and, since the owner-only life location map
  sub-project below, **are shown**, to that one person, in place of the withheld notice. What
  remains true, and is why every marker on that map is approximate: kills and deaths themselves
  still carry no recorded coordinates. Standing + funeral cards link in via a pure **`lifeHref(gamertag, mapSlug,
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
  column, and below `xl` a fixed **`ControlsPill` + `ControlsSheet`** (bottom sheet) replace it
  *(superseded by pill re-homing, UX review sub-project 4, below — `ControlsPill` is retired; the
  sheet is unchanged but now opens from a masthead trigger, `MobileAccount`)*. All
  three surfaces are driven by **`useControls`/`useControlsActions`** over the `accountStatus` union:
  signed-out → sign-in CTA (rail; on mobile a fixed **`SignInPill`** floating box → `/login`, so
  logged-out mobile visitors don't scroll to the footer to sign in — **also retired, see below**);
  unlinked → identity + in-rail
  gamertag link panel (autocomplete over `GET /players/search`, race-guarded); pending → in-rail
  "prove it's you" emote challenge (live via the 5s poll); verified → identity + Verified stamp +
  **tokens panel** (balance, send-by-gamertag, quiet referrer) + **server cards** (alive/no-life/banned;
  banned shows a live ban countdown + the shared `SelfUnbanButton` spend CTA). The **sign-out footer
  renders in every signed-in state** (rail `SignedInFooter` + mobile sheet) — the profile link only
  appears when verified — so an unlinked/pending user can always log out. Presentational
  pieces are props-only + unit-tested; `useControls`/containers are thin (untested, per convention).
  **⚠️ THE TWO SURFACES HAVE OPPOSITE BACKGROUNDS.** The rail is the light paper surface; the
  **`ControlsSheet` is `bg-dark`**. Any panel mounted in both MUST carry a surface variant and swap
  its text/border/tint tokens — `TokensPanel` does this with `boxed`. A panel written only in
  `text-ink`/`border-ink`/`bg-bone` renders **ink-on-dark: present in the DOM, fully functional,
  invisible on a phone** — which is exactly how the notifications panel shipped in v0.26.0. **RTL
  asserts the DOM, not contrast, so the whole web suite stays green** on this class of bug; a panel
  added to the sheet needs a test pinning the token swap itself.
  **The notifications restructure removed the notifications panel from both the rail and the mobile
  sheet** (`controls/notifications-panel.tsx` deleted; `useControls` dropped its notification fields
  + `markRead`) — notifications moved to a masthead bell + the permanent `/notifications` inbox
  (see the Player notifications sub-project entry). The ⚠️ two-surface token rule above now applies
  to `NotificationRow`/`NotificationList` instead: the bell's popover is dark, the inbox page is
  light, and each needs its own token variant for exactly the reason the old panel did.
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
  so pass a **stable** reference); `TokensPanel` takes `myGamertag?` (from `rail`/`mobile-account`,
  the latter renamed from `mobile-controls` by pill re-homing, UX review sub-project 4)
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
  all three teasers are now gone. The mobile-controls polish pass gave the sheet swipe-dismiss
  (`useSheetDrag`, header-zone only), a two-phase motion-safe enter/exit, and a route-change close
  *(this behavior lives on the sheet, not the trigger, so pill re-homing, UX review sub-project 4,
  left it unchanged — only `mobile-controls.tsx`'s trigger + mount point moved, into
  `mobile-account.tsx`)*; the controls dark surface uses four named tokens — `dark-well`/
  `dark-hollow`/`dark-edge`/`dark-edge-bright` — no raw hexes (grep-gated).
  **Contrast & type floors (UX review sub-project 1) shipped:** plain `--red` (3.7:1 on paper)
  is now display-only — reserved for ≥19px-bold text, borders, tints, and stamps — with every
  smaller red text run moved to `--red-deep` (5.8:1), per the RED POLICY comment at the tokens
  in `globals.css`. A three-tier type floor is likewise documented there (TYPE FLOORS comment):
  reading prose sits at a 16px floor (`text-base`) with a 68ch measure, functional content at
  an 11px floor, and decorative overlines/chrome may drop to 10px only when the same
  information also exists elsewhere — enforced by the `src/type-floor-guard.test.ts` tripwire.
  **`--red-deep` is a light-surface (paper/bone) token only** — on DARK surfaces the ratios
  invert (plain red ~5.1:1 passes AA, red-deep ~3.2:1 fails), so dark surfaces keep `red`/
  `red-soft`, never `red-deep`.
  **Screen-reader structure (UX review sub-project 2) shipped** (spec
  `docs/superpowers/specs/2026-07-21-sr-structure-design.md`): a status-message policy — a DOM
  change from a user action or a background poll, with no accompanying focus move, announces
  through a shared `role="status" aria-live="polite"` `SrStatus` (`@/components/shared/sr-status`),
  including a persistent `VerificationAnnouncer` that outlives the pending→verified panel swap
  (mounted as an unconditional sibling, never inside the branch it announces) and is gated
  `xl:hidden` on the mobile sheet so it doesn't double-announce "Verification complete" against
  the rail's own copy at `xl`; list semantics (`role="list"`/`<li>`, `<ol>` for the life timeline)
  on the notification, standing/past-life, and timeline collections; the gamertag autocomplete is
  a full WAI-ARIA 1.2 combobox-with-listbox with an always-present announced result count; and web
  a11y tests query by ARIA role rather than DOM structure.
  **Live-data honesty (UX review sub-project 3) shipped** (spec
  `docs/superpowers/specs/2026-07-21-live-data-honesty-design.md`): an audit of every live/derived/
  polled surface found the UI presenting state as current/confirmed when it was stale, phantom, or
  fabricated — a dry-run ban (never actually placed on the game server) rendered as a real "Banned"
  standing and could burn a real unban token; the life-timeline "time alive" outran the survivor
  board/dossier for a ghosted player; an expired ban countdown floored at a dead "0h 0m" forever;
  three loading/error paths fabricated an authoritative "0 tokens"/idle/empty; and a Fresh Spawns
  subject who died after publication still read "still drawing breath." Plus two small fixes: the
  player-page OG card now says "First seen" (was "Surviving since," which implied continuous
  survival) and a regenerated article hero now bumps `article_images.created_at` so its `?v=`
  cache-buster actually changes. **Invariants a future change would silently break (don't "tidy"
  them back):**
  1. **A ban is real only if `dry_run=false`.** `packages/read-models/src/player-page.ts`'s
     `activeBans` query and `packages/tokens/src/redeem.ts`'s candidate query both filter
     `and(…, eq(bans.dryRun, false))` alongside their existing status filters
     (`ACTIVE_BAN_STATUSES` / `["pending","applied"]`, both unchanged) — do not widen either back.
     A dry-run ban must never render as banned or be spendable. Backlog: the enforcer's expire arm
     only touches `status='applied'`, so a dry-run `pending` ban never expires (moot now that it's
     invisible to both display and spend); already-spent phantom redemptions are not migrated.
  2. **Presence-implying durations cap at `lastSeenAt ?? connectedAt ?? now`**, matching
     `survivors.ts`'s `livePlaytime` cap and the dossier's `queries.ts` cap EXACTLY — **no clamp to
     `now`** (a `Math.min(now, …)` clamp diverges from those two under clock skew, since
     `servers.clockOffsetMs` means a real `lastSeenAt` can land a few seconds ahead of request-time
     `now`). The life-timeline (`apps/web/src/lib/life-timeline.ts`'s `liveTimeAlive`) was the last
     surface brought into line; its NOW row also dropped "and counting" (a server-baked snapshot
     that never ticks).
  3. **`banCountdown` (`apps/web/src/components/player/format.ts`) returns `null` past expiry**,
     never a clamped "0h 0m." Every render site (`standing-card.tsx`, `controls/server-cards.tsx`,
     `controls/sheet.tsx`) branches on null to a terminal "Lifting…" state, not a dead-looking live
     timer.
  4. **Loading/error is never rendered as an authoritative zero/empty.** `useControls` exposes
     `standingLoading`/`balanceLoading`; surfaces (`self-unban-button.tsx`, `TokensPanel`,
     `ServerCard`/`SheetServerRow`, the pill chip, `pillStatus`) gate on them instead of falling
     through to a `?? 0`/`[]`-means-idle default; the home page's four feed fetches distinguish a
     resolved-empty desk from a failed fetch via `settleFeed` + a `FeedFailedBanner`. (The pill chip
     and `pillStatus` were later deleted as dead code by pill re-homing, UX review sub-project 4 —
     the invariant now holds on the remaining surfaces only.)
  **Pill re-homing (UX review sub-project 4) shipped** (spec
  `docs/superpowers/specs/2026-07-21-pill-rehome-design.md`): the mobile account surface is no
  longer a floating pill fixed to the bottom of every page — it is now a **masthead trigger**
  (**`MobileAccount`**, `@/components/controls/mobile-account.tsx`) that colocates the trigger and
  the existing `ControlsSheet` (plus their shared open-state), mirroring how `MastheadBell` owns its
  button + popover + state: an avatar-disc button when signed in (`aria-haspopup="dialog"`,
  `aria-controls="controls-sheet"`) opening the sheet, a compact "Sign in" chip when signed out
  (replacing `SignInPill`), nothing while `loading`; the trigger itself is `xl:hidden` (`MastheadBell`
  is not — it still renders at every width). The masthead right cluster (`header.tsx`) — previously
  the bell alone self-positioning `absolute right-4` — now wraps both in one positioned `flex` box so
  they sit side by side without colliding. **`ControlsPill`/`SignInPill`
  (`controls/pill.tsx`) and `mobile-controls.tsx` are retired — do not reintroduce a fixed-bottom
  account pill.** The content column's `pb-24` bottom gutter is gone (no floating chrome remains to
  reserve space for). Only the trigger and its location moved: the sheet, its drag-to-dismiss, focus
  management (restored to the masthead trigger for free — `useModalBehavior` already captures
  `document.activeElement` on open), the `VerificationAnnouncer`, and every panel inside the sheet
  (identity, link/verify, tokens, server cards, self-unban, the SP2 live regions, the SP3 loading
  affordances) are unchanged.
  **⚠️ THE APP HAS EXACTLY THREE Z-ALTITUDES — the LAYER LEGEND at the `<header>` in
  `header.tsx` is the source of truth.** `z-auto` page content → **`z-40` masthead** → **`z-50`
  full-screen overlays** (the skip-to-content link in `app/layout.tsx`, `ControlsSheet` in
  `controls/sheet.tsx`). The masthead **must** be a positioned layer: the bell popover's own
  `z-50` only ranks it *inside* the right cluster, whose `-translate-y-1/2` opens a stacking
  context — so without a layer on the header, any later-in-DOM positioned-at-`z-auto` element
  paints over the popover (the `xl:sticky` `ControlsRail` — **`sticky` opens a stacking context
  regardless of z-index** — and the `relative` image wrappers in `shared/article-hero.tsx` /
  `front-page/news-lead.tsx`). That was the v0.29.6 bug: notifications rendered *behind* the
  page. The masthead must equally stay **strictly below 50** — the skip link renders *before*
  the header, so an equal value is decided by DOM order and silently buries the only control
  keyboard users have. Both halves are one-directional: raising the masthead breaks a11y,
  removing it breaks the popover. jsdom cannot observe paint order, so `header.test.tsx` pins
  the altitude numerically (`0 < z < 50`) and the real ordering was verified with
  `elementFromPoint` in a browser.
- **Cross-linking, PR-2 — "In The Paper"** ✅: the player profile lists every **published** article
  naming that player, between current standing and the funeral cards. Two ways a player is named, both
  already on the `articles` row: **subject** (`articles.gamertag`) and **killer**
  (`facts->>'killerGamertag'`, obituaries only). Backed by `getPlayerArticles`
  (`packages/read-models/src/player-articles.ts`) and public `GET /players/:gamertag/articles?page=`
  (accepts the same **slug** the profile page uses, resolving via `resolveGamertagBySlug`; an unknown
  player is an empty feed, **never a 404**).
  **⚠️ There is deliberately NO `article_subjects` table.** The design called for one; research killed
  it. `articles.gamertag` already covered 168/168 published subjects, all four publish sites
  (`pg-store`, `birth-pg-store`, `news-pg-store`, `newsroom/store`) are **non-transactional with no
  `.returning()`**, so a child table would have meant new plumbing in two paths that run live every
  newsdesk tick — and PR-3's prose roster is **per-article**, so it never needed the table either.
  If the news vertical ever publishes a multi-subject Long Form piece, its **co-subjects will not
  appear** (only the primary, via `articles.gamertag`); `news-facts.ts`'s `NewsSubject` is already
  shaped for the table if that day comes. Spec §5 records the whole decision.
  **The read model is one raw `UNION ALL`** (drizzle can't express the shape), deduped by
  `DISTINCT ON (slug)` preferring `subject`, with the count query wrapping the **same** union so
  `total` and the rows describe one set. **`ORDER BY created_at DESC, slug` — the `slug` tiebreak is
  load-bearing**: the newsdesk publishes in batches within a tick, so timestamps tie, and without it a
  row appears on two pages (pinned by a test proven red). Comparisons are `lower(col) = lower($1)` to
  stay on the two partial expression indexes from migration `0017`
  (`articles_subject_idx`/`articles_killer_idx`) — an `ILIKE`/`upper()` "tidy-up" silently drops both.
  **⚠️ Migration `0017` was hand-written and `meta/_journal.json` hand-appended, deliberately.** The
  drizzle snapshot chain is broken — `meta/` stops at `0014_snapshot.json` while `0015`/`0016` exist as
  hand-written SQL with no snapshots — so `drizzle-kit generate` diffs against a stale snapshot and
  emits wrong SQL. Follow the hand-written practice for `0018+` until someone repairs the chain.
  **⚠️ A hand-written `CREATE INDEX` on a hot table takes a ShareLock for the whole build,
  blocking writes to it for the duration of the deploy** — `0021` did exactly that to `sessions`.
  It was small enough not to hurt; the next one may not be. Prefer `CREATE INDEX CONCURRENTLY`
  on any table the ingest writes to (`positions`, `sessions`, `events`, `hit_events`), and note
  that CONCURRENTLY **cannot run inside a transaction**, so it needs its own migration file.
  **⚠️ The profile page now has TWO independent paginations.** Past lives own `page`; In The Paper owns
  **`ap`**. One pure `playerPageHref` (`@/lib/player-page-href`) builds both and **preserves the other
  param**, omitting either when it is 1. `PlayerPagination` had to be taught about `ap` — a control
  that knows only its own param silently resets the other section.
  A failed fetch renders an explicit `role="status"` line, never an empty section: "no articles" and
  "couldn't load" are different statements (the live-data-honesty invariant).
- **Sitemap + robots.txt** ✅: `apps/web/src/app/sitemap.ts` (`force-dynamic`; the hourly window is
  on the FETCH, not the route — see the ⚠️ below) and
  `apps/web/src/app/robots.ts`, fed by `getSitemapEntries` (`packages/read-models/src/sitemap.ts`)
  through public `GET /sitemap`. ~476 URLs today against a 50,000 limit, so there is deliberately
  **no sitemap index and no `generateSitemaps`**. Spec
  `docs/superpowers/specs/2026-07-21-sitemap-design.md`.
  **⚠️ The sitemap must never advertise a URL that 404s or redirects.** A life's map segment is a
  `servers.slug` and a life on an un-slugged server is omitted entirely; only players with at least
  one life and only `status='published'` articles are listed; board URLs are built with `boardHref`,
  **which collapses the default sort for you** — hand-building `/survivors/time` would advertise a
  redirect. Each rule is mutation-tested (removing the clause makes a named test fail).
  **`lastmod` is real** — article `created_at`, life `ended_at ?? started_at`, player `MAX` of their
  lives' activity. A `new Date()` would train crawlers to ignore the field; static and board entries
  carry none at all.
  **The payload carries `gamertag`, not a slug.** The web builds the path with `playerSlug`, the same
  function behind every other player link, rather than adding a third copy of the slug rule
  (`read-models` already hand-syncs `slugNorm` — see the note at `player-aggregate.ts:19`).
  **⚠️ The two fetches degrade INDEPENDENTLY** (separate try/catch): losing the server list must not
  cost the ~470 content URLs, and vice versa. A single shared try/catch passes the "data fails" test
  and silently guts the sitemap — pinned by a test proven red against exactly that change.
  **⚠️ The route is `force-dynamic`, and `export const revalidate` must NOT be restored.** Making it
  static/ISR means `next build` prerenders it and fetches the API at build time; the build does not
  run alongside a serving API, so it fails outright (three 60s attempts, then `Export encountered an
  error on /sitemap.xml/route`) — and a fetch timeout only downgrades that to a *baked* sitemap
  holding the static + board entries alone, which ISR then serves for an hour, missing every player,
  life and article URL. The hourly enumeration window instead lives on the fetch: `apiGetCached`
  (`@/lib/api`) sends `next: { revalidate }` and, unlike `apiGet`, never awaits `cookies()` and
  never forwards a cookie header — a crawler's cookies have no business reaching a shared cache
  entry. Do not point the ordinary `getServers()` at it; authenticated RSC pages need the
  cookie-forwarding version.
  **`lives.life_number` IS the URL segment here.** That does not contradict the rule against keying
  on `life_number`, which governs matching an *article* to a life; this generates the URL the router
  itself resolves by number.
  The home entry uses `SITE_URL` directly, not `absoluteUrl("")`, which would emit a trailing slash.
  AI crawlers are deliberately **not** blocked — the paper wants citations.
- **Cross-linking, PR-3 — gamertags in prose** ✅: a gamertag named in an article's prose links to
  that player's dossier, via the pure `linkifyGamertags(text, roster)`
  (`apps/web/src/lib/linkify-gamertags.tsx`) applied inside `ArticleBody` to the `para`/`quote`/
  `list` blocks **and the flat `body.split()` fallback** — the path the whole pre-0014 corpus still
  renders through — plus the lede on the obituary, news, and editorial interiors (the birth-notice
  interior renders **no lede**). Spec
  `docs/superpowers/specs/2026-07-21-prose-linkification-design.md`. Retroactive across the whole
  back catalogue: nothing is stored, so there is no migration and no backfill.
  **⚠️ The roster is per-article, NEVER global.** The `articleRoster` builders
  (`@/lib/article-roster`) read only fields already on the DTO — obituary: subject + killer; birth
  notice: subject; news/editorial: `gamertag` + `facts.subjects[]`. Matching frozen prose against
  every gamertag on the server puts a link on any ordinary word that happens to be a callsign;
  that failure was designed out, not overlooked. (There is no `article_subjects` table — PR-2 killed
  it.) **A roster entry shorter than `MIN_LINKIFY_LENGTH` (4) is dropped** — Xbox allows 3-character
  callsigns, so a player named `Fox`/`Ash`/`Doc`/`Ace` would otherwise link every ordinary
  occurrence of that word in their own obituary; they stay reachable from the byline, In The Paper
  and the boards. 4+ character words (`Hunter`, `Bear`) are deliberately still linked (spec §9).
  **⚠️ No regex lookbehind.** Token boundaries are checked by inspecting the characters either side
  of the match. Safari below 16.4 throws a syntax error when a lookbehind regex is *constructed*,
  which crashes every article page rather than degrading. Alternatives are sorted **longest-first**
  because JS alternation is leftmost-first, not leftmost-longest — without it a short callsign
  shadows a longer one containing it.
  **The prose is never rewritten:** the *matched* text renders, so `hartman` in the copy stays
  `hartman`, linked to `/players/xsgt-hartman`. Matching is case-insensitive only, so the matched
  text and the roster entry always share a slug — which is why `GamertagLink` needs no `children`.
  **An omitted/empty roster renders byte-identical DOM**, the regression guard for the 168 legacy
  articles (pinned by a test, and verified at review time against the pre-change component — the
  in-suite version of that test compares two renders of the *new* component and so cannot catch a
  change made to both paths).
  Headlines, subheads, kickers, captions, OG cards and feed cards are deliberately **not**
  linkified. In-prose links carry `red-deep` + a dotted underline — hover-only colour fails
  WCAG 1.4.1, and `red-deep` is a light-surface token only.
  **⚠️ `facts.subjects` is now public link surface**, so `newsroom` **draft** rejects a roster naming
  an unknown player (`assertKnownSubjects`, `newsroom/store.ts`) rather than shipping a link to a
  404. It sits in `draftArticle` because that insert is the **only** writer of `facts.subjects` —
  `publishArticle` flips `status`/`createdAt`, `unpublish`/`spike` touch `status` — so a bad roster
  can never become a draft row and therefore can never be published. A future admin script that
  inserts an editorial `articles` row directly would bypass this, as it bypasses the rest of the
  CLI contract.
  **⚠️ `PullQuote.text` is a `ReactNode`, and its “curly quotes” + em dash are pinned by a test** —
  a tool that rewrites them to ASCII changes every pull quote on the site, and the other 615 tests
  all pass while it does.
- **Cross-linking, PR-1** ✅: links between players, lives, and articles that need no schema change.
  Controls-rail + mobile-sheet server cards link to the life they describe; an obituary/birth-notice
  byline links to that life's timeline; a life timeline links back to its published obituary.
  Spec `docs/superpowers/specs/2026-07-21-cross-linking-design.md` (§4 = this PR; §5/§6 are the
  unbuilt PR-2 `article_subjects` + In The Paper and PR-3 prose linkification).
  **Two href builders, and picking the wrong one is silent:** `lifeHref(gamertag, mapSlug, n)`
  slugifies for you; **`lifeHrefBySlug(playerSlug, mapSlug, n)`** takes an ALREADY-slugified
  callsign and is what the rail/sheet use (they hold `ownSlug`). Passing a slug to `lifeHref`
  double-slugifies; passing a gamertag to `lifeHrefBySlug` leaves it unslugified.
  **⚠️ The map segment of a life URL is a `servers.slug`, NEVER `servers.map`.** The route resolves
  it with `resolveServerBySlug` (404s on a miss — see the comment at
  `apps/api/src/routes/player-aggregate.ts`). On an article DTO that means **`mapSlug`** (nullable)
  and never `map` (the non-nullable mission codename `chernarusplus`/`enoch`, which is display-only,
  via `mapLabel`). Building an href from `map` yields a 404 on every article.
  **⚠️ An article is matched to a life by the rebuild-stable tuple `(server_id, gamertag,
  life_started_at)`** — the key behind `articles_kind_server_gamertag_life_uniq`, and the same
  convention `bans` uses. **Never key on `articles.life_number`**: it is nullable, carries no
  uniqueness constraint, and is a count derived during fold, so every later life renumbers if the
  fold changes and the link silently lands on the wrong life. `getLifeTimeline`'s `obituarySlug`
  lookup is pinned by a regression test that fails against the `life_number` predicate.
  **A life link renders only when its life number is known.** `ban.triggeringLifeNumber` and
  `ServerStanding.lastLifeNumber` are both nullable; a null renders NO link, never `/lives/0` or
  `/lives/undefined`. Specifically, when a ban cannot be matched to its triggering life the banned
  card shows no link — it deliberately does **not** fall back to the most recent life, because a
  banned card's whole claim is "this ban came from this life." `lastLifeNumber` on an **idle** card
  does resolve to the most recent life; that fallback is correct there and only there.
  Only `status='published'` articles are ever linked — a retracted article is a public correction,
  not the life's obituary.
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
  bare `died` as "Unknown".
  **A fatal fall is logged TWICE and inconsistently — the entity dict alone cannot catch it.** DayZ
  writes the fall on a *hit* line (`hit by FallDamageHealth`, `[HP: 0]`) and then a death line with
  **no `killed by` clause at all**, unlike an animal or infected kill. `ENTITY_CAUSES` only reads the
  killer clause, so these deaths land as a bare `died` → `unknown`. `classifyDeath` therefore carries
  a **fall rung**: a `hit_events` row in the 120s window whose `attackerLabel` starts with
  `FallDamage` and whose `victimHp <= 0` is the killing blow → `cause: "fall"`, `high` confidence.
  It sits **above** the starvation/dehydration/bleeding inferences (a starving man who falls died of
  the fall; hunger stays in `conditions`) and **below** every stated mechanism. A non-terminal fall
  hit is ignored. This is why `RecentHit`/`DossierRecentHit` carry **`victimHp`** — the read-model
  already queried it and dropped it in the mapping, which is what made the evidence unreachable.
  **A verdict that names a mechanism must also outrank the raw cause on the web** — `verdictPhrase`
  (`@/lib/cause-format`) falls back to `causeLabel(cause)` for any verdict with no `VERDICT_NOUN`
  entry, and for a fall the raw cause is a bare `died` → "Unknown". `ENTITY_VERDICTS` there mirrors
  `ENTITY_MECHANISMS` in `@onelife/domain` (duplicated deliberately — `apps/web` has no dependency
  on that package); **add a new mechanism token to both**, or the classifier will be right and the
  page will still say Unknown.
  Retroactive (verdicts are lazy, never materialized); frozen `articles.facts` keep their stale tag.
  **Deploy runbook (stage-2 release):** normal deploy → on the host run
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
  `natural_key` per notification instance) and are delivered two ways: an in-app feed — a masthead
  **`MastheadBell`** (all widths, signed-in only, an anchored popover at `md+`, a link to
  `/notifications` below `md`; badge caps at `9+` with the real count in `aria-label`) and a
  permanent **`/notifications`** inbox page ("The Wire", also carrying the `PushToggle` on its
  single light surface, no `onDark`), both reading a **frozen-tint** model — `useNotifications` /
  `useNotificationSeen` (`@/lib/use-notifications`): mark-read stamps the query cache via
  `setQueryData` (never invalidates, so a read row doesn't flatten mid-glance) and a 60s
  `refetchInterval` reconciles in the background (`GET /me/notifications` +
  `POST /me/notifications/read`) — and opt-in browser Web Push (`push_subscriptions` table,
  VAPID-signed via `web-push`, a service worker + PWA manifest, `POST`/`DELETE
  /me/push-subscriptions`, public `GET /push/vapid-key`). The worker
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
     feed is paginated (`?page=`) and the ownership predicate stays in the WHERE clause. This still
     holds after the move to the masthead bell + `/notifications` inbox: the popover reports only
     its page-1 rows, and the inbox page reports each page as it loads — never a mark-all.
  7. **Sign-out deletes the push subscription row *before* `signOut()`**
     (`signOutAndTeardownPush`, `apps/web/src/lib/push.ts`, shared by the rail and the mobile
     sheet). After sign-out the DELETE is scoped to a dead session and matches zero rows, leaving a
     shared browser delivering the previous user's notifications. It never throws — a failed
     teardown must not trap anyone in a session.
- **Owner-only life location map** ✅ (spec
  `docs/superpowers/specs/2026-07-21-owner-life-map-design.md`): the life timeline page
  (`/players/[slug]/[map]/lives/[n]`) gains a route trail + kill/death/last-known-position
  markers for the signed-in owner of that gamertag alone, on both open and closed lives. This is
  the **first reader of the `positions` table** — populated since SP1, folded from every ADM
  `pos=<x, y, z>` line, but never previously queried by any read model or route.
  **The security boundary is the point of the design, not a checklist item added after:**
  1. **`GET /me/lives/:mapSlug/:n/track` takes no player identifier at all.** The subject comes
     solely from the session cookie → a `verified` `gamertag_links` row for that user. There is no
     gamertag/slug/userId parameter to add, ever — an equality check is something a later refactor
     can weaken without a test noticing; having no field to name another player in is not.
  2. **A `pending` link is never sufficient — only `verified`.** Anyone can type any gamertag into
     the claim box; only a link that survived emote verification unlocks coordinates (mirrors
     `self-unban-button.tsx`'s ownership gate).
  3. **`Cache-Control: no-store, private` on the response is load-bearing**, not decoration —
     without it a shared proxy or CDN can serve one owner's live position to the next visitor, the
     classic way a correct auth check still leaks.
  4. **Ownership is a WHERE-clause predicate in `getLifeTrack`, never a post-filter** — a life
     belonging to another player produces zero rows and a 404, so no intermediate value in the call
     path ever holds another player's coordinates for a bug to leak. Three separate gamertag
     predicates (lives, positions, kills) are each pinned by a mutation-verified test.
  **Every marker is approximate, because deaths and kills have never carried coordinates** — each
  marker is the nearest `positions` fix at or before the event. There is deliberately **no
  `approximate` boolean**; `sampleAgeSeconds` is non-optional, so a render site must actively
  discard it rather than silently omit an honesty flag. Past 900 seconds old, no marker renders at
  all — silent beats confidently wrong. A `now` marker (open life) carries `sampleAgeSeconds: 0` by
  construction — the fix *is* the event — with real staleness computed client-side against the
  clock; the accessible marker list and the map popup both route through one shared `staleness()`
  helper so they can never disagree with each other. Trail polylines are **per-session, never one
  line** — joining sessions draws a straight path across a logout/login the player never walked.
  **Rendering:** plain `leaflet` driven from a `useEffect`, deliberately **not** `react-leaflet`
  (its v4 doesn't support React 19); `TrackMap` is `dynamic(..., { ssr: false })` so a non-owner
  never downloads the chunk or Leaflet's stylesheet. The map container carries **`isolate`** —
  Leaflet's own controls sit at `z-index: 1000` and would otherwise paint over the `z-40` masthead
  and `z-50` overlays; this is the same LAYER LEGEND rule from `header.tsx`, applied to a new
  offender. Map tiles are a **host prerequisite** mirrored by `deploy/mirror-tiles.sh`, served at
  `/tiles/{map}/topographic/{z}/{x}/{y}.webp` (DZMap's own on-disk layer name, deliberately not
  renamed — renaming it would silently 404 a tree a direct loader run actually produces); tiles are
  **absent from the `pg_dump` backup** (reproducible from the mirror script, not worth putting
  hundreds of MB in Postgres for), and their absence **degrades** the map to a trail on a plain
  dark background rather than breaking it.
  ⚠️ **`CANVAS_PX` in `track-map.tsx` is an unverified assumption** — the tile pyramid's true pixel
  extent needs checking against real mirrored tiles on the host; a uniformly offset or scaled trail
  is the symptom of a wrong value. It's a parameter of `worldToPixel` precisely so that correction
  is a one-line fix, not a rewrite.
  No migration and no new table — this release deploys with a plain `./deploy/deploy.sh`, **no
  `--rebuild`**.
- **Friends, F1 — friendships + requests** ✅ (spec
  `docs/superpowers/specs/2026-07-21-friends-f1-design.md`): user↔user friendships addressed by
  **verified** gamertag — the same boundary self-unban and the token ledger already enforce. New
  `packages/friends` (the `packages/tokens` shape: pure logic + DB ops, no HTTP) owns every
  transition; `apps/api/src/routes/friends.ts` is six thin session-gated `/me/friends` routes; the
  web surfaces are a `FriendButton` on the dossier, the `/friends` **Roster** page, and a thin
  `FriendsPanel` in the rail + mobile sheet. **F1 of three** — F2 (location sharing) and F3
  (presence notifications) are surface-only follow-ups; their four columns
  (`a_/b_shares_location`, `a_/b_shares_presence`) ship **dormant in migration `0018`**, written by
  nothing and read by nothing, so neither needs a second migration. A reviewer seeing dead columns
  should find this line.
  **⚠️ Invariants a future change would break by accident (each shipped as a review fix — don't
  "tidy" them back):**
  1. **The pair is canonically ordered `user_a < user_b` under a CHECK constraint**, not by
     convention. The unique index alone would happily accept the mirrored duplicate
     `(user_b, user_a)`. Every write goes through `orderPair`; every read projects through
     **`viewOf`**, the single source of truth for viewer-relative status — never re-derive
     "incoming vs outgoing" inline.
  2. **The notification natural key is `friend_request:<senderUserId>:<friendshipId>:<seq>`.**
     `notifications.natural_key` is a **plain GLOBAL** unique index (so `onConflictDoNothing` takes
     **no `targetWhere`** — do not copy the newsdesk's partial-index pattern). Drop `:<seq>` and the
     second request over a pair (decline → cooldown → re-request) is silently swallowed and the
     recipient is never told. Drop `<senderUserId>` and the rate limit below cannot be counted at
     all, since notifications are keyed by **recipient**.
  3. **The 20-per-24h rate limit counts `friend_request_received` NOTIFICATIONS, not `friendships`
     rows** — `cancel` hard-deletes the row while the notification survives, so a row-based count is
     reset by request→cancel→request spam while the target is still notified every time. It is
     `natural_key LIKE <prefix>%` with **`%`, `_` and `\` escaped** (an unescaped `_` in a generated
     user id is a single-char wildcard and wrongly rate-limits a different user), served by
     `notifications_natural_key_pattern_idx` (`text_pattern_ops`, migration `0019`). **Do not
     "simplify" it back to `starts_with()`** — that is not index-usable and seq-scans a table that
     grows across all nine other notification kinds.
  4. **`request()` takes `pg_advisory_xact_lock(hashtext(sender))` as its FIRST statement.** The
     count is otherwise a plain `SELECT` in READ COMMITTED serialised by nothing — `lockPair` locks
     a *different* row per target, and no row at all on a first request — so 200 concurrent requests
     to 200 targets all read `count = 0` and all pass. Lock order is total (advisory → row); nothing
     anywhere takes a row lock first.
  5. **The reciprocal-collision recovery runs inside a nested `tx.transaction()`.** Postgres aborts
     the transaction on the `friendships_pair_uniq` violation, and drizzle/postgres-js issue no
     per-statement savepoint, so a flat recovery dies on `25P02` and 500s. The nested transaction is
     a real `SAVEPOINT`; the recovery itself then runs on the **outer** handle.
  6. **`remove` DELETEs the row; `decline` keeps it.** A retained row is a retained F2 sharing
     consent, so nothing may survive a removal. `decline`'s `responded_at` **is** the 7-day cooldown
     clock, and a decline notifies **nobody** — "X declined you" is a hostile message with no action
     attached. A re-request after a decline reuses the row and bumps `request_seq`; after a removal
     it is a fresh row at `seq = 1`.
  7. **`accept`/`decline` throw `not_recipient` (403) for any non-recipient; `cancel`/`remove` throw
     `not_found` (404) for a non-party.** The asymmetry is deliberate.
  8. **Loading and error never render as an authoritative negative** — the live-data-honesty rule,
     which this feature violated four separate times in review: a default "Add friend" against an
     unknown relationship, a fabricated "Friends 0" on a failed fetch, a blank `/friends` for
     signed-out visitors, and an `SrStatus` announcing "Friend request accepted" at **click** time
     rather than on settlement (announcing success to a screen-reader user for a request that then
     failed). Announce on settle, and keep loading / failed / genuinely-empty three distinct renders.
  9. **`FriendButton` gates on the target's `verified` flag AND a case-insensitive self-comparison**,
     because `statusFor` collapses self, unverified target and ordinary stranger all into
     `status:"none"`. The self-gate skips the **fetch**, not just the render, so there is no flash of
     "Add friend" on your own dossier while identity resolves.
  10. **A friend whose gamertag link is released drops out of the roster — but the row survives,
      unreachable, with its sharing flags intact** (`packages/friends/src/queries.ts`). **Resolved
      in F2**, both halves — see F2 invariant 5. The drop-out itself is now pinned by a test
      (`packages/friends/test/queries.test.ts`), proven red against a render-blank implementation:
      an unnameable friend must vanish from the roster while the row survives.
  **Deploy:** migrations `0018` + `0019` touch no projection table — plain `./deploy/deploy.sh`,
  **no `--rebuild`**. No new env vars, no new worker, no systemd unit. **Friend notifications are
  live on deploy**, unlike the nine worker-generated kinds: they are written inline in the API
  request, in the same transaction as the state change, so they are not gated behind
  `NOTIFIER_SINCE`/`NOTIFIER_DRY_RUN`. The notifier's **push** pass still delivers them unchanged —
  it selects on `pushed_at IS NULL` and does not care who inserted.
- **Friends, F3 — presence notifications** ✅ (spec
  `docs/superpowers/specs/2026-07-22-friends-f3-presence-design.md`): a friend comes online, you
  get told — a twelfth notification kind, `friend_online`, generated by
  `apps/notifier/src/generators/presence.ts`. **F1's "no second migration" claim held for F2 but
  NOT for F3**: genuine two-sided control needs four per-pair flags and F1 shipped two, so
  migration `0020` adds `a_/b_notify_presence`, flips the `*_shares_presence` defaults to `true`
  with a backfill, and creates the durable `user_preferences` table. (`0021` adds
  `sessions_connected_at_idx`.) The `*_shares_location` columns stay untouched for F2.
  **⚠️ Invariants a future change would break by accident:**
  1. **Four conditions, all required** — `shouldNotifyPresence` (`packages/friends/src/presence.ts`)
     is `accepted && masterShare && pairShare && pairNotify`. **Effective sharing is
     `user_preferences.share_presence AND the subject's per-pair flag`**; the observer's per-pair
     notify flag is a separate mute. **An absent `user_preferences` row means `false`** — every
     pre-existing user has no row, which is exactly why the `0020` backfill flipping the per-pair
     defaults to `true` changes nobody's visibility. Make the missing row permissive and you
     retroactively expose the entire user base.
  2. **The natural key is `friend_online:<observerUserId>:<subjectGamertag>:<connectedAt ISO>`** —
     **never `sessions.id`**. `rebuild.ts` truncates `sessions` `WITH RESTART IDENTITY` while
     `notifications` is never truncated, so session ids are reassigned across a rebuild and a
     legitimate connect would collide with a stale key and silently notify nobody. Rebuild-stable
     tuple, timestamp from `toISOString()` in TypeScript — never a SQL `to_char()`.
  3. **The 4-hour cooldown is a prefix query over the durable notification rows**, using
     `LIKE <escaped prefix> || '%'` against `notifications_natural_key_pattern_idx`. Reuses F1's
     exported `escapeLikePattern` — an unescaped `_` in a user id is a single-character wildcard,
     and *this feature shipped that bug once already*. Never `starts_with()` (not index-usable).
  4. **Two bounds, both required**: `windowStart(deps)` (the floor every generator must honour)
     AND `FRIEND_ONLINE_MAX_AGE_MINUTES = 15`, which drops connects too old to be worth
     announcing — so a worker that has been down delivers silence rather than archaeology.
     Multiple connects in the window resolve by `ORDER BY connected_at DESC`.
  5. **Presence is keyed on the connect transition, and is NOT gated on life qualification** —
     deliberately unlike the survivors board, enforcer and newsdesk. "My friend is playing" is
     true regardless of leaderboard eligibility, and gating would skip fresh spawns, which is
     when people most want to group up. A crashed session that stays open until the next
     even-hour reboot can never re-fire, because a connect is a point event.
  6. **The cooldown does NOT make every reboot rejoin silent.** The fleet reboots every 2h and
     the cooldown is 4h, so a player online all evening is re-announced roughly every 4h. Within
     the intended ≤6/day bound; the spec's §2 phrasing is more optimistic than the behaviour.
  7. **UI: the two consent levels are shown, not hidden.** With the master switch off the
     per-friend *share* control is disabled **with a visible explanation** (`aria-describedby`,
     id derived per row — a shared id resolves every reference to the first row); the *notify*
     control stays live, since muting matters whether or not you are visible. Announcements fire
     **on settlement**, never at click time.
  **Deploy:** migrations `0020`/`0021` touch no projection table — plain `./deploy/deploy.sh`,
  **no `--rebuild`**. No new env vars, worker or systemd unit. **F3 ships dark behind TWO gates**:
  the notifier's generate pass is off in production (`NOTIFIER_SINCE` unset), and switching it on
  **un-dormants the other eleven kinds simultaneously** — set `NOTIFIER_SINCE` to the go-live
  instant and watch one dry-run interval first; and separately, no user is visible until they turn
  on the master switch.
- **Friends, F2 — location sharing** ✅ (spec
  `docs/superpowers/specs/2026-07-22-friends-f2-location-design.md`), completing the three-part
  friends feature: a live map per server at **`/maps/{map}`** (plus a `/maps` picker) showing the
  viewer's own position and every friend sharing with them. Migration `0022` adds
  `user_preferences.share_location` and flips the two dormant `friendships.*_shares_location`
  defaults to `true` with a backfill.
  **⚠️ Invariants a future change would break by accident:**
  1. **ONE coordinate egress point per audience, and neither takes a subject.**
     `GET /me/maps[/:mapSlug]` takes a **server slug and no player identifier** — the subject set
     is computed from the session alone, so serving a *named* player's coordinates is
     **unexpressible**, not merely rejected. The owner-only `GET /me/lives/:mapSlug/:n/track` holds
     the same property. **Do not parameterise either by subject**, and do not add a third route
     that serves coordinates. Both carry `cache-control: no-store, private` — a shared proxy
     caching either hands one player's squad positions to the next visitor.
  2. **Effective sharing = `user_preferences.share_location` AND the subject's per-pair flag**,
     via `shouldShareLocation` (`packages/friends/src/location.ts`). Master defaults **false**, the
     per-pair flag defaults **true** ("not individually hidden"), and **an absent preferences row
     means `false`** — which is exactly why `0022`'s backfill exposed nobody.
  3. **Last known position ONLY, and only while the subject is online.** Not a route trail — a
     trail shows direction, pace and habitual locations, i.e. an interception tool. And the dot
     vanishes on disconnect, because **where a DayZ player logs out is where their stash is**; a
     position that survives logout publishes that to everyone they ever shared with, and an expiry
     window is worse still (it exposes the stash during exactly the minutes someone watching would
     act). A fix older than **`MARKER_MAX_AGE_SECONDS` (900)** — reused, never redefined — is
     absent rather than shown somewhere the player no longer is.
  4. **The reciprocity line is ONE collapsed boolean.** `theyShareLocation` is computed
     server-side and cannot distinguish "their master switch is off" from "they hid from you
     specifically". Differentiating would tell one player a named friend singled them out, which
     makes the per-friend hide switch a visible act and therefore unusable. **This is the only
     place this codebase reports anything about another user's settings** — presence deliberately
     reports none. Do not generalise it, and do not add a field that reconstructs the difference.
  5. **F1's deferred prerequisite is fixed in BOTH halves, and both are needed.** Structural: the
     candidate query **inner-joins a `verified` `gamertag_links` row**, so a released link means no
     coordinates, unconditionally. Explicit: **`verifyLink` resets `share_location` AND
     `share_presence`** in the same transaction (`apps/verifier/src/pg-store.ts` — the only writer
     of `status='verified'`), scoped to the userId `RETURNING`ed from that same UPDATE. The join
     alone leaves stale `true` flags that go live on re-verification; the reset alone dies to any
     query that forgets the join. **The reset is one-directional** — it clears the re-verifying
     user's *outbound* sharing, not their friends' inbound flags toward them.
  6. **Gamertag identity is case-insensitive (RESOLVED — was an open backlog item).** Migration
     `0024` moved `players_gamertag_uniq` and `gamertag_links_verified_uniq` onto
     `lower(gamertag)`, closing the hole where two users could verify `Sasha`/`sasha`, fold onto
     one `players` row, and have one receive the other's coordinates as their own dot. Three
     code paths had to change with it, and **each is load-bearing, not tidy-up**:
     the claim route resolves the submitted gamertag to the canonical `players.gamertag` casing
     and stores THAT (`apps/api/src/routes/gamertag-links.ts`) — **on the INSERT path and on the
     reuse path**, since a pre-`0024` row found by the case-folded lookup and merely re-activated
     would keep its typed casing; migration `0024` canonicalizes the existing corpus the same way
     (a guarded `UPDATE`, reported as a `NOTICE`), so the invariant is true at deploy time rather
     than assumed. **That keeps the ~35 bare `eq(x.gamertag, …)` comparisons correct wherever
     both sides derive from `players.gamertag` or a `gamertag_links` row** — notably
     `redeem.ts`'s link↔`bans.gamertag` match and `player-page.ts`'s Verified stamp, where a
     mis-cased link silently cost the player their self-unban. It does **NOT** extend to
     ADM-sourced denormalised columns: `kills.killer_gamertag` and `hit_events.victim_gamertag`
     are written by `packages/projections/src/fold.ts` from the raw event payload, not from
     `players.gamertag`, so a re-cased log line still writes a differently-cased value there and
     bare `eq()` against it can still miss. (Not a regression — before this branch such a line
     was dropped entirely; now it is at least recorded.) A `lower()` sweep of those sites would
     defeat `positions_player_idx` and both partial indexes from
     `0017`; the verifier compares `lower()` in all three of `findPendingChallenges` /
     `getVerifiedLinkId` / `cancelOtherPendingLinks` (a mis-cased claim previously matched no
     emote, so verification silently never completed); and the projector's `getPlayer` resolves
     `lower()` — **without which the new index turns a duplicate row into a 23505 inside the
     fold transaction, which an event-log fold retries forever, stalling every projection.**
     ⚠️ `createPlayer` (`apps/projector/src/pg-store.ts`) must keep its **raw-SQL**
     `ON CONFLICT (lower(gamertag))`: drizzle 0.36.4 types `IndexColumn = PgColumn`, so an
     expression conflict target is not expressible through the query builder, and a column
     target (`target: [players.gamertag]`) fails at RUNTIME ("no unique or exclusion constraint
     matching the ON CONFLICT specification"), not at compile time. Two more hazards ride along
     the same raw path, both verified against postgres-js 3.4.9 and both explicitly converted in
     the code rather than cast: a JS `Date` bound as a raw parameter THROWS (only drizzle's typed
     builder serialises Dates), so the seen-at timestamp goes in as `toISOString()`; and raw
     `RETURNING` is untyped — `id` comes back as a bigint STRING and a timestamptz as a raw
     Postgres string, not the `number`/`Date` the query-builder path would give, so both are
     converted before the row is handed to the fold, which would otherwise silently receive a
     `PlayerRow` lying about its own types. The timestamp is returned as **epoch milliseconds**
     (`extract(epoch …) * 1000`) rather than as the timestamptz: Postgres renders one as
     `2026-07-22 19:17:56.505482+00`, whose space separator, microsecond precision and two-digit
     offset are all outside the Date Time String Format ECMA-262 defines, so `new Date()` on it
     only works through V8's implementation-defined fallback parser.
     ⚠️ `players.gamertag` casing is **frozen at first sight** — `getPlayer` finds the row for any
     casing but `touchPlayer` never rewrites it. Rewriting it would desynchronise every
     denormalised copy (`bans.gamertag`, `kills.killerGamertag`, `articles.gamertag`) that those
     bare `eq()` sites read.
     This does NOT merge renames: `players` is still keyed by gamertag, so a genuine rename still
     mints a second row (2 `dayz_id` values span 5 gamertags in production). That is the separate
     identity-merge sub-project, which needs `--rebuild`.
     **`getFriendPositions`' two defensive collapses (one-friend-one-dot, one-player-row-one-subject)
     were deliberately RETAINED, not removed, even though `0024` makes their triggering inputs
     unwritable through any public path today** — kept as defence in depth because the failure
     mode is a silent privacy leak (a marker simultaneously labelled as two different callsigns,
     or a viewer's own dot silently relabelled as a friend's), and the inputs return the moment the
     index is altered, hand-backfilled around, or restored from a pre-`0024` dump. See the two
     `⚠️` comments in `packages/read-models/src/friend-positions.ts`.
  7. **The positions lookup filters on `player_id`, never `lower(gamertag)`.** Only the former can
     be served by `positions_player_idx (server_id, player_id, recorded_at)`; the gamertag shape
     seq-scans the largest table in the system, on a 30s poll per viewer and once per server on
     `/maps`. Measured: index scan 0.066ms vs seq scan filtering 60,115 rows at 2.356ms.
  8. **The Leaflet lifecycle lives in ONE place** — `apps/web/src/components/map/map-canvas.tsx`,
     extracted from `TrackMap`. Nearly every comment in it documents a fixed bug (the two-effect
     split, the first-draw fit latch, the created-then-added LayerGroup, the SSR-avoiding dynamic
     import, the `isolate` stacking context). Consumers supply a `draw` function and nothing else;
     do not grow a second copy. Its optional **`className` is SIZING ONLY** (default
     `h-[420px] w-full`, the life-trail panel): `/maps/[map]` is a fixed-height flex column and
     passes `h-full w-full` so the canvas fills it — Leaflet measures the element on creation, so
     a parent chain with no definite height collapses the map to zero. The `isolate`/border/
     background classes are NOT overridable, because `isolate` is the stacking-context rail above.
  8. **Place labels are vendored data, drawn by `MapCanvas` for BOTH maps.**
     `apps/web/src/lib/map-places.json` (321 places across the three maps) is generated by
     `apps/web/scripts/refresh-map-places.mjs` from DZMap's upstream location JSON — the same
     source as the tiles, and the half `mirror-tiles.sh` skips with `--tiles-only`. Refresh it
     by hand after a DayZ terrain update, like re-mirroring tiles. **⚠️ `static.xam.nu` answers
     EVERY path with `200` and a zero-byte body**, so a stale version segment looks like a
     successful fetch of an empty file — hence the script's `assertNonEmpty` and the
     version-discovery recipe in its header (the version in `deploy/dzmap.yaml` is already
     stale). **The stored `lat`/`lng` are ALREADY Leaflet `CRS.Simple` coordinates on the
     zoom-6 pyramid** — passed to `L.latLng` untouched, never through `worldToPixel`, unlike
     every metre-based coordinate we hold ourselves; a test pins them to CRS space so a
     well-meaning "fix" fails loudly. Livonia's data is published upstream as `livonia` and is
     re-keyed to our `enoch` codename by the script. **Tiering is required, not cosmetic**
     (`placesFor`): 201 Chernarus places at once bury the dots — capital/city at zoom 0,
     village at 2, everything else at 4, and an **unknown category defaults to the most
     restrictive tier** so a DayZ update cannot flood the zoomed-out view. **Labels render in
     a dedicated `places` pane at z-index 350**, because Leaflet puts every `L.marker` at 600,
     *above* the overlay pane (400) holding our dots and trails — a LayerGroup cannot fix
     this, and without the pane a town name covers the friend you opened the map to find.
     **⚠️ The visible label is the inner `.map-place-chip` span — the box may NEVER be styled
     on `.map-place` itself.** That root is Leaflet's marker icon and carries an INLINE
     `width: 0; height: 0` from `iconSize: [0,0]`; an inline style beats any class rule, so a
     background there paints an 8x2px dash at the anchor while the text overflows it unbacked
     (shipped as v0.38.1, verified in a browser as a black dash beside every name).
     **⚠️ And the tiles are LIGHT** — Chernarus topographic is pale green/bone, so the original
     "paper text on dark tiles" premise was wrong about the terrain; a dark chip with light
     text is what holds over pale terrain, forest and water alike.
     **⚠️ Labels carry a SOLID `--dark` background, not a text shadow** — the shipped halo
     treatment left the 10px/11px tiers unreadable over real topographic tiles (busy,
     mid-value terrain), which is precisely the content they appear over; and the tiers
     differentiate by size/weight ONLY, never by fading text toward the background. A box is
     safe here because the `places` pane already keeps every label under the markers.
     **This also finally verifies `CANVAS_PX = 16384`**, the long-flagged unverified
     assumption: a wrong extent puts every town visibly off its own buildings, and a test
     pins Chernogorsk to its real world position.
  9. **Friend dots carry a PERMANENT gamertag label** (a Leaflet tooltip, styled by
     `.leaflet-tooltip.friend-label` in `globals.css` — specificity-scoped because Leaflet's own
     stylesheet is imported inside `map-canvas.tsx`'s chunk, so source order is not reliable). The
     fix age stays in the popup and the accessible legend; the label is identity only, or a
     crowded map becomes a wall of text. The map is **dots, never a polyline** (invariant 3
     above), pinned by a test in `friends-map-draw.test.tsx`.
  **Deploy:** migration `0022` touches no projection table — plain `./deploy/deploy.sh`,
  **no `--rebuild`**. No new env vars, worker or systemd unit. Unlike F3 there is **no operator
  gate** (no worker is involved), so the endpoint is live on deploy — but **inert**: every master
  switch starts `false`, so the map shows the viewer's own dot and nobody else's until people opt
  in. Live-but-inert rather than dark.

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
  character sightings), `friends` (friendship pair ordering + viewer-relative projection,
  presence + location consent flags and the `shouldNotifyPresence`/`shouldShareLocation`
  predicates,
  transitions, read queries; writes its own notifications inline — see the Friends F1 entry, whose
  ten invariants are all load-bearing).
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
  `docker-compose.override.yml` may remap the host port (this dev machine uses 5434, not 5432;
  a git worktree brings up its own stack on its own port — check `docker ps`).
  **⚠️ `drizzle-kit` reads `DATABASE_URL` and NOTHING ELSE — notably not `TEST_DATABASE_URL`,
  which is what every suite here uses.** It used to fall back to a hardcoded
  `localhost:5432/onelife`, so a migrate run with only `TEST_DATABASE_URL` exported silently
  targeted a different database and reported success; an unset `DATABASE_URL` is now a loud
  error. To migrate the test database, name it:
  `DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate`.
  **⚠️ `turbo.json`'s `test` task declares `env` for exactly this reason.** Without it,
  `TEST_DATABASE_URL` is not part of the cache key, so repointing the suite at a different or
  unmigrated database replays a cached PASS and reports green **without running anything** —
  which happened during the friends work. Any new env var a suite reads must be added to that
  list, or the suite gains the ability to report success it did not earn.
  `.gitignore` covers OS cruft (`.DS_Store`); prefer `git add -p`/explicit paths over `git add -A`
  at the repo root so stray untracked files don't ride into a commit.
- **⚠️ A change to `deploy/deploy.sh` NEVER applies to the deploy that installs it.** The
  operator invokes the currently-checked-out script, which checks out the new tag and runs to
  completion — so a release shipping a `deploy.sh` fix is deployed *by the previous release's
  script*, flaw included; the fix takes effect from the next deploy onward. This is inherent to
  a deploy script that deploys its own repo. Compensate manually for that one deploy (v0.37.2's
  `DATABASE_URL` fix needs a one-time `DATABASE_URL=placeholder ./deploy/deploy.sh`; see
  `deploy/README.md`). **Two distinct things here — don't conflate them:**
  1. **Self-application is FIXABLE, and deliberately unfixed.** The script could `exec` its new
     self behind a guard flag after the checkout succeeds. That is a legitimate future change;
     it is declined because a manual step on the rare `deploy.sh` release is cheaper than an
     exec-resume in the one script whose failure is an outage. Not forbidden — just not free.
  2. **Machinery to defend against a MID-RUN REWRITE is forbidden**, because that hazard does
     not exist. It was tried and reverted: `git checkout` unlinks and recreates rather than
     writing in place, so the running bash keeps reading the original inode (verified on
     macOS/APFS and Linux/overlayfs — a 236 KB script that checks out a 42-byte replacement of
     itself completes every phase). The self-re-exec guard bought nothing and introduced a way
     to delete `deploy.sh` from the working tree.
- **Any child process of `deploy.sh` that needs `DATABASE_URL` must be passed it EXPLICITLY.**
  The script reads it out of `.env` into a plain shell variable and never exports it; the
  migrate and `--rebuild` phases each prefix `DATABASE_URL="$DATABASE_URL"` for this reason.
  Both phases run *after* the fleet is stopped, so a miss aborts the deploy with the site down.
- Deploy (prod): `./deploy/deploy.sh` deploys the latest release tag (build → backup → migrate →
  restart fleet → health-check); add `--rebuild` for releases that change projection-table shape
  (truncate + re-fold from the event log). See `deploy/README.md`.
