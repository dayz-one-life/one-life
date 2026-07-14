# One Gamertag Per User — Design

**Date:** 2026-07-14
**Branch:** `feature/one-gamertag-per-user`
**Status:** Approved design → implementation

## Problem

Today a single authenticated user can claim and verify **multiple different
gamertags**. The `gamertag_links` table constrains:

- `gamertag_links_user_gamertag_uniq` — a user cannot hold duplicate rows for the
  *same* gamertag.
- `gamertag_links_verified_uniq` — a given gamertag can be `verified` by at most
  *one* user.

Neither prevents one user from holding many *different* gamertag links. We want a
user to own **exactly one** gamertag identity.

## The rule

A user may hold **at most one _active_ gamertag link**, where:

- **Active** = `status ∈ {pending, verified}`.
- `cancelled` is terminal and **frees the slot** — the user may claim a different
  gamertag afterward.
- A `verified` link is **permanent**: the user cannot self-release it. Freeing a
  verified link is an **admin-only** action performed by editing the DB directly
  (set `status = 'cancelled'`). Building a self-serve admin path is **out of scope**.

Consequences:

- While a claim is `pending`, the user may cancel it (existing `DELETE` endpoint)
  and then claim a different gamertag.
- To claim a *different* gamertag while one is already active, the user must first
  cancel the current `pending` link. A `verified` link cannot be freed this way.

**Data assumption (greenfield):** no production user currently holds more than one
active link, so the new constraint is added cleanly with **no reconciliation
migration**.

## Approach — defense in depth

Enforce the invariant at three layers. The DB index is the source of truth; the API
and UI layers make it a good experience.

### 1. Database — migration `0007`

Add a partial unique index enforcing one active link per user:

```sql
CREATE UNIQUE INDEX gamertag_links_user_active_uniq
  ON gamertag_links (user_id)
  WHERE status IN ('pending', 'verified');
```

Keep `gamertag_links_user_gamertag_uniq` and `gamertag_links_verified_uniq`
unchanged. Add the matching index to the Drizzle schema in
`packages/db/src/schema.ts`.

**Interaction with existing flows (verified safe):**

- The `POST` upsert path flips a previously `cancelled`/`pending` row for the *same*
  gamertag back to `pending` — still one active row, no violation.
- The verifier flips the single `pending` link to `verified` — still the only active
  row, no violation.

### 2. API — `POST /me/gamertag-links`

Add an **active-link guard** after the existing checks, in this order:

1. Player-exists check → `422 gamertag_not_seen` (unchanged).
2. Already-verified-by-anyone check → `409 already_verified` (unchanged; also covers
   the caller re-claiming their own already-verified gamertag).
3. **New:** load the caller's active link (`status IN {pending, verified}`).
   - **None** → proceed with the existing upsert + challenge flow.
   - **Same gamertag & `pending`** → idempotent challenge re-issue (unchanged
     behavior; the guard only blocks a *different* gamertag).
   - **Different gamertag** (`pending` or `verified`) → reject:

     ```json
     409 { "error": "active_link_exists", "current": { "gamertag": "...", "status": "pending|verified" } }
     ```

The DB index (layer 1) is the backstop if two concurrent requests race past the
guard — one insert wins, the other fails on the unique index.

### 3. Web UI

- **Account page (`apps/web/src/app/account/page.tsx`):** only render the
  "Claim a gamertag →" link when the user has **no** active link.
- **Claim page (`apps/web/src/app/account/claim/page.tsx`):** if an active link
  already exists, show it (status/challenge) instead of the claim form. Map the new
  `active_link_exists` 409 to a clear message
  (e.g. "You already have an active gamertag: X.").

## Testing

**API (`apps/api/test/gamertag-links.test.ts`):**

- User with a `pending` link on A cannot claim B → `409 active_link_exists` with
  `current.gamertag === "A"`.
- Re-claiming A while pending on A is idempotent (same link, challenge reused).
- Cancel A, then claim B → succeeds.
- User with a `verified` link cannot claim another gamertag → `409
  active_link_exists` with `current.status === "verified"`.
- Backstop: a direct second active insert for the same user violates
  `gamertag_links_user_active_uniq`.

**Web:** claim/account gating — form hidden and existing link shown when an active
link exists; error message mapping for `active_link_exists`.

## Out of scope

- Self-serve admin release of a verified link (manual DB edit only).
- Reconciliation of pre-existing multi-active users (none exist — greenfield).

## Deploy note

The index adds cleanly on greenfield data. If production ever contained a user with
two active links, `CREATE UNIQUE INDEX` would fail; per the greenfield assumption
that does not occur, but any future backfill must reconcile duplicates (keep the
earliest active, cancel the rest) before the index can be created.
