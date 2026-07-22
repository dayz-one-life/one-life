# Friends — F1: friendships, requests, notifications

**Date:** 2026-07-21
**Status:** Approved, not implemented
**Scope:** Sub-project F1 of three. F2 (location sharing) and F3 (presence notifications)
get their own specs.

## 1. Why this is three sub-projects

The original request covered three stacked subsystems:

1. **Friendships** — requests, accept/decline, the add/remove/cancel control, request
   notifications. *(This spec.)*
2. **Location sharing consent** — per-friend and global toggles, consumed by the
   in-development profile map feature. *(F2.)*
3. **Presence notifications** — "your friend is online", independently toggleable on both
   sides of the friendship. *(F3.)*

F2 is blocked on a feature that does not exist yet, so bundling it would block F1 behind
it. F1 is independently valuable and unblocks both others.

**The schema for all three lands in F1.** F1 ships four columns
(`a_shares_location`, `b_shares_location`, `a_shares_presence`, `b_shares_presence`) that
nothing writes and nothing reads. This is deliberate: it buys one migration instead of
three, and it means F2/F3 are pure surface work. A reviewer seeing dead columns should
find this paragraph.

## 2. Identity boundary

**Both parties must hold a `verified` `gamertag_links` row.**

This is the boundary the app already enforces for self-unban, the token ledger and the
transfer autocomplete. Reusing it means:

- a friendship row is `user_id ↔ user_id` with no dangling-identity case;
- the existing `searchVerifiedGamertags` read-model and `GET /players/search/verified`
  route serve friend search with no new query;
- nobody can hoard requests against gamertags they do not own.

The rejected alternative — allowing requests against unclaimed gamertags, held dormant
until someone verifies — creates exactly that hoarding vector, and presence/location
sharing are meaningless without a verified player behind them.

## 3. State machine

```
                    request
      (none) ──────────────────────▶ pending
         ▲                            │  │  │
         │ cancel (sender)            │  │  │ accept (recipient)
         └────────────────────────────┘  │  ▼
         ▲                               │ accepted
         │ remove (either, DELETEs row)  │  │
         └───────────────────────────────┼──┘
                                         │ decline (recipient)
                                         ▼
                                      declined ──▶ (re-request after cooldown)
```

`status ∈ {pending, accepted, declined}`. No `blocked` state in F1.

**Decline is recorded, not deleted.** `responded_at` is the cooldown clock:
`FRIEND_REQUEST_COOLDOWN_DAYS = 7`. Without a recorded decline, a declined user can
re-send instantly and forever — the standard harassment vector in a small server
community. The sender is not told a decline happened; their control simply reverts to
"Add friend", disabled until the cooldown expires.

**Remove deletes the row.** A retained row is a retained `*_shares_location` flag, and the
one thing that must be true after "remove friend" is that no consent survives. A
re-request after a removal is therefore immediate — correct, because a removal is not a
rejection.

**Blocking is deliberately out of scope.** It was considered and rejected for F1 because
it touches every surface in the app and raises questions this spec should not answer
(does a block hide you from the survivor board? from kill lists? from an obituary that
names you?). Declined-with-cooldown gets the anti-nag property without that blast radius.
If blocking is later required, it is a new status plus a suppression predicate — not a
reshape of this table.

## 4. Data model

One new table in **migration `0018`**, hand-written SQL with a hand-appended
`meta/_journal.json` entry, per the broken-snapshot-chain rule in CLAUDE.md (the drizzle
snapshot chain stops at `0014_snapshot.json`, so `drizzle-kit generate` emits wrong SQL).

Durable: **not** in `apps/projector/src/rebuild.ts`'s truncate list, **present** in
`APP_TABLES` (`packages/test-support/src/global-setup.ts`).

```sql
CREATE TABLE friendships (
  id                 bigserial PRIMARY KEY,
  user_a             text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  user_b             text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  status             text NOT NULL,
  requested_by       text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  request_seq        integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  responded_at       timestamptz,
  a_shares_location  boolean NOT NULL DEFAULT false,  -- F2
  b_shares_location  boolean NOT NULL DEFAULT false,  -- F2
  a_shares_presence  boolean NOT NULL DEFAULT false,  -- F3
  b_shares_presence  boolean NOT NULL DEFAULT false,  -- F3
  CONSTRAINT friendships_ordered CHECK (user_a < user_b)
);
CREATE UNIQUE INDEX friendships_pair_uniq ON friendships (user_a, user_b);
CREATE INDEX friendships_recipient_idx ON friendships (user_b, status);
```

### 4.1 Canonical ordering is a CHECK, not a convention

`user_a < user_b` is enforced in the database. Every write goes through one `orderPair`
helper in `packages/friends`, and every read returns a viewer-relative view
(`{ friend, direction, iShare…, theyShare… }`) so no consumer ever reasons about which
side of the pair it is on.

The CHECK exists because the unique index alone would happily accept the mirrored
duplicate `(user_b, user_a)`, and a hand-written INSERT during an incident is exactly when
that happens. The alternative shape — two directional rows, one per user — was rejected:
reads are simpler, but nothing in the schema stops the pair diverging, and
`shares_location` is the last field in this system that should ever be desynced.

### 4.2 `request_seq` exists because of the notification unique index

`notifications.natural_key` carries a **plain, global** unique index. A key of
`friend_request:<friendship_id>` therefore breaks on the second request over the same
pair:

> A requests B → B declines → cooldown expires → A requests again →
> `onConflictDoNothing` silently swallows the row → **B is never told.**

A re-request after a **decline** reuses the existing row — the unique index leaves no
choice — resetting `status` to `pending`, clearing `responded_at`, setting `requested_by`
to the new sender, and incrementing `request_seq`. The key is `friend_request:<id>:<seq>`.
(A re-request after a **removal** is a fresh row with a fresh id and `seq = 1`, since
removal deletes.) This is the
same class of bug as the `lives.id` rebuild-collision hazard already flagged in a comment
at the `notifications` table. **A test pins it** (§8).

## 5. Domain package and API

New **`packages/friends`**, mirroring `packages/tokens`: pure logic plus DB operations, no
HTTP. It exports `orderPair`, the viewer-relative view, and one function per transition —
`request`, `cancel`, `accept`, `decline`, `remove`, `listFriends`, `statusFor`. Route
handlers parse, authenticate, delegate, and map an error code to a status. All the
interesting behaviour is unit-testable against the Postgres harness with no Fastify.

Routes live in a new `apps/api/src/routes/friends.ts`, session-gated exactly like
`/me/notifications`:

| Route | Body / query | Notes |
|---|---|---|
| `GET /me/friends` | `?page=` | `{ friends[], incoming[], outgoing[] }` |
| `GET /me/friends/status` | `?gamertag=` | viewer-relative state for the profile control |
| `POST /me/friends/requests` | `{ toGamertag }` | resolved case-insensitively against verified links |
| `POST /me/friends/:id/accept` | — | recipient only |
| `POST /me/friends/:id/decline` | — | recipient only |
| `DELETE /me/friends/:id` | — | cancel if pending-and-mine, remove if accepted |

Error codes: `unauthorized` (401), `not_verified` (409), `self` (400), `not_found` (404),
`cooldown_active` (429, carries the expiry), `rate_limited` (429).

### 5.1 Addressing by gamertag, storage by user id

`POST /me/friends/requests` takes `{ toGamertag }` and resolves it case-insensitively
against verified `gamertag_links` — the same idiom as `POST /me/tokens/transfer` and
`POST /me/referrer`, with `not_verified` on a miss. The friendship stores user ids only;
gamertags are display and resolved on read.

### 5.2 A reciprocal request auto-accepts

If A→B is pending and B sends A a request, that is B saying yes. A second row is
impossible (unique index), so the only alternative is an error — and "you already have a
request from this person" as a *failure* is a bad interaction when the user's intent is
unambiguous. `request()` detects the inverse-pending case, transitions to `accepted`, and
fires `friend_request_accepted` to A.

### 5.3 The cooldown is enforced in `request()`

Not in the route, and not only in the UI. Returns `cooldown_active` with the expiry so the
control can say *when*, rather than presenting a button that fails.

### 5.4 `GET /me/friends/status` is a separate call from the player page

`getPlayerPage` is a public, viewer-independent read-model feeding a cached SSR page and a
dynamic OG card. Folding viewer-specific relationship state into it would make every
profile page per-viewer and defeat that caching. The control is a client component with
its own TanStack Query fetch keyed `["friend-status", slug]` — the shape
`SelfUnbanButton` already uses for `["tokens"]`.

### 5.5 Rate limit

**20 outgoing requests per rolling 24h per user**, counted from `friendships` itself (no
new table). Without it, one script notification-spams every verified player on the server.

## 6. Notifications

The catalogue goes from nine kinds to eleven:

```
friend_request_received   → recipient          href /friends
  natural_key  friend_request:<friendship_id>:<seq>
  title "Friend request"
  body  "<Gamertag> wants to be friends."

friend_request_accepted   → original sender    href /players/<slug>
  natural_key  friend_accepted:<friendship_id>:<seq>
  title "Friend request accepted"
  body  "<Gamertag> accepted your friend request."
```

Decline and remove are **silent**. A "X declined you" notification is a hostile message
with no action attached; a removal notice makes removing a friend socially costly, which
pushes people toward not removing — and quietly leaving location shared.

### 6.1 Rows are written inline in the API route, not by the worker

Every existing notification kind is swept out of projections by the `notifier` worker on a
≤5-minute tick, gated by `NOTIFIER_SINCE` and `NOTIFIER_DRY_RUN`. Friend requests are
different in kind: they are **user-initiated and instantaneous**.

A worker generator would deliver a friend request up to five minutes late, and — more
seriously — would produce **nothing at all** in the configuration actually run in
production today, where `NOTIFIER_SINCE` is unset. Those gates exist to stop a *backfill
sweep* flooding every player with their whole history, which an inline user action can
never do.

A small shared `writeNotification(db, draft)` helper is extracted so the route and the
worker's generators produce identical rows. The worker is otherwise untouched. Its **push
pass picks these rows up unchanged**, because it selects on `pushed_at IS NULL` and does
not care who inserted.

### 6.2 The insert shares the state change's transaction

A request that exists with no notification is a request the recipient never learns about;
an accept that does not notify leaves the sender staring at a stale control. One
transaction, both or neither.

`onConflictDoNothing` is kept even though `request_seq` makes a collision theoretically
impossible — a duplicate key must never turn a friend request into a 500. Note it takes
**no `targetWhere`**: `notifications_natural_key_uniq` is a plain unique index, unlike the
partial one on `articles`.

### 6.3 Bodies name the gamertag, never `user.name`

`user.name` comes from the OAuth provider and is frequently a real name. The site's entire
identity surface is callsigns. The gamertag is resolved at write time and frozen into the
row, matching every existing notification body.

### 6.4 Consequence: live on deploy

Because these are inline, friend notifications work the moment this ships, unlike the
existing nine which are dormant until an operator sets `NOTIFIER_SINCE`. Intended, but it
is a live-on-deploy surface and belongs in the changelog.

## 7. Web surfaces

### 7.1 `FriendButton` on `/players/[slug]`

Placed in the hero beside the verified stamp. A client component over
`useFriendStatus(slug)`:

| State | Control |
|---|---|
| loading | skeleton chip — **never** a default "Add friend" |
| signed-out, unverified viewer, self, or unverified target | renders nothing |
| none | **Add friend** |
| outgoing pending | **Cancel request** |
| incoming pending | **Accept** / **Decline** |
| accepted | **Friends ✓** → **Remove friend** on confirm |
| cooldown | disabled, "You can send another request in N days" |
| fetch failed | `role="status"` line, "couldn't load" |

The loading and error rows are the **live-data-honesty invariant**, not politeness:
loading and error are never rendered as an authoritative "not friends", the same rule
governing `TokensPanel`, `ServerCard` and the standing cards. Remove is a two-step confirm
because in F2 it silently revokes location sharing.

Accept/Decline is available here as well as on `/friends` — responding where you already
are is the obvious interaction.

### 7.2 `/friends` — "The Roster"

A permanent page mirroring `/notifications`, on a single **light** surface: incoming
requests with Accept/Decline, then the friends list (each gamertag a `GamertagLink` to
that player's dossier), then outgoing pending with Cancel. `role="list"` / `<li>`
semantics, a `loading.tsx` skeleton, `noindex` (per-viewer), and an `SrStatus` announcing
accept/decline/remove outcomes — following the patterns the SR-structure sub-project
established.

### 7.3 Rail panel

Deliberately thin: friend count, incoming-request count as a red badge, a link to
`/friends`. No list, no controls — the rail is 380px and a friends list grows unbounded.
It is also where F3's presence indicator lands naturally later ("3 friends online").

**⚠️ The panel mounts in both the rail (light paper) and the mobile sheet (`bg-dark`)**, so
it takes a surface variant like `TokensPanel`'s `boxed` — **and gets a test pinning the
token swap itself.** RTL asserts the DOM, not contrast, so a panel written only in
`text-ink`/`border-ink` renders present, functional and invisible on a phone while the
entire suite stays green. That is exactly how the notifications panel shipped in v0.26.0.

### 7.4 Navigation

`/friends` is signed-in-only, so it is reached from the account surfaces (rail + mobile
sheet), **not** the 5-item masthead nav, which is public content sections.

## 8. Testing

Most coverage sits in `packages/friends` against the Postgres harness:

- pair ordering normalizes regardless of argument order;
- the CHECK constraint rejects a mirrored insert;
- the full transition matrix — request → accept / decline / cancel / remove;
- a reciprocal request auto-accepts rather than erroring;
- the cooldown blocks inside 7 days and permits outside it;
- **a re-request after cooldown produces a second notification row** — the `request_seq`
  regression test; it must be proven to fail against a `natural_key` without the seq;
- removal deletes the row, and therefore the share flags;
- every mutation rejects a caller who is not a party to the friendship.

API tests cover the session gate, `not_verified` resolution, and the rate limit. Web tests
cover each `FriendButton` state including loading and error, and the rail-panel token swap
(§7.3).

## 9. Rollout

Migration `0018` adds one table and touches no projection table, so this ships with a
plain `./deploy/deploy.sh` — **no `--rebuild`**. No new env vars, no new worker, no new
systemd unit. Live on deploy (§6.4).

## 10. Explicitly out of scope for F1

- **Blocking** — settled as declined-with-cooldown instead (§3).
- **Location sharing** — F2. The four `*_shares_*` columns land now, default `false`,
  written by nothing and read by nothing (§1).
- **Presence notifications** — F3.
- **The global "share with all friends" preference** — F2 owns it, including the question
  of whether global-off forces per-friend off. The schema in §4 supports either reading,
  because the global setting belongs on a user-preferences column with the per-friend
  boolean as an override, not on the friendship rows.
- **Any public surfacing of the social graph** — no friend counts on the public dossier,
  no friends-of-friends, no "mutual friends". A friend list is private to its owner;
  nothing about a friendship appears on a public page.
