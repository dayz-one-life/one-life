# Friends — F3: presence notifications

**Date:** 2026-07-22
**Status:** Approved, not implemented
**Scope:** Sub-project F3 of three. F1 (friendships) shipped in v0.34.0. F2 (location sharing)
is unaffected by this work and remains open.

## 1. What this builds

A friend comes online; you get told. Both halves are consented, independently, by the two
people involved:

- **"Share my status"** — S lets O see that S is playing. **Effectively off by default**: the
  per-friend flag starts on, but it is gated by a per-user master switch that starts off, so no
  one is visible until they opt in (§3).
- **"Notify me"** — O wants to hear about S. On by default, so it functions as a per-friend
  mute rather than a second thing to discover.

A notification fires only when both are true. Nothing fires at deploy, because sharing is
off for everyone until someone deliberately turns it on.

## 2. The storm problem, and the cooldown

The `rebooter` restarts every active server on each even UTC hour, which closes every open
session; players rejoin within a minute or two. Naively notifying on every new session would
ping every player's friends twelve times a day, plus on every rage-quit-and-rejoin.

**`FRIEND_ONLINE_COOLDOWN_HOURS = 4`.** After notifying O about S, further "S is online"
notifications to O are suppressed for four hours. A reboot rejoin lands inside the window and
is silent; coming back the following evening is not.

The rejected alternative was a session-gap threshold ("only notify if they were offline for N
minutes first"). It is more semantically honest, but it depends on gap arithmetic that the
~90-second ingest/projector detection lag makes fuzzy, and it breaks when ingest falls behind.
The cooldown degrades gracefully if the reboot schedule ever changes.

## 3. Consent model

Four per-pair booleans plus one per-user master switch.

| Flag | Meaning | Default |
|---|---|---|
| `user_preferences.share_presence` | "I am visible to my friends at all" | `false` |
| `friendships.a_shares_presence` / `b_shares_presence` | "not individually hidden from this friend" | `true` |
| `friendships.a_notify_presence` / `b_notify_presence` | "tell me when this friend comes online" | `true` |

**Effective sharing from S to O = `S.share_presence AND S's per-pair share flag`.**
**A notification fires iff that, AND O's per-pair notify flag, AND the pair is `accepted`.**

Two levels look like one more than necessary, but they answer different questions and the
split is what makes the chosen default usable: with per-pair sharing alone, a user with twenty
friends must find and flip twenty switches before anyone can see them. The master switch is one
click to become visible to everyone, with individual exceptions still available.

**Why sharing is off and notifying is on** (this inverts the more common arrangement, and it is
deliberate): the switch that could annoy you defaults off, and the switch that merely makes the
feature *possible* defaults on. Being visible is a privacy decision and must be opted into. Being
pinged is an annoyance decision and can be opted out of. The net effect is that the feature is
inert until a user makes a deliberate choice, and the instant they do, it works for all their
friends without any coordination.

**Retroactivity is a non-issue under these defaults.** Existing F1 friendships get
`notify = true` and `shares = true`, but their owners' `share_presence` is `false`, so no
existing user becomes visible and no notification fires until someone opts in.

## 4. The trigger

A notification from subject **S** to observer **O** requires all of:

1. `S` and `O` are `accepted` friends (F1's `friendships`),
2. effective sharing from S to O (§3),
3. O's per-pair notify flag,
4. a **qualifying connect** by S,
5. no `friend_online` notification to O about S within `FRIEND_ONLINE_COOLDOWN_HOURS`.

### 4.1 Qualifying connect

A `sessions` row on an **active, slugged** server whose `connected_at` falls inside the
generator's window.

**Not gated on the life being qualified.** The survivors board, the enforcer and the newsdesk
all gate on `isLifeQualified`, and this deliberately does not: "my friend is playing" is true
whether or not their current life has earned a place on a leaderboard. Gating would silently skip
fresh spawns, which is exactly when people want to group up.

**Keyed on the connect transition, never on observing an open session.** A crashed session can
stay open until the next even-hour reboot closes it — the Standing Dead trigger exists because of
precisely that. Deriving presence from "a session is currently open" would let a ghost session
make a player appear to come online repeatedly. The connect is a point event; it fires once.

### 4.2 Content

> **Hartman is on Sakhal**
> `href` → `/players/hartman`

The server's display label comes from `mapLabel` (`@/components/player/format`), the same
codename→label mapping the dossier uses (`enoch` → "Livonia"). The gamertag is the subject's
verified gamertag, resolved at write time and frozen into the row, matching every existing
notification body — never `user.name`, which is an OAuth-provided real name in many cases.

## 5. Generation

A new generator, `apps/notifier/src/generators/presence.ts`, joining the seven existing ones.
Presence is background-observed — there is no user request to write it inline the way F1 writes
friend-request notifications — so the notifier worker is the only sensible home.

### 5.1 The natural key

```
friend_online:<observerUserId>:<subjectGamertag>:<connectedAt ISO>
```

**Deliberately not `sessions.id`.** `apps/projector/src/rebuild.ts` truncates `sessions`
`WITH RESTART IDENTITY` while `notifications` is never truncated, so session ids are reassigned
across a rebuild — the exact latent collision already flagged in a comment at the `notifications`
table for keys embedding `lives.id`. After a rebuild that shifts numbering, a legitimate connect
could collide with a stale key and silently produce no notification.

`(observer, gamertag, connected_at)` is rebuild-stable — the same convention F1 used to match an
article to a life, and the same one `bans` uses.

**The timestamp is produced by `toISOString()` in TypeScript, never by a SQL `to_char()`.** This
is the newsdesk rail: a `to_char()` that drifted from the JS format would make the dedupe a silent
no-op and re-notify forever.

### 5.2 The cooldown is a query, not a column

Before emitting, the generator checks for an existing `friend_online` notification to this
observer about this subject inside the window: a prefix match on
`friend_online:<observer>:<subject>:` plus a `created_at >= now - 4h` bound.

This reuses `notifications_natural_key_pattern_idx` — the `text_pattern_ops` index F1 added for
its rate limit — **including its `%`/`_`/`\` escaping**. F1 shipped a bug where an unescaped `_`
in a generated user id acted as a single-character wildcard and one user's rows counted against
another's; the same `escapeLikePattern` helper must be used here. Do not "simplify" the predicate
to `starts_with()`: it is not index-usable and will seq-scan a table growing across every other
notification kind.

Cooldown state lives in the durable notification rows rather than a counter column, for the same
reason F1's rate limit does: a column can desynchronise from reality (F1's original counter was
reset by a row deletion), while the rows are the thing we actually care about limiting.

### 5.3 Two independent bounds, both required

- **`windowStart(deps)`** — `max(NOTIFIER_SINCE, now - NOTIFIER_LOOKBACK_HOURS)`. Every generator
  must floor its query here; survival milestones shipped without it and would have fired every
  crossed threshold at go-live and re-derived them every tick forever.
- **`FRIEND_ONLINE_MAX_AGE_MINUTES = 15`** — skip any connect older than this even when it is
  inside the window. "Hartman came online" delivered six hours late is worse than silence; if the
  worker has been down, the honest behaviour is to drop the batch rather than deliver archaeology.

### 5.4 Delivery

Web Push, like every other kind. The push pass is kind-agnostic (`pushed_at IS NULL`) and needs no
change.

Volume is bounded by the cooldown at 6 per friend per day, so a user sharing with ten reciprocating
friends might see 10–20 pushes on a normal day and up to 60 in the worst case. The per-friend mute
is the escape hatch. **Quiet hours were considered and cut** — push is currently all-or-nothing per
user, so a noisy kind risks someone disabling push entirely and losing ban and token notifications
too. If volume proves painful, quiet hours is the follow-up, and it is a per-user window plus a
stored timezone plus a decision about every other kind — too much to carry here.

## 6. Data model

Migration `0020`:

```sql
CREATE TABLE user_preferences (
  user_id        text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  share_presence boolean NOT NULL DEFAULT false,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE friendships
  ADD COLUMN a_notify_presence boolean NOT NULL DEFAULT true,
  ADD COLUMN b_notify_presence boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE friendships
  ALTER COLUMN a_shares_presence SET DEFAULT true,
  ALTER COLUMN b_shares_presence SET DEFAULT true;
--> statement-breakpoint
UPDATE friendships SET a_shares_presence = true, b_shares_presence = true;
```

Hand-written SQL with a hand-appended `meta/_journal.json` entry, per the broken-snapshot-chain
rule — `drizzle-kit generate` diffs against a stale snapshot (the chain stops at
`0014_snapshot.json`) and emits wrong SQL.

`user_preferences` is **durable**: add it to `APP_TABLES` in
`packages/test-support/src/global-setup.ts`, and do **not** add it to `rebuild.ts`'s truncate list.

An absent `user_preferences` row means defaults — the row is created lazily on first write. Reads
must treat "no row" as `share_presence = false`, not as an error.

**`user_preferences` is deliberately a new table rather than a column on `user`.** The `user` table
belongs to Better Auth; app preferences do not belong in it. F2 needs a global location-sharing
switch and will add its column here rather than inventing a second mechanism.

**F1's "no second migration" claim was wrong for F3.** F1 shipped four dormant columns on the
premise that F2 and F3 would be surface-only. That holds for F2. It does not hold here, because
genuine two-sided control needs four per-pair flags and F1 shipped two.

## 7. Surfaces

**`/friends` Roster.** Each accepted-friend row gains two switches — "Share my status" and
"Notify me" — persisting immediately, announcing through the existing `SrStatus`. A failed patch
reports the failure and reverts the control; it must never silently appear to have worked.

**A master switch at the top of the Roster** — "Share my status with friends" — writing
`user_preferences.share_presence`. When off, the per-friend share switches are disabled with an
explanation rather than hidden, so the relationship between the two levels is visible rather than
mysterious.

**The dossier `FriendButton` is unchanged.** It is a relationship control ("are we friends"), not
a settings panel, and the hero already carries a stat band.

**The `FriendsPanel` is unchanged.** It is deliberately thin — counts and a link. A "3 friends
online" indicator would live there, but that is presence *display*, which is §9.

### 7.1 API

- `PATCH /me/friends/:id/presence` — `{ share?: boolean, notify?: boolean }`, session-gated,
  rejects a friendship the caller is not party to with the same `not_found` that F1's
  `cancel`/`remove` use (a non-party must not be able to distinguish "not yours" from "does not
  exist").
- `PATCH /me/preferences` — `{ sharePresence?: boolean }`, upserting the lazily-created row.
- `GET /me/friends` grows two fields per entry (the viewer-relative share and notify flags, already
  projected by `viewOf`) and one top-level `sharePresence`.

## 8. Testing

**Pure predicate first.** `shouldNotifyPresence({ status, masterShare, pairShare, pairNotify })`
is exhaustively unit-tested over its truth table, so the four-way AND cannot drift.

**Against Postgres:** the cooldown suppresses a second notification inside 4 hours and permits one
after; `windowStart` floors the query; a connect older than `FRIEND_ONLINE_MAX_AGE_MINUTES` is
skipped even inside the window; a non-friend, a declined pair, either flag off, and the master
switch off each produce nothing; and the `%`/`_` escaping cases from F1 are extended to this
generator's prefix.

**One regression test earns its place specifically:** the natural key must not embed `sessions.id`.
It must fail against a session-id-keyed implementation — that is the version a future contributor
will "simplify" to, and the collision only appears after a projection rebuild, long after the
change.

API tests cover the session gate and the non-party rejection. Web tests cover both row toggles, the
master switch, the disabled-when-master-off state, and that a failed patch reports rather than
silently reverting.

## 9. Out of scope for F3

- **Presence display** — "3 friends online" in the rail, a green dot on a dossier. This is
  notifications only.
- **Quiet hours** — cut deliberately (§5.4); revisit if push volume bites.
- **Per-server filtering** — "only tell me about Sakhal".
- **Offline notifications** — "your friend logged off".
- **F2 location sharing**, whose F1 prerequisite (a released gamertag link leaves an unreachable
  friendship row with its sharing flags intact) remains open and is unaffected by this work.

## 10. Rollout

Migration `0020` touches no projection table — plain `./deploy/deploy.sh`, **no `--rebuild`**. No
new env vars, no new worker, no systemd unit.

**F3 ships dark, behind two independent gates:**

1. **Operator:** the notifier's generate pass is off in production today (`NOTIFIER_SINCE` unset).
   Turning presence on means setting `NOTIFIER_SINCE` and `NOTIFIER_DRY_RUN=false`, which
   simultaneously un-dormants the other nine notification kinds — verified, tokens received and
   granted, bans applied and lifted, life qualified, survival milestone, obituary and birth notice.
   That is a bigger operational moment than F1's was, and it should be a deliberate one: set
   `NOTIFIER_SINCE` to the go-live instant, watch one dry-run interval first, then flip.
2. **User:** no individual is visible until they turn on the master switch.

Both gates are intentional. Neither can be removed without the other becoming misleading.
