# One Life

A community platform for DayZ servers built around a single rule: you get **one life**.

The platform ingests each server's logs, reconstructs every player's life from birth to death
across sessions, and enforces the consequence — when a qualified life ends, that player is banned
for 24 hours. They can earn their way back in early through emote verification and an unban-token
economy.

It also runs a newsroom. Every qualified death becomes an obituary and every qualified birth a
fresh-spawn notice, written in-voice and published to a public tabloid front page alongside
survivor leaderboards and per-player dossiers.

## Layout

A pnpm + turbo TypeScript monorepo on Postgres (Drizzle).

- **`apps/`** — `ingest-worker` (server logs → events), `projector` (events → projections),
  `api` (Fastify), `web` (Next.js), plus the background workers: `enforcer` (death bans),
  `verifier` (gamertag verification), `granter` (token grants), `newsdesk` (articles + images),
  `notifier` (player notifications), `rebooter` (scheduled server restarts).
- **`packages/`** — the domain core: log parsers, the event log, projections, read models, auth,
  and the token ledger.
- **`docs/superpowers/`** — design specs and implementation plans, one per sub-project.

`CLAUDE.md` is the detailed architectural record: what each sub-project does, and the invariants
that hold it together.

## Getting started

```bash
pnpm install
docker compose up -d postgres
pnpm turbo run test --concurrency=1   # DB suites need TEST_DATABASE_URL
pnpm turbo run typecheck
```

Copy `.env.example` for the full set of configuration and feature flags. Most background workers
default to a dry run — they log what they *would* do without writing to the game servers, Discord,
or a model provider — so read that file before enabling anything.

## Contributing

See `CONTRIBUTING.md`. The git lifecycle is managed by
[keel](https://github.com/submtd/shipyard), a Claude Code plugin declared in
`.claude/settings.json`; `.keel.json` is the source of truth for branch topology and merge rules.

## Deployment

`./deploy/deploy.sh` deploys the latest release tag. Releases that change projection-table shape
need `--rebuild`, which truncates and re-folds from the event log. See `deploy/README.md`.
