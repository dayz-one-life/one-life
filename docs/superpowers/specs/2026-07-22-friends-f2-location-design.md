# Friends — F2: location sharing

**Date:** 2026-07-22
**Status:** Approved, not implemented
**Scope:** Sub-project F2 of three, completing the friends feature. F1 (friendships) shipped in
v0.34.0; F3 (presence notifications) shipped in v0.36.0.

## 1. What this builds

A live map, one per server, showing your own position plus every friend who is currently
sharing their location with you. Consent is two-level and opt-in: a per-user master switch
that starts **off**, and a per-friend flag that starts **on** meaning "not individually
hidden".

This is the feature that finally uses the four `*_shares_location` columns F1 shipped dormant.

## 2. What a friend sees, and when

**Last known position only — one point, with its own age.** Not a route trail.

A trail is an interception tool: it shows direction, pace, and the places someone keeps
returning to. A single point that may be a few minutes stale is enough to say "come join me"
or "avoid the coast tonight" and useless for an ambush. Trail-sharing, if ever wanted, deserves
its own switch rather than riding on this one.

**Visible only while the subject is online.** The moment they disconnect, their dot disappears
and the surface says *offline* rather than showing a stale point.

This is the single most important rule in the design. In DayZ, **where you log out is where
your camp, stash, or hiding spot is** — more sensitive than where you are mid-run. A
"last known position" that survives disconnect quietly publishes exactly that to everyone you
have ever shared with, and the most valuable point to an attacker is precisely the final one.
An expiry window (visible for N minutes after logout) is the worst of both: it exposes the
stash during the exact window in which someone watching would act.

**A position older than `POSITION_MAX_AGE_MINUTES = 15` is treated as absent**, even while the
subject is online. ADM position logging is periodic, so a player can be connected while their
last recorded point is half an hour old; rendering it would show them somewhere they no longer
are. This is the live-data-honesty rule applied to a map — absent rather than confidently wrong.

## 3. Consent model

Migration `0022` mirrors F3's shape exactly, so both features have one pattern.

| Flag | Meaning | Default |
|---|---|---|
| `user_preferences.share_location` | "my location is visible to friends at all" | `false` |
| `friendships.a_shares_location` / `b_shares_location` | "not individually hidden from this friend" | `true` |

**Effective sharing from S to O = `S.share_location AND S's per-pair flag toward O`.**

The per-pair flags shipped in F1 at `default false`; `0022` flips them to `true` and backfills
existing rows. That changes nobody's visibility, because every user's master switch is `false`
and the master gates everything — the same reasoning, and the same safety argument, as `0020`.

**Location gets its own master switch, separate from presence.** They are different sensitivity
classes: "I'm online" is a social signal; "I'm at these coordinates" is tactical. A single
switch would force someone to accept the second to get the first.

**Sharing is independent per direction, not reciprocal.** You can see a friend without sharing
back. Reciprocity was considered — it kills the "lurker" who accumulates a live map while
staying invisible — but it collapses two decisions into one and removes legitimate one-way
cases. Instead, the asymmetry is made **visible** (§5.3) rather than prevented.

## 4. Resolving the F1 prerequisite

F1 left a known hole, flagged in `packages/friends/src/queries.ts` and recorded as invariant 10
in CLAUDE.md: when a verified gamertag link is released, the friendship row survives with its
sharing flags intact and becomes unreachable in the UI — so if that user verifies again, consent
silently resurrects, possibly attached to a **different** gamertag than the one their friends
agreed to share with.

It was inert while nothing wrote those columns. F2 is the release that makes it live, so it is
fixed here, two ways:

1. **Structural.** The map query inner-joins `verified` `gamertag_links`. No verified link means
   no coordinates, unconditionally — the same join that incidentally closed the presence half of
   this problem in F3.
2. **Explicit.** **Verifying a gamertag link resets that user's `share_location` and
   `share_presence` master switches to `false`.** If your verified identity changes, your consent
   starts over. One rule, one place, and it makes re-verification a deliberate re-opt-in rather
   than a silent resurrection.

   This fires on **every** verification, not only a re-verification. For a first-time verifier it
   is a no-op — they have no preferences row, and an absent row already means `false` — so the
   rule needs no "is this a re-verification?" branch, which is exactly the branch that would
   eventually be got wrong.

Both are required. The structural half alone leaves stale `true` flags in the table that would
become live again on re-verification; the explicit half alone would not survive a code path that
forgets to call it.

## 5. Surfaces

### 5.1 `/maps` — the server picker

Active slugged servers, each with a count of friends currently visible to you there. Useful in
its own right ("anyone on Sakhal tonight?"), and it avoids inventing an arbitrary redirect when
we do not know which server the visitor means.

Signed-in and **verified** only, on the same terms as `/maps/{map}` — the friend counts are
derived from the same eligibility rules (§6) and are themselves information about who is sharing
with you, so the picker cannot be more public than the map it leads to.

### 5.2 `/maps/{map}` — the map

`{map}` is a **`servers.slug`**, never `servers.map`. This is the documented convention for every
map segment in the app; the mission codename (`chernarusplus`, `enoch`) is display-only, via
`mapLabel`, and building a URL from it yields a 404.

Signed-in and **verified** only — a signed-out visitor gets a sign-in prompt and an unverified
one an explanation, never a blank canvas. `noindex`, since the page is per-viewer.

Your dot plus each sharing friend's, every dot labelled with the gamertag and its own age.
**Four distinct states, never collapsed:** loading, failed fetch, "you're offline and nobody is
sharing", and a live canvas. The page polls on a ~30 second interval; positions do not move
faster than that in any way this surface can convey.

**The map component is extracted, not copied.** `apps/web/src/components/life/track-map.tsx`
shipped the leaflet setup, the DZMap tile scheme (`/{map}/{layer}/{z}/{x}/{y}.webp`) and the
game-coordinate CRS. F2 needs the same shell with points instead of a trail. A copy would mean
two places to fix when a projection or tile-path detail turns out wrong — and that path was
already corrected once, mid-spec, during the original map design. So: a shared map shell, with
the life track and the friend points as two consumers.

### 5.3 Roster additions

- A second master switch, **"Share my location with friends"**, beside the presence one.
- A per-friend **"Share my location"** toggle.
- A reciprocity line: an undifferentiated **"Not sharing with you"** whenever their effective
  sharing toward you is off.

**The reciprocity line is deliberately undifferentiated.** It covers both "their master switch is
off" and "they have hidden from you specifically", and it cannot distinguish them. Differentiating
would have the app tell one player, in plain language, that a specific friend singled them out —
which in a small server community is a fight, and which makes the per-friend hide switch
unusable, because using it becomes a visible act. A setting that announces itself to the person
it is about is a setting nobody will use, and the quiet per-friend exception is the entire reason
there are two levels rather than one.

**⚠️ This is the one place F2 tells you anything about another user's settings.** F3 deliberately
exposes only the viewer's own flags — you cannot learn that a friend muted you. F2's exception is
considered, is limited to a single collapsed boolean, and must not be generalised: do not "tidy"
the same exposure into presence.

### 5.4 Navigation

`/maps` is signed-in-only, so it is reached from the account surfaces — the controls rail and the
mobile sheet — not the public masthead nav, which is public content sections. Same treatment as
`/friends` and `/notifications`.

## 6. The access boundary

**One endpoint: `GET /me/maps/:mapSlug`.**

It takes a **server slug and nothing else** — no gamertag, no player id, no friend id. The set of
people whose coordinates come back is computed entirely from the session, so asking for a
*particular* player's position is **unexpressible**, not merely rejected.

This mirrors the owner-only track route (`GET /me/lives/:mapSlug/:n/track`), whose comment reads:
*"this route takes NO player identifier … Do not add a gamertag/slug/userId parameter here for any
reason."* F2 adds a second coordinate egress point and holds it to the same standard rather than
relaxing the first. **Do not parameterise either route by subject.**

A subject S appears in viewer O's response only when **all** of:

1. S and O are `accepted` friends, **or S is O**;
2. S holds a **verified** `gamertag_links` row (inner join — §4);
3. `S.share_location` is true;
4. S's per-pair flag toward O is true;
5. S has an **open session on that server**;
6. S's most recent position is no older than `POSITION_MAX_AGE_MINUTES`.

Conditions 3 and 4 do **not** apply to the viewer's own dot: it is their own data, and the
owner-only route already established that self-coordinates are theirs to see. Your dot appears
whenever you are online on that server, regardless of whether you share with anyone.

**Every response carries `cache-control: no-store, private`.** A shared proxy or CDN caching this
hands one player's squad positions to the next visitor — the classic way a correct auth check
still leaks, and the reason that header is already on the track route.

Each point carries its own `recordedAt`, so the UI ages each dot independently rather than
stamping the whole page with one time.

## 7. Testing

**Pure predicate first.** `shouldShareLocation({ status, masterShare, pairShare })`, exhaustive
over its truth table, mirroring F3's `shouldNotifyPresence`.

**Against Postgres**, the eligibility matrix: each flag off in turn yields nothing; a
non-accepted pair yields nothing; an offline friend is absent; a friend whose last position
exceeds `POSITION_MAX_AGE_MINUTES` is absent; the viewer's own dot appears regardless of their
own sharing flags; and — **the F1 prerequisite** — a friend whose verified link was released is
absent *even with every sharing flag still true*. That last case earns an explicit test because
it is a hole that was filed rather than fixed twice.

Plus: **verifying a gamertag link resets both master switches** to false.

**API tests:** the session gate, the verified gate, the `no-store, private` header, and an
unknown slug.

**Web tests:** the four page states; the two new Roster controls; and the reciprocity line —
including that it does **not** distinguish "master off" from "hidden from you", which is exactly
the property a well-meaning future change would break.

## 8. Rollout

Migration `0022` touches no projection table — plain `./deploy/deploy.sh`, **no `--rebuild`**.
No new env vars, no new worker, no systemd unit.

Unlike F3 there is **no operator gate**: no background worker is involved, so the endpoint is
live on deploy. It is nonetheless **inert** — every master switch starts `false`, so the page
renders the viewer's own dot and nobody else's until people opt in. Live-but-inert rather than
dark.

## 9. Out of scope

- **Route trails for friends** — last known point only (§2). Trail-sharing deserves its own
  switch if it is ever wanted.
- **Coarsened positions** (grid square, nearest named area) — a plausible later fidelity option,
  deliberately not built now.
- **Showing a position after logout** — excluded on purpose; that is the stash-location leak.
- **A cross-server combined map** — one map per server is what makes the page tractable.
- **A per-friend map panel on the dossier** — concentrating coordinate egress in exactly one
  endpoint is what makes the boundary reviewable.
- **Differentiated reciprocity** ("they hid from *you*") — §5.3.
- **F3's deferred follow-ups** (the `0021` index-build lock, `cursor-pointer` on a disabled
  master switch, the disabled-and-checked opacity mismatch) — unrelated to this work.
