# M1 — the map as a tool: full-screen shell, search, coordinates

**Date:** 2026-07-22
**Status:** Approved, not implemented
**Scope:** Sub-project M1 of two. M2 (personal pins) is a separate spec, not yet written.

## 1. What this builds

`/maps/[map]` stops being a page with a map on it and becomes a **map application**: full
viewport, one thin bar of chrome, and the three tools that make a DayZ map usable while you
are actually playing — switch server, find a place by name, read out a grid reference.

Nothing about what the server will disclose changes. This is presentation over the payloads
`GET /me/maps` and `GET /me/maps/:mapSlug` already return, plus the `map-places.json` data
already vendored in the repo. **No migration, no new API route, no new env var, no worker.**

## 2. Why it is split from pins

The original request bundled four things: full-screen chrome, place search, a coordinate
readout, and personal pins. The first three are client-side work over data already on the
page. Pins are a table, an API, and a privacy decision with real weight:

**This application deliberately refuses to persist stash-adjacent locations.** F2's central
argument is that where a player stops is where their stash is, which is why a friend's dot
vanishes on logout rather than lingering. A pin feature stores exactly that, permanently and
by name. That may well be the right call — it is the user's own data about their own game —
but it must be decided in a design that is about it, not settled in passing inside a layout
change. Hence M2.

## 3. The shell

### 3.1 Routing

The masthead, footer and controls rail live in the **root** layout today, so no route can opt
out of them. M1 splits the layout with a route group. **No URL changes** — route groups are
not path segments.

```
app/layout.tsx          html/body, fonts, QueryProvider, skip link          (stays)
app/(site)/layout.tsx   masthead + max-w-[1440px] grid + ControlsRail + footer   (NEW)
app/(site)/…            about, friends, fresh-spawns, login, news, notifications,
                        obituaries, players, survivors, welcome, and the home page
                        — moved with `git mv`, contents untouched
app/maps/layout.tsx     the map app shell: full viewport, no site chrome      (NEW)
app/maps/…              picker + [map]                                       (stays)
```

`maps/` is simply not inside `(site)`, so it inherits none of that chrome. `sitemap.ts`,
`robots.ts`, `error.tsx` and `not-found.tsx` stay at the root.

**Known consequence, handled rather than discovered later:** `app/not-found.tsx` and
`app/error.tsx` render against the *root* layout, so once the chrome moves out of it, a global
404 or error page renders bare. Both files render `<Masthead />` and `<Footer />` explicitly.
A test asserts the 404 page still contains site navigation.

### 3.2 Viewport and the layer legend

The shell is `100dvh` (not `vh` — collapsing mobile browser chrome must not push the map under
the address bar) with iOS safe-area insets on the bar and on any bottom-anchored control.

The app has exactly three z-altitudes and the LAYER LEGEND at the `<header>` in `header.tsx`
is their source of truth. `/maps` does not render the masthead, so **on this route the top bar
is the z-40 occupant** and the legend sheet is a z-50 overlay. Same three altitudes, different
occupants — the map canvas keeps its `isolate`, which is what cages Leaflet's own z-1000
controls. The legend comment is extended to say this; a fourth altitude is not introduced.

## 4. The top bar

One row, ~48px, dark surface, fixed to the top of the shell.

```
PHONE    [←] [ CHERNARUS ▾ ]                    [⌕] [◎] [☰ 2]
DESKTOP  [← ONE LIFE] [ CHERNARUS ▾ ]  [ search… ]  [◎ Locate] [☰ Friends 2]
```

| Control | Behaviour |
|---|---|
| **←** | Leaves the map. Wordmark + label at `md+`, bare chevron on a phone. Always present, because the shell has no other exit. |
| **Map switcher** | The three servers with each map's friend count, from the `GET /me/maps` payload the picker already returns. Switching map is one tap, not a trip back to `/maps`. |
| **⌕ Search** | Permanent field at `md+`; on a phone a magnifier that expands to the full bar width, since a persistent field cannot share a 360px row. |
| **◎ Locate** | Recentres on your own dot. **Disabled with a stated reason** when there is no live position (offline, or never seen in game) — never a control that silently does nothing. |
| **☰ Friends** | Opens the who-is-sharing list: popover at `md+`, bottom sheet below, reusing `useModalBehavior` (focus trap, Escape, scroll lock, focus restore) and the existing sheet motion. |

The ☰ count comes from the same payload as the dots and renders a **loading state rather than
`0`** while it is fetching. Loading is not an authoritative zero — the live-data-honesty rule,
which this codebase has already violated four separate times.

## 5. Search

Pure client-side over `map-places.json`. 201 entries is nothing to filter in a browser and
there is no route to add.

- Case-insensitive substring match on the display name.
- Ranking: prefix matches above interior matches, then by tier (`major` → `minor` → `faint`),
  then alphabetically. Capped at **8** results.
- Selecting a result flies the map to it and briefly pulses that label, so it is visible
  *which* of two similar names was chosen.
- Search covers **every** place on the map, including tiers not currently drawn at this zoom;
  flying to a result zooms in far enough that its own tier is rendered.

**Reuse `GamertagAutocomplete`** rather than building a second combobox. It already carries the
full WAI-ARIA 1.2 listbox semantics and the always-present announced result count from the
SR-structure pass, and its `fetchSuggestions` is injected — a synchronous resolver over the
vendored array satisfies it. Pass a **stable** reference, per that component's existing
contract.

⚠️ **It is styled for the light rail and the bar is dark.** This is precisely the defect that
shipped the notifications panel invisible on mobile (v0.26.0): correct DOM, fully functional,
unreadable. It needs an `onDark` variant, and **a test pinning the token swap** — RTL asserts
the DOM, not contrast, so the suite stays green through this class of bug.

## 6. Coordinates

- A crosshair fixed at the centre of the viewport; a chip at the bottom-left reads the grid
  reference of whatever is under it, updating as the map is panned. This works identically
  with touch and mouse, and needs no interaction to discover.
- **Format: a 3-digit grid pair** (`067 023`) — metres ÷ 100, zero-padded, easting then
  northing. The convention people already say out loud.
- Conversion needs a pure **`pixelToWorld`** beside the existing `worldToPixel` in
  `dayz-projection.ts`, unit-tested as a **round trip** against it. Projection knowledge stays
  in the one module that owns it; `CANVAS_PX` stays the single parameter it already is.
- Updates on Leaflet's `move` (not `moveend`), rAF-throttled, so the readout tracks the drag
  instead of snapping at the end.
- **Tapping the chip copies the pair to the clipboard.** This is the reason a readout exists —
  you read a coordinate in order to send it to someone.
- The chip is **not** a live region. Announcing a new coordinate on every frame of a pan is
  unusable with a screen reader. It is readable on demand, and the copy control carries the
  current value in its accessible name.

## 7. The friends list, and honest states

The under-map legend becomes the ☰ panel: same `role="list"`, same per-dot ages via
`positionAge`, same plain *"Nobody is sharing a position here right now."*

It remains **the screen-reader companion to a canvas that has no text**, so it stays in the tab
order and is reached by a real button — never a hover affordance.

`MapPageView`'s five states (signed out / unverified / loading / failed / loaded) render as a
card over the shell **with the bar still present**, so the route stays escapable. An empty map
behind a missing card would read as "nobody is here", which is a different and false claim.

## 8. Testing

Pure and component coverage: `pixelToWorld` round trip, grid formatting (including the
zero-padding and the map edges), search ranking and cap, bar states, the disabled-Locate
reason, the ☰ loading-versus-zero distinction, the dark-token swap on the search combobox, and
the combobox's ARIA roles.

⚠️ **jsdom cannot observe layout or paint, and that is exactly what has failed twice today.**
v0.38.1's "solid background" painted an 8×2px dash because Leaflet's inline `width: 0` beat the
class rule, and both v0.38.0 and v0.38.1 were written against a false assumption that the tiles
are dark. Both were green in the suite. Therefore the implementation plan **ends with a
mandatory browser pass against the live site**, checking at minimum:

1. The crosshair reading against a known landmark (a town whose position is independently known).
2. Chip and label legibility over pale terrain, forest, and water.
3. The bar at a 360px viewport — no wrapping, no overlap, expanded search usable.
4. The ☰ sheet over the map, including focus trap and Escape.
5. A search result landing on the right town.

A green suite is not evidence that this feature works. The browser pass is.

## 9. Out of scope

Personal pins (M2), distance measurement, offline tile caching, route trails on this surface,
and any change to what coordinate data the server will disclose or to whom.
