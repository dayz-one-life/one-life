# Contributing

This repo's git lifecycle is managed by [keel](https://github.com/submtd/shipyard), a Claude Code
plugin. `.keel.json` at the repo root is the source of truth for branch topology and merge rules.

## First session

The plugins are declared in `.claude/settings.json`, so you don't need to add a marketplace or
install anything by hand. On your **first** Claude Code session in this repo you'll be prompted to
install the `shipyard` marketplace — approve it once and the plugins load automatically from then
on.

If you skip the prompt, the plugins simply don't load: you lose the guard and the skills, but
nothing breaks.

keel's hooks (and `scripts/check_changelog.py`, which its changelog CI gate runs) are invoked as
`python3 …`; without `python3` on `PATH` you lose the guard and the orientation with no error.

The canonical repo is `dayz-one-life/one-life`. If you fork by hand rather than through
`keel:start-work`, add it as your `upstream` remote so keel can find it.

## Flow

1. `keel:start-work` — creates a correctly-named `feature/*` branch off an up-to-date `develop`.
   It picks fork or same-repo based on your GitHub permissions.
2. Do the work, test-driven. Tests: `pnpm turbo run test --concurrency=1` (DB suites need
   `TEST_DATABASE_URL`). Typecheck: `pnpm turbo run typecheck`.
3. `keel:finish-work` — runs checks, updates the changelog, prompts for `CLAUDE.md` impact, and
   opens the PR against `develop`.
4. A maintainer reviews (`keel:review`). Address feedback and push; approved PRs are
   squash-merged (`keel:land`).

`keel:doctor` explains anything keel blocked or warned about. `keel:sync` brings a stale branch or
fork back up to date.

## Changelog

Every PR adds an entry under `Unreleased` in `CHANGELOG.md` (Keep a Changelog format). keel's
`changelog` rule enforces this on feature and hotfix PRs; release and back-merge PRs are exempt.

## A note on the guard

keel's `PreToolUse` hook is **advisory**. It catches honest mistakes — committing on a protected
branch, targeting the wrong base, merging with the wrong strategy — roughly 30 seconds before CI
would. It runs only inside Claude Code and is not a security control. It also keys protected
branches by *name*, so it will refuse a push to your own fork's `main`; use `keel:sync`.

## CI

The only CI is keel's changelog gate (`.github/workflows/changelog.yml`), which checks that a PR
adds a `CHANGELOG.md` entry. There is no test or build CI yet, so run the test and typecheck
commands locally before opening a PR. See
`docs/superpowers/specs/2026-07-21-shipyard-plugins-design.md` §9.
