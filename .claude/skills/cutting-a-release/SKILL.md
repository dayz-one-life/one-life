---
name: cutting-a-release
description: Use as maintainer immediately after the develop-to-main release PR merges, to tag the version and publish release notes. Triggers on "cut the release", "publish the release", "tag the version".
---

# Cutting a Release

## Steps

1. Confirm the `release/<version>` → `main` PR has merged and `main` is current: `git checkout main && git pull`.
2. Tag the release at `main`: `git tag -a v<version> -m "Release <version>"` then `git push origin v<version>`.
3. Publish notes from the finalized changelog section:
   `gh release create v<version> --title "v<version>" --notes "<the [<version>] changelog section>"`.
4. Sync `develop` with the release: open a same-repo back-merge PR from `main` into `develop` and merge it with a merge commit (do not fast-forward, do not squash). Same-repo maintainer PRs are exempt from the approval/squash gate, so it merges cleanly and carries the finalized changelog and version back to `develop`.
5. Report the release URL to the user.
