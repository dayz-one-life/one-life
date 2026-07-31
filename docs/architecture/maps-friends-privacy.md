# Maps, friends, and location privacy

> **⚠️ The friends feature (friendships, roster, location grants) was removed whole in v0.69.**
> Only session-scoped location sharing survives, now in `packages/location-sharing`. The
> friendship/roster/F1/F3 sections below are historical record, kept for the reasoning they
> contain — not a description of what currently ships.

Split out of `CLAUDE.md` (2026-07-29), verbatim. Feature entries in original order.

## Owner-only life location map

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
## Friends F1 / F3 / F2

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
## M1 — map tool shell

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
## Sub-project E — session location sharing

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

