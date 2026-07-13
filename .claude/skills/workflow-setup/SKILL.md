---
name: workflow-setup
description: Use once, right after creating a project from this template, to stamp the canonical repository into .claude/workflow.json so the workflow guards activate. Triggers on "set up the workflow", "initialize the template", or an uninitialized-template orientation notice.
---

# Workflow Setup

One-time initialization. Until this runs, `canonicalRepo` is blank and all guards are permissive.

## Steps

1. Confirm the canonical repo slug with the user (the `owner/name` of the main repository these contributions target — for the template project itself this is `dbd-net/project-template`).
2. Confirm branch names (defaults: base `develop`, production `main`).
3. Read `.claude/workflow.json`, set `canonicalRepo` to the confirmed slug, and adjust branch keys only if the user changed them. Leave `commands.test`/`commands.lint` blank unless the user provides them.
4. Ensure `develop` and `main` branches exist on the canonical remote; if `develop` is missing, create it from `main` and push.
5. Stage only the config and commit it: `git add .claude/workflow.json`, then commit. The guard specifically exempts a commit whose ONLY staged file is `.claude/workflow.json` from the protected-branch rule, so this one-time setup commit is allowed even on `main`. Stage nothing else — the exemption applies only when `.claude/workflow.json` is the sole staged file. (The Superpowers gate still applies: because step 3 already stamped `canonicalRepo`, the repo now reads as initialized, so Superpowers must be installed for this commit — install it first if the guard reports it missing.)
6. Tell the user setup is complete and summarize the active guardrails.
