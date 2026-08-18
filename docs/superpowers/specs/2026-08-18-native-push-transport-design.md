# Native push transport — design

Date: 2026-08-18
Status: Approved (design). Implementation plan not yet written.

Parent programme: [`2026-08-17-native-mobile-app-design.md`](2026-08-17-native-mobile-app-design.md),
decomposition item 3.

## Goal

Let `apps/notifier` deliver a notification to a phone as well as a browser.

This is the third slice of the native mobile app programme and the last one
that is entirely server-side. Nothing here needs Expo, an App Store account, or
a device: the whole slice is provable against a stub HTTP transport, and it
ships with device push OFF until credentials exist.

It comes before the app shell so that the shell can register for push against an
endpoint that already exists and is already tested, rather than shipping with the
programme's first driver stubbed out.

## Scope

**In:** the `device_push_tokens` table, the `ActiveSubscription` discriminated
union across both transports, an FCM HTTP v1 `Sender`, and the three API
endpoints a device uses to register, query, and unregister its token.

**Out:** anything in `apps/mobile`, which does not yet exist. Client-side push
registration, permission prompting, and Android channel creation belong to the
app shell slice. Coalescing and quiet hours remain deferred by the parent spec.

## Architecture

### New table `device_push_tokens`

Deliberately shaped like `push_subscriptions` so the retirement logic reads
identically for both transports:

| Column | Notes |
| --- | --- |
| `id` | `bigserial` primary key |
| `userId` | FK `user.id`, **`ON DELETE CASCADE`** |
| `token` | the FCM registration token |
| `platform` | `'ios'` or `'android'` |
| `deviceId` | stable per-install id |
| `userAgent` | truncated to 300 chars, as on `push_subscriptions` |
| `createdAt`, `lastSeenAt` | `defaultNow()` |
| `failureCount` | `integer`, default 0 |
| `disabledAt` | nullable timestamp |

Indexes: `unique (token)`, `index (userId)`, `index (userId, deviceId)`.

`token` is the unique key, mirroring `endpoint` on the web table. `deviceId` is
the stable identifier that `token` is not — FCM rotates tokens — so it is what
lets a re-registration reap the device's previous, now-dead row instead of
accumulating one row per rotation.

The cascade matters beyond tidiness: `deleteAccount`
(`packages/auth/src/delete-account.ts`) deletes `push_subscriptions` by cascade
rather than explicitly, so a cascading FK here means account deletion needs no
new code — only a new test.

### `ActiveSubscription` becomes a discriminated union

The parent spec says `Sender` dispatches on `kind`. That is true but
insufficient. `pushTick` currently calls `store.deleteSubscription(db, sub.id)`
and `store.recordFailure(db, sub.id, now)` (`apps/notifier/src/push.ts:68,70`),
and once subscriptions come from two tables a bare `id: number` is ambiguous:
`id = 5` exists in both tables, with independent sequences. Left as-is, a dead
FCM token would retire **someone's browser subscription**.

So the union carries `kind`, and the two store methods that act on a
subscription take the subscription rather than a loose id:

```ts
export type ActiveSubscription =
  | { kind: "webpush"; id: number; endpoint: string; p256dh: string; auth: string }
  | { kind: "device";  id: number; token: string; platform: "ios" | "android" };

// PushStore
deleteSubscription(db: Database, sub: ActiveSubscription): Promise<void>;
recordFailure(db: Database, sub: ActiveSubscription, now: Date): Promise<void>;
```

`activeSubscriptionsFor` runs the two selects and concatenates the results. Not
a SQL `UNION`: the columns do not line up, and making them line up means padding
both sides with nulls and then narrowing them back apart in TypeScript.

`platform` is a `text` column, so the schema declares it
`text("platform").$type<"ios" | "android">()` and the select needs no cast. The
API's `z.enum` is what guarantees the column only ever holds those two values.

`pushTick` itself needs **no change**, exactly as the parent spec claims. The
at-least-once semantics, the stale-backlog cutoff, and the stamp-only-after-
confirmed-send rule all survive untouched; a user with a browser subscription
and a phone gets both, and the existing `delivered = any endpoint accepted` rule
already does the right thing. The only edits inside `push.ts` are the two call
sites passing `sub` instead of `sub.id`.

### `Sender` takes a payload object

`Sender` currently receives an already-stringified `payload: string`
(`apps/notifier/src/sender.ts:5`), which an FCM sender would have to
`JSON.parse` back apart to build a structured message:

```ts
export type PushPayload = { title: string; body: string; href: string; kind: string };
export type Sender = (sub: ActiveSubscription, payload: PushPayload) => Promise<SendResult>;
```

`webPushSender` does its own `JSON.stringify`, so the wire format the existing
service worker reads is unchanged apart from an additive `kind` field.

`kind` is not decoration. The parent spec's UX rules require Android
notification channels per `kind`, so a user can mute "someone built near you"
without muting "you died" — and Android users who cannot mute granularly disable
everything. The channel id has to reach the device, so it has to be in the
payload.

`SendResult` is unchanged: `{ ok: true } | { ok: false; gone: boolean; error: string }`.
That contract is the reason the parent spec chose FCM over Expo's push service —
FCM v1 returns per-message errors synchronously, so dead-token detection needs no
separate receipts sweep.

## The FCM sender

### Transport

FCM HTTP v1: `POST https://fcm.googleapis.com/v1/projects/{projectId}/messages:send`,
authorized with an OAuth2 access token minted from a service-account JWT.

`google-auth-library` mints and caches that token. Hand-rolling it means ~80
lines of RS256 signing plus refresh logic, in a place where being subtly wrong
fails only in production.

The HTTP call is injected so the sender is testable with no network:

```ts
export function buildFcmSender(opts: {
  projectId: string;
  getAccessToken: () => Promise<string>;
  fetch?: typeof globalThis.fetch;
}): Sender;
```

Message shape:

```json
{ "message": { "token": "…",
               "notification": { "title": "…", "body": "…" },
               "android": { "notification": { "channel_id": "<kind>" } },
               "data": { "href": "…", "kind": "…" } } }
```

### Error mapping: `gone` is HTTP 404 and nothing else

The obvious extension is to map `400 INVALID_ARGUMENT` and
`403 SENDER_ID_MISMATCH` to `gone: true` as well, since both are permanent for a
genuinely bad token. This design deliberately does not.

`INVALID_ARGUMENT` is also what FCM returns when **our message shape** is wrong,
and `SENDER_ID_MISMATCH` is what it returns when `FCM_PROJECT_ID` is
misconfigured. Under a `gone` mapping, one bad deploy silently deletes every
device token in the database, and every user has to reinstall to recover.

So `gone` is `404` alone. Everything else is a non-gone failure, which retries
and then retires itself through the existing `MAX_FAILURES = 5` counter. A
permanently broken token costs five ticks instead of one — cheap. A configuration
mistake costs nothing permanent. `400` is logged at error level, because it
nearly always means we broke the message rather than the device.

### Configuration

Following the VAPID pattern in `apps/notifier/src/config.ts`:

- `FCM_PROJECT_ID` — default `""`
- `FCM_SERVICE_ACCOUNT_JSON_BASE64` — default `""`

Base64 because the service-account private key is a PEM full of newlines, which
does not survive a `.env` file intact.

`buildFcmSender` gets the same treatment as `buildSender`
(`apps/notifier/src/sender.ts:27-33`): **missing or unparseable credentials
return `null` and log that device push is OFF — never a module-scope throw.**
That comment already records why: an invalid VAPID subject throws synchronously,
which at module scope kills the process before the loop starts, takes generation
down with push, and fails the deploy script's post-start `systemctl is-active`
check.

`main.ts` composes the two into one dispatching sender keyed on `sub.kind`. An
unconfigured transport returns `{ ok: false, gone: false, error: "device push not configured" }`,
and the enable check becomes `pushEnabled && (webSend !== null || fcmSend !== null)`.

### Behaviour while FCM is unconfigured

There is no Firebase project yet, so this is the shipping state, not a corner
case.

A user whose only subscription is a device token has their notification retried
each tick until it ages past `NOTIFIER_PUSH_MAX_AGE_MINUTES` (default 60) and is
stamped as skipped. Bounded, self-draining, and no unbounded growth — and
unreachable in practice until the app shell exists to register a token at all.

Firebase project creation, the service-account key, and the APNs auth key upload
are **operator tasks**, documented in `deploy/README.md` by variable name. FCM
relays to APNs for iOS, so an Apple Developer Program membership is required
before iOS push works at all; Android works without one.

## API endpoints

Three endpoints in `apps/api/src/routes/notifications.ts`, mirroring the
web-push trio beside them:

```
POST   /me/device-tokens          { token, platform: "ios"|"android", deviceId }
GET    /me/device-tokens?token=…  → { active: boolean }
DELETE /me/device-tokens          { token }
```

All three require a session and return `401 { error: "unauthorized" }` without
one. Validation: `platform` is a `z.enum(["ios", "android"])`, `token` and
`deviceId` are non-empty and length-capped; a bad body is a `400`, never a
silent coercion.

**`POST` upserts on `token`**, setting `userId`, `platform`, `deviceId`,
`userAgent` (from the request header, truncated to 300 chars), `lastSeenAt`, and
resetting `failureCount` to 0 and `disabledAt` to null — the same reset the web
endpoint performs, so re-registering a retired token revives it. **Then it
reaps** rows where
`userId = session.user.id AND deviceId = <this> AND token <> <this>`. Upsert
first, reap second, so it can never delete the row it just wrote. The reap is
what stops FCM's token rotation from leaving one dead row per rotation.

The upsert deliberately **reassigns `userId`**, and that is load-bearing. The
parent spec puts the "unregister this device's token at sign-out" obligation on
the client, and rightly — but a client that crashes, is force-quit, or is simply
reinstalled never runs it, and the failure mode is that the next person to sign
in on that device keeps receiving the previous user's notifications. Because
`token` is unique and the upsert overwrites its owner, the next sign-in moves the
row with no client cooperation at all. Both mechanisms belong; this is the one
that cannot be skipped.

**`GET` exists for the reason its web sibling does**, documented at
`notifications.ts:121-126`: OS permission state outlives everything the server
knows about it. It survives sign-out, and it is untouched when the notifier
retires the row after repeated delivery failures. A toggle that reads only OS
state therefore says "on" in exactly the cases where no push will arrive.

Ownership predicates go in the `WHERE` clause throughout, never a read-then-check,
so a caller naming someone else's row affects zero rows rather than learning that
it exists.

## Testing

### The test this design exists to make possible

Insert a `push_subscriptions` row and a `device_push_tokens` row that share an
`id` — independent sequences, so this is trivial to arrange and will happen in
production. Fail the device send. Assert the **browser** subscription is
untouched.

That test fails against the parent spec's original `deleteSubscription(db, sub.id)`
sketch and passes against the union. Verify by mutation: revert the store to
dispatch on `id` alone and confirm it goes red.

### The rest

**Store** — `activeSubscriptionsFor` returns both kinds for a user and excludes
`disabledAt` rows from both; `recordFailure` retires at `MAX_FAILURES` on the
device table too.

**Sender** — with a stub `fetch`: `200` → `ok`; `404` → `gone: true`; `400`,
`403`, and `429` → `gone: false`, asserted explicitly so a later "helpful"
widening of the `gone` rule breaks a test rather than the database. Assert the
request body carries `channel_id` equal to the notification's `kind`.
`buildFcmSender` returns `null` on missing credentials and on garbage base64
without throwing.

**`pushTick`** — a user with one browser subscription and one device receives
both; `delivered = any endpoint accepted` still stamps correctly when exactly one
of the two fails, and leaves the row unstamped when both fail.

**API** — upsert moves `userId` across accounts; the rotation reap removes the
stale same-`deviceId` row; delete is scoped to the owner; unauthenticated is
`401`; unknown `platform` is `400`.

**Auth** — deleting an account removes its device tokens by cascade.

## Consequences and non-changes

No new workspace member, so `pnpm-workspace.yaml` and the turbo pipelines are
untouched. `google-auth-library` is added to `apps/notifier` alone.

The migration is hand-written as `packages/db/drizzle/0038_device_push_tokens.sql`,
per house style. A `CHANGELOG.md` entry under `Unreleased` is required by keel.

`apps/web` is not touched. The additive `kind` field in the web-push payload is
ignored by the existing service worker, which reads `title`, `body`, and `href`.

## Open questions

None blocking. Two deferred by the parent spec and unchanged here: whether bursty
raid notifications need coalescing or quiet hours, and whether device tokens
should ever be surfaced in the account UI as a list of signed-in devices.
