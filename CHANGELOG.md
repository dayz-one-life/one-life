# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
