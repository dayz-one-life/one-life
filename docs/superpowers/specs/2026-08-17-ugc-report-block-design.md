# UGC report and block — design

Date: 2026-08-17
Status: Approved (design). Implementation plan not yet written.

Parent: [`2026-08-17-native-mobile-app-design.md`](2026-08-17-native-mobile-app-design.md),
sub-project **2c** of its "Server prerequisites" slice.

## Goal

Let a signed-in user report an objectionable avatar and block another user, and
give the operator a way to review what was reported.

App Store guideline 1.2 makes this mandatory for any app displaying
user-generated content. It is the last remaining store blocker, and it is server
and web work that depends on no mobile decision, so it can ship immediately.

## Scope

Sub-project 2c only. Account deletion (2a) and the minimum-supported-version gate
(2b) have shipped. They share no code with this one; only the fact that Apple
requires all three.

### What counts as UGC here

**Uploaded avatar images, and nothing else.** This was established by reading the
product, and it is what makes the slice tractable:

- `players` and `lives` are projected from game telemetry, not authored.
- Obituaries are generated, not written by users.
- A gamertag is an Xbox identity proven by in-game emote verification
  (`packages/verification`), not free text someone can choose to be abusive.
- `user.name` exists but the public identity everywhere is the gamertag.

So the only bytes a user can put in front of another user are the avatar they
upload. `avatars.image` is already nullable with a documented "removal tombstone"
meaning, so the destructive half of takedown exists.

## Guideline 1.2's four requirements

| Requirement | How this design meets it |
| --- | --- |
| Filter objectionable material from being posted | ⚠️ **Not met proactively.** See "Accepted risk" below. |
| Report mechanism with timely response | Report action on the dossier; auto-hide makes the response immediate |
| Ability to block abusive users | Viewer-scoped `user_blocks` |
| Published contact information | ⚠️ Operator action, not code. See "Outstanding". |

### ⚠️ Accepted risk: no proactive image filter

Guideline 1.2 asks for "a method for filtering objectionable material from being
posted to the app" — proactive, not reactive. This design satisfies it only with
reporting plus terms of use.

Genuine proactive filtering means an image-classification service: a paid
dependency, a new failure mode on the upload path, and false positives rejecting
innocent avatars. Many apps pass review on reporting alone, and avatars are a
small surface.

**The decision is to ship without it and treat a rejection as the trigger to add
it.** This is a knowing acceptance of one possible rejection round, not an
oversight. Recorded here so that if a rejection cites 1.2, the response is to
implement the filter rather than to re-litigate the decision.

## Decisions

### Reports auto-hide immediately; review happens afterwards

The operator is a single person. A queue-based design makes the 24-hour
expectation a personal on-call obligation: a weekend away puts the app out of
compliance and leaves objectionable content visible.

Auto-hide inverts that. **The machine meets the deadline, not the human.** The
first report bans the image; review can then take as long as it takes without
anything objectionable staying up.

The cost is that a bad-faith report hides an innocent avatar until someone looks.
Three things bound it, and the first is the important one:

1. **Only users with a verified gamertag link may report.** Verification requires
   performing an emote in-game on a real Xbox identity, so a reporter cannot be a
   throwaway signup. Single-report auto-hide is *only* tolerable because of this
   gate.
2. Unique `(reporterUserId, subjectHash)` — one report per reporter per set of
   bytes. See "Takedown is by content hash, not by user": the report is keyed on
   the hash the reporter actually saw, not on whichever account holds it.
3. **A cap of 10 reports per reporter per rolling 24 hours**, counted from
   `avatar_reports.createdAt`; the 11th is a 429. The number is deliberately
   generous — it is a runaway-abuse backstop, not a usage limit, and a
   good-faith user should never meet it.

The realistic attack becomes "burn a verified identity to hide one small image
until the operator looks at it", which is an acceptable blast radius.

**Rejected: a threshold (N distinct reporters before hiding).** Harder to abuse,
but with a small user base N reports may never arrive, so it degrades into the
queue design and inherits the obligation this decision exists to avoid.

### Blocking is viewer-scoped and covers avatars plus location shares

Blocking someone hides their avatar **from you** and stops location shares in
both directions. It does not touch token transfers: receiving a token is not a
harassment vector, and the token ledger carries money semantics and an
idempotency contract that this feature has no reason to disturb.

**Blocking is not symmetric and not notified.** The blocked user is told nothing —
a block that notifies is a block that invites retaliation.

⚠️ **Blocking is viewer-scoped; banning is global.** Confusing the two in either
direction is the most likely bug in this slice, and one direction is dangerous: a
block that 404s an avatar globally hands every user a unilateral takedown button.

### Takedown is by content hash, not by user

This is the design's central finding, and it came from reading how avatars serve
rather than from the requirement.

`GET /avatars/:hash.webp` is content-addressed, and `getAvatarByHash`
(`apps/api/src/lib/avatar-store.ts:51`) matches on `hash` across **all** users,
returning the first row with a non-null image:

```ts
.where(and(eq(avatars.hash, hash), isNotNull(avatars.image)));
```

So tombstoning one user's row does **not** stop the bytes serving if any other
user holds the same image. That URL keeps working.

This is not hypothetical. Coordinated abuse means the same image uploaded from two
accounts — precisely the case a takedown must handle. Auto-populated provider
avatars mean two Discord users can legitimately share default bytes too.

**Therefore takedown bans the bytes, in a hash-keyed table.** One row stops the
image serving for every user who holds it, which mirrors the fact that serving is
already content-addressed.

**Rejected: a `hidden` column on `avatars`.** It cannot express "these bytes are
banned" when two users share them — exactly the case that leaks.

### The client-facing API speaks public identifiers only

**This is the design's second finding, and it forced a re-key of both reports and
blocks after the first pass.** The player dossier deliberately publishes no user
id — the public identity everywhere is the gamertag — and giving the report or
block dialog a `userId` to send would mean putting one on the page for the client
to read, which makes accounts enumerable. The original `subjectUserId`/`userId`
shapes below were, in that sense, uncallable from any client that respects the
dossier's own privacy boundary. That is why both were re-keyed onto identifiers
the client already has:

- **A report names the hash, not the subject.** `POST /me/reports/avatar` takes
  `{ subjectHash, reason }`. This also matches "Takedown is by content hash, not
  by user" above: what actually gets banned is the bytes, and several accounts can
  hold identical bytes, so "the subject user" is ambiguous exactly when a report
  needs to be unambiguous. `subjectUserId` still exists on `avatar_reports`, but
  only as nullable moderator-context — resolved from whichever account currently
  holds the hash, at write time, for the queue to show a name. It keys nothing;
  the unique constraint and every ban check are on `subjectHash`.
- **A block names the gamertag, not the user id.** `POST /me/blocks {gamertag}`,
  `DELETE /me/blocks/:gamertag`, and `GET /me/blocks` returns
  `{gamertag, createdAt}[]`. The `user_blocks` table still stores
  `blockerUserId`/`blockedUserId` internally — enforcement is still a real FK
  relationship — but nothing about that internal shape is exposed to the client.
- **Keying reports on the hash deletes the swap-window attack entirely**, rather
  than merely detecting it. The original design snapshotted `subjectHash` at
  report time so a later swap couldn't be laundered through an old report; that
  snapshot-and-compare logic, and the `hash_mismatch` rejection it implied, is now
  unnecessary. A reporter can only ever name bytes they actually saw — there is no
  `subjectUserId` in the request for a swapped hash to disagree with, so there is
  nothing to detect.

### ⚠️ Cached copies are out of reach, and that is accepted

Avatar responses set `cache-control: public, max-age=31536000, immutable`. Banning
a hash stops the origin serving it and removes it from every page rendered
afterwards. It does **not** reach bytes already in someone's browser cache, which
under `immutable` may persist for up to a year.

Accepted. It is true of every image on the web, and the person holding a cached
copy is the person who already saw it. "Removed within 24 hours" is therefore an
honest claim about the product, not about every copy in existence.

If this ever needs closing, the lever is dropping the avatar `max-age` to a day at
some bandwidth cost. Not done now.

### Moderator identity comes from an env var

`MODERATOR_USER_IDS`, comma-separated, parsed in `apps/api/src/config.ts`
alongside `VAPID_*`, `STRIPE_*` and `*_MIN_APP_VERSION`.

**Empty means nobody, and every moderation route 403s.** Same fail-safe direction
as the version gate: the failure mode of a typo is "moderation is unavailable",
never "a stranger can delete avatars".

**Rejected: a `role` column on `user`.** There is no one to grant roles to and no
UI to grant them with, so it is a migration plus hand-written SQL for the same
result — with a privilege-escalation path an env var does not have.

**Rejected: Better Auth's `admin` plugin.** It supplies `role` and account-level
`banned` (which blocks sign-in), but 1.2's "block abusive users" is viewer-scoped,
so `user_blocks` would still be hand-rolled. Adopting it migrates four columns
onto `user` and switches on endpoints nobody asked for — `listUsers`,
`impersonateUser`, `setRole` — each live attack surface guarding a product with
one moderator.

## Data model

### `avatar_reports`

| Column | Notes |
| --- | --- |
| `id` | bigserial PK |
| `reporterUserId` | → `user.id`, **ON DELETE CASCADE** |
| `subjectUserId` | → `user.id`, **ON DELETE CASCADE**, nullable — moderator context, not the key |
| `subjectHash` | text, **the key** — the hash the reporter named |
| `reason` | text, from a fixed list |
| `createdAt` | timestamptz |

Unique `(reporterUserId, subjectHash)`.

**`subjectHash` is the key, not a snapshot of something else.** See "The
client-facing API speaks public identifiers only": the client never has a
`subjectUserId` to send, only the hash it can see on the page, so the report is
`{ subjectHash, reason }` from the wire up. `subjectUserId` is resolved
server-side — from whichever account currently holds the hash, at write time —
purely so the moderator queue can show a name; it carries no uniqueness and no
ban logic, and it is NULL if no account holds the hash by the time the report is
written.

`reason` comes from a **fixed list, not free text**. A free-text field is itself a
UGC surface — adding one to the moderation feature would be self-defeating.

The list, validated server-side as an exact enum (anything else is a 400):

| Value | Shown as |
| --- | --- |
| `sexual` | Sexual or nudity |
| `violent` | Violent or graphic |
| `hate` | Hateful or harassing |
| `illegal` | Illegal content |
| `impersonation` | Impersonation |
| `other` | Something else |

`other` exists so a reporter is never blocked by a category that does not fit;
the moderator sees the image regardless, which is what the decision is actually
made on.

### `blocked_avatar_hashes`

| Column | Notes |
| --- | --- |
| `hash` | text PK |
| `state` | `auto` (report-triggered) \| `confirmed` (moderator takedown) \| `allowed` (moderator restore) |
| `blockedAt` | timestamptz |
| `blockedByUserId` | nullable — NULL means automatic |

⚠️ **No foreign key to `user`.** A ban must survive the uploader deleting their
account; otherwise account deletion becomes a way to un-ban your own image.

⚠️ **Restore writes `allowed`; it does not delete the row.** A second account
holding the same bytes could otherwise re-report and silently re-hide an image a
human already cleared. The ban predicate every reader shares —
`avatarHashNotBanned` — excludes only `allowed`, so `auto` and `confirmed` both
still block serving; `allowed` is a durable record that a human looked and said
no, not an absence of a row.

### `user_blocks`

| Column | Notes |
| --- | --- |
| `blockerUserId` | → `user.id`, **ON DELETE CASCADE** |
| `blockedUserId` | → `user.id`, **ON DELETE CASCADE** |
| `createdAt` | timestamptz |

Composite PK `(blockerUserId, blockedUserId)`.

### ⚠️ Every new FK to `user.id` must cascade

Account deletion is live code (2a). `deleteAccount` explicitly deletes the rows
whose FKs do not cascade, and a new non-cascading reference to `user.id` makes
deletion raise `23503` for anyone who has ever reported or blocked.

This is not a theoretical concern: 2a shipped a version where deletion could never
succeed for a verified user, because `verification_challenges.gamertag_link_id` is
NOT NULL with NO ACTION and nothing ever deleted those rows. It was found only by
running the deletion against a real database.

With the cascades above, `deleteAccount` needs **no change**. A test asserts that
directly rather than trusting the schema to be read correctly twice.

## Server design

### Serving

`getAvatarByHash` gains one condition — the hash must not appear in
`blocked_avatar_hashes`. That single change is the whole global takedown.

Block filtering is separate and viewer-scoped: the caller's blocked set is applied
where avatars are resolved for display and where location shares are granted and
read.

### Routes

Reporting and blocking hang off `/me` and take the actor from the session, so
acting on another user's behalf is unexpressible rather than merely rejected —
the repo's house rule, and the same shape as `DELETE /me`.

| Route | Notes |
| --- | --- |
| `POST /me/reports/avatar` | `{ subjectHash, reason }` → 201; bans the named hash |
| `GET /me/blocks` | the caller's blocked players, `{gamertag, createdAt}[]` |
| `POST /me/blocks` | `{ gamertag }` |
| `DELETE /me/blocks/:gamertag` | |
| `GET /moderation/queue` | behind `requireModerator` |
| `POST /moderation/hashes/:hash/restore` | writes state `allowed`; does not delete the row |
| `POST /moderation/hashes/:hash/confirm` | keeps the ban, NULLs `image` for every row with that hash |

Paths are as registered in `apps/api`; the client calls them under `/api/…`
(`/api/me/blocks`, `/api/moderation/queue`), matching how `DELETE /me` is reached
as `/api/me`. `toBackendPath` in `@onelife/api-client` already does that mapping.

`requireModerator` sits beside `getSession` in `auth-plugin.ts`.

`GET /me` gains an `isModerator` flag so the shell knows whether to render the
link. It is display-only; every moderation route re-checks server-side.

**Restore is cheap and reversible; Confirm is destructive and only a human does
it.** Auto-hide stops the bytes serving; confirmation destroys them via the
existing tombstone. "Reversible" here means the `allowed` row above, not a
deletion — see `blocked_avatar_hashes`.

### Two failure modes designed for up front

- **Reporting a subject with no avatar is a 409**, not a silent success. There is
  nothing to snapshot, and pretending otherwise creates a report that can never be
  reviewed.
- **A report against an already-banned hash is idempotent**: it records the report
  but does not re-ban, so the moderator sees accumulated reports rather than
  duplicate queue entries.

## Client design

### Reporting and blocking

Both live in a quiet menu on the dossier beside the avatar — discoverable when
wanted, not an invitation. Each opens a confirmation dialog reusing
`use-modal-behavior`, the pattern 2a adopted after review caught a false
`aria-modal` with no focus trap.

⚠️ **The confirmation copy must say the avatar is hidden immediately, pending
review.** Not "thanks, we'll look into it" — the standard lie of report flows, and
here it is actually false, because the machine really did act. Telling the truth
also sets the expectation that a bad report gets reversed.

The block dialog names both effects: you stop seeing their avatar, and location
sharing stops in both directions.

### `/settings` gains a blocked-users list

With unblock. `/settings` was created by 2a and is the natural home for
account-scoped controls.

### `/moderation`

Banned hashes newest-first: the image, accumulated reasons and report count, and
Restore / Confirm.

⚠️ **Images are click-to-reveal, not rendered inline.** This queue is by
construction a list of things someone reported as objectionable; opening the page
must not ambush the moderator with a wall of it. It costs one click and it is the
difference between a tool that gets opened and one that gets avoided.

⚠️ **`confirmed` entries stay in the queue response and render as already-removed,
with no actions offered.** The server only excludes `allowed` rows (see
`avatarHashNotBanned`), so a `confirmed` row — one whose bytes a moderator already
destroyed — keeps appearing rather than vanishing from the list. Offering Show
image / Restore / Confirm on it would mislead: Show image 404s, and Restore would
report success while restoring nothing, because there are no bytes left to serve.
The client renders these rows visibly muted, with none of the three actions
available, so a moderator scanning the queue can tell at a glance which rows
still need judgment and which are already settled.

### The four-render rule

All three lists render loading, failed, empty and populated as four distinct
states.

**Empty is the dangerous one here.** "No reports" and "the queue failed to load"
must not look alike, or a broken queue reads as a clean one and nothing gets
reviewed for days. Same bug class as 2a's token count, same shape of consequence.

### ⚠️ Forward constraint for the mobile app

Report and block must be reachable **natively in the app**. Satisfying 1.2 by
linking out to the website — or opening it in an in-app browser — is a known
rejection path, exactly as it is for account deletion. These web screens are the
reference implementation the app mirrors, not a substitute for it.

## Testing

DB-backed in the style of `packages/tokens` and `packages/auth`: the hash
semantics are the thing under test, so a mocked database would prove nothing.

The load-bearing tests encode the decisions and should be written first:

1. **Shared bytes.** Seed two users holding the *same* image; ban the hash; assert
   the URL 404s for **both**. If someone later "simplifies" this to a per-user
   hidden flag, this fails loudly and explains why.
2. **Block is viewer-scoped; ban is global.** Blocking hides the avatar from the
   blocker and leaves it serving normally for third parties.
3. **Account deletion still works.** Delete a user who has reported and been
   reported, and who has blocked and been blocked; assert no `23503` and that
   `blocked_avatar_hashes` rows survive.

Mechanical coverage: auto-hide on first report; Restore serves again; Confirm
NULLs `image` for every row sharing the hash; unverified reporters rejected;
duplicate reports do not double-queue; reporting a subject with no avatar is 409;
a report against an already-banned hash is idempotent; location shares filtered
both directions; moderation routes 403 for signed-out users, signed-in
non-moderators, and — critically — **for everyone when `MODERATOR_USER_IDS` is
empty**.

Web tests (RTL): the four-render rule on all three lists; the dialog stating that
hiding is immediate; click-to-reveal not rendering images until asked.

### Not provable by the suite

Carried into `CLAUDE.md` beside the entries 2a added:

- the moderation page and both dialogs at 320px
- the full round trip against real data: report → the avatar vanishes site-wide →
  restore → it returns

## Outstanding — operator actions, not code

1. **Publish contact information** for content complaints. Legal pages exist
   (`2026-07-29-legal-pages-design.md`); the address is the operator's to choose.
2. **Set `MODERATOR_USER_IDS`** at deploy. Until it is set, moderation is
   unavailable to everyone — by design, but it means an unset value ships a
   product where reports auto-hide and nothing can be restored.
3. **Read the queue.** Auto-hide means the machine meets the 24 hours, so the
   review can lag without objectionable content staying up. But if the queue goes
   unread for weeks, innocent avatars stay hidden, and no test will say so.

## Sequencing

Nothing here blocks on a mobile decision.

Within the slice: the server half (tables, hash-ban semantics, routes) is
independently shippable and carries all the risk. The report/block surfaces and
`/moderation` are conventional and follow.
