# Git workflow, Shipyard plugins, and honest limitations

Split out of `CLAUDE.md` (2026-07-29) to keep that file under its size budget. Nothing here
was edited in the move — it is the verbatim record.

## Workflow

This repo's git lifecycle is owned by **keel**, part of the
[Shipyard](https://github.com/submtd/shipyard) plugin suite, declared for all contributors in
`.claude/settings.json`. **`.keel.json` is the source of truth for the topology** — read it rather
than trusting a summary here, because a summary is how a committed copy drifts from the plugin.

Shorthand: work happens on `feature/*` off `main`; PRs into `main` are squash-merged; releases are
cut and tagged from `main`. `main` is the single long-lived branch (**trunk topology** — there is
no `develop`; it was retired 2026-07-23). Every contribution PR needs a `CHANGELOG.md` entry, and
this file is updated last, before opening the PR.

Skills, in lifecycle order: `keel:start-work` → `keel:finish-work`, then `keel:review`,
`keel:land`, `keel:release`, `keel:ship`. `keel:doctor` explains any block or warning. Under trunk
there is no `keel:release` step (no integration branch to accumulate on) — cut releases straight
from `main` with `keel:ship`.

**⚠️ `mergeStrategy.toProduction` MUST stay `"squash"`, not `"merge"`.** keel's merge-strategy
guard short-circuits under trunk (`rules.py`, the `and not cfg.is_trunk` clause): *every* PR into
`main` is judged against `toProduction`, and `toIntegration` is never consulted. Since every PR
here is a feature PR (releases are tags, not merges), setting `toProduction: "merge"` would force a
merge commit per feature and **block `gh pr merge --squash` outright**. `main` stays a clean
one-commit-per-feature history only while this is `squash`.

Also enabled: `stow` (`.gitignore`), `rigging` (CI), `hull` (secret scanning), and `bosun`
(Dependabot). Only `ballast` (pytest) stays off — there is no Python here. Every plugin's rendered
file is **generated output** — edit the `.<plugin>.json` config and re-render, never the artifact:

- **`rigging`** → `.rigging.json` + `.github/workflows/ci.yml`. A pnpm + turbo test job on **Node 24**
  with a **`postgres:16-alpine`** service (musl libc — matching dev and production's docker-compose
  image, **not** rigging's `postgres:16`/glibc default: the friends `friendships_ordered`
  constraint orders user ids by the DB collation, and glibc's locale collation sorts a `_` in a
  callsign differently from musl/C, red-failing a notifier test that shipped assuming ASCII order —
  CI must test the Postgres the app runs on); `services.postgres.database: "onelife_test"` makes
  rigging emit
  `TEST_DATABASE_URL=…/onelife_test`, which the `assertTestDatabase` `_test` guard requires (the
  harness self-creates + migrates that DB). Runs `pnpm install --frozen-lockfile` then
  **`pnpm run ci`** — `testCommand: ["pnpm","run","ci"]`, the root `turbo run typecheck test
  --concurrency=1` script. **⚠️ The custom `testCommand` must stay a `pnpm run` invocation, never a
  bare `turbo`**: a bare `turbo` has no `node_modules/.bin` on PATH in a `run:` step, which is why
  this was `pnpm test` with no `testCommand` at all until 2026-07-28. Going through `pnpm run`
  keeps `.bin` on PATH and closes the real gap — **CI never ran `typecheck`**, so every type-level
  guarantee in the repo (e.g. `buildsPlaced` being absent from `ObituaryFacts`) was enforced only
  on a contributor's machine. The local `pnpm test` stays tests-only. This is the repo's
  first real test CI. **Node 24, not the `engines.node >=20` floor:** vitest configs import
  `@onelife/test-support/setup-path` (a `.ts` file) that Vite's config loader resolves with a plain
  native `import()`, so the runtime must strip TS types itself — Node 20 throws
  `ERR_UNKNOWN_FILE_EXTENSION`, Node 22.18+/24 do not. The real test-runtime floor is above what
  `engines` declares.
- **`hull`** → `.hull.json` + `.github/workflows/security.yml`. Scanner is **`trufflehog`**, not
  gitleaks: this is an org-owned repo, and gitleaks-action hard-exits without a `GITLEAKS_LICENSE`
  org license; trufflehog needs no license and only `contents: read`, so it also runs on fork PRs.
- **`bosun`** → `.bosun.json` + `.github/dependabot.yml`. `github-actions` + `npm` ecosystems,
  weekly, `targetBranch: main` (read from `.keel.json` — under trunk topology `main` is the
  integration branch where the changelog gate runs, so Dependabot PRs target it directly).

The three previously-deferred plugins were unblocked by Shipyard 0.6.0–0.9.0 (issue #24 + the
`services.<id>.database` follow-up); see
`docs/superpowers/specs/2026-07-21-shipyard-plugins-design.md` §9 for the full history. keel's
changelog gate also runs in CI (`.github/workflows/changelog.yml`).

**⚠️ `.github/workflows/changelog.yml` and `scripts/check_changelog.py` are vendored verbatim** from
keel's own templates (`plugins/keel/templates/` in the Shipyard repo). They are not authored here.
Do not edit them in place — a local "improvement" silently forks them from upstream and is lost on
the next re-vendor. Fix the template in Shipyard, then re-copy both files.

**Contributors:** the plugins are declared in the repo, but each person approves a one-time install
prompt on their first session. See `CONTRIBUTING.md`.

## Honest limitations

- keel's guard is **advisory** and runs only inside Claude Code; plain `git`/`gh` in a terminal, or
  CI, bypasses it entirely. The real boundary is GitHub branch protection, **configured on `main`
  as of 2026-07-23** (`keel:protect`): PRs are required, and `node (24)` + `changelog` + `trufflehog`
  must pass before merge (`strict` — a PR must be up to date with `main` first). **Two deliberate
  gaps under `reviewPolicy: "review"`:** the required approving-review count is **`0`**, because
  GitHub forbids self-approval and understands only `APPROVED` (not `COMMENTED`), so requiring `1`
  would lock a solo maintainer out — the comment-review convention stays hook/practice-enforced, not
  server-side; and `enforce_admins=false`, which is what lets the maintainer merge their own
  commented PR but also means **an admin can still bypass with a direct push** (fork/non-admin
  contributors are fully bound).
- `protected-write` keys on branch **name**, not repository identity, so pushing to your own fork's
  `main` is refused. `keel:sync` rebases against `upstream/<base>` instead.
- keel has **no role concept** — fork and same-repo PRs are judged identically. A solo release PR
  satisfies `reviewPolicy: "review"` by posting a `COMMENTED` review on your own PR.
- **Trunk conversion (2026-07-23):** the repo ran gitflow (`feature/*` → `develop` → `main`) until
  this date, when it switched to trunk topology and retired `develop` (which was content-identical
  to `main` at the time). All history below that predates the switch and describes the old two-branch
  flow. Historically relevant: `main` and `develop` were originally independent orphan commits with
  no shared history, forcing a one-off `git rebase --onto` on every cross-branch PR through v0.1.0;
  after v0.1.0 `develop` was re-rooted onto `main` (reconciled 2026-07-14) and back-merge PRs no
  longer needed rebasing.
