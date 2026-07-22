# Shipyard Plugin Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the committed template workflow (hooks, seven skills, `workflow.json`) and replace it with the `submtd/shipyard` plugin suite — `keel`, `stow`, `hull`, `bosun` — declared at repository level so every contributor picks it up from a clone.

**Architecture:** The lifecycle logic moves out of the repo and into plugins that update centrally. What stays committed is four small config files (`.keel.json`, `.stow.json`, `.hull.json`, `.bosun.json`) plus a `.claude/settings.json` that declares the marketplace and enables the plugins. Deletion of the old hooks happens **last**, because the retired `guard.py` is a live `PreToolUse` hook for the current session.

**Tech Stack:** Claude Code plugins (`extraKnownMarketplaces` / `enabledPlugins`), JSON config, GitHub Actions (gitleaks only), Dependabot.

**Spec:** `docs/superpowers/specs/2026-07-21-shipyard-plugins-design.md`

## Global Constraints

- **This change touches no application code.** No file under `apps/`, `packages/`, or `deploy/` is modified. Any test or typecheck failure is a regression caused by the removals, not a pre-existing condition to work around.
- **There is no TDD cycle here.** The deliverables are config and documentation. Each task ends in an explicit verification command with expected output instead of a failing-test-first step. Do not invent unit tests for JSON config files.
- **`.claude/skills/drafting-an-article` MUST survive.** It is this project's editorial newsroom skill, not a template skill, and it sits in the same directory as the seven being deleted.
- **`rigging` is NOT adopted.** Do not run `rigging:init`, do not create `.rigging.json`, do not create `.github/workflows/ci.yml`. Reason: spec §9.
- **`ballast` is NOT adopted.** It renders `pytest.ini`; there is no Python here.
- **Generated artifacts are never hand-edited.** `security.yml`, `dependabot.yml`, and `.gitignore` managed blocks are rendered from their configs. Edit the config and re-render.
- **Branch:** `feature/shipyard-plugins`, already created off `upstream/develop`, with the spec committed at `b4b7493`.
- **PR target:** `develop`. Merge strategy: squash.

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `.claude/settings.json` | Rewrite | Declares the shipyard marketplace + enables 4 plugins |
| `.keel.json` | Create | Git lifecycle topology |
| `.stow.json` | Create | Which stacks' `.gitignore` blocks to manage |
| `.hull.json` | Create | Secret-scanner selection |
| `.bosun.json` | Create | Dependabot ecosystems |
| `.github/workflows/security.yml` | Create (rendered) | gitleaks scan |
| `.github/dependabot.yml` | Create (rendered) | Dependency updates |
| `.gitignore` | Modify | Gains stow-managed blocks |
| `CLAUDE.md` | Modify (lines 1–52) | Template preamble → keel pointer |
| `CONTRIBUTING.md` | Rewrite | Contributor flow under keel |
| `CHANGELOG.md` | Modify | Unreleased entry |
| `.claude/hooks/` | Delete | Replaced by keel's plugin-side hooks |
| `.claude/workflow.json` | Delete | Replaced by `.keel.json` |
| `.claude/skills/` (7 dirs) | Delete | Replaced by keel's 11 skills |

---

### Task 1: Scaffold the four shipyard configs and their artifacts

**Files:**
- Create: `.keel.json`, `.stow.json`, `.hull.json`, `.bosun.json`
- Create: `.github/workflows/security.yml`, `.github/dependabot.yml`
- Modify: `.gitignore`

**Interfaces:**
- Produces: the four committed config files that Task 2's plugin declaration gives meaning to. No later task reads their contents programmatically.

The `init` skills are already available in this session at user scope, so they can run before the repo-level declaration exists.

- [ ] **Step 1: Write `.keel.json` by hand**

`keel:init` is interactive and detects defaults; this repo's topology is already known exactly, so write the file directly. It is a 1:1 translation of the retired `workflow.json`.

```json
{
  "topology": "gitflow",
  "branches": { "production": "main", "integration": "develop" },
  "prefixes": { "feature": "feature/", "release": "release/" },
  "contributions": "both",
  "reviewPolicy": "review",
  "mergeStrategy": { "toIntegration": "squash", "toProduction": "merge" },
  "requireChangelog": true
}
```

- [ ] **Step 2: Verify keel accepts it**

Run: `python3 -c "import json;print(json.load(open('.keel.json'))['topology'])"`
Expected: `gitflow`

A malformed `.keel.json` raises loudly rather than silently allowing everything, so a parse failure here would surface as a hard error after the session restart in Task 5.

- [ ] **Step 3: Run `stow:init` for the node stack**

Invoke the `stow:init` skill. It should detect `package.json` → the `node` stack, write `.stow.json`, and splice managed blocks into the existing `.gitignore` **without clobbering** the hand-written lines already there (`data/`, `/*.ADM`, `/*.RPT`, `/*.sql`, `docker-compose.override.yml`, and the rest).

Expected `.stow.json`:

```json
{"stacks": {"node": {}}}
```

- [ ] **Step 4: Verify no hand-written `.gitignore` lines were lost**

Run:
```bash
for p in 'data/' '/\*.ADM' '/\*.RPT' '/\*.sql' 'docker-compose.override.yml' '.superpowers/' 'scratchpad/'; do
  grep -q -- "$p" .gitignore || echo "LOST: $p"
done; echo "check complete"
```
Expected: `check complete` with no `LOST:` lines.

If anything was lost, restore it by hand — stow's managed blocks are delimited, and user lines live outside them.

- [ ] **Step 5: Run `hull:init`**

Invoke the `hull:init` skill. It writes `.hull.json` and renders `.github/workflows/security.yml` (an injection-safe gitleaks scan, stack-agnostic). This creates the repo's first `.github/` directory.

Expected `.hull.json`:

```json
{
  "name": "security",
  "scanner": "gitleaks"
}
```

Set `pushBranches` to `["main", "develop"]` if hull prompts for it — this repo has a `develop` line, and the default (`["main"]`) would leave `develop` pushes unscanned.

- [ ] **Step 6: Run `bosun:init`**

Invoke the `bosun:init` skill. `githubActions` is always on (the repo now pins action refs via `security.yml`); it should also detect npm from `package.json`. Renders `.github/dependabot.yml`.

- [ ] **Step 7: Verify both artifacts rendered**

Run: `ls -la .github/workflows/security.yml .github/dependabot.yml`
Expected: both files listed, non-zero size.

Sanity-check the gitleaks job is actually present:

Run: `grep -c "gitleaks" .github/workflows/security.yml`
Expected: at least `1`.

Then confirm no CI workflow was created:

Run: `ls .github/workflows/`
Expected: `security.yml` only. **If `ci.yml` exists, delete it** — rigging is out of scope (Global Constraints).

- [ ] **Step 8: Commit**

```bash
git add .keel.json .stow.json .hull.json .bosun.json .gitignore .github/
git commit -m "chore: scaffold shipyard configs (keel, stow, hull, bosun)"
```

---

### Task 2: Declare the plugins at repository level

**Files:**
- Modify: `.claude/settings.json` (full rewrite)

**Interfaces:**
- Consumes: the config files from Task 1.
- Produces: the declaration that makes keel's hooks live after the Task 5 restart.

- [ ] **Step 1: Replace `.claude/settings.json` entirely**

The current file registers the template's two hooks. It is replaced — not extended — because those hooks are deleted in Task 4.

```json
{
  "extraKnownMarketplaces": {
    "shipyard": {
      "source": { "source": "github", "repo": "submtd/shipyard" },
      "autoUpdate": true
    }
  },
  "enabledPlugins": {
    "keel@shipyard": true,
    "stow@shipyard": true,
    "hull@shipyard": true,
    "bosun@shipyard": true
  }
}
```

`autoUpdate: true` is load-bearing: without it each contributor's cached copy pins at whatever commit they first installed, which reintroduces the exact "never updates" problem that motivated moving off the template.

Note there is **no `hooks` key**. keel's `PreToolUse` guard and `SessionStart` orientation ship inside the plugin (`plugins/keel/hooks/hooks.json`) and need no registration here.

- [ ] **Step 2: Verify it parses and enables exactly four plugins**

Run:
```bash
python3 -c "
import json; s=json.load(open('.claude/settings.json'))
print(sorted(s['enabledPlugins']))
print('marketplace:', s['extraKnownMarketplaces']['shipyard']['source']['repo'])
print('hooks key present:', 'hooks' in s)
"
```
Expected:
```
['bosun@shipyard', 'hull@shipyard', 'keel@shipyard', 'stow@shipyard']
marketplace: submtd/shipyard
hooks key present: False
```

- [ ] **Step 3: Commit**

```bash
git add .claude/settings.json
git commit -m "chore: declare shipyard plugins at repo level"
```

---

### Task 3: Rewrite the documentation

**Files:**
- Modify: `CLAUDE.md` lines 1–52 (everything through the `---` separator)
- Rewrite: `CONTRIBUTING.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Replace the `CLAUDE.md` template preamble**

Delete lines 1 through 52 (up to and including the `---` separator line) and put this in their place. **Everything after that `---` is One Life project content and must be left untouched.**

```markdown
# CLAUDE.md

## Workflow

This repo's git lifecycle is owned by **keel**, part of the
[Shipyard](https://github.com/submtd/shipyard) plugin suite, declared for all contributors in
`.claude/settings.json`. **`.keel.json` is the source of truth for the topology** — read it rather
than trusting a summary here, because a summary is how a committed copy drifts from the plugin.

Shorthand: work happens on `feature/*` off `develop`; PRs into `develop` are squash-merged;
releases go `develop` → `main`. Every contribution PR needs a `CHANGELOG.md` entry, and this file
is updated last, before opening the PR.

Skills, in lifecycle order: `keel:start-work` → `keel:finish-work`, then `keel:review`,
`keel:land`, `keel:release`, `keel:ship`. `keel:doctor` explains any block or warning.

Also enabled: `stow` (`.gitignore`), `hull` (secret scanning), `bosun` (Dependabot). Their rendered
artifacts are **generated output** — edit the `.<plugin>.json` config and re-render, never the
artifact.

**`rigging` (CI) is deliberately not enabled.** It cannot express pnpm, service containers, or a
custom test command, so this repo has no CI workflow — see
`docs/superpowers/specs/2026-07-21-shipyard-plugins-design.md` §9 for the full reasoning and the
two open paths.

**Contributors:** the plugins are declared in the repo, but each person approves a one-time install
prompt on their first session. See `CONTRIBUTING.md`.

## Honest limitations

- keel's guard is **advisory** and runs only inside Claude Code; plain `git`/`gh` in a terminal, or
  CI, bypasses it entirely. The real boundary is GitHub branch protection (`keel:protect`), which is
  not configured for this repo yet.
- `protected-write` keys on branch **name**, not repository identity, so pushing to your own fork's
  `main` is refused. `keel:sync` rebases against `upstream/<base>` instead.
- keel has **no role concept** — fork and same-repo PRs are judged identically. A solo release PR
  satisfies `reviewPolicy: "review"` by posting a `COMMENTED` review on your own PR.
- **Orphan roots (reconciled 2026-07-14):** `main` and `develop` were originally created as
  independent orphan commits with no shared history, which forced a one-off `git rebase --onto` on
  every cross-branch PR through the v0.1.0 release. After v0.1.0, `develop` was re-rooted onto
  `main` so they now share history — feature→`develop`, release→`main`, and `main`→`develop`
  back-merge PRs no longer need any rebasing.

---
```

- [ ] **Step 2: Verify the One Life content survived intact**

Run: `grep -c "" CLAUDE.md && grep -n "^# One Life MVP" CLAUDE.md && grep -c "SP1 — Foundation" CLAUDE.md`
Expected: a line count near 960, one match for `# One Life MVP`, and `1` for the SP1 line.

Run: `grep -c "Orphan roots" CLAUDE.md`
Expected: `1` — the note was preserved, not dropped with the preamble.

- [ ] **Step 3: Rewrite `CONTRIBUTING.md` in full**

The current file names seven deleted skills and claims Superpowers is mandatory (a template guard keel does not have). Replace the whole file:

```markdown
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

There is none yet, deliberately. See
`docs/superpowers/specs/2026-07-21-shipyard-plugins-design.md` §9.
```

- [ ] **Step 4: Add the changelog entry**

Under the `Unreleased` heading in `CHANGELOG.md`, add (creating `### Changed` / `### Removed` subsections if absent, matching the file's existing Keep a Changelog style):

```markdown
### Changed

- Replaced the committed workflow template (hooks, seven workflow skills, `workflow.json`) with the
  [Shipyard](https://github.com/submtd/shipyard) plugin suite — `keel`, `stow`, `hull`, `bosun` —
  declared at repository level in `.claude/settings.json` so the lifecycle logic lives outside the
  repo it guards and updates centrally. `.keel.json` is now the source of truth for branch topology.
  `rigging` (CI) was evaluated and excluded: it cannot express pnpm, service containers, or a custom
  test command. Contributors approve a one-time plugin install prompt on their first session.

### Removed

- `.claude/hooks/` (`guard.py`, `session_start.py`, `workflow_lib.py`, and their tests),
  `.claude/workflow.json`, and the seven template workflow skills. The project's own
  `drafting-an-article` skill is unaffected.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md CONTRIBUTING.md CHANGELOG.md
git commit -m "docs: document the keel-owned lifecycle, retire template docs"
```

---

### Task 4: Remove the template workflow

**Files:**
- Delete: `.claude/hooks/` (entire directory)
- Delete: `.claude/workflow.json`
- Delete: 7 directories under `.claude/skills/`

**Interfaces:**
- Consumes: Task 2's settings rewrite must already be committed, so that nothing references the deleted hooks.

**This task is last on purpose.** `guard.py` is registered as a live `PreToolUse` Bash hook for the current session; once it is deleted, the registration points at a missing script and subsequent `Bash` calls may fail. Expect this. It is resolved by the restart in Task 5, not by repairing anything.

- [ ] **Step 1: Confirm the deletion list before deleting**

Run: `ls .claude/skills/`
Expected exactly:
```
cutting-a-release
drafting-a-release
drafting-an-article
finishing-a-feature
merging-a-contribution
reviewing-a-contribution
starting-work
workflow-setup
```

`drafting-an-article` is in that list and is **NOT** to be deleted.

- [ ] **Step 2: Delete the seven template skills, the hooks, and workflow.json**

```bash
git rm -r -q \
  .claude/hooks \
  .claude/workflow.json \
  .claude/skills/cutting-a-release \
  .claude/skills/drafting-a-release \
  .claude/skills/finishing-a-feature \
  .claude/skills/merging-a-contribution \
  .claude/skills/reviewing-a-contribution \
  .claude/skills/starting-work \
  .claude/skills/workflow-setup
```

- [ ] **Step 3: Verify what remains**

Run: `find .claude -type f -not -path '*/.git/*' | sort`
Expected exactly:
```
.claude/settings.json
.claude/skills/drafting-an-article/SKILL.md
```
(plus any additional files belonging to `drafting-an-article` itself).

If `.claude/hooks` or `workflow.json` still appear, the `git rm` did not complete.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove the committed template workflow"
```

If this `git commit` fails because the deleted hook can no longer be executed, that is the expected condition described above. Proceed to Task 5 and commit after the restart.

---

### Task 5: Verify under the new configuration and open the PR

**Files:** none modified.

**Interfaces:**
- Consumes: all prior tasks committed.

- [ ] **Step 1: Restart the Claude Code session**

Required. Plugin enablement and hook registration are read at session start; the current session still holds the deleted template hooks. Tell the user to restart, and on the first session in the repo, approve the `shipyard` marketplace install prompt.

- [ ] **Step 2: Verify keel is live**

The session-start orientation should now come from keel and state the topology. Expected shape:

```
This repository uses keel for its git lifecycle.
- Topology: gitflow (feature/* -> PR -> develop -> release/* -> PR -> main)
- Protected: develop, main (changes reach them via PR)
- Review policy: review
- Current branch: feature/shipyard-plugins
```

If the orientation is absent, the marketplace prompt was declined or `.keel.json` failed to parse. Run `keel:doctor`.

- [ ] **Step 3: Verify the guard actually guards**

Confirm the replacement enforcement works before trusting it. From the feature branch:

Run: `git checkout main && git commit --allow-empty -m "probe"`
Expected: refused with a message containing `[keel/protected-write]`.

Then: `git checkout feature/shipyard-plugins`

If the commit **succeeds**, keel is not loaded — stop and diagnose with `keel:doctor` rather than opening the PR. If an empty commit did land on `main`, remove it with `git reset --hard HEAD~1` while still on `main`.

- [ ] **Step 4: Verify no application regression**

Run: `pnpm turbo run typecheck`
Expected: all packages pass.

Run: `pnpm turbo run test --concurrency=1`
Expected: all suites pass (requires `TEST_DATABASE_URL`; local Postgres via `docker compose up -d postgres`, and note a gitignored `docker-compose.override.yml` may remap the host port).

This change touches no application code, so any failure here is a regression from the removals and must be investigated, not accepted.

- [ ] **Step 5: Open the PR with `keel:finish-work`**

Invoke `keel:finish-work` — dogfooding the new tooling on the change that installs it. It should verify the changelog entry exists, prompt for `CLAUDE.md` impact (already handled in Task 3), and open the PR against `develop`.

Confirm the PR targets `develop`, not `main`.

- [ ] **Step 6: Watch the security workflow's first run**

`security.yml` has never executed — opening the PR is its first run, and a secret scanner firing on
a repo's full history for the first time can surface findings.

Run: `gh run list --branch feature/shipyard-plugins --limit 5`

Then: `gh run watch <run-id>` (or `gh run view <run-id> --log-failed` if it fails).

Expected: the `security` workflow concludes `success`.

If gitleaks reports findings, do **not** merge past them and do **not** silence the scanner. Triage
each: a true positive means a credential is in git history and needs rotating plus a follow-up issue;
a false positive is resolved by configuring an allowlist through `.hull.json` and re-rendering — never
by hand-editing `security.yml`, which is generated output.

---

## Post-merge follow-ups (not part of this plan)

- **GitHub branch protection** via `keel:protect`. keel's hook is advisory; this is the real
  boundary, and it is currently unconfigured.
- **CI.** Either extend rigging's registry upstream in `submtd/shipyard` with a pnpm stack and
  service-container support, or hand-write a pnpm + Postgres workflow. Spec §9 records both paths.
- **Remove the user-scope shipyard install** if desired. Project scope wins where they disagree, so
  it is harmless to leave.
