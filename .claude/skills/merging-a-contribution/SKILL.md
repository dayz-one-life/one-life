---
name: merging-a-contribution
description: Use as maintainer to squash-merge an approved pull request into develop. Triggers on "merge PR", "merge this contribution", "land PR #N".
---

# Merging a Contribution

The guard blocks any merge that is not `--squash` or whose PR lacks an approved review.

## Steps

1. Confirm the PR is approved: `gh pr view <N> --json reviewDecision` must be `APPROVED`. If not, run reviewing-a-contribution first.
2. Squash-merge into develop: `gh pr merge <N> --squash --delete-branch`.
3. Confirm the merge and that the branch was deleted.
4. Note that the contribution's changelog entry is now part of `develop`'s Unreleased section, ready for the next release.
