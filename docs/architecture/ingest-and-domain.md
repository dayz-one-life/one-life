# Ingest, projections, identity, and the domain model

Split out of `CLAUDE.md` (2026-07-29), verbatim. Feature entries in original order.

## Foundation (SP1–SP4)

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
  **⚠️ A kill belongs to a life by ONE rule, `packages/read-models/src/kill-window.ts`, and every
  reader must use it.** A `kills` row carries the victim's death time, and DayZ can stamp that
  line a second after the killer's own death line (a grenade in the air, a mutual kill). So a
  life's kill window is `[started_at, ended_at + 2 s]` (`POSTHUMOUS_KILL_GRACE_MS`), and a kill
  inside the PREVIOUS life's two seconds is that life's and never this one's, even if the player
  was already back. The rule exists three ways and they must stay identical: `isKillInLife`
  (pure; `isLifeQualified`, `lifeQualifiedAt`, the boards, the enforcer's `decide.ts`),
  `killsInLifeWindow` + `previousLifeEndedAt` (queries holding the life's bounds:
  `getLifeKills`, the life track, the enforcer's `pg-store.ts`), and the correlated SQL in
  `qualifiedLifeCondition` (which deaths get an obituary). **Ban effect:** a life under five
  minutes that ended in a non-player death is banned "by kill" when its kill line is logged up to
  two seconds after the death. It is read-time only: stored timestamps are as logged, so there is
  no migration, no `--rebuild` and no backfill, and a rebuild cannot change the answer.
  "Previous life" is by `started_at`; when two lives share a start (connect, death and reconnect
  in one logged second) the zero-length one is the predecessor of the other. An OPEN life's kill
  window ends NOW (`isLifeQualified`'s `windowEnd`), not at the last heartbeat: a trap kill is
  scored while its placer is offline. Playtime keeps the heartbeat cap.
  `getPlayerPriors` counts a kill in a prior life's two seconds as a prior kill.
  **⚠️ A kill belongs to a PLAYER by `kills.killer_player_id`, never by `killer_gamertag`**
  (`packages/read-models/src/kill-owner.ts`: `isKillByPlayer`, `killsByPlayer`). The name on the
  row is the name on the kill line; it does not move on a rename and a given-up name can be taken
  by someone else. The enforcer (`pg-store.ts`), the notifier's lives generator and the
  most-kills, longest-killstreak, alive-longest and alltime-longest boards matched by name until
  this rule: a renamed killer's kills dropped out of his ban, his "counts now" notice and those
  boards, and the name's next holder would have inherited them. **Ban effect:** a renamed
  player's short life is banned "by kill" for a kill logged under his old name, and the new
  holder of that name is not. Those six readers fall back to the name, ignoring case, ONLY for a
  row whose id is null (the fold found no player under the killer's name at the kill); the
  readers that always matched by id (`getLifeKills`, `qualifiedLifeCondition`, survivors, career
  counts) have no fallback and do not see such a row. most-kills groups by player and prints the
  current name, and longest-kills prints the current name too (the stored one on an id-less
  row); the three per-player boards key their maps by player id, since two players can hold one
  name, so they can return two rows with the same `gamertag` (`LeaderRow` carries no id).
  `getLifeKills` takes the life row's `playerId`, not a gamertag: a name lookup could pick the
  other holder of a shared name. Read-time only: no migration, no `--rebuild`, no backfill.
  **⚠️ Three enforcer rules follow from the Nitrado ban list holding NAMES, not bans** (removing
  a name lifts every ban that put it there), in `apps/enforcer/src/decide.ts`, `tick.ts` and
  `pg-store.ts`:
  (1) `planBans` plans nothing for a death whose ban is already over at `now`, so a death judged
  late (enforcer downtime, or a qualifying `kills` row that only appears in a later rebuild)
  gets no `bans` row, no Nitrado call and no notification; (2) a `pending` ban past its
  `expires_at` is marked `expired` without being sent; (3) on expiry AND on a token lift,
  `namesToRemove` (`pg-store.ts`, the one implementation) removes only the names no other real
  (not dry-run), `pending` or `applied`, not-yet-due ban on that server shares, by dayz id or by
  gamertag ignoring case, so one ban ending never unbans a player serving a later one, while a
  name only the ending ban needs (an old gamertag, or the first player's id on a recycled
  gamertag) still comes off. A redeem lifts every active ban of that player on that server.
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
## Universal Player (UP1+UP2)

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
## Death-cause fidelity

- **Death-cause fidelity, stage 1** ✅: the archived platform's interpretation layer, ported.
  `classifyDeath` (`@onelife/domain`, pure, mechanism-first ladder + side-effect subtraction,
  thresholds 1/1/120s) turns mechanism + death vitals + a 120 s `hit_events` window into a verdict
  (`starvation|dehydration|bled_out|mauled|…`, `high|low` confidence, conditions). Computed lazily —
  never materialized (no migration/rebuild; the `isLifeQualified` precedent; **superseded by stage 4**,
  which stores the death-verdict classifier's answer in `death_verdicts`; since death-verdict plan
  step 7 no page reads this stage-1 verdict — `dossierVerdict` now returns the stored public death,
  and the old classification survives only as `legacyDossierVerdict` for the suicide-wording parity
  test until step 10) — by the new
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
  Retroactive — these stage-1 verdicts are lazy, never materialized (stage 4's stored verdicts are
  re-derived by the sweep instead: a `CLASSIFIER_VERSION` bump rewrites every row).
  **Deploy runbook (stage-2 release):** normal deploy → on the host run
  `apps/projector` `backfill-death-causes` (re-parses `raw_lines`, upgrade-only, prints the
  unmapped-entity survey — feed it back into the dict) → projection rebuild
  (`./deploy/deploy.sh --rebuild`, or `pnpm --filter @onelife/projector run rebuild` directly on
  the host). Lives, priors and web surfaces update retroactively.
- **Death-cause fidelity — what the kill line names (parser, `death.ts`)** ✅. The parser now
  emits `explosion` and `vehicle` for the objects a kill line names, so `explosion` is no longer
  "reserved" (the stage-2 text above predates this). Four line shapes, each with a public test
  on an invented line in `packages/adm-parser/test/death.test.ts`:
  - **A named explosive** (`M67Grenade`, `RGD5Grenade`, `6-M7 Frag Grenade`, `EGD-5 Frag Grenade`,
    `LandMineTrap`, `Claymore`/`ClaymoreMine`, `Plastic Explosive`, `Land_FuelStation_Feed*`) →
    `explosion`. **⚠️ The entity regex captures to the end of the clause** — class names carry
    spaces and hyphens, and the old single-token capture stored `6`, `EGD`, `NO` and `Player` as
    entities.
  - **The empty-killer form, `killed by  with <thing>` (two spaces)** — `40mm*` → `explosion`;
    `Fireplace`, an ownerless firearm and anything else stay `environment`. `killer` and `weapon`
    are null in every case; the thing is kept as `deathEntity` (null, never `""`, when the line
    names nothing).
  - **`killed by NO DRIVER (<class>)`** and a `Motorbike_*` entity → `vehicle`, `deathEntity` the class.
  - **A kill line whose killer id equals the victim id** (a player caught by his own explosive;
    DayZ marks the killer `(DEAD)`) → `explosion` when the weapon explodes, else `environment`,
    **`killer: null`, and `weapon` and `distance` null too** — the fold copies those onto the life
    whatever the cause and the web timeline prints them under every death, so the thing is kept
    only as `deathEntity`. **⚠️ This return sits above the `pvp` return and must stay there**:
    `KILL_RE` now accepts `(DEAD)` on the killer half, so without it the line is a `pvp` death,
    which qualifies the life by itself. The fold's own `killer !== victim` check compares
    gamertags and is not a substitute — the parser compares ids. **Equal ids count only when the
    id is a real one** (a long opaque token): DayZ also writes sentinels (`id=ERROR`,
    `id=Unknown`), and on one of those the names must match as well, or two different players
    would be read as one.
  - **A `(DEAD)` killer who is a different player IS `pvp`** (operator decision, 2026-11-10).
    `(DEAD)` means only that the killer was already dead when the line was written — usually a
    mutual kill (both lives end `pvp`, each player is credited with the other), sometimes a
    killer a third player had already killed. The switch is `MUTUAL_KILL_IS_PVP` in `death.ts`.
    **⚠️ Known gap**: the `kills` row takes the victim's timestamp and DayZ can stamp this line a
    second after the killer's own death. Per-life kill counting is a window ending at
    `lives.ended_at` (`qualified*.ts`, `player-kills.ts`, the enforcer's `pg-store.ts`), so such
    a kill is in the career total but in none of the killer's lives — it does not qualify the
    life that just ended. `fold-death.test.ts` pins it; whether it should count is undecided.
  - **A trap names no placer, so a trap death credits no kill — for now.** The operator decided
    (2026-11-10) that a player whose placed trap kills another player gets the kill. The kill
    line cannot supply that; it is the work of a later step, which attributes the trap from its
    placement record. The fold itself never credits it; the fold test pinning "no kill" is permanent.
  **⚠️ None of this may change how many results `parseLine` returns for a line** — `subIndex` is
  the array index and `events_idempotency_uniq` is keyed on it. The shape test pins the counts.
  **The obituary prompt moved with it (`obituary-v3.1`)**: for `explosion` and `vehicle` the
  "(not a player kill)" suffix is dropped and `NAMES_NO_PERSON_DIRECTIVE` is added — the log
  naming no person is not evidence that there was none, and published prose cannot be recalled.
  **No backfill**: history was patched by hand up to the 2026-11-10 corpus snapshot; a
  `backfill-death-causes` run changes no cause in that corpus (the gate checks causes only — a
  run would still fill `deathEntity` where it is null, and never rewrites a stored fragment such
  as `6` or `NO`). **⚠️ A named-object death ingested between the snapshot and the deploy is
  stored `environment` and nothing here corrects it** — re-check before tagging.
  **`backfill-death-causes` never upgrades to `pvp`** (`mayUpgradeCause`): it patches `cause`
  alone, so a stored dead-killer line would become a qualifying `pvp` death with no killer and no
  kills row, and bans are durable. The private corpus gate (`packages/adm-parser/test/corpus.test.ts`, skipped
  unless `DEATH_GOLDEN_DIR` is set) replays every production line against a v0.80.0 baseline.
- **Death-cause fidelity, stage 3 — the unnamed deaths** ✅. A survey of every ended life
  (169) found **19 rendering "Unknown"**: 10 dropped suicides, 1 knockout, 8 with genuinely no
  signal in the ADM. Two root causes, both the "logged twice and inconsistently" pattern the fall
  rung already documents.
  **⚠️ The `(DEAD)` marker is OPTIONAL — `DEATH_RE` must NOT require it.** DayZ writes a suicide
  as a `committed suicide` line *plus* a clauseless `died. Stats>` line, and omits `(DEAD)` on the
  former **12 times in 102** in production. Requiring it dropped those lines entirely, leaving only
  the bare `died` → "Unknown". **`DEATH_VERB_RE` is what separates a death from a roster/position
  line — the marker never was**; a survey of all 59,961 raw lines found the only marker-less lines
  carrying a death verb are exactly those 12 suicides, so the loosened regex invents nothing.
  Re-adding `\(DEAD\)` "for precision" silently re-breaks every suicide.
  **⚠️ A knocked-out player's death belongs to whatever knocked him out.** He never gets up: he
  picks "respawn" or logs out, and the SERVER kills the character, so the death line names nothing.
  All 8 `choosing to respawn` lines in production follow an `is unconscious` line, each with hits
  behind it (infected ×5, player ×2, fall ×1). `classifyDeath`'s **knockout rung** attributes the
  death to the pre-knockout hit with the **lowest victim HP**. Two rules are load-bearing:
  only hits **at or before** the knockout count (infected keep chewing on a body afterwards, and
  crediting those turns a fall into a mauling), and lowest-HP wins so a stray 98 HP scratch cannot
  outvote the hits that did the work (real case: Cee Lo GREEN 96, 2026-07-13 — 1 infected scratch
  at 98.3 vs player hits to 43.6). It sits **below** starvation/dehydration (that ordering predates
  it and is pinned by its own test) and **above** the infected `mauled` rung, which it subsumes for
  knockout cases while keeping the bleeding/terminal-HP paths that rung owns. This generalises what
  `mauled` already did — that rung was gated on `hunted`, so a fall or a player putting you down
  was invisible.
  **⚠️ `verdictPhrase` must not defer to the raw cause for an `environmental` verdict.** That
  verdict used to be reachable only from a *stated* `drowned`/`environment` mechanism, where the
  raw cause was specific; inferred from a knockout it sits on a line naming nothing, so deferring
  printed "Unknown" and discarded the verdict. It now degrades to "Environment" rather than past it.
  This is the same trap as the `ENTITY_VERDICTS`/`ENTITY_MECHANISMS` mirror above — the classifier
  is right and the page still says Unknown.
  **⚠️⚠️ NEVER append an event to the log for a historical raw line — patch an existing one.**
  `events.id` IS the fold order, so an event appended today for a July line folds **last**, after
  every later event. `onDied` checks `getOpenLife` **before** its already-closed-life branch, so
  such an event **ends the player's CURRENT life and back-dates it** to the historical death. This
  was written, reviewed, shipped in v0.75.1 and caught only at the deploy step: 8 of the 12
  recoverable lines belong to players holding an open life, and `bans` is durable and never
  rebuilt, so the corruption would have outlived any projection rebuild. The reasoning that failed
  was checking `enrichLifeDeath` (order-independent, keyed on exact `endedAt`) without checking the
  branch **above** it, which is the one that actually runs — and a test that asserted the event was
  *inserted* rather than folding it. **A backfill is patch-only; if it can grow the event log, it
  is wrong.** `backfill-death-causes`' recovery arm therefore pairs a dropped death line with the
  companion `player.died` event DayZ wrote for the same death (same server, same victim, ±3 s,
  **exactly one match** or it is not a pairing) and upgrades that event's `cause`. A dropped line
  with no companion is counted in `unpaired`, reported loudly, and **left alone**.
  **Deploy runbook:** normal deploy → on the host run `backfill-death-causes` → projection rebuild.
  The 8 no-signal deaths stay "Unknown" and are not recoverable from the ADM.
- **Death-cause fidelity, stage 4 — stored verdicts** (death-verdict plan step 5; release R2).
  The `@onelife/death-verdict` classifier's answer for every ended life is stored in
  **`death_verdicts`** (migration `0040`), one row per life, with `death_verdict_queue` (lives seen
  but not yet written) and the durable **`death_verdict_overrides`**. Pages read them from plan
  step 7 on (see "The readers" below); the operator checks them with `verify-verdicts`.
  - **Classifier version 2** (plan step 6, release R2b) ports the inferred rules (B09 to B23), so
    every death gets the reference's answer; the version bump makes the sweep rewrite every row in
    place. **⚠️ The newsdesk gate:** `findObituaryTargets` (`apps/newsdesk/src/pg-store.ts`) only
    returns a life that has a `death_verdicts` row at the CURRENT `CLASSIFIER_VERSION` with
    `needs_review = false`. A new obituary therefore waits for the sweep (minutes), and every
    obituary waits while a version bump is being swept. From `obituary-v4` (plan step 8) the
    prompt reads the verdict itself (see "Newsdesk v4" below). **⚠️ The overdue alarm:** every newsdesk tick
    logs `newsdesk.obituary_overdue` at error level with the ids of qualified dead lives (since
    `NEWSDESK_SINCE`) that ended over 45 minutes ago and still have no such row
    (`overdueObituaryLives`): a needs_review row, a sweep skipped because the projector is behind,
    a projector still on an older `CLASSIFIER_VERSION` after a partial deploy, or a held life. The
    sweep never fails on most of these, so this is the one signal that sees them all.
  - **The sweep** (`apps/projector/src/verdict-sweep.ts`) runs in the projector loop after a fold
    tick (`loop.ts` `runLoopOnce`), in its own try/catch, and **⚠️ only when the fold has caught
    up** (the tick took less than a full batch and the cursor is at the newest event): mid-rebuild
    lives are half-enriched. A pass starts no new life after 10 s or 50 lives. Targets: ended lives
    with no row at `CLASSIFIER_VERSION`, or whose override changed (`death_verdict_overrides.updated_at`
    vs `death_verdicts.override_seen_at`, kept current by a trigger), oldest first. A failing life
    gets a queue row with backoff (30 s doubling to 6 h); three failures log `verdict_sweep.held`.
    **The first pass after the projector starts makes every backing-off row due** (`resetBackoff`
    in `main.ts`): a deploy is how a classifier fix arrives, and the queue row records no version.
    A life is also a candidate when `lives.death_cause` differs from the `evidence.lifeDeathCause`
    its verdict was checked against.
  - **Settled** is judged from ingest progress in the death's own file, never from stored times:
    `file` (a line of that file is 300 s past the death on the log clock), `rotation` (a later file,
    or the file is complete), `wall` (30 minutes since the sweep FIRST SAW the life —
    `death_verdict_queue.first_seen_at`, not `ended_at`). A `wall` row is re-derived once later.
  - **The loader** (`packages/read-models/src/death-context.ts`, `loadDeath`) seeds from the
    life's `player.died` event (within 2 s of `ended_at`, by dayz id or a name the player carried)
    and **`resolveCluster` resolves the real primary line**: a firearm suicide is folded from its
    `committed suicide` line, its primary is the `died.` line. The row, the override key and the
    golden join all use that resolved line (`death_file_id`, `death_line_index`). It loads whole
    files from `raw_lines`: from the previous death's file (or, for a first life, the player's first
    connect line, and never later than the file holding `started_at` − 2 h) through the file after
    the death's, and on while a later file starts within the five minutes after it. Older
    placements and detonations near the death come in as extra lines. **⚠️ `adm_files.log_date` is
    the server's wall clock labelled as UTC** (seven or eight hours early on a Pacific host); the
    loader allows 14 h of slack, and its private suite caught the first file of a life being
    skipped without it. **⚠️ The log clock, never `raw_lines.occurred_at`**, times every line.
  - **⚠️ The classifier never reads `payload.cause` or `lives.death_cause`.** The sweep reads
    `death_cause` for two things only: the invariant (a `kill_line`/`kill_line_driver` attribution
    exactly when `death_cause = 'pvp'`, else `needs_review = true` — such a row is pending, never
    public, and blocks its obituary) and the rule that no trap kill is written for a `pvp` life.
    **⚠️ A needs_review row must have a way out:** every pass logs `verdict_sweep.needs_review` at
    error level with the count, and `verify-verdicts --held` lists each. An override that sets the
    cause, confidence, object or upstream is the operator's decision on that death and clears the
    flag (`evidence.reviewResolvedBy = 'override'`; check 4 lists it instead of failing); a credit-only
    override does not. Correcting `lives.death_cause` re-derives the life.
  - **Overrides** are keyed on the resolved death line (stable across rebuilds), validated on read
    against the classifier's vocabulary (an invalid row is ignored and listed by `verify-verdicts`);
    non-null fields replace the classifier's and set `source = 'override'`. `credit = 'deny' | 'grant'`
    drives the trap kill. **A held life** (the loader or the classifier throws) has no stored row,
    so no resolved line: an override with a cause AND a confidence on the life's death EVENT (the
    seed, `deathSeedOf`; `verify-verdicts --held` prints it as "override key (death event)") is
    stored as the verdict on its own (`writeHeldOverride`: rule `override`, no attribution, no
    evidence, no trap kill, never second-looked). It stands until the override changes or a version
    bump re-derives the life; for a firearm suicide the seed is the `committed suicide` line, so a
    fixed classifier keys on the `died.` line instead and check 8 lists the old override.
  - **Trap kills** (spec 2.4): a credited trap or mine kill is a row in `kills` with
    `basis = 'trap_placement'` (`credit_source` `classifier` or `override`), written by the sweep in
    the SAME transaction as the verdict. **⚠️ Two writers: the fold never touches a trap row, the
    sweep never touches a `kill_line` row** (check constraint `kills_basis_chk`). Tests 6 (the placer
    has a `players` row) and 7 (the victim's life counts on its own: 300 s, or a kill-line kill of
    theirs in the life — never another trap kill) live in the sweep's `resolveCredit`; a grant
    replaces tests 2, 3 and 5 only. The stored `evidence.credit.outcome` is `credited`, `granted`,
    `denied`, `refused` (with the test) or `not_applicable`, never the classifier's `evidence_passes`.
    An override that lowers the confidence below strong, or moves the cause to the other trap
    device, is refused by test 1. A valid `deny` left on another line of the death's cluster (the
    primary line can move on a re-derivation) still keeps the trap kill out; its other fields are
    not applied, and check 8 lists it. An override whose `server_id` is not its death file's server
    is invalid. **`TRAP_KILLS_WRITE`** (projector env, default off) gates the row, and is part of
    what makes a life a candidate: off, every `trap_placement` row is deleted at the start of each
    pass (the rollback); on, a stored `credited`/`granted` credit whose life has no row in `kills`
    is re-derived and written on the next pass. A refusal by test 6 is re-derived once the placer
    has a `players` row; a refusal by test 7 is decided once (its inputs are complete when the fold
    has caught up), and only a version bump or a rebuild revisits it.
  - **Second look.** A wall-settled row stores a cheap `settleProbe` (the server's newest file id,
    the death file's last line, whether it is complete). It is worked out again only once one of
    those has moved, or after 24 h, never on every pass; a second look that throws gets a queue row
    with backoff like any other failure.
  - **Rebuild.** `death_verdicts` and the queue are NOT in `REBUILD_TRUNCATE_TABLES` (they are
    created in the release that ships them — the v0.42.1 rule); `TRUNCATE lives ... CASCADE`
    empties them and `kills` is truncated, so trap rows vanish until the sweep refills after the
    fold catches up. Overrides survive.
  - **Readers that moved with it:** the open-life kill window in `getPlayerProfile`,
    `getPlayerLives`, the survivors board and alive-longest now ends at `now`, not the last
    heartbeat (a trap fires while its placer is offline); playtime keeps the heartbeat cap. The
    enforcer's `planBans` takes `now` and skips a ban that would already have ended; expire and lift
    remove only the ban-list names no other running ban needs (`namesToRemove`: an old gamertag
    after a rename comes off, a shared dayz id or gamertag stays); one unban token lifts every active ban of that player on that server;
    `ban_applied` says "banned until …" from `expires_at`.
  - `backfill-death-causes` is kept and is not needed for any of this.
  - **Verify** (`pnpm --filter @onelife/projector run verify-verdicts`, read-only): checks 1 to 10
    of spec 5.5 (`--golden`, `--csv`, `--rederive`, `--held`, `--credits`, `--expect-trap`). Its
    output names players: read it on the host, never paste it anywhere public. `--held` also lists
    needs_review rows and every life waiting over 45 minutes for a reviewable verdict. **Check 7**
    measures spawn levels only on deaths since the server's current `SPAWN_BASELINES` entry (an
    all-time median blends levels) and fails when the observed level differs from the table either
    way, with three deaths or more: add an entry, which is a version bump.
  - **⚠️ Inferred causes with no family are never shown.** `present.ts` prints an inferred verdict
    only when its public row has an `InferredFamily` whose `PUBLIC_INFERRED` switch is on. Fall,
    wildlife, a held grenade and the like have no family (the operator approved six), so B12's and
    B10's inferred fall or wildlife verdicts read "Not recorded" until the operator gives that row a
    family and a switch.
  - **The readers** (plan step 7, release R3). **⚠️ `packages/read-models/src/death-verdicts.ts` is
    the only reader of `death_verdicts` that serves a page.** It selects NAMED columns (never the
    whole row, never `attr_gamertag`/`attr_dayz_id`/`object_text`/`evidence`; `rule` only to know
    an A14 "Shot") and presents through `toPublicDeath`. A row at any classifier version is final
    unless `needs_review`; no row, or a review-held row, is **pending**: the death line's own coarse
    word ("Killed by NAME", "Suicide", "Infected", …) or "Awaiting the record" — never a read-time
    classification. `getPublicDeath`/`getPublicDeathsForLives` return null for an open or retired
    life. The timeline (`verdict`), past lives (`death.verdict`), the ban card (`ban.verdict`) are
    all that shape, with the legacy `cause`/`confidence`/`conditions` still in today's vocabulary —
    the legacy fields are what `articles.cause` and `facts.verdict` store (newsdesk v4 below).
    - **A victim's trap credit** comes ONLY from its `kills` row with `basis = 'trap_placement'`
      (`getTrapCreditForVictimLife`), with the placer's CURRENT gamertag joined on
      `killer_player_id`. A placer who failed the bar has no row and appears nowhere. "Kill
      credited to NAME." is the only phrasing; the web links the name after the sentence.
    - **Kills carry `basis`** (`PlayerKill.basis`, required on the DTO; the kill feed returns whole
      rows, so `basis` and `credit_source` are served). `lifeQualifiedAt` reports the qualifying
      kill's basis (`killBasis`) and the timeline words it "A trap kill credited. The life counts
      from here."; WHEN a life qualifies is unchanged. **⚠️ `life-track.ts` drops trap kills from
      the map markers** (a marker pins the killer's own fix; a trap fires where it was placed).
      most-kills orders level players by name, so ties (common with trap kills) are stable.
    - **Articles** carry `death` = the live FINAL verdict (through `player_gamertags`, as the
      timeline finds the article), else the frozen `facts.death` strings (`status: "frozen"`; for
      a trap death every string is rebuilt from the row with no name, keeping only the key, the
      certainty's caption and an object the row can hold, so a since-denied credit cannot survive;
      a frozen inferred death whose family has no switch or is switched off is no frozen value),
      else null and the reader falls back to `cause`/`verdict`. A pending verdict never replaces
      frozen values. Share images: the life card is `max-age=86400` when its verdict is final and
      `max-age=60` otherwise (pending, no verdict, failure); the obituary card is 86400 for a final
      or frozen death, else 60. Next's own default is a year, so neither may leave it unset. **⚠️ The reserved cause tag (`tags[2]`) is rewritten at
      read time** by spec 6.2's table (`articleTags`): definitive/strong → live tag; inferred with
      its family on → the tag only under an `obituary-v4`+ prompt, else "Unknown"; family off,
      unknown, withheld → "Unknown"; pending → stored. So the chip follows the prose it sits above.
    - **Priors** (`player-priors.ts`) count definitive and strong verdicts only and aggregate on the
      public TAG, never the label (a label can hold a killer's name); the prior prints the tag's
      lower-case noun ("pvp", "hunger and thirst", "wildlife").
    - **Renames and the grace.** A trap row is matched to its placer by `killer_player_id`
      (kill-owner.ts) and read through kill-window.ts like any kill line: a rename loses it nowhere
      and the boards print the placer's current name; one logged up to two seconds after the
      placer's death belongs to the life that ended (its `qualifiedAt` capped at the death).
      `trap-kill-parity.test.ts` pins both.
  - **Newsdesk v4** (plan step 8, release R3; prompt `obituary-v4`). The writer is told what the
    stored verdict says, through `getWriterDeath` (read-models; newsdesk only) and
    `writerBrief`: the cause line by certainty. Definitive and strong lines sit among the
    confirmed facts (strong adds "one small qualifier is allowed"); an inferred line ("most
    likely …") and a trap credit line go under `NOT CONFIRMED: the paper's reading` with their
    directives; not recorded sends `NO_MECHANISM_DIRECTIVE`, withheld the withheld directive. No
    logout directive is ever sent (the instruction would itself be a tell). Kill counts include
    trap kills ("Kills this life", "Kills across all prior lives"); when this life or the priors
    hold one, `TRAP_KILLS_CAVEAT` goes under the NOT CONFIRMED heading.
    - **`facts.death`** freezes `{ key, tag, certainty, label, detail, sentence, caption, trap,
      selfStated }` built WITHOUT the credit and WITHOUT a named driver (`writerDeathOf`).
      `facts.verdict` and `articles.cause` are today's vocabulary (`legacyCause`).
      `articles.verdict_version` (migration `0041`) is the classifier version written from.
      `facts.trapKills`, `facts.priors.trapKills` (numbers) and `facts.creditSent` (a boolean) are
      stored. **⚠️ The credited name (`facts.creditedGamertag`) and the brief are never stored**:
      `storedFacts` strips them in the tick and `publishObituary` strips them again.
    - **The reserved tag** is `death.tag` ("Unknown" if and only if the certainty is unknown).
    - **⚠️ The cause check** (`cause-check.ts`, `findCauseViolations`) runs beside
      `findPlaceViolations` with the same retry-then-fail path. It reads the one flavour tag
      `composeTags` keeps (`flavorTagOf`), never the composed reserved tag (a family word by
      design). Six rules: logout words (whole article for a logout-family death); for a death the
      writer was given no cause for, no word of its internal family and no explicit mechanism
      (`MECHANISMS`: froze, starved, gunned down, fell, wolves, drowned, tripwire, restrained...)
      in the headline, lede or tag; pneumonia/silicosis/heatstroke never; an inferred cause absent
      from the headline, pull quote, attribution and tag and hedged clause by clause in the lede
      and body (split on `;`, `:`, dashes and "but"); the credited name, as a whole word, out of
      the headline, lede, pull quote and tag, and never told as the killer in the body; no kill
      count in the headline or lede when a trap kill is in it (the writer is told this,
      `TRAP_KILLS_COUNT_DIRECTIVE`). The internal hints (`getDeathCheckHints`: `logoutFamily`, and
      `family` of the stored or upstream cause) are passed as an argument, never put in facts or
      the prompt. **⚠️ Exemptions apply in the lede and body only, never the headline, pull quote
      or tag**, and only to a clause visibly about a sent fact: past run-ins (a count or an
      encounter word, no death term), the player's own kills ("shot two men", nothing aimed at
      him), or an earlier death ("last time", "previous", "his last life") with no repeat marker
      ("again", "too", "as usual"). A family word right after a negation ("never fired a shot") is
      no claim. **⚠️ `articles.last_error` stores only the rule numbers** (`CauseCheckError`): the
      field that broke rule 1 would show a logout-family death. The full strings go to the
      operator log. It is lexical; tune its word lists with `scripts/check-inferred-previews.ts`
      (the operator's model key; a local `*_test` database only, since production's database is
      on 127.0.0.1 too), never by guesswork. That script drafts three groups: deaths shown
      inferred, a sample shown with no cause, and trap-setters.
    - **Slug freeze.** `publishObituary` keeps an existing slug on conflict; the crier's ledger is
      keyed on it. **⚠️ It does not survive a rename:** the conflict key holds `articles.gamertag`,
      which `publishObituary` fills from the player's current gamertag, so after a rename a
      re-publish inserts a second row with a new slug (a new crier target). The tick cannot reach
      this (published lives are excluded), but a regenerate command must update by article id or
      slug, or resolve the article's stored gamertag first.
    - **Preview.** `pnpm --filter @onelife/newsdesk run preview -- --life <id> [--generate]` prints
      the prompt the tick would send, recent-prose block included (and with `--generate` one draft
      and both checks, with the internal hints). It writes nothing.
  - **Correcting old obituaries** (plan step 9, release R4). `pnpm --filter @onelife/newsdesk run
    regenerate -- <selector> [--slug <s>] [--limit N] [--write]` rewrites published obituaries in
    place through the same prompt and checks as a new one (`generateObituary`, with
    `getDeathCheckHints`' result). Selectors: `--slug <s>` (that article; the pilot),
    `--stale-cause` (filed with no cause, or as a bare explosion / vehicle / environment, while the
    verdict now states one at definitive or strong; never an inferred one), `--stale-inferred`
    (written before `obituary-v4` about a death now read "Likely ..." with its family on; residual
    question R5 decides whether it is run), `--inferred-family <f>` (v4 articles whose FROZEN
    `facts.death` narrated a "Likely" reading in `f`, rewritten as not recorded whatever
    `PUBLIC_INFERRED` says: `getWriterDeath`'s `withdrawFamily`, which also writes a death held for
    review in that family), `--denied-credit` (spec 6.4: a victim's article whose credit is gone,
    or a placer's whose `facts.trapKills` / `facts.priors.trapKills` exceeds the live count, counted
    by the same readers that froze them, `getLifeKills` and `getPlayerPriors`; retracted with
    `status = 'retracted'` when the life no longer qualifies; an article whose life does not
    resolve is listed and reported as skipped). `--restore <slug>` writes the latest archived
    version back. A v3 article filed as Environment over a bare "died" (the old read-time guess)
    counts as a bare "environment" for `--stale-cause`.
    - **⚠️ Every selector but `--slug` is idempotent**: each selects on what the article froze, which a rewrite
      changes, so a repeated `--limit N --write` batch moves on. Never select on the stored verdict
      alone (a rewrite leaves it as it is). A batch in which nothing was written prints a note:
      failures stay at the front of the selection.
    - **⚠️ The write locks the row and checks it is still the version selected** (`lockUnchanged`:
      published, same text and `generated_at`); otherwise nothing is archived or written and the
      article is reported as failed. `--restore` reads, archives and writes under the same lock.
    - **⚠️ Dry-run is the default, and it still calls the model** (the operator reads the new
      headline and lede first). `--write` archives the row in `article_revisions` (0042, durable,
      no FK) and swaps the text in one transaction. Failed generation or check: nothing changes.
    - **⚠️ Updated by article id, never through `publishObituary`'s upsert** (the slug freeze does
      not survive a rename). The life is found through `player_gamertags`
      (`getArticleLives`); the reads use the player's current name and the prose the article's
      frozen `articles.gamertag`. Never touched: `slug`, `status` (except retract/restore),
      `attempts`, `created_at`, `syndications`. Besides the plan's columns it also rewrites
      `kills`, `time_alive_seconds` and `longest_kill_meters` (the Rap Sheet reads them, and a
      denied trap kill must leave the count) and nulls `body_blocks` (an old rich body would be
      rendered instead of the new flat one).
    - **The do-not-reuse list** is `recentProse` plus the drafts written earlier in the same run
      (regeneration keeps `created_at`, so `recentProse` alone never sees them).
    - **⚠️ `--denied-credit` refuses while the verdict sweep has anything outstanding**
      (`verdictSweepBacklog`: a queue row, an ended life with no verdict at the current version, or
      the fold cursor behind the newest event). In the gap after a `--rebuild` every trap kill is
      absent and the command would act on all of them. A death in its settle window blocks it for a
      few minutes too; run it again.
    - **⚠️ A retracted obituary blocks its life** in `findObituaryTargets` and the overdue alarm
      (`status IN ('published','retracted')`), so a life that qualifies again is not regenerated
      and re-posted with a paid model call. Every reader and the crier select `published` only.
    - **The correction line** ("This obituary was rewritten on <date> after the cause of death was
      corrected.", question 5 answer A) is `correctedAt` on `getObituaryBySlug`, read from the
      NEWEST revision only (`correctedAtOf`): a `cause-corrected` rewrite shows it; a `restored`
      revision carries the restored text's own value (`restoredCorrectedAt`), so restoring the
      original text drops the line; `kills-corrected` (a count fix), `regenerated` (`--slug` with
      the cause unchanged, `causeChanged`) and `retracted` keep the line the replaced text had
      (`snapshot.correctedAt`), and never start one.
    - Discord and Facebook posts cannot be recalled: `--inferred-family` and `--denied-credit`
      print each article's URL and publish date so they can be deleted by hand.
  - **Unqualified bans** (spec 6.4). `pnpm --filter @onelife/enforcer run unqualified-bans [--
    --lift]` lists running `qualified_death` bans whose life no longer qualifies by the predicate
    `planBans` uses (`lifeQualifies`, on the same kills: `endedLifeOf`, which matches kills by
    `killer_player_id`, and by name, ignoring case, only on a row with no id: the command runs
    after renames, and the current name is not the one on an old kill line). `--lift` sets an applied
    ban to `lift_pending` and a pending one to `lifted`, with `bans.lift_reason = 'operator'` (0043;
    `redeem` writes `'token'`; NULL on older rows reads as token). The next enforcer tick removes
    only the names no other running ban needs (`namesToRemove`). Same sweep guard as above. The
    notifier's `ban_lifted` says "the ban was lifted by the server operator" for these, never that a
    token was spent. A token spent on such a ban is refunded by hand.
## Identity merge, content engine, obituaries

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

## Mauled inference

- **Mauled inference** ✅ (spec `docs/superpowers/specs/2026-07-29-mauled-inference-design.md`):
  DayZ logs some infected deaths with no `killed by` clause and `Bleed sources: 0` (the wounds
  close before the player expires) and kills a player outright for logging out unconscious, so
  those deaths landed as `unknown`. The classifier's mauled rung is now
  **`hunted AND (bleeding OR wentUnconscious OR terminalHp <= 1)`** — `hunted` (any infected hit in
  the 120s window) is the gate, the other three are interchangeable corroboration. The knockout
  signal is new plumbing: `packages/adm-parser`'s `parseUnconscious`, a `player.unconscious` event,
  a projected `unconscious_events` table (migration `0031`), and `recentUnconscious` on
  `LifeDossier`, forwarded by `dossierVerdict` as `classifyDeath`'s **required** third argument.
  Verdicts stay lazy and are never materialized (stage 4's stored verdicts are re-derived by the
  sweep on a version bump instead), so corrected lives fix themselves; already-published
  obituary prose is frozen and is NOT regenerated automatically (the newsdesk's `regenerate`
  command rewrites it on the operator's say-so; see "Correcting old obituaries").
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

