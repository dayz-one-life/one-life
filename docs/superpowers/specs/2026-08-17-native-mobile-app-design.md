# Native mobile app — design

Date: 2026-08-17
Status: Approved (design). Implementation plan not yet written.

## Goal

Ship One Life as native iOS and Android apps, built with Expo / React Native,
talking to the existing `apps/api` Fastify service.

Three drivers, in the order they justify the work:

1. **Reliable push notifications.** Web push on iOS requires add-to-home-screen
   and fails silently in ways users never report. Native push via APNs/FCM does
   not.
2. **App Store and Play Store presence** as a discovery and legitimacy channel
   for the server community.
3. **Map and UX performance.** A GPU-composited map renders player dots and
   trails at a quality Leaflet-in-a-browser does not reach on a phone.

Explicitly **not** a driver: background or always-on location sharing. Excluding
it avoids background-location entitlements and the App Review scrutiny they
attract.

## Scope

A **focused companion app**, not site parity.

**Native surfaces:** map and survivors, notification inbox, own player and life
pages, account and gamertag linking, login.

**Left on the web,** opened through `expo-web-browser`: legal, about, the
tabloid front page, the obituaries archive. These are content-heavy, change
independently of app releases, and gain nothing from being ported.

**Platforms:** iOS and Android, both.

## Approaches considered

**A. Expo / React Native app in the monorepo — chosen.** Satisfies all three
drivers. Costs a UI rewrite in RN primitives and a second front-end to maintain.

**B. Capacitor wrapper around the existing Next.js UI — rejected.** Fastest
path and no UI rewrite, but the map stays Leaflet in a WebView, so the
performance driver goes unmet. Apple guideline 4.2 ("minimum functionality") is
also a live rejection risk for repackaged websites.

**C. PWA hardening only — rejected.** No store presence, and iOS web push is
the specific thing being escaped.

## Architecture

### New workspace members

**`apps/mobile`** — Expo, expo-router, TypeScript. Added to
`pnpm-workspace.yaml` and to the turbo `typecheck` and `test` pipelines. `build`
stays out of turbo: EAS builds remotely, not in CI.

**`packages/api-client`** — `apps/web/src/lib/api.ts` (316 lines, one typed
function per endpoint, no React) lifted into a workspace package, with base URL
and credential strategy injected rather than hardcoded. Web passes cookies;
mobile passes a bearer token. Web then imports from the package instead of its
local copy.

This is the load-bearing decision. Every endpoint and response type is defined
once, so a new or changed endpoint cannot silently drift between the two
clients. It improves `apps/web` on its own merits.

**`packages/client-logic`** — framework-free client helpers shared by web and
mobile (see below). A separate package from `api-client` because these are pure
presentation and projection helpers with no transport concerns, and separate
from `packages/domain` because they are client-side display logic rather than
server domain rules.

### Shared pure logic

These modules in `apps/web/src/lib/` are framework-free and move to
`packages/client-logic` with their tests:

- `dayz-projection.ts`, `map-grid.ts`, `map-places.ts`, `map-resolution.ts`
- `life-timeline.ts`, `life-href.ts`, `cause-format.ts`, `format.ts`

### Dependency rules for `apps/mobile`

- **May** depend on `packages/api-client` and `packages/client-logic`, and on
  `packages/domain` /
  `packages/read-models` **for types and pure functions only**.
- **Must never** depend on `packages/db`. Drizzle and `postgres` cannot run in
  React Native, and an accidental import surfaces as an opaque Metro bundling
  error. Enforce with an explicit lint rule so it fails loudly.

### Internal structure of `apps/mobile`

- `app/` — expo-router file-based routes; route structure carries over from the
  Next App Router.
- `features/` — one folder per surface: `map`, `notifications`, `survivors`,
  `life`, `account`.
- `native/` — thin platform layer: push registration, secure token storage,
  deep-link handling. Isolated so screens never touch native APIs directly and
  remain testable in plain Node.

### Consequence: no server tier

`apps/web` fetches partly server-side (`apiGetCached` with
`revalidateSeconds`). Mobile has no server component tier — every call is
client-side and relies on a client cache instead. React Query is already a web
dependency and covers this; mobile leans on it harder.

## Auth

`bearer()` is already registered unconditionally in
`packages/auth/src/auth.ts:69`, so the server can already issue and accept
token-based sessions. No server auth redesign is needed.

**Session handling.** Mobile uses the same better-auth `createAuthClient` with
the Expo plugin, storing the session token in **`expo-secure-store`** (iOS
Keychain / Android Keystore). Not AsyncStorage, which is plaintext on a rooted
device. `packages/api-client` receives the token and attaches
`Authorization: Bearer …`; web injects `credentials: "include"` instead. That is
the single branch in the shared client.

**Social login goes through the system browser** — `expo-auth-session` /
`ASWebAuthenticationSession` on iOS, Custom Tabs on Android. Not a preference:
Google blocks OAuth from embedded WebViews ("disallowed user agent") and Apple
flags it in review. Requires:

- a registered URL scheme (`onelife://`) plus iOS Universal Links and Android
  App Links
- `onelife://` added to `trustedOrigins` in `AuthConfig`
- the new redirect URI registered in each configured OAuth console (Discord,
  Google, GitHub)

**Magic link stays available on mobile,** and this is strategic rather than
merely convenient. Apple guideline 4.8 requires offering Sign in with Apple when
an app uses *exclusively* third-party social logins. Email magic link is
first-party auth, so keeping it very likely removes the need to build Sign in
with Apple. The cost is handling one more deep link: the magic-link email opens
in the browser and hands off to the app scheme.

**Sign-out has a mobile-specific obligation.** It must revoke the session
server-side, clear secure storage, **and** unregister that device's push token.
Without the last step, the next person to sign in on that device keeps receiving
the previous user's notifications. This bug does not exist on web, where push
subscriptions are per-browser-profile.

**401 handling.** There is no server render to fall back on, so
`packages/api-client` needs an auth-failure hook: clear the token, route to
login.

**Decided:** mobile launches with **all configured social providers**, matching
the site rather than narrowing to Discord-only. Each enabled provider therefore
needs its app-scheme redirect URI registered in its console.

## Push notifications

The notification payload is already `{ title, body, href }` where `href` is a
site path — a deep-link target that needs no new server work.

### Schema

New table `device_push_tokens`: `userId`, `token`, `platform`, `deviceId`,
`disabledAt`, failure count, timestamps. Deliberately mirrors
`push_subscriptions`' retirement pattern (`disabledAt` plus `MAX_FAILURES`) so
retirement logic reads the same for both transports.

### Changes to `apps/notifier`

Small and additive, because `Sender` and `PushStore` are already injected
interfaces (`apps/notifier/src/push.ts:7-20`):

- `ActiveSubscription` becomes a discriminated union:
  `{ kind: "webpush", endpoint, p256dh, auth }` | `{ kind: "device", token, platform }`
- `activeSubscriptionsFor` unions the two tables
- `Sender` dispatches on `kind`

`pushTick` itself needs **no change**: the at-least-once semantics, the stale
backlog cutoff, and the stamp-only-after-confirmed-send rule all still hold. A
user with a browser subscription and a phone gets both, and the existing
`delivered = any endpoint accepted` rule already does the right thing.

### Transport: direct FCM

Chosen over Expo's push service, which is the opposite of the usual default for
an Expo app. The reason is specific to this codebase: FCM v1 returns per-message
errors **synchronously**, and `UNREGISTERED` / `NOT_FOUND` map exactly onto the
existing `{ ok: false, gone: true }` contract. Expo's service returns a ticket,
with dead-token detection arriving later through a separate receipts endpoint —
requiring an entire async sweep and reconciliation path the current design does
not need. Expo is lower-ops in the abstract, but here it trades new machinery
for that, in the one place the system is already correct. APNs keys and FCM
credentials are needed either way, since FCM relays to APNs for iOS.

`Sender` is an interface, so switching transports later is one implementation,
not a refactor.

### Deep linking

`href` values map onto expo-router paths largely 1:1. Needed: a resolver so
hrefs pointing at web-only surfaces (obituaries archive, legal) open the in-app
browser instead of failing to route.

### UX rules

- **Do not request notification permission at launch.** iOS grants exactly one
  prompt; a denial cannot be re-requested in-app, only redirected to Settings.
  Prompt where the value is obvious — first opening the notifications screen, or
  after linking a gamertag.
- **Android notification channels per `kind`,** so a user can mute "someone
  built near you" without muting "you died." Android users who cannot mute
  granularly disable everything.

### Deferred

DayZ events are bursty; a raid can generate many notifications quickly. Whether
that needs coalescing or quiet hours is a real question, but is YAGNI for v1.
Let usage decide.

## Map

### Engine: `@maplibre/maplibre-react-native`

Over `react-native-maps`, which requires a Google Maps API key and renders a
vendor base map underneath — pointless when the tiles cover the world opaquely.
MapLibre needs no key, no base map, and treats offline tile packs as a
first-class feature, making offline maps a later addition rather than a
redesign.

### Projection

Web uses Leaflet `CRS.Simple`, a linear pixel plane. MapLibre has no flat-CRS
mode and renders Web Mercator. This is not a problem, because the tiles are
already served as a standard `{z}/{x}/{y}` pyramid
(`/tiles/{map}/topographic/{z}/{x}/{y}.webp`,
`apps/web/src/components/map/map-canvas.tsx:353`). Declared as a raster source,
MapLibre places tile (z,x,y) in the standard Mercator cell — and a game point
converted world → pixel → normalized → inverse-Mercator lng/lat lands in exactly
the same cell as its terrain. The transform round-trips, so nothing is distorted
relative to the imagery.

Concretely, one new pure function in `dayz-projection.ts` beside the existing
`worldToLatLng`:

```
worldToLngLat(x, y, size, canvasPx) → { lng, lat }
```

built on the existing `worldToPixel`. Pure, unit-testable, no native code,
verifiable against the same landmark checks the web version uses.

### Rendering

Player dots and trails are **GeoJSON sources with circle and line layers**, not
marker components. This is where the map-performance driver is paid: GPU
compositing handles hundreds of points smoothly, whereas one React Native view
per player degrades quickly. It also mirrors the existing design, which already
rebuilds a single `LayerGroup` wholesale each poll rather than diffing —
replacing a GeoJSON source's data is the same operation.

### What ports and what does not

**Ports as-is:** `dayz-projection.ts`, `map-grid.ts`, `map-places.ts`,
`map-resolution.ts`, `life-timeline.ts`, and their tests.

**Does not port:** the viewport logic in `map-canvas.tsx`. Its hard-won details
are Leaflet-specific workarounds — `zoomSnap` rounding, `getBoundsZoom`'s
ceil-and-max behaviour, `_limitZoom` ordering — that are irrelevant on another
engine. Carry over the *requirements* (no grey space, a reachable zoom floor,
re-fit on rotate) and expect to rediscover an equivalent set of quirks in
MapLibre. This is a real cost, not a mechanical port.

### Spike required before committing

MapLibre Native's raster support for **WebP** depends on platform decoders. WebP
is fine on modern iOS and Android, but confirm with a short spike; a fallback
would mean serving a second tile format.

## Release pipeline

**Build and ship:** EAS Build plus EAS Submit — no local build farm, no Xcode in
CI. `ci.yml` needs no restructuring: `apps/mobile`'s typecheck and tests join the
existing `pnpm run ci` turbo run, and mobile tests are pure (no Postgres).

**Credentials:** Apple Developer Program ($99/yr), App Store Connect record, APNs
`.p8` key uploaded to Firebase; Play Console ($25 once), FCM project, service
account JSON.

The notifier's FCM credentials follow the pattern `buildSender` already uses for
VAPID: **missing or invalid credentials mean native push is OFF and generation
keeps running**, never a crashed process. The existing comment in
`apps/notifier/src/sender.ts` explains why, and the same reasoning applies.

**EAS Update** ships JS-only changes over the air within minutes, no review. Only
native-module changes require a store build, so most bug fixes bypass review.

### API compatibility becomes permanent

Today web and API deploy together, so an endpoint can be reshaped and both sides
move at once. Once an app is on someone's phone, **old versions call the API
indefinitely**, including from users who never update.

Required:

- a minimum-supported-version endpoint checked at launch, with a hard "update
  required" gate
- `packages/api-client` response types treated as a compatibility contract
  rather than an internal detail

This is the largest ongoing cost of going native, and it is a discipline change
more than a technical one.

### Token purchasing is excluded from v1

There is a Stripe checkout flow (`createCheckout`,
`packages/tokens/purchase.ts`). Tokens are consumed inside the app, making them
digital goods: Apple requires IAP and takes 30%, and the rules on even *linking
out* to external purchase are narrow and aggressively enforced.

The mobile app shows token balance and allows redeem and transfer, but has **no
purchase path and no link to one**. Buying stays on the website. Revisit
deliberately later if it matters.

### Compliance work that must be built

**Account deletion** (guideline 5.1.1(v)) — mandatory for any app with account
creation, and no such endpoint exists today. Retention is decided (see
Decisions): the account goes, the player history stays. On the critical path.

**UGC reporting and blocking** (guideline 1.2) — user avatars
(`/api/me/avatar`) and gamertags are user-generated content. Apple requires a
report mechanism, a block mechanism, and a stated commitment to act on reports
within 24 hours. A common rejection reason for community apps.

**Also:** an age rating set honestly for a violent-survival-game context, App
Privacy labels, and an iOS privacy manifest.

## Decomposition

This document is a **program design, not a single implementation plan**. It
spans several independently shippable pieces, each of which warrants its own
plan and its own review cycle:

1. **Shared-package extraction** — `packages/api-client` and
   `packages/client-logic`, with `apps/web` migrated onto them. Ships alone,
   improves web on its own, unblocks everything else.
2. **Server prerequisites** — account deletion, the minimum-supported-version
   gate, UGC report/block. No mobile code
   involved; all are App Store blockers.
3. **Native push transport** — `device_push_tokens`, the union
   `ActiveSubscription`, the FCM `Sender`. Testable against the existing
   notifier suite before any app exists.
4. **The app shell** — `apps/mobile`, expo-router, auth, secure storage, deep
   linking, notification inbox.
5. **The map** — after the WebP spike; the largest single piece.
6. **Release and store submission** — credentials, EAS pipelines, listings,
   privacy labels, ratings.

The first implementation plan should cover **item 1 only**. Items 2 and 3 can
proceed in parallel with it.

## Sequencing notes

Not blocked by any mobile decision, and can start immediately:

- account deletion (endpoint; retention already decided)
- the minimum-supported-version compatibility gate
- extracting `packages/api-client`

Should happen before committing to MapLibre:

- the WebP raster-decoding spike

## Decisions

**Social providers.** Mobile launches with all configured social providers
(Discord, Google, GitHub as enabled), matching the site rather than narrowing to
Discord-only. Each provider needs its redirect URI registered for the app
scheme.

**Account deletion retains player history.** Deleting an account deletes the
account and its links, not the game record. This is clean in the current schema
because the two are already separate:

- `players` and `lives` carry **no `userId`** — history is keyed by gamertag and
  server.
- Accounts attach through `gamertag_links`, and the public dossier's verified
  badge and avatar join `gamertagLinks` → `avatars` by `userId`
  (`packages/read-models/src/player-page.ts:110-113`).

So deletion removes the account, its gamertag links, avatar, tokens,
notifications, and push subscriptions; the dossier survives with its lives,
deaths, and obituaries intact, losing only the verified badge and avatar. No
anonymization pass over historical rows is required.

**THREE** foreign keys to `user.id` lack a cascade, and two of them are rows
belonging to OTHER users — so account deletion is not self-contained:

| FK | Cascade | Whose row | Resolution |
| --- | --- | --- | --- |
| `gamertagLinks.userId` (`schema.ts:276`) | none | the leaver's | delete explicitly |
| `tokenTransactions.counterpartyUserId` (`schema.ts:337`) | none, nullable | another user's ledger | `SET NULL` |
| `referrals.referrerUserId` (`schema.ts:346`) | none, NOT NULL | another user's referral record | delete the row |

Delete the gamertag links **explicitly** in the deletion path rather than adding
a cascade, so the behaviour stays visible in code rather than hidden in schema.

The remaining eight FKs (`session`, `account`, `avatars`, `notifications`,
`push_subscriptions`, `location_shares` on both sides, `tokenTransactions.userId`,
`referrals.userId`) do cascade and need no explicit handling.

Sub-project 2a's spec, [`2026-08-17-account-deletion-design.md`](2026-08-17-account-deletion-design.md),
carries the reasoning for each resolution and the transaction that applies them.

## Open questions

1. **A deleted account frees its gamertag, and the next claimant inherits the
   visible history.** Verification is account-keyed while history is
   gamertag-keyed, so whoever next claims a freed gamertag appears as the
   verified owner of all its prior lives and deaths. Rare, but awkward if it
   happens to a well-known player. Options: do nothing; tombstone
   deleted-account gamertags against re-claiming; or show the dossier as
   unclaimed-with-history. To be settled in the account-deletion plan, not here.
