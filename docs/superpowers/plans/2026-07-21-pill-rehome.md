# Pill Re-homing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-home the mobile account trigger from a floating bottom pill into the masthead (next to the bell), opening the existing controls sheet; retire the floating pills and free the reserved bottom band.

**Architecture:** A new `MobileAccount` colocates the masthead trigger + the `ControlsSheet` + local open-state (mirroring `MastheadBell`). The sheet and its contents are unchanged — only the trigger and its location move.

**Tech Stack:** Next.js App Router + React + Tailwind; RTL + vitest.

**Spec:** `docs/superpowers/specs/2026-07-21-pill-rehome-design.md`

## Global Constraints

- `apps/web` only. The `ControlsSheet` contents (identity/link/verify/tokens/server-cards/self-unban panels, the SP2 `VerificationAnnouncer` + live regions, the SP3 loading affordances, `useSheetDrag`, `useModalBehavior`) are **unchanged** — this is a structural move of the trigger, not a sheet redesign.
- The account trigger is `xl:hidden` (mobile + tablet), exactly the breakpoint the pill used; the `xl` rail is untouched.
- A ban/status is NOT shown on the masthead trigger (avatar only); the status band stays in the sheet (spec §7).
- Respect the two-surface token rule (the sheet is the dark surface).
- Suite: `pnpm --filter @onelife/web run test`; typecheck: `pnpm turbo run typecheck`.
- Branch: `feature/pill-rehome` (created from `develop`).

---

### Task 1: `MobileAccount` — masthead trigger + sheet + open-state; retire the pills

**Files:**
- Create: `apps/web/src/components/controls/mobile-account.tsx` (`MobileAccount`)
- Modify: `apps/web/src/components/header.tsx` (right cluster: bell + account trigger; render `<MobileAccount />`)
- Modify: `apps/web/src/components/notifications/bell.tsx` (drop the bell's own `absolute right-4` self-positioning IF the masthead now provides the right cluster — the bell becomes a plain inline control inside the cluster; keep its popover `relative` anchor)
- Modify: `apps/web/src/app/layout.tsx` (remove the `<MobileControls />` mount; remove `pb-24` from the content column wrapper `:34`)
- Delete/empty: `apps/web/src/components/controls/pill.tsx` (`SignInPill` + `ControlsPillView`) and `apps/web/src/components/controls/mobile-controls.tsx` (its job moves into `MobileAccount`) — port the sheet children + `VerificationAnnouncer` mount + the `useControls`/`useControlsActions` wiring verbatim.
- Test: create `apps/web/src/components/controls/mobile-account.test.tsx`; update `header.test.tsx`; remove/repoint `pill.test.tsx` + `mobile-controls.test.tsx`.

**Interfaces:** `MobileAccount()` — a client component: reads `useControls()`/`useControlsActions()` (as `MobileControls` did), owns `const [open, setOpen] = useState(false)`, renders the masthead trigger + `<ControlsSheet open={open} …>{same children}</ControlsSheet>` + `<VerificationAnnouncer kind={c.status.kind} />` (wrapped `xl:hidden` as today). `loading` → renders nothing.

- [ ] **Step 1: Read the current `MobileControls`** end-to-end (trigger→sheet wiring, the children it passes to `ControlsSheet`, the `VerificationAnnouncer` mount + its `xl:hidden` wrapper, `useSheetDrag`, close-on-route-change) so the port is verbatim. Read `header.tsx` + `bell.tsx` for the right-cluster refactor.
- [ ] **Step 2: Failing tests** (RTL): signed-in, the masthead shows an avatar-disc button with `aria-haspopup="dialog"` / `aria-controls="controls-sheet"`; clicking it opens the sheet (`aria-expanded` true, the sheet dialog present). Signed-out, the masthead shows a "Sign in" link to `/login` and NO fixed-bottom pill. Assert no `SignInPill`/`ControlsPillView` renders. Header test: the account trigger is `xl:hidden` and coexists with the bell without both claiming `absolute right-4`.
- [ ] **Step 3: Run to verify failure.**
- [ ] **Step 4: Implement.** Build `MobileAccount` (port `MobileControls`' sheet wiring verbatim; swap the pill trigger for the masthead avatar/chip trigger). Refactor the masthead into a right cluster holding the bell + `MobileAccount` trigger. Remove the `<MobileControls />` layout mount + the `pb-24` gutter. Retire `pill.tsx`/`mobile-controls.tsx`. Use `AvatarDisc` for the signed-in trigger (already exists).
- [ ] **Step 5: Full suite + typecheck.** Green. List every retired/repointed test.
- [ ] **Step 6: Commit:** `feat(web): re-home the mobile account control into the masthead; retire the floating pill`.

---

### Task 2: Focus restore, a11y, and carryover-integrity tests

**Files:**
- Modify: `apps/web/src/components/controls/mobile-account.tsx` (focus restore to the trigger)
- Test: extend `mobile-account.test.tsx` (+ `header.test.tsx` if needed)

**Interfaces:** none new.

- [ ] **Step 1: Failing tests** —
  - **Focus restore:** opening then closing the sheet returns focus to the masthead trigger (not `document.body`). Verify how `useModalBehavior` restores focus (it keys on the opener); ensure the trigger is the restore target.
  - **Announcer carryover (SP2):** `MobileAccount` mounts `VerificationAnnouncer` `xl:hidden`; it fires once on pending→verified and does not double-announce vs the rail (pin the same behavior the old `mobile-controls` test pinned; move it here).
  - **Sheet integrity (SP2/SP3):** opening the sheet from the new trigger still renders the dark-surface panels, the SP3 loading affordances (TokensPanel/SheetUnban loading states), and the sheet's two-surface dark tokens — a smoke test that the ported children work through the new trigger.
  - **`pb-24` gone:** the content wrapper no longer reserves the bottom gutter (class assertion on `layout` content, or a layout test).
- [ ] **Step 2: Run to verify failure** (focus-restore + any missing carryover pin).
- [ ] **Step 3: Implement** the focus-restore wiring; add the carryover pins (mostly moved from the retired `mobile-controls.test.tsx`). No behavior change to the sheet internals.
- [ ] **Step 4: Full suite + typecheck.** Green.
- [ ] **Step 5: Commit:** `test(web): focus restore to the masthead trigger; carry the sheet/announcer pins to MobileAccount`.

---

### Task 3: CHANGELOG, CLAUDE.md, full verification

**Files:** `CHANGELOG.md`, `CLAUDE.md`.

- [ ] **Step 1: CHANGELOG** — under `## [Unreleased]` → `### Changed` (this is a UX change, not a bugfix):
  ```markdown
  - Pill re-homing (UX review sub-project 4): the mobile account control moved from a floating
    pill fixed to the bottom of every page into the masthead next to the notification bell —
    a tappable avatar that opens the controls sheet (a "Sign in" chip when signed out). The
    floating pills are retired and the reserved bottom gutter is gone, so pages use the full
    height on mobile. The controls sheet and everything in it are unchanged.
  ```
- [ ] **Step 2: CLAUDE.md** — in the Tabloid redesign / controls-rail section, record that the mobile account surface is now a **masthead trigger (`MobileAccount`) opening the `ControlsSheet`**, that the floating `ControlsPill`/`SignInPill` are **retired** (do not reintroduce a fixed-bottom account pill), and that the masthead right cluster holds the bell + the account trigger (`xl:hidden`). Point at the spec.
- [ ] **Step 3: Verify** — `pnpm turbo run typecheck && pnpm --filter @onelife/web run test` → both green.
- [ ] **Step 4: Commit:** `docs: changelog + CLAUDE.md for pill re-homing`.

Then hand off to `finishing-a-feature` for the PR into `develop`.
