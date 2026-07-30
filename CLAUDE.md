# CLAUDE.md

DayZ community platform: tracks each player's single life (birth→death across sessions),
24h-bans them when a qualified life dies, and lets them earn back in via emote verification +
an unban-token economy. Single-tenant, multi-server (Xbox). Ported lean from the archived
`../one-life-platform` (news/LLM stack dropped). MVP scope + decomposition:
`docs/superpowers/specs/2026-07-13-one-life-mvp-definition-design.md`.

**This file is an index, not the record.** It was 165 KB and blew the context budget; on
2026-07-29 the per-feature detail moved, verbatim, into `docs/architecture/`. Those files hold the
⚠️ invariants — the rules whose violation is silent, whose reasons are non-obvious, and which a
well-meaning "tidy-up" reintroduces. **Read the relevant one before editing that area**; do not
work from this summary alone.

## Where the rules live

| Touching… | Read first |
| --- | --- |
| Branching, PRs, releases, CI, keel/Shipyard plugins | [`docs/architecture/git-workflow.md`](docs/architecture/git-workflow.md) |
| ADM/RPT ingest, `events`, the fold, projections, `players`/`lives`, gamertag identity + renames, death classification, obituaries | [`docs/architecture/ingest-and-domain.md`](docs/architecture/ingest-and-domain.md) |
| Survivors board, player dossier, life timeline, home, app shell, layout/z-index, avatars, sitemap | [`docs/architecture/web-surfaces.md`](docs/architecture/web-surfaces.md) |
| Anything with coordinates, `/maps`, Leaflet, friendships, location grants, presence | [`docs/architecture/maps-friends-privacy.md`](docs/architecture/maps-friends-privacy.md) |
| `apps/notifier`, the `notifications` table, web push, the inbox/bell | [`docs/architecture/notifications.md`](docs/architecture/notifications.md) |
| What each package/app is and which env vars it needs | [`docs/architecture/monorepo.md`](docs/architecture/monorepo.md) |
| Deploy, migrations, `--rebuild` | the **Commands** section below, plus `deploy/README.md` |

Specs and plans for every sub-project live in `docs/superpowers/specs/` and
`docs/superpowers/plans/`, named by date.

## Shape of the repo

pnpm + turbo monorepo, TS/ESM, Postgres + Drizzle. `packages/`: `db`, `domain`, `nitrado`,
`adm-parser`, `event-log`, `projections`, `read-models`, `test-support`, `auth`, `verification`,
`tokens`, `friends`. `apps/`: `ingest-worker`, `projector`, `verifier`, `api` (Fastify),
`web` (Next.js App Router), `enforcer`, `granter`, `rebooter`, `notifier`, `newsdesk`.

Architecture in one line: ADM logs → append-only `events` → a single-instance fold into
projection tables → read-models → API → web. **Projections are rebuildable from the event log;
durable tables are not.** Derived facts (life qualification, death verdicts) are computed at read
time and never materialized.

## Workflow

The git lifecycle is owned by **keel** (Shipyard plugin suite), declared in
`.claude/settings.json`. **`.keel.json` is the source of truth for the topology.** Trunk: work on
`feature/*` off `main`, PRs into `main` are **squash**-merged, releases are tags cut from `main`.
Every contribution PR needs a `CHANGELOG.md` entry, written last before opening the PR.
Skills in order: `keel:start-work` → `keel:finish-work` → `keel:review` → `keel:land` →
`keel:ship`; `keel:doctor` explains any block. Details, and the reasons the config must stay as it
is, in `docs/architecture/git-workflow.md`.

## House rules that apply everywhere

These recur across every sub-project; the linked files hold the specific cases and the reasons.

- **Loading, failed, empty and zero are four different renders.** Never let an in-flight or failed
  fetch fall through to an authoritative `0`/`[]`/"nobody is here". This is the repo's
  most-repeated bug class; `PageHeader`'s `count` union is the pattern to copy.
- **Independent fetches degrade independently.** One shared try/catch around two feeds passes the
  tests and silently guts half the page.
- **A `/me` route takes no subject parameter.** The session is the only input, so serving another
  player's data is unexpressible rather than merely rejected. Coordinate routes additionally carry
  `cache-control: no-store, private`.
- **Ownership and access are WHERE-clause predicates, never post-filters**, and the boundary is a
  **`verified`** `gamertag_links` row — never `pending`.
- **The app has exactly three z-altitudes** — the LAYER LEGEND at the `<header>` in
  `apps/web/src/components/shell/header.tsx` is the source of truth.
- **RTL asserts the DOM, not contrast or layout.** A component mounted on both a dark and a light
  surface needs a test pinning the token swap; anything about paint order, overlap or viewport
  width needs a real browser (headless Chrome and window resizing both lie below ~500px CSS —
  use CDP device-metrics emulation).
- **Generated files are generated.** Edit `.<plugin>.json` and re-render; never the artifact.
  `.github/workflows/changelog.yml` and `scripts/check_changelog.py` are vendored verbatim from
  keel — fix them upstream.
- **Workers default to dry-run** (`ENFORCER_DRY_RUN`, `NOTIFIER_DRY_RUN`, `NEWSDESK_*`), and
  forward-only `*_SINCE` cutoffs are unset-means-OFF, never a silent epoch default.
- **A ⚠️ comment in the code is load-bearing.** Nearly every one documents a shipped bug. Do not
  "simplify" it away without reading why it is there.

## Commands

- Test: `pnpm turbo run test --concurrency=1` (DB suites need `TEST_DATABASE_URL`).
  Typecheck: `pnpm turbo run typecheck`.
- Local Postgres: `docker compose up -d postgres`. **Note:** a gitignored
  `docker-compose.override.yml` may remap the host port (this dev machine uses 5434, not 5432;
  a git worktree brings up its own stack on its own port — check `docker ps`).
  **⚠️ `drizzle-kit` reads `DATABASE_URL` and NOTHING ELSE — notably not `TEST_DATABASE_URL`,
  which is what every suite here uses.** It used to fall back to a hardcoded
  `localhost:5432/onelife`, so a migrate run with only `TEST_DATABASE_URL` exported silently
  targeted a different database and reported success; an unset `DATABASE_URL` is now a loud
  error. To migrate the test database, name it:
  `DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate`.
  **⚠️ `turbo.json`'s `test` task declares `env` for exactly this reason.** Without it,
  `TEST_DATABASE_URL` is not part of the cache key, so repointing the suite at a different or
  unmigrated database replays a cached PASS and reports green **without running anything** —
  which happened during the friends work. Any new env var a suite reads must be added to that
  list, or the suite gains the ability to report success it did not earn.
  `.gitignore` covers OS cruft (`.DS_Store`); prefer `git add -p`/explicit paths over `git add -A`
  at the repo root so stray untracked files don't ride into a commit.
- **⚠️ A change to `deploy/deploy.sh` NEVER applies to the deploy that installs it.** The
  operator invokes the currently-checked-out script, which checks out the new tag and runs to
  completion — so a release shipping a `deploy.sh` fix is deployed *by the previous release's
  script*, flaw included; the fix takes effect from the next deploy onward. This is inherent to
  a deploy script that deploys its own repo. Compensate manually for that one deploy (v0.37.2's
  `DATABASE_URL` fix needs a one-time `DATABASE_URL=placeholder ./deploy/deploy.sh`; see
  `deploy/README.md`). **Two distinct things here — don't conflate them:**
  1. **Self-application is FIXABLE, and deliberately unfixed.** The script could `exec` its new
     self behind a guard flag after the checkout succeeds. That is a legitimate future change;
     it is declined because a manual step on the rare `deploy.sh` release is cheaper than an
     exec-resume in the one script whose failure is an outage. Not forbidden — just not free.
  2. **Machinery to defend against a MID-RUN REWRITE is forbidden**, because that hazard does
     not exist. It was tried and reverted: `git checkout` unlinks and recreates rather than
     writing in place, so the running bash keeps reading the original inode (verified on
     macOS/APFS and Linux/overlayfs — a 236 KB script that checks out a 42-byte replacement of
     itself completes every phase). The self-re-exec guard bought nothing and introduced a way
     to delete `deploy.sh` from the working tree.
- **Any child process of `deploy.sh` that needs `DATABASE_URL` must be passed it EXPLICITLY.**
  The script reads it out of `.env` into a plain shell variable and never exports it; the
  migrate and `--rebuild` phases each prefix `DATABASE_URL="$DATABASE_URL"` for this reason.
  Both phases run *after* the fleet is stopped, so a miss aborts the deploy with the site down.
- Deploy (prod): `./deploy/deploy.sh` deploys the latest release tag; add `--rebuild` for releases
  that change projection-table shape (truncate + re-fold from the event log). See `deploy/README.md`.
- **⚠️ The `--rebuild` phase runs BEFORE the migrate phase** (backup → stop fleet → **rebuild** →
  **migrate** → restart). So `rebuildAll`'s `TRUNCATE` executes against the *old* schema — a
  projection table that a same-release migration CREATES does not exist yet. **Never name a
  newly-created projection table in `REBUILD_TRUNCATE_TABLES` (`apps/projector/src/rebuild.ts`) in
  the release that creates it** — naming a missing relation aborts the whole `TRUNCATE`, and since
  the fleet is already stopped the deploy dies mid-flight (this is what broke the v0.42.1 deploy:
  `0025` created `player_gamertags` and listed it in the same release). A child table with an FK to
  a table already in the list is cleared by `RESTART IDENTITY CASCADE` and needs no entry at all; a
  parentless new projection table must wait one release before being added. The rebuild-before-migrate
  order is deliberate — it empties projection tables so a shape-changing migration applies to empty
  rows — so do not "fix" it by reordering. Unlike a `deploy.sh` change, a `rebuild.ts` fix DOES
  self-apply (the phase runs `tsx src/rebuild.ts` from the freshly-checked-out tag).

## Outstanding, un-verified work

Carried forward from the sub-projects that recorded it — each needs a real device, a live server or
two signed-in accounts, and none is closed by the test suite:

- M1's browser pass over `/maps` against real mirrored tiles (task 9 of its plan).
- The 320px tab row, the safe-area calc in PWA/standalone on a notched phone, and the bell popover
  vs the tab bar (sub-project B).
- The avatar round trip: upload → the board/masthead rendering the mirrored image (login avatars).
- The session location-share round trip: grant → dot → session end → dot gone (sub-project E).
- Sub-project D3: moving `/maps/[map]` into `app/(site)/` and deleting the map's own chrome.
- The four-link footer row at 320px, and the tab-bar gutter still clearing it in PWA/standalone
  on a notched phone (legal pages). RTL pins `flex-wrap` as a class; only a browser can confirm
  the wrap and the clearance.
- The verified-home redesign's layout claims, none of which RTL can prove and all of which need a
  **signed-in verified session**: the controls slab's `lg`-not-`md` split across the 768–1023
  band, the share row on one line at 390px, the 320px floor, the avatar pencil → `AvatarDialog`
  round trip, and a real spend on a banned ticket. Use CDP
  `Emulation.setDeviceMetricsOverride` — `resize_window` and `--window-size` do not work here.
- The avatar dialog's browser-only claims: the pointer drag and zoom slider actually moving the
  image (including under touch), the saved avatar matching what the preview showed, the dialog
  painting above the masthead and tab bar without collapsing into the stage's stacking context,
  and the dialog at 320px and in PWA/standalone on a notched phone. The crop stage has never been
  driven by a real pointer or a real touch, so the drag and the zoom slider remain unverified on
  any actual device. Needs a signed-in verified session; use CDP `Emulation.setDeviceMetricsOverride`.
