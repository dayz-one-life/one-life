# Contributing

Contributions run through Claude Code, which enforces this workflow automatically.

## Requirements

- **Install the [Superpowers plugin](https://github.com/anthropics/claude-code).** Write/git
  actions are blocked without it.
- Use Claude Code for your work so the workflow skills and guardrails apply.

## Flow

1. **Fork** the repository: `gh repo fork <owner>/<repo> --clone`.
2. Ask Claude to run the **starting-work** skill to create your `feature/*` branch.
3. Do the work (test-driven).
4. Ask Claude to run the **finishing-a-feature** skill. It will: run tests, update the
   changelog, update `CLAUDE.md` last, and open a PR into `develop`.
5. A maintainer reviews in Claude Code. Requested changes come back on the PR; address them
   and push. Approved PRs are squash-merged.

## Changelog

Every PR adds an entry under `Unreleased` in `CHANGELOG.md` (Keep a Changelog format).
