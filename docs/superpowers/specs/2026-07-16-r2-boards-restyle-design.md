# R2 — Boards restyle (survivors 13a + player dossier 13b) — design (2026-07-16)

## Context

Second sub-project of the tabloid redesign roadmap
(`docs/superpowers/specs/2026-07-16-tabloid-redesign-design.md`). R1 shipped the design
system (Paper/Ink/Red RGB-triple tokens, Oswald + IBM Plex Mono, tabloid primitives
`Kicker`/`SectionHeader`/`SkewCta`), the dark masthead/footer shell, front page, About, and
teasers. R2 restyles the two data-backed boards to design-canvas rounds **13a**
(Survivors) and **13b** (player dossier), and lands the board-scoped skeleton/a11y work
folded in from the retired UX-overhaul plan.

Decisions made during brainstorming:

- **Approach: in-place restyle.** Keep the existing component tree and data flow
  (`SurvivorsBoard`/`SurvivorRow`/`Pagination`, `PlayerHero`/`StandingCard`/
  `PastLifeCard`); rewrite markup/classes to the canvas, reusing R1 primitives and adding
  the few new ones R2 needs. Routes, read-models, API, and URL logic untouched. Existing
  prop-based tests updated in place.
- **Dossier hero stays avatar-free** (no Discord avatar, no character portrait in the
  hero); the canvas's Alive ×N badge and first-seen line are adopted around the name.
- **Past-life cards go compact** ("funeral cards"): counts only — kill lists and vitals
  drop from past lives. Per-life detail returns in R4's life timeline (the
  `GET /players/:gamertag/:map/lives/:n` route already exists).
- **Global-rank tiers** on the survivors board: ranks 1–3 get the hero/medium treatment
  wherever they appear (i.e., page 1 only); pages 2+ are all compact rows. Applies to
  every map and sort.
- **A11y scope = boards + site basics**: board items (skeletons, pagination a11y, image
  hygiene, decorative-glyph aria) plus three small site-wide items (skip link,
  `:focus-visible` ring, accessible small-text error red).
- **No backend change.** Everything 13a/13b renders is already served: standing cards
  have `killList`, past lives have `kills`/`longestKillMeters`/`sessions`, the page has
  `firstSeenAt` and per-server standing states.

## 1. Survivors board (13a)

### Container & header

- The board page moves from `max-w-3xl` to the R1 page pattern: `main` as a centered
  `max-w-5xl` column — the same main-column metrics R3's 380px rail slots into without
  relayout.
- Header block per canvas: h1 in Oswald 700 uppercase (54px desktop scale, responsive
  down), sitting on a **3px ink bottom rule**, with a mono uppercase dek under it.
- **h1 text changes**: `Survivors` on the combined board, `{Map} survivors` on a map
  board. The current SEO phrase ("Top {Map} survivors by {sort}") moves entirely into
  page `<title>`/OG metadata (which it already populates); visible sort context comes
  from the active sort tab and the stat column.
- Dek copy (dynamic count, singular-safe):
  `{N} still drawing breath. Every name is one bad decision from Obituaries.`
  (`1 still drawing breath. …` when N = 1.)

### Controls row

- Same `boardHref` URL logic, same `aria-current="page"` on active items.
- **Map tabs** become skewed Oswald chips (`skewX(-5deg)`, Oswald 600 12px uppercase,
  `.09em` tracking): active = solid ink background with paper text; inactive = 1px ink
  outline with ink text. Tab order unchanged (All maps first, then alphabetical).
- **Sort tabs** become right-aligned mono uppercase text links (11.5px, `.05em`
  tracking): active = red, bold, 2px red bottom border; inactive = ink-muted. Order
  unchanged (Time alive → Kills → Longest kill).
- Row wraps on mobile (map tabs first, sorts below); the controls row sits on a 1px ink
  bottom border per canvas.

### Tiered rows

Tier is a pure function of **global rank** (`(page-1)*pageSize + index + 1`):

| Tier | Ranks | Treatment |
|---|---|---|
| Hero | 1 | Tint (`bg-tint`) background row. Grid: 56px rank col / 76px portrait / name block / right stat. Red Oswald 700 numeral at 40px. Gamertag 26px Oswald 700 uppercase. Mono 11px sub-line. Stat: 28px Oswald 700 + mono 10px uppercase label under it (the only row with a stat label). |
| Podium | 2–3 | Red Oswald 700 numeral at 28px, 60px portrait, 21px gamertag, stat in Oswald 700 21px, no label. Hairline (`border-hairline`) divider. |
| Compact | 4+ and all of pages 2+ | Ink Oswald 700 numeral at 20px, **no portrait**, 17px Oswald 600 gamertag with mono 11px map inline after it, stat in bold mono 15px. Hairline-2 (`border-hairline-2`) divider. |

- **Sub-lines / map display**: map shows only on the combined board (existing `showMap`
  rule). Hero sub-line = `{MAP}` (combined only) `· {N} KILLS` — the kills suffix
  appears when kills > 0 and the active sort is not `kills`. Podium sub-line = map only.
  Compact rows put the map inline after the name.
- **Stat rule unchanged**: each row shows only the stat being sorted by, formatted as
  today (`formatTimeAlive`, `{N}m`, integer kills; `—` for null longest kill).
- **Portraits go square** (canvas rect slots; today they're circles): plain `img` with
  explicit `width`/`height` matching the tier (76 / 60), `loading="lazy"`,
  `decoding="async"`, `alt=""` (the adjacent gamertag carries meaning). Silhouette
  fallback block becomes `aria-hidden="true"`. Avatar resolution via
  `avatarSrc(row.character)` is unchanged.
- Gamertags keep routing through `GamertagLink`.

### Pagination & empty state

- Pagination bar per canvas: **3px ink top rule**; left = mono 11.5px
  `SHOWING {from}–{to} OF {total} STILL BREATHING`; right = mono page boxes — current
  page solid ink with paper text, other pages 1px `dash` outline — plus `← PREV` /
  `NEXT →` boxes. Disabled edges render as non-focusable spans (not links), arrows
  wrapped `aria-hidden`. Nav landmark keeps/gains `aria-label`. Tap targets ≥ 44px.
- Empty state reuses the front page's voice: mono uppercase "the coast is quiet"
  treatment on tint (no fake counts; the dek still shows the real 0-count sentence).
- JSON-LD `ItemList`, canonicals, redirects, and all route behavior unchanged.

## 2. Player dossier (13b)

### Container & hero

- Page widens from `max-w-xl` to the same centered `max-w-5xl` column. A mono 11px
  uppercase `← Survivors` back link sits above the hero, linking to `/survivors`.
- Hero (avatar-free), over a **3px ink bottom rule**:
  - Mono 11px uppercase over-line: `FIRST SEEN {MON YYYY}` plus
    `· ALIVE ON {map list}` only when they are alive somewhere (labels via `mapLabel`,
    comma-joined). Line omitted entirely when `firstSeenAt` is null.
  - Gamertag as h1: Oswald 700 uppercase, 60px desktop scale, responsive down.
  - **Alive badge**: solid blue skewed badge next to the name — `ALIVE` when alive on
    exactly one server, `ALIVE ×{N}` for N ≥ 2, absent when alive nowhere.
  - **Verified stamp**: when `page.verified`, an R1-language rubber stamp (rotated ~-6°,
    2px red border, red Oswald uppercase `VERIFIED`) replaces the current pill.
  - **Stat band** adopts the canvas: Oswald 700 32px values + mono 10px uppercase
    labels, ordered **Kills · Lives · Deaths · Longest life**. The existing "Kills only
    when > 0" rule stays. The highlight moves: **Deaths renders in red**; Longest life
    loses its amber/red highlight. The shared `heroStats` helper
    (`@/components/player/format`) carries the order + highlight so the OG dossier image
    inherits the same change (its highlight color updates from the old amber-slot to
    red in the same pass).

### Current standing

- Section h2 per canvas: Oswald 700 20px uppercase, `.1em` tracking (`Current
  standing`). Idle servers stay filtered out (current behavior).
- Cards go **2-up on `md`+, stacked on mobile**; white (`bg-white`) on paper, 1px
  hairline border. State coloring: alive = solid blue chip `ALIVE` (white text); banned
  = solid red chip `BANNED` (white text) **plus a 4px red left border on the card**.
  Chips are Oswald 700 ~11px uppercase.
- Card header: 48px **square** character portrait (same image hygiene as board rows;
  silhouette fallback aria-hidden), map name in Oswald 700 19px uppercase, mono 10px
  sub-line: `ALIVE {duration}` / `DIED — AWAITING RESPAWN`. No TIMELINE link (R4).
- **Alive body**: 3-stat row over a hairline top border — Oswald 700 21px values + mono
  9.5px labels: `TIME ALIVE` / `KILLS` / `LONGEST KILL` (`—` in muted gray when null).
  Below, over another hairline: red Oswald 700 12px uppercase label `KILLS THIS LIFE`,
  then mono 12px kill lines — `✝ {NAME}` left (✝ aria-hidden, name via `GamertagLink`),
  `{WEAPON} · {N}M` right-aligned, muted. Empty state: mono muted
  `NONE YET. THE PACIFIST ERA.` Existing `KillList` limit behavior (10 + overflow line)
  survives, restyled.
- **Banned body**: the canvas "ban lifts" box — paper background, hairline border, mono
  10px `BAN LIFTS IN` left, Oswald 700 18px countdown right (existing `banCountdown`).
  The owner-only self-unban control becomes a red `SkewCta` with the canvas copy
  **`Spend 1 token — skip the wait`**; the four `UnbanState`s
  (hidden/ready/no-tokens/pending) and all gating logic are unchanged, only presentation
  moves (pending/no-tokens/error text in mono small size using the new `red-deep` where
  it's an error).

### Past lives

- Section h2: `Past lives` + mono 12px suffix `· {N} FUNERALS ON FILE`
  (`· 1 FUNERAL ON FILE` when N = 1).
- **Compact funeral cards**, 2-up on `md`+: `bg-archive`, 1px hairline border, **4px ink
  top border**. Contents, top to bottom:
  - Header row: map name Oswald 700 17px uppercase; right-aligned mono 10px
    `{RELATIVE} · LASTED {duration}` (relative from `endedAt`, e.g. `2 DAYS AGO`).
  - Red mono bold 12px death line: `✝ KILLED BY {NAME} · {WEAPON} · {N}M` (killer via
    `GamertagLink`, weapon/distance segments dropped when null) or the non-player form
    `✝ DIED — {CAUSE}.` — reusing/adapting the existing death-formatting logic.
  - Mono 11px counts strip over a hairline: `{N} KILLS · {N}M LONGEST KILL · {N}
    SESSIONS` (`—` for null longest kill).
  - **No kill list, no vitals, no portrait, no obituary link** (obituaries are R5).
- `PlayerPagination` keeps Newer/Older semantics and `?page=` URLs, restyled to the
  board pagination's mono-box language; disabled edges non-focusable.
- `ProfilePage` JSON-LD, canonical (`?page=N` for N > 1), and OG routes unchanged.

## 3. Skeletons, a11y, site basics

### Loading skeletons

- `BoardSkeleton` shared by new `loading.tsx` files for `/survivors`,
  `/survivors/[map]`, `/survivors/[map]/[sort]`; `DossierSkeleton` for
  `/players/[slug]`. Static pulsing tint blocks (`animate-pulse bg-tint`) matching the
  real layouts' metrics (header + rule, controls row, row/card heights, hero band) so
  hydration causes no CLS. Both presentational with render tests.

### Board a11y (from the folded UX plan)

- Pagination: `nav` landmarks with `aria-label`, disabled edges as non-focusable spans,
  `aria-hidden` arrows, ≥44px tap targets.
- Portrait images: explicit `width`/`height`, `loading="lazy"`, `decoding="async"`,
  `alt=""`; silhouette fallbacks `aria-hidden="true"`.
- Decorative glyphs (`✝`, `✓`, chip dots) wrapped in `aria-hidden` spans — surrounding
  text carries the meaning.

### Site basics

- **Skip link**: first child of `body` in the root layout — `sr-only` until focused;
  visible style ink-on-yellow (`focus:bg-yellow focus:text-ink`), jumping to
  `#content` (page wrapper gains the id).
- **`:focus-visible` ring** in `globals.css`: `outline: 2px solid rgb(var(--red));
  outline-offset: 2px;` — visible on paper and on the dark masthead.
- **Accessible error red**: brand red on paper is ~3.9:1 — fine at display sizes, weak
  for small text. Add a `red-deep` token (a darker red, e.g. `#C41208`-range, ≥4.5:1 on
  paper) used for small-size error text; apply it to the error/no-tokens states the
  self-unban button renders. Display-size red stays brand red.

## 4. Testing & verification

- Unit tests per repo convention (presentational by props; thin hooks untested;
  explicit vitest imports): tier selection by rank, controls active states, pagination
  a11y (disabled edges not links), standing-card states (alive/banned chips, red left
  border, kill lines, empty state, ban box), funeral-card content (death line forms,
  counts strip, no kill list), hero (stat order, red Deaths, kills-only-when-positive,
  Alive ×N badge forms, first-seen line forms, verified stamp), skeleton render tests,
  new/changed format helpers.
- Full `pnpm turbo run test --concurrency=1` (DB suites against
  `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test`) +
  `pnpm turbo run typecheck`.
- Chrome visual sweep at 1440px and 390px: combined + map + sort boards (page 1 tiers
  and page 2 compact), player pages covering alive/banned/past-lives cases from the
  restored `onelife_visual` data, skeleton flash, OG image check.

## Explicitly out of R2

Controls rail and `/account`/`/account/claim` surfaces (R3), status banner/masthead slot
changes (R3), legacy token-shim removal and `tint`→`bone` rename (R3), timeline links
(R4), obituary links or any content pages (R5), read-model/API changes (none needed),
gamertag search/filtering.
