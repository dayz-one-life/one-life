# Sub-project E — Session location sharing

**Date:** 2026-07-25
**Status:** proposed
**Parent:** `2026-07-24-pure-player-app-decomposition.md` (§E)
**Depends on:** D (shipped — #270/#271/#273)
**Replaces:** F2's consent model, wholesale
**Blocks:** nothing

---

## 1. What this is

Sharing your position stops being a **standing setting** and becomes a **session-scoped grant**.

Today: two master switches (`user_preferences.share_location`, default off) AND four per-pair
flags (`friendships.a_/b_shares_location`, default true), and once on, they stay on forever. You
tell the site "my friends may see me" and it is true next week, next month, and the night you are
hiding in a treeline with a full bag.

After E: you are on a server, you see who else is on it, and you hand a specific person your
position **for this session**. When your session ends, the grant is dead. Not expired-later, not
revoked-by-a-worker — dead, because the thing it was scoped to is gone.

**This is a privacy tightening disguised as a feature.** Every existing coordinate rail is kept
(§6); what changes is that the window is minutes long and opened deliberately.

---

## 2. Why the current model is wrong

DayZ has one fact that makes standing location consent dangerous: **where you log out is where
your stash is.** F2 already reasoned about this — it is why the dot vanishes on disconnect and why
there is no expiry window. But it left the *consent* standing while making the *data* transient,
which is backwards. A friend you shared with in April can watch you in July.

The per-pair flags default to **`true`**, so the only thing standing between a friendship and a
position is one master switch the user flipped once. And the master switch is the least
informative control possible: it says "everyone or no-one", forever.

⚠️ **This is not a criticism of F2's guards, which are good and are all retained.** It is a
criticism of the *duration*.

---

## 3. The model

### 3.1 Effective share

A grantee may see a granter's dot when **all** hold:

1. A `location_shares` row exists for (granter → grantee).
2. The granter is **online** on the server being viewed.
3. The grant was made **during the granter's current game session**.

Clause 3 is what makes it self-expiring: no cleanup worker, no TTL, no cron, no `expires_at` to
get wrong. A session ending is not an event we need to observe — the predicate simply stops
matching.

### 3.2 ⚠️ Clause 3 is a stored TIMESTAMP, and not the one the parent spec named

The parent spec says `granted_at ≥ the granter's current session's connected_at`. **This spec
stores the session's `connected_at` on the row instead and compares it for equality.**

```
location_shares.granter_session_connected_at  ==  <granter's current open session>.connected_at
```

Both readings key on a timestamp rather than a session id, which is the property that matters:
`rebuild.ts` truncates `sessions` `WITH RESTART IDENTITY`, so session ids are reassigned across a
projection rebuild and an id-keyed share could be silently resurrected against an unrelated
session. A timestamp folded from the same ADM line is rebuild-stable.

The equality form is chosen over the inequality for one reason:

⚠️ **`granted_at` and `connected_at` come from different clocks.** `granted_at` would be the API
server's wall clock; `connected_at` is an ADM-log timestamp with `servers.clock_offset_ms`
applied. `CLAUDE.md` already records that this offset leaves a real `lastSeenAt` landing *seconds
ahead of* request-time `now`. So a grant made in the first seconds of a session can have
`granted_at < connected_at`, and the inequality silently never matches — a share that the UI says
is active and that never works. It fails closed, which is safe, but "safe and inexplicable" is its
own kind of bug.

Snapshotting removes the comparison between clocks entirely: both sides of the equality are the
same ADM-derived value.

⚠️ **The snapshot must come from the SERVER the grant is being made on.** A player online on two
servers has two open sessions; a grant is scoped to one of them.

### 3.3 Grants are per-person, from the online list

Granting happens on `/maps/[map]`, from the online list — **friends and strangers alike**. A
friendship is not a prerequisite, which is the point: the people you want to find you are the
people you are playing with right now, and this model stops needing to know whether you are
"friends".

A **share-with-all** shortcut grants to everyone online **at that instant**. ⚠️ It is a *snapshot,
not a standing rule*: someone who joins the server a minute later gets nothing. That keeps the
model to exactly one concept — a grant to a named person — and it fails closed for late joiners,
which is the direction a privacy default must fail.

### 3.4 Revocation

A permanent chip on the map: **"N can see you · Stop"**. Stop deletes every row for that granter
on that server. Every session starts with the chip at zero, because every session starts with no
effective shares.

---

## 4. Schema

New table `location_shares`:

| column | note |
|---|---|
| `granter_user_id` | FK `user`, cascade |
| `grantee_user_id` | FK `user`, cascade |
| `server_id` | FK `servers` — a grant is scoped to the session, and a session is per-server |
| `granter_session_connected_at` | the snapshot (§3.2) |
| `created_at` | audit only; never read by the predicate |

Unique on `(granter_user_id, grantee_user_id, server_id)` — re-granting in a later session
**updates** the snapshot rather than accumulating rows.

⚠️ **`location_shares` is DURABLE, not a projection.** It must NOT appear in
`rebuild.ts`'s truncate list. Rows are self-invalidating via §3.2, so a rebuild leaves stale rows
that simply never match again — harmless, and far better than the alternative failure.

**Dropped outright, not left dormant:**

- `friendships.a_shares_location`, `friendships.b_shares_location`
- `user_preferences.share_location`
- `shouldShareLocation` (`packages/friends/src/location.ts`)

⚠️ **Dropping columns is irreversible in a way the F1/F3 flag work was not.** Two migrations were
written on the assumption these columns would stay (`0018` created them dormant, `0022` flipped
their defaults and backfilled). Dropping them discards every existing consent decision — which is
the *intent*: consent under the old model does not transfer to the new one, and silently carrying
it over would be the worst possible reading of "replaces F2's consent model wholesale."

`user_preferences.share_presence` and the four `*_presence` / `*_notify_presence` flags **stay** —
F3's presence feature is untouched.

---

## 5. Notification kind 13

`location_shared`, written **inline in the API request**, in the same transaction as the grant —
like the friend notifications, and unlike the eleven worker-generated kinds. It is therefore
**live on deploy** and not gated behind `NOTIFIER_SINCE` / `NOTIFIER_DRY_RUN`. The notifier's push
pass delivers it unchanged (it selects on `pushed_at IS NULL` and does not care who inserted).

Natural key:

```
location_shared:<granteeUserId>:<granterGamertag>:<granterSessionConnectedAt ISO>
```

One per granter, per grantee, per game session. ⚠️ The trailing component is the **same snapshot**
the predicate uses, so re-granting within one session is idempotent (`onConflictDoNothing`) while
a grant in a *later* session correctly notifies again.

⚠️ `notifications.natural_key` is a **plain GLOBAL** unique index, so `onConflictDoNothing` takes
**no `targetWhere`** — the F1 rule, unchanged.

---

## 6. Every coordinate rail is retained

None of these move, weaken, or gain a parameter. They are listed so a reviewer can check each one
against the diff:

1. **One egress route per audience, with NO subject parameter.** `GET /me/maps/:mapSlug` computes
   its subject set from the session alone; naming another player is *unexpressible*, not merely
   rejected. Same for `GET /me/lives/:mapSlug/:n/track`.
2. **`cache-control: no-store, private`** on both.
3. **Last known position only, never a trail.** A trail shows direction, pace and habitual
   locations — an interception tool.
4. **The dot vanishes on disconnect**, and a fix older than `MARKER_MAX_AGE_SECONDS` (900) is
   absent rather than shown somewhere the player no longer is.
5. **The verified-link INNER JOIN**, so a released gamertag link means no coordinates,
   unconditionally.
6. **The reciprocity line stays ONE collapsed boolean.** `theyShareLocation` cannot distinguish
   "not sharing at all" from "not sharing with you" — differentiating would make hiding from one
   person a visible act.

⚠️ `verifyLink` (`apps/verifier/src/pg-store.ts`) currently resets `share_location` and
`share_presence` on re-verification. The `share_location` half goes away with the column; **the
`share_presence` reset must stay.** And a new equivalent is needed: **re-verifying must delete the
user's `location_shares` rows**, for the same reason — a re-verified link is a new claim on that
identity, and it must not inherit outbound sharing.

---

## 7. Friends loses sharing entirely

`/friends` becomes presence + roster only. The per-friend location toggles and the master location
switch are deleted from the UI along with their columns.

A friend row links to the server they are on (or last played). ⚠️ **The label must promise a
person only when they are actually sharing** — a link that reads as "find them here" when no grant
exists is the same class of lie as an empty map standing in for "nobody is here."

---

## 8. Out of scope

- **`/tokens`, referrals** (F, G).
- **Presence** — F3 is untouched; its switches keep governing notifications only.
- Any change to how positions are *recorded* (`positions` is written by the fold, unchanged).

---

## 9. Testing

**Mutation-test these four** — each must be proven red against a wrong implementation:

1. Dropping clause 3 entirely (a share outlives its session).
2. Comparing against the *wrong server's* session for a player online on two servers.
3. A rebuild-style `sessions` truncate + re-fold leaving a share effective (it must not, and this
   is the test that would have caught a session-id key).
4. Re-verification leaving `location_shares` rows behind.

**Also cover:** share-with-all granting only to the snapshot set (a late joiner sees nothing); the
notification natural key deduping within a session and firing again in the next; and the chip
counting only *effective* shares, not rows.

**Browser:** the online list's grant controls and the chip, at desktop and 500px. ⚠️ Below ~500px
still needs a real handset.

---

## 10. Deploy

**Migration required** — creates `location_shares`, drops three columns. It touches no projection
table, so **plain `./deploy/deploy.sh`, no `--rebuild`.**

⚠️ **The drop is destructive and unreversible by redeploy.** Existing location consent is
discarded by design (§4). The `pg_dump` backup `deploy.sh` takes first is the only way back.

**No operator gate.** Unlike F3, nothing here is behind `NOTIFIER_SINCE` — the grant routes and
the inline notification are live the moment it deploys. It is nonetheless **inert until used**:
with no rows in `location_shares`, nobody sees anybody.
