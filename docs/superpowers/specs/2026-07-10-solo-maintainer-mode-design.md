# Solo Maintainer Mode — Design

**Date:** 2026-07-10
**Status:** Approved (design)

## Problem

The workflow guard (`.claude/hooks/guard.py`) assumes contributor and maintainer are
different people. `detect_role` is binary:

```
origin == canonicalRepo → "maintainer"   else → "contributor"
```

A solo operator who is *both* the fork owner and the canonical repo admin hits two frictions:

1. **Self-approval is impossible.** GitHub forbids approving your own PR, so the maintainer
   merge gate (`pr_approved == "APPROVED"`) can never be satisfied for a self-authored fork
   PR. Merges only succeed by dropping into contributor mode, where the guard defers to
   GitHub permissions.
2. **Constant remote-swapping.** Maintainer steps (release PR into `main`, tag, back-merge)
   require `origin = canonical`; contributor steps (feature work, PR into `develop`) require
   `origin = fork`. A single release cycle forces swapping `origin` back and forth several
   times.

## Goal

Let one person run the entire workflow — feature work, contribution merge, release, back-merge
— from a single clone without swapping remotes, while preserving the structural guardrails
(no direct writes to protected branches, feature work on branches, squash + review for
contributions).

## Non-goals

- Changing behavior for real multi-person teams. The relaxation is strictly opt-in and leaves
  the `contributor` and `maintainer` code paths untouched.
- Automatic detection of "solo" from git state. Relaxation requires an explicit config flag.

## Design

### A third role: `solo`

A new config flag `soloMaintainer` (default `false`) in `.claude/workflow.json`. When set,
`detect_role` returns a new `"solo"` role regardless of which remote is `origin`. The `solo`
role holds the **union** of contributor + maintainer permissions.

What stays enforced under `solo`:

- No direct commits/pushes/merges to protected branches (`main`/`develop`) — PR-only.
- Feature work allowed on `feature/*` (and any non-protected branch).
- Release work (`release/*` pushes, `base=main` PRs, tag pushes) allowed — no remote swap.
- Contribution merges into `develop` still require `--squash` **and** a posted review
  (a `COMMENTED` review counts, since self-`APPROVED` is impossible).
- Same-repo maintainer PRs (release into `main`, back-merge into `develop`) merge freely.

### Code changes

**`.claude/workflow.json`** — new opt-in key, default off:

```json
"soloMaintainer": false
```

**`.claude/hooks/workflow_lib.py`** — `detect_role` learns the flag:

```python
def detect_role(origin_slug_value, canonical, solo=False):
    if not canonical:
        return "uninitialized"
    if solo:
        return "solo"
    if origin_slug_value == canonical:
        return "maintainer"
    return "contributor"
```

**`.claude/hooks/guard.py`**

1. `gather_context` reads `productionBranch` from config, passes `soloMaintainer` into
   `detect_role`, and — for `gh-pr-merge` actions only — computes new PR signals alongside
   the existing `pr_approved`:
   - `pr_reviewed(num)` → `True` if the PR has a review with state `APPROVED` or `COMMENTED`,
     and `reviewDecision != "CHANGES_REQUESTED"`.
   - `pr_base(num)` → the PR's base branch name.
   - `pr_head(num)` → the PR's head branch name.

2. New `role == "solo"` branch in `evaluate()`:

```python
if role == "solo":
    if kind in ("git-commit", "git-push", "git-merge"):
        if branch in protected:
            return False, f"Blocked: '{branch}' is protected. Changes reach it via PR."
        return True, ""                          # feature/*, release/*, topic branches OK
    if kind == "gh-pr-create":
        base = action.get("base")
        if base == production_branch:            # release PR into main
            return True, ""
        if base == base_branch:                  # contribution into develop
            if not ctx["changelog_changed"]:
                return False, "Blocked: update CHANGELOG.md (Unreleased) before opening a PR."
            if not ctx["claudemd_changed"]:
                return False, "Blocked: updating CLAUDE.md is the last step before a PR."
            return True, ""
        return False, f"Blocked: PR into '{base_branch}' or '{production_branch}'."
    if kind == "gh-pr-merge":
        base, head = ctx.get("pr_base"), ctx.get("pr_head")
        if base == production_branch:            # release → main
            return True, ""
        if base == base_branch and head == production_branch:
            return True, ""                      # back-merge main → develop
        if base == base_branch:                  # contribution → develop
            if action.get("is_squash") is not True:
                return False, "Blocked: merge contributions into develop with --squash."
            if ctx.get("pr_reviewed") is not True:
                return False, "Blocked: post a review first (a COMMENTED review satisfies solo mode)."
            return True, ""
        return True, ""
    return True, ""
```

3. The existing `contributor` and `maintainer` branches are unchanged.

### Why key merges on base + head (not `isCrossRepository`)

Keying the "is this a contribution?" test on branch names is remote-agnostic, so it is correct
whether the user runs from a fork clone (contribution PR is cross-repo) or a canonical clone
(contribution PR is same-repo). It also closes a gap: a same-repo `feature → develop` PR from a
canonical clone still correctly requires squash + review, which an `isCrossRepository`-based
test would have skipped.

### Recommended setup

Run from a **canonical clone** (`origin = canonical`) with `soloMaintainer: true` and no fork.
Every skill then works from one clone with zero swapping — feature PRs, releases, and
back-merges are all same-repo. The guard change also keeps the flow working from an existing
fork clone, so re-cloning is not required.

### Skill change

Only `starting-work` needs a change: it currently hard-stops when `origin == canonical`
("fork first"). Under `soloMaintainer`, it branches `feature/*` in place instead of demanding a
fork. The maintainer skills (`reviewing-a-contribution`, `merging-a-contribution`,
`drafting-a-release`, `cutting-a-release`) already assume `origin = canonical`, which is the
recommended solo setup, so they need no changes.

## Testing

New `test_guard.py` cases for `role == "solo"`:

- Contribution PR into `develop`: squash + reviewed → **allow**; missing review → **block**;
  non-squash → **block**.
- Release PR into `main` → **allow**; back-merge `main`→`develop` → **allow**.
- Direct commit on `main`/`develop` → **block**; commit on `feature/*` and `release/*` →
  **allow**.
- Flag off → `contributor`/`maintainer` behavior unchanged (regression guard).

New `test_workflow_lib.py` case: `detect_role(slug, canonical, solo=True) == "solo"`.

## Rollout

Ships through the normal workflow: `feature/solo-maintainer-mode` → PR into `develop` →
review → squash-merge → release. `soloMaintainer` stays `false` in the committed config; the
user enables it locally (or in a follow-up) once merged.
