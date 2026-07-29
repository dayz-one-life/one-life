# Pending-verification experience — design

**Date:** 2026-07-28
**Status:** Approved
**Scope:** apps/web only — presentation. No migration, no API change, no env var, no worker.
Plain `./deploy/deploy.sh`, no `--rebuild`.

## 1. Problem

The home-conversion push (v0.53.0–v0.57.0) rebuilt the signed-out and signed-in-but-unlinked
experiences, but a player mid-verification (`accountStatus: "pending"`) still gets the
**unlinked player's page**: the five-beat pitch whose hero and CTA slab both shout
"LINK YOUR GAMERTAG →" — a step they have already completed (the ladder at the very bottom of
the same page shows it checked ✓). The one thing they actually need to do — the emote
challenge — is buried below the hero, rules, three obituaries, the claim slab, and
how-to-connect. Verified live against production as a pending user.

Two further problems:

- **The challenge panel implies real-time feedback it cannot deliver.** DayZ writes ADM logs in
  batches, so an emote can take **5–15 minutes** to register. Nothing in the current copy says
  so; a player performing the sequence and watching the page not move will reasonably conclude
  it is broken and give up or cancel.
- **The masthead avatar menu lies to a pending player**: a "•" disc and a menu item reading
  "Claim your gamertag →" — again, the step they already did.

## 2. Page structure (approach A — client-side audience gate, server markup unchanged)

The pending/unlinked distinction exists only client-side (`useAccountStatus`), and the home
page's server markup already renders `UnverifiedPitch` → `#claim` (`AccountPanels`) in that
order. So:

- **`UnverifiedPitch` renders its beats for `unlinked` only.** For `pending` it renders
  nothing, which floats the `#claim` section (identity row + ladder + `ProveItPanel`) to the
  top of the page. (Its docstring's "beat count is audience-dependent" note updates: the
  pending beat count is now zero.)
- **New `PendingSupport` client component**, rendered by the home page *below* the `#claim`
  section, client-gated to `pending` only. It renders the support content a pending player
  needs, in order:
  1. `HowToConnect` (they must get in game to emote — this replaces the `ConnectSection`
     that `UnverifiedPitch` used to supply for pending, so the landmark stays single);
  2. `Fallen` (the obituaries wall, for flavor).
  It renders nothing while status is `loading` (no flash) and nothing for every other state.
- **A compact tabloid lead** renders above the ladder for pending only — kicker + display
  headline in the existing tabloid language, e.g. kicker `ONE STEP LEFT`, headline
  **"Prove it's you in game"**. Lives with the pending branch in `AccountPanels` (or a small
  presentational component it mounts), never rendered for unlinked/verified.

Dropped entirely for pending: hero, rules, CTA slab — no CTA anywhere on the pending home may
ask for a step already done. Unlinked and signed-out homes are untouched.

Rejected alternative: a single `SignedInHome` client component owning both signed-in layouts —
cleaner ownership, but a bigger refactor of a page that just shipped, moving server/client
fetch seams for no user-visible gain.

## 3. Challenge panel: honest timing expectations

`ProveItPanel` copy reworks around the batching reality:

- A short numbered **"how this works"** walkthrough beside/above the sequence:
  1. Join any One Life server.
  2. Perform the three emotes **in order** (other emotes in between are fine).
  3. Done — you can log off and close this page.
- A visually distinct expectation line (yellow, mono, on the dark panel):
  **"DayZ reports emotes in batches — your progress can take up to 15 minutes to appear here.
  It does not update in real time."**
- The progress pips stay (they are honest — confirmed-so-far), and the 5s poll stays, but no
  copy may imply live updating. The existing `SrStatus` step announcements are already
  settlement-based and stay as-is.
- Expired-state copy unchanged apart from tone alignment.

## 4. Masthead avatar menu (pending)

In `AccountAffordance`:

- Pending menu item becomes **"Finish verification →"** linking to `/#claim`. Unlinked keeps
  "Claim your gamertag →"; verified keeps "Your profile →".
- The disc shows the **pending gamertag's initial** instead of "•" (the pending status carries
  the link), with a **yellow border** on the disc as the pending cue — yellow is already the
  verification color on the dark surface. Verified and unlinked discs unchanged.

Other touchpoints checked and left alone: the tab bar (navigation, correct for pending) and
`/welcome` (already routes non-verified users to `/`).

## 5. Testing

- `unverified-pitch.test.tsx` / `three-modes.test.tsx`: pending renders **no** pitch beats and
  no "Link your gamertag" CTA anywhere on the page; unlinked unchanged (beats present).
- New `PendingSupport` test: renders only for `pending`; how-to-connect + Fallen present, in
  that order; `loading` renders nothing.
- `verify-panel` tests: batching expectation line present; walkthrough steps present; a
  negative assertion that no panel copy matches `/real.?time|instantly|watch.*live/i` in a
  way that claims immediacy (the expectation line itself says "does not update in real time"
  and is the allowed match).
- `account-affordance` tests: pending menu item text + `/#claim` href; disc shows the pending
  initial and the yellow cue; verified/unlinked branches unchanged.

Existing invariants that must survive (regression watch): `VerificationAnnouncer` stays an
unconditional sibling of the panels body; the ladder keeps exactly one `current` step; the
`#claim` anchor keeps existing so the hero/slab links for *unlinked* still land.
