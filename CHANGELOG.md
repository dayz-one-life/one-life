# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
