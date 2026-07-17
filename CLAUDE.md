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
  kills/longest-kill/sessions counts strip only; kill lists + vitals return with the R4 life
  timeline), a dynamic OpenGraph share image, and
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
- **Tabloid redesign** (R1+R2+R3 shipped): a five-tier visual relaunch replacing the old dark "field
  journal" theme with a light "Clean Glossy" tabloid look. Roadmap + full R1 design:
  `docs/superpowers/specs/2026-07-16-tabloid-redesign-design.md` — **R1** design system + shell,
  **R2** boards restyle (survivors + player dossier;
  spec `docs/superpowers/specs/2026-07-16-r2-boards-restyle-design.md`), **R3** controls rail
  (spec `docs/superpowers/specs/2026-07-16-r3-controls-rail-design.md`), **R4** life timeline +
  obituary/birth read-model groundwork, **R5+** an LLM content engine that finally writes the
  News/Obituaries/Fresh Spawns pages.
  **R3 shipped — the controls rail is the whole account surface.** Root layout is an `xl:`
  two-column grid (`max-w-[1440px]`, `[minmax(0,1fr)_380px]`): pages flow in the main column
  (ink right-border at `xl`), the **`ControlsRail`** (`@/components/controls/`) is the sticky right
  column, and below `xl` a fixed **`ControlsPill` + `ControlsSheet`** (bottom sheet) replace it. All
  three surfaces are driven by **`useControls`/`useControlsActions`** over the `accountStatus` union:
  signed-out → sign-in CTA (rail only; no pill); unlinked → identity + in-rail gamertag link panel
  (autocomplete over `GET /players/search`, race-guarded); pending → in-rail "prove it's you" emote
  challenge (live via the 5s poll); verified → identity + Verified stamp + **tokens panel** (balance,
  send-by-gamertag, quiet referrer) + **server cards** (alive/no-life/banned; banned shows a live ban
  countdown + the shared `SelfUnbanButton` spend CTA) + profile/sign-out footer. Presentational
  pieces are props-only + unit-tested; `useControls`/containers are thin (untested, per convention).
  The mobile menu and sheet share **`useModalBehavior`** (`@/lib/use-modal-behavior` — focus trap,
  Escape, scroll lock, focus restore; keyed on `open` only via an `onCloseRef` so parent re-renders
  don't steal focus). **`POST /me/tokens/transfer` and `POST /me/referrer` take a verified gamertag**
  (`{ toGamertag }`/`{ referrerGamertag }`, resolved case-insensitively against verified
  `gamertag_links`; `not_verified` on miss), not a raw user id. **R3 also closed the R1 compat-shim
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
  assets, never as a webfont. **Voice-first rule:** News/Obituaries/Fresh Spawns stay static
  teasers — no fake counts, no dry copy — until the R5+ content engine can actually write them;
  the underlying read-models land ahead of the UI (R4) but the teasers don't retire until R5+.

## Monorepo (pnpm + turbo, TS/ESM, Postgres + Drizzle)

- **packages:** `db` (18-table schema + migrations), `domain` (zod events, emote/weapon dicts),
  `nitrado` (log-file client), `adm-parser` (pure ADM line parser), `event-log` (append/cursor over
  `events`), `projections` (fold logic), `read-models` (stats queries), `test-support` (Postgres
  test harness), `auth` (Better Auth), `verification` (emote-sequence challenges),
  `tokens` (unban-token ledger + grants/redeem/transfer), `rpt-parser` (RPT login-correlation →
  character sightings).
- **apps:** `ingest-worker` (ADM+RPT poll→events loop; **DB-driven** — sweeps every `servers` row with
  `active=true` using the shared `NITRADO_TOKEN`, no `NITRADO_SERVICE_ID` env), `projector` (events→projections fold),
  `verifier` (emote-verification loop), `api` (Fastify REST + auth), `web` (Next.js frontend),
  `enforcer` (24h death-ban reconciler; dry-run by default), `granter` (token grant sweeps),
  `rebooter` (restarts every `active` server on the top of each **even UTC hour** — 00:00,02:00,…,22:00
  — best-effort per server; **no dry-run, live on deploy**; needs `NITRADO_TOKEN` + a `onelife-rebooter`
  systemd unit).

## Commands

- Test: `pnpm turbo run test --concurrency=1` (DB suites need `TEST_DATABASE_URL`).
  Typecheck: `pnpm turbo run typecheck`.
- Local Postgres: `docker compose up -d postgres`. **Note:** a gitignored
  `docker-compose.override.yml` may remap the host port (this dev machine uses 5434, not 5432).
- Deploy (prod): `./deploy/deploy.sh` deploys the latest release tag (build → backup → migrate →
  restart fleet → health-check); add `--rebuild` for releases that change projection-table shape
  (truncate + re-fold from the event log). See `deploy/README.md`.
