# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
### Changed
### Deprecated
### Removed
### Fixed
### Security

## [0.11.1] - 2026-07-16

### Fixed
- **Livonia (and any new map) is handled beyond the original Chernarus/Sakhal set.** Player pages now
  label the `enoch` map codename as "Livonia" (`mapLabel`) instead of the title-cased fallback
  "Enoch", and the `GET /players/:gamertag/:map/lives/:n` life-detail route no longer validates its
  server-slug segment against a hardcoded `["chernarus","sakhal"]` allow-list (which 400'd every
  Livonia request) — it now resolves the slug against the `servers` roster, returning `404` for a
  genuinely unknown slug. Adding a server stays a pure DB insert, no route edits.

## [0.11.0] - 2026-07-15

### Changed
- **Player page redesign.** Rebuilt `/players/{slug}` as a single roomy column with everything visible (no expand/collapse): an avatar-free hero with a full-width stat band (Kills shown only when > 0, Longest life always the highlighted stat), state-colored current-standing cards (green alive / red banned), and muted archive cards for past lives — now **paginated** (`?page=`, 10/page, server-side, enriching only the visible slice). The OpenGraph share image is redesigned as a survivor dossier (logo + logo-skull motif, callsign, "surviving since," all-time stats, on Oswald/Space Mono).

## [0.10.0] - 2026-07-15

### Added
- **Player pages (`/players/{slug}`).** Public, SEO-optimized survivor profile — a cross-server totals
  hero, per-server current standing (alive / banned / idle) with a live ban countdown, expandable
  past-life history (kill lists, vitals, sessions), a dynamic OpenGraph share image, and
  `ProfilePage` JSON-LD. Verified owners get a self-unban control that spends a token to lift their
  own ban (owner + verified-only, four states: hidden/ready/no-tokens/pending). Backed by a new
  `getPlayerPage` read-model and an extended `GET /players/:gamertag` route.

### Changed
- **Gamertags link to player pages site-wide, and verified users land on theirs after login.** The
  survivor board, kill lists, and death-by attributions now route every gamertag through a shared
  `GamertagLink` to `/players/{slug}`. A new `/welcome` post-login resolver sends a verified user
  straight to their player page (pending → account page, unlinked → claim flow), and the masthead's
  gamertag chip now points there too.

## [0.9.1] - 2026-07-15

### Changed
- **Survivors leaderboard control ordering.** Map tabs are now sorted alphabetically by label (with **All maps** always first), and the sort pills are ordered **Time alive → Kills → Longest kill** (matching the new time-alive default).

## [0.9.0] - 2026-07-15

### Changed
- **Survivors leaderboard: path-based sort, time-alive default, SEO H1, one-stat rows.** Sort now lives in the URL **path** instead of a `?sort=` query string — `/survivors/kills`, `/survivors/sakhal`, `/survivors/sakhal/kills` (page stays `?page=`), served by a new `/survivors/[map]/[sort]` route and a pure `resolveSurvivorsRoute` resolver (a depth-1 segment resolves as a reserved **sort word** → combined board, or a **server slug** → that map; the three sort words `kills`/`time`/`longest` are reserved and cannot be server slugs). The **default sort is now time-alive descending** (web + API `GET /survivors`); old `?sort=` links are ignored (render the default), and an explicit-default path (`/survivors/time`) 307-redirects to the bare path (preserving `?page`). Each board page gets an SEO-friendly `<h1>` — `Top {Map} survivors by {sort}` (combined drops the map name). Rows now show **only the stat being sorted by** (the other two are hidden), the character avatar is enlarged (40px → 80px), and the "Longest" label reads "Longest kill". Tie-breaking is **sort-aware**: time → time/kills/longest, kills → kills/time/longest, longest → longest/time/kills, with gamertag as the final deterministic tiebreak (NaN-safe comparator).

## [0.8.1] - 2026-07-15

### Fixed
- **Character avatars now come only from the game's authoritative `create_entity` signal.** Dropped the unreliable `head_asset` class source — head-warning log lines carry no player identity and mis-attributed characters across players (even cross-gender), surfacing phantoms like "Adam" (a head-model name, not a real persona) and mislabeling real personas (e.g. a Mirek). The RPT parser now uses `create_entity` only; the survivor roster resolves real `Survivor[MF]_<Name>` persona classes (adds the previously-missing **Mirek**, removes the phantom **Adam**), and an undetermined/unknown character shows a neutral silhouette. Migration `0008` rebuilds the `characters` rollup from `create_entity`-only sightings.

## [0.8.0] - 2026-07-15

### Added
- **Survivors leaderboard (`/survivors`).** Public, mobile-first live leaderboard of currently-alive survivors, one row per (player × map), ranked by kills / time alive / longest kill (this life). Server-rendered map routes (`/survivors`, `/survivors/:map`) with query-param sort + pagination and per-page SEO/OG metadata. New `getAliveSurvivors` read-model + public `GET /survivors[/:slug]` API.
- **Scheduled server reboots (`apps/rebooter`).** A new always-on worker restarts every **active** server in the `servers` table on the top of each even UTC hour (00:00, 02:00, …, 22:00), best-effort per server (one server's failure is logged and does not abort the rest). Reboots go **live on deploy** — there is no dry-run gate, since a scheduled restart is routine and reversible (unlike the enforcer's bans). Adds `NitradoClient.restartServer()` (POST `/services/{id}/gameservers/restart`), a pure `msUntilNextBoundary()` scheduler that re-aligns to the wall clock each cycle (no interval drift, no double-fire), and registers `rebooter` in the deploy fleet (`deploy/deploy.sh` + README). Requires `NITRADO_TOKEN` set and a `onelife-rebooter` systemd unit on the host.

## [0.7.0] - 2026-07-14

### Added
- **Survivor character headshot assets.** Added the 31 default DayZ survivor portraits (Baty…Taiki) as WebP under `apps/web/public/characters/<name>.webp`, served by Next.js at `/characters/<name>.webp`. Sourced from the DayZ Fandom wiki (CC BY-SA); intended for an upcoming per-life character-head display keyed off the SP5 character mapping (`getLifeCharacter`).

### Changed
- **Persistent onboarding/status banner drives account state site-wide.** A banner under the masthead now reflects the viewer's onboarding state on every page and carries the single next action, and the masthead's amber CTA collapses to match. One pure `accountStatus()` derivation (`signedOut | unlinked | pending | verified | loading`) is the single source of truth for both surfaces. **Signed out** → banner *"Sign in to claim your gamertag"* (→ `/login`), no masthead CTA. **Signed in, no active link** → banner *"Link your gamertag to get started"* (→ `/account/claim`) + a quiet **Account** link in the masthead. **Pending** → a self-contained verification banner showing the emote sequence with live progress (`n / total DONE`), an expiry countdown, **Cancel claim**, and a **Start a new challenge** re-claim when the challenge expires — plus the quiet **Account** link. **Verified** → no banner; the masthead shows the amber **{GAMERTAG}** CTA → `/account`. No backend change: the existing `GET /me/gamertag-links` list already serializes the challenge, so `useGamertagLinks` just adds a 5s `refetchInterval` while a link is pending (progress ticks live, flips to verified on completion, and never polls signed-out visitors). `StatusBanner`/`MastheadSlot` are presentational (unit-tested by props); `useAccountStatus`/`StatusBannerContainer` wire the hooks. Decorative banner glyphs are `aria-hidden`.

## [0.6.0] - 2026-07-14

### Changed
- **Masthead account button is now a stateful CTA.** The top-bar's right-hand link is a single amber primary button that reflects the viewer's auth + gamertag-link state instead of a static "Account" link: signed-out shows **Sign in** → `/login`; signed-in with no active link shows **Link gamertag** → `/account/claim`; a `pending` link shows **{GAMERTAG} (not verified)** → `/account`; a `verified` link shows **{GAMERTAG}** → `/account`. To power this, `QueryProvider` moved from the `/account` layout up to the root layout (one shared TanStack Query cache app-wide), the `Masthead` became a client component reusing the existing `useSession`/`useGamertagLinks`/`activeLink` read models, and `useGamertagLinks(enabled)` now gates its fetch so logged-out visitors don't hit `/api/me/gamertag-links` (401) on every page.

## [0.5.0] - 2026-07-14

### Added
- **One gamertag per user.** A user can now hold at most one *active* gamertag link (one `pending` or `verified` claim at a time). Enforced in depth: a partial unique index `gamertag_links_user_active_uniq` on `(user_id) WHERE status IN ('pending','verified')` (migration `0007`), an API guard in `POST /me/gamertag-links` that returns `409 { error: "active_link_exists", current: { gamertag, status } }`, and a web claim UI that hides the claim form / shows the existing link when one is active. Cancelling a `pending` link frees the slot; a `verified` link is permanent (admin-only release via manual DB edit).

## [0.4.0] - 2026-07-14

### Added
- **Login page shows only configured sign-in methods.** The web login page now hides social providers that aren't wired up and the email/magic-link form when it's disabled, instead of always rendering all of them. A provider appears only when both its `<P>_CLIENT_ID` and `<P>_CLIENT_SECRET` are set (unchanged backend rule); email is controlled by a new `MAGIC_LINK_ENABLED` flag (default `true`). The backend is the single source of truth: `@onelife/auth` exposes `enabledAuthMethods(cfg)`, served at a new public `GET /api/auth/providers` (a static route that wins over the Better Auth `/api/auth/*` catch-all and returns only method names — no secrets). The login page is now a server component that fetches this before render; if the API is unreachable it shows an explicit "temporarily unavailable" state rather than guessing.

## [0.3.1] - 2026-07-14

### Added
- **`deploy/deploy.sh` — one-command production deploy.** Checks out the latest semver release tag, installs + builds web, stops the systemd fleet, takes a full-DB `pg_dump` checkpoint, applies migrations, restarts, and health-checks (all services active + web 200 + api reachable). Rolls back the code on pre-migrate failure; after a successful migrate it keeps the new code up and points at the checkpoint (Postgres migrations are forward-only). A `--rebuild` flag adds the gated projection truncate + re-fold (using `pnpm … run rebuild`) and waits for the projector to catch up — for releases that change projection-table shape.

### Fixed
- UP1 deploy runbook: corrected the projection-rebuild command to `pnpm --filter @onelife/projector run rebuild` (bare `pnpm … rebuild` invokes pnpm's native-module builtin and silently skips the truncate, which then aborts `db:migrate` on the `players_gamertag_uniq` duplicate check).

## [0.3.0] - 2026-07-14

### Added
- **Universal Player — global identity + global gamertag claim.** A player is now a single global identity keyed by gamertag (one row per gamertag across all servers) while **lives stay per-server**, matching DayZ Xbox where a gamertag uniquely identifies one person. **UP1** rebuilds the `players` projection globally (migration `0005` drops `players.server_id`/`current_life_id`, unique on `gamertag`); the fold, projection stores, and read-models resolve players by gamertag and scope stats per-server via `lives.server_id`; projections are regenerated from the immutable `events` log (truncate + replay). **UP2** makes the gamertag claim server-agnostic (migration `0006`: `gamertag_links` drops `server_id`, unique `(user_id, gamertag)` + verified-unique `(gamertag)`) — a gamertag is verified once, by one user, across all servers, and the emote sequence can be completed on **any** server. The claim UI replaces the server dropdown with a debounced gamertag **autocomplete over unverified observed players**, backed by a new `searchClaimableGamertags` read-model and `GET /players/search?q=` route.

### Changed
- **Unban redeem is now global.** `@onelife/tokens` `redeem` establishes ban ownership by the user's verified **gamertag alone** (bans remain per-server), so a globally-verified gamertag can lift its 24h death-ban on any server it was banned on.
- **`POST /me/gamertag-links` no longer accepts `serverId`** — the claim body is `{ gamertag }` only, and the verifier matches links by gamertag across servers.

### Removed
- **BREAKING (schema):** dropped `players.server_id` + `players.current_life_id` (migration `0005`) and `gamertag_links.server_id` (migration `0006`). Deploy requires the gated projection rebuild **and** the durable-table (`gamertag_links`) duplicate precheck in the UP1 deploy runbook (`docs/superpowers/plans/2026-07-14-up1-global-player.md`) — `0005`/`0006` are separate transactions, so pre-existing per-server duplicates must be resolved before `db:migrate`.

## [0.2.0] - 2026-07-14

### Added
- **DB-driven multi-server ingest.** The `ingest-worker` now ingests every `servers` row with `active = true` (new `ingestSweep` in `apps/ingest-worker/src/sweep.ts`) instead of a single env-pinned server. Single shared `NITRADO_TOKEN` (single tenant), one cached Nitrado client per service id, per-server error isolation (one server's Nitrado failure no longer aborts the sweep), and RPT sightings summed across servers. Adding/removing a server is now a pure data change (`active` flag) — no redeploy. No migration (relies on existing `servers.nitrado_service_id` / `active`). Added a `deploy/README.md` production runbook.

### Removed
- **BREAKING:** `ingest-worker` no longer reads the `NITRADO_SERVICE_ID` env var. Register servers by inserting their `nitrado_service_id` into the `servers` table (`active = true`); `.env.example` updated accordingly.

### Fixed
- Web: signing out now navigates home so the UI immediately reflects the logged-out state — previously the session cleared server-side but the account page stayed visually logged in.
- Auth: Discord sign-in forces `prompt=consent`, so it no longer silently authorizes with whatever Discord account is already active in the browser (Better Auth defaults Discord to `prompt=none`, which caused wrong-account logins).

## [0.1.0] - 2026-07-14

### Added
- **SP5 — RPT ingest + character mapping.** Attaches the actual in-game survivor (`SurvivorF_Helga` → "Helga") to each life (item 5). New pure `@onelife/rpt-parser` runs a login-correlation state machine over the DayZ RPT log — pending logins keyed by `dpnid`, class resolved from `Create entity type` / head-asset signals, `charID` always exact; a survivor roster in `@onelife/domain` (31 vanilla heads incl. `_2` variants). The `ingest-worker` gains an RPT poll pass (`rpt_files`, migration `0004`) that writes `character_sightings` + a `characters` rollup with charID inheritance (a reconnect with no model signal inherits the class of any sighting sharing its charId). A `getLifeCharacter` read-model joins sightings to a life by gamertag + time window (rebuild-safe), and the API life-detail response gains a `character` field. Device-based alt detection (Feature A) is permanently out (the `[MAM]` signal was removed in 1.29); web display of the character rides with the deferred stats dashboard.
- **SP4 — Unban-token economy.** A ledger-based token economy (`token_transactions` + `referrals`, migration `0003`; balance = SUM of deltas, grants exactly-once via idempotency keys). New `@onelife/tokens` package (balance, grant sweeps, redeem, transfer, set-referrer) powering: a token on each gamertag verification (13), monthly grants to verified players (14), setting a verified referrer (15) with a monthly token per referral (16), self-unban by redeeming a token (17), and token transfers between verified players (18). Redeeming flips the ban to `lift_pending` and spends the token instantly; the **enforcer** removes it from Nitrado on its next tick (so the `ENFORCER_DRY_RUN` gate still governs the write). New `apps/granter` loop runs the idempotent sweeps; `apps/api` gains session-gated wallet/redeem/transfer/referrer routes; the web account page gains a token wallet.
- **SP3 — Death-ban enforcement.** When a **qualified** life dies (>5 min playtime OR a PvP action, reusing `isLifeQualified`), the player is banned 24h on that server's Nitrado ban list. New `bans` table (migration `0002`), name-based ban-list methods on `@onelife/nitrado` (`getBans`/`addBan`/`removeBan` — whole-field replace of `settings.general.bans`), and a new `apps/enforcer` consumer that reconciles bans in three phases (detect qualified deaths → apply → auto-expire after 24h). **Actual Nitrado writes are gated behind `ENFORCER_DRY_RUN`, which defaults to `true` (log-only)** — real bans require explicitly setting it `false`. Every intended ban is recorded as a `bans` audit row even in dry-run.
- **SP2 — Auth + web + gamertag verification.** Added player identity: re-added the 6 auth/verification tables to the `db` schema (migration `0001`); ported `@onelife/auth` (Better Auth — Discord/Google/GitHub social + magic link), `@onelife/verification` (emote-sequence challenges), the `verifier` app (advances challenges from `emote.performed` events → marks gamertags verified), and the `api` app (Fastify core REST + Better Auth mount). Ported the `web` app as an auth-focused surface: login, account, the account/claim emote-verification UI, and a new minimal landing page — all news pages/routes/components and the stats dashboard were dropped. Verified: 15/15 packages typecheck + test, web production build green, and a live API smoke (server boots, `/api/auth/*` responds, core routes serve).
- **SP1 — Foundation + ADM ingest + lives.** Ported the multi-server DayZ ADM-log ingest stack from `one-life-platform` into this repo: monorepo skeleton (pnpm + turbo + Postgres/Drizzle), `@onelife/{db,domain,nitrado,adm-parser,event-log,projections,read-models,test-support}` and the `ingest-worker` + `projector` apps. Delivers log ingest → event log → life/player/session/kill projections + the qualified-lives read model. The news/LLM stack (generator, newsroom, openrouter) and the auth/verification schema were dropped; the DB schema is a clean 12-table core with a regenerated migration. Verified end-to-end on real production ADM logs (198 lines → 183 events → 3 players/3 lives/4 sessions) with all 143 ported tests green.

### Changed
### Deprecated
### Removed
### Fixed
### Security

## [1.0.1] - 2026-07-10

### Fixed
- Solo maintainer mode: back-merge PRs (`main`→`develop`) are no longer blocked by the contribution CHANGELOG/CLAUDE.md gate. The solo `gh-pr-create` check now parses `--head` and exempts `head == productionBranch`, mirroring the merge handler.

## [1.0.0] - 2026-07-10

### Added
- `soloMaintainer` mode: an opt-in `.claude/workflow.json` flag that enables a `solo` guard role holding the union of contributor + maintainer permissions, so one person can run the full workflow (feature work, contribution merge, release, back-merge) from a single clone without swapping git remotes. Protected branches stay PR-only and contribution merges into `develop` still require `--squash` + a posted review (a `COMMENTED` review counts). Off by default.
