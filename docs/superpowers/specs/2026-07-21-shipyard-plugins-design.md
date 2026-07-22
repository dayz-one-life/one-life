# Retire the template workflow; adopt Shipyard as a repo-level plugin suite

**Date:** 2026-07-21
**Status:** Approved, not yet implemented

## 1. Problem

This repo was created from a Claude Code workflow template. The template committed its
enforcement logic *into the repo it guards*: a `PreToolUse` hook, a `SessionStart` hook, a shared
`workflow_lib.py`, seven workflow skills, and a `workflow.json` config — roughly a thousand lines of
tooling that has nothing to do with DayZ, One Life, or any of the sub-projects this repo exists to
build.

Two structural problems follow from committing it rather than installing it:

- **A template repo never updates.** A fix authored upstream today cannot reach a repo created from
  the template last month. Every derived repo forks the logic permanently.
- **A guard that ships inside the repo it guards can disable itself.** The template's hook matches
  only `Bash`, so an `Edit` to its own source turns enforcement off.

`submtd/shipyard` is the rewrite of exactly this pattern as a plugin suite — its README says so
directly. Adopting it moves the logic outside the repo, where it updates centrally, and leaves
behind only small committed config files describing the topology we want.

## 2. Goal

Remove the committed template workflow and replace it with Shipyard, declared at the **repository**
level in `.claude/settings.json` so every contributor picks it up from a clone rather than running
`/plugin marketplace add` and `/plugin install` by hand.

## 3. Scope

Five of Shipyard's six plugins:

| Plugin | Owns | Config | Renders |
|---|---|---|---|
| `keel` | git lifecycle | `.keel.json` | lifecycle artifacts + a `PreToolUse` guard |
| `rigging` | CI pipelines | `.rigging.json` | `.github/workflows/ci.yml` |
| `stow` | baseline repo files | `.stow.json` | `.gitignore` (managed blocks) |
| `hull` | secret scanning | `.hull.json` | `.github/workflows/security.yml` |
| `bosun` | dependency updates | `.bosun.json` | `.github/dependabot.yml` |

**`ballast` is deliberately excluded.** It renders `pytest.ini`; this is a TypeScript/pnpm
monorepo with no Python. Adopting it would commit a config for a runner that never runs.

## 4. What gets removed

| Path | Replaced by |
|---|---|
| `.claude/hooks/guard.py` | keel's plugin-side `PreToolUse` guard |
| `.claude/hooks/session_start.py` | keel's plugin-side `SessionStart` orientation |
| `.claude/hooks/workflow_lib.py` | (internal to the above) |
| `.claude/hooks/tests/` | keel's own test suite, upstream |
| `.claude/workflow.json` | `.keel.json` |
| `.claude/skills/starting-work` | `keel:start-work` |
| `.claude/skills/finishing-a-feature` | `keel:finish-work` |
| `.claude/skills/reviewing-a-contribution` | `keel:review` |
| `.claude/skills/merging-a-contribution` | `keel:land` |
| `.claude/skills/drafting-a-release` | `keel:release` |
| `.claude/skills/cutting-a-release` | `keel:ship` |
| `.claude/skills/workflow-setup` | `keel:init` |
| `CLAUDE.md` lines 1–52 (through the `---`) | §7 below |

### 4.1 Two things that must survive the deletion

**`.claude/skills/drafting-an-article` is NOT a template skill.** It is this project's editorial
newsroom ritual — it drives the `newsroom` CLI, reads the brand bible, and is referenced by the
Editorial newsroom sub-project in `CLAUDE.md`. It sits in the same directory as the seven template
skills and is easy to delete by accident. It stays.

**The "Orphan roots (reconciled 2026-07-14)" note is project git history, not template
boilerplate.** It records that `main` and `develop` began as independent orphan commits and were
re-rooted after v0.1.0, which is why cross-branch PRs no longer need a `git rebase --onto`. It
currently lives inside the template preamble being deleted. It moves into the surviving One Life
section of `CLAUDE.md`.

## 5. What replaces it

### 5.1 `.claude/settings.json`

Rewritten from a hooks registration into a plugin declaration. Both keys are top-level and are the
documented mechanism for team-shared plugins:

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
    "rigging@shipyard": true,
    "hull@shipyard": true,
    "stow@shipyard": true,
    "bosun@shipyard": true
  }
}
```

`autoUpdate: true` is what buys the central-update property that motivated the whole change; without
it a contributor's cached copy pins at whatever commit they first installed.

### 5.2 `.keel.json`

A direct translation of the retired `workflow.json`:

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

Every field maps 1:1 onto current behaviour: feature branches into `develop` squashed, releases into
`main` merged, a changelog entry required on every contribution PR.

### 5.3 The four generated configs

`.rigging.json`, `.hull.json`, `.stow.json`, and `.bosun.json` are scaffolded by each plugin's
`init` skill, which never overwrites an existing file. Their rendered artifacts
(`ci.yml`, `security.yml`, `.gitignore` blocks, `dependabot.yml`) are **generated output** — edit
the config and re-render, never the artifact.

## 6. `soloMaintainer` has no equivalent, and that is intentional

The template's `soloMaintainer: true` synthesised a `solo` role holding the union of contributor and
maintainer permissions, and exempted the maintainer's own release and back-merge PRs from the
changelog and review gates.

**keel has no role concept at all.** It does not infer contributor/maintainer/solo from remote URLs;
capability comes from GitHub (`gh repo view --json viewerPermission`), and fork and same-repo PRs
are judged identically. That is a deliberate design property — it is what stops a maintainer's own
same-repo PR from quietly skipping the review gate.

Consequences for this repo, accepted:

- Under `reviewPolicy: "review"`, a merge needs a posted review in state `APPROVED` **or**
  `COMMENTED`. GitHub forbids self-approval, so a solo release PR is satisfied by posting a
  `COMMENTED` review on your own PR — the same workaround the template already depended on.
- keel's `changelog` rule already exempts release and back-merge PRs under gitflow, so that half of
  the old `soloMaintainer` exemption is preserved for free.
- `reviewPolicy: "approval"` was rejected: it would hard-block every solo release. `"none"` was
  rejected: keel cannot tell a contributor PR from your own, so it would drop the gate for everyone.

## 7. `CLAUDE.md` and `CONTRIBUTING.md`

`CLAUDE.md`'s first 52 lines are template preamble and are removed wholesale, except the orphan-roots
note (§4.1). A short replacement section states that the repo's lifecycle is owned by keel, points at
`.keel.json` as the source of truth, and names the plugins in use — deliberately *without*
restating keel's rules, since restating them is how the committed copy drifts from the plugin.

`CONTRIBUTING.md` is rewritten in the same PR. Leaving it would document seven skills that no longer
exist and continue to claim the Superpowers plugin is mandatory — a template guard keel does not
have. The rewrite covers: the one-time plugin install prompt (§8), `keel:start-work` →
`keel:finish-work`, and the changelog requirement.

## 8. Honest limitations

- **Contributors get a one-time install prompt.** As of Claude Code v2.1.195, a plugin that only the
  project's `.claude/settings.json` enables, sourced externally, does not load until that contributor
  installs it. This is one approval instead of two manual commands — not zero-touch, and not silent.
  It must be documented in `CONTRIBUTING.md` rather than discovered.
- **keel's guard is advisory, not a security control.** It runs only inside Claude Code; plain
  `git`/`gh` in a terminal, or CI, bypasses it entirely. It does not parse `bash -c`, `eval`,
  subshells, or command substitution — deliberately, because the predecessor tried and a review found
  ~20 verified evasions alongside false positives. The real boundary is GitHub branch protection,
  configured via `keel:protect`. That is out of scope here and is worth its own pass.
- **`protected-write` keys on branch name, not repository identity.** It blocks a push to any branch
  named `main` or `develop` regardless of which repo it belongs to, so pushing to your *own fork's*
  `main` is denied. `keel:sync` works around this by rebasing against `upstream/<base>`.
- **Repo scope beats user scope.** Shipyard is currently installed at user scope on the maintainer's
  machine. Project settings take precedence over user settings, so the repo-level declaration wins
  where they disagree. The user-scope install can stay; it is not a conflict.

## 9. CI is the risky half

`rigging` detects a "node" repo and renders a generic `ci.yml`. This repo is not generic: it is a
pnpm + turbo monorepo whose DB suites require a live Postgres via `TEST_DATABASE_URL` and whose
documented test command is `pnpm turbo run test --concurrency=1`. A stock render will very likely go
red on the first PR, and this repo has **no `.github/` directory at all** today — so this introduces
CI where none existed, rather than swapping one config for another.

The agreed approach is to verify rather than assume: render, push the branch, watch the actual run,
and tune `.rigging.json` (Postgres service, `TEST_DATABASE_URL`, concurrency) until it is green
**before** the PR lands. A red gate merged "to fix later" is worse than no gate, because keel's
changelog gate lands beside it and the two become indistinguishable when something fails.

This section is expected to be the majority of the implementation effort and nearly all of its risk.
Splitting CI into a follow-up PR was offered and declined; if verification proves long, that split
remains the escape hatch.

## 10. Sequencing

The template's `guard.py` is registered as a live `PreToolUse` Bash hook **for the duration of the
current session**. Deleting the file mid-session leaves the registration pointing at a missing
script, which can fail every subsequent `Bash` call and strand the work.

Therefore:

1. Create the feature branch and complete all git operations that need a working shell.
2. Write configs and documentation.
3. Delete the hook files, skills, and `workflow.json` **last**.
4. Restart the Claude Code session to load the new plugin-based configuration.
5. Verify orientation and the guard come from keel, then push and open the PR.

## 11. Success criteria

- A fresh session in this repo shows keel's orientation, not the template's.
- `.claude/` contains only `settings.json` and `skills/drafting-an-article`.
- `git commit` on `main` is refused by `[keel/protected-write]`.
- `CI` is green on the feature branch before the PR is opened.
- `CHANGELOG.md` and `CLAUDE.md` are updated, and the PR targets `develop`.
