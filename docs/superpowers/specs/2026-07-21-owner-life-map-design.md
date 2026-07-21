# Owner-Only Life Location Map — Design

Date: 2026-07-21
Status: approved, not yet implemented

## 1. What this is

A map on the life timeline page (`/players/[slug]/[map]/lives/[n]`) showing where the
player went during that life — a route trail plus markers for kills and the death — visible
**only to the signed-in owner of that gamertag**.

It covers **open (still-alive) lives too**, where the last point is the player's most recent
known position. That is the highest-value case and the most dangerous one, which is why the
access boundary (§3) is the centre of this design rather than an afterthought.

## 2. Why this is possible today

The `positions` projection table (`packages/db/src/schema.ts:162`) has been populated since
SP1 and **no read model or API route has ever read it**. Every ADM line carrying a
`pos=<x, y, z>` produces a `player.position` event
(`packages/adm-parser/src/position.ts`, `apps/ingest-worker/src/map-events.ts:9`), folded
into `positions` by `packages/projections/src/fold.ts:118`. The data for a real trail already
exists; nothing needs to be ingested differently.

**This reverses a stated project invariant.** `CLAUDE.md` currently claims, of the R4 life
timeline, that "no coordinates are stored or shown anywhere." The storage half was already
untrue. The display half becomes conditionally untrue. `CLAUDE.md` must be rewritten to say
what is actually true — coordinates are stored, and are shown to exactly one person — rather
than left standing in silent contradiction with the code.

### 2.1 What is NOT recorded

- **Deaths carry no coordinates.** `packages/adm-parser/src/death.ts` never calls `parsePos`,
  and the `lives` and `kills` tables have no x/y columns.
- `hit_events` and `build_events` have nullable x/y; only `positions` has them NOT NULL.
- Only `teleport` retains a `z` altitude. Nothing else does. This feature is 2D.

Every death and kill marker in this feature is therefore **inferred**, never observed. §4.3
governs how that is presented.

## 3. The access boundary

This is the security core. The failure mode is disclosing a living player's near-real-time
position to someone hunting them in-game.

### 3.1 The endpoint takes no player identifier

```
GET /api/me/lives/:mapSlug/:n/track   →  401 | 403 | 404 | 200
```

The route lives under `/me/*`. The subject is derived entirely from the session cookie:

1. `getSession(auth, req)` (`apps/api/src/auth-plugin.ts:33`) — absent ⇒ `401 unauthorized`.
2. `gamertag_links where user_id = session.user.id and status = 'verified'` — absent ⇒
   `403 not_verified`.
3. That link's gamertag **is** the subject.

There is no request field in which a caller could name another player. IDOR, forced browsing
and parameter tampering are not *checked for*; they are unexpressible. This is deliberately
stronger than an equality check, because an equality check is something a later refactor can
get wrong without any test noticing.

**A `pending` link is not sufficient.** A pending link is an unproven claim — anyone can type
any gamertag into the claim box. Only a link that survived emote verification unlocks
coordinates. This mirrors `self-unban-button.tsx:93`.

### 3.2 Ownership is a query predicate, not a post-filter

The read model is called `getLifeTrack(db, serverId, sessionGamertag, lifeNumber)`. The
gamertag is part of the WHERE clause. A life belonging to another player produces zero rows
and a `404` — there is no intermediate state holding another player's coordinates that a bug
could leak.

### 3.3 `Cache-Control: no-store, private`

Set explicitly on the response. Without it a shared proxy, a CDN, or Next's fetch cache can
serve one owner's live position to the next visitor — the classic way a correct auth check
still leaks. The client fetch uses `cache: "no-store"`.

### 3.4 Coordinates never enter server-rendered HTML

The life page stays a public server component and its payload gains no coordinate data. The
track is fetched client-side after mount, by the owner's own browser. Nothing in view-source,
nothing for an OG or share crawler, nothing in the Next.js full-route cache.

### 3.5 Coordinates are never logged

No coordinates in request logs, error messages, or observability lines — the same discipline
that keeps coordinates off the newsdesk boundary (`NewsFacts` carries none, asserted
structurally).

### 3.6 The public API is untouched

`GET /players/:gamertag/:map/lives/:n` gains no coordinate fields. Coordinates exist on
exactly one endpoint, and that endpoint cannot be pointed at a third party.

### 3.7 The client-side check is not a gate

`isOwner` in React (session + verified + gamertag match) decides only *whether to make the
request*. It is bypassable from devtools and is treated as worthless for access control. Its
sole purpose is avoiding a request that would 403.

## 4. Read model

New: `packages/read-models/src/life-track.ts`, the first consumer of `positions`.

```ts
getLifeTrack(db, serverId, gamertag, lifeNumber) → {
  mapCodename: string        // servers.map — drives the projection
  segments: TrackSegment[]   // one per session
  markers: TrackMarker[]
  sampleCount: number        // pre-downsample, for honest "N fixes" copy
} | null
```

### 4.1 The trail is segmented per session, never one polyline

A logout in one town and a login in another would otherwise draw a straight line across
40km the player never walked. Each `sessions` row of the life gets its own polyline, with a
visible break between segments. This is the same class of falsehood the live-data-honesty
pass removed elsewhere.

### 4.2 Downsampling is server-side and is a tested pure function

A long life can produce tens of thousands of rows, and an idle player parked in a base
generates thousands of near-identical fixes — that is the bulk of the volume, not travel.
Rule: drop any sample within **15 metres** of the previously kept sample; hard cap **1500**
points per life (on hitting the cap, keep the first 1500 and report `sampleCount` truthfully
so the UI can say the trail is truncated — never silently drop the tail). A simple distance
threshold, not Douglas-Peucker. Implemented as a pure function with unit tests so the
thinning rule is inspectable rather than buried in SQL.

### 4.3 Markers are approximate, and the type enforces saying so

Since deaths and kills have no coordinates, each marker is the last `positions` row **at or
before** the event timestamp:

```ts
{ kind: "kill" | "death" | "now", at: Date, x: number, y: number,
  sampleAt: Date, sampleAgeSeconds: number }
```

There is deliberately **no `approximate?: boolean` flag** — a flag can be forgotten at a
render site. Every marker is approximate by construction, and `sampleAgeSeconds` is
non-optional, so a UI that renders a marker without acknowledging its staleness must actively
discard the field.

### 4.4 A stale-enough sample produces no marker at all

Past **900 seconds (15 minutes)** of `sampleAgeSeconds` the pin is worse than useless — a survivor covers kilometres in that time,
and a confidently-placed wrong pin is exactly the failure the live-data-honesty pass existed
to eliminate. Render no marker, with copy saying no fix was recorded near that event. Silent
beats wrong.

### 4.5 The `now` marker obeys the presence cap

For an open life the final point is captioned with its real age ("last fix 4m ago") and is
capped at `lastSeenAt ?? connectedAt`, matching `packages/read-models/src/survivors.ts`'s
`livePlaytime` cap **exactly, with no clamp to `now`**. CLAUDE.md live-data-honesty invariant
2 is explicit that a `Math.min(now, …)` clamp diverges from those surfaces under
`servers.clockOffsetMs` skew. It is a *last known* position, never a live one, and the copy
says so.

### 4.6 Empty is not broken

Zero position rows (a very short life, or one predating ingest on that server) renders "no
fixes recorded for this life". A failed fetch renders a `role="status"` error line. These are
different statements and must not collapse into one another — the `settleFeed` rule.

## 5. Rendering

New client component `apps/web/src/components/life/track-map.tsx`, dynamically imported with
`ssr: false`. Leaflet with `L.CRS.Simple` — DayZ is a flat square world; a geographic CRS
would warp it.

### 5.1 Projection is a pure tested function

`worldToPoint(x, y, worldSize)` in `apps/web/src/lib/dayz-projection.ts`. DayZ's origin is
bottom-left with `y` as northing; `CRS.Simple` has lat increasing upward, so the mapping is
`[y, x]` scaled by the map's own size.

| `servers.map` | world size |
| --- | --- |
| `chernarusplus` | 15360 |
| `sakhal` | 15360 |
| `enoch` (Livonia) | 12800 |

**Known pre-existing bug, out of scope:** `packages/adm-parser/src/coords.ts:2` uses a single
hardcoded `MAP_MIN`/`MAP_MAX` for every map, so Livonia positions beyond 12800 are accepted
at ingest. Flagged, not fixed here.

### 5.2 Leaflet violates the three-altitude rule and must be caged

`header.tsx`'s LAYER LEGEND is the source of truth: page content → `z-40` masthead → `z-50`
overlays, and nothing else. Leaflet assigns its panes `z-index` 200–700 and its controls
**1000**, all absolutely positioned — dropped in naively it paints over the masthead, the
notification popover, and the `ControlsSheet`. The map container therefore carries `isolate`,
creating a stacking context that confines every Leaflet z-index inside it and leaves the
global legend intact.

jsdom cannot observe paint order, so this gets the treatment `header.test.tsx` got: a comment
stating why, plus a test pinning the container's isolation.

### 5.3 Tiles

A one-time run of the [DZMap](https://github.com/WoozyMasta/dzmap) `loader` mirrors tiles to
disk on the host, served by nginx at

```
/tiles/{mapCodename}/{layer}/{z}/{x}/{y}.webp
```

with a long immutable cache. This is DZMap's own on-disk layout — `{layer}` (e.g. `terrain`,
`sat`) is part of it and is not optional. Tiles are **webp**, not png. `loader --limit` is
used to fetch only the three maps we run, and max zoom is capped at **6** (DZMap's vanilla
default), which is 1 px ≈ 1 m at full zoom for a 15360-size map. Not in git, not in Postgres, never fetched at runtime from iZurvive (which
has no public tile or embed API — only `#location=x;y;zoom` deep links). Deploy prerequisite
documented in `deploy/README.md`.

Tiles are not covered by the `pg_dump` backup; they are reproducible from the mirroring
script, which is the trade accepted for keeping hundreds of MB out of the database.

### 5.4 The map degrades when tiles are absent

In dev, and before the mirror has run, tiles 404. The trail and markers must still render on
a plain ink background with a coordinate grid. A broken-tile checkerboard would read as a
broken feature. This also means the feature ships useful even if tile hosting slips.

## 6. Placement

**Alive life:** today `Timeline` renders `WithheldBar` to everyone — "This survivor is alive.
The desk does not print the coordinates of the living"
(`apps/web/src/components/life/timeline.tsx:19`). One client component owns the decision and
renders `WithheldBar` → loading → map, so the page never shows that sentence directly above a
map of the coordinates.

**Non-owners get today's DOM byte-for-byte**, pinned by a test — the same regression guard
`linkifyGamertags` used for the 168 legacy articles.

**Dead life:** no bar exists today, so the owner gets a new section below the timeline.

Framed in voice: **DESK COPY — FOR YOUR EYES ONLY**.

## 7. Refresh

For an open life, a 60s `refetchInterval` — the `useNotifications` cadence, not the 5s
verification-poll cadence; this is not a challenge the user is actively waiting on. Stops
when the life is closed. Never polls a non-owner, matching how `useGamertagLinks` gates on
`enabled`.

## 8. Accessibility

A map is unusable to a screen reader. The markers therefore also render as a real
`role="list"` beside the map — actual DOM, not `alt` text — giving the same information in
text form.

## 9. Testing

**Security tests, written first and proven red:**

- no cookie ⇒ 401
- session with no gamertag link ⇒ 403
- session with a **pending** link ⇒ 403
- session with a verified link, requesting a life number belonging to a different player ⇒
  404 with an empty body
- response carries `Cache-Control: no-store`

**Pure unit tests:** the projection; the downsampling rule; session segmentation; the
nearest-preceding-sample matcher, **including the case where the nearest sample is after the
event, which must not be selected**; the staleness cutoff.

**DB test:** `getLifeTrack` against the Postgres harness.

**Web:** the non-owner byte-identical-DOM guard; the container's `isolate`; the a11y marker
list by role. The Leaflet container itself stays untested, per the repo convention that thin
containers are not unit-tested.

## 10. Out of scope (YAGNI)

- Other players' positions, anywhere, under any condition.
- Heatmaps, density overlays, aggregate movement analysis.
- Sharing or permalinking a track.
- The `z` altitude that only `teleport` retains.
- Any change to the public life API or to what non-owners can see.
- Fixing the per-map `inMapBounds` bug (§5.1).
