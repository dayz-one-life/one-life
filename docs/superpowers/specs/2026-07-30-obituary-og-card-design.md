# Obituary OpenGraph card — design

**Date:** 2026-07-30
**Status:** approved (mockup Option A, headline-led, chosen by Steve from rendered variants)

## Problem

`/obituaries/[slug]` declares `twitter:card: summary_large_image` and full OG title/description/URL
— but no image at all. Discord/X unfurls of an obituary render as bare text. The repo already has
the machinery (satori `ImageResponse` cards for the player dossier and the invite link) and the
obituary data is the richest share surface on the site.

## Decision

A new `opengraph-image.tsx` in `apps/web/src/app/(site)/(boxed)/obituaries/[slug]/`, using the
Next file convention so `og:image` + `twitter:image` (with width/height/type) are injected into
the existing page metadata automatically. The absolute image URL comes from `metadataBase`, which
is already `SITE_URL` — the request-origin trap fixed in v0.69.1 cannot recur through this path.

### Layout (Option A — headline-led)

Same visual grammar as the player dossier card (`players/[slug]/opengraph-image.tsx`), 1200×630:

- Dark stage `#0C0C08`, paper text `#FBFAF2`, red `#FF1E12`; Oswald 700 display, IBM Plex Mono
  400/700 utility; skull watermark right at 7% opacity; 6px red rule across the top-left 34%.
- **Top row**: wordmark left (46px tall); kicker right in Plex Mono 700, 22px, letterspaced
  uppercase: `OBITUARY · {GAMERTAG} · {MMM D, YYYY}` with "OBITUARY" in red. Date from `deathAt`,
  UTC, e.g. `JUL 30, 2026`.
- **Headline**: the obituary headline, uppercase, Oswald 700, line-height ~1.04, letter-spacing
  −1, max-width ~1000px. Font size stepped by length (same idea as the player card's `gtSize`):
  ≤45 chars → 76px, ≤75 → 62px, longer → 52px. The stepper is an exported pure function.
- **Bottom strip**: `rapSheetFacts(article)` — Survived / Kills / (Longest kill when present) /
  Cause — capped at four entries, rendered as the existing stat strip (60px values, mono labels,
  hairline top border, inter-stat dividers). `hot` facts (cause) render red. Reusing
  `rapSheetFacts` keeps the card's cause phrase identical to the on-page Rap Sheet
  (`verdictPhrase(verdict, cause)`), since `getObituary` returns the article with its verdict.

### Data and fallback

`getObituary(slug).catch(() => null)`. On null (unknown slug, API down), render the same stage
with the generic headline `AN OBITUARY FROM DAYZ ONE LIFE` and no stat strip — degrade, never
500. This mirrors the player card's "Unknown survivor" fallback and the repo rule that a failed
fetch must not masquerade as authoritative content (here: no invented stats).

### Metadata addition

In the page's existing `generateMetadata`: add `publishedTime: deathAt` (and keep
`type: "article"`). Nothing else changes — title, description, canonical are already right.

## Constraints carried forward

- **`const here = import.meta.url` then `new URL(rel, here)`** for `og-assets` reads — the ⚠️
  shape from v0.69 that empirically survives the prod webpack build; a static-literal "fix" 500s.
  Assets live at `apps/web/src/og-assets/` (five files, shared with the two existing cards).
- OG URLs an external fetcher dereferences must be SITE_URL-based, never request-derived
  (v0.69.1). Satisfied structurally here via `metadataBase`.

## Testing

- Unit: the headline-size stepper (boundary lengths 45/46, 75/76); module exports `size`,
  `contentType`, `alt`; a fact-strip cap test (an article with `longestKillMeters` present still
  renders ≤4 stats).
- Empirical (the repo's own rule for OG renderers: trust `next build` + curl, not analysis):
  `next build`, boot the server, curl `/obituaries/{real-slug}/opengraph-image` for a 200 PNG of
  1200×630, and curl the page HTML to confirm the injected `og:image` is an absolute SITE_URL.
  Eyeball the PNG against the approved mockup, including a long-headline slug for the wrap.
- Post-deploy (goes on the outstanding-checks list): a real Discord unfurl of a fresh obituary
  URL. Discord caches per exact URL — previously-pasted obituary links keep their imageless
  embed until Discord's cache expires.

## Out of scope

- The obituaries index (`/obituaries`) keeps the site-default OG treatment.
- No change to the dossier or invite cards.
- No `article:author`/tag metadata — YAGNI until something consumes it.
