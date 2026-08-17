# Account deletion — design

Date: 2026-08-17
Status: Approved (design). Implementation plan not yet written.

Parent: [`2026-08-17-native-mobile-app-design.md`](2026-08-17-native-mobile-app-design.md),
sub-project **2a** of its "Server prerequisites" slice.

## Goal

Let a signed-in user permanently delete their account from within the product.

App Store guideline 5.1.1(v) makes this mandatory for any app offering account
creation, and no such endpoint exists today. It is on the critical path for the
mobile app, but it is server work that depends on no mobile decision, so it can
ship independently and immediately.

## Scope

Sub-project 2a only. The sibling prerequisites — the minimum-supported-version
gate (2b) and UGC report/block (2c) — get their own specs. They share no code,
no data and no release with this one; only the fact that Apple requires all
three.

## Decisions

### Player history survives; the account does not

Inherited from the parent spec. Deleting an account removes the account and its
links, not the game record. This is clean because the two are already separate:
`players` and `lives` carry no `userId` — history is keyed by gamertag and
server — while accounts attach through `gamertag_links`.

Consequence: the dossier keeps its lives, deaths and obituaries, and loses only
its verified badge and avatar (both of which join through
`gamertagLinks` → `avatars` by `userId`).

### A freed gamertag may be re-claimed, and no special handling is added

A deleted account's gamertag becomes claimable again, and the next claimant
inherits the visible history of that gamertag.

This is deliberate and safe, because **claiming a gamertag requires in-game
emote verification** (`packages/verification`): a claimant must demonstrate
actual control of that gamertag inside DayZ. The gamertag is an Xbox identity
the platform does not own, so "whoever can prove they control it" is the correct
owner. The common case — the same person returning with a new account — works
without intervention, and a stranger cannot take over a record without taking
over the Xbox identity itself.

No tombstoning, no dossier-severing, no block on deletion.

### Other users' rows

Deleting an account reaches into data belonging to *other* users. Three foreign
keys to `user.id` lack a cascade, and two of them are other people's rows:

| FK | Cascade | Whose row | Resolution |
| --- | --- | --- | --- |
| `gamertagLinks.userId` (`schema.ts:276`) | none | the leaver's | delete explicitly |
| `tokenTransactions.counterpartyUserId` (`schema.ts:337`) | none, nullable | another user's ledger | `SET NULL` |
| `referrals.referrerUserId` (`schema.ts:346`) | none, NOT NULL | another user's referral record | delete the row |

**Why `referrals` rows are deleted rather than preserved.** `grantReferral`
(`packages/tokens/src/sweeps.ts`) awards one token **to the referrer** per
verified referee, once ever. The referee earns nothing from the row. So a
referral row whose referrer has left is worthless to the remaining user, and
deleting it costs them nothing.

**Why the token counterparty is nulled rather than deleted.** Those rows are the
*other* user's balance history. They must survive; only the attribution goes.
The column is already nullable, which suggests this case was anticipated.

**Accepted consequence:** deleting the referral row makes the referee eligible to
be claimed as a referee again, which could mint a fresh token for a new referrer.
It requires the referee to pass back through the invite-claim flow, so it is a
narrow vector rather than an open hole. Recorded because it is the kind of thing
that surfaces as a support ticket.

**Explicitly rejected:** anonymising the user row (blanking name, nulling email)
and leaving it in place so every FK stays intact. It preserves referential
integrity at the cost of retaining a row for someone who asked to be deleted,
which is precisely what the guideline exists to prevent.

## Approach

A custom `DELETE /me` route doing all the work in one transaction, rather than
Better Auth's built-in `deleteUser` with a `beforeDelete` hook.

**The deciding factor is atomicity.** `beforeDelete` runs *before* Better Auth
deletes the user, with no shared transaction. If the custom cleanup succeeds and
the user deletion then fails, the user's gamertag links and referral credits are
destroyed while their account survives — an unrecoverable partial delete.

The usual argument for the built-in path (it handles session revocation) does not
apply: `session.userId` and `account.userId` both cascade, so deleting the user
row already signs out every device and drops the OAuth links. The custom route
gives up nothing and gains atomicity.

## Server design

### `deleteAccount(db, userId)` in `packages/auth`

Business logic lives in the package, not the route — matching how `packages/tokens`
and `packages/verification` are structured, with thin Fastify routes over them.
`packages/auth` already owns user identity and already carries
`@onelife/test-support` plus a `test/` directory, so the DB-backed test lands in
an existing pattern.

Inside `db.transaction(async (tx) => …)`, the convention already used by
`tokens/transfer.ts` and `routes/gamertag-links.ts`:

1. Snapshot what is about to be destroyed (token balance, gamertag-link count) for
   the response
2. Delete `gamertag_links` for the user
3. Delete `referrals` where the user is the **referrer**
4. `SET NULL` on `token_transactions.counterparty_user_id` where it names the user
5. Delete the `user` row

Steps 2-4 must precede step 5 or the foreign keys reject it. All five are in one
transaction: a failure anywhere leaves the account fully intact.

Step 5 cascades to eight places: `session`, `account`, `avatars`, `notifications`,
`push_subscriptions`, `location_shares` (granter **and** grantee),
`token_transactions.userId`, and `referrals.userId`.

Two properties of that cascade that are easy to miss, and both correct as they
stand:

- `avatars.image` is `bytea` in Postgres, not a file on disk. The cascade destroys
  the image bytes; there is no orphaned blob left on a filesystem or CDN.
- `location_shares` cascades on both sides, so deleting a user revokes both the
  grants they made and the grants others made to them. No one is left sharing
  their position with a ghost.

### The route

`DELETE /me` in `apps/api` (client path `/api/me` — the API mounts read routes at
root). It takes **no subject parameter**, per the repo's house rule, so deleting
another user's account is unexpressible rather than merely rejected.

Body: `{ confirm: "DELETE" }`, enforced server-side as an **exact, case-sensitive
match on the literal string `DELETE`** — not a boolean, not a case-insensitive
comparison. Anything else is a 400. DELETE-with-body is the
established shape here (`unsubscribePush` uses it) and `apiSend` sets the
content-type, avoiding the `FST_ERR_CTP_EMPTY_JSON_BODY` trap this codebase has
already hit.

Response: `{ ok: true, tokensForfeited: N, gamertagLinksRemoved: N }`. The session
dies with the user row, so this is the last thing that connection returns.

**No pre-flight endpoint.** The UI already has `getTokens()` for the balance;
a `/me/deletion-preview` would be a second source of truth for the same number.

**Considered and declined:** an audit row recording that a deletion occurred. The
requirement is about removing the user's data, and "user X deleted their account
at T" is a record of the person who asked not to have one. If the metric is wanted
later, a bare counter with no user reference would serve.

## Client design

### A new `/settings` route

In the `(boxed)` layout, reachable from the hamburger menu. There is no account
page today — `AccountPanels` renders on the *home* page — and an irreversible
delete belongs nowhere near the front page. The route is small, and it gives the
mobile app a screen to mirror.

### The flow

A "Danger zone" section with a Delete account button opens a confirmation dialog,
reusing the existing `use-modal-behavior` / `avatar-dialog` pattern rather than
inventing one. The dialog states the consequences plainly:

- your lives, deaths and obituaries **stay** on the site
- your gamertag link is removed, and the dossier loses its verified badge and avatar
- **N unspent tokens are forfeited**
- every device is signed out

A typed `DELETE` enables the confirm button. On success, the client session is
cleared and the user is redirected home.

### ⚠️ The token count obeys the four-render rule

Loading, failed, empty and zero are four different renders — this repo's
most-repeated bug class, and here it has teeth. "0 tokens will be forfeited"
rendered because the *fetch failed*, when the user actually holds five, is a lie
that costs them real money at the moment they are least able to check it.

The dialog must not show a number until the balance resolves, and must say so
explicitly if it fails, rather than falling through to `0`. Blocking the confirm
button on that fetch is preferable to rendering a plausible wrong number.

### ⚠️ Forward constraint for the mobile app

When the mobile app lands, its delete screen must call this endpoint **natively**.
Satisfying guideline 5.1.1(v) by opening the web `/settings` page in an in-app
browser is a known rejection path: the deletion must be initiated in the app
itself.

## Testing

`packages/auth/test/delete-account.test.ts`, DB-backed in the style of
`packages/tokens`. The cascade is the thing under test, so a mocked database would
prove nothing.

The two load-bearing tests encode the product decisions and should be written
first:

1. **History survives.** Seed a user with a verified gamertag link, lives, deaths
   and an obituary; delete the account; assert `players`, `lives` and the obituary
   rows remain unchanged. This is the retention decision expressed as an
   assertion — if someone later adds a cascade during a tidy-up, it fails loudly.
2. **The other user's ledger survives.** Alice transfers a token to Bob; delete
   Alice; assert Bob's `token_transactions` row still exists with its delta intact
   and `counterparty_user_id` now NULL. Guards against deleting Bob's balance
   history as collateral.

Mechanical coverage: each of the eight cascading tables is empty for the user;
`gamertag_links` gone; referrer-side `referrals` rows gone; the returned summary
matches what was destroyed; deleting a non-existent user is a no-op that changes
nothing else.

**Atomicity** gets its own test: force a failure inside the transaction and assert
the user and all their rows survive. Without it, the argument for choosing this
approach over Better Auth's hook is untested.

**Route tests** in `apps/api`: 401 unauthenticated, 400 without
`confirm: "DELETE"`, 200 with the summary, and the session rejected afterwards.

**Web tests** (RTL): the dialog lists the consequences; confirm stays disabled
until `DELETE` is typed; and the four-render rule on the token count — loading
renders no number, a failed fetch renders an error rather than `0`, a real zero
renders as such.

### Not provable by the suite

Carried into the repo's outstanding-verification list:

- the confirmation dialog at 320px
- the dialog in PWA/standalone on a notched phone
- the full round trip against a real signed-in session: delete → signed out on
  every device → dossier still standing, unverified and avatar-less

### Operational note

These are DB-backed suites: they need `TEST_DATABASE_URL` and do not run in a bare
git worktree, which has no `.env` and no Postgres. CI's Postgres service is where
they actually execute.

## Sequencing

Nothing here blocks on any mobile decision. It can be built and shipped before,
during or after the app work.

Within the slice, the server piece (`deleteAccount` plus the route) is independent
of the `/settings` page and can land first.
