# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [0.39.0] - 2026-07-22

### Added

- The map is now a proper map application. It fills the whole screen, with one slim bar across
  the top instead of the site's usual furniture: a way back, the map you are on (and a menu of
  the others, each with a count of friends there), a search box, a locate button and a friends
  list.
- Search any town, village or landmark by name and the map flies to it — including the small
  places that only get a label once you are close enough to see them.
- A crosshair sits in the centre of the map with the grid reference underneath it. Tap it to
  copy the pair, ready to send to whoever you are trying to meet.
- The locate button recentres the map on you. If you have no live position it says so rather
  than sitting there doing nothing, and it never claims to be loading a position that is not
  coming — nor that you are offline when what actually happened is that the page could not
  reach the server.
- On a phone the search box is a magnifier that opens across the bar, so the bar itself stays
  uncluttered and every control keeps its place at the narrowest screens.

### Changed

- The list of who is sharing a position moved out from under the map and into the bar's
  friends panel, so the map itself gets the whole screen.

## [0.38.3] - 2026-07-22

### Fixed

- Changing your gamertag no longer sheds a death ban. Bans are now placed against the
  player's stable account ID as well as their name, so a rename keeps the ban in force.

## [0.38.2] - 2026-07-22

### Fixed

- Map place names are readable at last. The previous attempt put the solid backing on the
  wrong element, so it painted a small black dash beside each name while the name itself
  stayed bare — and the terrain underneath is pale, not dark, so bare white lettering
  vanished into it. Each name now sits in its own solid block.

## [0.38.1] - 2026-07-22

### Fixed

- Map place names are legible again. The smaller labels — the villages and landmarks that
  only appear once you have zoomed in — were drawn as pale text with a soft shadow, which
  disappears into the terrain underneath. Every label now sits on a solid block, at full
  strength, whatever is behind it.

## [0.38.0] - 2026-07-22

### Added

- Place names on both maps. Towns, villages and landmarks are now labelled on the friends
  map and on your own life trail, so a dot finally means something without counting grid
  squares. The labels thin out as you zoom out — capitals and cities stay put, villages
  appear as you come in closer, and hills, camps and ruins only once you are reading a
  single valley.

## [0.37.4] - 2026-07-22

### Fixed

- Deploy: the `db:migrate` and `--rebuild` phases now receive the `DATABASE_URL` environment variable explicitly. Both ran as subprocesses of the deploy script without inheriting the variable, causing drizzle-kit to fail with "DATABASE_URL is not set". The fix exports `DATABASE_URL` after reading it from `.env`, ensuring child processes can access it.

## [0.37.3] - 2026-07-22

### Changed

- Deploy docs: documented that a change to the deploy script never applies to the deploy that
  installs it — the release is deployed by the previous release's script — and recorded the
  one-time step needed to install v0.37.2's database-connection fix.

## [0.37.2] - 2026-07-22

### Fixed

- Deploy: the migrate and `--rebuild` phases now receive the database connection string
  explicitly. Both ran as child processes that never inherited it — migrations had been
  working only because of a hardcoded fallback, and `--rebuild` would have failed outright.
  Both phases run after the services are stopped, so either would have aborted a deploy
  mid-flight.
- A friend whose gamertag has been recorded under two different capitalisations no longer
  appears twice on the map, in two different places at once. Only one — the most recently
  active — is shown.
- The friends map no longer comes up empty for a player who has verified a gamertag but not
  yet been seen in game. Their own dot is simply absent; their friends still appear.
- Fixed the disabled sharing switches on the friends roster: they no longer show a clickable
  cursor, and a switch that is both on and unavailable now dims as one piece instead of
  showing a full-strength checkmark in a faded box.
- The friends roster now announces it to screen readers when the list shrinks under you —
  for example when someone declines a request while you are looking at a later page — instead
  of silently moving you to a different page.
- Test tooling: the shared test cache now treats the database a suite runs against as an
  input, so pointing the suite at a different database can no longer replay a cached pass and
  report success without running anything. Database migrations likewise refuse to run against
  a guessed connection string instead of silently targeting the wrong database.

## [0.37.1] - 2026-07-22

### Changed

- The friends map now fills the page instead of sitting in a small panel, and every dot
  carries its gamertag on the map itself rather than hiding it behind a click.

## [0.37.0] - 2026-07-22

### Added

- See where your friends are. A new map for each server shows your own position alongside
  every friend currently sharing with you, reachable from the account rail. **Nobody is on
  the map until they switch sharing on** — there is one switch to share with your friends
  and a per-friend one to hide from someone in particular, and a line on each friend telling
  you whether they are sharing with you. Only a last known position is ever shown, only
  while that player is online, and only if it is recent: log off and your dot disappears
  rather than leaving a marker on wherever you stopped.

### Changed

- Verifying a gamertag now switches your status and location sharing back off. If the
  gamertag on your account changes, the people you had shared with are no longer sharing
  with the same survivor, so those choices start again rather than carrying over silently.

## [0.36.0] - 2026-07-22

### Added

- Know when your friends are playing. Turn on "Share my status with friends" from the
  roster and your friends can be told when you come online; each friendship then has its
  own pair of switches, so you can stay hidden from one person while visible to the rest,
  and mute a friend whose comings and goings you'd rather not hear about. **Sharing is off
  until you switch it on** — nobody is visible by default, and nothing is announced about
  anyone who hasn't opted in. You'll hear about a given friend at most once every four
  hours, so a server reboot doesn't turn into a flurry of alerts.

## [0.35.0] - 2026-07-22

### Added

- A life location map for the signed-in owner of a gamertag: the life timeline page now shows
  your own route trail and approximate kill/death/last-known-position markers, on both open and
  closed lives. It's visible to no one else — the API route that serves it takes no player
  identifier at all, deriving the subject solely from your session's verified gamertag link, so
  there is no request that could ask for someone else's position. Every marker is approximate:
  deaths and kills have never carried recorded coordinates, so each pin is the nearest position
  fix before the event, discarded outright past 15 minutes old. Deploying this release requires
  a one-time host step, `deploy/mirror-tiles.sh`, to mirror map tiles to disk; the map still works
  without it, falling back to a plain background.

## [0.34.0] - 2026-07-22

### Added

- Friends. Send a survivor a friend request from their dossier, and answer the ones you
  receive from a new roster page at `/friends` — reachable from the account rail on desktop
  and the account sheet on a phone. Both sides must have a verified gamertag. Declining is
  silent, and a declined request can't be re-sent for seven days; removing a friend is
  immediate and mutual. Requests are capped at 20 a day.
- Two new notifications: someone sent you a friend request, and someone accepted yours.
  Unlike every other notification on the site, these are written the moment the action
  happens rather than by the background sweep — **they are live as soon as this deploys**,
  with no cutoff to configure first. Declining and removing tell nobody.

## [0.33.0] - 2026-07-21

### Added

- A sitemap, so search engines can find every player dossier, life timeline, article and
  leaderboard the site publishes — plus a robots.txt that keeps crawlers out of the sign-in and
  notification pages.

## [0.32.0] - 2026-07-21

### Added

- Gamertags named in an article now link to that player's dossier — in obituaries, birth notices,
  news features, and the desk's editorial pieces, throughout the back catalogue as well as new
  writing.

## [0.31.0] - 2026-07-21

### Added

- **In The Paper** — a player's profile now lists every article the paper has published about them,
  newest first, alongside their standing and their past lives. That includes obituaries where they
  were the one holding the rifle, not the one being buried.

## [0.30.0] - 2026-07-21

### Added

- Cross-links between players, lives, and articles. The server cards in your account controls now
  open the life they describe — whether you're alive there, banned, or just idle. An obituary or
  birth notice links from its byline to that life's full event timeline, and a life timeline links
  back to its obituary once the paper has published one.

## [0.29.6] - 2026-07-21

### Fixed

- The notifications popover no longer opens behind the page. Clicking the masthead bell
  rendered the panel underneath whatever was beside it — the controls rail on wide screens,
  article hero images elsewhere — so the notifications were present but unreadable. The
  masthead now sits on its own layer above the page and below full-screen overlays, so the
  panel opens on top while the skip-to-content link and the mobile controls sheet still
  clear it.

## [0.29.5] - 2026-07-21

### Changed

- Pill re-homing (UX review sub-project 4): the mobile account control moved from a floating
  pill fixed to the bottom of every page into the masthead next to the notification bell —
  a tappable avatar that opens the controls sheet (a "Sign in" chip when signed out). The
  floating pills are retired and the reserved bottom gutter is gone, so pages use the full
  height on mobile. The controls sheet and everything in it are unchanged.

## [0.29.4] - 2026-07-21

### Fixed

- Live-data honesty (UX review sub-project 3): dry-run bans (never placed on the game server)
  no longer render as a real ban or accept a token spend; the life-timeline "time alive" caps at
  last-seen like the board and dossier (no more "9h and counting" for a player who logged off
  hours ago); an expired ban countdown flips to a terminal state instead of a dead "0h 0m" timer;
  loading and failed fetches no longer render as an authoritative "0 tokens", "idle", or "empty
  desk"; the Fresh Spawns status recomputes at request time so a since-died subject reads as dead;
  the share card says "first seen" rather than "surviving since"; and a regenerated article image
  busts its own cache.

## [0.29.3] - 2026-07-21

### Fixed

- Screen-reader structure (UX review sub-project 2): verification progress, token sends, and
  the magic-link confirmation now announce via live regions; the gamertag autocomplete is a
  proper ARIA combobox with announced result counts; notification/standing/past-life/timeline
  collections carry list semantics; card and Rap Sheet titles are real headings; the Rap Sheet
  and Priors definition lists read label-before-value; the Qualified stat has a text
  equivalent; form errors are tied to their inputs; and the skip link lands focus on a
  focusable `<main>`. No visual change.

## [0.29.2] - 2026-07-21

### Fixed
- Contrast & type floors (UX review sub-project 1): all small red text moved to `red-deep`
  (4.5:1+), article prose is now 16px with a 68ch measure, content labels rise to an 11px
  floor (guard-tested), the masthead wordmark declares intrinsic dimensions (no more load
  shift), the survivors skeleton matches a full page, stat/countdown digits are tabular,
  skeleton pulses respect reduced motion, long gamertags truncate, and form inputs carry an
  explicit focus-visible outline. Both policies are documented at the tokens in `globals.css`.

## [0.29.1] - 2026-07-20

### Fixed
- Mobile player controls polish: the bottom sheet now swipe-dismisses from its handle, animates
  in/out (instant under reduced motion), and closes itself on any navigation; the pill and sheet
  respect the iOS safe area; inputs are 16px on mobile so iOS Safari stops zooming on focus;
  quiet actions meet 44pt; the sheet's smallest type rises to a readable floor; form errors
  announce to screen readers; and the dark surface's hardcoded hexes became named tokens
  (`dark-well`/`dark-hollow`/`dark-edge`/`dark-edge-bright`).

## [0.29.0] - 2026-07-20

### Changed
- Notifications moved to the platform convention: a masthead bell with unread badge on every
  page (anchored popover on desktop, link on mobile), a permanent `/notifications` inbox
  ("The Wire") with the push-alerts toggle, and a frozen-tint read model so rows no longer
  flatten mid-glance. The rail and mobile sheet drop their notifications panel; iOS Safari
  now explains Add to Home Screen instead of hiding the push toggle.

## [0.28.0] - 2026-07-20

### Added
- web: **the news-led front page** (the R5d §15 follow-up). When the desk has published, the home
  page leads with the newest feature — full-width 16:9 hero photo, kicker/dateline, display
  headline, lede — with the next two features in a two-column rank below (`NewsLead`,
  `@/components/front-page/news-lead`). The manifesto hero + top-5 "Still breathing" board remain
  as the empty-newsroom fallback and render byte-identically when no news exists. News feed cards
  (`getPublishedNews`) now carry a cache-versioned `imageUrl` to power the lead; the `/news`
  section feed page itself stays text-only.

## [0.27.2] - 2026-07-20

### Fixed
- read-models: **a regenerated hero photo now busts every cache layer.** The media route serves a
  year-long immutable cache header while regeneration reuses the same filename, so a replaced
  image stayed stale in next/image, the CDN, and the browser until manually purged.
  `getNewsArticleBySlug` now versions `imageUrl` with the stored image's `created_at`
  (`?v=<epoch>`), giving every regeneration a fresh cache key; articles with no stored image row
  keep the bare URL.

## [0.27.1] - 2026-07-20

### Changed
- web: **the article hero photo is now a 16:9 crop at the full article-column width** (was a 4:5
  crop capped at `max-w-md`); the news-interior loading skeleton mirrors it. The newsdesk's
  `IMAGE_ASPECT.hero` prompt nudge follows to 16:9 so future canvases are framed landscape;
  already-stored portrait heroes crop to their middle band via `object-cover` — no regeneration
  needed.

## [0.27.0] - 2026-07-20

### Added
- **The editorial newsroom** — a human-written editorial desk for the News vertical, replacing
  `newsTick` operationally while the automated pass stays shipped and disabled
  (`NEWSDESK_NEWS_ENABLED`/`NEWSDESK_NEWS_SINCE` stay unset).
  - db: migration `0016` — `articles.server_id`/`gamertag`/`map`/`life_number`/`life_started_at`
    become nullable, so an institutional piece (a census has no one subject) can exist as a row.
    **Normal deploy, no `--rebuild`** (`articles` is durable, not a projection).
  - read-models: `newsFormatOf` routes the `almanac:`/`ledger:`/`editorial:` natural-key prefixes
    to a third `editorial` format (unrecognised keys still fall back to `long_form`); nullable
    subject fields on news cards; `getNewsArticleBySlug(db, slug, { includeDraft })`; an
    `assertSubjectful` guard crashes loudly if a null-subject row ever reaches the two life-keyed
    article read-models.
  - api: token-gated draft preview — `GET /news/:slug?preview=<token>` serves a `status='draft'`
    article when the token matches the new **`NEWS_PREVIEW_TOKEN`** env (constant-time compare;
    unset token ⇒ preview disabled entirely, fail closed).
  - web: an editorial interior arm (kicker from `facts.format`, "Filed by The Desk" byline, no
    dossier/status line/timelines), a DRAFT banner + `noindex` on drafts, and feed/related cards
    that degrade gracefully for subject-less rows.
  - newsdesk: the **`newsroom` CLI** (`draft`/`publish`/`unpublish`/`spike`/`list`/`scout`) — the
    only write path for editorial rows: zod contract with a required `factCheck` provenance
    table, the vendored §9 Tier-1 voice lint, deterministic slugs, body derived from blocks, and
    `scout` running the shipped trigger finders as story tips plus a per-map aggregate digest.
  - skills: `drafting-an-article` — the session ritual (scout → explore → consent → voice →
    compose → draft → preview → publish), reading the brand bible live.

## [0.26.1] - 2026-07-20

### Fixed
- web: **the notifications panel was invisible on mobile.** It shipped styled entirely in
  light-rail tokens (`text-ink`, `border-ink`, `bg-bone`, `text-ink-muted`) and was mounted bare
  into the mobile `ControlsSheet`, which is `bg-dark` — so on a phone every element rendered
  ink-on-dark: present in the DOM, readable by the tests, unreadable by a human. The panel gains
  an `onDark` variant; the sheet mount passes it and the desktop rail keeps the light default.
  `accentFor()` takes the flag too, since the ink bookkeeping spine had the same problem, and the
  unread-row tint moves from `bg-[#111]` (~1.03:1 against the sheet — no visible tint at all, so
  read and unread rows were indistinguishable) to the palette's own `bg-dark-line`. The regression
  was invisible to the suite because RTL asserts the DOM, not contrast — the new tests pin the
  token swap itself, with `toHaveClass` rather than substring matching (`text-cream-muted
  hover:text-paper` *contains* `text-paper`, so `toContain` had a live false-pass mode).
- web: **the push opt-in toggle had the same defect, one level down.** `PushToggle` renders *inside*
  `NotificationsPanel` and took no props at all, so on the mobile sheet the one control that turns
  push alerts on was itself unreadable — on the device push notifications exist for. It gains the
  same `onDark` prop, applied across every state (idle, working, blocked, and the error retry).
- domain: **a fatal fall whose death line names no killer now reads as `fall`, not "no cause
  recorded".** DayZ logs a fatal fall twice and inconsistently: a `hit by FallDamageHealth` line
  at HP 0, and a death line that — unlike an animal or infected kill — carries no `killed by`
  clause at all. The stage-2 entity dict only reads the killer clause, so these deaths arrived as
  a bare `died`, categorised `unknown`, and the paper reported no cause for a man who fell to his
  death in plain sight of the log. `classifyDeath` gains a fall rung above the condition
  inferences: a recent hit labelled `FallDamage*` that took the victim to 0 HP is the killing
  blow. A starving man who falls died of the fall — his hunger stays in `conditions`. A
  non-terminal fall hit is ignored, and a stated mechanism still wins. `RecentHit.victimHp` was
  already queried by the dossier and dropped in the mapping; threading it through is what makes
  the evidence reachable. **Retroactive** — verdicts are computed lazily, never materialized, so
  affected lives, timelines and player pages correct themselves with no migration and no
  rebuild. Two lives in the current corpus are rescued. Already-published obituaries keep their
  frozen `Unknown` tag (`articles.facts` is forward-only).
- web: **a `fall` verdict now actually reaches the screen.** `verdictPhrase` fell back to the raw
  mechanism for any verdict without a `VERDICT_NOUN` entry, which for exactly these deaths is the
  bare `died` → **"Unknown"** — so the timeline death row, the funeral card and the Rap Sheet would
  all have kept saying "Unknown" while the classifier said "fall". Every other stage-2 mechanism
  hid the bug because its verdict and its raw cause agree; a fall is the one death where they
  differ, which is the whole point of the fix above. `verdictPhrase` now prefers a verdict that
  names a mechanism over a raw cause that does not, and still defers to the raw cause otherwise
  (keeping "Drowned"/"Environment" specific).

## [0.26.0] - 2026-07-19

### Added
- Player notifications: a new `apps/notifier` worker sweeps the event history for nine
  notification kinds — gamertag verified, tokens received/granted, ban applied/lifted, life
  qualified, survival milestone, and obituary/birth-notice published — writes them to a new durable
  `notifications` table, and delivers unread ones as browser Web Push (`push_subscriptions` table,
  VAPID-signed, an endpoint retires itself after repeated delivery failures). Generation is gated by
  a forward-only `NOTIFIER_SINCE` cutoff (unset = OFF) and `NOTIFIER_DRY_RUN` (defaults `true`); push
  has its own `NOTIFIER_PUSH_ENABLED` kill switch, independent of generation. New API routes —
  `GET /me/notifications`, `POST /me/notifications/read`, `POST`/`DELETE /me/push-subscriptions`, and
  the public `GET /push/vapid-key` — back a new notifications panel in the web controls rail (unread
  badge, a paginated list with a **Load older** control, and a push opt-in toggle), plus a service
  worker and PWA manifest so push notifications can be received and clicked through to the linked
  page. Expanding the panel marks read **only the rows it actually put on screen**, never the whole
  inbox.
  **`life_qualified` is windowed on the exact qualification instant, derived at read time** by
  calling the existing `lifeQualifiedAt()` (`@onelife/read-models`) per open life, rather than on
  `lives.startedAt` — which could miss a life that qualified long after it started. The notifier
  loads every open life owned by a verified user on a slugged server (a small set — currently-alive
  verified players) with its sessions and kills, and derives qualification in TypeScript. There is
  deliberately **no SQL qualification prefilter**: `lives.playtime_seconds` only advances when a
  session closes, so any stored-playtime filter would be blind to a life crossing the threshold
  mid-session. Qualification therefore remains **derived, never materialized** — one source of truth,
  shared with the survivors board, the enforcer and the newsdesk. **This release deploys normally,
  without `--rebuild`.**

### Changed

### Fixed

> Every entry in this section is a defect found and corrected **inside this same unreleased
> feature**, during review, before any of it reached a player. The notifier, the push stack and
> the notifications panel are all new above — no released version of One Life ever exhibited
> these behaviours, and nobody needs to check whether they were affected. They are recorded
> because the reasoning is worth keeping, not because anything users had was broken.

- **Ban notifications windowed on columns that don't record the events they stand for.**
  `ban_applied` looked at `bans.banned_at`, which is the *death* time, not when the ban was placed —
  if ingest or the projector fall behind by more than `NOTIFIER_LOOKBACK_HOURS`, `banned_at` is
  already outside the window by the time the ban row lands and the player is never told they were
  banned. It now windows on `bans.created_at`, the moment the row was written. `ban_lifted` looked
  at `bans.expires_at`, which is only `banned_at + BAN_DURATION_HOURS`: that both announced "You're
  back in" at go-live for bans resolved *before* `NOTIFIER_SINCE`, and dropped the notification
  entirely when the enforcer marked a ban expired late. It now windows on `bans.lifted_at`. In
  production today only `redeem`'s straight-to-lifted path actually stamps that column: under
  `ENFORCER_DRY_RUN` the apply loop `continue`s before `markApplied`, so no ban reaches
  `status='applied'`, `appliedBans()` is always empty and `markExpired` never runs. `ban_applied`
  deliberately has **no** status/`applied_at` filter, because status tracks *delivery to Nitrado*,
  which is retried — gating on `applied` would delay or drop the notification for a ban the
  platform has already decided on and already started the 24h clock for.
- **Ban notifications fired for bans that were never placed.** Neither ban generator filtered on
  `bans.dry_run`. Under `ENFORCER_DRY_RUN` — which defaults to `true` and is how production runs —
  the enforcer writes the ban row and then `continue`s: nothing reaches Nitrado and the player is
  not banned. They would still have been told "banned for 24 hours, spend an unban token to come
  back early", and that invitation was not idle, because `redeem` selects on
  `status IN ('pending','applied')` with no `dry_run` predicate of its own — spending a token
  against a dry-run ban really does consume it. Both generators now require `dry_run = false`.
  **Consequence, and it is the intended behaviour rather than a regression: while the enforcer runs
  in dry-run, ban notifications do not fire at all**, because nobody is actually being banned. They
  begin firing on their own when `ENFORCER_DRY_RUN=false`. The filter is commented in
  `apps/notifier/src/generators/bans.ts` so it is not later deleted to "restore" them.
- **Opening the notifications panel destroyed unread notifications.** The panel POSTed a blanket
  "mark everything unread as read" while the feed only ever served the newest 20 rows, so any
  backlog deeper than one page was marked read without ever being shown, and was then unreachable —
  the feed endpoint took no parameters at all. `POST /me/notifications/read` now takes an explicit
  `{ ids }` list (capped at 500; empty is a no-op, over-cap is a 400), with the user-ownership
  predicate still in the WHERE clause so naming another user's id updates zero rows; the panel sends
  only the ids it actually rendered. `GET /me/notifications` takes `?page=` in house style.
- **The paginated feed had no client, so the badge could not drain.** Adding `?page=` to the API
  left no caller that sent it: page 1 always returned the newest 20 rows regardless of read state,
  so once those were marked read, older unread sat on page 2 with no call path able to reach them —
  a user with more than 20 unread had a badge pinned at `(total - 20)` for the life of the account.
  The response now carries `total`, the web client reads the feed through an infinite query, and the
  panel grew a **Load older** control that appears while `page * pageSize < total`. The panel also
  stopped tracking "have we marked read yet" as a once-per-mount flag and now tracks the set of ids
  already reported, so a page loaded *after* the panel was expanded is marked read too — with the
  flag, everything the new control revealed would have stayed unread forever. Pressing Load older
  until it disappears now takes any depth of backlog to zero unread, which is asserted end to end
  by a test that seeds a backlog deeper than one page and drives the exact loop the client runs.
- **Two startup paths could crash-loop the notifier.** `NOTIFIER_DRY_RUN` and
  `NOTIFIER_PUSH_ENABLED` used `z.enum(["true","false"])`, whose `.default()` fires only on
  `undefined` — a blank value (the usual way to "unset" a var in an env file), `FALSE`, or a
  trailing space threw out of `loadConfig` at module scope with no try/catch. They now use the house
  idiom from `apps/newsdesk/src/config.ts` (`z.string().optional()` plus `!== "false"`), so
  unparseable input lands on the safe side instead of killing the unit. Separately,
  `webpush.setVapidDetails()` throws *synchronously* on a subject missing its `mailto:` prefix or a
  malformed key, and the sender was built at module top level — a typo'd VAPID subject killed the
  process before the loop started, so generation never ran either, and `deploy.sh`'s post-start
  `systemctl is-active` check failed. A guarded `buildSender()` now falls back to `null` (push off,
  generation continues).
- **Push notifications survived sign-out on a shared browser.** Nothing tore the subscription down,
  so after user A signed out and user B signed in, A's notifications — including obituary headlines
  carrying A's gamertag — kept firing as OS notifications on B's device, and B's "turn off" deleted
  zero rows because the DELETE is scoped to the session user. Sign-out now runs a shared
  `signOutAndTeardownPush()` (`apps/web/src/lib/push.ts`, used by both the desktop rail and the
  mobile sheet, so the two handlers can't drift): it deletes the server row **before** `signOut()`,
  while the session is still valid, and never throws — a failed teardown must not trap anyone in a
  session.
- **The push toggle now reconciles browser state with the server.** It read only
  `Notification.permission` and the browser's `PushSubscription`, both of which are untouched when
  the notifier retires an endpoint after repeated delivery failures or when the account on the
  machine changes — so the rail said "on" in exactly the cases where no push could arrive. New
  `GET /me/push-subscriptions?endpoint=…` reports whether the **session user** has a live
  (non-disabled) row; ownership and `disabled_at` are both WHERE-clause predicates, so another
  user's row reads as inactive rather than leaking. An unreachable server falls back to "off",
  the self-healing direction: turning it back on upserts by endpoint and repairs the row.
- **A failed unsubscribe reported "off" while pushes continued.** `disable()` set the state in a
  `finally`, so a rejected server call skipped `sub.unsubscribe()` and still rendered "off" — the
  one direction that never self-heals, because a user who believes they turned push off will not
  touch the control again. It now sets "off" only on success and otherwise shows an error state
  saying push is still on, with a retry.
- **An unset `VAPID_PUBLIC_KEY` failed silently forever.** It was read straight off `process.env`
  outside the API's validated config, and the `onelife-api` unit has its own `EnvironmentFile`
  (`deploy/README.md`), so this was a live path: the API booted clean, `GET /push/vapid-key` served
  `""`, `subscribe()` threw, the toggle swallowed it, and the notifier reported success because it
  found zero subscriptions. It is now in `apps/api/src/config.ts` and logs a loud startup warning
  when empty — a warning rather than a boot failure, since push is optional and refusing to start
  would take the whole public site down with it.

## [0.25.0] - 2026-07-19

### Added
- R5d PR-C3 — **the News surface.** `/news` is live: a reverse-chron feed and a full interior for
  the `kind='news'` features PR-C2's `newsTick` writes. New read-model
  `packages/read-models/src/news-articles.ts` (`getPublishedNews` / `getNewsArticleBySlug` /
  `getNewsSubjectStatus`), ordered **`created_at DESC`** rather than `death_at` — a Standing Dead
  feature has no death — served by the `articles_kind_status_created_idx` from migration `0014`.
  Public `GET /news` and `GET /news/:slug` are structural twins of the obituaries routes. The web
  surface mirrors `apps/web/src/app/obituaries/`: feed, `[slug]` interior, `loading.tsx`, a dynamic
  OG card, a `NewsArticle` JSON-LD block (through `ldScript()`, since an LLM headline can contain
  `</script>`), and a new `components/news/`.
- **The live status line** (spec §4.1.3). A Standing Dead feature is the only thing the paper
  prints that its subject can falsify by acting, so the interior computes a status line **at
  request time** — still idle ("as of publication, N days without a sighting"), returned
  ("UPDATE: subject was seen again on …"), or died since (with a link to the obituary when the
  morgue has filed). The prose above it is never regenerated. Death outranks return, and the return
  predicate mirrors `findReturnedStandingDead` exactly, so the page and the newsdesk
  de-publication sweep can never tell the reader different stories.
- **Two timelines for a Long Form feature**, one for a Standing Dead. Parallel records converging
  on the same minute are the flagship's visual argument; they stack on mobile and sit side by side
  from `lg` up. Both guard on `mapSlug !== null` and degrade to whatever loaded. A subject whose
  timeline fails to load this way (no `mapSlug`, or the fetch throws) is named only in the article
  prose and the JSON-LD `about` array — the rendered dossier shows a bare subject count, not their
  callsign. Follow-up: render callsigns from `article.subjects` in the dossier or byline,
  independent of timeline availability.
- `ArticleHero` gains an **`ink`** accent alongside `red` and `blue`. Morgue is red, Nursery is
  blue, yellow already means beef; on a feature the photograph carries the page. News is the only
  kind that renders a hero image (obituaries and birth notices lost theirs in v0.21.0).

### Changed
- **The static News teaser is retired**, which removes `robots: { index: false }` from the `/news`
  route. Per the repo's voice-first rule a teaser stays up until its content-engine slice ships;
  this is that moment. News was the last of the three, so the shared `TeaserPage` component (and
  its test) are deleted as dead code.
- **`ArticleBody`'s blocks path is live in production for the first time.** PR-B built it and PR-C2
  became the first writer to populate `articles.body_blocks`, but no shipped interior had ever
  rendered it. The news read-model selects and casts the column, and the interior renders blocks
  when present and the flat `body` when absent — an unknown block type is dropped by the switch's
  `default: return null` rather than crashing the page.

### Fixed
- **Three PR-C1 Fog Rule test rails were vacuous.** `long-form-cluster.test.ts`,
  `long-form-targets.test.ts` and `standing-dead-targets.test.ts` each used `/\d{4}\.\d/` as their
  *sole* coordinate assertion. That regex returns false for a short near-edge coordinate like
  `812.4`, so all three would have passed on a real leak — `long-form-targets.test.ts` most
  seriously, since it guards the `LongFormSubject` boundary spec §11 exists to protect. Each now
  uses the recursive key-presence walk PR-C2 established, with the regex kept only as a documented
  secondary signal. `standing-dead-targets.test.ts` additionally checked only the *top level* of
  each row, so a nested leak was invisible.
- **A retracted feature no longer leaks into any discovery surface.** It is excluded from the feed
  query (and therefore from "More From the Desk", which reads it), its interior is `noindex`ed, its
  hero bytes already 404 behind the media route's `status='published'` filter — so the interior
  renders a retraction banner in place of a broken photo — and there is no sitemap. **The OG unfurl
  card is stamped `RETRACTED` and its JSON-LD carries `creativeWorkStatus: "Retracted"`**: `noindex`
  addresses crawlers and does nothing for a Discord/Slack/X unfurl, which is the first thing a
  reader of a shared link sees, before they click. The URL keeps working: a reader who follows that
  link gets the correction, not a 404. The overprint is confirmed by **code inspection only** — this
  repo has no route or OG-image tests at all (`ImageResponse` needs the Next OG runtime, which is
  unavailable under the test runner), so what's verified is that the file compiles and the route
  appears in the build's route table, not that the overprint renders or is legible. It needs one
  manual check before the news pass is enabled.
- **The interior can no longer print the same pull quote twice.** PR-C2's schema admits a `quote`
  block and a standalone `pullQuote` independently and nothing in the prompt discourages using both,
  so a model putting its best line in each would have shipped two identical stacked blockquotes —
  invisible until now, because no shipped interior had ever rendered `ArticleBody`'s blocks path.
  The standalone quote is suppressed render-side when the blocks already carry one, which also
  repairs rows already written.
- `newsShowingLine` follows the **birth** argument order `(page, total, pageSize)`, pinned by a test
  that fails on a swap. `obituaryShowingLine` is `(page, pageSize, total)` and every parameter is a
  `number`, so the mistake is entirely type-silent.

## [0.24.0] - 2026-07-19

### Added
- R5d PR-C2 — the `newsTick` pass, **shipped disabled**. The fifth `apps/newsdesk` sweep turns the
  PR-C1 Standing Dead and Long Form targets into published `kind='news'` features. Until an
  operator sets **both** `NEWSDESK_NEWS_ENABLED=true` and an ISO `NEWSDESK_NEWS_SINCE` there is
  **no article row, no model call, and no external write**; either unset short-circuits the tick to
  zeros before it touches the database or the model, and `NEWSDESK_DRY_RUN` still gates every write
  on top of that.
  New files: `news-facts.ts` (the frozen `NewsFacts` snapshot for both triggers),
  `news-voice.ts` (the Newsroom register, vendored from the brand bible's three new tone rows —
  The Standing Dead; The Long Form, fresh subjects; The Long Form, any subject geared),
  `news-prompt.ts` (`news-v1`, both trigger arms, the block-union parse), `news-pg-store.ts`
  (slug, publish, failure stub, retraction) and `news-tick.ts`.
- Rich body for news: the model emits `blocks` only and `body` is **derived** post-parse as the
  `para` blocks joined by a blank line, so the OG card and meta description can never quote text
  that is not on the page. Zod validates shape only — it caps block and list counts and imposes no
  minimum length, because length is funded by fact density and a floor is a padding instruction.
- Retraction (spec §4.1.3): a published Standing Dead feature whose subject has a session that
  connected after the article was created moves to `status='retracted'`. The row is never deleted,
  so the prose and its hero image survive rather than cascade away; `findImageTargets` already
  filters `status='published'`, so a retracted feature can never acquire a photo. A **published**
  news row, by contrast, is image-eligible the instant it publishes — enabling
  `NEWSDESK_NEWS_ENABLED` also un-dormants `imageTick` for it — but PR-C3 (the web surface that
  would render a news hero image) has not shipped, so until it does, pair go-live with
  `NEWSDESK_IMAGES_ENABLED=false` or budget ~$0.004/article (`NEWSDESK_IMAGE_QUALITY=low`) for a
  photo nothing displays.
- Ten new environment variables, all documented in `.env.example`: `NEWSDESK_NEWS_ENABLED`,
  `NEWSDESK_NEWS_SINCE`, `NEWSDESK_NEWS_MAX_PER_TICK` (2, applied **per arm** — Standing Dead and
  Long Form each get their own budget, so a tick can publish up to 2x this value; see
  `.env.example` for the go-live arithmetic), `NEWSDESK_NEWS_SUPPRESSED_GAMERTAGS`,
  `NEWSDESK_STANDING_DEAD_HOURS` (72), `NEWSDESK_STANDING_DEAD_MIN_PLAYTIME_SECONDS` (1800),
  `NEWSDESK_STANDING_DEAD_MIN_HITS` (100), `NEWSDESK_LONGFORM_WINDOW_SECONDS` (180),
  `NEWSDESK_LONGFORM_RADIUS_METERS` (100), `NEWSDESK_LONGFORM_MAX_FIX_AGE_SECONDS` (120).
  The spec said seven; the three Long Form knobs are required non-defaulted fields of
  `LongFormTargetOpts` and cannot be hardcoded at the call site without pinning tuning into source.
- Tests for the spec §11 hard rails, asserted on built objects rather than sources: no
  coordinate-shaped key at any depth (over a fixture whose source rows carry a deliberately SHORT
  coordinate a four-digit regex would miss), no emote-shaped key at all, no projection row id,
  playtime-not-wall-clock, gamertags verbatim, and the forbidden real-player framings as a token
  test. Plus the three boundary cases PR-C1 deferred: Long Form cross-server at the SQL layer, the
  inclusive `maxFixAgeSeconds` edge, and the upper `now` bound.

### Changed
- `NEWSROOM_CATEGORIES`' `eligible` predicates now read through a typed accessor over a published
  `NewsImageFacts` type instead of bare keys on an untyped `Record`. A rename on either side is now
  a compile error; previously a drift between what the facts builder wrote and what a gate read
  failed **closed and silent** — the gate simply never fired and the imagery was quietly
  impoverished, with no error anywhere.
- `apps/newsdesk/src/config.ts`'s `parseBirthSince` becomes the shared `parseSince`, so the birth
  and news cutoffs cannot drift in parsing behaviour.

### Deprecated
### Removed
- The "last expressive emote" slot of spec §4.1.4 is cut before it shipped. The allowlist covers
  roughly 49 events corpus-wide, so it carries no signal, and reaching it means querying
  `events.payload` — the same column holding the 5,633 coordinate rows the Fog Rule exists to keep
  off this boundary. `NewsFacts` has no emote field, which is now asserted structurally.

### Fixed
- The news anti-join in `standing-dead-targets.ts` and `long-form-targets.ts` now blocks on
  `status IN ('published','retracted')`, not `status = 'published'`. A retracted Standing Dead
  article keeps its natural key and its subject keeps satisfying the idle predicate, so the
  narrower predicate would have regenerated the identical feature — a paid model call — on every
  tick, only for the retraction sweep at the end of that same tick to take it down again. Spec
  §4.1.3 requires that the prose is never regenerated; retraction durability comes from this
  predicate, not from the row continuing to exist.
- `packages/db/src/schema.ts`'s `kind` column comment said `'obituary' | 'birth_notice'`; it has
  admitted `'news'` since migration `0014`. Its `status` comment likewise said `published|failed`
  and now admits `retracted`.

### Security

## [0.23.0] - 2026-07-19


### Added
- R5d news engine, **inert**: the two news trigger read-models and the article-image prerequisites,
  with no caller and no production effect. `apps/newsdesk/src/standing-dead-targets.ts` finds
  qualified open lives whose player has gone quiet for 72h and has *earned* coverage (a prior life
  or >= 100 absorbed hits); `apps/newsdesk/src/long-form-targets.ts` +
  `long-form-cluster.ts` find cliques of qualified deaths inside a shared time window and radius,
  with four named exclusions (self-cluster, any suicide subject, unqualified subject, suppressed
  gamertag) and per-reason skip counts. Both key their targets on a rebuild-stable `natural_key`
  built only by `toISOString()` — never a projection row id, and never rendered in SQL — and
  anti-join against `articles` in TypeScript so the written key and the anti-joined key are the
  same string by construction. Neither carries coordinates off the boundary (spec §11); a
  `news-targets.ts` barrel is the single import surface for the worker pass that follows.
- `NEWSROOM_CATEGORIES` — a 13-entry image-framing menu for the news vertical, weighted to absence
  and vacancy because a Standing Dead subject is alive and non-consenting.
### Changed
- `ArticleKind` widens to three members (`obituary | birth_notice | news`), and the two binary
  ternaries that keyed off it — `eligibleCategories`' menu choice and `buildScenePrompt`'s kind
  label — become `Record` lookups with explicit runtime guards. The old ternaries handed *every*
  non-obituary kind the Nursery menu and the "birth notice" label. `ImageTarget["kind"]` is retyped
  to `ArticleKind`, so `findImageTargets`' `r.kind as ImageTarget["kind"]` cast stops contradicting
  the query it sits under. `buildScenePrompt` also gains a news tone arm, an explicit
  alive-subject rail, and a dedicated line when the stated death cause is low confidence.
  **No production behaviour changes:** `findImageTargets` still excludes both shipped kinds and no
  `kind='news'` row exists, so every one of these paths is unreachable until the news worker pass
  lands. Normal deploy, no `--rebuild`, no migration.

## [0.22.0] - 2026-07-19


### Added
- Migration `0014`: `articles.natural_key` (text, unique WHERE NOT NULL) and `articles.body_blocks`
  (jsonb) — the plumbing for the R5d news vertical, whose articles are keyed by a synthetic natural
  key rather than a (server, gamertag, life) tuple and whose body is structured blocks rather than
  flat text. Also adds the `articles_kind_status_created_idx (kind, status, created_at)` feed index.
  Both new columns are nullable; all 168 existing rows are untouched and render unchanged. **Normal
  deploy, no `--rebuild`** — `articles` isn't in the projector's truncate list and has no FK to
  `players`/`lives`, so a projection rebuild can't reach it. During the deploy window itself, expect
  a harmless transient: `deploy.sh` migrates before restarting the fleet, so the still-running old
  newsdesk binary can raise Postgres `42P10` on a tick between the migration and its restart. This is
  expected, not a regression — publish targets are re-derived by anti-join every sweep, so nothing is
  queued or lost, and the tick after `onelife-newsdesk` restarts publishes normally.
### Changed
- Migration `0014` makes `articles_kind_server_gamertag_life_uniq` **partial**
  (`WHERE kind IN ('obituary','birth_notice')`), so a news article — which has no life tuple — is
  not forced through the life natural key. Every `onConflictDoUpdate` targeting that index now
  passes a matching `targetWhere`; without it Postgres raises "no unique or exclusion constraint
  matching the ON CONFLICT specification" and publishing fails.
- Obituary and birth-notice interiors now render their body through one shared `ArticleBody`
  component, which takes an optional structured block list (`para` / `subhead` / `quote` / `list`)
  and falls back to the existing paragraph-split of `articles.body` when none is stored. An
  unrecognised block type is dropped rather than crashing the page. The two article read-models
  now serve `body_blocks` end to end, but **no article kind writes it yet** — every published
  obituary and birth notice still renders the flat fallback, byte-identically to before.
- The `THE TRAIL ENDS HERE` image category now fires on every map for an unnamed cause (previously
  only on Sakhal for these deaths), a consequence of the `environment` → `unknown` reclassification.
### Fixed
- newsdesk: a death whose cause names no mechanism (a bare `died`, `environment`, `environmental`,
  an empty token, or nothing at all) is now categorised `unknown` and tagged **Unknown**, not
  **Environment**. The prose already said the record names no cause while the tag asserted terrain
  or exposure — the paper contradicted itself on roughly 23% of deaths. A cause that names a real
  mechanism (`bled_out`, `starvation`, `fall`, `wolf`, `vehicle`, …) still categorises
  `environment`. Tags are frozen into `articles.tags` at publish time, so this is **forward-only**:
  already-published obituaries keep their stale **Environment** tag until backfilled.
- newsdesk: the `RECOVERED EFFECTS` image category now also fires for an `unknown` cause (it
  previously gated on `environment || suicide` only), so the reclassified population does not
  silently lose a menu entry.

## [0.21.2] - 2026-07-18

### Fixed
- newsdesk: suicides get their own cause category (`Self-Inflicted`), with a spawn-reroll vs. real-run tone split.
- newsdesk: obituaries now receive the player's global priors, so an 11th life is no longer headlined as a debut.
- newsdesk: an unrecorded cause of death reads as an explicit unknown; the model is forbidden from inventing a mechanism.
- newsdesk: both desks are shown their recently published prose and forbidden from reusing an attribution, with a deterministic backstop that drops a repeated one.
- newsdesk: `articles.facts` is frozen forward-only, so these fixes protect future obituaries and birth notices only — the 45 already-published obituaries keep their errors.

## [0.21.1] - 2026-07-18

### Changed
- Home page: the "Fresh from the morgue" and "Just washed ashore" blocks now sit side by side in a
  two-column grid from `lg` up (with a hairline rule between them) instead of stacking vertically.
  They still stack below `lg`, where a half-width column would crowd the uppercase display headlines.

## [0.21.0] - 2026-07-18

### Changed
- Obituaries and birth notices no longer carry an AI hero image — the R5c image pass is gated off for
  those two kinds (`findImageTargets` excludes them) and image generation is now reserved for future
  news/editorial content. The image infrastructure (article_images table, /media/heroes route,
  next/image, ArticleHero, the newsdesk image pipeline) is retained.
### Removed
- Image display on every obituary/fresh-spawns surface (article hero, feed/home thumbnails, OG photo
  panel, JSON-LD image) and the `imageUrl`/`imageCaption` fields from the obituary/birth-notice
  read-models and API responses.
### Fixed
- Migration `0013` deletes the previously-generated obituary/birth-notice images and clears their
  `image_*` fields, reclaiming ~298 MB (run `VACUUM FULL article_images;` post-deploy to return the
  space to the OS).

## [0.20.0] - 2026-07-18

### Added
- Death-cause fidelity: DayZ base-game vehicles are now a first-class `vehicle` death cause. The
  `backfill-death-causes` survey surfaced `CivilianSedan` (Olga) as an unmapped killer, so the
  adm-parser entity dict now maps all base vehicle classes and their color variants to `vehicle`
  (previously `environment`): CivilianSedan (Olga), Hatchback_02 (Gunter), Sedan_02 (Sarka),
  Offroad_02 (Humvee), OffroadHatchback (Ada), Truck_01_Covered (M3S), Boat_01. The `vehicle` token,
  its "Vehicle" label, the `classifyDeath` passthrough, the obituary prose phrase, and the
  `driver-not-pictured` image gate were already wired — this is a dict + test change. `explosion`
  stays reserved. Deploy requires a `backfill-death-causes` re-run + projection rebuild (upgrade-only,
  idempotent) for historical vehicle deaths to reclassify.

## [0.19.0] - 2026-07-18

### Added
- Death-cause fidelity, stage 2 — richer parser vocabulary + backfill:
  - The parser names non-player killers: `wolf` / `bear` / `animal` (other `Animal_*`) /
    `infected` (`Zmb*`) / `fall` (`FallDamage`) become first-class death causes (previously all
    `environment`); the raw entity rides event payloads as `deathEntity`. `vehicle`/`explosion`
    are reserved tokens pending the prod entity survey.
  - `backfill-death-causes` (apps/projector): re-derives historical causes from `raw_lines`
    (upgrade-only — stored `pvp`/`suicide`/`bled_out`/`drowned` never rewritten; idempotent) and
    prints the unmapped-entity survey that grows the dict. Run it + a projection rebuild after
    deploy (see CLAUDE.md runbook).
  - `classifyDeath` passes the new tokens through as stated mechanisms; priors' "usual end"
    aggregates over cause families (wolf + bear count together as "animal").
  - The three dormant Morgue image gates (`suspect-at-large`, `gravity-undefeated`,
    `driver-not-pictured`) light up on the new tokens with zero gate changes.
  - Labels: `causeLabel("fall")` → "Fell"; a bare `died` mechanism now labels "Unknown"
    (fixes "Died — Died"); obituary prompts describe named killers qualitatively.

## [0.18.0] - 2026-07-18

### Added
- Death-cause fidelity, stage 1 — the interpretation layer (ported from the archived platform):
  - `classifyDeath` mechanism-first verdict ladder in `@onelife/domain` (starvation / dehydration /
    mauled / bled_out with high|low confidence and conditions; side-effect subtraction).
  - `life-dossier` read-model: ordeals (infected/fire/pvp encounters, HP low, builds) + the 120 s
    recent-hits window; `getLifeTimeline` and `getPlayerPage` (visible slice) now carry the verdict.
  - Obituary prompt describes the death qualitatively (hedged when confidence is low) and gains
    ordeal color + the fatal-shot distance; verdict + ordeals freeze into `articles.facts`
    (prompt version `obituary-v2`).
  - The `suspect-at-large` Morgue image category fires on a mauled verdict.
  - Web: shared `causeLabel`/`verdictPhrase`; timeline death row, funeral cards, Rap Sheet, and the
    obituary OG card render the classified verdict. Non-PvP death labels on the timeline death row
    and funeral cards are now title-cased via the shared `causeLabel` (previously raw lowercase
    tokens).

## [0.17.0] - 2026-07-18

### Added
- R5c — Article Images: every published obituary and birth notice gets an AI-generated tabloid
  photo (brand-bible §10.4 style) via a fourth newsdesk pass — category menu + LLM escape hatch +
  recency exclusion, OpenRouter image API (workhorse `openai/gpt-5-image-mini`, flagship for
  legends), bytes stored in Postgres (`article_images`, migration `0012`), served at
  `GET /media/heroes/:file`, rendered as interior hero + feed/home thumbnails + OG photo panel +
  JSON-LD image. Dry-run gated; `NEWSDESK_IMAGES_ENABLED` kill switch.

## [0.16.0] - 2026-07-18

### Added
- Discord obituary notifier — `apps/newsdesk` posts a plain link to every published obituary into a
  Discord channel via an incoming webhook (Discord unfurls the page's OpenGraph card). Delivery is
  tracked and retried via a new nullable `articles.discord_posted_at` column + partial index
  (migration `0011`): a sweep runs each loop iteration (its own try/catch), reads
  published-but-unposted obituaries oldest-death-first, posts each link, and stamps the row on
  success — so a transient Discord/DB outage, a worker restart, or the dry-run→live switch never
  drops an obituary, and the back-catalogue drains on first live run. Gated by
  `DISCORD_OBITUARY_WEBHOOK_URL` (empty = disabled no-op) and the existing `NEWSDESK_DRY_RUN`
  (dry-run logs the intended post, does not send); per-tick cap `NEWSDESK_DISCORD_MAX_PER_TICK`
  (default 10). Additive migration — a normal deploy, no `--rebuild`.
### Changed
### Deprecated
### Removed
### Fixed
- Documented `NEWSDESK_BIRTH_SINCE` in `.env.example` and `deploy/README.md` — the forward-only
  birth-notice cutoff shipped in 0.15.0 (R5b) but was omitted from the env template and deploy docs.
### Security

## [0.15.0] - 2026-07-17

### Added
- Tabloid redesign R5b — Birth Notices / Fresh Spawns. The newsdesk worker gains a second pass that
  writes an in-voice **Birth Notice** ("The Nursery") for every qualified life going forward, behind
  the shared dry-run gate and a **forward-only** `NEWSDESK_BIRTH_SINCE` cutoff (unset ⇒ birth pass
  off). Reuses the durable `articles` table with a new `kind='birth_notice'` (migration `0010`:
  `death_at` nullable + a born-order index). The story material is the player's **global cross-life
  priors** (`getPlayerPriors`), not the thin current life. The `/fresh-spawns` teaser is retired for a
  real feed + slim interior at `/fresh-spawns/[slug]` (one paragraph + pull quote + "The Priors" box +
  a "still drawing breath" status line), a `NewsArticle` JSON-LD block, and a dynamic OG image. New
  public `GET /birth-notices` + `GET /birth-notices/:slug`. The home page gains two content blocks —
  Latest Obituaries and Latest Fresh Spawns. Facts come from read-models only; the LLM writes voice
  (Fog Rule: map dateline, never coordinates — the subject is still alive).
### Changed
### Deprecated
### Removed
### Fixed
### Security

## [0.14.1] - 2026-07-17

### Fixed
- `deploy/deploy.sh` now restarts `onelife-newsdesk` on every deploy — it was missing from the
  `SERVICES` fleet array, so after a release the obituary worker kept running stale code until a
  manual `systemctl restart`. Also added the newsdesk env keys (`OPENROUTER_API_KEY`,
  `NEWSDESK_MODEL`, `NEWSDESK_DRY_RUN`, safe-default dry-run) to `.env.example`.

## [0.14.0] - 2026-07-17

### Added
- Tabloid redesign R5a — the newsdesk + Obituaries. A new `articles` table + `apps/newsdesk`
  sweep worker turn every qualified death into an obituary written in the One Life tabloid voice
  via OpenRouter, behind a dry-run gate (`NEWSDESK_DRY_RUN` defaults `true`). The Obituaries
  section goes live (retiring the static teaser): a reverse-chron `/obituaries` feed and a full
  interior article at `/obituaries/[slug]` — headline, byline, lede/body, an in-voice pull quote,
  a factual Rap Sheet, the R4-powered "Final Reload" timeline, tags, "More From the Morgue," a
  `NewsArticle` JSON-LD block, and a dynamic OG image. Facts (Rap Sheet, Final Reload) are read
  models only — the LLM writes voice, never invents events (Fog Rule: map dateline, never
  coordinates). Backed by `getPublishedObituaries`/`getObituaryBySlug` and public `GET /obituaries`
  (now published articles) + `GET /obituaries/:slug`.
### Changed
### Deprecated
### Removed
### Fixed
### Security
- JSON-LD script tags now serialize through a shared `ldScript()` helper that escapes `<`/`>`/`&`,
  so LLM-authored obituary text (or any field) can't break out of `<script type="application/ld+json">`.
  Applied to all three sinks (obituary article, player profile, survivors board).

## [0.13.0] - 2026-07-17

### Added
- Controls rail: the **Send to verified player** and **Referred by** token fields now autocomplete
  over verified players, excluding the signed-in user. Backed by a new `searchVerifiedGamertags`
  read-model and a public `GET /players/search/verified` route (the verified mirror of the claim
  field's `/players/search`). The claim field and both token fields now share one
  `<GamertagAutocomplete>` component (debounce, race guard, skip-after-pick, overlay dropdown);
  self-exclusion is client-side and case-insensitive.

## [0.12.1] - 2026-07-17

### Fixed
- Controls rail: **Cancel claim** now works. The web API client (`apiSend`) sent
  `content-type: application/json` on every request, so a bodyless `DELETE` (cancelling a
  pending gamertag claim) was rejected by Fastify with `400 FST_ERR_CTP_EMPTY_JSON_BODY`
  ("Body cannot be empty…"). The header is now attached only when a body is present.
- Controls rail: signed-in users can now **sign out from any state**. The Sign out control
  previously rendered only in the verified state, leaving a signed-in but unlinked or pending
  user (e.g. mid-claim) with no way to log out. It now shows in every signed-in state on both
  the desktop rail and the mobile sheet (the profile link still appears only when verified).
- Signed-out visitors on mobile get a floating **Sign in** box (the mobile counterpart of the
  rail's sign-in CTA), so logging in no longer means scrolling to the page footer.
- Repo hygiene: stopped tracking `.DS_Store` and added it (plus `**/.DS_Store`) to `.gitignore`.
### Security

## [0.12.0] - 2026-07-17

### Added
- Tabloid redesign R4 — life timeline + obituary/birth groundwork. A public per-life page at
  `/players/[slug]/[map]/lives/[n]` (canvas 14a): a character-portrait hero with a factual
  `Life {n} · {Map}` headline and a Time-alive/Kills/Longest-kill/Sessions/Qualified stat band,
  and a newest-first event timeline (birth → life qualified → sessions, with quiet runs grouped
  into "Sessions N–M" → kills with a "Longest kill" chip → death, or a live "Still drawing
  breath" row). Captions are deterministic and factual (editorial prose is R5); death rows carry
  the vitals at death (energy/water/bleed) — the per-life kill/vitals detail R2 dropped from
  funeral cards now lives here. While a life is still alive a "Positions withheld" notice
  renders (voice-only — no coordinates are stored or shown). Standing cards and funeral cards
  gain `TIMELINE →` links (via a pure `lifeHref`). Backed by a `getLifeTimeline` read-model and
  the extended `GET /players/:gamertag/:map/lives/:n` route (now returns kills + qualification
  timing + display fields). R5 groundwork behind the still-static teasers: `getObituaries`
  (recent qualified deaths) and `getFreshSpawns` (recent qualified births) read-models sharing a
  `qualifiedLifeCondition` predicate, exposed at public `GET /obituaries` and `GET /fresh-spawns`.
### Changed
- Tabloid redesign R1 — "Clean Glossy" design system (Paper/Ink/Red tokens, Oswald + IBM Plex
  Mono), new dark masthead with the 5-section nav + mobile menu, dark mono footer, front-page
  shell (manifesto hero, top survivors, sign-in CTA), About page, in-voice teaser pages for
  News/Obituaries/Fresh Spawns, restyled status banner, brand favicon kit, and the player OG
  card on the brand palette. Legacy color tokens remap to the new palette as compat shims
  (removed in R3).
- Tabloid redesign R2 — boards restyle. Survivors board per canvas 13a: tiered rows by global
  rank (rank 1 hero row on tint with 76px portrait + stat label, ranks 2–3 podium with 60px
  portraits, 4+ compact text rows), skewed map chips + mono sort links, mono-box pagination
  with a clamped "Showing x–y of N still breathing" line, quiet-coast empty state; the visible
  h1 becomes "Survivors"/"{Map} survivors" (the SEO phrase stays in `<title>`/OG metadata).
  Player dossier per 13b: avatar-free hero with first-seen over-line, blue "Alive ×N" skew
  badge, red Verified stamp, stat band with **Deaths as the red stat** (OG card inherits);
  2-col state-colored standing cards (blue Alive / red Banned with 4px red left border,
  kills-this-life list, ban-lifts box, "Spend 1 token — skip the wait" self-unban CTA);
  past lives become compact archive "funeral cards" (counts only — kill lists/vitals return
  with the R4 life timeline). Route-level loading skeletons for all board + dossier pages;
  board a11y (decorative square portraits with lazy-loading hygiene, non-focusable disabled
  pagination edges, aria-hidden glyphs); site basics: skip-to-content link, global red
  `:focus-visible` ring, and a `red-deep` token for small-size error text.
- Tabloid redesign R3 — controls rail. A single account surface driven by one
  `accountStatus`-based data layer (`useControls`/`useControlsActions`): a persistent desktop
  **controls rail** (root-layout `xl:` two-column grid — main column + 380px rail) and a mobile
  floating **pill + bottom sheet** (canvas 10a–d), each reflecting the viewer's state —
  signed-out sign-in CTA, unlinked in-rail gamertag link (autocomplete), pending in-rail emote
  "prove it's you" challenge, verified identity + unban-token wallet + per-server standing cards
  (alive/no-life/banned with live ban countdown + self-unban CTA). The mobile menu and sheet
  share a `useModalBehavior` hook (focus trap, Escape, scroll lock, focus restore). Login page
  restyled into the tabloid language. Token **transfer and referrer** now resolve a verified
  **gamertag** (case-insensitive) instead of a raw user id.
### Deprecated
### Removed
- Retired the standalone account surface — `/account` and `/account/claim` pages, the
  site-wide status banner, and the masthead account slot — replaced by the R3 controls rail /
  pill. Deleted the last legacy design-token aliases (`--bg/--panel/--line/--amber/--blood/…`)
  and the `font-hand` shim now that nothing consumes them, and renamed the `tint` surface token
  to `bone`. Removed the legacy `ui/` primitives (Button/Input/Table).
### Fixed
- Consolidated R1/R2 carried-forward duplication: one shared pagination-box style, one
  `CharacterImage` (with `characterSrc`) behind both the survivor portrait and player avatar,
  one shared dossier `Stat`, a discriminated `SkewCta` href|onClick union, and richer loading
  skeletons; plus `activeNavKey` exact-segment matching and singular/plural count copy.
### Security

## [0.11.1] - 2026-07-16

### Fixed
- **Livonia (and any new map) is handled beyond the original Chernarus/Sakhal set.** Player pages now
  label the `enoch` map codename as "Livonia" (`mapLabel`) instead of the title-cased fallback
  "Enoch", and the `GET /players/:gamertag/:map/lives/:n` life-detail route no longer validates its
  server-slug segment against a hardcoded `["chernarus","sakhal"]` allow-list (which 400'd every
  Livonia request) — it now resolves the slug against the `servers` roster, returning `404` for a
  genuinely unknown slug. Adding a server stays a pure DB insert, no route edits.

## [0.11.0] - 2026-07-15

### Changed
- **Player page redesign.** Rebuilt `/players/{slug}` as a single roomy column with everything visible (no expand/collapse): an avatar-free hero with a full-width stat band (Kills shown only when > 0, Longest life always the highlighted stat), state-colored current-standing cards (green alive / red banned), and muted archive cards for past lives — now **paginated** (`?page=`, 10/page, server-side, enriching only the visible slice). The OpenGraph share image is redesigned as a survivor dossier (logo + logo-skull motif, callsign, "surviving since," all-time stats, on Oswald/Space Mono).

## [0.10.0] - 2026-07-15

### Added
- **Player pages (`/players/{slug}`).** Public, SEO-optimized survivor profile — a cross-server totals
  hero, per-server current standing (alive / banned / idle) with a live ban countdown, expandable
  past-life history (kill lists, vitals, sessions), a dynamic OpenGraph share image, and
  `ProfilePage` JSON-LD. Verified owners get a self-unban control that spends a token to lift their
  own ban (owner + verified-only, four states: hidden/ready/no-tokens/pending). Backed by a new
  `getPlayerPage` read-model and an extended `GET /players/:gamertag` route.

### Changed
- **Gamertags link to player pages site-wide, and verified users land on theirs after login.** The
  survivor board, kill lists, and death-by attributions now route every gamertag through a shared
  `GamertagLink` to `/players/{slug}`. A new `/welcome` post-login resolver sends a verified user
  straight to their player page (pending → account page, unlinked → claim flow), and the masthead's
  gamertag chip now points there too.

## [0.9.1] - 2026-07-15

### Changed
- **Survivors leaderboard control ordering.** Map tabs are now sorted alphabetically by label (with **All maps** always first), and the sort pills are ordered **Time alive → Kills → Longest kill** (matching the new time-alive default).

## [0.9.0] - 2026-07-15

### Changed
- **Survivors leaderboard: path-based sort, time-alive default, SEO H1, one-stat rows.** Sort now lives in the URL **path** instead of a `?sort=` query string — `/survivors/kills`, `/survivors/sakhal`, `/survivors/sakhal/kills` (page stays `?page=`), served by a new `/survivors/[map]/[sort]` route and a pure `resolveSurvivorsRoute` resolver (a depth-1 segment resolves as a reserved **sort word** → combined board, or a **server slug** → that map; the three sort words `kills`/`time`/`longest` are reserved and cannot be server slugs). The **default sort is now time-alive descending** (web + API `GET /survivors`); old `?sort=` links are ignored (render the default), and an explicit-default path (`/survivors/time`) 307-redirects to the bare path (preserving `?page`). Each board page gets an SEO-friendly `<h1>` — `Top {Map} survivors by {sort}` (combined drops the map name). Rows now show **only the stat being sorted by** (the other two are hidden), the character avatar is enlarged (40px → 80px), and the "Longest" label reads "Longest kill". Tie-breaking is **sort-aware**: time → time/kills/longest, kills → kills/time/longest, longest → longest/time/kills, with gamertag as the final deterministic tiebreak (NaN-safe comparator).

## [0.8.1] - 2026-07-15

### Fixed
- **Character avatars now come only from the game's authoritative `create_entity` signal.** Dropped the unreliable `head_asset` class source — head-warning log lines carry no player identity and mis-attributed characters across players (even cross-gender), surfacing phantoms like "Adam" (a head-model name, not a real persona) and mislabeling real personas (e.g. a Mirek). The RPT parser now uses `create_entity` only; the survivor roster resolves real `Survivor[MF]_<Name>` persona classes (adds the previously-missing **Mirek**, removes the phantom **Adam**), and an undetermined/unknown character shows a neutral silhouette. Migration `0008` rebuilds the `characters` rollup from `create_entity`-only sightings.

## [0.8.0] - 2026-07-15

### Added
- **Survivors leaderboard (`/survivors`).** Public, mobile-first live leaderboard of currently-alive survivors, one row per (player × map), ranked by kills / time alive / longest kill (this life). Server-rendered map routes (`/survivors`, `/survivors/:map`) with query-param sort + pagination and per-page SEO/OG metadata. New `getAliveSurvivors` read-model + public `GET /survivors[/:slug]` API.
- **Scheduled server reboots (`apps/rebooter`).** A new always-on worker restarts every **active** server in the `servers` table on the top of each even UTC hour (00:00, 02:00, …, 22:00), best-effort per server (one server's failure is logged and does not abort the rest). Reboots go **live on deploy** — there is no dry-run gate, since a scheduled restart is routine and reversible (unlike the enforcer's bans). Adds `NitradoClient.restartServer()` (POST `/services/{id}/gameservers/restart`), a pure `msUntilNextBoundary()` scheduler that re-aligns to the wall clock each cycle (no interval drift, no double-fire), and registers `rebooter` in the deploy fleet (`deploy/deploy.sh` + README). Requires `NITRADO_TOKEN` set and a `onelife-rebooter` systemd unit on the host.

## [0.7.0] - 2026-07-14

### Added
- **Survivor character headshot assets.** Added the 31 default DayZ survivor portraits (Baty…Taiki) as WebP under `apps/web/public/characters/<name>.webp`, served by Next.js at `/characters/<name>.webp`. Sourced from the DayZ Fandom wiki (CC BY-SA); intended for an upcoming per-life character-head display keyed off the SP5 character mapping (`getLifeCharacter`).

### Changed
- **Persistent onboarding/status banner drives account state site-wide.** A banner under the masthead now reflects the viewer's onboarding state on every page and carries the single next action, and the masthead's amber CTA collapses to match. One pure `accountStatus()` derivation (`signedOut | unlinked | pending | verified | loading`) is the single source of truth for both surfaces. **Signed out** → banner *"Sign in to claim your gamertag"* (→ `/login`), no masthead CTA. **Signed in, no active link** → banner *"Link your gamertag to get started"* (→ `/account/claim`) + a quiet **Account** link in the masthead. **Pending** → a self-contained verification banner showing the emote sequence with live progress (`n / total DONE`), an expiry countdown, **Cancel claim**, and a **Start a new challenge** re-claim when the challenge expires — plus the quiet **Account** link. **Verified** → no banner; the masthead shows the amber **{GAMERTAG}** CTA → `/account`. No backend change: the existing `GET /me/gamertag-links` list already serializes the challenge, so `useGamertagLinks` just adds a 5s `refetchInterval` while a link is pending (progress ticks live, flips to verified on completion, and never polls signed-out visitors). `StatusBanner`/`MastheadSlot` are presentational (unit-tested by props); `useAccountStatus`/`StatusBannerContainer` wire the hooks. Decorative banner glyphs are `aria-hidden`.

## [0.6.0] - 2026-07-14

### Changed
- **Masthead account button is now a stateful CTA.** The top-bar's right-hand link is a single amber primary button that reflects the viewer's auth + gamertag-link state instead of a static "Account" link: signed-out shows **Sign in** → `/login`; signed-in with no active link shows **Link gamertag** → `/account/claim`; a `pending` link shows **{GAMERTAG} (not verified)** → `/account`; a `verified` link shows **{GAMERTAG}** → `/account`. To power this, `QueryProvider` moved from the `/account` layout up to the root layout (one shared TanStack Query cache app-wide), the `Masthead` became a client component reusing the existing `useSession`/`useGamertagLinks`/`activeLink` read models, and `useGamertagLinks(enabled)` now gates its fetch so logged-out visitors don't hit `/api/me/gamertag-links` (401) on every page.

## [0.5.0] - 2026-07-14

### Added
- **One gamertag per user.** A user can now hold at most one *active* gamertag link (one `pending` or `verified` claim at a time). Enforced in depth: a partial unique index `gamertag_links_user_active_uniq` on `(user_id) WHERE status IN ('pending','verified')` (migration `0007`), an API guard in `POST /me/gamertag-links` that returns `409 { error: "active_link_exists", current: { gamertag, status } }`, and a web claim UI that hides the claim form / shows the existing link when one is active. Cancelling a `pending` link frees the slot; a `verified` link is permanent (admin-only release via manual DB edit).

## [0.4.0] - 2026-07-14

### Added
- **Login page shows only configured sign-in methods.** The web login page now hides social providers that aren't wired up and the email/magic-link form when it's disabled, instead of always rendering all of them. A provider appears only when both its `<P>_CLIENT_ID` and `<P>_CLIENT_SECRET` are set (unchanged backend rule); email is controlled by a new `MAGIC_LINK_ENABLED` flag (default `true`). The backend is the single source of truth: `@onelife/auth` exposes `enabledAuthMethods(cfg)`, served at a new public `GET /api/auth/providers` (a static route that wins over the Better Auth `/api/auth/*` catch-all and returns only method names — no secrets). The login page is now a server component that fetches this before render; if the API is unreachable it shows an explicit "temporarily unavailable" state rather than guessing.

## [0.3.1] - 2026-07-14

### Added
- **`deploy/deploy.sh` — one-command production deploy.** Checks out the latest semver release tag, installs + builds web, stops the systemd fleet, takes a full-DB `pg_dump` checkpoint, applies migrations, restarts, and health-checks (all services active + web 200 + api reachable). Rolls back the code on pre-migrate failure; after a successful migrate it keeps the new code up and points at the checkpoint (Postgres migrations are forward-only). A `--rebuild` flag adds the gated projection truncate + re-fold (using `pnpm … run rebuild`) and waits for the projector to catch up — for releases that change projection-table shape.

### Fixed
- UP1 deploy runbook: corrected the projection-rebuild command to `pnpm --filter @onelife/projector run rebuild` (bare `pnpm … rebuild` invokes pnpm's native-module builtin and silently skips the truncate, which then aborts `db:migrate` on the `players_gamertag_uniq` duplicate check).

## [0.3.0] - 2026-07-14

### Added
- **Universal Player — global identity + global gamertag claim.** A player is now a single global identity keyed by gamertag (one row per gamertag across all servers) while **lives stay per-server**, matching DayZ Xbox where a gamertag uniquely identifies one person. **UP1** rebuilds the `players` projection globally (migration `0005` drops `players.server_id`/`current_life_id`, unique on `gamertag`); the fold, projection stores, and read-models resolve players by gamertag and scope stats per-server via `lives.server_id`; projections are regenerated from the immutable `events` log (truncate + replay). **UP2** makes the gamertag claim server-agnostic (migration `0006`: `gamertag_links` drops `server_id`, unique `(user_id, gamertag)` + verified-unique `(gamertag)`) — a gamertag is verified once, by one user, across all servers, and the emote sequence can be completed on **any** server. The claim UI replaces the server dropdown with a debounced gamertag **autocomplete over unverified observed players**, backed by a new `searchClaimableGamertags` read-model and `GET /players/search?q=` route.

### Changed
- **Unban redeem is now global.** `@onelife/tokens` `redeem` establishes ban ownership by the user's verified **gamertag alone** (bans remain per-server), so a globally-verified gamertag can lift its 24h death-ban on any server it was banned on.
- **`POST /me/gamertag-links` no longer accepts `serverId`** — the claim body is `{ gamertag }` only, and the verifier matches links by gamertag across servers.

### Removed
- **BREAKING (schema):** dropped `players.server_id` + `players.current_life_id` (migration `0005`) and `gamertag_links.server_id` (migration `0006`). Deploy requires the gated projection rebuild **and** the durable-table (`gamertag_links`) duplicate precheck in the UP1 deploy runbook (`docs/superpowers/plans/2026-07-14-up1-global-player.md`) — `0005`/`0006` are separate transactions, so pre-existing per-server duplicates must be resolved before `db:migrate`.

## [0.2.0] - 2026-07-14

### Added
- **DB-driven multi-server ingest.** The `ingest-worker` now ingests every `servers` row with `active = true` (new `ingestSweep` in `apps/ingest-worker/src/sweep.ts`) instead of a single env-pinned server. Single shared `NITRADO_TOKEN` (single tenant), one cached Nitrado client per service id, per-server error isolation (one server's Nitrado failure no longer aborts the sweep), and RPT sightings summed across servers. Adding/removing a server is now a pure data change (`active` flag) — no redeploy. No migration (relies on existing `servers.nitrado_service_id` / `active`). Added a `deploy/README.md` production runbook.

### Removed
- **BREAKING:** `ingest-worker` no longer reads the `NITRADO_SERVICE_ID` env var. Register servers by inserting their `nitrado_service_id` into the `servers` table (`active = true`); `.env.example` updated accordingly.

### Fixed
- Web: signing out now navigates home so the UI immediately reflects the logged-out state — previously the session cleared server-side but the account page stayed visually logged in.
- Auth: Discord sign-in forces `prompt=consent`, so it no longer silently authorizes with whatever Discord account is already active in the browser (Better Auth defaults Discord to `prompt=none`, which caused wrong-account logins).

## [0.1.0] - 2026-07-14

### Added
- **SP5 — RPT ingest + character mapping.** Attaches the actual in-game survivor (`SurvivorF_Helga` → "Helga") to each life (item 5). New pure `@onelife/rpt-parser` runs a login-correlation state machine over the DayZ RPT log — pending logins keyed by `dpnid`, class resolved from `Create entity type` / head-asset signals, `charID` always exact; a survivor roster in `@onelife/domain` (31 vanilla heads incl. `_2` variants). The `ingest-worker` gains an RPT poll pass (`rpt_files`, migration `0004`) that writes `character_sightings` + a `characters` rollup with charID inheritance (a reconnect with no model signal inherits the class of any sighting sharing its charId). A `getLifeCharacter` read-model joins sightings to a life by gamertag + time window (rebuild-safe), and the API life-detail response gains a `character` field. Device-based alt detection (Feature A) is permanently out (the `[MAM]` signal was removed in 1.29); web display of the character rides with the deferred stats dashboard.
- **SP4 — Unban-token economy.** A ledger-based token economy (`token_transactions` + `referrals`, migration `0003`; balance = SUM of deltas, grants exactly-once via idempotency keys). New `@onelife/tokens` package (balance, grant sweeps, redeem, transfer, set-referrer) powering: a token on each gamertag verification (13), monthly grants to verified players (14), setting a verified referrer (15) with a monthly token per referral (16), self-unban by redeeming a token (17), and token transfers between verified players (18). Redeeming flips the ban to `lift_pending` and spends the token instantly; the **enforcer** removes it from Nitrado on its next tick (so the `ENFORCER_DRY_RUN` gate still governs the write). New `apps/granter` loop runs the idempotent sweeps; `apps/api` gains session-gated wallet/redeem/transfer/referrer routes; the web account page gains a token wallet.
- **SP3 — Death-ban enforcement.** When a **qualified** life dies (>5 min playtime OR a PvP action, reusing `isLifeQualified`), the player is banned 24h on that server's Nitrado ban list. New `bans` table (migration `0002`), name-based ban-list methods on `@onelife/nitrado` (`getBans`/`addBan`/`removeBan` — whole-field replace of `settings.general.bans`), and a new `apps/enforcer` consumer that reconciles bans in three phases (detect qualified deaths → apply → auto-expire after 24h). **Actual Nitrado writes are gated behind `ENFORCER_DRY_RUN`, which defaults to `true` (log-only)** — real bans require explicitly setting it `false`. Every intended ban is recorded as a `bans` audit row even in dry-run.
- **SP2 — Auth + web + gamertag verification.** Added player identity: re-added the 6 auth/verification tables to the `db` schema (migration `0001`); ported `@onelife/auth` (Better Auth — Discord/Google/GitHub social + magic link), `@onelife/verification` (emote-sequence challenges), the `verifier` app (advances challenges from `emote.performed` events → marks gamertags verified), and the `api` app (Fastify core REST + Better Auth mount). Ported the `web` app as an auth-focused surface: login, account, the account/claim emote-verification UI, and a new minimal landing page — all news pages/routes/components and the stats dashboard were dropped. Verified: 15/15 packages typecheck + test, web production build green, and a live API smoke (server boots, `/api/auth/*` responds, core routes serve).
- **SP1 — Foundation + ADM ingest + lives.** Ported the multi-server DayZ ADM-log ingest stack from `one-life-platform` into this repo: monorepo skeleton (pnpm + turbo + Postgres/Drizzle), `@onelife/{db,domain,nitrado,adm-parser,event-log,projections,read-models,test-support}` and the `ingest-worker` + `projector` apps. Delivers log ingest → event log → life/player/session/kill projections + the qualified-lives read model. The news/LLM stack (generator, newsroom, openrouter) and the auth/verification schema were dropped; the DB schema is a clean 12-table core with a regenerated migration. Verified end-to-end on real production ADM logs (198 lines → 183 events → 3 players/3 lives/4 sessions) with all 143 ported tests green.

### Changed
### Deprecated
### Removed
### Fixed
### Security

## [1.0.1] - 2026-07-10

### Fixed
- Solo maintainer mode: back-merge PRs (`main`→`develop`) are no longer blocked by the contribution CHANGELOG/CLAUDE.md gate. The solo `gh-pr-create` check now parses `--head` and exempts `head == productionBranch`, mirroring the merge handler.

## [1.0.0] - 2026-07-10

### Added
- `soloMaintainer` mode: an opt-in `.claude/workflow.json` flag that enables a `solo` guard role holding the union of contributor + maintainer permissions, so one person can run the full workflow (feature work, contribution merge, release, back-merge) from a single clone without swapping git remotes. Protected branches stay PR-only and contribution merges into `develop` still require `--squash` + a posted review (a `COMMENTED` review counts). Off by default.
