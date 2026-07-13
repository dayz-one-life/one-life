# Project Template (Claude Code workflow)

A GitHub template that bakes a disciplined, Claude-Code-enforced contribution and release
workflow into any project created from it — fork → `feature/*` → PR into `develop` → review
→ squash-merge → `develop`→`main` release, with an enforced changelog and CLAUDE.md.

Enforcement is entirely through Claude Code (committed hooks + repo-level skills), not
GitHub branch protection or CI.

## Using this template

1. Create a new repository with **Use this template**.
2. In the new repo, ask Claude to run the **workflow-setup** skill to stamp your canonical
   repo into `.claude/workflow.json`.
3. Contributors follow `CONTRIBUTING.md`; maintainers use the review/merge/release skills.

See `CLAUDE.md` for the full workflow and its guardrails, and `docs/superpowers/` for the
design spec and this implementation plan.
