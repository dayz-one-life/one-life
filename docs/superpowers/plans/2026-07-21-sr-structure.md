# Screen-reader Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 14 confirmed screen-reader/semantic-structure defects from the 2026-07-21 accessibility audit — status-message announcement, collection semantics, combobox wiring, headings, and reading order — with zero visual change.

**Architecture:** Markup/ARIA/live-region sweeps. A small shared `sr-only` announcer helper carries the three serious live regions; the rest are per-component semantic fixes. Tests query by ARIA role, not class.

**Tech Stack:** Next.js App Router + React + Tailwind; RTL + vitest.

**Spec:** `docs/superpowers/specs/2026-07-21-sr-structure-design.md`

## Global Constraints

- `apps/web` only; markup/ARIA/live-region changes — **zero visual change** (every render pixel-identical). Where a list wrapper would reintroduce markers/padding, add `list-none`/`m-0`/`p-0`; where a `<dl>` is reordered, restore the visual order with `flex-col-reverse`/order utilities.
- Tests use RTL semantic queries (`getByRole`, `toHaveAccessibleName`/`Description`), not `className` assertions. Update any existing pinned test whose element's role/tag moved, at the same assertion strength.
- Live regions are **separate nodes** from the semantic element they describe (never `role="status"` on an `<ol>`/`<ul>` — it strips list semantics).
- Suite: `pnpm --filter @onelife/web run test`; typecheck: `pnpm turbo run typecheck`.
- Branch: `feature/a11y-sr-structure` (created from `develop`).

---

### Task 1: Form & verification feedback — announcer helper, status regions, error association

**Files:**
- Create: `apps/web/src/components/shared/sr-status.tsx` (a tiny `role="status" aria-live="polite"` visually-hidden announcer)
- Modify: `apps/web/src/components/controls/verify-panel.tsx` (emote-progress status region; keep the `<ol>` list semantics)
- Modify: `apps/web/src/components/controls/tokens-panel.tsx` (send/referrer success status region — **outside** the `!referrer.ok` unmount block; `aria-describedby`/`aria-invalid` on the send + referrer inputs)
- Modify: `apps/web/src/components/login-form.tsx` (magic-link success `role="status"` + focus move; `aria-describedby`/`aria-invalid` on the email input)
- Modify: `apps/web/src/components/controls/link-panel.tsx` (`aria-describedby`/`aria-invalid` on the input tied to its `role="alert"` error)
- Modify: `apps/web/src/components/player/self-unban-button.tsx` (the "Unban pending…" swap → `role="status"`; check the sheet copy renders the same component)
- Test: create/extend `verify-panel.test.tsx`, `tokens-panel.test.tsx`, `login-form.test.tsx` (add the ones absent)

**Interfaces:** `SrStatus` (or `<SrStatus>{message}</SrStatus>`) — a visually-hidden polite live region; `sr-only` utility already exists in the codebase (verify; else add the standard Tailwind sr-only class).

- [ ] **Step 1:** Write failing pins — each of verify-panel/tokens-panel/login-form: after advancing state (progressIndex increment / `send.ok` / `setSent(true)`), `screen.getByRole("status")` carries the expected text; and one form asserts the email/gamertag input `toHaveAccessibleDescription` matching its error after an error is set.
- [ ] **Step 2:** Run to verify failure: `pnpm --filter @onelife/web run test -- src/components/controls/verify-panel src/components/controls/tokens-panel src/components/login-form`.
- [ ] **Step 3:** Implement. Introduce `SrStatus`; wire it into the three serious sites + self-unban; add `aria-describedby` (input→error id) + `aria-invalid` in the four forms. Preserve `role="alert"` on errors (assertive stays for errors; status/polite is new for success/progress). Verify no visual change (the announcer is `sr-only`).
- [ ] **Step 4:** Full suite + typecheck. Update any pinned test on a touched element at same strength; list them.
- [ ] **Step 5:** Commit: `feat(web): announce verification/token/magic-link status to screen readers; tie form errors to inputs`.

---

### Task 2: Gamertag autocomplete — ARIA 1.2 combobox + result-count live region

**Files:**
- Modify: `apps/web/src/components/controls/gamertag-autocomplete.tsx`
- Test: extend `gamertag-autocomplete.test.tsx` (create if absent)

**Interfaces:** none new — ARIA attributes + ids on the existing input/`<ul>`/options.

- [ ] **Step 1:** Write failing pins — `getByRole("combobox")` exists with `aria-expanded` reflecting open state and `aria-controls` pointing at a `role="listbox"`; options are `role="option"` with `aria-selected`; the highlighted option id equals the input's `aria-activedescendant`; typing that yields results renders a polite live region announcing the count.
- [ ] **Step 2:** Run to verify failure: `pnpm --filter @onelife/web run test -- src/components/controls/gamertag-autocomplete`.
- [ ] **Step 3:** Implement the combobox pattern: input `role="combobox"` `aria-autocomplete="list"` `aria-expanded` `aria-controls={listId}` `aria-activedescendant`; `<ul role="listbox" id={listId}>`; each option `role="option"` `id` `aria-selected`. Keep the existing debounce/race-guard/keyboard handlers; complete up/down/enter/escape if partial. Add the `sr-only aria-live="polite"` count region (reuse `SrStatus` from Task 1 if it fits). No visual change.
- [ ] **Step 4:** Full suite + typecheck; update pins; list them.
- [ ] **Step 5:** Commit: `feat(web): gamertag autocomplete is a proper ARIA combobox with announced results`.

---

### Task 3: Collection list semantics

**Files:**
- Modify: `apps/web/src/components/notifications/list.tsx` (feed rows → `<ul role="list">`/`<li>`)
- Modify: `apps/web/src/components/player/player-profile.tsx` (Current-standing grid + Past-lives grid → two lists)
- Modify: `apps/web/src/components/life/timeline.tsx` (event sequence → `<ol>`/`<li>`)
- Test: extend the corresponding test files (create where absent)

**Interfaces:** none new — wrapper elements with `list-none m-0 p-0` (or equivalents) so the visual grid/stack is unchanged.

- [ ] **Step 1:** Write failing pins — `getAllByRole("listitem")` count equals the rendered row/card count in each of the three; the timeline list is an ordered list (`container.querySelector("ol")` or role + tag). Assert the visual wrapper classes are preserved (grid/stack still applied on the `<ul>`/`<li>`).
- [ ] **Step 2:** Run to verify failure.
- [ ] **Step 3:** Implement. Move the grid/stack classes onto the `<ul>`/`<li>` (or keep the grid on `<ul>` and each card in an `<li>`), add `list-none` reset. Confirm no double-wrapping breaks existing keyboard/link behavior. **Leave the obituary/news/fresh-spawn feeds alone** (spec §6 — `<article>` cards are fine).
- [ ] **Step 4:** Full suite + typecheck; update pins; list them.
- [ ] **Step 5:** Commit: `feat(web): notification/standing/past-life/timeline collections carry list semantics`.

---

### Task 4: Headings, `<dl>` reading order, non-text glyph, skip link

**Files:**
- Modify: `apps/web/src/components/player/standing-card.tsx` (map-name title → heading)
- Modify: `apps/web/src/components/player/past-life-card.tsx` (title `<span>` → heading)
- Modify: `apps/web/src/components/obituaries/rap-sheet.tsx` (section title `<p>` → heading + `aria-label`/`aria-labelledby` on the `<section>`; `<dl>` group order `<dt>`→`<dd>` with `flex-col-reverse`)
- Modify: `apps/web/src/components/birth-notices/priors-box.tsx` (`<dl>` group order `<dt>`→`<dd>` with `flex-col-reverse`)
- Modify: `apps/web/src/components/life/hero.tsx` (Qualified stat: `sr-only` text equivalent + `aria-hidden` glyph)
- Modify: `apps/web/src/app/layout.tsx` (skip link → `#main`; `<main id="main" tabIndex={-1}>`)
- Test: extend the corresponding test files

**Interfaces:** none new. Confirm the heading levels are correct relative to each page's `<h1>` (card titles likely `<h2>`/`<h3>`; verify against the page they render in — do not introduce a skipped level).

- [ ] **Step 1:** Write failing pins — `getByRole("heading", { level: N })` for each promoted title; the Rap Sheet stat's `<dt>` precedes its `<dd>` in DOM order (query the `<dl>` children order) while the visual order is preserved (assert `flex-col-reverse` on the group); the Qualified stat `toHaveAccessibleName("Qualified"|"Not qualified")`; the layout skip link `href="#main"` and `<main id="main">` has `tabindex="-1"`.
- [ ] **Step 2:** Run to verify failure.
- [ ] **Step 3:** Implement. Match visual size exactly (the heading keeps the same size/weight/tracking classes — only the tag changes). For the `<dl>`: swap DOM order to `<dt>` then `<dd>`, add `flex-col-reverse` so value still renders above label. Verify each heading level against its host page's outline.
- [ ] **Step 4:** Full suite + typecheck; update pins; list them.
- [ ] **Step 5:** Commit: `feat(web): real headings, correct dl reading order, labeled Qualified glyph, focusable skip target`.

---

### Task 5: CHANGELOG, CLAUDE.md, full verification

**Files:** `CHANGELOG.md`, `CLAUDE.md`.

- [ ] **Step 1: CHANGELOG** — under `## [Unreleased]` → `### Fixed`:
  ```markdown
  - Screen-reader structure (UX review sub-project 2): verification progress, token sends, and
    the magic-link confirmation now announce via live regions; the gamertag autocomplete is a
    proper ARIA combobox with announced result counts; notification/standing/past-life/timeline
    collections carry list semantics; card and Rap Sheet titles are real headings; the Rap Sheet
    and Priors definition lists read label-before-value; the Qualified stat has a text
    equivalent; form errors are tied to their inputs; and the skip link lands focus on a
    focusable `<main>`. No visual change.
  ```
- [ ] **Step 2: CLAUDE.md** — in the Tabloid redesign section, append a sentence recording the SR-structure pass: the status-message policy (user-action/poll DOM changes without a focus move are announced via `SrStatus`), list semantics on collections, the autocomplete combobox, and that web a11y tests query by ARIA role. Point at the spec.
- [ ] **Step 3: Verify** — `pnpm turbo run typecheck && pnpm --filter @onelife/web run test` → both green.
- [ ] **Step 4: Commit:** `docs: changelog + CLAUDE.md for screen-reader structure`.

Then hand off to `finishing-a-feature` for the PR into `develop`.
