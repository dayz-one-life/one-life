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
