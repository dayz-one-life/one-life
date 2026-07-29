# Home consistency + claim modal — design

Date: 2026-07-29
Status: approved

## 1. Problem

The three home audiences (cold / unlinked / pending) drifted into three different beat orders,
the pending home shows a stray white bar (an otherwise-empty `AccountPanels` wrapper whose only
visible content is the inline Sign out footer), and the unlinked claim ladder is a long inline
section at the bottom of an already-long page.

Current orders:

- Cold: Hero → Rules → Fallen → CtaSlab → JoinServers
- Unlinked: Hero → Rules → Fallen → CtaSlab → JoinServers → inline `#claim` ladder
- Pending: PendingHero → white bar → Rules → JoinServers → Fallen

## 2. One shared beat rhythm

All three audiences render the same order:

| Beat | Cold (signed out) | Unlinked | Pending |
|---|---|---|---|
| 1 Hero | Ledger hero, CTA → `/login` | Ledger hero, CTA → opens claim modal | `PendingHero` (the emote challenge — it IS the CTA; carries `id="claim"`) |
| 2 | Rules | Rules | Rules |
| 3 | JoinServers | JoinServers | JoinServers |
| 4 | CtaSlab ("You get one life. Claim it"), CTA → `/login` | CtaSlab, CTA → opens claim modal | *(skipped — every ask is a done step)* |
| 5 | Fallen (last on the page) | Fallen | Fallen |

- **`JoinServers` loses its `closing` prop.** The closing line is always
  "Play first, claim later — your life is tracked from your first spawn." on every audience.
  The pending variant ("Any server counts for your emotes.") is deleted.
- `UnverifiedPitch` reorders to Hero → Rules → JoinServers → CtaSlab → Fallen.
- `PendingSupport` reorders to Rules → JoinServers → Fallen and its `closing` pass-through goes.
- The cold branch in `app/(site)/(boxed)/page.tsx` reorders to match.
- Verified home (the control panel) is unchanged.

## 3. The claim modal (unlinked only)

The inline `#claim` ladder section is deleted; claiming happens in a lean dialog.

**Contents:** "Link your gamertag" heading, the existing `LinkTagPanel` claim form
(autocomplete + Claim button + the one-token note). Nothing else:

- No `HowToConnect` — the JoinServers slab on the page behind it covers connecting.
- No `LadderFrame` step chrome — the CtaSlab's "You're signed in · Link your gamertag · Your
  life shows up here" line already narrates the ladder. `LadderFrame`/`ladderSteps` are deleted
  (their only consumer was the inline ladder; `PendingHero` references the ladder in copy only).

**Behavior:** built on `useModalBehavior` (focus trap, Escape, scroll lock, focus restore,
`tabIndex={-1}` on the panel — the known silent-no-op trap). Dark surface, matching the site's
dialogs. Renders at the z-50 overlay altitude (LAYER LEGEND).

**Trigger — hash-driven.** All triggers stay plain links to `/#claim`: the unlinked hero CTA,
the unlinked CtaSlab CTA, and the masthead menu's "Claim your gamertag →" item (currently `/`,
now `/#claim`). A `ClaimModal` component mounted on the home page opens when the location hash
is `#claim` AND `accountStatus` is `unlinked`; dismissing clears the hash (so back/refresh do
not reopen it). This keeps the masthead item working from any page (navigate home → modal
opens), keeps links as links, and needs no shared state.

**Pending keeps the anchor, not the modal.** `id="claim"` moves onto `PendingHero`, so the
masthead's "Finish verification → /#claim" lands at the top of the challenge. A pending or
verified status never opens the claim modal — the status gate makes the hash inert for them.

**On successful claim** (status flips unlinked → pending) the modal closes itself (its gate no
longer matches) and the page re-renders as the pending home — the `PendingHero` appears at the
top where the user already is.

## 3b. Pending emote tickets match the Join tickets

`TicketSequence` (`pending-hero.tsx`) adopts the JoinServers step-ticket language so the two
ticket rows read as one system:

- **Unconfirmed:** paper ticket — `border-2 border-dashed border-ink bg-paper`, ordinal in
  `font-mono text-[12px] font-bold uppercase tracking-[.2em] text-red-deep`, emote name in ink
  (`font-display … text-ink`). `red-deep` is legal here: the ticket itself is a paper (light)
  surface, exactly like the Join slab's tickets — the dark hero around it does not change the
  token surface of the ticket interior.
- **Confirmed:** same paper ticket with the dashed border flipped to **solid** ink, the emote
  name dimmed, and the existing rotated red CONFIRMED rubber stamp. Dashed order-slip →
  stamped solid ticket is the state distinction; the sr-only confirmed/not-confirmed text is
  unchanged.
- The no-current-step-pointer rule is untouched.

## 4. Deletions

- `SignedInFooter` in `account-panels.tsx` — gone entirely. Sign-out lives in the masthead
  avatar menu (`AccountAffordance`) in every signed-in state; that satisfies the "an
  unlinked/pending user can always log out" invariant, which the inline footer duplicated.
- The padded `#claim` wrapper div in `page.tsx`. `AccountPanels` stays mounted on the signed-in
  branch — it still renders the verified control panel and the unconditional
  `VerificationAnnouncer` (which must survive the pending→verified swap) — but its unlinked and
  pending branches now render nothing visible at all.
- `LadderFrame` (`ladder-frame.tsx`), `ladderSteps` (`ladder.ts`) and their tests.
- `JoinServers`' `closing` prop.
- `CtaSlab`'s `#claim` href keeps working unchanged (it now opens the modal via the hash).

## 5. Testing

- Beat-order tests per audience (cold via `page.tsx`-level composition where practical,
  unlinked via `UnverifiedPitch`, pending via `PendingSupport` + page composition): assert the
  section order Rules → JoinServers → (CtaSlab) → Fallen.
- `JoinServers` closing line pinned verbatim; no `closing` prop accepted.
- Claim modal: opens on `#claim` + unlinked; does NOT open for pending/verified/signed-out;
  Escape/dismiss clears the hash; focus moves into the panel (the `tabIndex={-1}` trap);
  claim submit wiring (`a.claim.mutate`) unchanged.
- `AccountPanels`: pending renders no visible body AND no footer (update
  `account-panels-pending.test.tsx`); unlinked renders no inline ladder.
- Masthead menu: unlinked item href is `/#claim`.
- Existing pinned copy tests (batching sentence, no-live-claims) unaffected.

## 6. Out of scope

Verified home, `/login`, the pending challenge mechanics, and all backend surfaces.
