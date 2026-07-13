# Claude Code Project Template — Workflow Enforcement Design

**Date:** 2026-07-10
**Status:** Approved (pending spec review)

## Purpose

A GitHub **template repository** that establishes a disciplined, Claude-Code-native
contribution and release workflow for any project created from it. The workflow is
enforced **as much as possible through Claude Code itself** — deterministic hooks,
repo-level skills, and documentation — rather than through GitHub branch-protection
rules or CI/Actions.

The template is language/stack-agnostic. It governs *process* (branching, changelog,
review, release), not build tooling, though projects may optionally declare test/lint
commands so quality gates can be turned on later.

## The workflow being enforced

1. All feature work happens on a **fork**, in a `feature/*` branch.
2. Updating `CLAUDE.md` is the deliberate **last step** before opening a PR.
3. A full project **changelog** (`CHANGELOG.md`) is updated with every PR.
4. Forks PR into the canonical repo's **`develop`** branch.
5. **PR reviews are performed via Claude Code**; requested changes are posted back to
   the contributor as a PR review.
6. Approved reviews are **squash-merged** into `develop`.
7. When work is production-ready, a PR is opened from **`develop` → `main`** and reviewed.
8. When the `develop → main` PR merges, a **release is cut** with full release notes.

## Design decisions (locked during brainstorming)

- **Enforcement strength:** hard blocks via hooks (deterministic), not guidance-only.
- **Roles:** the template tools *both* contributor and maintainer sides.
- **Stack:** language-agnostic; optional per-project test/lint commands in config.
- **Changelog/versioning:** [Keep a Changelog](https://keepachangelog.com) format +
  [SemVer](https://semver.org). Version bumps are mostly automatic (patch applied without
  prompting); a minor or major bump surfaces a suggestion for maintainer confirmation.
- **Superpowers plugin:** required — missing plugin hard-blocks write/git actions.
- **Self-enforcement:** the owner is disciplined identically to contributors. Feature
  development is blocked on the canonical repo; the only reasons to be on the canonical
  repo are reviewing contributions or drafting a release.
- **Day-to-day workflow is delivered as repo-level skills**; hooks are the backstop.
- **Session orientation:** a role-aware "how-to" is shown when a session opens.

## Architecture overview

Three layers, in order of authority:

1. **Enforcement layer — hooks (deterministic, committed).** The only layer that can
   *block*. A `PreToolUse` guard on `Bash` inspects git/`gh` commands and denies
   violations. A `SessionStart` hook handles Superpowers detection + orientation.
2. **Workflow layer — repo-level skills (the happy path).** Streamlined procedures for
   every routine action. They guide and compose with Superpowers, but do not enforce —
   if skipped, the hooks still catch violations.
3. **Documentation/config layer.** `CLAUDE.md`, `CHANGELOG.md`, `CONTRIBUTING.md`,
   `README.md`, and `.claude/workflow.json` describe the workflow and parameterize it.

### Repository topology

- **Template repo** (this repo): what `Use this template` copies from.
- **Canonical project repo**: created from the template. Long-lived branches `develop`
  (integration) and `main` (production). Owned by the maintainer.
- **Contributor forks**: fork the canonical repo, work on `feature/*`, PR into
  `canonical:develop`.

Everything in `.claude/` and the root docs is committed, so it propagates through all
three levels automatically. **Enforcement config must live in committed
`.claude/settings.json`, never per-machine `settings.local.json`.**

### Role detection

`.claude/workflow.json` stores `canonicalRepo: "owner/name"`, stamped once by the
`workflow-setup` skill after a project is created (the template ships it blank).

The guard compares the `origin` remote slug to `canonicalRepo`:

- **`origin` == `canonicalRepo` → maintainer mode.**
- **`origin` != `canonicalRepo` → contributor mode.**
- **`canonicalRepo` blank → uninitialized template.** Guards run permissively and the
  orientation prompts the user to run `workflow-setup`.

This keys on repo identity, not user identity, so the owner is disciplined the same as
any contributor: to develop a feature the owner must fork (making `origin != canonical`).

## Enforcement layer — the guard hook

A single, dependency-free `PreToolUse` hook (Python, for reliable git parsing) inspects
`Bash` tool invocations. It denies with exit code 2 and a message Claude surfaces. It
**fails open** only when it genuinely cannot determine state (not a git repo, no
`gh`); it **fails closed** on the rules below.

### Superpowers gate (both roles)

Before any write/git action (`git commit`, `git push`, `gh pr create`), the guard globs
for a `*superpowers*` skill directory under the plugin cache
(`~/.claude/plugins/**`). If not found, it **blocks** with an install message. Read-only
exploration is unaffected.

Caveat (documented): detection is a filesystem heuristic; a false negative produces a
clear, self-explanatory message.

### Contributor mode (on a fork)

| Blocked action | Rule |
|---|---|
| `git commit` / `git push` on `main` or `develop` | Work happens on `feature/*` |
| `gh pr create` with base != `develop` | Forks PR into `develop` (#4) |
| `gh pr create` when `CHANGELOG.md` Unreleased is unchanged on this branch | Changelog updated every PR (#3) |
| `gh pr create` when `CLAUDE.md` was not changed on this branch | CLAUDE.md is the last step before a PR (#2) |

`gh pr create` is additionally normalized to target the canonical repo (`--repo <canonicalRepo> --base develop`).

### Maintainer mode (on the canonical repo)

| Blocked action | Rule |
|---|---|
| Creating / committing on a `feature/*` branch | Feature development belongs on a fork ("Fork the repo to develop features.") |
| Direct commit / push to `main` or `develop` | Protected; changes arrive via PR + release flow |
| `gh pr merge` that is not `--squash` | Approved reviews squash-merge into develop (#6) |
| `gh pr merge` of a PR without an approved review | Only approved reviews merge (#6) |

Allowed in maintainer mode: commits on `release/*` branches (release drafting), and the
review/merge/promote operations driven by the maintainer skills.

## Workflow layer — repo-level skills

Committed under `.claude/skills/<name>/SKILL.md`. Auto-trigger from natural language and
invokable by name. Skills streamline; hooks enforce.

**Contributor skills**

- **`starting-work`** — verify you are on a fork (block if on canonical), sync `develop`
  from upstream, create `feature/<slug>`.
- **`finishing-a-feature`** (flagship) — one streamlined pre-PR flow: run declared
  tests/lint (if any in `workflow.json`) → add the CHANGELOG Unreleased entry → update
  `CLAUDE.md` as the deliberate final step → open the PR into `canonical:develop`.
  Composes with Superpowers, delegating to `superpowers:requesting-code-review` and
  `superpowers:finishing-a-development-branch`.

**Maintainer skills**

- **`reviewing-a-contribution`** — check out the PR, review the diff via Claude, post the
  result back with `gh pr review --approve` / `--request-changes` (#5).
- **`merging-a-contribution`** — require an approved review, then `gh pr merge --squash`
  into `develop` (#6).
- **`drafting-a-release`** — create `release/x.y.z` off `develop`, compute the SemVer bump
  automatically from the Unreleased section, finalize the changelog (Unreleased → dated
  version), open the `release → main` PR (#7). **Bump policy:** patch bumps are applied
  automatically without prompting. When the content indicates a **minor** (new `Added`
  entries) or **major** (breaking changes, or a `Changed`/`Removed` entry flagged as
  breaking) bump, the skill *stops and surfaces a suggestion* — explaining the signal it
  found — and asks the maintainer to confirm before finalizing. So: mostly automatic, with
  a human checkpoint only when the version's leading digits would move.
- **`cutting-a-release`** — after the promotion PR merges, tag `vX.Y.Z` and run
  `gh release create` with notes generated from the finalized changelog section (#8).

**Setup skill**

- **`workflow-setup`** — one-time; stamp `canonicalRepo` (and confirm branch names) into
  `.claude/workflow.json`.

## Documentation & config layer

Shipped in the template:

- **`CLAUDE.md`** — documents the full workflow, names the skills, states the
  "update me last before every PR" convention, records the honest limits (below), and
  directs Claude to render the session orientation on a fresh session.
- **`CHANGELOG.md`** — seeded Keep a Changelog skeleton with an `Unreleased` section.
- **`CONTRIBUTING.md`** — human-readable fork → feature → develop flow and the
  Superpowers requirement.
- **`README.md`** — what the template is; the `workflow-setup` first step.
- **`.claude/workflow.json`** — `canonicalRepo`, protected branches, base branch, version
  scheme, optional `test`/`lint` commands.
- **`.claude/settings.json`** — committed `PreToolUse` guard hook + `SessionStart` hook.
- **`.claude/hooks/`** — the guard script and the session-start (Superpowers +
  orientation) script.

### Session orientation (SessionStart hook)

On session start the hook emits, as injected context, a role-aware "how-to":

- Detected role (Contributor / Maintainer) or "uninitialized — run `workflow-setup`".
- The next steps for that role (contributor: `starting-work` → build →
  `finishing-a-feature`; maintainer: review / merge / draft-release skills).
- Guardrails currently in effect (branch, changelog, CLAUDE.md, Superpowers).

`CLAUDE.md` instructs Claude to present this orientation at the start of a fresh session,
since SessionStart output is context rather than a UI banner.

## Honest limitations (stated in CLAUDE.md)

- **Hooks only bind inside Claude Code.** A contributor driving plain `git`/`gh` in a
  normal shell bypasses every guard. This is an accepted consequence of the
  "enforce through Claude Code, not GitHub" constraint.
- **Superpowers and role detection are heuristics** (filesystem glob; remote-slug
  comparison). They fail with clear, actionable messages rather than silently.
- **Approved-review detection for squash-merge** relies on `gh pr view` review state,
  which requires the canonical repo to be a real GitHub remote.

## Out of scope

- GitHub branch-protection rules, required status checks, or Actions/CI workflows.
- Language-specific build/test scaffolding (only optional command declarations).
- Auto-installing the Superpowers plugin (we block on its absence; we do not install it).

## Success criteria

- A project created from the template, after `workflow-setup`, blocks: committing on
  `main`/`develop`, opening a PR to the wrong base, opening a PR without a changelog or
  CLAUDE.md update, non-squash or unreviewed merges, feature work on the canonical repo,
  and any write/git action without Superpowers installed.
- The full lifecycle (start work → finish feature → review → merge → draft release → cut
  release) is achievable end-to-end via the repo skills.
- Opening a session in such a project shows a correct, role-aware orientation.
