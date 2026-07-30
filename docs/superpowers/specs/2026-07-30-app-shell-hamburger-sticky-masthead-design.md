# App shell: hamburger menu, sticky masthead, one page width

**Date:** 2026-07-30
**Status:** design approved, not yet implemented

## Problem

Three unrelated complaints about the app shell, fixed together because they all live in the
same four files:

1. **The mobile bottom tab bar is the wrong shape for this app.** `components/shell/tab-bar.tsx`
   is a fixed five-column bar below `md`. It costs a permanent 4rem of viewport, it forced
   "Obits" as a third name for a surface that already had two, and it made the footer carry a
   bottom gutter so its own links stayed reachable. Navigation should be a menu.
2. **The masthead scrolls away.** It is `position: relative`, so on a long surface — the
   Survivors board, an obituary — there is no route to anywhere without scrolling back to the
   top.
3. **Pages are different widths on a wide monitor.** `(boxed)/layout.tsx` declares a 1440px box,
   but the pages inside it disagree: home, About, `/obituaries` and the life timeline set
   `max-w-5xl` (1024px); `/survivors` and `/friends` set `max-w-[68ch]` (~600px); Terms, Privacy,
   Welcome, Notifications, the dossier and `/survivors/[map]` set nothing and fill the whole
   1440. `/obituaries` is not even inside `(boxed)` — it sits directly under `(site)` and
   centres itself.

The map application (`/maps/[map]`) is excluded from all of this. It deliberately sits outside
`(boxed)` so terrain can run edge to edge, and that stays true.

## Design

### 1. One menu at every width

A new `components/shell/nav-menu.tsx` replaces both `components/shell/tab-bar.tsx` and the
popover half of `components/shell/account-affordance.tsx`. A single `☰` button in the masthead's
right cluster opens one dropdown panel — the same panel at every width, anchored top-right,
~240px wide.

The desktop inline nav row (`NavLinks` in `components/header.tsx`) is **removed**. There is
exactly one way to navigate, and it is the same one on a phone and on a 1920px monitor.

Panel contents, top to bottom:

| Section | Items | Condition |
| --- | --- | --- |
| Nav | `NAV_ITEMS` verbatim — Home · Maps · Survivors · Obituaries · About | always |
| Nav | Friends | signed in only |
| — divider — | | when an account section follows |
| Account | Your profile → | `verified` |
| Account | Finish verification → | `pending` |
| Account | Claim your gamertag → | `unlinked` |
| Account | Sign out | signed in (any of the three) |
| Account | Sign in | `signedOut` |

`NAV_ITEMS` in `lib/nav.ts` stays the single source of truth for the nav section, and
`activeNavKey(pathname)` drives `aria-current="page"` on the matching item — the same contract
the removed nav row used. Friends is not in `NAV_ITEMS` (it is behind auth) and is appended
conditionally; it lights up on `/friends` by prefix.

**Mechanics are `AccountAffordance`'s, unchanged**, because they are already correct and already
tested:

- owned `open` state on the root, `aria-haspopup="menu"` / `aria-expanded` / `aria-controls`
- outside-click via a `rootRef` `mousedown` listener
- route-change close, comparing a `prevPath` ref against `usePathname()`
- `useModalBehavior(open, close)` for Escape and focus — **the panel MUST carry `tabIndex={-1}`**
- roving focus: first `[role="menuitem"]` focused on open, then Arrow/Home/End wrapping
- **every item also closes the menu explicitly.** Route-change close is not enough for the
  hash-only `/#claim` item, which changes no route and would otherwise leave the menu open over
  the claim modal it just opened, holding a second body scroll-lock.
- the `/#claim` item for an `unlinked` player is a plain `<a>`, never Next's `<Link>`.
  Same-page hash navigation goes through `pushState`, which fires no `hashchange`, so a `<Link>`
  clicked while already on `/` would never open `ClaimModal`.
- panel is `z-50`, which ranks it *inside* the `z-40` masthead. **No new altitude** — the LAYER
  LEGEND at `components/header.tsx` is unchanged by this work.

### 2. The masthead's right cluster

```
signed out:   [ SIGN IN ]  [☰]
signed in:    [bell]  [● avatar → /]  [☰]
loading:                          [☰]
```

- **The avatar becomes a plain link to `/`.** It is no longer a menu trigger. `/` is the
  player's own home, so the avatar means "you" and goes there; its account items moved into the
  menu.
- **`SIGN IN` stays a visible text link** for signed-out visitors, left of `☰`, in addition to
  being the menu's last item. It is the primary conversion action on a marketing surface and
  does not get buried one tap deeper.
- **While `useAccountStatus()` is `loading`, the `☰` renders with the nav section only.** No
  bell, no avatar, no account items, no `SIGN IN`. Never render a set that has to be swapped a
  frame later — a signed-out affordance flashing before the signed-in one is how a player learns
  not to trust the chrome. This is the rule the old `TabBar` followed by returning `null`; here
  the button itself is status-independent, so only its contents wait.

`components/shell/account-affordance.tsx` is reduced to the avatar link and the signed-out
`SIGN IN` link; its popover, roving focus and account-item branch move into `nav-menu.tsx`.

### 3. The tab bar is deleted, and two things it propped up come down with it

`components/shell/tab-bar.tsx` and `components/shell/tab-bar.test.tsx` are deleted, and
`<TabBar />` leaves `app/(site)/layout.tsx`.

Two places reserve space for it and must be corrected in the same change, or they leave dead
gutters:

- **`components/footer.tsx`** — `pb-[calc(18px+4rem+env(safe-area-inset-bottom))] md:pb-[18px]`
  becomes `pb-[calc(18px+env(safe-area-inset-bottom))]`. The `4rem` was the bar's height and the
  `md:` reset existed only because the bar was `md:hidden`. The `env()` inset stays: it is the
  phone's home indicator, not the bar. The ⚠️ comment explaining why the gutter lives on the
  footer rather than the content column is rewritten, not deleted — the reasoning (the footer is
  the last in-flow element) still holds for the safe-area inset.
- **`components/map/shell/friends-panel.tsx`** — the mobile sheet stops at
  `bottom-[calc(4rem+env(safe-area-inset-bottom))]` so it clears the bar. It becomes `bottom-0`
  with `pb-[env(safe-area-inset-bottom)]` on the sheet.

`components/footer.tsx`'s doc comment claims About is footer-only "because the mobile TabBar
carries the other four nav items". That is no longer true — About is in the menu now. The
comment is rewritten; the footer keeps all four links (About · Obituaries · Terms · Privacy)
because Terms and Privacy are reached from here and from the sign-in consent line, not from a
nav.

### 4. Sticky masthead

`components/header.tsx`: `className="relative z-40 bg-dark"` → `"sticky top-0 z-40 bg-dark"`.
Nothing else about the element changes. `bg-dark` is already opaque, so content scrolls under it
cleanly with no backdrop filter.

- `z-40` is unchanged, so the LAYER LEGEND holds. `sticky` opens a stacking context regardless
  of z-index — but the masthead already declared `z-40` for exactly that reason (the bell
  popover), so this is not a new hazard.
- **`h-14` stays.** The height chain that `/maps/[map]` depends on — `flex flex-col` on the body,
  `flex-1` on `#main-content`, the map filling what the masthead and footer leave — is
  unaffected: a sticky element still occupies its normal flow space.
- On `/maps/[map]` the page does not scroll, so sticky is a no-op there. It is left on rather
  than gated, so there is one masthead and one behaviour.
- **`scroll-padding-top: 3.5rem` on `html`** in `app/globals.css`. Without it an in-page anchor
  target — `/#claim` is the live one — lands underneath the 56px bar.

### 5. One content width

`app/(site)/(boxed)/layout.tsx` becomes the **only** place a content width is declared:

```tsx
<div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 md:px-6">{children}</div>
```

1024px (`max-w-5xl`), replacing the 1440px box. `flex flex-1 flex-col` is kept — it continues
the height chain from `#main-content`.

The masthead's inner bar takes the identical box —
`mx-auto flex h-14 w-full max-w-5xl items-center px-4 md:px-6` — so the wordmark aligns with the
left edge of page content and the right cluster with its right edge. The dark bar itself stays
full-bleed.

Per-page containers are then **removed**, not adjusted:

| Page | Today | After |
| --- | --- | --- |
| `/obituaries`, `/obituaries/[slug]` | outside `(boxed)`, `mx-auto max-w-5xl px-6 md:px-10` | **moved into `(boxed)/`**, container removed |
| `/` (home) | `mx-auto max-w-5xl min-w-0` | container removed (`min-w-0` kept if a flex child needs it) |
| `/about` | `mx-auto max-w-5xl px-6 md:px-10` | container removed |
| `/survivors`, `/friends` | `mx-auto max-w-[68ch] px-4` | container removed |
| life timeline (`/players/[slug]/[map]/lives/[n]`) | `mx-auto max-w-5xl px-6 md:px-10` | container removed |
| Terms, Privacy, Welcome, Notifications, dossier, `/survivors/[map]` | none (filled 1440) | unchanged; now 1024 via the layout |
| `/login` | `mx-auto max-w-md px-6` | **kept** |
| `/maps/[map]` | outside `(boxed)`, full-bleed | **unchanged** |

Two deliberate exceptions:

- **`/login` keeps `max-w-md`.** A centred sign-in form is a narrow-by-design surface, not an
  inconsistency. "Same width" means the page container, and login's container *is* the 1024 box
  — the form is a narrow element inside it.
- **Prose keeps its measure.** About, Terms and Privacy retain the inner `max-w-3xl` on body
  copy. 1024px of running text is unreadable. The *page* is 1024 like every other page; the
  paragraph is not.

Moving `/obituaries` into `(boxed)/` does not change its URL — route groups are not path
segments.

## Testing

RTL asserts the DOM, not paint order or viewport width. What it can prove:

- **`nav-menu.test.tsx`** — the button renders at every status; the panel opens on click and
  closes on Escape, outside-click, route change and item click; the item set matches each
  `useAccountStatus` kind (`loading` → nav only, `signedOut` → nav + Sign in, `unlinked` →
  + Claim (as an `<a>`, asserted), `pending` → + Finish verification, `verified` → + Your profile
  with the right `playerSlug` href, all signed-in → + Friends + Sign out); `aria-current` lands
  on the active nav item; the panel carries `tabIndex={-1}` and `role="menu"`; arrow keys move
  focus and wrap.
- **`header.test.tsx`** — the header carries `sticky top-0 z-40`; there is no inline nav row.
  `header.test.tsx:44` currently asserts *"has no hamburger — the TabBar replaced the mobile
  menu"*. That test **inverts**; its comment must be rewritten, not just its expectation.
- **`app/(site)/layout.test.tsx`** — no `TabBar` is rendered. The existing test that the content
  column does **not** carry a tab-bar gutter still passes and is kept.
- **`footer.test.tsx`** — the gutter is `pb-[calc(18px+env(safe-area-inset-bottom))]` with no
  `4rem` and no `md:` reset.
- **`(boxed)` layout** — carries `max-w-5xl`; a test that no page under `(boxed)` declares its
  own `max-w-*` container is not practical in RTL, so the width unification is enforced by the
  table above and by review, not by a test.

## Outstanding, un-verified work

Added to CLAUDE.md's list. None of these is closable by the suite:

- The sticky masthead actually pinning while scrolling a long surface (`/survivors`, an
  obituary), and not shifting layout on iOS Safari when the URL bar collapses.
- The menu panel painting above page content on a real device, and at 320px without overflowing.
- PWA/standalone on a notched phone now that the bottom bar is gone: the footer's remaining
  safe-area gutter, and the map's friends sheet reaching `bottom-0` without the home indicator
  eating its last row.
- The avatar → `/` link and `SIGN IN` at 320px in the right cluster alongside the bell and `☰`.
- Every page at 1024 on a wide monitor — particularly the Survivors board, which gains ~400px,
  and Friends, which gains ~400px.

Use CDP `Emulation.setDeviceMetricsOverride` for the narrow widths — `resize_window` and
`--window-size` both lie below ~500px CSS in this environment.
