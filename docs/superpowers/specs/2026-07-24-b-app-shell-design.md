# Sub-project B — App shell

**Date:** 2026-07-24
**Status:** proposed
**Parent:** `2026-07-24-pure-player-app-decomposition.md` (§B)
**Depends on:** A (shipped — v0.44.0 + v0.45.0)
**Blocks:** C (Home), D (Maps + Leaderboard)

---

## 1. What this is

The chrome the whole app hangs off: navigation, the account surface, and the one page-header
component every list page shares. It builds nothing player-facing on its own — every screen it
touches still renders what it renders today. Its value is that C and D stop having to invent a
shell each.

**It is a refactor with a nav change, not a feature.** The success test is that a player notices
the navigation moved and nothing else broke.

### Out of scope, deliberately

- **Home's content** (C). B leaves `app/(site)/page.tsx` rendering exactly what it renders today.
- **Map/leaderboard routing and the sort-layer deletion** (D). B renames a nav label; it does not
  touch `/survivors/*` resolution or move `/maps/[map]` into the site group.
- **Any copy rewrite.** The stale content-engine copy (home hero, `/about`, survivors subhead,
  meta description) is real and wrong, but it is C's and D's copy to write. B does not touch it.
  See §9.

---

## 2. Decisions taken without asking

The parent spec settles B's bullets but leaves four questions open. Each is answered here so
implementation is not blocked; each is cheap to reverse at spec stage and expensive after.

### 2.1 `You` is a route, not a section of Home

The tab bar lists `You` as a peer of Home, so it is a destination: **`/you`**, an account and
settings page holding identity, the tokens summary, the push toggle and sign-out.

The alternative — Home scrolls to an account section — was rejected because C defines Home as the
*control panel* (lives, spend, friends, map). Identity and sign-out are not things a player does
often, and putting them on Home costs the surface its focus. It also gives F (`/tokens`) and G a
natural parent.

**Consequence for C:** Home does not render identity or sign-out. If C later wants a compact
identity line, it links to `/you`.

### 2.2 The claim/verify ladder lives on Home, not `/you`

`unlinked` and `pending` are onboarding states, and the parent spec assigns the three-mode home
(cold / unlinked-pending / verified) to C. So the link and verify panels move to Home, not `/you`.

B does **not** build that ladder — it relocates `LinkPanel` and `VerifyPanel` into Home's existing
render so nothing is lost, and C restructures them. A signed-in unlinked user must be able to claim
a gamertag at every commit in B, and `/you` must never be the only place to do it.

### 2.3 Panels are relocated, not rewritten

`components/controls/` dies as a *concept* (three surfaces, one hook). Its panels do not: `IdentityRow`,
`TokensPanel`, `LinkPanel`, `VerifyPanel`, `ServerCards`, `FriendsPanel`, `VerificationAnnouncer` and
`GamertagAutocomplete` are all unit-tested, props-only components that already work.

They move to `components/account/` (identity, tokens, link, verify), `components/servers/`
(server cards) and `components/shared/` (`GamertagAutocomplete` — already used by four call sites,
only one of which is an account surface). `FriendsPanel` moves to `components/friends/`.

**Deleted outright:** `rail.tsx`, `sheet.tsx`, `mobile-account.tsx`, `signin-panel.tsx` and their
tests — the three-surface machinery, which is the actual point of B.

`useControls` survives as the data hook but loses its "one source for three surfaces" framing; it
keeps `standingLoading` / `balanceLoading`, which are load-bearing (live-data honesty §5).

### 2.4 The dark-surface variant problem disappears

The ⚠️ two-surface rule in `CLAUDE.md` — the rail is light paper, `ControlsSheet` is `bg-dark`, so
every shared panel needs a token variant or renders ink-on-dark and invisible — **is retired by B**,
because the sheet is. Every relocated panel renders on light paper only.

`TokensPanel`'s `boxed` variant and any `onDark` prop on a relocated panel are removed with it.
This is a real simplification, not a cleanup: it deletes the failure mode that shipped in v0.26.0.

The rule still governs `NotificationRow` / `NotificationList`, whose bell popover is dark and whose
inbox page is light. **That pairing is untouched by B and the `CLAUDE.md` warning must be narrowed
to it, not deleted.**

---

## 3. Navigation

### 3.1 Primary nav (`lib/nav.ts`)

`Home · Maps · Leaderboard · About` — four items, replacing `Survivors · Maps · About`.

| key | href | label | notes |
|---|---|---|---|
| `home` | `/` | Home | new item; the wordmark also goes home |
| `maps` | `/maps` | Maps | unchanged |
| `leaderboard` | `/survivors` | Leaderboard | **label-only rename.** The route stays `/survivors` — D owns route changes |
| `about` | `/about` | About | unchanged |

`activeNavKey` gains `home` and must **not** match `/` as a prefix, or every path lights up Home.
`/` is an exact match; the other three keep the `inSection` prefix rule. Player pages keep lighting
up `leaderboard` (they are reached from the board), as they light up `survivors` today.

### 3.2 The tab bar

Below `md`, a fixed bottom bar. Five items verified/signed-in, four signed out:

| signed in | signed out |
|---|---|
| Home · Map · Board · Friends · You | Home · Map · Board · Sign in |

**It is not the nav.** The nav is four sections; the tab bar is the five things a player does often,
which is why `Friends` and `You` appear in it and not in the nav, and why `About` is absent from it.

- **Z-altitude:** `z-40`, the same layer as the masthead, which it never overlaps spatially. It must
  not introduce a fourth altitude (parent spec, cross-cutting). The `z-50` overlays (skip link, mobile
  menu) still cover it.
- **Height is `h-[calc(4rem+env(safe-area-inset-bottom))]`, never `h-16` plus bottom padding** —
  under `border-box` the padding is subtracted from the box, which on a notched phone collapses the
  row. This is the same bug the map top bar shipped and fixed.
- **The content column regains a bottom gutter** (`pb-[calc(4rem+env(safe-area-inset-bottom))]`
  below `md`). Pill re-homing removed `pb-24` because no floating chrome remained; the tab bar is
  floating chrome again.
- Each item is min 52px at 15px (parent spec: mobile floors), icon + label, `aria-current="page"`
  on the active one.
- **`Map` resolves through the existing `/maps` redirect**, so B needs no knowledge of map
  resolution — D changes that redirect's internals without touching the tab bar.

### 3.3 The mobile menu is deleted

The hamburger and its full-screen `z-50` dialog exist to reach four nav items on a phone. The tab
bar reaches the three that matter plus two the nav never had. `About` is the only nav item the tab
bar does not carry; it moves into the **footer**, which is already a dark mono strip on every page.

This removes `useModalBehavior`'s largest consumer from the masthead. The hook stays — the bell
popover and (until C) other overlays still use it.

### 3.4 Desktop account affordance

`MobileAccount` (an avatar disc opening the sheet) is deleted. Desktop and mobile both get, in the
masthead right cluster beside the bell: an **avatar disc linking to `/you`** when signed in, a
**`Sign in` chip linking to `/login`** when signed out, and **nothing** while `loading` — the same
three-state rule `MobileAccount` already implements, minus the sheet.

It renders at every width (the current trigger is `xl:hidden`), because with the rail gone there is
no desktop account surface otherwise.

---

## 4. The page-header strip

One component, `components/shared/page-header.tsx`, used by Home, Maps, Leaderboard and Friends:

```
title · count · control
```

- **`title`** — required string, renders as the page `<h1>`.
- **`count`** — optional, and **the only live part**. Takes a discriminated state rather than a
  number, so the honest-rendering matrix is solved once instead of four times:
  `{ kind: "loading" } | { kind: "ready"; value: number; noun: string } | { kind: "failed" }`.
  Loading renders a neutral placeholder, failed renders an explicit `role="status"` line, and a
  resolved `0` renders as a real zero. **Never `?? 0`, never `[]`-means-idle** — this is the repo's
  most-repeated bug class and the reason the count is a union at all.
- **`control`** — optional `ReactNode`, right-aligned: a sort pill row, a map switcher, a filter.
  The header does not know what it is.

The strip sits below the masthead, above page content, inside the main column. It is ordinary flow
content — **no z-index, no sticky** — so it cannot become a fourth altitude.

**Why a component and not a convention:** the count is the only live element on four otherwise-static
headers, and it is exactly where "loading rendered as zero" keeps recurring. Centralising it means
one test file pins the three states for all four pages.

---

## 5. Layout

### 5.1 The sidebar becomes Home-only

Today `app/(site)/layout.tsx` renders a two-column `xl:` grid with `ControlsRail` on every page in
the group. B moves the grid **out of the layout and into Home**, so:

- `(site)/layout.tsx` becomes masthead + single column + footer + tab bar.
- `(site)/page.tsx` (Home) owns the `xl:grid-cols-[minmax(0,1fr)_380px]` wrapper.

Every non-Home page in the group gains its full width back. That is a visible change to Survivors,
the player dossier, Friends, Notifications and About — **intended**, and the reason B is worth doing
before D restyles the board.

### 5.2 The sidebar's contents

Parent spec: friends online, your standing on the map you are alive on, notifications. **B does not
build that.** B moves the *existing* rail contents into Home's sidebar slot unchanged, so nothing is
lost, and C replaces them.

The one rule B does enforce: **nothing actionable is exiled to the sidebar.** Since the sidebar is
`xl`-only, anything reachable solely from it is unreachable on a phone. B satisfies this by keeping
every actionable panel (claim, verify, tokens, spend) in Home's main column, with the sidebar
carrying only summaries. This is why §2.2 puts the ladder on Home rather than the sidebar.

### 5.3 `#main-content` moves

The skip link targets `#main-content`, currently on the layout's inner column. With the grid moving
into Home, the id moves to the layout's single column — still exactly one per page, still before
the tab bar in DOM order.

**Every route outside `(site)` must still supply its own `#main-content`** (`not-found.tsx`,
`error.tsx`, `/maps/[map]`). That rule is unchanged and already pinned by tests.

---

## 6. What is deleted

| File | Why |
|---|---|
| `controls/rail.tsx` + test | The desktop rail; replaced by Home's sidebar slot |
| `controls/sheet.tsx` + test | The mobile bottom sheet; replaced by the tab bar + `/you` |
| `controls/mobile-account.tsx` + test | The sheet's trigger; replaced by the masthead avatar |
| `controls/signin-panel.tsx` | Rail-only signed-out CTA; the masthead chip and Home's cold mode replace it |
| The masthead hamburger + its dialog | Replaced by the tab bar; `About` moves to the footer |
| `TokensPanel`'s `boxed` variant | The dark surface it existed for is gone (§2.4) |
| `useSheetDrag` | Swipe-to-dismiss for the sheet; no consumer remains |

`ControlsPill` / `SignInPill` are **already** deleted (UX review sub-project 4) — B must not
reintroduce a fixed-bottom account pill. The tab bar is not that pill: it is navigation for the
whole app, not an account surface, and it renders for signed-out visitors too.

---

## 7. Data flow

Unchanged. `useControls` still wraps `useAccountStatus` + the `me` / `tokens` / `servers` /
`player-page` queries, and `useControlsActions` still owns the mutations. B moves *where* they are
consumed, not what they return.

Two consumers change shape:

- `/you` consumes `status`, `name`, `provider`, `balance`, `balanceLoading`.
- Home consumes everything else, plus the sidebar summaries.

`QueryProvider` stays at the root layout (one app-wide cache), and `useGamertagLinks(enabled)` still
gates its fetch so signed-out visitors do not 401 — both unchanged and both load-bearing.

---

## 8. Testing

**Unit (jsdom).** Every relocated panel keeps its existing test, moved with it. New tests:

- `nav.test.ts` — pins the four keys in order, and that `activeNavKey("/survivors/livonia")` is
  `leaderboard` while `activeNavKey("/about")` is not `home` (the prefix-match trap in §3.1).
- `tab-bar.test.tsx` — five items signed in, four signed out, none while loading; `aria-current` on
  the active item; the z-altitude pinned numerically (`0 < z < 50`), as `header.test.tsx` does.
- `page-header.test.tsx` — the three count states render as three distinct things, and a resolved
  `0` is not the loading render.
- `layout.test.tsx` — exactly one `#main-content`; the sidebar renders on Home and not on Survivors.

**The green-suite trap applies to all of B.** jsdom asserts the DOM, not paint. The following are
invisible to it and need a real device:

1. The tab bar does not cover page content at the bottom of a scroll (the gutter, §3.2).
2. The safe-area calc holds on a notched phone in PWA mode — the row is 64px, not 1px.
3. The tab bar paints *under* the mobile menu's replacement and the bell popover, and *over* page
   content.
4. Nothing on any page is now unreachable below `xl` (the sidebar rule, §5.2).
5. The masthead avatar and bell do not collide at 320px.

**M1's outstanding browser pass folds in here** (parent spec, cross-cutting: "it should be folded
into B or D rather than deferred again"). Its six checks run in the same session as the five above,
against a deployed build with real mirrored tiles.

---

## 9. Risks

**This is a large, low-reward refactor.** It touches every page and adds no player-visible feature,
so it is the sub-project most likely to be judged "not worth it" halfway through. Its justification
is entirely that C and D are cheaper afterwards. If that stops being true, stop doing B.

**The stale copy gets worse before it gets better.** B renames Survivors to Leaderboard while the
page still says "Every name is one bad decision from Obituaries," and adds a Home nav item to a home
page that still promises obituaries. B deliberately does not fix this (§1), so the site is briefly
*more* incoherent, not less. If that is unacceptable, the copy pass should be lifted out of C and D
and run as its own small PR before B — it is independent of everything.

**Deleting the sheet deletes accessibility work.** The sheet carries a focus trap, escape handling,
scroll lock, focus restore, swipe-dismiss and the `VerificationAnnouncer`'s `xl:hidden` gating. The
announcer must survive (it outlives the pending→verified swap and is mounted as an unconditional
sibling — that structure is load-bearing and is not an implementation detail of the sheet). The rest
goes with the dialog it belonged to.

---

## 10. Deploy

Web-only. No migration, no new API route, no env var, no worker. Plain `./deploy/deploy.sh`,
**no `--rebuild`**.
