# OpenGraph everywhere — design

**Date:** 2026-08-03
**Status:** Approved (brainstorm converged with Steve)
**Goal:** Every user-facing page on dayzonelife.com unfurls well when shared (Discord/X/Facebook)
and presents well to search/AI crawlers. Both link-sharing and SEO matter equally.

## Current state (surveyed 2026-08-03)

Well covered: `/obituaries/[slug]` and `/players/[slug]` (full metadata + bespoke 1200×630
`next/og` cards), `/i/[slug]` invite card, `sitemap.ts`, `robots.ts`. Intentionally bare
(noindex): `/login`, `/welcome`, `/notifications`, `/survivors`, `/maps`, `/maps/[map]`.

Gaps, ranked:

1. `/` (home) has **no metadata export at all**; no site-wide default OG image exists, so the
   most-shared page unfurls as a naked text link.
2. Root layout (`src/app/layout.tsx`) has no `openGraph` block (no `siteName`, `type`,
   `locale`) and no `twitter` block.
3. `/players/[slug]/[map]/lives/[n]` is sitemap'd and highly shareable but has no
   `openGraph`, no `twitter`, no OG image.
4. `/about`, `/terms`, `/privacy` have title + description only — no OG/twitter/canonical.
5. `/obituaries` and `/survivors/[map]` use `twitter: { card: "summary" }` with no image.
6. **Live bug:** pages that hardcode `— One Life` in `title` (player, life, obituary detail)
   also receive the root `%s · One Life` template → doubled suffix, e.g.
   `Life 3 · Livonia — Gamertag — One Life · One Life`.
7. The three existing OG card implementations copy-paste the same chrome (top rule, skull,
   wordmark, stat band, font/asset loading, palette literals) with no shared module.
8. Player-page not-found branch returns only a title — no `noindex`.

## Decisions

- **Bespoke cards everywhere** (Steve's call): a site-wide default card plus per-surface cards
  for the life page, the survivors board, and the obituaries index.
- **Refactor the shipped obituary and player cards onto the new shared shell** — one place to
  evolve the look; their existing tests pin the output.
- `/i/[slug]`'s hand-rolled meta tags stay as-is (cookie-setting route handler; justified).
- Noindex pages stay bare. No sitemap/robots changes.

## Design

### 1. Root defaults — `src/app/layout.tsx`

Add to the root `metadata` export:

- `openGraph: { siteName: "One Life", type: "website", locale: "en_US" }`
- `twitter: { card: "summary_large_image" }`

Keep the existing `metadataBase`, title default/template, description, manifest.

### 2. Title double-suffix fix

Each page that hand-appends `— One Life` either drops the manual suffix (letting the
`%s · One Life` template apply once) or switches to `title: { absolute: … }` — chosen per page
to preserve the intended tab/unfurl text. Affected: `/players/[slug]`,
`/players/[slug]/[map]/lives/[n]`, `/obituaries/[slug]` (verify the full list while
implementing; grep for the literal suffix).

### 3. Shared card shell — `src/lib/og/`

Extract from the three existing renderers:

- **Asset loader**: fonts (`oswald-700`, `plex-mono-400/700`), `skull.png`, `wordmark.png`
  from `src/og-assets/`, inlined as base64 data URIs. **Preserve the load-bearing idiom:
  `import.meta.url` must be bound to a variable, never inlined as the second `new URL()`
  argument** — Vite's asset-URL analyzer mangles the inline form under the vitest transform.
  Keep the ⚠️ comment explaining this.
- **Palette constants**: `DARK #0C0C08`, `PAPER #FBFAF2`, `RED #FF1E12`, `DIM #8A8878`
  (currently duplicated as literals).
- **`CardShell` component**: top red rule, faded skull, wordmark, mono kicker slot, headline
  slot, bottom stat-band slot. Satori-safe: flex only, explicit `display:"flex"` on every
  multi-child container, inline styles, literal hex, no shadows.

Move `/obituaries/[slug]/opengraph-image.tsx` and `/players/[slug]/opengraph-image.tsx` onto
the shell. The invite card (`/i/[slug]/card/route.tsx`) may consume the loader/palette but its
two-column layout stays bespoke; migrate it only if it falls out naturally.

### 4. New OG image routes (all 1200×630 `ImageResponse`, shared chrome)

- **`src/app/opengraph-image.tsx`** — static brand card, no DB reads
  ("One life. One death. 24-hour ban." energy, wordmark + skull). As the root-level image it
  automatically covers `/`, `/about`, `/terms`, `/privacy`, and any future route without its
  own card.
- **`…/lives/[n]/opengraph-image.tsx`** — gamertag, map, life number, lived duration /
  alive-or-dead status, death cause when dead. Sources the same data as the page's
  `generateMetadata`.
- **`…/survivors/[map]/opengraph-image.tsx`** — map name, current survivor count, board
  flavor. Link-preview caches go stale, so copy must age gracefully: state facts as "the
  board", never "right now".
- **`…/obituaries/opengraph-image.tsx`** — masthead-style "The Obituaries" card; include a
  recent-death count only if the read model makes it cheap, otherwise fully static.

All data-reading cards must degrade: a failed fetch renders the branded chrome with the
static text, never an error response (an OG scraper that gets a 500 caches "no image").

### 5. Per-page metadata completion

- **Home `/`**: real `metadata` export — absolute title (e.g. "One Life — hardcore permadeath
  DayZ"), description, canonical `/`, `openGraph` title/description/url.
- **Life page**: add `openGraph` (title, description, url, `type: "profile"` — matching the
  player page it belongs to) and `twitter: { card: "summary_large_image" }`.
- **`/about`, `/terms`, `/privacy`**: add canonical + `openGraph` title/description/url.
- **`/obituaries` and `/survivors/[map]`**: upgrade `twitter` to `summary_large_image`.
- **Player not-found branch**: add `robots: { index: false }`.

### 6. Testing

- Unit tests per new card route, mirroring the existing
  `obituaries/[slug]/opengraph-image.test.tsx` pattern; the two migrated cards keep their
  existing tests as regression pins.
- Metadata assertions per touched page: `generateMetadata` output shape, canonical, OG/twitter
  fields, single title suffix.
- Per house rules, browser/unfurl verification is out of RTL's reach and lands on the
  outstanding-verification list: post-deploy, eyeball each new card at its
  `/opengraph-image` URL and run a fresh Discord/X unfurl of home, a life page, a survivors
  board, and the obituaries index.

## Out of scope

- `/i/[slug]` meta rewrite, sitemap/robots changes, JSON-LD additions beyond what pages
  already have, noindex pages, any visual redesign of the shipped cards' look.
