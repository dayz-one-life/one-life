# CLAUDE.md

This project was created from the Claude Code workflow template. The workflow below is
enforced by committed hooks in `.claude/` and streamlined by repo-level skills.

## On session start

A SessionStart hook injects a role-aware orientation. **Present that orientation to the
user at the start of a fresh session.**

## The workflow

1. All feature work happens on a **fork**, on a `feature/*` branch.
2. Updating this file (`CLAUDE.md`) is the **last step** before opening a PR.
3. `CHANGELOG.md` is updated on **every** PR.
4. PRs go into the canonical repo's **`develop`** branch.
5. Reviews are done in Claude Code and posted back to the contributor.
6. Approved PRs are **squash-merged** into `develop`.
7. Production releases go out via a **`develop` → `main`** PR.
8. Merging that PR **cuts a release** with notes.

## Skills

- Contributor: `starting-work`, `finishing-a-feature`.
- Maintainer: `reviewing-a-contribution`, `merging-a-contribution`, `drafting-a-release`, `cutting-a-release`.
- Setup: `workflow-setup` (run once).

## Guardrails (enforced by `.claude/hooks/guard.py`)

- No commits, pushes, or merges on `main`/`develop` (tag pushes and the one-time `workflow.json` setup commit are exempt).
- On a fork: PRs must target `develop` and require CHANGELOG.md + CLAUDE.md updates.
- On the canonical repo: feature work is blocked (fork instead). Fork contributions into `develop` must be squash-merged and approved; the maintainer's own same-repo release/back-merge PRs are exempt from that gate.
- Once the project is initialized (`workflow-setup` run), write/git actions are blocked unless the Superpowers plugin is installed.
- **Solo maintainer mode:** setting `soloMaintainer: true` in `.claude/workflow.json` activates a `solo` role that holds the union of contributor + maintainer permissions from a single clone (no remote swapping). Protected branches stay PR-only; contribution merges into `develop` still require `--squash` + a posted review (a `COMMENTED` review counts, since self-approval is impossible); release (`develop`→`main`) and back-merge (`main`→`develop`) PRs are exempt from the changelog/review gates. Off by default.

## Honest limitations

- Hooks only bind inside Claude Code; plain `git`/`gh` in a shell bypasses them.
- Superpowers/role detection are filesystem/remote heuristics; they fail with clear messages.
- Approved-review detection needs the canonical repo to be a real GitHub remote.
- **Orphan roots (reconciled 2026-07-14):** `main` and `develop` were originally created as
  independent orphan commits with no shared history, which forced a one-off `git rebase --onto` on
  every cross-branch PR through the v0.1.0 release. After v0.1.0, `develop` was re-rooted onto
  `main` so they now share history — feature→`develop`, release→`main`, and `main`→`develop`
  back-merge PRs no longer need any rebasing.

## Configuration

`.claude/workflow.json` holds `canonicalRepo`, branch names, the optional `soloMaintainer` flag (default `false`), and optional `commands.test`/`commands.lint`.

---

# One Life MVP

DayZ community platform: tracks each player's single life (birth→death across sessions),
24h-bans them when a qualified life dies, and lets them earn back in via emote verification +
an unban-token economy. Single-tenant, multi-server (Xbox). Ported lean from the archived
`../one-life-platform` (news/LLM stack dropped). MVP scope + decomposition:
`docs/superpowers/specs/2026-07-13-one-life-mvp-definition-design.md`.

## Sub-projects

- **SP1 — Foundation + ADM ingest + lives** ✅: multi-server Nitrado ADM-log ingest → event log
  → life/player/session/kill projections + qualified-lives read model.
- **SP2 — Auth + web + gamertag verification** ✅: Better Auth (Discord/Google/GitHub/magic-link),
  gamertag linking, emote verification (verifier loop), Fastify API, and an auth-focused web surface
  (login + account/claim + minimal landing). Stats dashboard deferred. The login page renders only
  **configured** sign-in methods — social providers appear only when both `<P>_CLIENT_ID`/`<P>_CLIENT_SECRET`
  are set, and email/magic-link is gated by `MAGIC_LINK_ENABLED` (default `true`). The backend is the source
  of truth via `enabledAuthMethods()`, served at `GET /api/auth/providers` (a static route that wins over the
  `/api/auth/*` Better Auth catch-all); the login page is a server component that fetches it before render.
  **One gamertag per user:** a user holds at most one active (`pending`|`verified`) `gamertag_links` row —
  enforced by partial unique index `gamertag_links_user_active_uniq` (migration `0007`) + a
  `409 active_link_exists` guard in `POST /me/gamertag-links`; a `verified` link is admin-release-only.
  **Onboarding/status banner + masthead slot:** a persistent site-wide banner under the masthead
  (`StatusBannerContainer` in the root layout, between `Masthead` and the page) reflects the viewer's
  onboarding state and carries the primary next action; the masthead's right-hand slot collapses to
  match. One pure derivation `accountStatus({ signedIn, loading, links })` (`@/lib/account-status`,
  union `loading|signedOut|unlinked|pending|verified`) is the single source of truth for both surfaces,
  read via the `useAccountStatus()` hook (`useSession` + `useGamertagLinks` + `activeLink`). **Banner:**
  signed-out → *"Sign in to claim your gamertag"* (→`/login`); unlinked → *"Link your gamertag…"*
  (→`/account/claim`); pending → self-contained verification banner (emote chips + live `n/total DONE`
  progress + expiry countdown + **Cancel claim**, or a **Start a new challenge** re-claim when expired);
  verified/loading → nothing. **Masthead slot** (`MastheadSlot`): signed-out → empty; unlinked/pending →
  quiet **Account** link → `/account`; verified → amber **{GAMERTAG}** CTA → `/account`; loading →
  placeholder. `StatusBanner`/`MastheadSlot` are presentational (unit-tested by props);
  `useAccountStatus`/`StatusBannerContainer`/`Masthead` are thin hook wrappers (untested, per repo
  convention). No backend change — `GET /me/gamertag-links` already serializes the challenge, so
  `useGamertagLinks` adds a **5s `refetchInterval` while a link is pending** (progress ticks live, stops
  when nothing is pending, and never polls signed-out visitors). `QueryProvider` lives at the **root
  layout** (one app-wide TanStack Query cache), and `useGamertagLinks(enabled)` gates its fetch so
  logged-out visitors don't 401 on `/api/me/gamertag-links` every page.
- **SP3 — Death-ban enforcement** ✅: `apps/enforcer` bans a player 24h when a qualified life dies
  (per-server Nitrado ban list, name-based). **`ENFORCER_DRY_RUN` defaults to `true`** — logs
  intended bans without writing to Nitrado; set `false` to enforce. `bans` table is durable
  (never rebuilt).
- **SP4 — Unban-token economy** ✅: `@onelife/tokens` (ledger; balance = SUM of deltas; idempotent
  grants) + `apps/granter` sweeps. Token on verification, monthly + referral grants, self-unban
  (redeem → ban `lift_pending` → enforcer removes under the dry-run gate), and transfers. API
  routes + a web wallet on the account page.
- **SP5 — RPT ingest + character mapping** ✅: `@onelife/rpt-parser` correlation state machine +
  survivor roster; the `ingest-worker` RPT pass writes `character_sightings` + a `characters` rollup
  (charID inheritance); `getLifeCharacter` read-model + API life-detail `character` field. Web
  display deferred with the stats dashboard.
  **Character class = `create_entity` only:** a character's persona is taken solely from the game's
  authoritative `Create entity type 'Survivor[MF]_<Name>'` RPT line. The old `head_asset` signal was
  **removed** — head-warning lines carry no player identity and mis-attribute across players (even
  cross-gender), producing phantoms (e.g. head `m_adam` → non-existent "Adam"). `rosterByClass`
  (`@onelife/domain`) resolves real `Survivor[MF]_<Name>` classes to the 31 shipped personas by name;
  unknown/undetermined → `null` → silhouette. (Migration `0008` rebuilt the `characters` rollup from
  `create_entity`-only sightings.)
  **Character headshots:** the 31 default survivor portraits live at `apps/web/public/characters/<name>.webp`
  (lowercase names, served by Next.js at `/characters/<name>.webp`, e.g. `/characters/lewis.webp`), staged for
  the deferred per-life character-head display — map a life's character name via `/characters/${name.toLowerCase()}.webp`.
  Sourced from the DayZ Fandom wiki (CC BY-SA; attribution required if shipped public-facing).
- **Survivors leaderboard** ✅: public, mobile-first live leaderboard at `/survivors` (combined,
  all active slugged servers) and `/survivors/[map]` (single server, by `servers.slug`) — one row
  per (player × server) for every currently-alive survivor (**alive** = open qualified life:
  `lives.endedAt IS NULL` and `isLifeQualified`). Each row shows gamertag, map, kills / time alive /
  longest kill (all **this-life**, i.e. since `life.startedAt`), and a character avatar. Query-param
  sort (`?sort=kills|time|longest`, default `kills`, always descending) + pagination
  (`?page=`, 25/page); server-rendered with per-page SEO/OG metadata. Backed by the
  `getAliveSurvivors` read-model (`packages/read-models/src/survivors.ts`) and the public
  `GET /survivors[/:slug]` API route. Avatars resolve via `rosterByClass(characterClass).name` →
  `/characters/<name>.webp` (silhouette fallback for an unknown/no character). Gamertag filtering
  was scoped out of this pass.
- *(historical)* Device-based alt detection (RPT Feature A): the device signal
  is **cut** — DayZ removed the `[MAM]` device-hash log lines in 1.29; alts fall back to Nitrado's
  built-in Multi-Account Mitigation.
- **UP1+UP2 — Universal Player** ✅: a player is a **global identity** keyed by gamertag (one row per
  gamertag across all servers; **lives stay per-server**). **UP1** rebuilds the `players` projection
  globally (migration `0005`: drops `server_id`/`current_life_id`, unique on `gamertag`; fold/stores/
  read-models resolve by gamertag and scope per-server via `lives.server_id`; rebuilt from `events`).
  **UP2** makes the gamertag claim server-agnostic (migration `0006`: `gamertag_links` drops
  `server_id`, verified-unique on `gamertag`) — verified once per gamertag across all servers, emote
  completable on any server; the claim UI replaces the server dropdown with a gamertag autocomplete
  over unverified players (`searchClaimableGamertags` read-model + `GET /players/search`).
  `@onelife/tokens` `redeem` establishes ban ownership by verified gamertag alone (bans stay
  per-server). **Prod deploy** needs the gated projection rebuild **and** the `gamertag_links`
  duplicate precheck in the UP1 plan's runbook (`0005`/`0006` are separate transactions).

## Monorepo (pnpm + turbo, TS/ESM, Postgres + Drizzle)

- **packages:** `db` (18-table schema + migrations), `domain` (zod events, emote/weapon dicts),
  `nitrado` (log-file client), `adm-parser` (pure ADM line parser), `event-log` (append/cursor over
  `events`), `projections` (fold logic), `read-models` (stats queries), `test-support` (Postgres
  test harness), `auth` (Better Auth), `verification` (emote-sequence challenges),
  `tokens` (unban-token ledger + grants/redeem/transfer), `rpt-parser` (RPT login-correlation →
  character sightings).
- **apps:** `ingest-worker` (ADM+RPT poll→events loop; **DB-driven** — sweeps every `servers` row with
  `active=true` using the shared `NITRADO_TOKEN`, no `NITRADO_SERVICE_ID` env), `projector` (events→projections fold),
  `verifier` (emote-verification loop), `api` (Fastify REST + auth), `web` (Next.js frontend),
  `enforcer` (24h death-ban reconciler; dry-run by default), `granter` (token grant sweeps),
  `rebooter` (restarts every `active` server on the top of each **even UTC hour** — 00:00,02:00,…,22:00
  — best-effort per server; **no dry-run, live on deploy**; needs `NITRADO_TOKEN` + a `onelife-rebooter`
  systemd unit).

## Commands

- Test: `pnpm turbo run test --concurrency=1` (DB suites need `TEST_DATABASE_URL`).
  Typecheck: `pnpm turbo run typecheck`.
- Local Postgres: `docker compose up -d postgres`. **Note:** a gitignored
  `docker-compose.override.yml` may remap the host port (this dev machine uses 5434, not 5432).
- Deploy (prod): `./deploy/deploy.sh` deploys the latest release tag (build → backup → migrate →
  restart fleet → health-check); add `--rebuild` for releases that change projection-table shape
  (truncate + re-fold from the event log). See `deploy/README.md`.
