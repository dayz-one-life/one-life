# Map controls on mobile — design

**Date:** 2026-07-22
**Status:** approved
**Follows:** `2026-07-22-m1-map-tool-shell-design.md` (M1), shipped as v0.39.0–v0.39.2.

## 1. The problem

Reported from a real phone after v0.39.2: the map's top bar is hard to use. Two causes, one
reported and one found by reading the shipped code:

1. **Every control is about 28px tall with 11px type.** The rest of the site already holds a
   44px floor where it matters (`ServerPicker`'s rows are `min-h-[44px]`); the map bar was
   written to fit a row, not to be tapped.
2. **Everything lives at the top of a full-viewport application**, which is the hardest place on
   a phone for a thumb to reach — and the map is the one surface a player uses one-handed while
   doing something else.

Separately: the back link is the plain text `← ONE LIFE`, where the site has a real wordmark.

## 2. What changes

### 2.1 A bottom bar below `md`

A new `MapBottomBar`, rendered as a **sibling of the map region in the shell's flex column**,
`shrink-0` and `md:hidden`. It is deliberately **not an overlay**: the map region gets shorter
instead of controls floating over terrain, which keeps the map fully visible and keeps the bar
out of the LAYER LEGEND's way entirely (it is ordinary flow content, not a fourth altitude).

- **Left:** the grid-reference chip. It is a copy button, so it belongs in thumb reach.
- **Right:** Locate, then Friends.

At `md` and up the bottom bar does not exist: Locate and Friends stay in the top bar and the
chip keeps floating over the map's bottom-left, exactly as today. **Search stays in the top bar
at every width** — it is a text input, and typing raises the keyboard, which would cover a
bottom bar anyway.

**Consequence:** the map centre state lifts from `FriendsMap` to `MapPage`, because the chip is
no longer rendered inside the map. `MapCanvas` is untouched; `onCenterChange` is threaded one
level further out.

### 2.2 Touch targets

- Every control in both bars: `min-h-[44px] min-w-[44px]`, and 11px → 13px mono.
- The rows inside the map-switcher menu and the friends sheet get the same floor.
- The top bar grows 48px → 56px below `md`, so a 44px target has room to sit in.
- **Leaflet's own `+`/`−` controls are 26px.** They are scaled to 44 on coarse pointers by a
  specificity-scoped rule in `globals.css` — the same idiom `.leaflet-tooltip.friend-label`
  already uses, and for the same reason: Leaflet's stylesheet is imported inside
  `map-canvas.tsx`'s chunk, so source order is not reliable.

### 2.3 The wordmark

`← ONE LIFE` becomes `←` plus `/brand/wordmark-primary@2x.png`, the same asset the masthead
uses, with its intrinsic `width`/`height` declared so the bar cannot shift as it loads. About
22px tall (~72px wide), which fits at 390px now that Locate and Friends have moved down.

- **The arrow stays.** This is the only exit from a shell with no other chrome; a bare wordmark
  reads as a logo, not as a way out.
- **The image is `alt=""` and the link keeps `aria-label="Back to One Life"`.** An `alt` of
  "One Life" on top of that label makes the accessible name "Back to One Life One Life".

## 3. Out of scope

Floating circular controls over the map; a redesigned friends sheet; anything touching the
zoom floor, the projection, or the payloads. No API, migration, env var or worker change — this
is presentation only.

## 4. Testing

jsdom has no layout, so target sizes are class assertions and the real check is the browser
pass (§5). What the suite can honestly pin:

- The bottom bar renders Locate and Friends, and the top bar does not also render them —
  i.e. the controls **move**, they are not duplicated into two live copies.
- Exactly one grid chip is in the accessibility tree at a time (`display: none` removes the
  hidden one, so this is real rather than cosmetic).
- The wordmark declares intrinsic dimensions.
- The back link's accessible name is exactly "Back to One Life" — not doubled.
- The existing dark-token tests continue to hold for every control that moved.

## 5. Browser verification

Non-optional, and now a routine per-release step for this feature — jsdom cannot observe
layout, paint or stacking, and this repo has shipped green-but-broken rendering three times
(v0.38.0, v0.38.1, and the v0.39.1 zoom latch).

1. On a real phone: every control in both bars is comfortably tappable one-handed.
2. The bottom bar does not overlap Leaflet's attribution, and the map region is not clipped.
3. The wordmark renders crisply at 22px and the bar does not shift as it loads.
4. At `md` and up, nothing has moved: Locate and Friends are still top-right, the chip still
   floats over the map.
5. The friends sheet still opens over the bottom bar, takes focus, and closes on Escape.
