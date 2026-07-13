---
name: finishing-a-feature
description: Use when feature work is complete and you are ready to open a pull request. Streamlines every pre-PR step in order — tests, changelog, CLAUDE.md, PR into develop. Triggers on "finish this feature", "open a PR", "I'm done", "ready to submit", "wrap up".
---

# Finishing a Feature

Runs the full pre-PR sequence so nothing the guard requires is missed. The guard blocks the PR if the changelog or CLAUDE.md was not updated, so this skill does them in the correct order.

## Order matters

CLAUDE.md is deliberately the **last** content step before the PR — update it once everything else is settled.

## Steps

1. **Verify the branch.** Confirm you are on a `feature/*` branch on your fork. If not, stop.
2. **Run quality gates.** Read `.claude/workflow.json` `commands.test` and `commands.lint`; if set, run them and ensure they pass. If unset, skip. Do not proceed on failure.
3. **Self-review.** Invoke `superpowers:requesting-code-review` on the diff and address findings before continuing.
4. **Update the changelog.** Add a bullet under the appropriate group (`Added`/`Changed`/`Fixed`/`Removed`/`Deprecated`/`Security`) in the `Unreleased` section of `CHANGELOG.md`. Flag breaking changes explicitly (prefix `**BREAKING:**`).
5. **Update CLAUDE.md (last).** Reflect any new commands, structure, or conventions this feature introduced. Even a small, accurate update is required — the guard checks that CLAUDE.md changed on this branch.
6. **Commit** the changelog + CLAUDE.md updates.
7. **Open the PR into develop.** Use `superpowers:finishing-a-development-branch` to handle push/PR, targeting the canonical base:
   `gh pr create --repo <canonicalRepo> --base <baseBranch> --head <fork-owner>:<branch> --title "<summary>" --body "<what/why + changelog excerpt>"`.
   The guard normalizes this; if it blocks, read the message and fix the missing step.
8. Report the PR URL to the user.
