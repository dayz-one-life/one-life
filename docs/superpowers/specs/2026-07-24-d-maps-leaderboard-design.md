# Sub-project D — Maps + Leaderboard

**Date:** 2026-07-24
**Status:** proposed
**Parent:** `2026-07-24-pure-player-app-decomposition.md` (§D)
**Depends on:** B (shipped — #266). Runs alongside C (shipped — #267/#268/#269).
**Blocks:** nothing. E is independent.

---

## 1. What this is

The two map-shaped surfaces — the live map and the leaderboard — stop being separate products with
separate rules and become two views of the same fleet.

Three changes, landing as three PRs:

- **D1** — one map-resolution rule, shared by both surfaces.
- **D2** — the leaderboard becomes time-alive-only, per map, living players only.
- **D3** — the map rejoins the site shell.

**No migration.** No new table, no new column, no new index (§3.2), no env var, no worker. Plain
`./deploy/deploy.sh`, **no `--rebuild`**.

---

## 2. Why

Today the two surfaces disagree about almost everything they have in common.

`/maps` resolves a destination from a year-long cookie and a hardcoded `chernarusplus` default.
`/survivors` has no such notion at all — it opens a **combined** board across every server. So
"where am I?" has two different answers, and neither is "the map you actually play."

The leaderboard also carries a whole sort layer — `kills`, `time`, `longest`, a combined board, an
explicit-default redirect, and a standing constraint that **no server's slug may ever be
`kills`/`time`/`longest`** — in service of a ranking question a player tool does not need to
answer three ways. One life, one clock: how long you have stayed alive.

And `/maps/[map]` sits outside the `(site)` route group with a bespoke two-bar chrome that
duplicates the masthead's job badly (§6).

---

## 3. D1 — one resolution rule

### 3.1 The rule

```
last map viewed THIS SESSION  →  last map PLAYED  →  alphabetical by display label
```

One pure function, one call site per surface. `/maps` and `/survivors` resolve identically, so a
player who opens one and then the other lands on the same map.

**Tier 1 — this session.** A **session** cookie (no `max-age`), not the year-long `ol_last_map`,
which is **retired**. A year is the wrong memory for "where was I?": it makes a map you looked at
once last spring outrank the one you have been playing all week. A session is the window in which
"where was I" is a real question.

⚠️ **A remembered slug is still never trusted without the live list to check it against.** This is
the existing `resolveMapSlug` invariant and it carries over unchanged, including its awkward
corollary: when the servers fetch fails there is **no exception** — we do not redirect on the raw
cookie, because a stale slug lands on a broken map anyway and the honest failure render is no
worse. (`redirect()` throws `NEXT_REDIRECT`, so it must stay outside that try/catch — inside it,
the catch swallows the redirect and every visitor gets the error page.)

**Tier 2 — last map played.** New read-model `getLastPlayedMapSlug` (§3.2). This is the tier that
makes the rule about the player rather than about their browser.

⚠️ **This tier requires a resolved identity and is skipped without one.** It keys on a
**verified** `gamertag_links` row, the same boundary self-unban, tokens and the friends map
already enforce. A signed-out or unverified visitor falls straight through to tier 3. It must
**never** take a player identifier from the request — the subject comes from the session alone.

**Tier 3 — alphabetical by display label.** `mapLabel(servers.map)`, not the slug and not the
codename.

⚠️ **`enoch` sorts under L, not E** — its label is "Livonia". Sorting by codename or slug would
put Livonia first on a fleet that does not contain Chernarus, which is not what "alphabetical"
means to anyone reading the page. `DEFAULT_MAP_CODENAME = "chernarusplus"` is **retired**: with
three servers today it happens to be first alphabetically anyway, so the hardcode buys nothing and
costs a silent wrong answer the day the fleet changes.

### 3.2 `getLastPlayedMapSlug`

```ts
getLastPlayedMapSlug(db: Database, userId: string): Promise<string | null>
```

The most recent `sessions` row for the player behind that user's **verified** link, inner-joined
to an **active, slugged** server, returning `servers.slug`.

- **Inner-joined, not post-filtered** — a session on a deactivated or unslugged server must
  produce no row, not a slug the router then has to reject.
- **Returns `null`, never a guess.** A player who has never connected has no last map, and the
  caller falls through to tier 3.
- **Ordered `connected_at DESC`.** Not `disconnected_at` (null on an open session — the very case
  this exists for) and not `lives.started_at` (a life spans many sessions across many days).

⚠️ **No new index, verified by measurement, and the reason is load-bearing.** The obvious worry is
that `sessions` has no `(player_id, connected_at)` index. It does not need one *at this fleet
size*: the join to `servers` bounds the scan to one index lookup per active server against the
existing `sessions_open_idx (server_id, player_id, disconnected_at)`. Measured on a restored
production dump: **0.083 ms**, a nested loop over 3 servers. **If the fleet ever grows to tens of
servers this degrades linearly and wants a real `(player_id, connected_at DESC)` index** — that is
a migration, and this note is the trigger for it.

### 3.3 Routing

| URL | Behaviour |
|---|---|
| `/maps` | resolve → `redirect()` |
| `/maps/<slug>` | **stable, never redirects** |
| `/survivors` | resolve → `redirect()` |
| `/survivors/<slug>` | **stable, never redirects** |

The two bare paths are per-viewer and stay `robots: { index: false }`. The slugged paths are the
shareable, indexable ones.

⚠️ **The map segment is a `servers.slug`, never `servers.map`.** Unchanged, but now true of two
route trees instead of one. `map` is the mission codename (`chernarusplus`/`enoch`) and is
display-only, via `mapLabel`.

---

## 4. D2 — the leaderboard

### 4.1 What it becomes

**One board per map. Time alive, descending. Living players only.**

Deleted outright:

- `/survivors/kills`, `/survivors/longest` and the `[map]/[sort]` route tree
- the explicit-default redirect (`/survivors/time` → `/survivors`)
- **the combined board** — there is no cross-server board, because there is no cross-server life
- `SORTS`, `DEFAULT_SORT`, `isSort`, the `sort` arm of `resolveSurvivorsRoute`, and the sort pills
  in `SurvivorControls`
- **the reserved-sort-word rule** — a server slug may now be `kills`, `time` or `longest`. That
  constraint existed only because those words shadowed a slug in the depth-1 segment, and with the
  sort layer gone there is nothing to shadow. `CLAUDE.md`'s warning must be **deleted, not
  softened**, or a future maintainer will honour a constraint that no longer exists.

### 4.2 What stays

`getAliveSurvivors` keeps its definition of alive — an **open, qualified** life on an active,
slugged server — and its `livePlaytime` cap at `lastSeenAt ?? connectedAt ?? now`, **never clamped
to `now`** (`servers.clockOffsetMs` means a real `lastSeenAt` can land ahead of request-time
`now`).

Its **sort-aware tie-break collapses to a single order**: time alive → kills → longest → gamertag.
The `TIE_ORDER` table and `metricFor` go with the sort layer.

⚠️ **Qualification stays derived at read time** — the `isLifeQualified` precedent, shared with the
enforcer and the notifier. Nothing here materializes it.

### 4.3 API

`GET /survivors/:slug`. The `sort` query parameter is dropped from the Zod schema rather than
accepted-and-ignored: silently accepting a parameter that no longer does anything is how a caller
comes to believe it works.

⚠️ **`GET /survivors` (no slug) is removed.** It is the combined board's endpoint and nothing else
consumes it — the home page's *Still breathing* strip is the one caller and it moves to a resolved
slug. Confirm this before deleting; if the strip genuinely wants a cross-server top 5, that is a
separate read-model and not a survivors board.

### 4.4 SEO

`boardHref(slug, page)` loses its `sort` parameter. Every consumer — `SurvivorControls`,
`Pagination`, canonical/OG/JSON-LD, and the sitemap — is updated together.

⚠️ **The sitemap must never advertise a URL that 404s or redirects.** It currently emits three
combined-board URLs and per-map board URLs; the combined ones must go, and the per-map ones must
be built by `boardHref` rather than hand-assembled — hand-building `/survivors/time` would
advertise a redirect that no longer even exists. Each sitemap rule is mutation-tested today and
must stay so.

---

## 5. Copy

The visible `<h1>` stays factual — `{Map} survivors`. The full SEO phrase in `<title>`/OG drops its
sort clause: `Top {Map} survivors` rather than `Top {Map} survivors by {sort}`.

---

## 6. D3 — the map rejoins the shell

`/maps/[map]` moves from `app/maps/[map]/` into `app/(site)/maps/[map]/`. **The URL does not
change** — route groups are not path segments.

It gains the masthead, the footer, the tab bar and the shared `PageHeader`. Deleted:

- **`TopBar`** and `MapBottomBar` (`components/map/shell/top-bar.tsx`, `bottom-bar.tsx`) — the
  masthead is the way home, and the bottom bar duplicates the tab bar's row.
  ⚠️ **The parent spec calls this `MapTopBar`; no such symbol exists.** The component is `TopBar`.
- `CoordChip` and the crosshair. Note `CoordChip` is currently instantiated **twice** in
  `MapPage` (once in the map region, once as the bottom bar's `chip` slot) — both go.
- **the whole `onCenterChange` path**, including its rAF throttle and the centre state lifted into
  `MapPage`. ⚠️ **This is not shell-local.** `onCenterChange` is a `MapCanvas` prop
  (`map-canvas.tsx`) threaded through `FriendsMap` (`friends-map.tsx`) down from `MapPage`. It is
  deletable only because `CoordChip` is its sole ultimate consumer — so the deletion touches three
  components and their tests (`map-canvas-view.test.tsx`, `friends-map-draw.test.tsx`), not one.
- `PlaceSearch` and `searchPlaces` (`lib/map-places.ts` — `PlaceSearch` is its only production
  caller; the vendored place **data** and the labels `MapCanvas` draws from it stay).
- `GamertagAutocomplete`'s **`onPick` prop** — verified shell-only: `PlaceSearch` is the single
  caller that passes it, and the three account call sites use `value`/`onChange` alone. The
  component itself stays.
- **`MAP_TABS`** (`components/survivors/links.ts`) — a hardcoded two-map array with no importer,
  vestigial and picked up by D2's pass over that file.

**Town labels stay.** They are drawn by `MapCanvas` from vendored data and are not part of the
search feature.

Locate and Online **overlay the map, bottom-right**. They keep every state they have — ready /
loading / failed / genuinely-no-position are four distinct renders, and `LocateButton` keeps
`aria-disabled` rather than `disabled` so its `sr-only` reason stays reachable in the tab order.

### 6.1 Consequences to get right

⚠️ **`#main-content` moves back to the layout.** `MapPage` supplies that id today precisely
*because* it is outside `(site)`. Inside the group, `(site)/layout.tsx` provides it, and leaving
`MapPage`'s copy in place would put **two elements with the same id** in one document — the skip
link resolves to whichever comes first. Remove it from `MapPage`. (`(site)/layout.test.tsx`
already asserts *exactly one* `#main-content`, but it renders the layout alone, so it cannot see
a duplicate contributed by a page — that needs its own assertion.)

⚠️ **`app/maps/layout.tsx` goes with the move.** Its `h-[100dvh] … overflow-hidden` full-viewport
column is the thing being retired; leaving it would clip the page inside the shell.

**Note the current asymmetry this resolves:** `/maps` (the redirect) already lives *inside*
`(site)`, while `/maps/[map]` lives *outside* it — same URL prefix, two different layouts, because
route groups are not path segments. After D3 both are inside.

⚠️ **The z-altitude occupant changes.** On `/maps` today the **top bar** is the `z-40` occupant,
because the route has no masthead. With the masthead back, the masthead is the occupant and the
top bar is gone. Still three altitudes (`z-auto` → `z-40` → `z-50`), per the LAYER LEGEND in
`header.tsx`. `top-bar.test.tsx` pinned that number and goes with the file.

⚠️ **The map container keeps `isolate`.** Leaflet's own controls sit at `z-index: 1000` and would
otherwise paint over the masthead and every overlay. This is the reason the class is there and it
becomes *more* load-bearing now that there is a masthead above it.

⚠️ **`MapCanvas`'s `className` is sizing only.** The map needs a parent with a definite height —
Leaflet measures the element on creation, so a parent chain with no definite height collapses it
to zero. Inside the shell the page is no longer a fixed-height flex column, so this needs an
explicit height, not `h-full`.

⚠️ **The map is public; only the dots are gated.** Terrain, town labels and the switcher draw for
everyone from the public `GET /servers`. The session-gated `GET /me/maps/:slug` is untouched — no
coordinate egress moves in this sub-project, and nothing about the route's guards changes.

---

## 7. Out of scope

- **Anything touching coordinates or sharing consent** — that is E.
- **`/tokens`, the referral cold variant** — F.
- Notifications, friends, the dossier.

---

## 8. Testing

**Pure functions first.** The resolution rule, `boardHref`, and the reduced
`resolveSurvivorsRoute` are pure and get unit tests before implementation.

**Mutation-test three claims** — each must be proven red against a wrong implementation:

1. Tier 3 sorting by **codename** instead of `mapLabel` (the `enoch`/Livonia case).
2. `getLastPlayedMapSlug` **post-filtering** the server join instead of inner-joining it.
3. The sitemap emitting a **combined-board** URL after the combined board is gone.

**Read-model:** `getLastPlayedMapSlug` returns null for a player with no sessions, null for a
player whose only sessions are on an unslugged or inactive server, and the most recent slug
otherwise — including when the most recent session is still **open**.

**Browser:** the map inside the shell at desktop and at 500px — masthead present, no double
scrollbar, the map not collapsed to zero height, Leaflet controls under the masthead.

⚠️ **Below ~500px cannot be checked by resizing a window** — real Chrome on macOS enforces a
minimum window width, as does headless. That needs devtools device emulation or a real handset,
and stays on the outstanding-device-checks list.

---

## 9. Deploy

Read-model + API + web. **No migration, no `--rebuild`.** Plain `./deploy/deploy.sh`.

⚠️ **Old board URLs die at deploy.** `/survivors/kills`, `/survivors/longest`, `/survivors/<map>/<sort>`
and the combined `/survivors` board all stop resolving as they do today. They are in the current
sitemap, so crawlers hold them. `/survivors` still resolves (it redirects), but the sort paths
`404`. Accepted: this is a pre-1.0 tool with a small audience, and a redirect layer for a sort
dimension that no longer exists would preserve the concept D exists to delete.
