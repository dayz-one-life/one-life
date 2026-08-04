# Home share card: live ledger

**Date:** 2026-08-04
**Surface:** `apps/web/src/app/opengraph-image.tsx` (the site-wide OG card)
**Status:** design approved

## Why

Two problems with the card shipped in v0.73.0.

**It states something false.** The third stat reads `0` / "second chances". The platform sells
second chances: one unban token lifts one ban, tokens are earned by verifying, surviving and
recruiting, and since v0.72.0 they can be bought outright. `controls-slab.tsx` says so in as many
words — "One token lifts one ban, the moment you spend it." The card is the only place in the
codebase carrying the claim (the other grep hit is the v0.73.0 plan document, a historical record
that stays as written).

**It asserts where the home page proves.** This card is the site's most-shared artifact — for most
visitors it is the first and possibly only thing they see. The home hero sells with a live ledger:
`DEATHS TO DATE: 155` in huge type over `Still standing: 149`. A real number that climbs is
evidence the servers are populated and the stakes are real. `24H / 0 / 1` is assertion, and one
third of it was wrong.

## The card

Chrome is unchanged — the existing `CardShell`: red 34% top rule, faded skull, wordmark,
`DAYZONELIFE.COM` kicker. Only the middle slot and the stat row change.

### Headline — live, mirroring the hero

```
DEATHS TO DATE: 155        ← 96px, Oswald 700, uppercase; the number in RED
Still standing: 149        ← 40px, 600, uppercase; label in DIM, figure in PAPER
```

Same phrasing and the same red-number treatment as `front-page/hero.tsx`, so a visitor who clicks
through lands on the thing they were sold. The count is not a ticker: crawlers cache an unfurl per
URL for days, so the card is a snapshot that only ever undercounts, refreshed whenever a link is
scraped fresh. This is accepted, not engineered around.

### Stat row — static format facts

```
1                 24H                XBOX
LIFE PER SERVER   BAN WHEN IT ENDS   HARDCORE PERMADEATH
```

Deliberately **not** data: these cannot go stale or contradict the site. They answer the two things
a cold DayZ player needs — what the format is, and what platform it runs on.

⚠️ **The token mechanic is deliberately absent, and this is not an oversight.** Naming the way back
in, in the first impression, softens the exact promise that makes the server distinctive. The card
now makes no claim about second chances in either direction; the rules page and Rule 03 on the home
page cover it. A future editor "completing" this row by adding tokens back is reversing a decision,
not fixing a gap.

### Failure path

⚠️ The repo's most-repeated bug class: a failed fetch must never render as an authoritative zero.
When `getSiteStatsCached()` rejects **or** returns `deaths === 0`, the headline falls back to the
evergreen line and the "Still standing" line is not rendered at all:

```
ONE LIFE. ONE DEATH. THE RECORD STANDS.
```

The stat row is unchanged in both states — being static, it is always safe.

Collapsing a real `0` into the failure render is intentional. "Deaths to date: 0" is true on a fresh
database but sells nothing, and the evergreen headline is the better card for that state. The two
states are indistinguishable on the card by design; they are distinguishable in the code.

## Data

`getSiteStatsCached()` from `@/lib/api` — the same fetcher the hero uses, so the card and the page
cannot disagree. `/api/stats` is anonymous and cookie-free, so the card route stays cacheable and
carries no session concerns. Precedent for a data-fetching card is `survivors/[map]`, which fetches
and degrades to a neutral headline on failure; this follows that shape.

## Testing

`opengraph-image.test.tsx` exists and covers the current card. Extend it:

1. **Ledger state** — mocked stats render the count and the survivor figure.
2. **Fetch failure** — rejected fetch renders the evergreen headline and NO count. Assert the
   digits are absent, not merely that the component didn't throw.
3. **Zero deaths** — `{ deaths: 0, alive: n }` renders the evergreen headline, never "0".
4. **Stat row** — present and identical in all three states; pin that the row carries no
   second-chances claim, so reintroducing one fails a test rather than shipping.

Satori renders to PNG, so these assert the element tree the route builds rather than pixels. Card
layout at 1200×630 — headline wrap past five digits, the skull behind the stat row — is not
provable in a test; it was checked by rendering the real card at 155, 12,847 and the failure state
during design.

## Out of scope

- The other pages' cards. `/about`, `/terms` and `/privacy` point at this same card and inherit
  whatever it says; that pointing is PR #357 and is not revisited here.
- The card artwork, skull, palette, and `CardShell` itself.
- The home page's own copy, which is the source material and stays as it is.
