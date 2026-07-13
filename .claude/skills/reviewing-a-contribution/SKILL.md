---
name: reviewing-a-contribution
description: Use as maintainer to review a contributor's pull request into develop and post the review back to them. Triggers on "review PR", "review this contribution", "check PR #N".
---

# Reviewing a Contribution

## Steps

1. Confirm you are on the canonical repo (maintainer mode).
2. Fetch the PR diff: `gh pr diff <N>` and `gh pr view <N> --json title,body,files`.
3. Review with `superpowers:requesting-code-review` (or `/code-review`) against the diff. Focus on correctness, the changelog entry, and that CLAUDE.md was updated.
4. If changes are needed, post them back to the contributor:
   `gh pr review <N> --request-changes --body "<numbered, specific findings>"`.
5. If it is ready, approve: `gh pr review <N> --approve --body "<summary>"`.
6. Tell the user the review outcome. Requested changes return to the contributor; approval unlocks merging.
