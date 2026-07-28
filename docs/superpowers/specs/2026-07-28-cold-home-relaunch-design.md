# Cold-home relaunch — design

**Date:** 2026-07-28
**Status:** Approved (mockup reviewed in the visual companion; v2 accepted)

## 1. What this is

The signed-out home stops being an inventory of widgets and becomes a four-beat pitch whose one
job is making a stranger want to claim a life and join a server. The xl sidebar disappears for
every non-verified visitor. Mockup of record:
`.superpowers/brainstorm/94936-1785273254/content/cold-home-v2.html` (untracked; this spec is the
durable description).

Presentation + one new home fetch. No migration, no API change, no env var — plain
`./deploy/deploy.sh`, no `--rebuild`.

## 2. The four beats (signed-out visitors only)

**Beat 1 — Ledger hero, dark full-bleed.** The hero moves from paper to `--dark` with a 6px
`--red` bottom rule. Kicker: `ONE LIFE. NO RESPAWNS — HARDCORE PERMADEATH DAYZ · XBOX` (brand
line demoted into the kicker, red; the trailing context in `cream-dim`). The headline is TWO
lines, no trailing periods:

- Line 1 (`<h1>`): `DEATHS TO DATE: {deaths}` — display type sized to FILL the content width
  (see §5), deaths figure in plain `--red` (display-scale bold on dark: legal), `CountUp`
  animation retained.
- Line 2: `STILL STANDING: {alive}` — much smaller (roughly 1/3 the cap height), `cream-dim`
  label with the figure in `cream`, wide tracking.

Below: the deck sentence ("Every life on our servers is tracked to the minute — birth to death,
across sessions. When you die, the ban is real and the record is permanent.") and the primary CTA
button — skewed red slab, `Claim your life →` — linking `/login`. The old "How it works →" About
link moves to the CTA slab (§ beat 4 keeps the page's exits tight); the About page remains linked
from the masthead/footer as today.

**Stats-missing fallback (live-data honesty):** when the stats feed fails/returns null, the hero
renders the same dark stage with the evergreen `ONE LIFE. NO RESPAWNS` as the `<h1>` (kicker
reverts to "The record of record"), same deck + CTA. Never a zero, never a placeholder, no
banner. The a11y contract from the ledger feature is unchanged (sr-only sentence carries the
final numbers — now without trailing periods; ticking span `aria-hidden`).

**Beat 2 — The obituary wall ("THE FALLEN").** Section head `THE FALLEN` (FALLEN in red) + an
`All obituaries →` link to `/obituaries`. Up to 3 latest published obituaries as bordered white
cards: red-deep mono overline `OBITUARY · {mapLabel}`, the article headline, an italic one-line
pull (first sentence of the prose, clamped), and a mono meta row `{callsign} · {Nh Nm} survived`.
Each card links to its article page. Data: the home RSC fetches page 1 of the existing public
obituaries feed through its own `settleFeed` — independent degradation. **Failed fetch or zero
obituaries → the section does not render at all** (a pitch page never shows an empty morgue or an
error card; this section is proof, and absent proof is silence).

**Beat 3 — Rules of the game.** A full-width strip on `--bone` between 3px ink rules; three
columns (stacking below `md`): `RULE 01 / ONE LIFE` ("Your survival is tracked to the minute,
across every session. The record is public and permanent."), `RULE 02 / DEATH IS REAL` ("Die and
you are banned from that server for 24 hours. No respawns. No exceptions."), `RULE 03 / EARN YOUR
WAY BACK` ("Unban tokens buy you back in early. Earn them by verifying, surviving, and
recruiting. Spend them wisely."). Static copy, no data.

**Beat 4 — CTA slab.** Full-width `--dark`, centered: `YOU GET ONE LIFE. CLAIM IT` (CLAIM IT in
red), mono sub-line `SIGN IN · LINK YOUR GAMERTAG · YOUR LIFE SHOWS UP HERE`, the same red CTA
button repeated (larger), and beneath it the existing `HowToConnect` panel restyled for the dark
surface inside a hairline box, headed "PLAY FIRST, CLAIM LATER — NO ACCOUNT NEEDED TO PLAY".
**This slab replaces `ColdFork` entirely** (the two-cell Already-playing/New-here grid is
deleted); `HowToConnect` itself is reused, not forked — it gains an `onDark` variant since it
currently renders on white (two-surface token rule: the variant must swap tokens, with a test
pinning the swap).

## 3. What goes, what stays

- **`HomeSidebar` renders for VERIFIED users only.** Signed-out, unlinked and pending visitors
  get a single centered column. The xl two-column grid moves into a thin client wrapper
  (`HomeShell`) that applies the grid + sidebar only when `accountStatus` is `verified`; SSR and
  all other states render the single column. (Cookie presence cannot distinguish verified
  server-side; a verified visitor gets the sidebar at hydration — acceptable for glance content
  that is xl-only.) The "nothing actionable may live only in the sidebar" invariant is untouched.
- **`ColdFork` is deleted** (beat 4 is its replacement). `TopSurvivors` (the top-5 board strip)
  **leaves the signed-out home** — the approved design drops the "living few" beat; the component
  itself stays (still used elsewhere? if unused after this, delete it and its tests).
- **The claim/verify ladder for `unlinked`/`pending` is untouched** and stays in the main column
  (those visitors are already converted; they see ladder, not pitch — exactly as today).
- The signed-in (verified) home is untouched apart from the sidebar gating change being a no-op
  for it.

## 4. Data flow

Home (RSC) fetches, each with its own `settleFeed`, all started before the first await so they
run concurrently: servers (existing), survivors board (existing — still needed for the VERIFIED
sidebar), stats (existing, still gated to the signed-out cookie branch), **obituaries feed page 1
(new here; existing public API + web fetcher)**. The obituaries fetch is also gated to the
signed-out branch — signed-in loads must not pay it.

## 5. The full-width headline (`FitLine`)

A small client component `FitLine` renders line 1 so the text fills the content width: SSR
renders at a CSS `clamp()` fallback size; after hydration it measures the text's natural width vs
the container and applies `transform: scale()` (or font-size ratio) so the line spans the
container, re-running on resize (rAF-throttled, observer torn down on unmount). The measurement target is a
hidden clone of the line carrying the FINAL formatted string — never the live line, whose
`CountUp` digits are mid-animation at mount time (numbers stay `tabular-nums`, so the final
string's width is the widest the line will be). `FitLine` must not announce anything
(`aria-hidden` internals unchanged; the sr-only sentence stays the accessible name).

## 6. Testing

- Hero: two-line render with stats (no trailing periods in visible or sr text), fallback
  evergreen render without stats (no zero), CTA link present in both.
- Obituary wall: renders up to 3 cards with links; absent entirely on failed fetch AND on empty
  feed (two distinct tests); never an error/empty shell.
- Rules strip: static render.
- CTA slab: replaces ColdFork for signedOut only; `HowToConnect` onDark token swap pinned.
- HomeShell: sidebar only for verified; single column for signedOut/unlinked/pending/loading.
- Page: obituaries + stats fetches gated to the signed-out branch (not called when signed in);
  each feed degrades independently.
- FitLine: SSR fallback size present; jsdom can't measure layout — the scaling math goes in a
  pure helper with unit tests, and the visual fill lands on the browser checklist.
- Browser checklist (pre-release, real Chrome): headline fills the width at xl and phone widths,
  count-up still lands exactly, obituary cards at 1/2/3 counts, dark HowToConnect legibility.

## 7. Copy inventory (final, from the approved mockup)

- Kicker: `ONE LIFE. NO RESPAWNS — HARDCORE PERMADEATH DAYZ · XBOX`
- H1: `DEATHS TO DATE: {n}` / line 2: `STILL STANDING: {n}` (no periods)
- Deck: "Every life on our servers is tracked to the minute — birth to death, across sessions.
  When you die, the ban is real and the record is permanent."
- CTA button (both): `Claim your life →`
- Section: `THE FALLEN` / `All obituaries →` / card meta `{callsign}` + `{duration} survived`
- Rules: as §2 beat 3.
- Slab: `YOU GET ONE LIFE. CLAIM IT` / `SIGN IN · LINK YOUR GAMERTAG · YOUR LIFE SHOWS UP HERE` /
  connect box heading `PLAY FIRST, CLAIM LATER — NO ACCOUNT NEEDED TO PLAY`.
