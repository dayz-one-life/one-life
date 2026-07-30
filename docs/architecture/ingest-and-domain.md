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

