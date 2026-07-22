# The map's online list — design

**Date:** 2026-07-22
**Status:** approved (design), not yet implemented
**Follows:** M1 map tool shell (v0.39.0–v0.40.2), Friends F2 (location sharing), F3 (presence).

## 1. What it is

The map's ☰ panel stops being "friends sharing a position here" and becomes **who is online on
this map**: every player currently connected to that server, **friends first**, with anyone
sharing their position **highlighted**.

Today the panel can only ever list people who are both online *and* sharing location — which,
with the location master switch defaulting off, is usually just the viewer. The panel is
therefore near-empty for almost everyone, while the game's own player menu shows a full list.

## 2. The privacy decision, stated plainly

**This publishes who is online, to any signed-in verified user, regardless of the F3 presence
switches.** That is a deliberate change of policy, made on the grounds that **DayZ's own in-game
menu already lists everyone connected to the server** — the information is not secret, and
gating it on consent protects nothing while making our list look broken.

**⚠️ That argument does not fully hold, and the gap is accepted knowingly rather than
overlooked.** The in-game menu requires you to be *connected to that server*. This list does
not. A verified account can poll `/me/maps/{slug}` for all three maps every 30 seconds
indefinitely, from anywhere, and derive a per-player online/offline schedule — including which
map someone plays, which §6 declares out of scope but which a viewer obtains simply by opening
three pages. There is no rate limit and no way for the subject to opt out. This is materially
broader than the in-game menu, and it is precisely the exposure F3 spent a migration defaulting
to `false`.

The maintainer's decision (2026-07-22) is to ship it as built: on a small single-tenant server
where players already coordinate off-game, the utility of seeing who is on outweighs the
schedule-inference risk, and third-party trackers publish comparable data for DayZ servers
anyway. **Do not repair this section by re-asserting the in-game-menu equivalence** — a
justification that does not survive scrutiny is worse than none, because the next person to
extend this surface will lean on it. If the exposure ever needs narrowing, the cheapest lever
is gating a server's list on the viewer having a life on that server, which restores something
close to the in-game boundary.

Two consequences that must not be left implicit:

1. **The F3 switches now govern notifications only, not visibility.** Their labels currently
   imply more than that. They must be reworded in the same release — a player who believes the
   switch hides them, while the map lists them by name, has been misled by us. This is a
   required part of the work, not a follow-up.
2. **Location sharing is untouched.** Where you *are* stays consent-gated by
   `shouldShareLocation`, master-off by default. Being listed as online and having a dot on the
   map remain completely different disclosures, and the second one keeps every guard it has:
   the coordinate route still takes no subject, still inner-joins a verified link, and still
   drops a fix older than `MARKER_MAX_AGE_SECONDS`.

## 3. What "online" means

**An open session is not sufficient evidence that someone is playing.** `sessions.disconnected_at`
is NULL for a crashed client until the next even-hour reboot closes it (`apps/rebooter` restarts
every active server every 2 hours), so a naive `disconnected_at IS NULL` list would show players
who left up to two hours ago — presenting stale state as current, which is the live-data-honesty
rule this codebase has broken before.

**Online = an open session AND `players.last_seen_at` within `ONLINE_MAX_AGE_SECONDS` (900).**
The same 15-minute staleness bound the map's markers and the presence generator already use, and
the same `lastSeenAt` cap `survivors.ts` uses for live playtime. A player past that bound is
simply absent from the list — silent beats confidently wrong.

## 4. Shape

Extend the existing `GET /me/maps/:mapSlug` payload rather than adding a route: the map already
polls it every 30s, and one fetch keeps the list and the dots from disagreeing about who is
where. **The route keeps its defining property — no subject parameter** — and the online list is
not coordinate data, so it adds no new egress surface.

```ts
type OnlinePlayerDto = {
  gamertag: string;
  friend: boolean;    // an accepted friendship with the viewer
  sharing: boolean;   // has a marker in this payload's `positions`
  self: boolean;
};
```

New read-model `getOnlinePlayers(db, { viewerUserId, serverId, now })` in
`packages/read-models/`, composed into the map route beside `getFriendPositions`.

**Ordering is computed server-side, once:** self → friends sharing → friends → everyone sharing
→ everyone else, then by gamertag. Sorting in the component would put the rule in the surface
that renders it rather than in the model that owns it, and the same order is wanted by the
accessible legend.

`sharing` is derived by intersecting with the positions already in the payload, **never by a
second consent evaluation** — one source of truth for who is on the map, so the list and the
dots can never contradict each other.

## 5. Surface

The ☰ panel becomes the online list, keeping its existing sheet/popover behaviour and its
44/52px targets. Friends are marked as friends; sharers are highlighted (the treatment is a
render detail, but it must not be colour alone — a text marker or an icon carries it too).

The button's count changes meaning from "friends sharing" to "players online", which is a
user-visible change of an existing number and belongs in the changelog in those words.

`FriendsMapLegend` becomes the online list's renderer and is renamed accordingly; it remains the
screen-reader companion to a canvas with no text, so it stays reachable by a real button in the
tab order.

## 6. Out of scope

Cross-server presence ("online on Sakhal"). What map someone is on is a stronger disclosure than
"online here", it is not what the in-game menu argument covers, and nothing asks for it yet.

## 7. Testing

- `getOnlinePlayers` against real Postgres (`packages/read-models` has the harness): an open
  session with a stale `last_seen_at` is excluded; a closed session is excluded; ordering is
  exactly as §4 states; `sharing` matches the payload's positions and is never recomputed.
- The staleness bound is mutation-tested — removing it must fail a named test, since that is the
  whole difference between this list and a misleading one.
- Web: the panel renders friends before strangers, marks sharers, and keeps loading, failed and
  genuinely-empty as three distinct renders.

## 8. Browser verification

Routine for this feature now. Specifically: the list matches the in-game player menu on a live
server; a player who disconnects drops off within a poll or two; and a crashed player is gone
within 15 minutes rather than lingering until the reboot.
