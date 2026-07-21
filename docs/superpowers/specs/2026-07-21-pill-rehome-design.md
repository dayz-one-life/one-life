# Pill re-homing — design

**Date:** 2026-07-21
**Status:** Approved (direction chosen by the maintainer: masthead account button)
**Scope:** `apps/web` only. Sub-project 4 of 4 from the 2026-07-20 full-site UX review.
A structural move of the mobile account trigger — the sheet and its contents are unchanged.

## 1. Problem

On mobile/tablet (below `xl`) the account controls are a **floating pill fixed to the bottom of
every page** (`components/controls/pill.tsx` — `ControlsPillView` when signed-in, `SignInPill`
when signed-out; both `fixed inset-x-3.5 bottom-… z-40 xl:hidden`). Three issues:

1. It **occupies a persistent band over content** on every page; the content column reserves a
   `pb-24` gutter to avoid overlap, permanently spending vertical space on a secondary control.
2. It is **inconsistent with the platform convention this app already adopted**: the notifications
   restructure (v0.29.0) moved notifications to a masthead **bell**. Account controls are the only
   piece still floating at the opposite edge.
3. There are **two separate floating variants** (signed-in / signed-out) doing the job an account
   affordance in the masthead would do in one place.

## 2. Approach (chosen)

**Re-home the account trigger into the masthead, next to the bell**, and retire the floating pills.
The trigger opens the existing bottom **`ControlsSheet`** — only the trigger and its location move;
the sheet, its drag-to-dismiss, focus management, and every panel inside it (identity, link/verify,
tokens, server cards, self-unban, the SP2 live regions, the SP3 loading affordances) are unchanged.

- **Signed-in:** an avatar-disc button in the masthead right cluster (beside the bell) →
  opens the `ControlsSheet`.
- **Signed-out:** a compact "Sign in" chip in the same slot → `/login` (replacing `SignInPill`;
  there is no bell when signed-out, so the chip is the only right-cluster element).
- The whole affordance is `xl:hidden` (mobile + tablet), exactly the breakpoint the pill used; at
  `xl` the sticky rail remains the account surface, unchanged.

## 3. Architecture

**New `components/controls/mobile-account.tsx` (`MobileAccount`)** — a single client component that
**colocates the trigger, the sheet, and their shared open-state**, mirroring how `MastheadBell`
owns its button + popover + state. It renders:

- the masthead trigger (avatar button when signed-in / sign-in chip when signed-out / nothing while
  `loading`),
- the `ControlsSheet` (a `fixed` bottom sheet — DOM position is irrelevant, so mounting it here is
  fine), with the same children `MobileControls` mounts today,
- the **`VerificationAnnouncer`** (SP2) — still mounted unconditionally, `xl:hidden`, so it survives
  the pending→verified swap and does not double-announce against the rail.

Because the trigger and the sheet live in one component, the open-state is plain local `useState`
(no cross-component context needed) — the same shape `MobileControls` uses now.

**Masthead (`components/header.tsx`)** gains a right **cluster**: the bell and `MobileAccount`'s
trigger sit together on the right. Today the bell self-positions `absolute right-4`; extract a
right-cluster wrapper (`absolute right-4 … flex items-center gap-1`) that holds the bell and the
account trigger side by side, so neither overlaps. The bell's popover anchor (`relative` inner div)
is preserved inside the cluster. The account trigger is placed by the masthead but its behavior/state
belong to `MobileAccount` — so `MobileAccount` must render its trigger **into the masthead cluster**.
Two acceptable wirings (plan picks one):
  - (a) `header.tsx` renders `<MobileAccount />` inside the right cluster, and `MobileAccount` renders
    both the trigger (inline) and the sheet (fixed) — simplest, keeps colocation. **Preferred.**
  - (b) a shared open-state context if (a) forces awkward structure. Only if needed.

**Retired:** `SignInPill` + `ControlsPillView` (`pill.tsx` deleted or emptied), the old
`MobileControls` mount in `layout.tsx` is replaced by `MobileAccount` inside the masthead, and the
content column's **`pb-24` bottom gutter is removed** (`layout.tsx:34` → `xl:pr-8` etc. without the
bottom reservation) since no floating chrome remains. The pill's own balance-loading chip and its
tests retire with it (the balance still shows, with its loading affordance, inside the sheet's
`TokensPanel`).

## 4. Accessibility & focus

- The trigger carries `aria-haspopup="dialog"`, `aria-expanded={open}`, `aria-controls="controls-sheet"`
  (the sheet's id), as the pill did.
- **Focus restore moves from the pill to the masthead trigger:** `useModalBehavior` restores focus
  to the element that opened the sheet, which is now the masthead button — verify the ref wiring so
  closing the sheet returns focus to the trigger, not to `document.body`.
- Signed-out chip is a plain `<Link href="/login">` with an accessible name ("Sign in").
- The bell and the account trigger are two distinct controls in the cluster, each with its own
  accessible name; they must not visually or programmatically collide.

## 5. Error handling

None new — a structural move. `loading` state renders no trigger (as the pill rendered nothing while
loading). The sheet's own states are unchanged.

## 6. Testing

- **Trigger opens/closes the sheet:** signed-in, clicking the masthead avatar opens `ControlsSheet`
  (`aria-expanded` flips, the sheet dialog appears); closing returns focus to the trigger.
- **Signed-out:** the masthead shows a "Sign in" chip linking to `/login`; no `SignInPill` anywhere
  (assert the old fixed-bottom pill is gone).
- **Pills retired:** no `fixed … bottom-… xl:hidden` account pill renders in any state; `pb-24` is
  gone from the content column (a class assertion on the layout content wrapper, or a test that the
  bottom gutter is not reserved).
- **Two-surface + a11y carryover intact:** the sheet still carries its dark tokens, the
  `VerificationAnnouncer` still fires once on pending→verified and does not double-announce, and the
  sheet's SP3 loading affordances still render — pin that `MobileAccount` mounts the announcer
  `xl:hidden`.
- **Masthead cluster:** bell + account trigger coexist without overlap; the account trigger is
  `xl:hidden`. Update `header.test.tsx` for the new cluster.
- Full web suite + typecheck green. Existing `pill.test.tsx` / `mobile-controls.test.tsx` are
  updated or removed as those components retire (move any still-relevant sheet assertions to the new
  component's test).

## 7. Non-goals

- **No bottom tab bar / no change to the mobile navigation model** — the hamburger menu stays the
  nav entry point; this moves only the account trigger.
- **No change to the sheet's contents or the desktop rail.**
- **No at-a-glance status/dots/token-balance on the masthead trigger** — the avatar only; the status
  band lives in the sheet (a subtle status indicator on the avatar is a possible future enhancement,
  explicitly out of scope here).
- No change to the notification bell's own behavior.
