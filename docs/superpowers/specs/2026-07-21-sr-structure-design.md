# Screen-reader structure — design

**Date:** 2026-07-21
**Status:** Approved
**Scope:** `apps/web` only. Sub-project 2 of 4 from the 2026-07-20 full-site UX review.
Semantic markup, ARIA, and live regions — no visual-design changes.

## 1. Problem

The full-site UX review's second theme: the app is visually complete but structurally
invisible to a screen reader in several places. An empirical accessibility audit of every
route and component (2026-07-21) confirmed 14 real defects (4 refuted as already-handled —
Next 15's auto-mounted route announcer, the bell badge whose count lives in the button's
`aria-label`, the feed's semantic `<article>` cards, and the emote glyphs which are literal
Unicode text). The defects cluster into two groups:

1. **Status changes are never announced (WCAG 4.1.3).** The three most important feedback
   loops in the app mutate the DOM silently: the emote-verification progress poll (the gate
   on account verification), a successful unban-token send, and the magic-link
   "check your email" confirmation. A screen-reader user completes each action and is told
   nothing.
2. **Collections and relationships are visual-only (WCAG 1.3.1 / 4.1.2 / 1.1.1).** Repeated
   card/row collections are flat `<div>` piles with no list semantics; the gamertag
   autocomplete is an input plus a detached `<ul>` with no combobox wiring; a few card
   titles and section headings are styled `<p>`/`<span>` instead of headings; the Rap
   Sheet / Priors `<dl>` renders value-before-label in source order; and the "Qualified"
   life stat is a bare ✓/— glyph with no text equivalent.

## 2. Status-message policy (the announcement tier)

**Policy:** any DOM change that (a) results from a user action or a background poll and
(b) is not accompanied by a focus move to new content MUST be announced through a live
region. Errors already use `role="alert"` (assertive) in four forms; successes and progress
need the polite counterpart. Written as a short comment in the shared announcer helper.

The three serious sites and their fixes:

- **`components/controls/verify-panel.tsx`** — the emote-challenge progress `<ol>` advances
  from a 5s/2s poll and the panel is replaced on `pending→verified`. Add an `sr-only`
  sibling `role="status" aria-live="polite"` that emits `"Step N of M confirmed"` keyed to
  `progressIndex`, plus a one-shot `"Verification complete"` on the transition. The region is
  a **separate node from the `<ol>`** (putting `role="status"` on the `<ol>` would strip its
  list semantics), and is scoped to progress only so the expiry countdown does not announce
  every tick.
- **`components/controls/tokens-panel.tsx`** — add an always-present
  `<p role="status" aria-live="polite">` populated on `send.ok`/`referrer.ok`
  (e.g. `"Token sent — balance N"`). The referrer confirmation must live **outside** the
  `!referrer.ok` block, which currently unmounts the form on success before anything could be
  announced.
- **`components/login-form.tsx`** — give the magic-link success `<p>` `role="status"`, and
  move focus to it (`tabIndex={-1}` + `.focus()`) since the submit button unmounts on success
  and orphans focus.

Two smaller announcement gaps ride along in the same pass (minor, but same mechanism):

- **`components/player/self-unban-button.tsx`** (and the sheet's copy) — the
  `"Unban pending — lifting shortly…"` swap is a plain `<p>`; make it `role="status"`.
- **`components/controls/gamertag-autocomplete.tsx`** — add a visually-hidden
  `aria-live="polite"` result-count region (`"N matches"` / `"no matches"`), part of the
  combobox work in §3.

## 3. Semantic-structure fixes

Objective WCAG conformance; each is a markup/attribute change with no visual delta (Tailwind
resets applied where a list would otherwise regain default markers/padding).

- **Combobox (`components/controls/gamertag-autocomplete.tsx`)** — the shared autocomplete
  (claim + token send + referrer) is a bare input + detached `<ul>` of `<button>`s. Wire the
  ARIA 1.2 combobox pattern: input gets `role="combobox"`, `aria-expanded`,
  `aria-controls={listId}`, `aria-autocomplete="list"`, and `aria-activedescendant` tracking
  the highlighted option; the `<ul>` gets `role="listbox"` `id={listId}`, each option
  `role="option"` `id` + `aria-selected`. Keyboard up/down/enter/escape already partly exist —
  verify and complete. Plus the result-count live region from §2.
- **List semantics (WCAG 1.3.1)** — wrap these repeated collections in `<ul role="list">` /
  `<li>` (with `list-none` + zeroed padding so the visual grid/stack is unchanged):
  - `components/notifications/list.tsx` — the notification feed rows.
  - `components/player/player-profile.tsx` — the "Current standing" and "Past lives" card
    grids (two lists).
  - `components/life/timeline.tsx` — the event sequence, as an **`<ol>`** (it is inherently
    ordered).
  (The obituary/news/fresh-spawn feeds were audited and **left as-is**: their sibling
  `<article>` cards are acceptable semantic units — not a defect.)
- **Headings (WCAG 1.3.1)** — promote styled titles to real headings at the correct level,
  matching the visual size (no style change):
  - `components/player/standing-card.tsx` (map-name title `<p>` → heading) and
    `components/player/past-life-card.tsx` (`<span>` → heading).
  - `components/obituaries/rap-sheet.tsx:12` — the "Rap Sheet" title `<p>` → heading, and its
    `<section>` gets an `aria-label` (or `aria-labelledby` the new heading).
- **`<dl>` source order (`components/obituaries/rap-sheet.tsx`, `birth-notices/priors-box.tsx`)**
  — each group renders `<dd>` (value) before `<dt>` (label); a screen reader reads them in
  source order, so the pairing is spoken backwards. Reorder to `<dt>`→`<dd>` in the DOM and
  restore the visual value-over-label with `flex-col-reverse` (or order utilities), so the
  render is pixel-identical.
- **Non-text glyph (`components/life/hero.tsx:54`)** — the "Qualified" stat's bare ✓/— gets an
  `sr-only` text equivalent (`"Qualified"` / `"Not qualified"`) and the glyph `aria-hidden`.
- **Error association (WCAG 1.3.1)** — the four `role="alert"` form errors
  (`tokens-panel.tsx` ×2, `link-panel.tsx`, `login-form.tsx`) are not tied to their input;
  add `aria-describedby` from each input to its error node's `id` (and `aria-invalid` while
  errored).
- **Skip link (`app/layout.tsx`)** — `href="#content"` targets a non-focusable wrapper `<div>`
  that also contains the controls `<aside>`. Point it at the page's `<main>`: give `<main>`
  `id="main"` + `tabIndex={-1}` and update the link, so focus actually lands on content
  (Safari/older-Firefox move focus only to a focusable target).

## 4. Error handling

None applicable — markup, ARIA, and live regions only. Live regions fail safe: absent AT,
they are invisible/inert.

## 5. Testing

- **RTL semantic queries, not class assertions.** Pins use `getByRole`: `combobox`,
  `listbox`/`option` with `aria-expanded`/`aria-activedescendant`; `list`/`listitem` counts
  for the wrapped collections; `heading` with `{ level }` for the promoted titles; `status`
  for the live regions. `toHaveAccessibleName` for the glyph stat.
- **A live-region behavior test** for each of the three serious sites: render, advance the
  state (progress increments / `send.ok` / `setSent`), assert a `role="status"` node carries
  the expected text. These are the pins that would fail on a silent revert.
- **`aria-describedby` association** asserted via `toHaveAccessibleDescription` (or the id
  linkage) on one errored form.
- Full web suite + typecheck green; existing pinned tests updated at the same strength where a
  changed element's role/tag moved (e.g. a title now queried by `getByRole("heading")`).

## 6. Non-goals

- No visual redesign; every change is pixel-identical in render.
- No route-change announcement work — Next 15 already mounts an `aria-live` route announcer.
- No notification-bell badge change — the count is already in the button's `aria-label`.
- No `<ul>` wrapping of the obituary/news/fresh-spawn feeds — semantic `<article>` cards are
  acceptable and the change would risk the feed layout.
- Sub-projects 3 (live-data honesty) and 4 (pill re-homing) are separate specs.
