---
name: drafting-a-release
description: Use as maintainer to prepare a production release — compute the version, finalize the changelog, and open the develop-to-main PR. Triggers on "draft a release", "prepare release", "promote develop to main".
---

# Drafting a Release

## Version policy

Compute the next SemVer version from the `Unreleased` section:
- Only `Fixed`/`Security`/patch-level entries → **patch**: apply automatically, no prompt.
- Any `Added` entries → **minor**: STOP and suggest the minor bump, explaining which entries triggered it; get maintainer confirmation.
- Any `**BREAKING:**` flag or removed public behavior → **major**: STOP and suggest the major bump with the specific signal; get maintainer confirmation.

## Steps

1. Confirm you are on the canonical repo and `develop` is up to date: `git fetch origin && git checkout develop && git pull`.
2. Determine the current version from the latest git tag (`git describe --tags --abbrev=0`, default `v0.0.0`).
3. Compute the next version per the policy above; confirm with the user if minor/major.
4. Create the release branch: `git checkout -b release/<version> develop`.
5. In `CHANGELOG.md`, move everything under `Unreleased` into a new `## [<version>] - <YYYY-MM-DD>` section and leave `Unreleased` empty with its group headings.
6. Commit on the release branch (allowed for maintainers).
7. Open the promotion PR: `gh pr create --base main --head release/<version> --title "Release <version>" --body "<full changelog section>"`.
8. Hand the PR to reviewing-a-contribution. After it merges, use cutting-a-release.
