# Player Notifications — Design

**Date:** 2026-07-19
**Status:** Approved, ready for implementation planning

## Summary

Give every verified player an inbox. A new `apps/notifier` worker sweeps existing
durable state — bans, token transactions, lives, articles, gamertag links — and
writes `notifications` rows deduplicated by a natural key. Those rows surface as a
bell + panel in the R3 controls rail and, for players who opt in, as browser push
notifications delivered through a service worker.

Nothing about the game loop changes. Notifications are a *read* of state the system
already produces.

## Motivation

One Life's players are Xbox DayZ players. They are, by definition, not looking at the
website while the events that matter to them happen. The two moments the platform
most needs to reach a player are:

- **"Your life now counts."** A qualified life means dying costs 24 hours. Today
  nothing tells a player they crossed that line.
- **"Your ban is over."** Today a banned player has to keep re-checking a countdown.

Both are cheap to derive from state that already exists and expensive to discover by
accident.

## Scope

In scope:

- Migration `0015`: `notifications` + `push_subscriptions`, both durable.
- `apps/notifier`: a two-pass sweep worker (`generateTick`, `pushTick`).
- API: `GET /me/notifications`, `POST /me/notifications/read`,
  `POST|DELETE /me/push-subscriptions`, `GET /push/vapid-key`.
- Web: a notifications panel + unread bell in the controls rail and mobile sheet.
- Web push: service worker, VAPID keys, and a `manifest.json` so iOS can install the
  site as a PWA.

Out of scope:

- Per-notification-type user preferences.
- A dedicated `/notifications` page.
- Per-item read state.
- Email and Discord as delivery channels.

Each is discussed under "Deliberate omissions."

## 1. The notification catalogue

Every type is one sweep pass with a natural key. All keys are built in TypeScript from
integer primary keys.

### Account

| Kind | Source | Natural key |
|---|---|---|
| `gamertag_verified` | `gamertag_links.status = 'verified'` | `gamertag_verified:<linkId>` |
| `tokens_granted` | `token_transactions`, `delta > 0`, kind ∈ `monthly`/`referral`/`verification` | `tokens:<txId>` |
| `tokens_received` | `token_transactions`, `kind = 'transfer_in'` | `tokens:<txId>` |

### Gameplay

| Kind | Source | Natural key |
|---|---|---|
| `ban_applied` | `bans.status = 'applied'` | `ban_applied:<banId>` |
| `ban_lifted` | `bans.status` ∈ `expired`/`lifted` | `ban_lifted:<banId>` |
| `life_qualified` | open life with `qualified_at` set inside the window | `life_qualified:<lifeId>` |
| `survival_milestone` | open life where `now - startedAt` crosses 7 / 14 / 30 days | `milestone:<days>d:<lifeId>` |

### Editorial

| Kind | Source | Natural key |
|---|---|---|
| `obituary_published` | `articles`, `kind = 'obituary'`, `status = 'published'`, matching gamertag | `article:<articleId>` |
| `birth_notice_published` | `articles`, `kind = 'birth_notice'`, `status = 'published'`, matching gamertag | `article:<articleId>` |

### Notes on the catalogue

**Gamertag → user resolution.** Gameplay and editorial events are keyed by *gamertag*;
an inbox is keyed by *user*. The only bridge is a `verified` row in `gamertag_links`.
Generators therefore join through verified links, which means notifications are only
ever produced for verified users. This is both a scope limiter and the correct privacy
boundary: an unverified claimant must never receive another player's gameplay history.

**`life_qualified` is the only forward-looking notification.** Everything else reports
something that already happened.

Qualification was historically computed lazily and never materialized. That does not
work here: with no qualification timestamp, the generator would have to window on
`lives.startedAt`, silently dropping any life that qualified more than a lookback-window
after it began. This design therefore **materializes `lives.qualified_at`**, written
write-once by the projector fold at the three points a life can qualify — playtime
crossing `QUALIFY_SECONDS` (backdated to the crossing instant), a pvp death, or the
killer landing a kill. It mirrors what `lifeQualifiedAt`
(`packages/read-models/src/qualified.ts`) derives at read time, and its "earliest
candidate wins" rule is preserved by never overwriting a non-null value.

One residual approximation: the fold credits playtime only at session close, so a
playtime-qualified life's `qualified_at` is backdated correctly but *written* at
disconnect. `NOTIFIER_LOOKBACK_HOURS` defaults to 48 to absorb that lag.

**One death produces up to three notifications** — `ban_applied` and
`obituary_published` land within a tick of each other, `ban_lifted` follows 24 hours
later. These are treated as genuinely distinct moments rather than merged; the panel
groups visually by day.

## 2. Data model (migration `0015`)

### `notifications`

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `user_id` | text → `user.id` | cascade on delete |
| `kind` | text | one of the catalogue kinds |
| `natural_key` | text | **plain unique index**, not partial |
| `title` | text | |
| `body` | text | |
| `href` | text | deep link: life timeline, obituary, or player page |
| `created_at` | timestamptz | |
| `read_at` | timestamptz null | |
| `pushed_at` | timestamptz null | |

Index on `(user_id, created_at DESC)` for the feed query, and a partial index on
`created_at WHERE pushed_at IS NULL` mirroring `articles_discord_unposted_idx`.

### `push_subscriptions`

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `user_id` | text → `user.id` | cascade on delete |
| `endpoint` | text | unique |
| `p256dh` | text | |
| `auth` | text | |
| `user_agent` | text null | diagnostics only |
| `created_at` | timestamptz | |
| `last_seen_at` | timestamptz | |
| `failure_count` | int default 0 | |
| `disabled_at` | timestamptz null | |

**Durability.** Two distinct lists, easy to confuse:

- `rebuildAll` (`apps/projector/src/rebuild.ts`) truncates an explicit allow-list —
  `positions, build_events, hit_events, kills, sessions, lives, players`. Durability
  comes from **not being on that list**. Neither new table is added to it, so both
  survive `./deploy/deploy.sh --rebuild`, as `articles`, `bans`, and `article_images`
  already do.
- `APP_TABLES` (`packages/test-support/src/global-setup.ts`) is the **test-harness**
  wipe list and truncates everything for a clean slate. Both new tables **are** added
  there, so test runs start empty.

## 3. The generator worker

`apps/notifier`, built on the `apps/granter` skeleton: zod config → pino → `getDb` →
`while (true)` with one try/catch per pass → sleep. Two passes per tick:
`generateTick`, then `pushTick`. A failure in one never stalls the other.

### Generation

Each catalogue entry is a `Generator` — an async function taking a deps object
(`db`, `now`, `log`) and returning `NotificationDraft[]`
(`userId`, `kind`, `naturalKey`, `title`, `body`, `href`).

`generateTick` runs the generators, concatenates the drafts, and performs one bulk
insert:

```ts
insert(notifications)
  .values(drafts)
  .onConflictDoNothing({ target: notifications.naturalKey })
```

The unique index on `natural_key` **is** the anti-join. No cursor, no per-row existence
check, no second query.

Two rails, both places the newsdesk previously got bitten:

1. **Every `naturalKey` is constructed in TypeScript** from an integer id. Nothing is
   rendered in SQL. A SQL-side key that drifted from the TypeScript one would make the
   dedup a silent no-op and re-notify forever.
2. **`natural_key` carries a plain, full unique index — not a partial one.** Unlike
   `articles_kind_server_gamertag_life_uniq`, these `onConflictDoNothing` calls need
   **no `targetWhere`**. Code copied from `apps/newsdesk/src/pg-store.ts` must drop
   that argument, not carry it over.

### Bounding the sweep

A naive generator would rescan all history every tick. Each generator instead queries a
window: rows whose driving timestamp falls within `NOTIFIER_LOOKBACK_HOURS`
(default 48), floored by the global `NOTIFIER_SINCE` cutoff.

`NOTIFIER_SINCE` unset, empty, or unparseable ⇒ **generation is off**: zero drafts, no
writes. This is the `NEWSDESK_BIRTH_SINCE` precedent. It is set once, to a go-live
instant, making coverage forward-only. Without it, the first live run would notify
every player about their entire history.

### Configuration

| Var | Default | Meaning |
|---|---|---|
| `NOTIFIER_INTERVAL_SECONDS` | `60` | tick cadence |
| `NOTIFIER_SINCE` | *(unset)* | ISO-8601 cutoff; unset ⇒ generation off |
| `NOTIFIER_DRY_RUN` | `true` | log intended notifications, write nothing |
| `NOTIFIER_LOOKBACK_HOURS` | `48` | per-generator query window |
| `NOTIFIER_PUSH_ENABLED` | `true` | push kill switch |
| `NOTIFIER_PUSH_MAX_PER_TICK` | `50` | push fan-out cap |
| `NOTIFIER_PUSH_MAX_AGE_MINUTES` | `60` | staleness cutoff for push |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | — | push credentials |

### Concurrency boundary

The sweeps read without `FOR UPDATE SKIP LOCKED`. A **single notifier instance** is
assumed — the same documented boundary as `apps/newsdesk/src/notify.ts`. Running two
would duplicate push sends (though not notification rows, which the unique key
protects).

## 4. API

`apps/api/src/routes/notifications.ts` exporting
`registerNotificationRoutes(app, db, auth)`, registered inside the authed block of
`app.ts`. Handlers follow the `tokens.ts` shape: `getSession` → 401 → `session.user.id`.

| Route | Behavior |
|---|---|
| `GET /me/notifications` | newest-first, latest 20, plus `unreadCount` |
| `POST /me/notifications/read` | marks all of the caller's unread notifications read |
| `POST /me/push-subscriptions` | upsert on `endpoint` |
| `DELETE /me/push-subscriptions` | body carries `endpoint` |
| `GET /push/vapid-key` | public; returns the VAPID public key |

`DELETE /me/push-subscriptions` carries a body, which sidesteps the `apiSend` trap
documented in R3: a bodyless `DELETE` sent with `content-type: application/json` is
rejected by Fastify as an empty JSON body.

`GET /push/vapid-key` is a route rather than a `NEXT_PUBLIC_*` build-time variable, for
the same reason as `GET /api/auth/providers`: the backend stays the source of truth and
key rotation does not require a rebuild.

## 5. Web UI

### Data

A fourth query in `useControls()` — `useNotifications(signedIn)` with a 60s
`refetchInterval`, matching the existing player-page poll cadence — plus a `markRead`
mutation in `useControlsActions()` that invalidates `["notifications"]`. Client
functions go in `apps/web/src/lib/api.ts`.

### Placement

The panel renders in the **verified branch only**, between `IdentityRow` and
`TokensPanel` in `rail.tsx`, mirrored into the `verified &&` block of
`mobile-controls.tsx`.

This follows from the catalogue rather than being a UI judgement: every notification
type either requires a verified gamertag link or *is* the verification event. An
unlinked or pending user's inbox is empty by construction, and their first notification
(`gamertag_verified`) arrives at the same moment the panel does. There is no
empty-inbox state to design for a user who cannot have one.

### The panel

A collapsed bell row carrying an unread-count badge, expanding in place. Each item
renders a kind-colored rule — red for ban/death/obituary, blue for
birth-notice/qualified, ink for tokens and account events, reusing the R5b/R5c
red-vs-blue convention — then title, one-line body, and a relative timestamp, with the
whole row linking to `href`. Unread rows sit on `--bone`.

Opening the panel fires `markRead`.

Presentational components are props-only with colocated `.test.tsx`, per the
`tokens-panel.tsx` convention. `useControls` and the containers stay thin and untested.

## 6. Web push

### Service worker

`apps/web/public/sw.js`:

- `push` → `showNotification(title, { body, data: { href }, icon, badge })`, using icons
  from the vendored brand favicon kit.
- `notificationclick` → focus an existing client if one is open, else
  `openWindow(href)`.

### Permission flow

Registration is triggered **only by an explicit button** in the notifications panel.
`Notification.requestPermission()` must be user-gesture-initiated, and auto-prompting
on page load is the fastest route to a permanent block.

On grant: `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` →
`POST /me/push-subscriptions`.

### PWA manifest

`apps/web/public/manifest.json` with name, short name, theme/background colors from the
brand palette, and icons from the existing favicon kit, linked from the root layout.

This exists because **Safari only delivers web push to sites installed to the iOS home
screen**. The manifest is a hard prerequisite for any iOS delivery at all.

### `pushTick`

Mirrors `apps/newsdesk/src/notify.ts`. Select notifications with `pushed_at IS NULL`,
oldest-first, limited by `NOTIFIER_PUSH_MAX_PER_TICK`. For each: load the user's active
subscriptions, send, and **stamp `pushed_at` only after a confirmed send**. Stamping
before sending is rejected for the same reason it was in `notify.ts` — it drops
messages.

Three cases the naive implementation gets wrong:

1. **Zero active subscriptions** → stamp `pushed_at` anyway. Otherwise every
   notification belonging to every non-subscribed user is retried forever and the sweep
   never drains.
2. **`404` / `410` from the push service** → the subscription is dead; delete the row.
   Any other error increments `failure_count`, disabling the subscription at 5.
3. **Staleness** → anything older than `NOTIFIER_PUSH_MAX_AGE_MINUTES` is stamped
   without sending. Otherwise enabling push delivers a backlog of week-old ban notices.

Gated by `NOTIFIER_PUSH_ENABLED` on top of `NOTIFIER_DRY_RUN` — the
`NEWSDESK_IMAGES_ENABLED` precedent, so a broken push pipeline can never stop
notification generation.

### Known limitation: iOS

Even with the manifest, iOS users receive push only after installing the site to their
home screen. Given that Xbox DayZ players skew heavily mobile, this is the weakest part
of the feature. Android Chrome and desktop browsers work normally. A future Discord
notifier — reusing the `account.accountId WHERE provider_id = 'discord'` handle already
surfaced by `apps/api/src/routes/me.ts` — would reach this audience far more reliably,
and is the natural next delivery channel.

## 7. Testing

- **Each generator** against the `packages/test-support` Postgres harness: seed source
  state, assert exact drafts, then **run the tick twice and assert no duplicate row**.
  This double-run assertion is the whole correctness argument for sweep-and-stamp and is
  the single most important test in the feature.
- **`generateTick`** with fake generators — orchestration and bulk-insert dedup,
  independent of any one notification type.
- **`pushTick`** with a fake sender, covering all three edge cases above.
- **Inertness:** `NOTIFIER_SINCE` unset ⇒ zero drafts and zero writes, asserted
  directly, mirroring `image-pg-store.test.ts`.
- **API:** 401 when unauthenticated; one user can never read or mark another user's
  notifications.
- **Web:** `NotificationsPanel` and the bell badge as props-only component tests.

## 8. Rollout

Generation and delivery fail differently, so they are enabled separately.

1. Deploy with `NOTIFIER_DRY_RUN=true` and `NOTIFIER_SINCE` unset. The unit runs and
   does nothing. Confirm it is alive.
2. Set `NOTIFIER_SINCE` to a go-live instant, keeping dry-run on. Read the logged
   intended notifications and sanity-check the catalogue against real players.
3. `NOTIFIER_DRY_RUN=false`, `NOTIFIER_PUSH_ENABLED=false`. In-site notifications go
   live; the rail panel is the entire blast radius.
4. Enable push.

**Deploy mechanics.** A new `onelife-notifier` systemd unit is authored on the host and
added to `SERVICES` in `deploy/deploy.sh` and to the unit table in `deploy/README.md`.
Migration `0015` adds the two new tables **and** a `lives.qualified_at` column populated
by the projector fold. That is a projection reshape, so the release ships with
`./deploy/deploy.sh --rebuild`. A normal deploy would leave `qualified_at` null on every
existing life, and `life_qualified` would never fire for anyone.

## 9. Deliberate omissions

**Per-type preferences.** Push is already opt-in behind a browser permission prompt,
and an in-site panel is passive — it cannot interrupt anyone. A preferences table now
is speculative surface area. Revisit if a specific type proves noisy.

**A `/notifications` page.** The latest 20 in the rail covers the use case. A dedicated
route needs its own layout, pagination, and metadata for a surface nobody has asked to
browse.

**Per-item read state.** "I looked at the panel" is the only signal that carries
meaning here. Per-item tracking is real complexity for no behavioral difference.

**Email and Discord channels.** There is no production email transport —
`packages/auth/src/mailer.ts` ships only `consoleMailer`, explicitly marked unsuitable
for production — so email would mean adding a transport first. Discord DMs need a bot
token; the existing integration is a channel webhook only. Both are clean future
additions and neither blocks this work.

**Event-log tailing.** `consumer_cursors` and the `events` table would serve gameplay
milestones elegantly, but ban lifts, token grants, and article publishes are state
changes in durable tables rather than events. Tailing would have required the
sweep mechanism anyway, for half the catalogue, at the cost of maintaining two
mechanisms. Reconsider only if a future notification needs per-kill granularity that
the `lives` projection cannot express.

**Write-time emission** from `enforcer` / `granter` / `newsdesk` would cut latency to
zero and avoid the back-catalogue problem, but scatters notification logic across four
apps and makes every new notification type a PR against an unrelated worker.
