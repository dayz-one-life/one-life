# Mobile controls polish — design

**Date:** 2026-07-20
**Status:** Approved
**Scope:** `apps/web` only — the mobile player-controls surface (pill + bottom sheet) and the
panels it mounts. No API, notifier, or schema changes.

## 1. Problem

A mobile-focused UX review of the player-controls surface (pill + `ControlsSheet`) found:

1. **Sheet links navigate under the still-open sheet** (`Obit →`, `Your profile →`) — the same
   bug class fixed for the bell popover in v0.29.0; `ControlsSheet` never watches the route.
2. **iOS auto-zoom on inputs:** the `GamertagAutocomplete` inputs render at 11.5px; mobile
   Safari zooms the viewport when a focused input is under 16px.
3. **No safe-area handling:** the pill (`bottom-3.5`) and the sheet's bottom padding sit under
   the iOS home-indicator zone; the sheet's `max-h-[85vh]` overshoots the real viewport under
   Safari's collapsing URL bar.
4. **The drag handle promises a gesture that doesn't exist** — no swipe-to-dismiss.
5. **Autocomplete + software keyboard:** the dropdown renders inside the sheet's scroller
   (possible clipping) and the keyboard can hide the focused input.
6. **Instant open/close** — no enter/exit animation.
7. **Sub-44pt quiet actions** ("Cancel claim", referrer "Set", footer links).
8. **9.5–11px functional mono text** on the primary mobile account surface.
9. **Errors don't announce** to screen readers.
10. **Four hardcoded hexes** (`#111`, `#4A4838`, `#1A1A12`, `#6A6852`) in the dark surface —
    the token-discipline gap behind the invisible-panel bug class.

All items fold into one feature (user decision). Swipe-dismiss is **implemented**, not removed
(user decision).

## 2. Gesture — `useSheetDrag`

New hook `useSheetDrag(panelRef, onClose)` at `apps/web/src/lib/use-sheet-drag.ts`, the
`useModalBehavior` idiom (small, shared, unit-tested):

- **Drag zone = the header zone only** (grabber handle + header row), never the scrollable
  body — body drags must keep scrolling the sheet content. The zone is marked with a
  `data-sheet-drag-zone` attribute; the hook attaches pointer handlers to it.
- Pointer-down starts a drag; the sheet translates with the finger (`translateY`, clamped
  ≥ 0, transform-only). Transitions are suspended during the drag so tracking is 1:1.
- Release **dismisses** when displacement > 30% of the sheet's rendered height OR flick
  velocity > 0.5 px/ms downward; otherwise it **springs back** with a 200ms transition.
- Dismissal routes through the same close path as the × (so the exit animation and focus
  restore run).
- Mouse and touch both work (pointer events); `touch-action: none` on the drag zone only.

## 3. Animation — two-phase close in `ControlsSheet`

- `ControlsSheet` gains an internal phase machine: `closed → opening → open → closing → closed`.
  The DOM mounts on open and survives through `closing` until the exit transition ends
  (`transitionend` + a safety timeout), then unmounts.
- **Enter:** sheet from `translateY(100%)` → `0`, 250ms ease-out; scrim fades in in sync.
- **Exit:** 160ms ease-in (exit faster than enter); scrim fades out.
- All motion sits behind `@media (prefers-reduced-motion: no-preference)` (or the Tailwind
  `motion-safe:` variant) — reduced-motion users keep today's instant mount/unmount.
- Transform/opacity only; no layout-affecting properties animate.

## 4. Route-change close

`ControlsSheet` itself (not its parent) closes on `usePathname()` change — the same effect
shape as `MastheadBell`. Any link inside the sheet, present or future, dismisses it on
navigation. `MobileControls` keeps ownership of `open` state; the sheet calls `onClose`.

## 5. Hygiene batch

- **Safe areas:** pill and `SignInPill` bottom offset →
  `bottom-[calc(14px+env(safe-area-inset-bottom))]`; sheet content padding →
  `pb-[calc(20px+env(safe-area-inset-bottom))]`; sheet `max-h-[85vh]` → `max-h-[85dvh]`.
- **iOS input zoom:** every text input reachable on the mobile surface (both `TokensPanel`
  autocomplete inputs; the `LinkTagPanel` claim input if it shares the sub-16px idiom —
  verify at implementation) renders `text-base` (16px) below `xl` and keeps the compact
  `xl:text-[11.5px]` on the rail. Class-only change via the existing `inputClassName` prop.
- **Autocomplete in the sheet:** the suggestion dropdown gets a `max-h` (~5 rows) with
  internal scroll; the input scrolls itself into view on focus
  (`scrollIntoView({ block: "center", behavior: "smooth" })`, motion-safe). **Device check
  required during implementation:** if the absolutely-positioned dropdown clips against the
  sheet's `overflow-y-auto`, switch the dropdown to in-flow rendering below the input
  (sheet surface only); decide from the device result.
- **Touch targets:** "Cancel claim" (both `ProveItPanel` states), referrer "Set", and both
  footer links (sheet + rail footers share markup patterns; sheet ones are the requirement)
  become `min-h-[44px] inline-flex items-center` with unchanged text size.
- **Type floors (sheet surface):** `serverFactLine` row and "Ban lifts in" label 9.5–10px →
  **12px**; tokens helper line and quiet buttons → **11px minimum**. The desktop rail keeps
  its density — where a component renders on both surfaces, the raise applies below `xl`
  only (`text-[12px] xl:text-[10px]` idiom); sheet-only components change unconditionally.
- **Errors announce:** `role="alert"` on `send.error`, `referrer.error`, and the claim error
  line.
- **Tokens:** four new named tokens in `globals.css` + `tailwind.config.ts`, swept across
  `controls/` (grep gate: no raw hex remains in `apps/web/src/components/controls/`):
  - `dark-well` = `#111111` (inset field/box backgrounds)
  - `dark-edge` = `#4A4838` (on-dark hardware borders: grabber, dashed boxes)
  - `dark-hollow` = `#1A1A12` (current-emote cell background)
  - `dark-edge-bright` = `#6A6852` (current-emote dashed border)
- **Contrast:** measure `cream-muted` on `dark` and on `dark-well` at the new sizes; if
  either pair is under 4.5:1, adjust the `cream-muted` definition once at the token (never
  per-component). Record the measured ratios in the implementation PR.

## 6. Error handling

- A drag interrupted by pointer-cancel (system gesture, incoming call) springs back.
- The two-phase close's safety timeout (~400ms) guarantees unmount even if `transitionend`
  never fires (display: none ancestors, reduced-motion edge).
- Route-close during the enter animation is safe: it just flips the phase to `closing`.

## 7. Testing

- `use-sheet-drag` unit tests (synthetic pointer events): threshold dismiss, velocity
  dismiss, spring-back below both thresholds, drag ignored outside the drag zone,
  pointer-cancel springs back.
- `ControlsSheet` RTL: two-phase close (DOM survives `closing`, unmounts after), route-change
  close, scrim/×/Escape still close, `role="dialog"` behavior unchanged.
- Panel tests: input `text-base` class below `xl` pinned; `role="alert"` on all three error
  lines; 44pt classes on the quiet actions.
- Reduced-motion: the motion-safe class split asserted by class presence.
- Repo convention holds: presentational pieces props-only + tested; containers thin.

## 8. Non-goals

- No sheet library dependency; no changes to `useModalBehavior` (the mobile menu must not
  gain drag behavior).
- No rail/desktop density changes at `xl+`.
- No API/schema changes.
- Landscape-specific layout work (beyond dvh) is out of scope.
