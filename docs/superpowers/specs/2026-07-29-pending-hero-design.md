# Pending-verification hero — design

**Date:** 2026-07-29
**Status:** Approved
**Predecessor:** `2026-07-29` pending-verification experience (v0.59.0), which this replaces the
presentation of. The cold and unlinked homes open with the full-bleed dark pitch hero; the pending
home opened with a small light-surface header (`PendingLead`) and the yellow `ProveItPanel` inside
the padded `#claim` column — it read as a settings form dropped into a tabloid. This design makes
the emote challenge itself the hero.

## 1. Goal

A pending player's home should have the same feel as the cold and unlinked homes: a full-bleed
dark hero leading the page, the tabloid beat rhythm below it. The challenge — the one thing a
pending player is here to do — becomes the hero's content rather than a boxed panel.

Chosen direction (from brainstorming): **challenge AS the hero**, with a **connect beat + Fallen**
below, **mixed accent** (red hero frame, yellow for live challenge elements), and the account
chrome **folded into the hero** with a slim strip below.

## 2. `PendingHero`

New `apps/web/src/components/front-page/pending-hero.tsx`, in two parts per convention:

- A thin client **container** (untested): gates on `useAccountStatus().kind === "pending"` —
  renders nothing for every other status, including `loading` (no flash; appearing beats
  vanishing) — and wires `useControls`/`useControlsActions` for the challenge payload, cancel and
  reclaim mutations. The 5s pending poll (`useGamertagLinks`) is untouched.
- A props-only presentational **`PendingHeroView`** (unit-tested): takes gamertag, challenge (or
  null/expired), `now`, callbacks, and pending flags.

The view mirrors `Hero`'s visual language: full-bleed `bg-dark` section, `border-b-[6px]
border-red` frame, generous `px-6 py-12 md:px-10 md:py-16` stage.

**Live-challenge state:**

- **Kicker** (mono, tracked, cream-dim): `Step 3 of 3 — one step left`. This is the 3-step ladder
  folded to one line; `LadderFrame`'s pending usage and `PendingLead` are deleted.
- **h1** via `FitLine`: `Prove it's you`, with the gamertag as a second display line in yellow (the
  pending signature marks the live identity). The gamertag in the headline replaces the identity row for pending. This is the pending
  page's only h1.
- **The challenge, scaled up to hero furniture:** emote sequence chips (done / current / upcoming
  states as today, but larger than the old 12px strip), the yellow expiry countdown, the 3-step
  "how this works" walkthrough, and the **verbatim batching line** — "DayZ reports emotes in
  batches — your progress can take up to 15 minutes to appear here. It does not update in real
  time." — plus the "other emotes in between are fine" note. The `SrStatus` progress announcement
  (`Step N of M confirmed`) carries over unchanged, as a separate node from the `<ol>` (role on
  the list would strip its list semantics), scoped to progress so the ticking countdown never
  re-announces.
- **Hero foot:** quiet mono `Cancel claim` button — the destructive escape stays adjacent to the
  thing it cancels.

**Expired state:** same hero frame; headline becomes `Your verification for {tag} expired`; body
is the fresh-challenge pitch with the red `SkewCta` ("Start a new challenge →") and the quiet
cancel.

`ProveItPanel` (`components/account/verify-panel.tsx`) is absorbed and retired — the pending
branch was its only consumer.

**Color rails:** yellow-on-dark is fine and stays the signature of everything live (chips,
countdown, batching notice). `red-deep` must never appear in the hero — it is a light-surface
token (RED POLICY). The red frame and `SkewCta` background are display-scale red, allowed on dark.

## 3. Page structure — the `#claim` anchor moves up one level

`app/(site)/(boxed)/page.tsx`'s signed-in block restructures so one anchor wraps both surfaces:

```tsx
{signedIn && (
  <div id="claim">
    <PendingHero />                            {/* full-bleed; nothing unless pending */}
    <div className="px-6 py-8 md:px-10">
      <AccountPanels signInFallback />
    </div>
  </div>
)}
```

- The masthead's "Finish verification → `/#claim`" lands at the **top of the hero** for a pending
  player, and at the padded claim ladder for an unlinked one.
- Exactly one `id="claim"` in the DOM, always. (The padding moves off the anchor div onto an
  inner wrapper — the hero must be full-bleed inside the anchor target.)

`AccountPanels`' pending branch shrinks to:

- `VerificationAnnouncer` — unchanged, still the unconditional sibling outside every branch (it
  must outlive the pending→verified swap to announce it).
- **No visible body** (no `PendingLead`, no `IdentityRow`, no `LadderFrame`, no `ProveItPanel`).
- The existing `SignedInFooter` (sign-out) — preserving "sign-out renders in every signed-in
  state" without crowding the hero.

`UnverifiedPitch` is unchanged: it still renders nothing for pending, and `Hero`/`Rules`/
`CtaSlab` are untouched.

## 4. Below the hero — connect beat + Fallen

`PendingSupport` keeps its gate (`status.kind === "pending"`, nothing otherwise) and its data,
but swaps the bare `HowToConnect` card for a proper full-width beat:

- `ConnectSection` gains a small copy-variant prop (kicker + heading only; the body and
  `HowToConnect` internals are shared). Pending copy is honest for someone who already claimed —
  kicker along the lines of `Get in game`, heading about joining a One Life server to perform the
  sequence — never the cold home's "Play first, claim later," which is untrue post-claim.
- `Fallen` follows as today: renders nothing on a failed OR empty obituaries feed, never a
  placeholder.

## 5. Invariants preserved

1. The 5s pending poll, claim/cancel/reclaim mutations, and `accountStatus` derivation are
   untouched — presentation only. No API change, no migration, no env var; plain
   `./deploy/deploy.sh`, no `--rebuild`.
2. No copy anywhere claims live/instant verification updates; the batching line is verbatim and
   its pinning test moves to the new component.
3. `red-deep` never on dark; yellow stays the pending signature.
4. One h1 on the pending home (the hero's), one `#claim` id in the DOM.
5. `VerificationAnnouncer` stays mounted across the pending→verified swap.
6. Masthead pending affordance ("Finish verification →", yellow disc cue) is unchanged and its
   target still resolves.

## 6. Testing

- **`PendingHeroView` unit tests:** live vs expired render; batching line verbatim; no copy
  claiming live updates; cancel/reclaim callbacks; `SrStatus` progress text; h1 accessible name;
  kicker carries the step cue.
- **`three-modes.test.tsx`:** pending branch renders sign-out footer + announcer and no panel
  body; unlinked/verified branches unchanged.
- **`front-page.test.tsx`:** signed-in page structure — single `#claim` wrapping both surfaces,
  padding on the inner wrapper only.
- **`pending-support` tests:** connect beat variant copy (and that the cold kicker never renders
  for pending), Fallen behavior unchanged.
- **Browser check (release checklist):** the hero at phone width — FitLine sizing, chip layout,
  countdown legibility — jsdom cannot see any of it.
