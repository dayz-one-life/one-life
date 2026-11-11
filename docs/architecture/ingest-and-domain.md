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
  which stores the death-verdict classifier's answer in `death_verdicts` — this stage-1 verdict is
  still what pages read until the readers move, death-verdict plan step 7) — by the new
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
  but not yet written) and the durable **`death_verdict_overrides`**. Nothing reads them on a page
  yet (step 7); the operator checks them with `verify-verdicts`.
  - **The sweep** (`apps/projector/src/verdict-sweep.ts`) runs in the projector loop after a fold
    tick (`loop.ts` `runLoopOnce`), in its own try/catch, and **⚠️ only when the fold has caught
    up** (the tick took less than a full batch and the cursor is at the newest event): mid-rebuild
    lives are half-enriched. A pass starts no new life after 10 s or 50 lives. Targets: ended lives
    with no row at `CLASSIFIER_VERSION`, or whose override changed (`death_verdict_overrides.updated_at`
    vs `death_verdicts.override_seen_at`, kept current by a trigger), oldest first. A failing life
    gets a queue row with backoff (30 s doubling to 6 h); three failures log `verdict_sweep.held`.
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
    public) and the rule that no trap kill is written for a `pvp` life.
  - **Overrides** are keyed on the resolved death line (stable across rebuilds), validated on read
    against the classifier's vocabulary (an invalid row is ignored and listed by `verify-verdicts`);
    non-null fields replace the classifier's and set `source = 'override'`. `credit = 'deny' | 'grant'`
    drives the trap kill.
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
    output names players: read it on the host, never paste it anywhere public.
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

