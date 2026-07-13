---
name: starting-work
description: Use at the very start of any new feature or fix to create a correctly-based feature branch on your fork. Triggers on "start a feature", "begin work", "new branch", or before writing any implementation code in a fresh task.
---

# Starting Work

Prepares an isolated `feature/*` branch on your fork, synced with the canonical `develop`.

## Preconditions

- **Unless `soloMaintainer` is `true` in `.claude/workflow.json`:** you must be on a **fork** (the guard blocks feature commits on the canonical repo). If `git remote get-url origin` matches the canonical repo, stop and instruct the user to fork first with `gh repo fork <canonical> --clone`.
- **When `soloMaintainer` is `true`:** no fork is required. Work directly in the canonical clone (`origin` = canonical); the `solo` role permits `feature/*` commits in place. Skip the fork check and the `upstream` setup — `origin` already points at the canonical repo.
- The Superpowers plugin must be installed (write actions are blocked otherwise).

## Steps

1. Read `.claude/workflow.json` for `baseBranch` (default `develop`), `featurePrefix` (default `feature/`), and `soloMaintainer`.
2. If `soloMaintainer` is `true`, `origin` is the canonical repo — skip the `upstream` remote step. Otherwise, ensure an `upstream` remote points at the canonical repo: `git remote get-url upstream` — if missing, `git remote add upstream https://github.com/<canonicalRepo>.git`.
3. Fetch and sync the base: if `soloMaintainer` is `true`, `git fetch origin` then create the branch from the fresh base: `git checkout -b <featurePrefix><slug> origin/<baseBranch>`. Otherwise, `git fetch upstream` then create the branch from the fresh base: `git checkout -b <featurePrefix><slug> upstream/<baseBranch>`.
4. Choose `<slug>` as a short kebab-case summary of the work.
5. Confirm the branch is created and hand off to implementation (use superpowers:test-driven-development for the actual work).
