# CLAUDE.md

## Workflow

This repo's git lifecycle is owned by **keel**, part of the
[Shipyard](https://github.com/submtd/shipyard) plugin suite, declared for all contributors in
`.claude/settings.json`. **`.keel.json` is the source of truth for the topology** — read it rather
than trusting a summary here, because a summary is how a committed copy drifts from the plugin.

Shorthand: work happens on `feature/*` off `main`; PRs into `main` are squash-merged; releases are
cut and tagged from `main`. `main` is the single long-lived branch (**trunk topology** — there is
no `develop`; it was retired 2026-07-23). Every contribution PR needs a `CHANGELOG.md` entry, and
this file is updated last, before opening the PR.

Skills, in lifecycle order: `keel:start-work` → `keel:finish-work`, then `keel:review`,
`keel:land`, `keel:release`, `keel:ship`. `keel:doctor` explains any block or warning. Under trunk
there is no `keel:release` step (no integration branch to accumulate on) — cut releases straight
from `main` with `keel:ship`.

**⚠️ `mergeStrategy.toProduction` MUST stay `"squash"`, not `"merge"`.** keel's merge-strategy
guard short-circuits under trunk (`rules.py`, the `and not cfg.is_trunk` clause): *every* PR into
`main` is judged against `toProduction`, and `toIntegration` is never consulted. Since every PR
here is a feature PR (releases are tags, not merges), setting `toProduction: "merge"` would force a
merge commit per feature and **block `gh pr merge --squash` outright**. `main` stays a clean
one-commit-per-feature history only while this is `squash`.

Also enabled: `stow` (`.gitignore`), `rigging` (CI), `hull` (secret scanning), and `bosun`
(Dependabot). Only `ballast` (pytest) stays off — there is no Python here. Every plugin's rendered
file is **generated output** — edit the `.<plugin>.json` config and re-render, never the artifact:

- **`rigging`** → `.rigging.json` + `.github/workflows/ci.yml`. A pnpm + turbo test job on **Node 24**
  with a **`postgres:16-alpine`** service (musl libc — matching dev and production's docker-compose
  image, **not** rigging's `postgres:16`/glibc default: the friends `friendships_ordered`
  constraint orders user ids by the DB collation, and glibc's locale collation sorts a `_` in a
  callsign differently from musl/C, red-failing a notifier test that shipped assuming ASCII order —
  CI must test the Postgres the app runs on); `services.postgres.database: "onelife_test"` makes
  rigging emit
  `TEST_DATABASE_URL=…/onelife_test`, which the `assertTestDatabase` `_test` guard requires (the
  harness self-creates + migrates that DB). Runs `pnpm install --frozen-lockfile` then
  **`pnpm run ci`** — `testCommand: ["pnpm","run","ci"]`, the root `turbo run typecheck test
  --concurrency=1` script. **⚠️ The custom `testCommand` must stay a `pnpm run` invocation, never a
  bare `turbo`**: a bare `turbo` has no `node_modules/.bin` on PATH in a `run:` step, which is why
  this was `pnpm test` with no `testCommand` at all until 2026-07-28. Going through `pnpm run`
  keeps `.bin` on PATH and closes the real gap — **CI never ran `typecheck`**, so every type-level
  guarantee in the repo (e.g. `buildsPlaced` being absent from `ObituaryFacts`) was enforced only
  on a contributor's machine. The local `pnpm test` stays tests-only. This is the repo's
  first real test CI. **Node 24, not the `engines.node >=20` floor:** vitest configs import
  `@onelife/test-support/setup-path` (a `.ts` file) that Vite's config loader resolves with a plain
  native `import()`, so the runtime must strip TS types itself — Node 20 throws
  `ERR_UNKNOWN_FILE_EXTENSION`, Node 22.18+/24 do not. The real test-runtime floor is above what
  `engines` declares.
- **`hull`** → `.hull.json` + `.github/workflows/security.yml`. Scanner is **`trufflehog`**, not
  gitleaks: this is an org-owned repo, and gitleaks-action hard-exits without a `GITLEAKS_LICENSE`
  org license; trufflehog needs no license and only `contents: read`, so it also runs on fork PRs.
- **`bosun`** → `.bosun.json` + `.github/dependabot.yml`. `github-actions` + `npm` ecosystems,
  weekly, `targetBranch: main` (read from `.keel.json` — under trunk topology `main` is the
  integration branch where the changelog gate runs, so Dependabot PRs target it directly).

The three previously-deferred plugins were unblocked by Shipyard 0.6.0–0.9.0 (issue #24 + the
`services.<id>.database` follow-up); see
`docs/superpowers/specs/2026-07-21-shipyard-plugins-design.md` §9 for the full history. keel's
changelog gate also runs in CI (`.github/workflows/changelog.yml`).

**⚠️ `.github/workflows/changelog.yml` and `scripts/check_changelog.py` are vendored verbatim** from
keel's own templates (`plugins/keel/templates/` in the Shipyard repo). They are not authored here.
Do not edit them in place — a local "improvement" silently forks them from upstream and is lost on
the next re-vendor. Fix the template in Shipyard, then re-copy both files.

**Contributors:** the plugins are declared in the repo, but each person approves a one-time install
prompt on their first session. See `CONTRIBUTING.md`.

## Honest limitations

- keel's guard is **advisory** and runs only inside Claude Code; plain `git`/`gh` in a terminal, or
  CI, bypasses it entirely. The real boundary is GitHub branch protection, **configured on `main`
  as of 2026-07-23** (`keel:protect`): PRs are required, and `node (24)` + `changelog` + `trufflehog`
  must pass before merge (`strict` — a PR must be up to date with `main` first). **Two deliberate
  gaps under `reviewPolicy: "review"`:** the required approving-review count is **`0`**, because
  GitHub forbids self-approval and understands only `APPROVED` (not `COMMENTED`), so requiring `1`
  would lock a solo maintainer out — the comment-review convention stays hook/practice-enforced, not
  server-side; and `enforce_admins=false`, which is what lets the maintainer merge their own
  commented PR but also means **an admin can still bypass with a direct push** (fork/non-admin
  contributors are fully bound).
- `protected-write` keys on branch **name**, not repository identity, so pushing to your own fork's
  `main` is refused. `keel:sync` rebases against `upstream/<base>` instead.
- keel has **no role concept** — fork and same-repo PRs are judged identically. A solo release PR
  satisfies `reviewPolicy: "review"` by posting a `COMMENTED` review on your own PR.
- **Trunk conversion (2026-07-23):** the repo ran gitflow (`feature/*` → `develop` → `main`) until
  this date, when it switched to trunk topology and retired `develop` (which was content-identical
  to `main` at the time). All history below that predates the switch and describes the old two-branch
  flow. Historically relevant: `main` and `develop` were originally independent orphan commits with
  no shared history, forcing a one-off `git rebase --onto` on every cross-branch PR through v0.1.0;
  after v0.1.0 `develop` was re-rooted onto `main` (reconciled 2026-07-14) and back-merge PRs no
  longer needed rebasing.

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
  **Discord-direct login (2026-07-28):** `/login` skips the button page entirely and fires the
  OAuth redirect itself when Discord is the *only* enabled method — `isDiscordOnly(methods)`
  (`@/components/discord-redirect.tsx`, true only when `!magicLink && providers.length === 1 &&
  providers[0] === "discord"`) renders `DiscordRedirect`, which redirects on mount (a
  `useRef` guard against StrictMode's double-invoke) and still shows a real fallback button so a
  blocked redirect is never a dead end. Any other configuration — a dev box with magic-link
  enabled, a second provider, or a FAILED providers fetch — falls through to the ordinary
  `LoginPanel` button page; a fetch failure never guesses which method might work.
  **One gamertag per user:** a user holds at most one active (`pending`|`verified`) `gamertag_links` row —
  enforced by partial unique index `gamertag_links_user_active_uniq` (migration `0007`) + a
  `409 active_link_exists` guard in `POST /me/gamertag-links`; a `verified` link is admin-release-only.
  **Account surface = the controls rail (R3, replaced the status banner + masthead slot).** The whole
  onboarding/account surface is the R3 controls rail — see the Tabloid redesign section. One pure
  derivation `accountStatus({ signedIn, loading, links })` (`@/lib/account-status`, union
  `loading|signedOut|unlinked|pending|verified`) remains the single source of truth, read via
  `useAccountStatus()` (`useSession` + `useGamertagLinks` + `activeLink`). **`/account` and
  `/account/claim` no longer exist** (404); the link/verify flows moved in-rail.
  No backend change — `GET /me/gamertag-links` already serializes the challenge, so
  `useGamertagLinks` adds a **5s `refetchInterval` while a link is pending** (progress ticks live, stops
  when nothing is pending, and never polls signed-out visitors). `QueryProvider` lives at the **root
  layout** (one app-wide TanStack Query cache), and `useGamertagLinks(enabled)` gates its fetch so
  logged-out visitors don't 401 on `/api/me/gamertag-links` every page.
- **SP3 — Death-ban enforcement** ✅: `apps/enforcer` bans a player 24h when a qualified life dies
  (per-server Nitrado ban list, name-based). **`ENFORCER_DRY_RUN` defaults to `true`** — logs
  intended bans without writing to Nitrado; set `false` to enforce. `bans` table is durable
  (never rebuilt).
  **⚠️ Bans are placed against `bans.dayz_id` (the stable DayZ account hash) AND the gamertag,
  via the batched `addBans`/`removeBans` — never the single-entry `addBan`/`removeBan`, which
  would be one whole-field read-modify-write of the Nitrado ban list per entry, with a
  lost-update window between them.** The ID is what survives a gamertag rename: an audit of
  production found two accounts using five gamertags between them and 22 connections under a
  different name during an active ban window. `dayz_id` is frozen onto the ban row at creation
  (migration `0023`), never resolved through `players` later, because the deferred identity-merge
  work will make a historical gamertag stop resolving. A null `dayz_id` degrades to name-only.
  **⚠️ Corollary — never enable `ENFORCER_DRY_RUN` while a ban is `applied`.** Under dry-run the
  expire/lift arms mark the row `expired`/`lifted` *without* calling Nitrado, and no query
  revisits a closed row — so the entries stay on the Banlist forever. Now that one of them is the
  account hash, that orphan is **permanent and unshakeable** (a rename used to shed the name-only
  orphan). Recovery is manual Banlist editing; the precheck is in `deploy/README.md`.
  Two further consequences of banning by ID, both bounded to one ban duration and both rooted in
  pre-existing behaviour rather than this feature: `players.dayz_id` is written once at
  `createPlayer` and never updated (`packages/projections/src/fold.ts`), so a **recycled gamertag**
  would attach the *previous* owner's hash to a new player's ban; and two simultaneously-`applied`
  bans for one account share a single list entry, so the earlier expiry frees the later ban (fails
  open, not closed).
  Nitrado's ban list accepting a player ID was **verified empirically** against a live server —
  public documentation says console servers are gamertag-only, and is wrong.
- **SP4 — Unban-token economy** ✅: `@onelife/tokens` (ledger; balance = SUM of deltas; idempotent
  grants) + `apps/granter` sweeps. Token on verification, monthly + referral grants, self-unban
  (redeem → ban `lift_pending` → enforcer removes under the dry-run gate), and transfers. API
  routes + a web wallet on the account page.
- *(historical — pipeline REMOVED 2026-07-27, see the Login avatars entry below and
  `docs/superpowers/specs/2026-07-27-login-avatars-design.md`)* **SP5 — RPT ingest + character
  mapping**: `@onelife/rpt-parser` correlation state machine +
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
- **Survivors leaderboard** ✅: public, mobile-first live leaderboard of every currently-alive
  survivor (**alive** = open qualified life: `lives.endedAt IS NULL` and `isLifeQualified`), one row
  per (player × server).
  **⚠️ REWRITTEN BY SUB-PROJECT D2 — the whole sort layer is deleted.** There is **one board per
  map, ranked by time alive descending, and no combined board**. `/survivors/[map]` (by
  `servers.slug`) is the board and is the stable, shareable, indexable URL; the bare `/survivors`
  is a **per-viewer redirect** through the shared map-resolution rule (see the D1 entry), carries
  `robots: { index: false }`, and must never appear in the sitemap. Gone entirely:
  `/survivors/kills`, `/survivors/longest`, the `/survivors/[map]/[sort]` route tree, the
  explicit-default redirect, the `GET /survivors` API route, `SORTS`/`DEFAULT_SORT`/`isSort`,
  `TIE_ORDER`/`metricFor`, the sort pills, the **All maps** tab, and the per-row map label.
  **⚠️ THE RESERVED-SLUG RULE IS GONE, NOT MERELY UNENFORCED.** A server's `servers.slug` **may
  now be `kills`, `time` or `longest`**. Those words only ever mattered because they shadowed a
  slug in the depth-1 segment; with no sort segment there is nothing to shadow. Do not
  reintroduce the constraint "defensively" — a test in `board-params.test.ts` asserts such a slug
  resolves to its own board.
  One pure `resolveSurvivorsRoute(segments, slugs)` (`apps/web/src/lib/board-params.ts`) still
  drives resolution, now trivially: exactly one segment, which must be a known slug, else
  `notFound()`. It never returns a redirect. All board URLs are built by the pure
  **`boardHref(slug, page)`** (drives `SurvivorControls`, `Pagination`, canonical/OG/JSON-LD, and
  the sitemap); `buildTabs` returns one tab per slugged server, alphabetical by label.
  **R2 restyle (still current):** the visible `<h1>` is `{Map} survivors` (the SEO phrase
  `Top {Map} survivors` — no `by {sort}` clause since D2 — lives only in `<title>`/OG via
  `survivor-metadata.ts`); rows are **tiered by global rank** (`tierFor`,
  `@/components/survivors/format`): rank 1 = hero row on tint with a 96px avatar and the
  only stat label, ranks 2–5 = podium rows with 60px avatars, 6+ (and all of pages 2+) = compact
  text rows with a 28px initial-disc avatar. **Every row shows time alive and nothing else** — kills and longest
  kill survive as TIE-BREAKS in the read-model, never as a displayed stat; the hero row keeps a
  kills flourish. Portraits are decorative
  (`alt=""`, no img role — tests query the DOM directly). Pagination is a mono-box bar with a
  clamped `showingLine` and non-focusable disabled edges; board + dossier routes have `loading.tsx`
  skeletons (`@/components/skeletons`). Backed by the `getAliveSurvivors` read-model
  (`packages/read-models/src/survivors.ts`; **one tie-break chain** — time alive → kills → longest
  kill → gamertag, via a NaN-safe skip-if-equal comparator, which is load-bearing because two
  survivors with no ranged kills both metric to `-Infinity`) and the public
  `GET /survivors/:slug` API route. **⚠️ The `sort` query parameter is DROPPED from the Zod
  schema, not accepted-and-ignored** — silently tolerating a dead parameter is how a caller comes
  to believe it still works. **Avatar/account pass:** portraits are login avatars now, not
  character art — a verified, non-tombstoned `avatars` row's hash, silhouette/initial-disc
  fallback otherwise. Gamertag filtering was scoped out of this pass.
- **Player pages** ✅: a public, SEO-optimized profile at `/players/[slug]` — a cross-server totals
  hero, per-server current standing (alive / banned / idle) with a live ban countdown, paginated
  past-life history (since R2: compact **funeral cards** — map, dateline, death line, and a
  kills/longest-kill/sessions counts strip only; the per-life kill lists + vitals now live on the
  R4 life-timeline page, reached via `TIMELINE →` links on the standing + funeral cards), a
  dynamic OpenGraph share image, and
  `ProfilePage` JSON-LD. The slug is the gamertag slugified (`playerSlug`, `@/lib/slug`) and resolved
  back via `resolveGamertagBySlug` (`packages/read-models/src/player-aggregate.ts`); the page is
  powered by a new `getPlayerPage` read-model (`packages/read-models/src/player-page.ts`) and an
  extended `GET /players/:gamertag` API route. **Owner-only self-unban:** the page's signed-in owner
  (session gamertag matches the page, and their link is **verified** — pending/unverified visitors
  never see the control) can spend an unban token to lift their own ban, in four states
  (`UnbanState`: hidden/ready/no-tokens/pending) driven by `SelfUnbanButton`/`UnbanView`
  (`apps/web/src/components/player/self-unban-button.tsx`). Gamertags across the site (survivor
  board rows, kill lists, death-by attributions) now route through a shared `GamertagLink` component
  to `/players/{slug}`. A `/welcome` post-login resolver (`apps/web/src/app/welcome/page.tsx`)
  sends a verified user straight to their player page and everyone else to `/` (the rail carries the
  next action). Since R3, `SelfUnbanButton` reads the balance from the shared `["tokens"]` query and
  invalidates `["tokens"]`+`["player-page"]` on redeem, so the dossier and the rail stay in sync.
  **Redesign (v0.11.0):** single roomy column, everything always visible (no `<details>`
  expand/collapse). The hero is **avatar-free** with a full-width stat band via the shared
  `heroStats` helper (`@/components/player/format`) — always Lives / Deaths / Longest life; **Kills
  only when > 0**; since R2, **Deaths is the red-highlighted (`hot`) stat** (the OG card inherits
  this via `heroStats`), plus a first-seen over-line (`aliveMaps` helper), a blue `Alive ×N` skew
  badge, and a red rubber-stamp Verified mark. Current-standing cards are
  **state-colored** (green alive / red banned / neutral idle); past-life cards are **muted archive**
  styling to read as history. Past lives are **paginated** — `getPlayerPage(db, gamertag, now, { page,
  pageSize })` (`PLAYER_PAST_LIVES_PAGE_SIZE = 10`) gathers the lightweight full set for totals +
  ordering but **enriches only the visible slice** (O(pageSize) kills/sessions/character), returns
  `pastLivesTotal/Page/PageSize`, and **no longer returns `heroCharacter`**; `GET /players/:gamertag`
  takes `?page=` (Zod `.catch(1)`) and the page route's canonical is page-aware
  (`?page=N` for N>1, `PlayerPagination` control). The OpenGraph image (`opengraph-image.tsx`) is a
  **survivor dossier** — the real logo + the **logo-skull only** motif, callsign in real casing,
  "Surviving since {MON YYYY}," and the same `heroStats` readout, rendered in Oswald/Space Mono from
  co-located `.ttf`/`logo.png`/`skull.png` assets (read via `fs.readFile`, since the Node OG runtime's
  `fetch` can't read `file:` URLs).
  **Map naming:** a server's `servers.map` is the DayZ mission **codename** (`chernarusplus`, `sakhal`,
  `enoch`); player-page display labels come from `mapLabel` (`@/components/player/format` — `enoch` →
  "Livonia", unknown codenames title-case as a fallback). The per-life API route
  `GET /players/:gamertag/:map/lives/:n` takes a server **slug** (not a codename) and resolves it via
  `resolveServerBySlug` — **no hardcoded map allow-list**, so adding a server (e.g. Livonia) stays a
  pure `servers` insert; an unknown slug is a `404`.
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
- **Tabloid redesign** (R1+R2+R3+R4 shipped): a visual relaunch replacing the old
  dark "field journal" theme with a light "Clean Glossy" tabloid look. Roadmap + full R1 design:
  `docs/superpowers/specs/2026-07-16-tabloid-redesign-design.md` — **R1** design system + shell,
  **R2** boards restyle (survivors + player dossier;
  spec `docs/superpowers/specs/2026-07-16-r2-boards-restyle-design.md`), **R3** controls rail
  (spec `docs/superpowers/specs/2026-07-16-r3-controls-rail-design.md`), **R4** life timeline
  (spec `docs/superpowers/specs/2026-07-17-r4-life-timeline-design.md`). The R5 tiers (R5a–R5d)
  built the content engine and are **retired** — see the Content engine retired entry below.
  **R4 shipped — the life timeline.** A public per-life page at
  `/players/[slug]/[map]/lives/[n]` (canvas 14a): a character-portrait hero (`LifeHero`, the life's
  resolved `getLifeCharacter` → `/characters/<name>.webp`) with a **factual** `Life {n} · {mapLabel}`
  headline + a Time-alive/Kills/Longest-kill/Sessions/Qualified stat
  band, and a newest-first event **`Timeline`** (`@/components/life/`). The event list is built by a
  pure **`buildTimeline(data, now)`** (`@/lib/life-timeline`): birth → life qualified → session
  starts (consecutive **kill-free** sessions collapse into one `Sessions N–M` row) → kills (a yellow
  **Longest kill** chip on the max-distance kill) → the terminal `death` row (carrying the
  **vitals at death** — energy/water/bleed — this is where R2's dropped per-life detail returns) or,
  for an open life, a live **Still drawing breath** row. **Captions are deterministic + factual — no
  LLM**. **Location was voice-only at R4 ship time; it no
  longer is.** A "Positions withheld" notice still renders **only while a life is alive** to
  everyone except the verified owner of that gamertag — coordinates **have always been stored**
  (the `positions` table, populated since SP1) and, since the owner-only life location map
  sub-project below, **are shown**, to that one person, in place of the withheld notice. What
  remains true, and is why every marker on that map is approximate: kills and deaths themselves
  still carry no recorded coordinates. Standing + funeral cards link in via a pure **`lifeHref(gamertag, mapSlug,
  lifeNumber)`** (`@/lib/life-href`); `AliveStanding` gained a `lifeNumber` for the alive-standing
  link. Backed by **`getLifeTimeline`** (`packages/read-models/src/life-timeline.ts`, composing
  `getLifeDetail` + `getLifeKills` + `getLifeCharacter` + `lifeQualifiedAt`) and the extended
  `GET /players/:gamertag/:map/lives/:n` route (now returns `kills` + `qualifiedAt` + `gamertag`/`map`/
  **R3 shipped — the controls rail is the whole account surface.** Root layout is an `xl:`
  two-column grid (`max-w-[1440px]`, `[minmax(0,1fr)_380px]`): pages flow in the main column
  (ink right-border at `xl`), the **`ControlsRail`** (`@/components/controls/`) is the sticky right
  column, and below `xl` a fixed **`ControlsPill` + `ControlsSheet`** (bottom sheet) replace it
  *(superseded by pill re-homing, UX review sub-project 4, below — `ControlsPill` is retired; the
  sheet is unchanged but now opens from a masthead trigger, `MobileAccount`)*. All
  three surfaces are driven by **`useControls`/`useControlsActions`** over the `accountStatus` union:
  signed-out → sign-in CTA (rail; on mobile a fixed **`SignInPill`** floating box → `/login`, so
  logged-out mobile visitors don't scroll to the footer to sign in — **also retired, see below**);
  unlinked → identity + in-rail
  gamertag link panel (autocomplete over `GET /players/search`, race-guarded); pending → in-rail
  "prove it's you" emote challenge (live via the 5s poll); verified → identity + Verified stamp +
  **tokens panel** (balance, send-by-gamertag, quiet referrer) + **server cards** (alive/no-life/banned;
  banned shows a live ban countdown + the shared `SelfUnbanButton` spend CTA). The **sign-out footer
  renders in every signed-in state** (rail `SignedInFooter` + mobile sheet) — the profile link only
  appears when verified — so an unlinked/pending user can always log out. Presentational
  pieces are props-only + unit-tested; `useControls`/containers are thin (untested, per convention).
  **⚠️ THE TWO-SURFACE TOKEN RULE — NARROWED BY SUB-PROJECT B, NOT DELETED.** It used to govern
  the rail (light paper) versus `ControlsSheet` (`bg-dark`): any panel mounted on both had to swap
  its text/border/tint tokens or render **ink-on-dark — present in the DOM, fully functional,
  invisible on a phone**, exactly how the notifications panel shipped in v0.26.0. B deleted the
  sheet, so every account panel is light-surface only and the `boxed` variants are gone.
  **The failure mode is still live for `NotificationRow`/`NotificationList`**, whose bell popover
  is dark and whose `/notifications` inbox is light — those two still need their variants.
  **RTL asserts the DOM, not contrast, so the whole web suite stays green** on this class of bug;
  any component mounted on both a dark and a light surface needs a test pinning the swap itself.
  **The notifications restructure removed the notifications panel from both the rail and the mobile
  sheet** (`controls/notifications-panel.tsx` deleted; `useControls` dropped its notification fields
  + `markRead`) — notifications moved to a masthead bell + the permanent `/notifications` inbox
  (see the Player notifications sub-project entry). The ⚠️ two-surface token rule above now applies
  to `NotificationRow`/`NotificationList` instead: the bell's popover is dark, the inbox page is
  light, and each needs its own token variant for exactly the reason the old panel did.
  The web API client **`apiSend` attaches `content-type: application/json` only when a body is present** —
  a bodyless `DELETE` (cancel claim) with the header set is rejected by Fastify as an empty JSON body (400).
  The mobile menu and sheet share **`useModalBehavior`** (`@/lib/use-modal-behavior` — focus trap,
  Escape, scroll lock, focus restore; keyed on `open` only via an `onCloseRef` so parent re-renders
  don't steal focus). **`POST /me/tokens/transfer` and `POST /me/referrer` take a verified gamertag**
  (`{ toGamertag }`/`{ referrerGamertag }`, resolved case-insensitively against verified
  `gamertag_links`; `not_verified` on miss), not a raw user id. **Both token fields (send + referrer)
  autocomplete over verified players, excluding the signed-in user** — a `searchVerifiedGamertags`
  read-model (`packages/read-models/src/claimable.ts`, verified mirror of `searchClaimableGamertags`)
  served at public `GET /players/search/verified` (a static route alongside `/players/search`), with
  client-side case-insensitive self-exclusion. The claim field and both token fields share one
  presentational **`<GamertagAutocomplete>`** (`@/components/controls/gamertag-autocomplete` — debounce,
  race guard, skip-after-pick, absolutely-positioned overlay dropdown; `fetchSuggestions` is injected,
  so pass a **stable** reference); `TokensPanel` takes `myGamertag?` (from `rail`/`mobile-account`,
  the latter renamed from `mobile-controls` by pill re-homing, UX review sub-project 4)
  as its `exclude`. **R3 also closed the R1 compat-shim
  story:** the legacy token aliases and `font-hand` are deleted, `--tint` was renamed **`--bone`**
  (brand "Bone" surface), the `ui/` primitives (Button/Input/Table) are gone, and the login page was
  restyled into the tabloid language. **R1 shipped:** Paper/Ink/Red RGB-triple design tokens
  (`globals.css` + `tailwind.config.ts`); a dark masthead with a raster wordmark and the nav
  (originally 5 items; now Survivors · Maps · About) plus a full-screen mobile menu; a dark
  mono footer; a front-page shell (manifesto hero, top-5 survivors, sign-in CTA); a live About
  page with bureau/server cards;
  a brand favicon kit + wordmarks vendored
  from the sibling `../brand` repo (source of truth, no cross-repo build dependency); and the
  player OG card moved onto the brand palette. Fonts are Oswald + IBM Plex Mono via
  `next/font/google`; Anton (the wordmark's display face) ships only inside the raster wordmark
  assets, never as a webfont. The mobile-controls polish pass gave the sheet swipe-dismiss
  (`useSheetDrag`, header-zone only), a two-phase motion-safe enter/exit, and a route-change close
  *(this behavior lives on the sheet, not the trigger, so pill re-homing, UX review sub-project 4,
  left it unchanged — only `mobile-controls.tsx`'s trigger + mount point moved, into
  `mobile-account.tsx`)*; the controls dark surface uses four named tokens — `dark-well`/
  `dark-hollow`/`dark-edge`/`dark-edge-bright` — no raw hexes (grep-gated).
  **Contrast & type floors (UX review sub-project 1) shipped:** plain `--red` (3.7:1 on paper)
  is now display-only — reserved for ≥19px-bold text, borders, tints, and stamps — with every
  smaller red text run moved to `--red-deep` (5.8:1), per the RED POLICY comment at the tokens
  in `globals.css`. A three-tier type floor is likewise documented there (TYPE FLOORS comment):
  reading prose sits at a 16px floor (`text-base`) with a 68ch measure, functional content at
  an 11px floor, and decorative overlines/chrome may drop to 10px only when the same
  information also exists elsewhere — enforced by the `src/type-floor-guard.test.ts` tripwire.
  **`--red-deep` is a light-surface (paper/bone) token only** — on DARK surfaces the ratios
  invert (plain red ~5.1:1 passes AA, red-deep ~3.2:1 fails), so dark surfaces keep `red`/
  `red-soft`, never `red-deep`.
  **Screen-reader structure (UX review sub-project 2) shipped** (spec
  `docs/superpowers/specs/2026-07-21-sr-structure-design.md`): a status-message policy — a DOM
  change from a user action or a background poll, with no accompanying focus move, announces
  through a shared `role="status" aria-live="polite"` `SrStatus` (`@/components/shared/sr-status`),
  including a persistent `VerificationAnnouncer` that outlives the pending→verified panel swap
  (mounted as an unconditional sibling, never inside the branch it announces) and is gated
  `xl:hidden` on the mobile sheet so it doesn't double-announce "Verification complete" against
  the rail's own copy at `xl`; list semantics (`role="list"`/`<li>`, `<ol>` for the life timeline)
  on the notification, standing/past-life, and timeline collections; the gamertag autocomplete is
  a full WAI-ARIA 1.2 combobox-with-listbox with an always-present announced result count; and web
  a11y tests query by ARIA role rather than DOM structure.
  **Live-data honesty (UX review sub-project 3) shipped** (spec
  `docs/superpowers/specs/2026-07-21-live-data-honesty-design.md`): an audit of every live/derived/
  polled surface found the UI presenting state as current/confirmed when it was stale, phantom, or
  fabricated — a dry-run ban (never actually placed on the game server) rendered as a real "Banned"
  standing and could burn a real unban token; the life-timeline "time alive" outran the survivor
  board/dossier for a ghosted player; an expired ban countdown floored at a dead "0h 0m" forever;
  three loading/error paths fabricated an authoritative "0 tokens"/idle/empty. Plus one small fix:
  the player-page OG card now says "First seen" (was "Surviving since," which implied continuous
  survival). **Invariants a future change would silently break (don't "tidy"
  them back):**
  1. **A ban is real only if `dry_run=false`.** `packages/read-models/src/player-page.ts`'s
     `activeBans` query and `packages/tokens/src/redeem.ts`'s candidate query both filter
     `and(…, eq(bans.dryRun, false))` alongside their existing status filters
     (`ACTIVE_BAN_STATUSES` / `["pending","applied"]`, both unchanged) — do not widen either back.
     A dry-run ban must never render as banned or be spendable. Backlog: the enforcer's expire arm
     only touches `status='applied'`, so a dry-run `pending` ban never expires (moot now that it's
     invisible to both display and spend); already-spent phantom redemptions are not migrated.
     **⚠️ And an active real ban OUTRANKS a newer open life in the per-server standing**
     (`getPlayerPage`, `player-page.ts`): the branch order is `banned > alive > idle`, NOT
     `alive > banned`. A life ends on DEATH — never on disconnect or on being banned — so after a
     player dies on a qualified life (real ban placed) and respawns past the 5-minute threshold
     before the enforcer poll lands, both an active `bans` row and an open qualified life
     (`profile.alive`) persist for the whole 24h. If the alive branch won, the card would read
     "Alive" and the self-unban control (which renders only on a `banned` card) would be unreachable
     for the entire ban. Do not reorder these branches back; the standing self-heals to Alive once
     the ban lifts/expires. Pinned by the "respawn race" test in `test/player-page.test.ts`. Two
     intended second-order effects, not regressions: such a server no longer counts toward
     `aliveAnywhere` / the hero `Alive ×N` badge (a banned player isn't alive); and an
     expired-but-still-`applied` ban the enforcer hasn't reconciled yet now also outranks an open
     life (bounded — `banCountdown` degrades to "Lifting…", self-heals on the next enforcer poll).
  2. **Presence-implying durations cap at `lastSeenAt ?? connectedAt ?? now`**, matching
     `survivors.ts`'s `livePlaytime` cap and the dossier's `queries.ts` cap EXACTLY — **no clamp to
     `now`** (a `Math.min(now, …)` clamp diverges from those two under clock skew, since
     `servers.clockOffsetMs` means a real `lastSeenAt` can land a few seconds ahead of request-time
     `now`). The life-timeline (`apps/web/src/lib/life-timeline.ts`'s `liveTimeAlive`) was the last
     surface brought into line; its NOW row also dropped "and counting" (a server-baked snapshot
     that never ticks).
  3. **`banCountdown` (`apps/web/src/components/player/format.ts`) returns `null` past expiry**,
     never a clamped "0h 0m." Every render site (`standing-card.tsx`, `controls/server-cards.tsx`,
     `controls/sheet.tsx`) branches on null to a terminal "Lifting…" state, not a dead-looking live
     timer.
  4. **Loading/error is never rendered as an authoritative zero/empty.** `useControls` exposes
     `standingLoading`/`balanceLoading`; surfaces (`self-unban-button.tsx`, `TokensPanel`,
     `ServerCard`/`SheetServerRow`, the pill chip, `pillStatus`) gate on them instead of falling
     through to a `?? 0`/`[]`-means-idle default; the home page's four feed fetches distinguish a
     resolved-empty desk from a failed fetch via `settleFeed` + a `FeedFailedBanner`. (The pill chip
     and `pillStatus` were later deleted as dead code by pill re-homing, UX review sub-project 4 —
     the invariant now holds on the remaining surfaces only.)
  **Pill re-homing (UX review sub-project 4) shipped** (spec
  `docs/superpowers/specs/2026-07-21-pill-rehome-design.md`): the mobile account surface is no
  longer a floating pill fixed to the bottom of every page — it is now a **masthead trigger**
  (**`MobileAccount`**, `@/components/controls/mobile-account.tsx`) that colocates the trigger and
  the existing `ControlsSheet` (plus their shared open-state), mirroring how `MastheadBell` owns its
  button + popover + state: an avatar-disc button when signed in (`aria-haspopup="dialog"`,
  `aria-controls="controls-sheet"`) opening the sheet, a compact "Sign in" chip when signed out
  (replacing `SignInPill`), nothing while `loading`; the trigger itself is `xl:hidden` (`MastheadBell`
  is not — it still renders at every width). The masthead right cluster (`header.tsx`) — previously
  the bell alone self-positioning `absolute right-4` — now wraps both in one positioned `flex` box so
  they sit side by side without colliding. **`ControlsPill`/`SignInPill`
  (`controls/pill.tsx`) and `mobile-controls.tsx` are retired — do not reintroduce a fixed-bottom
  account pill.** The content column's `pb-24` bottom gutter is gone (no floating chrome remains to
  reserve space for). Only the trigger and its location moved: the sheet, its drag-to-dismiss, focus
  management (restored to the masthead trigger for free — `useModalBehavior` already captures
  `document.activeElement` on open), the `VerificationAnnouncer`, and every panel inside the sheet
  (identity, link/verify, tokens, server cards, self-unban, the SP2 live regions, the SP3 loading
  affordances) are unchanged.
  **⚠️ THE APP HAS EXACTLY THREE Z-ALTITUDES — the LAYER LEGEND at the `<header>` in
  `header.tsx` is the source of truth.** `z-auto` page content → **`z-40` masthead** → **`z-50`
  full-screen overlays** (the skip-to-content link in `app/layout.tsx`). Since sub-project B the
  `z-40` layer has two occupants — the masthead and the mobile `TabBar`
  (`components/shell/tab-bar.tsx`) — which never overlap spatially and so share it rather than
  adding a fourth altitude. The masthead **must** be a positioned layer: the bell popover's own
  `z-50` only ranks it *inside* the right cluster, whose `-translate-y-1/2` opens a stacking
  context — so without a layer on the header, any later-in-DOM positioned-at-`z-auto` element
  paints over the popover (the `xl:sticky` `HomeSidebar` — **`sticky` opens a stacking context
  regardless of z-index** — and any later `relative` wrapper). That was the v0.29.6 bug: notifications rendered *behind* the
  page. The masthead must equally stay **strictly below 50** — the skip link renders *before*
  the header, so an equal value is decided by DOM order and silently buries the only control
  keyboard users have. Both halves are one-directional: raising the masthead breaks a11y,
  removing it breaks the popover. jsdom cannot observe paint order, so `header.test.tsx` pins
  the altitude numerically (`0 < z < 50`) and the real ordering was verified with
  `elementFromPoint` in a browser.
- **Sitemap + robots.txt** ✅: `apps/web/src/app/sitemap.ts` (`force-dynamic`; the hourly window is
  on the FETCH, not the route — see the ⚠️ below) and
  `apps/web/src/app/robots.ts`, fed by `getSitemapEntries` (`packages/read-models/src/sitemap.ts`)
  through public `GET /sitemap`. A few hundred URLs today against a 50,000 limit, so there is deliberately
  **no sitemap index and no `generateSitemaps`**. Spec
  `docs/superpowers/specs/2026-07-21-sitemap-design.md`.
  **⚠️ The sitemap must never advertise a URL that 404s or redirects.** A life's map segment is a
  `servers.slug` and a life on an un-slugged server is omitted entirely; only players with at least
  one life are listed; board URLs are built with `boardHref`,
  **which collapses the default sort for you** — hand-building `/survivors/time` would advertise a
  redirect. Each rule is mutation-tested (removing the clause makes a named test fail).
  **`lastmod` is real** — life `ended_at ?? started_at`, player `MAX` of their
  lives' activity. A `new Date()` would train crawlers to ignore the field; static and board entries
  carry none at all.
  **The payload carries `gamertag`, not a slug.** The web builds the path with `playerSlug`, the same
  function behind every other player link, rather than adding a third copy of the slug rule
  (`read-models` already hand-syncs `slugNorm` — see the note at `player-aggregate.ts:19`).
  **⚠️ The two fetches degrade INDEPENDENTLY** (separate try/catch): losing the server list must not
  cost the ~470 content URLs, and vice versa. A single shared try/catch passes the "data fails" test
  and silently guts the sitemap — pinned by a test proven red against exactly that change.
  **⚠️ The route is `force-dynamic`, and `export const revalidate` must NOT be restored.** Making it
  static/ISR means `next build` prerenders it and fetches the API at build time; the build does not
  run alongside a serving API, so it fails outright (three 60s attempts, then `Export encountered an
  error on /sitemap.xml/route`) — and a fetch timeout only downgrades that to a *baked* sitemap
  holding the static + board entries alone, which ISR then serves for an hour, missing every player
  and life URL. The hourly enumeration window instead lives on the fetch: `apiGetCached`
  (`@/lib/api`) sends `next: { revalidate }` and, unlike `apiGet`, never awaits `cookies()` and
  never forwards a cookie header — a crawler's cookies have no business reaching a shared cache
  entry. Do not point the ordinary `getServers()` at it; authenticated RSC pages need the
  cookie-forwarding version.
  **`lives.life_number` IS the URL segment here** — this generates the URL the router itself
  resolves by number.
  The home entry uses `SITE_URL` directly, not `absoluteUrl("")`, which would emit a trailing slash.
  AI crawlers are deliberately **not** blocked — the paper wants citations.
- **Cross-linking, PR-1** ✅: links between players and lives that need no schema change.
  Controls-rail + mobile-sheet server cards link to the life they describe.
  Spec `docs/superpowers/specs/2026-07-21-cross-linking-design.md` (§4 = this PR; §5/§6 covered the
  article cross-links, retired with the content engine).
  **Two href builders, and picking the wrong one is silent:** `lifeHref(gamertag, mapSlug, n)`
  slugifies for you; **`lifeHrefBySlug(playerSlug, mapSlug, n)`** takes an ALREADY-slugified
  callsign and is what the rail/sheet use (they hold `ownSlug`). Passing a slug to `lifeHref`
  double-slugifies; passing a gamertag to `lifeHrefBySlug` leaves it unslugified.
  **⚠️ The map segment of a life URL is a `servers.slug`, NEVER `servers.map`.** The route resolves
  it with `resolveServerBySlug` (404s on a miss — see the comment at
  `apps/api/src/routes/player-aggregate.ts`); `map` is the non-nullable mission codename
  (`chernarusplus`/`enoch`), which is display-only, via `mapLabel`.
  **A life link renders only when its life number is known.** `ban.triggeringLifeNumber` and
  `ServerStanding.lastLifeNumber` are both nullable; a null renders NO link, never `/lives/0` or
  `/lives/undefined`. Specifically, when a ban cannot be matched to its triggering life the banned
  card shows no link — it deliberately does **not** fall back to the most recent life, because a
  banned card's whole claim is "this ban came from this life." `lastLifeNumber` on an **idle** card
  does resolve to the most recent life; that fallback is correct there and only there.
- **Death-cause fidelity, stage 1** ✅: the archived platform's interpretation layer, ported.
  `classifyDeath` (`@onelife/domain`, pure, mechanism-first ladder + side-effect subtraction,
  thresholds 1/1/120s) turns mechanism + death vitals + a 120 s `hit_events` window into a verdict
  (`starvation|dehydration|bled_out|mauled|…`, `high|low` confidence, conditions). Computed lazily —
  never materialized (no migration/rebuild; the `isLifeQualified` precedent) — by the new
  `life-dossier` read-model (`dossierForLife`/`getLifeDossier`/`dossierVerdict`, plus ordeals:
  encounter-collapsed infected/fire/pvp hits, hpLow, builds). Surfaces: `getLifeTimeline` +
  `getPlayerPage` visible slice → API → web (`verdictPhrase`, shared `@/lib/cause-format`) on the
  timeline death row and funeral cards. **PvP keeps the literal `"pvp"` everywhere.**
  **Stage 2 shipped — richer parser vocabulary + backfill.** The parser's non-player `killed by X`
  branch maps entities through an ordered dict (`Animal_CanisLupus*`→`wolf`,
  `Animal_UrsusArctos*`→`bear`, other `Animal_*`→`animal`, `Zmb*`→`infected`, `FallDamage`→`fall`,
  **base-game vehicles (`CivilianSedan`/Olga, `Hatchback_02`/Gunter, `Sedan_02`/Sarka,
  `Offroad_02`/Humvee, `OffroadHatchback`/Ada, `Truck_01_Covered`/M3S, `Boat_01`; prefix-matched)
  →`vehicle`**; unmapped→`environment`; `explosion` still reserved) and
  captures the raw entity as `deathEntity` on the event payload (no `lives` column, zod `nullish`).
  `classifyDeath` passes them through as stated mechanisms; priors' `usualDeathCause` aggregates over `causeFamily`
  (`@onelife/domain` — wolf/bear/animal → "animal"); `causeLabel` reads `fall` as "Fell" and a
  bare `died` as "Unknown".
  **A fatal fall is logged TWICE and inconsistently — the entity dict alone cannot catch it.** DayZ
  writes the fall on a *hit* line (`hit by FallDamageHealth`, `[HP: 0]`) and then a death line with
  **no `killed by` clause at all**, unlike an animal or infected kill. `ENTITY_CAUSES` only reads the
  killer clause, so these deaths land as a bare `died` → `unknown`. `classifyDeath` therefore carries
  a **fall rung**: a `hit_events` row in the 120s window whose `attackerLabel` starts with
  `FallDamage` and whose `victimHp <= 0` is the killing blow → `cause: "fall"`, `high` confidence.
  It sits **above** the starvation/dehydration/bleeding inferences (a starving man who falls died of
  the fall; hunger stays in `conditions`) and **below** every stated mechanism. A non-terminal fall
  hit is ignored. This is why `RecentHit`/`DossierRecentHit` carry **`victimHp`** — the read-model
  already queried it and dropped it in the mapping, which is what made the evidence unreachable.
  **A verdict that names a mechanism must also outrank the raw cause on the web** — `verdictPhrase`
  (`@/lib/cause-format`) falls back to `causeLabel(cause)` for any verdict with no `VERDICT_NOUN`
  entry, and for a fall the raw cause is a bare `died` → "Unknown". `ENTITY_VERDICTS` there mirrors
  `ENTITY_MECHANISMS` in `@onelife/domain` (duplicated deliberately — `apps/web` has no dependency
  on that package); **add a new mechanism token to both**, or the classifier will be right and the
  page will still say Unknown.
  Retroactive — verdicts are lazy, never materialized.
  **Deploy runbook (stage-2 release):** normal deploy → on the host run
  `apps/projector` `backfill-death-causes` (re-parses `raw_lines`, upgrade-only, prints the
  unmapped-entity survey — feed it back into the dict) → projection rebuild
  (`./deploy/deploy.sh --rebuild`, or `pnpm --filter @onelife/projector run rebuild` directly on
  the host). Lives, priors and web surfaces update retroactively.
- **Player notifications**: a new `apps/notifier` worker + web surface that tells a signed-in player
  about things that happened to their own account — a **seven-kind catalogue**: gamertag verified,
  tokens received/granted, ban applied/lifted, life qualified and survival milestone. (Two further
  kinds, `obituary_published`/`birth_notice_published`, shipped here and went with the content
  engine.) Every kind
  is generated **per user, scoped to their own gamertag/verified links** — the feature never
  surfaces another player's activity, matching the same verified-link boundary the account rail
  already enforces for self-unban and tokens. Rows land in a new durable `notifications` table (fed
  by six generator functions across `apps/notifier/src/generators/` —
  the two ban kinds and the two life kinds each pair up in one file — deduped by a unique
  `natural_key` per notification instance) and are delivered two ways: an in-app feed — a masthead
  **`MastheadBell`** (all widths, signed-in only, an anchored popover at `md+`, a link to
  `/notifications` below `md`; badge caps at `9+` with the real count in `aria-label`) and a
  permanent **`/notifications`** inbox page ("The Wire", also carrying the `PushToggle` on its
  single light surface, no `onDark`), both reading a **frozen-tint** model — `useNotifications` /
  `useNotificationSeen` (`@/lib/use-notifications`): mark-read stamps the query cache via
  `setQueryData` (never invalidates, so a read row doesn't flatten mid-glance) and a 60s
  `refetchInterval` reconciles in the background (`GET /me/notifications` +
  `POST /me/notifications/read`) — and opt-in browser Web Push (`push_subscriptions` table,
  VAPID-signed via `web-push`, a service worker + PWA manifest, `POST`/`DELETE
  /me/push-subscriptions`, public `GET /push/vapid-key`). The worker
  runs two independently-gated passes per tick: **generate** (forward-only `NOTIFIER_SINCE` cutoff —
  unset means OFF, never a silent epoch default that would flood every player with their whole
  history — plus `NOTIFIER_DRY_RUN`, defaults `true`) and **push** (its own `NOTIFIER_PUSH_ENABLED`
  kill switch, so delivery can be staged on after generation is already live; a subscription retires
  itself after repeated failures). **`life_qualified` windows on the qualification instant DERIVED at
  read time** — `apps/notifier/src/generators/lives.ts` loads every open life owned by a verified
  user on a slugged server (with its sessions + kills) and calls `lifeQualifiedAt()`
  (`@onelife/read-models`), not `startedAt`, which would miss a life that qualifies long after it
  started. **Qualification is deliberately never materialized** (the `isLifeQualified` precedent) —
  one source of truth, shared with the survivors board and the enforcer. There is
  **no SQL qualification prefilter**: `lives.playtime_seconds` only advances at session close, so
  `qualifiedLifeCondition` is stale mid-session and would blind the generator to exactly the case it
  exists for. The candidate set (currently-alive verified players) is small. Migration `0015` adds
  only the two new tables, so **this release deploys normally, without `--rebuild`**. Single-instance, at-least-once delivery (the push pass reads
  unpushed rows without a row lock). Runbook +
  env vars: `deploy/README.md` and the `NOTIFIER_*` block in `.env.example`.
  **Invariants a future change would break by accident (each one shipped as a review fix — don't
  "tidy" them back):**
  1. **The ban generators window on `bans.created_at` and `bans.lifted_at`, never `banned_at` or
     `expires_at`.** `banned_at` is the *death* time, so if ingest/projector lag exceeds
     `NOTIFIER_LOOKBACK_HOURS` the ban row lands already outside the window and the player is never
     told. `expires_at` is merely `banned_at + BAN_DURATION_HOURS`, which both announces old bans at
     go-live and drops one the enforcer expires late. `lifted_at` is stamped by
     `markExpired`/`markLifted`/`redeem`, including under `ENFORCER_DRY_RUN`.
  2. **`ban_applied` has no status or `applied_at` filter.** Under `ENFORCER_DRY_RUN` — the
     production default — `markApplied()` is never called, so rows sit at `pending` with a NULL
     `applied_at`; either filter would be always-false in the configuration we actually run.
  3. **Every generator floors its query at `windowStart(deps)`** (`max(since, now - lookback)`,
     `apps/notifier/src/types.ts`). Survival milestones shipped without it and would have fired all
     crossed thresholds at go-live and re-derived them every tick forever.
  4. **`NOTIFIER_DRY_RUN` / `NOTIFIER_PUSH_ENABLED` are `z.string().optional()` + `!== "false"`, not
     a `z.enum`.** `.default()` fires only on `undefined`, so a blank/mis-cased value threw out of
     `loadConfig` at module scope and crash-looped the unit. Unparseable input must land on the safe
     side.
  5. **The sender is built through the guarded `buildSender()`, never at module top level.**
     `webpush.setVapidDetails()` throws *synchronously* on a bad key or a subject missing `mailto:`;
     built eagerly, one typo killed the process before the loop and took generation down with it.
     Invalid VAPID ⇒ `null` ⇒ push off, generation continues.
  6. **`POST /me/notifications/read` marks only the ids the client rendered.** A blanket
     mark-all-unread against a feed that serves one page silently destroys any deeper backlog. The
     feed is paginated (`?page=`) and the ownership predicate stays in the WHERE clause. This still
     holds after the move to the masthead bell + `/notifications` inbox: the popover reports only
     its page-1 rows, and the inbox page reports each page as it loads — never a mark-all.
  7. **Sign-out deletes the push subscription row *before* `signOut()`**
     (`signOutAndTeardownPush`, `apps/web/src/lib/push.ts`, shared by the rail and the mobile
     sheet). After sign-out the DELETE is scoped to a dead session and matches zero rows, leaving a
     shared browser delivering the previous user's notifications. It never throws — a failed
     teardown must not trap anyone in a session.
- **Owner-only life location map** ✅ (spec
  `docs/superpowers/specs/2026-07-21-owner-life-map-design.md`): the life timeline page
  (`/players/[slug]/[map]/lives/[n]`) gains a route trail + kill/death/last-known-position
  markers for the signed-in owner of that gamertag alone, on both open and closed lives. This is
  the **first reader of the `positions` table** — populated since SP1, folded from every ADM
  `pos=<x, y, z>` line, but never previously queried by any read model or route.
  **The security boundary is the point of the design, not a checklist item added after:**
  1. **`GET /me/lives/:mapSlug/:n/track` takes no player identifier at all.** The subject comes
     solely from the session cookie → a `verified` `gamertag_links` row for that user. There is no
     gamertag/slug/userId parameter to add, ever — an equality check is something a later refactor
     can weaken without a test noticing; having no field to name another player in is not.
  2. **A `pending` link is never sufficient — only `verified`.** Anyone can type any gamertag into
     the claim box; only a link that survived emote verification unlocks coordinates (mirrors
     `self-unban-button.tsx`'s ownership gate).
  3. **`Cache-Control: no-store, private` on the response is load-bearing**, not decoration —
     without it a shared proxy or CDN can serve one owner's live position to the next visitor, the
     classic way a correct auth check still leaks.
  4. **Ownership is a WHERE-clause predicate in `getLifeTrack`, never a post-filter** — a life
     belonging to another player produces zero rows and a 404, so no intermediate value in the call
     path ever holds another player's coordinates for a bug to leak. Three separate gamertag
     predicates (lives, positions, kills) are each pinned by a mutation-verified test.
  **Every marker is approximate, because deaths and kills have never carried coordinates** — each
  marker is the nearest `positions` fix at or before the event. There is deliberately **no
  `approximate` boolean**; `sampleAgeSeconds` is non-optional, so a render site must actively
  discard it rather than silently omit an honesty flag. Past 900 seconds old, no marker renders at
  all — silent beats confidently wrong. A `now` marker (open life) carries `sampleAgeSeconds: 0` by
  construction — the fix *is* the event — with real staleness computed client-side against the
  clock; the accessible marker list and the map popup both route through one shared `staleness()`
  helper so they can never disagree with each other. Trail polylines are **per-session, never one
  line** — joining sessions draws a straight path across a logout/login the player never walked.
  **Rendering:** plain `leaflet` driven from a `useEffect`, deliberately **not** `react-leaflet`
  (its v4 doesn't support React 19); `TrackMap` is `dynamic(..., { ssr: false })` so a non-owner
  never downloads the chunk or Leaflet's stylesheet. The map container carries **`isolate`** —
  Leaflet's own controls sit at `z-index: 1000` and would otherwise paint over the `z-40` masthead
  and `z-50` overlays; this is the same LAYER LEGEND rule from `header.tsx`, applied to a new
  offender. Map tiles are a **host prerequisite** mirrored by `deploy/mirror-tiles.sh`, served at
  `/tiles/{map}/topographic/{z}/{x}/{y}.webp` (DZMap's own on-disk layer name, deliberately not
  renamed — renaming it would silently 404 a tree a direct loader run actually produces); tiles are
  **absent from the `pg_dump` backup** (reproducible from the mirror script, not worth putting
  hundreds of MB in Postgres for), and their absence **degrades** the map to a trail on a plain
  dark background rather than breaking it.
  ⚠️ **`CANVAS_PX` in `track-map.tsx` is an unverified assumption** — the tile pyramid's true pixel
  extent needs checking against real mirrored tiles on the host; a uniformly offset or scaled trail
  is the symptom of a wrong value. It's a parameter of `worldToPixel` precisely so that correction
  is a one-line fix, not a rewrite.
  No migration and no new table — this release deploys with a plain `./deploy/deploy.sh`, **no
  `--rebuild`**.
- **Friends, F1 — friendships + requests** ✅ (spec
  `docs/superpowers/specs/2026-07-21-friends-f1-design.md`): user↔user friendships addressed by
  **verified** gamertag — the same boundary self-unban and the token ledger already enforce. New
  `packages/friends` (the `packages/tokens` shape: pure logic + DB ops, no HTTP) owns every
  transition; `apps/api/src/routes/friends.ts` is six thin session-gated `/me/friends` routes; the
  web surfaces are a `FriendButton` on the dossier, the `/friends` **Roster** page, and a thin
  `FriendsPanel` in the rail + mobile sheet. **F1 of three** — F2 (location sharing) and F3
  (presence notifications) are surface-only follow-ups; their four columns
  (`a_/b_shares_location`, `a_/b_shares_presence`) ship **dormant in migration `0018`**, written by
  nothing and read by nothing, so neither needs a second migration. A reviewer seeing dead columns
  should find this line.
  **⚠️ Invariants a future change would break by accident (each shipped as a review fix — don't
  "tidy" them back):**
  1. **The pair is canonically ordered `user_a < user_b` under a CHECK constraint**, not by
     convention. The unique index alone would happily accept the mirrored duplicate
     `(user_b, user_a)`. Every write goes through `orderPair`; every read projects through
     **`viewOf`**, the single source of truth for viewer-relative status — never re-derive
     "incoming vs outgoing" inline.
  2. **The notification natural key is `friend_request:<senderUserId>:<friendshipId>:<seq>`.**
     `notifications.natural_key` is a **plain GLOBAL** unique index (so `onConflictDoNothing` takes
     **no `targetWhere`**). Drop `:<seq>` and the
     second request over a pair (decline → cooldown → re-request) is silently swallowed and the
     recipient is never told. Drop `<senderUserId>` and the rate limit below cannot be counted at
     all, since notifications are keyed by **recipient**.
  3. **The 20-per-24h rate limit counts `friend_request_received` NOTIFICATIONS, not `friendships`
     rows** — `cancel` hard-deletes the row while the notification survives, so a row-based count is
     reset by request→cancel→request spam while the target is still notified every time. It is
     `natural_key LIKE <prefix>%` with **`%`, `_` and `\` escaped** (an unescaped `_` in a generated
     user id is a single-char wildcard and wrongly rate-limits a different user), served by
     `notifications_natural_key_pattern_idx` (`text_pattern_ops`, migration `0019`). **Do not
     "simplify" it back to `starts_with()`** — that is not index-usable and seq-scans a table that
     grows across all nine other notification kinds.
  4. **`request()` takes `pg_advisory_xact_lock(hashtext(sender))` as its FIRST statement.** The
     count is otherwise a plain `SELECT` in READ COMMITTED serialised by nothing — `lockPair` locks
     a *different* row per target, and no row at all on a first request — so 200 concurrent requests
     to 200 targets all read `count = 0` and all pass. Lock order is total (advisory → row); nothing
     anywhere takes a row lock first.
  5. **The reciprocal-collision recovery runs inside a nested `tx.transaction()`.** Postgres aborts
     the transaction on the `friendships_pair_uniq` violation, and drizzle/postgres-js issue no
     per-statement savepoint, so a flat recovery dies on `25P02` and 500s. The nested transaction is
     a real `SAVEPOINT`; the recovery itself then runs on the **outer** handle.
  6. **`remove` DELETEs the row; `decline` keeps it.** A retained row is a retained F2 sharing
     consent, so nothing may survive a removal. `decline`'s `responded_at` **is** the 7-day cooldown
     clock, and a decline notifies **nobody** — "X declined you" is a hostile message with no action
     attached. A re-request after a decline reuses the row and bumps `request_seq`; after a removal
     it is a fresh row at `seq = 1`.
  7. **`accept`/`decline` throw `not_recipient` (403) for any non-recipient; `cancel`/`remove` throw
     `not_found` (404) for a non-party.** The asymmetry is deliberate.
  8. **Loading and error never render as an authoritative negative** — the live-data-honesty rule,
     which this feature violated four separate times in review: a default "Add friend" against an
     unknown relationship, a fabricated "Friends 0" on a failed fetch, a blank `/friends` for
     signed-out visitors, and an `SrStatus` announcing "Friend request accepted" at **click** time
     rather than on settlement (announcing success to a screen-reader user for a request that then
     failed). Announce on settle, and keep loading / failed / genuinely-empty three distinct renders.
  9. **`FriendButton` gates on the target's `verified` flag AND a case-insensitive self-comparison**,
     because `statusFor` collapses self, unverified target and ordinary stranger all into
     `status:"none"`. The self-gate skips the **fetch**, not just the render, so there is no flash of
     "Add friend" on your own dossier while identity resolves.
  10. **A friend whose gamertag link is released drops out of the roster — but the row survives,
      unreachable, with its sharing flags intact** (`packages/friends/src/queries.ts`). **Resolved
      in F2**, both halves — see F2 invariant 5. The drop-out itself is now pinned by a test
      (`packages/friends/test/queries.test.ts`), proven red against a render-blank implementation:
      an unnameable friend must vanish from the roster while the row survives.
  **Deploy:** migrations `0018` + `0019` touch no projection table — plain `./deploy/deploy.sh`,
  **no `--rebuild`**. No new env vars, no new worker, no systemd unit. **Friend notifications are
  live on deploy**, unlike the nine worker-generated kinds: they are written inline in the API
  request, in the same transaction as the state change, so they are not gated behind
  `NOTIFIER_SINCE`/`NOTIFIER_DRY_RUN`. The notifier's **push** pass still delivers them unchanged —
  it selects on `pushed_at IS NULL` and does not care who inserted.
- **Friends, F3 — presence notifications** ✅ (spec
  `docs/superpowers/specs/2026-07-22-friends-f3-presence-design.md`): a friend comes online, you
  get told — a twelfth notification kind, `friend_online`, generated by
  `apps/notifier/src/generators/presence.ts`. **F1's "no second migration" claim held for F2 but
  NOT for F3**: genuine two-sided control needs four per-pair flags and F1 shipped two, so
  migration `0020` adds `a_/b_notify_presence`, flips the `*_shares_presence` defaults to `true`
  with a backfill, and creates the durable `user_preferences` table. (`0021` adds
  `sessions_connected_at_idx`.) The `*_shares_location` columns stay untouched for F2.
  **⚠️ Invariants a future change would break by accident:**
  1. **Four conditions, all required** — `shouldNotifyPresence` (`packages/friends/src/presence.ts`)
     is `accepted && masterShare && pairShare && pairNotify`. **Effective sharing is
     `user_preferences.share_presence AND the subject's per-pair flag`**; the observer's per-pair
     notify flag is a separate mute. **An absent `user_preferences` row means `false`** — every
     pre-existing user has no row, which is exactly why the `0020` backfill flipping the per-pair
     defaults to `true` changes nobody's visibility. Make the missing row permissive and you
     retroactively expose the entire user base.
  2. **The natural key is `friend_online:<observerUserId>:<subjectGamertag>:<connectedAt ISO>`** —
     **never `sessions.id`**. `rebuild.ts` truncates `sessions` `WITH RESTART IDENTITY` while
     `notifications` is never truncated, so session ids are reassigned across a rebuild and a
     legitimate connect would collide with a stale key and silently notify nobody. Rebuild-stable
     tuple, timestamp from `toISOString()` in TypeScript — never a SQL `to_char()`.
  3. **The 4-hour cooldown is a prefix query over the durable notification rows**, using
     `LIKE <escaped prefix> || '%'` against `notifications_natural_key_pattern_idx`. Reuses F1's
     exported `escapeLikePattern` — an unescaped `_` in a user id is a single-character wildcard,
     and *this feature shipped that bug once already*. Never `starts_with()` (not index-usable).
  4. **Two bounds, both required**: `windowStart(deps)` (the floor every generator must honour)
     AND `FRIEND_ONLINE_MAX_AGE_MINUTES = 15`, which drops connects too old to be worth
     announcing — so a worker that has been down delivers silence rather than archaeology.
     Multiple connects in the window resolve by `ORDER BY connected_at DESC`.
  5. **Presence is keyed on the connect transition, and is NOT gated on life qualification** —
     deliberately unlike the survivors board and enforcer. "My friend is playing" is
     true regardless of leaderboard eligibility, and gating would skip fresh spawns, which is
     when people most want to group up. A crashed session that stays open until the next
     even-hour reboot can never re-fire, because a connect is a point event.
  6. **The cooldown does NOT make every reboot rejoin silent.** The fleet reboots every 2h and
     the cooldown is 4h, so a player online all evening is re-announced roughly every 4h. Within
     the intended ≤6/day bound; the spec's §2 phrasing is more optimistic than the behaviour.
  7. **UI: the two consent levels are shown, not hidden.** With the master switch off the
     per-friend *share* control is disabled **with a visible explanation** (`aria-describedby`,
     id derived per row — a shared id resolves every reference to the first row); the *notify*
     control stays live, since muting matters whether or not you are visible. Announcements fire
     **on settlement**, never at click time.
  **Deploy:** migrations `0020`/`0021` touch no projection table — plain `./deploy/deploy.sh`,
  **no `--rebuild`**. No new env vars, worker or systemd unit. **F3 ships dark behind TWO gates**:
  the notifier's generate pass is off in production (`NOTIFIER_SINCE` unset), and switching it on
  **un-dormants the other eleven kinds simultaneously** — set `NOTIFIER_SINCE` to the go-live
  instant and watch one dry-run interval first. **Presence visibility itself is no longer gated at
  all** (see the map online-list feature below) — the master switch now governs only whether
  friends are told when you come online. **Location sharing IS still gated**: no friend sees your
  dot on the map until you turn on that separate master switch.
- **Friends, F2 — location sharing** ✅ (spec
  `docs/superpowers/specs/2026-07-22-friends-f2-location-design.md`), completing the three-part
  friends feature: a live map per server at **`/maps/{map}`** (plus a `/maps` picker) showing the
  viewer's own position and every friend sharing with them. Migration `0022` adds
  `user_preferences.share_location` and flips the two dormant `friendships.*_shares_location`
  defaults to `true` with a backfill.
  **⚠️⚠️ F2'S CONSENT MODEL WAS REPLACED WHOLESALE BY SUB-PROJECT E (2026-07-25). Read the E
  entry below before touching anything in this section.** `user_preferences.share_location`,
  `friendships.a_/b_shares_location` and `shouldShareLocation` **no longer exist** — dropped by
  migration `0028`, along with every existing consent decision. Sharing is a **session-scoped
  grant** now. Everything in invariants 1, 3, 5 and 6 below is still current and still
  load-bearing; **invariants 2 and 4 describe deleted machinery** and are kept only as the record
  of why the replacement looks the way it does.
  **⚠️ Invariants a future change would break by accident:**
  1. **ONE coordinate egress point per audience, and neither takes a subject.**
     `GET /me/maps[/:mapSlug]` takes a **server slug and no player identifier** — the subject set
     is computed from the session alone, so serving a *named* player's coordinates is
     **unexpressible**, not merely rejected. The owner-only `GET /me/lives/:mapSlug/:n/track` holds
     the same property. **Do not parameterise either by subject**, and do not add a third route
     that serves coordinates. Both carry `cache-control: no-store, private` — a shared proxy
     caching either hands one player's squad positions to the next visitor.
  2. **Effective sharing = `user_preferences.share_location` AND the subject's per-pair flag**,
     via `shouldShareLocation` (`packages/friends/src/location.ts`). Master defaults **false**, the
     per-pair flag defaults **true** ("not individually hidden"), and **an absent preferences row
     means `false`** — which is exactly why `0022`'s backfill exposed nobody.
  3. **Last known position ONLY, and only while the subject is online.** Not a route trail — a
     trail shows direction, pace and habitual locations, i.e. an interception tool. And the dot
     vanishes on disconnect, because **where a DayZ player logs out is where their stash is**; a
     position that survives logout publishes that to everyone they ever shared with, and an expiry
     window is worse still (it exposes the stash during exactly the minutes someone watching would
     act). A fix older than **`MARKER_MAX_AGE_SECONDS` (900)** — reused, never redefined — is
     absent rather than shown somewhere the player no longer is.
     **ONE deliberate exception (2026-07-27), and it is SELF-ONLY:** while the VIEWER has an
     open life on the server, their own latest fix from that life persists on their own map,
     however old, with its real `recordedAt` (supplemental lookup at the bottom of
     `getFriendPositions`). Their own logout spot is their own information; nobody else ever
     receives it (the dot rides the `/me` payload, which only that session can fetch). The dot
     dies with the life, and a fix from before the open life started is never shown. Do not
     widen this to granting subjects — their dots keep every rail above, unconditionally.
  4. **The reciprocity line is ONE collapsed boolean.** `theyShareLocation` is computed
     server-side and cannot distinguish "their master switch is off" from "they hid from you
     specifically". Differentiating would tell one player a named friend singled them out, which
     makes the per-friend hide switch a visible act and therefore unusable. **This is the only
     place this codebase reports anything about another user's settings** — presence deliberately
     reports none. Do not generalise it, and do not add a field that reconstructs the difference.
  5. **F1's deferred prerequisite is fixed in BOTH halves, and both are needed.** Structural: the
     candidate query **inner-joins a `verified` `gamertag_links` row**, so a released link means no
     coordinates, unconditionally. Explicit: **`verifyLink` resets `share_location` AND
     `share_presence`** in the same transaction (`apps/verifier/src/pg-store.ts` — the only writer
     of `status='verified'`), scoped to the userId `RETURNING`ed from that same UPDATE. The join
     alone leaves stale `true` flags that go live on re-verification; the reset alone dies to any
     query that forgets the join. **The reset is one-directional** — it clears the re-verifying
     user's *outbound* sharing, not their friends' inbound flags toward them.
  6. **Gamertag identity is case-insensitive (RESOLVED — was an open backlog item).** Migration
     `0024` moved `players_gamertag_uniq` and `gamertag_links_verified_uniq` onto
     `lower(gamertag)`, closing the hole where two users could verify `Sasha`/`sasha`, fold onto
     one `players` row, and have one receive the other's coordinates as their own dot. Three
     code paths had to change with it, and **each is load-bearing, not tidy-up**:
     the claim route resolves the submitted gamertag to the canonical `players.gamertag` casing
     and stores THAT (`apps/api/src/routes/gamertag-links.ts`) — **on the INSERT path and on the
     reuse path**, since a pre-`0024` row found by the case-folded lookup and merely re-activated
     would keep its typed casing; migration `0024` canonicalizes the existing corpus the same way
     (a guarded `UPDATE`, reported as a `NOTICE`), so the invariant is true at deploy time rather
     than assumed. **That keeps the ~35 bare `eq(x.gamertag, …)` comparisons correct wherever
     both sides derive from `players.gamertag` or a `gamertag_links` row** — notably
     `redeem.ts`'s link↔`bans.gamertag` match and `player-page.ts`'s Verified stamp, where a
     mis-cased link silently cost the player their self-unban. It does **NOT** extend to
     ADM-sourced denormalised columns: `kills.killer_gamertag` and `hit_events.victim_gamertag`
     are written by `packages/projections/src/fold.ts` from the raw event payload, not from
     `players.gamertag`, so a re-cased log line still writes a differently-cased value there and
     bare `eq()` against it can still miss. (Not a regression — before this branch such a line
     was dropped entirely; now it is at least recorded.) A `lower()` sweep of those sites would
     defeat `positions_player_idx` and both partial indexes from
     `0017`; the verifier compares `lower()` in all three of `findPendingChallenges` /
     `getVerifiedLinkId` / `cancelOtherPendingLinks` (a mis-cased claim previously matched no
     emote, so verification silently never completed); and the projector's `getPlayer` resolves
     `lower()` — **without which the new index turns a duplicate row into a 23505 inside the
     fold transaction, which an event-log fold retries forever, stalling every projection.**
     ⚠️ `createPlayer` (`apps/projector/src/pg-store.ts`) must keep its **raw-SQL**
     `ON CONFLICT (lower(gamertag))`: drizzle 0.36.4 types `IndexColumn = PgColumn`, so an
     expression conflict target is not expressible through the query builder, and a column
     target (`target: [players.gamertag]`) fails at RUNTIME ("no unique or exclusion constraint
     matching the ON CONFLICT specification"), not at compile time. Two more hazards ride along
     the same raw path, both verified against postgres-js 3.4.9 and both explicitly converted in
     the code rather than cast: a JS `Date` bound as a raw parameter THROWS (only drizzle's typed
     builder serialises Dates), so the seen-at timestamp goes in as `toISOString()`; and raw
     `RETURNING` is untyped — `id` comes back as a bigint STRING and a timestamptz as a raw
     Postgres string, not the `number`/`Date` the query-builder path would give, so both are
     converted before the row is handed to the fold, which would otherwise silently receive a
     `PlayerRow` lying about its own types. The timestamp is returned as **epoch milliseconds**
     (`extract(epoch …) * 1000`) rather than as the timestamptz: Postgres renders one as
     `2026-07-22 19:17:56.505482+00`, whose space separator, microsecond precision and two-digit
     offset are all outside the Date Time String Format ECMA-262 defines, so `new Date()` on it
     only works through V8's implementation-defined fallback parser.
     ⚠️ `players.gamertag` casing is **frozen at first sight** — `getPlayer` finds the row for any
     casing but `touchPlayer` never rewrites it. Rewriting it would desynchronise every
     denormalised copy (`bans.gamertag`, `kills.killerGamertag`) that those
     bare `eq()` sites read.
     This does NOT merge renames: `players` is still keyed by gamertag, so a genuine rename still
     mints a second row (2 `dayz_id` values span 5 gamertags in production). That is the separate
     identity-merge sub-project, which needs `--rebuild`.
     **`getFriendPositions`' two defensive collapses (one-friend-one-dot, one-player-row-one-subject)
     were deliberately RETAINED, not removed, even though `0024` makes their triggering inputs
     unwritable through any public path today** — kept as defence in depth because the failure
     mode is a silent privacy leak (a marker simultaneously labelled as two different callsigns,
     or a viewer's own dot silently relabelled as a friend's), and the inputs return the moment the
     index is altered, hand-backfilled around, or restored from a pre-`0024` dump. See the two
     `⚠️` comments in `packages/read-models/src/friend-positions.ts`.
  7. **The positions lookup filters on `player_id`, never `lower(gamertag)`.** Only the former can
     be served by `positions_player_idx (server_id, player_id, recorded_at)`; the gamertag shape
     seq-scans the largest table in the system, on a 30s poll per viewer and once per server on
     `/maps`. Measured: index scan 0.066ms vs seq scan filtering 60,115 rows at 2.356ms.
  8. **The Leaflet lifecycle lives in ONE place** — `apps/web/src/components/map/map-canvas.tsx`,
     extracted from `TrackMap`. Nearly every comment in it documents a fixed bug (the two-effect
     split, the first-draw fit latch, the created-then-added LayerGroup, the SSR-avoiding dynamic
     import, the `isolate` stacking context). Consumers supply a `draw` function and nothing else;
     do not grow a second copy. Its optional **`className` is SIZING ONLY** (default
     `h-[420px] w-full`, the life-trail panel): `/maps/[map]` is a fixed-height flex column and
     passes `h-full w-full` so the canvas fills it — Leaflet measures the element on creation, so
     a parent chain with no definite height collapses the map to zero. The `isolate`/border/
     background classes are NOT overridable, because `isolate` is the stacking-context rail above.
  8. **Place labels are vendored data, drawn by `MapCanvas` for BOTH maps.**
     `apps/web/src/lib/map-places.json` (321 places across the three maps) is generated by
     `apps/web/scripts/refresh-map-places.mjs` from DZMap's upstream location JSON — the same
     source as the tiles, and the half `mirror-tiles.sh` skips with `--tiles-only`. Refresh it
     by hand after a DayZ terrain update, like re-mirroring tiles. **⚠️ `static.xam.nu` answers
     EVERY path with `200` and a zero-byte body**, so a stale version segment looks like a
     successful fetch of an empty file — hence the script's `assertNonEmpty` and the
     version-discovery recipe in its header (the version in `deploy/dzmap.yaml` is already
     stale). **The stored `lat`/`lng` are ALREADY Leaflet `CRS.Simple` coordinates on the
     zoom-6 pyramid** — passed to `L.latLng` untouched, never through `worldToPixel`, unlike
     every metre-based coordinate we hold ourselves; a test pins them to CRS space so a
     well-meaning "fix" fails loudly. Livonia's data is published upstream as `livonia` and is
     re-keyed to our `enoch` codename by the script. **Tiering is required, not cosmetic**
     (`placesFor`): 201 Chernarus places at once bury the dots — capital/city at zoom 0,
     village at 2, everything else at 4, and an **unknown category defaults to the most
     restrictive tier** so a DayZ update cannot flood the zoomed-out view. **Labels render in
     a dedicated `places` pane at z-index 350**, because Leaflet puts every `L.marker` at 600,
     *above* the overlay pane (400) holding our dots and trails — a LayerGroup cannot fix
     this, and without the pane a town name covers the friend you opened the map to find.
     **⚠️ The visible label is the inner `.map-place-chip` span — the box may NEVER be styled
     on `.map-place` itself.** That root is Leaflet's marker icon and carries an INLINE
     `width: 0; height: 0` from `iconSize: [0,0]`; an inline style beats any class rule, so a
     background there paints an 8x2px dash at the anchor while the text overflows it unbacked
     (shipped as v0.38.1, verified in a browser as a black dash beside every name).
     **⚠️ And the tiles are LIGHT** — Chernarus topographic is pale green/bone, so the original
     "paper text on dark tiles" premise was wrong about the terrain; a dark chip with light
     text is what holds over pale terrain, forest and water alike.
     **⚠️ Labels carry a SOLID `--dark` background, not a text shadow** — the shipped halo
     treatment left the 10px/11px tiers unreadable over real topographic tiles (busy,
     mid-value terrain), which is precisely the content they appear over; and the tiers
     differentiate by size/weight ONLY, never by fading text toward the background. A box is
     safe here because the `places` pane already keeps every label under the markers.
     **This also finally verifies `CANVAS_PX = 16384`**, the long-flagged unverified
     assumption: a wrong extent puts every town visibly off its own buildings, and a test
     pins Chernogorsk to its real world position.
  9. **Friend dots carry a PERMANENT gamertag label** (a Leaflet tooltip, styled by
     `.leaflet-tooltip.friend-label` in `globals.css` — specificity-scoped because Leaflet's own
     stylesheet is imported inside `map-canvas.tsx`'s chunk, so source order is not reliable). The
     fix age stays in the popup and the accessible legend; the label is identity only, or a
     crowded map becomes a wall of text. The map is **dots, never a polyline** (invariant 3
     above), pinned by a test in `friends-map-draw.test.tsx`.
  **Deploy:** migration `0022` touches no projection table — plain `./deploy/deploy.sh`,
  **no `--rebuild`**. No new env vars, worker or systemd unit. Unlike F3 there is **no operator
  gate** (no worker is involved), so the endpoint is live on deploy — but **inert**: every master
  switch starts `false`, so the map shows the viewer's own dot and nobody else's until people opt
  in. Live-but-inert rather than dark.
- **M1 — Map tool shell** ✅ (spec `docs/superpowers/specs/2026-07-22-m1-map-tool-shell-design.md`,
  plan `docs/superpowers/plans/2026-07-22-m1-map-tool-shell.md`): `/maps/[map]` becomes a
  full-viewport map application — one bar of chrome, place search, a locate control, a friends
  panel, and a live grid-reference readout. **Presentation only**: no migration, no new API route,
  no env var, no worker. Deploys with a plain `./deploy/deploy.sh`.
  **⚠️ `app/(site)/` is a route group, and route groups are NOT path segments.** Every page except
  **`/maps/[map]`** lives in it and renders the site chrome (masthead, controls rail, footer, the
  `xl:grid-cols-[minmax(0,1fr)_380px]` shell) from `app/(site)/layout.tsx`; the root layout now
  holds only `<html>`, the fonts, `QueryProvider` and the skip link. **Nothing changed URL.**
  A consequence that has already bitten twice: the root layout no longer renders
  `#main-content`, so **every route outside `(site)` must supply that id itself** — `not-found.tsx`,
  `error.tsx` and the map shell (`MapPage`, on the map region, not the bar the link exists to skip)
  each do, and each is pinned by a test.
  **⚠️ `/maps` is a REDIRECT, not a picker page (post-M1, `feature/maps-nav-link`).** The
  primary nav gained a **Maps** item (`lib/nav.ts`, between Survivors and About) pointing at the
  static `/maps`, and the route (`app/(site)/maps/page.tsx`) resolves where "here" is and
  `redirect()`s: the map you last opened (cookie **`ol_last_map`**, written client-side by
  `MapPage` on mount for every visitor), else the `chernarusplus` server, else any slugged
  server — `resolveMapSlug` (`@/lib/last-map`). **The remembered slug is re-checked against the
  live `GET /servers` list on every read** — that endpoint returns active servers only, so a
  slug that has since gone away falls back to the default rather than redirecting to a 404. The
  old `ServerPicker` + its page body are deleted; the map's own switcher covers choosing a map.
  **⚠️ The re-validation has NO exception, including the API-outage path.** When `getServers()`
  throws, the route does NOT redirect on the raw cookie — it falls to the honest "couldn't load
  the maps" render. A stale slug during an outage lands on a broken map card anyway (the map
  page fetches `/servers` too), so trusting the unchecked cookie buys nothing and breaks the
  invariant. **⚠️ A directly-linkable public map makes `/maps/<typo>` reachable** — `MapPage`
  calls `notFound()` when the loaded list has no matching slug, and that call sits **after every
  hook** (a conditional throw above a hook skips it on the 404 render — a rules-of-hooks
  violation). A bad slug is never written to the cookie (`rememberMap` is gated on a resolved
  `mapCodename`), and the gated friend query is disabled for it.
  **⚠️ `redirect()` throws (`NEXT_REDIRECT`), so it MUST stay outside the try/catch around
  `getServers()`** — inside it, the catch swallows the redirect and every visitor gets the
  error page. The one rendered branch (no cookie AND the server fetch failed → no slug) is why
  the route stays inside the `(site)` group: it needs the masthead, a way back, and light
  tokens. The duplicate "Map →" link in the controls-rail friends block was removed — the nav
  reaches every page.
  **⚠️ THE MAP IS PUBLIC; only the DOTS are gated.** `MapPageView` used to return the sign-in
  card *instead of* the terrain for a signed-out visitor — a dead end the moment Maps went into
  the nav. Terrain, town labels, place search and the switcher now draw for everyone, resolved
  from the **public `GET /servers`** (which carries the mission codename `map` beside `slug` —
  the whole reason the terrain is drawable without a session; `MapCanvas` needs the codename to
  pick its tile tree and place list). The session-gated `GET /me/maps/:slug` (dots, online list,
  Locate) is **unchanged and just as gated** — no coordinate egress moved. Anything merely
  *missing dots* (signed out / unverified / a failed friend payload) renders as a **floating
  strip** beside the map (`pointer-events-none` so it never swallows a Leaflet drag), never a
  blocking card — an empty map must never stand in for "you may not look." `FriendsMap` takes
  `mapCodename` + `positions` separately (different sources, one optional), not one `FriendMap`.
  The switcher reads a public `SwitchableMap` (`{slug,name}`) shape; `getMapServers`/
  `MapServerDto` are retired from the web (the API route still serves the shape).
  **⚠️ The online sheet's ✕ and its backdrop are the ONLY way out on a touch device.** Below
  `md` the sheet is `fixed bottom-0` and covers the bottom bar holding the ☰ that opened it, so
  tapping the trigger again is impossible — and a phone has no Escape key, which was the only
  dismissal `useModalBehavior` provided. It shipped in v0.41.0 with no exit at all, after a
  review flagged "neither panel closes on an outside click" as Minor during M1 (true on a
  desktop, where the trigger stays reachable above an anchored popover; a trap on a phone).
  The backdrop is `aria-hidden` with no role — a gesture target, not content, and the dialog is
  already `aria-modal` — and sits at the **same z-50 overlay altitude**, painted under the sheet
  by DOM order, so it adds no fourth altitude to the LAYER LEGEND.
  **The ☰ count INCLUDES the viewer**: it has to agree with the list directly beneath it and
  with the server's own player count.
  **⚠️ The whole shell is DARK — there is no paper anywhere on `/maps`.** `MapPageView`'s state
  notes, the friends legend, the switcher, the search box, the locate button and the friends panel
  all carry cream/paper tokens, and each swap has its own test: RTL asserts the DOM, not contrast,
  so ink-on-dark renders present, functional and invisible with the suite green (the v0.26.0
  notifications-panel failure). The map's sign-in link uses plain `red`, never `red-deep` — that
  token is light-surface only.
  **⚠️ On `/maps` the TOP BAR is the z-40 occupant**, because the route has no masthead; the
  friends panel is the z-50 overlay. Same three altitudes as everywhere else (LAYER LEGEND in
  `header.tsx`), different occupant — `top-bar.test.tsx` pins the number.
  **Leaflet stays sealed in `map-canvas.tsx`.** Consumers never receive the map instance: they pass
  **`focus?: MapFocus`** (`{lat,lng,zoom,nonce}`) and receive **`onCenterChange(world)`** in world
  metres. The **`nonce` is load-bearing** — picking the same search result twice is a real
  interaction, so the fly is keyed on it and never on the target's identity, and a parent re-render
  must not yank the view out from under someone mid-pan. `runFocus()` also runs once at map
  creation, since a focus set before the dynamic import resolves has no map to fly. Centre
  reporting is rAF-throttled (Leaflet's `move` fires many times per drag frame) and the pending
  frame is cancelled on teardown.
  **⚠️ The zoom floor is computed from the CONTAINER, and `zoomSnap` must stay at Leaflet's
  default.** `applyWorldBounds` sets `minZoom = log2(max(containerW, containerH) / 256)` — the
  pyramid is one 256px tile at zoom 0, so the world spans `256 * 2**z` px and that is the zoom
  at which it just covers the longer side. **⚠️ The floor is then rounded UP to a `ZOOM_SNAP` (0.25) multiple, and `zoomSnap` is set to
  that same value — both halves are load-bearing.** Leaflet applies `_limitZoom` **twice** on
  the way to a new view: it rounds to the snap and clamps to min, then does it again. A floor
  sitting BETWEEN snap points survives the first pass and is rounded away by the second, so the
  map bounces back to the level above and zoom-out becomes a silent no-op with the control
  still enabled (v0.41.2, verified live on Livonia at 1502x1517: exact floor 2.567, stuck at
  3). On a snap point the rounding is a no-op and the clamp holds. Round UP, never down —
  down lets grey back in. The cost is the last quarter-step of zoom-out, against the full step
  the old `getBoundsZoom` floor cost. Do NOT go back to `getBoundsZoom(bounds, true)`: it rounds an `inside` result UP to the
  next whole level, stopping a full step short of the edge, and returns `Math.max(currentMinZoom,
  …)`, which latches the floor so a shrinking viewport can never zoom out again. And do NOT
  reintroduce **`zoomSnap: 0`** (v0.39.2's fix for the rounding) — it makes wheel zoom
  continuous, which rescales tiles on every notch instead of stepping between rendered levels:
  reported as slow and choppy. A quarter step still moves a whole level per notch, because
  `_performZoom` takes `ceil(d2 / snap) * snap` and `d2` for one notch is ~1.
  **⚠️ The `maxBounds` is computed from the world, never hardcoded**
  (`applyWorldBounds`, `map-canvas.tsx`). `getBoundsZoom(worldBounds, true)` — `inside: true` —
  is the lowest zoom at which the VIEW still fits inside the world, i.e. the no-blank-space
  floor; `setMaxBounds` stops a pan doing the same thing sideways. **Two Leaflet details make
  or break it, both in `getBoundsZoom`'s source:** it rounds an `inside` result **UP** to the
  next whole level (`Math.ceil(zoom / snap) * snap`), so the map option **`zoomSnap: 0`** is
  load-bearing — with the default 1 the floor lands up to a full step short of the real edge
  and the map refuses to zoom out while terrain still covers the view; and it returns
  `Math.max(currentMinZoom, …)`, so the floor **must be reset with `setMinZoom(0)` BEFORE
  measuring** or it latches — raise it once at a wide window, narrow the window, and the map
  stays clamped at the old floor forever. It re-runs on Leaflet's
  `resize`, because the floor depends on the container's size and aspect, and a non-finite
  result (a container Leaflet measures as zero-sized yields `Infinity`) is **ignored rather than
  applied** — clamping every gesture to a zoom whose tiles do not exist is worse than the
  unbounded behaviour it replaced. The default view is `fitBounds(worldBounds)`, **not**
  `setView(centre, 1)`: a fixed zoom framed each map differently and opened Livonia (12800m, the
  smallest world) as a stamp in a grey field. `applyWorldBounds()` must run BEFORE the first
  draw, or that fit lands under the floor and shows exactly the blank the floor exists to
  prevent.
  **A consumer that needs to NAME a point without a map instance uses `worldToLatLng`**
  (`@/lib/dayz-projection`) plus `MapCanvas`'s exported `CANVAS_PX`/`MAX_ZOOM` — never restated
  arithmetic, which drifts silently. Its test checks our metres→`CRS.Simple` conversion against the
  coordinates **DZMap itself produced** for Chernogorsk, the one independent check on this
  projection.
  **`searchPlaces` ranks an exact name match ABOVE a bigger place containing it.** Size breaks ties
  only within a match kind. Real Chernarus collisions — `Bor` inside Stary Sobor, `Rog` inside
  Severograd — otherwise make those places **unreachable by typing their own name**, because
  a typed name offers the right place first. **`PlaceSearch` flies on an EXPLICIT pick only**, via
  a new optional **`onPick`** on `GamertagAutocomplete` (fired from `pick()` alone). Inferring a
  pick from the value cannot work: a click arrives as an `onChange` carrying text a keystroke could
  equally have produced, so it flew twice for one intent — and worse, any name that is a strict
  prefix of a longer one hijacked the map mid-typing (five such pairs in Chernarus:
  `Bogat`/`Bogatyrka`, `Klen`/`Klenovyipereval`, `Skalisty`/`Skalisty Proliv`, …).
  **Below `md` the map's controls split across TWO bars** (spec
  `docs/superpowers/specs/2026-07-22-map-mobile-controls-design.md`): the top of a full-viewport
  app is the hardest place on a phone for a thumb, so `MapBottomBar`
  (`components/map/shell/bottom-bar.tsx`) carries the grid chip plus Locate and Friends, and the
  top bar keeps the wordmark, the map switcher and search (a text input raises the keyboard,
  which would cover a bottom bar anyway). The bottom bar is **ordinary flow content — never an
  overlay**: the map region simply gets shorter, so it needs no z-index and cannot become a
  fourth altitude. **Locate and Friends are built once and placed in BOTH bars**, the
  `ControlsRail`/`ControlsSheet` pattern; only one is visible, and `display:none` takes the other
  out of the a11y tree — **jsdom applies no CSS, so no test can prove that exclusivity** and it
  lives on the browser checklist instead. The **map centre state therefore lives in `MapPage`,
  not `FriendsMap`** — the chip that reads it is chrome, and on a phone it renders outside the
  map entirely. Every control in both bars holds **`min-h-[52px]` at 15px** below `md`, dropping to the
  compact 11px at `md`; the bars are **64px** tall on a phone. Those numbers come from a
  measured phone, not from the 44px accessibility floor — 44/13 shipped in v0.40.0 and still
  read as fiddly, so do not "correct" them back down to the minimum; **Leaflet's own 26px zoom buttons are scaled to 44 under
  `@media (pointer: coarse)`** in `globals.css`, so a mouse keeps the compact control.
  **There is no arrow beside the wordmark** — the wordmark is the way home, as in the masthead,
  and the link's label carries the "back" meaning for anyone who cannot see it.
  **The back link's wordmark is `alt=""`** — the link already carries `aria-label="Back to One
  Life"`, and an alt of "One Life" on top of it makes the accessible name "Back to One Life One
  Life" — and declares intrinsic `width`/`height` so the bar cannot shift as it loads. The arrow
  stays beside it: this is the only exit from a shell with no other chrome, and a bare wordmark
  reads as a logo rather than a way out.
  **Below `md` the search field is a magnifier that expands over the bar** (spec §4): a persistent
  field cannot share a 360px row with the back link, the map name and two controls, and the
  overflow is clipped by the shell's `overflow-hidden` — pushing the friends button, the only route
  to the accessible legend, off-screen. The expanded field sits at the **same z-40 altitude as the
  bar it covers**, not a new one, and closes on a pick so it does not hide the map it just flew.
  The bar's height is `h-[calc(3rem+env(safe-area-inset-top))]`, **not `h-12` + `pt-[inset]`** —
  under `border-box` the padding is subtracted from the 48px box, which on a notched phone in PWA
  mode (~47px inset) collapses the row to about a pixel.
  **`GamertagAutocomplete` has no light variant and needs none** — it ships no default input
  styling at all and all four call sites are dark. Do not add an `onDark` prop; pass
  `inputClassName`.
  **Loading is never an authoritative zero, and a FAILED fetch is a fourth state:** the switcher
  and the friends panel render no count while fetching; `LocateButton` distinguishes ready /
  loading / failed / genuinely-no-position, and the panel distinguishes failed from empty —
  "nobody is sharing" and "you appear offline" are claims about the game, and a network error is
  not evidence for either (the page would also contradict its own "Couldn't load" card). The
  controls only render for a **verified** viewer: everyone else has the friend query disabled, so
  `isPending` never resolves and Locate would sit claiming to load a position that is never coming.
  **⚠️ `LocateButton` uses `aria-disabled`, never `disabled`.** Its unavailable states carry an
  `sr-only` reason via `aria-describedby`, and a `disabled` button leaves the tab order — which
  makes that reason unreachable by exactly the users it was written for, so the control reads as
  absent rather than as unavailable-because-X. `toHaveAccessibleDescription` does not model
  focusability, so the test asserts `not.toBeDisabled()` and a real focus move as well.
  **⚠️ A panel driven by `useModalBehavior` needs `tabIndex={-1}`** — it calls
  `panelRef.current?.focus()`, which is a silent no-op on a plain `div`, so the sheet opens with
  focus left on the trigger behind it. Both the friends panel and the map switcher set it, and the
  friends panel's focus move is pinned by a test.
  **The `CoordChip` is deliberately NOT a live region** — it updates every animation frame of a
  pan, and a polite region would read a new coordinate continuously; the value reaches assistive
  tech through the copy button's accessible name. **`FriendsMapLegend` was deleted; the ☰ panel's
  `OnlineList` replaces it** — the bar's `FriendsPanel` is its only home, and it stays reachable by
  a real button in the tab order because it is the screen-reader companion to a canvas with no text.
  **⚠️ Any Leaflet double in a test that renders `FriendsMap` needs `flyTo`/`project`/`getCenter`.**
  A partial double throws inside the rAF as an **unhandled** error, which vitest reports separately
  from the assertions — the file stays green while exercising a component that crashed.
  **⚠️ Task 9 of the plan — the browser verification pass — is OUTSTANDING.** jsdom cannot observe
  layout, paint or stacking, and two releases shipped green-but-broken on 2026-07-22 for exactly
  that reason. It needs real mirrored tiles (a tile-less local run is explicitly not sufficient).
  The six checks are listed in the plan; run them against the deployed site.
  **The ☰ panel is an online list, not a friends list** (spec
  `docs/superpowers/specs/2026-07-22-map-online-list-design.md`): every player currently connected
  to that server, friends first, with anyone sharing their position marked. This publishes
  presence to any signed-in verified viewer **regardless of the F3 presence switches** — a
  deliberate policy call, not an oversight: DayZ's own in-game player menu already lists everyone
  on the server, so gating our copy of that list protects nothing and only makes it look broken.
  **The F3 "share my status" switches now govern notifications only**, and their copy was reworded
  in the same release to say so — the old copy implied they hid you from this list, which they
  never did and now provably don't. **Location stays a completely separate, still consent-gated
  disclosure**: `shouldShareLocation` (master off by default) still gates the dot on the map, and
  the coordinate route keeps every guard it had — no subject parameter, a verified-link inner
  join, `MARKER_MAX_AGE_SECONDS`.
  **⚠️ Online = an open session AND `players.last_seen_at` within `ONLINE_MAX_AGE_SECONDS` (900)**
  (`getOnlinePlayers`, `packages/read-models/src/online-players.ts`) — an open session ALONE is
  not evidence of presence: `apps/rebooter` restarts every active server every 2 hours, so a
  crashed client's session stays open (`disconnected_at IS NULL`) until the next even-hour reboot,
  and a bare open-session list would show players who left up to two hours ago as if they were
  still there. Same 900s bound the map's own markers, the presence generator, and `survivors.ts`'s
  live-playtime cap already use. Mutation-tested — removing the bound fails a named test.
  **`sharing` is derived from the payload's own `positions` array, never a second consent
  lookup** — `getOnlinePlayers` takes the exact `FriendPosition[]` the route already fetched for
  the dots and intersects against it, so the online list and the map's dots are one fact and can
  never disagree with each other. Pinned by a route test proven red against a route that instead
  passed `[]`.
  **Ordering is owned by the read-model, not the component** — self → friends sharing → friends →
  everyone else sharing → everyone else, then by gamertag (`getOnlinePlayers`'s `rank()`).
  `OnlineList`/`FriendsMapLegend` render the array as given; sorting client-side would put the
  rule in the surface instead of the model that owns it, and the accessible legend wants the same
  order.
  **`GET /me/maps/:mapSlug` gained an `online: OnlinePlayer[]` field on the existing payload** —
  no new route, so the route's defining properties are unchanged: still no subject parameter (the
  viewer's session is the only input), still `cache-control: no-store, private`.
- **Identity merge** ✅: `players.dayz_id` (the stable DayZ account hash) becomes the identity;
  `players.gamertag` becomes the **current** label and moves on a rename — a new `player_gamertags`
  alias-history table (one row per player per distinct name, `(player_id, lower(gamertag))` unique)
  records every name a player has held. This narrowly **reverses migration `0024`'s frozen-casing
  rule, for renames only** — a rename now updates `players.gamertag`; casing itself still stays
  frozen (the existing `lower()` comparisons are unaffected). Slug resolution
  (`resolveSlugMatch`/`resolveGamertagBySlug`, `packages/read-models/src/player-aggregate.ts`) now
  falls back through `player_gamertags` for a former name, and an old player-page URL 308-redirects
  to the current one. Player-scoped stats (kill counts, priors, life
  tracks) key on `kills.killer_player_id`/`victim_player_id` — populated by the fold, so they are
  identity-correct after a rebuild — rather than the gamertag text; `killer_player_id` is nullable
  and every site uses `eq()`, which correctly excludes NULL rather than matching it. Three
  ownership checks (self-unban, the Verified stamp, friend-map/track access) resolve identity
  rather than a bare gamertag string, so a renamed verified player keeps both.
  **⚠️ Migration `0025` DROPPED `players_gamertag_uniq` (the `lower(gamertag)` unique index `0024`
  added) — this was not in the original plan, it was forced mid-implementation.** Once
  `players.gamertag` is a current label rather than an identity, that unique constraint is wrong in
  both directions: `createPlayer`'s old `ON CONFLICT (lower(gamertag)) DO UPDATE … RETURNING` would
  silently return an unrelated identity's row for a **new** dayz_id first seen under a name someone
  else still held (a new account attributed to the previous name-holder), and `recordGamertag`
  inserting into `player_gamertags` mid-rename could raise `23505` **inside the fold transaction**,
  which an event-log fold retries forever — a crash loop. `0025` replaces it with a plain
  `players_gamertag_idx` (non-unique), and `createPlayer` (`apps/projector/src/pg-store.ts`) is now
  a **plain `INSERT`, no `ON CONFLICT` at all** — safe only because the projector is single-instance
  and `onConnected` always resolves by `dayz_id` (`getPlayerByDayzId`) before ever calling
  `createPlayer`, so the fold cannot race itself into a duplicate identity.
  **⚠️ Because a gamertag is now a current label, a RECYCLED name can match two `players` rows at
  once** (the departed holder's row still carries the name until their never-coming next connect).
  Every site that resolves a gamertag to a player therefore picks the **most-recently-seen row,
  `id` ascending as the tie-break** — never the oldest, which would permanently attribute the
  name's *new* holder's events to the account that gave the name up. This one rule lives in four
  places and a change to any one should match the others: `getPlayer`
  (`apps/projector/src/pg-store.ts` and `packages/projections/src/memory-store.ts`),
  `resolveSlugMatch` (`packages/read-models/src/player-aggregate.ts`), and
  `packages/read-models/src/friend-positions.ts` (both its viewer lookup and its per-friend join,
  which also retains its two pre-existing defensive collapses — one-friend-one-dot,
  one-player-row-one-subject — as defence in depth now that the trigger `0024` thought it had
  closed is reachable again).
  **`player_gamertags` is a PROJECTION, not durable data**: it is in `rebuildAll`'s truncate list
  (`apps/projector/src/rebuild.ts`) and carries **no global unique on gamertag** — only
  `(player_id, lower(gamertag))` — because a recycled name legitimately belongs to two identities
  over time; a global unique would crash the ingest the moment a name recycled.
  **The merge needs no migration script or backfill** — `rebuildAll` re-folds the entire event log
  from event 0, and since the fold now resolves by `dayz_id` first, the collapse happens for free.
  **Deploy is `./deploy/deploy.sh --rebuild` — the rebuild IS the merge**, not an optional cleanup
  step; skipping it leaves the pre-merge duplicate rows in place.
  **`players.dayz_id` is UNIQUE (`players_dayz_id_uniq`, migration `0026`) — the two-release
  sequence is complete.** `0025` (v0.42.2) made `dayz_id` the identity and re-folded to collapse
  the historical duplicates; `0026` then promoted it to unique (it could not land in the same
  release — `deploy.sh` migrates before it rebuilds, so the duplicates still existed at `0025`'s
  migrate time). `0026` dropped the non-unique `players_dayz_id_idx`; the unique index serves
  `getPlayerByDayzId`'s `eq()` lookup in its place. **Nulls-distinct** — a null `dayz_id` (never
  observed; the fold's `dayzId != null` guard permits it) is allowed and does not collide, so the
  column stays nullable. **`createPlayer` is still a plain `INSERT`, NOT an `ON CONFLICT
  (dayz_id)` target**: the unique index is a loud-fail backstop for a race the single-instance,
  hash-first, transactional fold cannot actually produce — an `ON CONFLICT … DO UPDATE` here would
  reintroduce the silent-attribution hazard `0025` removed. `0026` deploys with a plain
  `./deploy/deploy.sh` (**no `--rebuild`** — index-only, no projection-shape change, so none of the
  rebuild-before-migrate ordering hazard).
  **Deferred — still key on gamertag text, not player id:** `leaderboards.ts` and the broader
  notifications/friends surfaces generally. A rename is therefore not yet reflected in those
  surfaces' history. **`articles` rows are keyed by frozen gamertag text** (`articles.gamertag`
  is set once at publish time and never rewritten on a rename) — but the two seams that would
  otherwise notice a rename resolve through `player_gamertags` alias history instead of a bare
  `players.gamertag`/`gamertag` string compare (2026-07-28): the obituary dedupe anti-join
  (`apps/newsdesk/src/pg-store.ts`'s `findObituaryTargets`) and the life timeline's
  `obituarySlug` lookup (`packages/read-models/src/life-timeline.ts`). So a rename neither
  reopens an already-published obituary's dedupe nor orphans its timeline link. The public
  article page itself still shows the frozen name from the time of publication.
- **Content engine retired** (2026-07-24): obituaries, birth notices, the news vertical, the
  editorial newsroom, the Discord notifier and the article image pipeline are **deleted**. One Life
  is a player tool; nothing generates prose. `apps/newsdesk`, the `articles`/`article_images`
  tables, the article read-models and the three route trees are gone. See
  `docs/superpowers/specs/2026-07-24-content-engine-removal-design.md`; the historical R5a–R5d and
  editorial specs are left in `docs/superpowers/` as a record.
  **⚠️ The rule that an article is matched to a life by the rebuild-stable tuple
  `(server_id, gamertag, life_started_at)`, never `life_number`,** briefly lost its only
  executable proof when the regression test went with the feature; **the proof is restored** (see
  the obituaries-revival entry below, `life-timeline.test.ts`). **The convention still governs
  `bans`**, which keys the same way for the same reason.
  **Obituaries revived, alone (2026-07-28)** — spec
  `docs/superpowers/specs/2026-07-28-obituaries-revival-design.md`: `apps/newsdesk` and a
  trimmed, durable `articles` table (migration `0030`, plain deploy, no `--rebuild`) return for
  LLM obituaries only — no birth notices, no news vertical, no images, no Discord. A dry-run-gated
  sweep of qualified deaths (`NEWSDESK_SINCE` forward-only cutoff, same convention as
  `NOTIFIER_SINCE`) generates and publishes each obituary, surfaced at a public `/obituaries` feed
  + article page, a life-timeline link, and sitemap entries. New **No-Place Rule**: prose may name
  the map and nothing finer (no towns, no coordinates) — enforced both by prompt and by a
  deterministic post-generation validator.
  **The NO-BUILD RULE (2026-07-28) is its sibling: base-building is never obituary material.**
  Closed on three independent levers, because the prompt alone is a request, not a guarantee:
  the `buildsPlaced` fact is gone from `ObituaryFacts` **at the type level** (`facts.ts` projects
  the three kept ordeals explicitly rather than spreading the read-model, which still carries it),
  `OBITUARY_SYSTEM` states the rule, and `no-place.ts`'s banned vocabulary gained the generic
  construction terms the structure list missed (`structure`, `tent`, `shelter`, `fence`, `wall`,
  `built`, `building` — **singular AND plural both required**, the matcher does not stem).
  **⚠️ `built`/`building` also catch figurative use** ("built a reputation"), which costs a retry
  and, at `NEWSDESK_MAX_ATTEMPTS` (3), a permanent failure stub — accepted deliberately. **If the
  tick's `failed` count climbs, narrow the list to the nouns**; that is the intended remedy, not
  raising the attempt cap.

- **Sub-project B — App shell** ✅ (spec `docs/superpowers/specs/2026-07-24-b-app-shell-design.md`,
  plan `docs/superpowers/plans/2026-07-24-b-app-shell.md`): the chrome the rest of the pure-player
  rebuild hangs off. **Presentation only** — no migration, no API route, no env var, no worker;
  plain `./deploy/deploy.sh`.
  **Nav is Home · Maps · Survivors · Obituaries · About.** (Survivors was renamed back from
  "Leaderboard" by the UX-consistency pass, 2026-07-27 — the internal nav key is still
  `leaderboard`. **Obituaries** joined 2026-07-28, when the revived feed got its first route in
  from anywhere but a life timeline.) The Survivors route is
  still `/survivors`, because sub-project D owns the move to a per-map board.
  **⚠️ `activeNavKey` matches Home by EXACT path, never `inSection`**: every path starts
  with `/`, so a prefix rule lights Home up on every page in the site.
  **`components/controls/` no longer exists.** The rail, the `ControlsSheet`, its `MobileAccount`
  trigger, the rail's `SignInPanel` and `useSheetDrag` are deleted; the surviving panels moved to
  `components/account/` (identity, link, verify, tokens, `use-controls`, `format`,
  `verification-announcer`), `components/servers/` (server cards), `components/friends/` and
  `components/shared/` (`GamertagAutocomplete`).
  **Below `md` a fixed `TabBar`** (`components/shell/tab-bar.tsx`) carries Home · Map · Survivors ·
  Friends · **Obits**, swapping Friends for Sign in when signed out (**five tabs in both states**,
  since 2026-07-28) and rendering
  **nothing** while identity resolves. **⚠️ `You` is deliberately NOT a tab** — `/you` stays
  reachable at every width via the masthead `AccountAffordance`, which has no width gate (unlike
  the nav beside it), so the slot was freed for a public surface. The label is the short **`Obits`**
  only here: the bar is five fixed-width columns at 320px, and the nav and footer both say
  Obituaries. It **shares the `z-40` chrome layer with the masthead**
  (they never overlap spatially) rather than adding a fourth altitude, and its height is
  `h-[calc(4rem+env(safe-area-inset-bottom))]` — **the inset must stay inside the calc**, since as
  padding under `border-box` it is subtracted from the box and collapses the row on a notched
  phone. **⚠️ The matching `pb-[calc(...)]` gutter lives on the `<Footer/>`, NOT on the layout's
  content column** — the footer is a sibling after that column and so is the last in-flow element
  in the document, so padding the column leaves the footer itself under the bar. That shipped once
  and hid the footer's **About** link, which is About's only route below `md` (verified in a
  browser: `elementFromPoint` on the link returned the bar). jsdom cannot see the overlap, so
  `footer.test.tsx` pins the gutter class. **This is NOT a return of the retired
  `ControlsPill`** — that was a floating account surface; this is app-wide navigation that renders
  for signed-out visitors too.
  **The hamburger and its full-screen menu are gone**, and **About moved to the footer**, which is
  its only route below `md`.
  **`/you` is the account page** (identity, tokens, sign-out), reached from a masthead avatar that
  renders at **every** width — the old `MobileAccount` trigger was `xl:hidden` because the rail
  covered desktop, and with the rail gone a width gate would strand desktop users.
  **⚠️ The claim/verify ladder deliberately stays on Home, not `/you`** — `unlinked`/`pending` are
  onboarding states that sub-project C's three-mode home owns, and `/you` must never be the only
  route to claiming a gamertag. Sign-out renders in every signed-in state.
  **The sidebar is Home-only.** The two-column `xl` grid moved out of `app/(site)/layout.tsx` into
  `app/(site)/page.tsx`, so Survivors, the dossier, Friends, Notifications and About all regained
  their full width. **⚠️ Nothing actionable may live only in `HomeSidebar`** — it does not render
  below `xl`, so anything reachable solely from it is unreachable on a phone. That is why
  `AccountPanels` sits in Home's main column.
  **`PageHeader`** (`components/shared/page-header.tsx`) is the shared *title · count · control*
  strip. Its `count` is a **discriminated union** (`loading | ready | failed`), not a number, so
  loading, resolved-zero and failed are three distinct renders defined once — this repo's
  most-repeated bug class. It carries **no z-index and no sticky**. Adopted by `/you` and
  `/friends`; the board keeps its own larger header until D restyles it.
  **Browser-verified in real Chrome** (the tab-bar gutter/footer overlap above, no horizontal
  overflow, the sidebar hidden below `xl`, no masthead collision). **⚠️ Headless Chrome is USELESS
  for this** — it clamps the layout viewport to ~500px CSS regardless of `--window-size`, in both
  headless modes, which reads as a horizontal-overflow bug that also reproduces on `main`. Drive
  real Chrome instead.
  **⚠️ CORRECTION (found during C): window resizing bottoms out at ~500px CSS in REAL Chrome on
  macOS too** — the OS enforces a minimum window width. So **no window-resize check can verify
  anything below ~500px**, and this entry's earlier claim to have verified the five tabs at 320px
  is not supported by that method. Below 500px needs devtools device emulation or a real handset.
  **⚠️ Still outstanding and needing a real device or a signed-in session:** the 320px tab row,
  the safe-area calc in PWA/standalone on a notched phone, and the bell popover painting over the
  tab bar. M1's own browser pass (real mirrored tiles) also remains outstanding.

- **Sub-project C — Home, three modes** ✅ (spec
  `docs/superpowers/specs/2026-07-24-c-home-three-modes-design.md`): Home becomes the app's control
  panel, rendering one of three modes off the existing `accountStatus` union. Read-model + web; no
  migration, no new table, no env var, no worker — plain `./deploy/deploy.sh`, **no `--rebuild`**
  (qualification stays derived, so nothing is stored and nothing needs re-folding).
  **Provisional lives are visible.** `getPlayerPage` gained an **additive** open-life lookup so a
  life inside the five-minute grace window renders as `state: "alive"` with `alive.qualified:
  false` instead of the server reading **idle** while the player is standing on it.
  **⚠️ Do NOT loosen `getPlayerLives`** (`packages/read-models/src/queries.ts`) to do this — it is
  the shared qualified-lives filter behind the dossier's past-life list, the standing AND the
  totals, so widening it would add provisional lives to a public profile's history and to the
  lives/deaths counts. **`aliveAnywhere` must keep excluding them** for the same reason: it feeds
  the dossier's public `Alive ×N` badge and the survivors board's notion of alive.
  The `state` union was deliberately **not** widened to a fourth `"unqualified"` case;
  `alive.qualified` refines it, so no existing consumer has to handle "alive, but".
  **Server rows are grouped `banned → alive → idle`** (`components/servers/grouping.ts`) — the same
  order `getPlayerPage` already ranks. Every server the caller passes comes back; **nothing is
  keyed to a fleet count** (three today, four when Badlands ships). `isSoleRow` is the entire
  definition of "hero": one group holding one row drops its heading. No separate hero component, no
  promotion tie-break.
  **⚠️ There is no "Join server" button anywhere, and there never will be** — a console DayZ server
  has no join URL. `HowToConnect` (`components/servers/how-to-connect.tsx`) is the honest
  substitute, mounted in three places (cold home, the claim step, idle rows) so the copy cannot
  drift. **`SEARCH_TERM = "One Life"` is BRAND COPY, not fleet data**: every server's in-game
  browser name is `One Life <Map> | dayzonelife.com`, so one term finds all of them. It is
  deliberately NOT derived from `servers.name`, which holds the map label alone ("Chernarus") —
  telling a player to search that returns thousands of unrelated servers. The panel equally does
  **not** print the full browser name: we do not store it (it lives in each server's Nitrado
  config), so any exact string here would be a guess that goes stale on the first rename.
  **`useControls` gained `serversLoading`**, the third instance of the loading/empty/failed shape
  after `standingLoading`/`balanceLoading` — `servers: []` is both the unresolved fallback and a
  genuinely empty fleet, and `HowToConnect` says "No servers are currently listed" out loud, so an
  in-flight fetch would otherwise announce an empty fleet. Mutation-tested.
  **Home's two RSC fetches (`getSurvivors`, `getServers`) degrade INDEPENDENTLY**, each through its
  own `settleFeed`. A single shared try/catch still passes the older feed-honesty tests while
  silently gutting the other half of the page — pinned by two tests proven red against exactly
  that change (the sitemap has the same rule for the same reason).
  **The ladder has three steps and never a fourth.** `ladderSteps` (`components/account/ladder.ts`)
  is signed in → claim → prove, with **exactly one `current`**. **⚠️ "Go play a session" is NOT a
  step**: the claim autocomplete searches gamertags the LOGS have seen and anyone can type any
  gamertag, so the site can never know whether a signed-in user has played until they verify — a
  step that can never be marked done would strand every player on it. "Go play" is the claim
  step's empty state (the How to connect panel), nowhere else.
  **Home's tokens block is a `TokensSummary`, not `TokensPanel`** — balance and purpose only.
  Sending and the referrer stay on `/you`; **spending stays on the ban row** (`ServerCard`'s
  `UnbanView`), which already knows which ban to lift, so a spend control in a tokens panel would
  have to ask which server. `Earn / buy →` is deliberately absent until `/tokens` exists in F.
  `ColdFork` (`components/front-page/cold-fork.tsx`) renders for `signedOut` ONLY — not for
  `unlinked`/`pending` (already sold; they get the ladder) and not while `loading`, so a signed-in
  player never sees a sign-in pitch flash. `SignInCta` survives, still used by `/about`.

- **Sub-project D — Maps + Leaderboard** (D1 + D2 shipped; D3 outstanding) (spec
  `docs/superpowers/specs/2026-07-24-d-maps-leaderboard-design.md`): the two map-shaped surfaces
  stop being separate products. Read-model + API + web; **no migration, no `--rebuild`**.
  **D1 — ONE map-resolution rule, shared by `/maps` and `/survivors`:**
  `last map viewed THIS SESSION → last map PLAYED → alphabetical by display label`. One pure
  `resolveMapDestination` (`apps/web/src/lib/map-resolution.ts`) + one server-side
  `resolveDestinationSlug`/`resolveDestinationFrom` (`lib/resolve-destination.ts`), so the two bare
  paths cannot drift. Both bare paths `redirect()`; `/maps/<slug>` and `/survivors/<slug>` are
  stable and never redirect.
  **⚠️ Tier 3 sorts by `mapLabel`, NEVER the codename** — `enoch` is labelled "Livonia" and sorts
  under L, not E. Today's fleet does not discriminate the two orderings (both put Chernarus
  first), so a naive test passes against the bug; the real test pairs `enoch` against a codename
  falling between "enoch" and "Livonia". `DEFAULT_MAP_CODENAME = "chernarusplus"` is **retired**:
  it happened to be first anyway, so it bought nothing and would go silently wrong the day the
  fleet changed.
  **`ol_last_map` is retired for `ol_map_session`** — a real session cookie (no `max-age`). A year
  is the wrong memory for "where was I?": it lets a map you opened once last spring outrank the one
  you have played all week.
  **⚠️ `GET /me/last-map` takes NO subject parameter** — the session is the only input, so serving
  another player's map history is unexpressible rather than merely rejected (the same shape the
  coordinate routes hold). It answers a signed-out viewer `{ slug: null }` with a **200, not a
  401**: it is a resolution HINT and both callers are public pages, which would have to translate
  a 401 back to "no memory" anyway. `cache-control: no-store, private`.
  **⚠️ `getLastPlayedMapSlug` (`packages/read-models/src/last-played.ts`) resolves the IDENTITY
  first, then queries sessions** — a gamertag is a current label since migration `0025`, so a
  recycled name can match two `players` rows and a direct join would mix a departed holder's
  history in. Most-recently-seen wins, `id` ascending as the tie-break (the same rule `getPlayer`,
  `resolveSlugMatch` and `friend-positions` apply). Its `servers` join is INNER and filters
  `active` + slugged, so a session on a retired server yields NO ROW rather than a slug the router
  must re-reject. Ordered `connected_at DESC` — never `disconnected_at` (null on an open session,
  the very case this exists for).
  **⚠️ No `(player_id, connected_at)` index exists, and none is needed AT THIS FLEET SIZE**: the
  `servers` join bounds the work to one lookup per active server against `sessions_open_idx`.
  Measured on a production dump: **0.083 ms**, a nested loop over 3 servers. **At tens of servers
  this degrades linearly and wants a real index** — that is a migration, and this line is its
  trigger.
  **⚠️ The two fetches in `resolveDestinationSlug` degrade INDEPENDENTLY.** Losing `getServers`
  loses the resolution (we render an honest failure and never guess a path — a remembered slug is
  never trusted without the live list). Losing `getLastPlayedMap` loses only a TIER. And
  `redirect()` throws `NEXT_REDIRECT`, so it must stay OUTSIDE the fetch error handling — inside
  it, the catch swallows the redirect and every visitor gets the error page. That is why the
  fetching lives in the resolver and the throw lives in the page.
  **D2 — the leaderboard.** See the rewritten Survivors leaderboard entry above; the load-bearing
  parts are that the reserved-slug rule is GONE (not unenforced) and that `sort` is dropped from
  the API rather than ignored. Home's board strip follows the same rule and **names the map it is
  scoped to** — an unlabelled top-5 would be silently partial. ⚠️ A failed `getServers` now costs
  that strip too (there is no map to ask a board about), which narrows an independence claim made
  in sub-project C; what still holds is that it renders as a **failure**, never as an empty coast.
  **D3 (outstanding):** `/maps/[map]` moves into `app/(site)/`, gaining the masthead and footer;
  `TopBar`/`MapBottomBar`/`CoordChip`/the `onCenterChange` path/`PlaceSearch`/`searchPlaces` are
  deleted. ⚠️ `MapPage` must drop its own `#main-content` when it moves (the `(site)` layout
  supplies it, and two elements with that id make the skip link resolve to whichever comes first).

- **Sub-project E — Session location sharing** ✅ (spec
  `docs/superpowers/specs/2026-07-25-e-session-location-sharing-design.md`; PRs #274 + #275):
  **replaces F2's standing consent model wholesale.** Sharing your position stops being a setting
  you turn on once and becomes a grant you hand ONE person during ONE game session.
  **The predicate — three conditions, all required:** a `location_shares` row exists, the granter
  is **online on that server**, and the row's stored session snapshot still equals that session's
  `connected_at`. The third clause is what makes it self-expiring: **no cleanup worker, no TTL, no
  `expires_at`.**
  **⚠️ THE SNAPSHOT IS A TIMESTAMP, NEVER `sessions.id`.** `rebuild.ts` truncates `sessions`
  `WITH RESTART IDENTITY`, so ids are reassigned by a projection rebuild and an id-keyed share
  could be resurrected against an unrelated session. `connected_at` is folded from the ADM line
  and survives a rebuild unchanged.
  **⚠️ It is compared for EQUALITY, not `granted_at >= connected_at`.** Those two would come from
  different clocks — the API's wall clock versus an ADM timestamp with `servers.clock_offset_ms`
  applied, which is seconds apart — so the inequality can silently never match for a grant made in
  the first seconds of a session: a share the UI calls active that never works. Both sides of the
  equality are the same value.
  **⚠️ The predicate is a JOIN in `getFriendPositions`, never a post-filter.** An expired grant
  produces NO ROW, so no intermediate value in the call path ever holds a lapsed subject's
  coordinates. Do not "simplify" it into fetch-then-filter.
  **⚠️ `location_shares` is DURABLE — never add it to `REBUILD_TRUNCATE_TABLES`.** Rows
  self-invalidate, so a rebuild leaves rows that simply stop matching (harmless); truncating them
  would revoke live shares mid-session.
  **⚠️ THE GRANT ROUTES TAKE A GAMERTAG, AND THAT DOES NOT BREACH THE NO-SUBJECT RULE.** That rule
  governs coordinate **egress** — `GET /me/maps/:slug` must not let a caller name whose position to
  READ. `POST /me/maps/:slug/shares` names who may see the CALLER'S OWN position, the opposite
  direction, and discloses nothing in its response (pinned by a test). Revoking a grant that cannot
  exist is a **no-op, not a 404** — a 404 there would confirm whether a gamertag is verified to
  anyone who can call it.
  **⚠️ THE TWO DIRECTIONS ARE SEPARATE AND MUST STAY SO.** On `OnlinePlayerDto`, `sharing` is what
  THEY gave the viewer; `sharedWithThem` is what the viewer gave them. Merging them would let
  someone believe that seeing a dot means being seen — in a game where being seen gets you killed.
  Two tests use rows where the directions disagree, so a merged implementation fails rather than
  passing by coincidence.
  **Deleted outright** (migration `0028`): `user_preferences.share_location`,
  `friendships.a_/b_shares_location`, `shouldShareLocation`, both routes' `shareLocation` fields,
  the roster's location controls, and `theyShareLocation` — which had been the ONE place this
  codebase reported anything about another user's settings. **The migration discards every
  existing consent decision, by design**, and is not reversible by redeploy.
  `verifyLink`'s `share_location` reset became a **DELETE of the user's grants**; one-directional,
  clearing what they share and never what others share with them (otherwise re-verifying would let
  anyone revoke another player's sharing).
  **The chip counts EFFECTIVE grants, not rows**, and renders only once the payload resolves — a
  "0 can see you" drawn from a loading or failed fetch is a claim about your privacy made from an
  unknown.
  **Notification kind 13** `location_shared`, written inline in the grant's transaction (live on
  deploy, NOT gated behind `NOTIFIER_SINCE`). Natural key ends in the same session snapshot the
  predicate uses, so re-granting within a session is idempotent while the next session notifies
  again.
  **Every F2 coordinate rail is retained:** one egress route with no subject parameter,
  `cache-control: no-store, private`, last-known-position only (never a trail),
  `MARKER_MAX_AGE_SECONDS`, the verified-link inner join, and both defensive collapses.
  **Deploy:** migration `0028` touches no projection table — plain `./deploy/deploy.sh`, **no
  `--rebuild`**. No operator gate; live on deploy but **inert until used** (no rows, nobody
  visible). ⚠️ **Outstanding:** the end-to-end grant → dot → session-end → dot-gone round trip is
  not integration-tested — it needs two signed-in verified accounts on a live server. Every piece
  is unit- and route-tested and the predicate is mutation-tested at both layers, but exercise it on
  staging before telling players it works.

- **Login avatars** ✅ (spec `docs/superpowers/specs/2026-07-27-login-avatars-design.md`):
  replaces the RPT character pipeline (SP5, above — removed outright, not deprecated) with
  avatars sourced from a player's login method. The RPT persona mapping mis-attributed across
  players often enough (charID inheritance, cross-gender phantoms from `head_asset`) that the
  portraits it drove were confidently wrong; the fix is to stop generating a persona at all and
  instead show the player's own picture.
  **A new durable `avatars` table** (`user_id` PK → `"user"(id)`, `image bytea`, `hash`,
  `source`, `updated_at`; absent from `REBUILD_TRUNCATE_TABLES`, present in `APP_TABLES`) holds
  three row states: no row (untouched — auto-populate allowed), a row with `image` (live
  avatar), and a row with `image IS NULL` — an **explicit removal tombstone**.
  **⚠️ The tombstone rule is the whole point of a nullable `image` on a durable table: NULL
  means "this player removed their avatar on purpose," and auto-populate must never resurrect
  it.** The after-sign-in mirror only fires when no row exists at all; a re-sync or a fresh
  upload are the only two paths that can turn a tombstone back into a live avatar.
  **One `sharp` pipeline serves both sources** — a direct upload and a provider-image mirror
  both pass through the same decode → 5 MB pre-processing cap → `resize(256, 256, { fit: "cover"
  })` → webp encode (quality 80, which also strips EXIF) → `hash = sha256(bytes).slice(0, 16)`
  → upsert. SVG is rejected (scripting surface). Provider mirroring additionally restricts
  itself to https, at most 3 redirects, a 5s timeout, and the same byte cap streamed.
  **⚠️ Provider CDNs (Discord/Google avatar URLs) are never hotlinked on a public page** — every
  avatar we show is our own mirrored, re-encoded copy at our own URL. Hotlinking would leak a
  visitor's IP to a third party on every page view and would rot the moment a provider's
  rotating CDN URL expired.
  **Hash-addressed public serving**: `GET /avatars/:hash.webp` serves bytes by content hash with
  `cache-control: public, max-age=31536000, immutable` — honest because the hash changes
  whenever the image does, so a URL never needs revalidating. A miss is a 404; the hash discloses
  nothing since it's content-derived and already appears in public payloads.
  **⚠️ All four `/me` avatar routes (`GET /me/avatar`, `POST /me/avatar`, `POST /me/avatar/sync`,
  `DELETE /me/avatar`) take NO subject parameter** — same shape as every other `/me` route in
  this codebase (self-unban, the token routes, the coordinate routes): the session is the only
  input, so reading or writing another user's avatar is unexpressible, not merely rejected.
  **`POST /me/avatar/sync` distinguishes a stale provider URL from a genuine fetch failure
  (2026-07-28):** when `fetchProviderImage` fails with a response status (the provider answered
  but the stored `session.user.image` URL 404s/403s — Discord rotates its avatar CDN URLs, so the
  copy captured at sign-in eventually goes dead), the route returns `409 provider_image_stale`
  rather than the generic `502 fetch_failed`; any existing avatar row is left untouched either
  way. The web maps it to an explicit message telling the player to sign out and back in (which
  re-mirrors a fresh URL) or upload directly, instead of the earlier generic error copy.
  **Read-model `avatarHash` joins are verified-links-only, and require `image IS NOT NULL`** —
  the survivor board (hero + podium rows) and the life timeline hero join `avatars` through a
  `verified` `gamertag_links` row on `lower(gamertag)`, exactly the boundary self-unban and
  friend location sharing already enforce, and a tombstoned row must resolve to `null` →
  silhouette exactly like no row at all. An unverified or renamed-away gamertag also yields
  `null`. **The dossier is no longer avatar-free (avatar/account pass).** It joins `avatars`
  through the same verified + non-tombstoned rule as the board and timeline, and the page's
  signed-in owner (session gamertag matches the page, verified) gets an in-place upload/remove
  control there — the same `AvatarPanel` component the old `/you` page carried. **`/you` is
  DELETED**: avatar management moved onto the dossier (verified players only), and sign-out lives
  in the masthead avatar menu (`account-affordance.tsx`) instead.
  **Deploy:** migration `0029` creates `avatars` and drops `characters`, `character_sightings`
  **and `rpt_files`** (the RPT ingest-cursor table) — touches one durable table and drops three
  projection tables, so it deploys with a plain `./deploy/deploy.sh`, **no `--rebuild`** (nothing
  needs re-folding; the event log never carried character data). `@onelife/rpt-parser` is deleted
  as a workspace package; a normal `pnpm install` on deploy handles it.
  **⚠️ `sharp` is a native dependency, not a pure-JS one** — the API now needs pnpm to fetch its
  linux-x64 prebuilt binary on the deploy host. A failed or skipped native-binary fetch
  (offline install, an overly aggressive `--ignore-scripts`, an unsupported platform) is a
  runtime failure, not a build failure: the api unit fails to boot rather than failing
  `pnpm install`. See `deploy/README.md`.
  **⚠️ `user.image` is user-writable, so `fetchProviderImage` treats it as attacker input, not a
  trusted provider URL.** Better Auth's default `/update-user` endpoint accepts an arbitrary
  `image` string and has no cheap per-field disable (`name`/`image` are hardcoded into the route,
  only `additionalFields` are configurable) — so production fetches are restricted to an https
  **provider-host allowlist** (`cdn.discordapp.com`, any `.googleusercontent.com` host,
  `avatars.githubusercontent.com`), re-checked on every redirect hop so a compliant host cannot
  redirect to an internal target. The old http+loopback carve-out is gated behind an explicit
  `allowTestHosts` param (production always passes `false`, via config env var
  `AVATAR_TEST_FETCH_ALLOW_LOOPBACK`, parsed on the `NOTIFIER_*` safe-side convention — unparseable
  input lands OFF), never a code path a production request can reach.
  **⚠️ Outstanding — needs a real-browser pass pre-ship**, matching how sub-projects B and M1
  record their own outstanding browser checks: the `/you` avatar round trip (upload → the board/
  masthead actually rendering the mirrored image) has never been exercised end-to-end in a real
  browser, only through jsdom/route-level tests.

- **Cold-home ledger hero** ✅ (spec
  `docs/superpowers/specs/2026-07-28-cold-home-ledger-hero-design.md`): the signed-out home's
  `<h1>` is a live casualty ledger — "Deaths to date: N. Still standing: M." — with the death
  figure counting up on load; the brand line demotes to the kicker. Backed by `getSiteStats`
  (`packages/read-models/src/site-stats.ts`) at public `GET /stats`. **Deaths = SQL COUNT of ALL
  ended lives — qualification deliberately does NOT apply** (changed 2026-07-28 from
  qualified-only): the ledger answers "how many lives ended here," so sub-5-minute blips count,
  and this is the one surface whose number exceeds the qualified-only record (boards, funerals,
  bans) — don't "reconcile" it back, and don't point a qualified-only surface at it. Alive =
  `getAliveSurvivors(...).total`, delegated so the headline and the boards can never disagree
  (still qualified-only, the boards' own definition). The deaths/alive fleets also deliberately
  differ (deaths count all servers ever; alive only active slugged ones) — don't "fix" either
  side to match. **A failed
  stats fetch renders the previous evergreen hero** (no banner, never a zero); the fetch is its
  own `settleFeed`, gated on `!signedIn` (the hero is cold-only — don't make it unconditional:
  `getAliveSurvivors` loads the whole kills table). `CountUp` SSRs the real final number,
  animates only post-hydration when motion is allowed, and is `aria-hidden` behind an `sr-only`
  sentence. No migration, no env var — plain `./deploy/deploy.sh`, **no `--rebuild`**.
  **Relaunched (2026-07-28) into the full cold-home pitch.** The hero is now DARK with a
  two-line no-trailing-periods headline ("DEATHS TO DATE" / "STILL STANDING") rendered via
  `FitLine` (hidden-clone measurement to the final string, jsdom-safe against a 0-width
  container) so it fills the container at any width, with the claim button in the hero itself.
  The cold home is a five-beat pitch, in this order — `Hero` → `Rules` (the three rules of the
  game, moved ahead of the obituaries) → `Fallen` (a wall of recent obituaries) → `CtaSlab`
  (closing call-to-action) → `ConnectSection` (a light closing "how to connect" section with the
  server-browser instructions, so the page no longer ends on a stray light bar above the dark
  footer) — and `ColdFork`/`TopSurvivors` (the old two-cell sign-in fork and top-5 board strip)
  are **RETIRED — do not reintroduce them**. `Fallen` renders NOTHING on a failed OR an empty
  obituaries feed, never a placeholder.
  **The home-polish pass (2026-07-28) extended the pitch to signed-in-but-unverified visitors —
  narrowed to UNLINKED ONLY by the pending-verification experience (2026-07-29).**
  `UnverifiedPitch` (`components/front-page/unverified-pitch.tsx`) renders the same five beats
  for a signed-in user whose `accountStatus` is `unlinked`, with every CTA pointed at
  the on-page `#claim` ladder instead of `/login`. **`pending` renders NOTHING there** — a
  pending player already claimed, so every pitch CTA would demand a done step.
  **The pending-hero pass (2026-07-29, spec
  `docs/superpowers/specs/2026-07-29-pending-hero-design.md`) made the challenge ITSELF the
  pending home's hero.** `PendingHero`/`PendingHeroView`
  (`components/front-page/pending-hero.tsx`, client-gated on pending like `UnverifiedPitch` is
  on unlinked) is a full-bleed dark hero in the cold hero's language — red bottom frame, yellow
  for everything live, a "Step 3 of 3 — one step left" kicker (the 3-step ladder folded to one
  line; it deliberately renders in the expired state too), the gamertag in the `FitLine` h1 (the
  pending page's only h1), the emote sequence/countdown/walkthrough inside the hero, and the
  verbatim batching line ("DayZ reports emotes in batches — your progress can take up to 15
  minutes to appear here. It does not update in real time.") — a test pins that no copy claims
  live/instant updates. It **absorbed the retired `ProveItPanel` and `PendingLead` — do not
  reintroduce them**; `LadderFrame`/`ladderSteps` are unlinked-only and parameterless now.
  **One `id="claim"` anchor wraps BOTH the hero and the padded `AccountPanels` wrapper**
  (`page.tsx`; the anchor div is full-bleed, padding on the inner wrapper only — the masthead's
  "Finish verification → /#claim" lands at the hero top for pending, at the padded ladder for
  unlinked), and `AccountPanels`' pending branch renders **no visible body** — only the
  unconditional `VerificationAnnouncer` sibling and the sign-out footer, pinned by
  `account-panels-pending.test.tsx`. `PendingSupport`
  (`components/front-page/pending-support.tsx`) follows below the anchor: `ConnectSection` with
  the pending kicker "Get in game — perform your sequence on any One Life server" (never the
  cold "Play first, claim later," untrue post-claim) — then `Fallen`.
  The masthead `AccountAffordance` has a pending branch: menu item "Finish verification →" →
  `/#claim`, the claimed tag's initial in the disc, and a `border-yellow` cue.
  `UnverifiedPitch` is **client-gated on `useAccountStatus`,
  not server-gated on the session cookie** — SSR renders nothing, and it stays rendering nothing
  until status resolves to `unlinked`, because a `verified` player must never see a
  pitch flash before the branch below it takes over; appearing beats vanishing for the
  unverified case. **Fetch gating is no longer cold-only** — `stats` and `obituaries` (now
  fetched via `getSiteStatsCached`/`getObituariesFeedCached`, a cookie-free 60s shared fetch
  cache, not the cookie-forwarding `getSiteStats`/`getObituariesFeed`) are fetched
  **UNCONDITIONALLY, cold and signed-in alike**, since both the cold pitch and `UnverifiedPitch`
  need them; only `survivors` (the verified sidebar's data) stays signed-in-only. **This
  supersedes the original two-directional gating claim above — do not restore
  stats/obituaries to cold-only.** The signed-out home renders no `AccountPanels` wrapper at
  all — that div (with the `#claim` anchor) exists only on the signed-in branch, alongside
  `UnverifiedPitch`. `HomeSidebar` itself is still verified-only, gated through `HomeShell`, not
  merely signed-in.

- **Mauled inference** ✅ (spec `docs/superpowers/specs/2026-07-29-mauled-inference-design.md`):
  DayZ logs some infected deaths with no `killed by` clause and `Bleed sources: 0` (the wounds
  close before the player expires) and kills a player outright for logging out unconscious, so
  those deaths landed as `unknown`. The classifier's mauled rung is now
  **`hunted AND (bleeding OR wentUnconscious OR terminalHp <= 1)`** — `hunted` (any infected hit in
  the 120s window) is the gate, the other three are interchangeable corroboration. The knockout
  signal is new plumbing: `packages/adm-parser`'s `parseUnconscious`, a `player.unconscious` event,
  a projected `unconscious_events` table (migration `0031`), and `recentUnconscious` on
  `LifeDossier`, forwarded by `dossierVerdict` as `classifyDeath`'s **required** third argument.
  Verdicts stay lazy and are never materialized, so corrected lives fix themselves; already-published
  obituary prose is frozen and is NOT regenerated.
  **⚠️ `terminalHp` reads INFECTED hits only, never all hits in the window.** `hunted` and the
  terminal-HP corroboration must rest on the SAME hits — otherwise a fire tick or a player's shot
  that left the victim at ~0 HP is corroborated by an unrelated infected scratch elsewhere in the
  window and the death publishes as `mauled` at HIGH confidence. Fire is a real recurring cause
  here (its own ordeal category), fire ticks run to 0 HP, and a fire death carries no killer clause.
  Three such misattributions were reproduced before the restriction landed.
  **⚠️ `unconscious_events` is deliberately NOT in `REBUILD_TRUNCATE_TABLES`** — `players` is
  already listed and `TRUNCATE … RESTART IDENTITY CASCADE` clears the child through its FK for
  free. Naming a table the current release CREATES aborts the rebuild phase, which runs BEFORE
  migrate, with the fleet already stopped (this killed the v0.42.1 deploy).
  **⚠️ `parseUnconscious` is dispatched AFTER `parsePosition` in `parseLine`**, inverting that
  file's stated "primary event first, then position" convention. `subIndex` is the array position
  of the parsed result, and all 63 historical unconscious lines already hold `player.position` at
  `subIndex 0`; inserting ahead of position renumbers it to 1 and collides with
  `events_idempotency_uniq` on every one of them. The backfill appends at `subIndex: 1` for the
  same reason. Do not "restore" the convention.
  **Deploy runbook:** migration `0031` creates a projection table but changes no existing
  projection shape, so it is a plain `./deploy/deploy.sh`, **no `--rebuild`** — then, on the host,
  **`pnpm --filter @onelife/projector run backfill-unconscious`** (note **`run`** — a bare
  `pnpm --filter … backfill-unconscious` silently no-ops). The backfill re-parses `raw_lines` and
  appends only the new events; it is idempotent via `events_idempotency_uniq`, and the running
  projector folds them forward on its normal cursor. **⚠️ Skipping the backfill is SILENTLY
  PARTIAL** — new deaths classify correctly while every historical one stays `unknown` forever, and
  nothing surfaces the omission. Verify with `select count(*) from unconscious_events` on the host.

## Monorepo (pnpm + turbo, TS/ESM, Postgres + Drizzle)

- **packages:** `db` (schema + migrations; gained two durable
  tables, `notifications` and `push_subscriptions`, in migration `0015` for player notifications —
  see the Player notifications sub-project entry. Migration `0015` touches **no projection table**,
  so it ships with a plain `./deploy/deploy.sh` (no `--rebuild`); life qualification stays derived at
  read time via `lifeQualifiedAt()` and is never materialized on `lives`.
  `notifications`/`push_subscriptions` are durable — absent from
  `apps/projector/src/rebuild.ts`'s truncate list, present in `APP_TABLES`
  (`packages/test-support/src/global-setup.ts`),
  `domain` (zod events, emote/weapon dicts),
  `nitrado` (log-file client), `adm-parser` (pure ADM line parser), `event-log` (append/cursor over
  `events`), `projections` (fold logic), `read-models` (stats queries, including
  `player-priors` — global cross-life reputation via `getPlayerPriors`), `test-support` (Postgres
  test harness), `auth` (Better Auth), `verification` (emote-sequence challenges),
  `tokens` (unban-token ledger + grants/redeem/transfer), `rpt-parser` (RPT login-correlation →
  character sightings), `friends` (friendship pair ordering + viewer-relative projection,
  presence consent flags and `shouldNotifyPresence`; session-scoped location GRANTS
  (`location_shares`) and their `isShareEffective` predicate — F2's `shouldShareLocation` and its
  two switches were deleted by sub-project E;
  transitions, read queries; writes its own notifications inline — see the Friends F1 entry, whose
  ten invariants are all load-bearing).
- **apps:** `ingest-worker` (ADM+RPT poll→events loop; **DB-driven** — sweeps every `servers` row with
  `active=true` using the shared `NITRADO_TOKEN`, no `NITRADO_SERVICE_ID` env), `projector` (events→projections fold),
  `verifier` (emote-verification loop), `api` (Fastify REST + auth), `web` (Next.js frontend),
  `enforcer` (24h death-ban reconciler; dry-run by default), `granter` (token grant sweeps),
  `rebooter` (restarts every `active` server on the top of each **even UTC hour** — 00:00,02:00,…,22:00
  — best-effort per server; **no dry-run, live on deploy**; needs `NITRADO_TOKEN` + a `onelife-rebooter`
  systemd unit),
  `notifier` (player-notifications worker, two passes per tick: **generate** — seven notification
  kinds (gamertag verified, tokens received/granted, ban applied/lifted, life qualified, survival
  milestone) written to the `notifications` table, deduped by a **plain** unique `natural_key`
  index (its `onConflictDoNothing` takes no `targetWhere`) — and **push** —
  delivers unread, recent rows as browser Web Push, retiring a subscription after repeated
  delivery failures. Generation is gated by a forward-only **`NOTIFIER_SINCE`** cutoff (unset =
  OFF, never a silent epoch default) plus **`NOTIFIER_DRY_RUN`** (defaults `true`); push has its own
  independent **`NOTIFIER_PUSH_ENABLED`** kill switch, so generation and delivery can be staged on
  separately. Needs `DATABASE_URL` + `SITE_URL` (the latter is required by the config schema but
  **currently unused** — every notification `href` is a relative path), and (for push) `VAPID_PUBLIC_KEY`/
  `VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` — `VAPID_PUBLIC_KEY` is also read by the **api** unit, which
  serves it publicly at `GET /push/vapid-key`. **Single-instance, at-least-once delivery** — the
  push pass reads unpushed rows without a row lock.
  Needs a `onelife-notifier` systemd unit; deploy runbook in `deploy/README.md`).

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
