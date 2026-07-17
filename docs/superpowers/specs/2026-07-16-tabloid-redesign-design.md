# Tabloid redesign — roadmap + R1 "Tabloid shell" design (2026-07-16)

## Context

The brand bible now exists (`../brand/brand-bible.md`, sibling repo — logo kit v2.1 committed)
and a full Claude Design exploration ("One Life Explorations.dc.html", design project
`DayZ Gossip Platform Mockups`) defines the target UI: a light "Clean Glossy" tabloid —
Paper/Ink/Red palette, Oswald + IBM Plex Mono + Helvetica, dark masthead with a raster
wordmark, skewed chips, rubber stamps, datelines. This replaces the current dark
"field journal" theme (olive-black + bone + amber, AnimalsAreLikePeople/Patrick Hand).

Decisions made during brainstorming:

- **Scope: all three tiers**, as sequenced sub-projects (this doc is the roadmap; each
  sub-project gets its own spec → plan → PR cycle when its turn comes; R1 is designed
  in full here).
- **The controls rail replaces `/account` and `/account/claim` entirely** (in R3): the
  rail (desktop) / pill + bottom sheet (mobile) becomes the one account surface; the
  status banner and masthead slot retire with it.
- **The paused UX overhaul plan** (`feature/ux-review-p0`,
  `docs/superpowers/plans/2026-07-15-frontend-ux-overhaul.md`) is retired as a
  standalone effort; its findings become baked-in requirements of the redesign (every
  rebuilt surface ships with proper pending/error/confirm/loading/a11y behavior). The
  already-implemented serverId fix gets cherry-picked or redone in R3.
- **Full 5-item nav from day one** (News · Obituaries · Fresh Spawns · Survivors ·
  About) with in-voice teaser pages for not-yet-real sections.
- **Home is a front-page shell**: the 10a layout built now with real content only
  (manifesto hero, top-survivors block, sign-in CTA); sections swap to real
  news/obits as tiers land so the layout never changes twice.
- **Voice-first**: Obituaries / Fresh Spawns / News pages stay teasers until the
  Tier-3 content engine can write them — the paper never publishes a dry obituary.
  Tier 2's user-visible surface is the life timeline (factual by nature); obituary and
  birth read-models are built as groundwork behind the teasers.

## Roadmap (sub-projects, in order)

| # | Sub-project | Delivers |
|---|---|---|
| R1 | **Tabloid shell** (this spec) | Design system, brand assets, masthead + nav + footer, teasers, About, front-page shell, compat pass, OG sync |
| R2 | **Boards restyle** | Survivors board per 13a; player dossier per 13b; skeletons/a11y from the folded UX plan |
| R3 | **Controls rail** | Desktop rail + mobile pill/sheet (10b–d); link/verify in-rail; wallet + self-unban; retire `/account`, `/account/claim`, status banner, masthead slot; mutation-feedback/confirm patterns |
| R4 | **Life timeline + groundwork** | 14a timeline page (factual captions; locations withheld while alive); obituaries/births read-models + API behind teasers. Note: v0.11.1 already added `GET /players/:gamertag/:map/lives/:n` — R4 builds on it |
| R5+ | **Content engine** (own brainstorm) | Newsdesk app (events → LLM prose via the brand repo's scaffold), OpenRouter image gen; then Obituaries (12a) → Fresh Spawns + home lists → News archive (11a) + news-led home (10a) replace their teasers |

R2 and R3 are independent and may swap or parallelize. Each sub-project is one
feature branch → PR into `develop`, roughly the size of the player-page-redesign PR.

## R1 — Tabloid shell

### 1. Design system & tokens

- **Palette** (in `globals.css` + `tailwind.config.ts`, one light theme; the hard-coded
  `dark` class and `darkMode: "class"` are removed):
  - Brand: `paper #FBFAF2`, `ink #111111`, `red #FF1E12`, `yellow #FFE300`,
    `blue #1552D8`, `bone #EEF0DD`, `dark #0C0C08`.
  - Canvas neutrals: hairlines `#D8D6C6` / `#E4E2D4`, archive-card `#F4F2E6`,
    dark-panel hairline `#26261C`, muted text grays, red-on-dark `#FF6B63`.
  - Semantic aliases per the bible: red = death/breaking, yellow = drama/pending,
    blue = birth/alive.
- **Compat remap**: the old token names (`--bg --panel --panel-2 --line --bone --dim
  --muted --wash --amber --blood --steel`) stay defined but re-point at new-palette
  equivalents (`--bg`→paper, `--bone`→ink, `--blood`→red, `--panel`→bone,
  `--amber`→ink or red case by case, …) so every unrebuilt surface (survivors, player,
  account, login) flips to legible-on-paper automatically. Raw-color stragglers
  (emerald shades, `red-500`) are swept to tokens (old-plan Task 19 folded in). Old
  names are deleted at the end of R3 when nothing consumes them.
- **Typography** via `next/font/google`: Oswald 400–700 (`--font-display`) for
  headlines/nav/chips/buttons; IBM Plex Mono 400/500/700 + italic (`--font-mono`) for
  datelines/labels/stats. Body = Helvetica Neue system stack (no webfont). Anton ships
  only inside the raster wordmark. AnimalsAreLikePeople + Patrick Hand are deleted;
  `font-display` re-points to Oswald; `font-hand` re-points to mono as a compat shim
  until R2 removes its last uses.
- **Signature devices** as small shared primitives (used in R1, reused later): skewed
  chip/button (`skewX(-5deg)`), rubber-stamp label (rotate + 2px red border), 3px ink
  section rule, kicker/eyebrow, dateline, status chips (ALIVE solid blue / BANNED
  solid red / NO LIFE dashed gray).
- **Assets** vendored from `../brand` (source of truth; no cross-repo build
  dependency): `wordmark-primary@{1,2,3}x.png`, `wordmark-onred@2x.png`, favicon set +
  `favicon.ico`. `public/one-life-horizontal.png` and current favicons are replaced.

### 2. Shell — masthead, nav, footer, mobile

- **Masthead** (replaces `header.tsx`): full-width `dark` bar, centered
  `wordmark-primary@2x` (280px desktop / 150px mobile); below a 1px `#26261C`
  hairline, the centered nav: News · Obituaries · Fresh Spawns · Survivors · About —
  Oswald 600 15px uppercase `.12em` tracking, cream links, active page red. Active
  derives from pathname via a pure, unit-tested helper (`/players/*` lights
  Survivors; teaser routes light their own item).
- **Masthead slot**: keeps today's behavior, restyled to sit on the dark bar (mono
  uppercase, cream, red accent) at the bar's right edge. Retires in R3.
- **Status banner**: functionally intact, restyled to the design language (bone
  notice bar with ink border, per 14a's "positions withheld" bar; pending keeps the
  yellow accent). Retires in R3.
- **Mobile masthead** (≤ ~768px): hamburger left (two cream bars + one shorter red),
  150px wordmark centered, compact account slot right. Hamburger opens a full-screen
  dark menu: five nav items stacked in Oswald uppercase, active red, × to close. (The
  canvas shows only the closed state; this is the simplest on-brand open state.)
- **Footer**: dark bar, IBM Plex Mono uppercase — "One Life — a chronicle of the
  living and the dead. · Hardcore · 1PP · US servers".
- **Layout shell**: root layout keeps Masthead → StatusBannerContainer → page →
  Footer. The 1440px two-column grid with the 380px rail is NOT built in R1 (R3); R1
  pages use a single centered column matching the design's main-column metrics so R3
  slots the rail in without relayout.

### 3. Pages

- **Front page `/`** — 10a skeleton, real content only, one component per block so R5
  swaps blocks independently:
  - Standing hero: red kicker `THE PAPER OF RECORD`, Oswald manifesto screamer in
    Last Stringer voice, dek + "the presses are warming up" line (doubles as the news
    teaser), CTA link to About.
  - Top survivors: "STILL BREATHING" header (3px rule + `ALL →` to `/survivors`), top
    5 from existing `GET /survivors` (all maps, time sort), compact 13a text rows —
    rank numeral, gamertag → player page, map, mono time.
  - Sign-in CTA banner (from 15a): dark band, "Get in the paper.", mono strapline,
    skewed Discord-blurple button → `/login`; hidden when signed in + verified.
- **About `/about`** — full 15a: manifesto header, 1/2/3 numbered strip, "rules of
  record" definition list, server cards, CTA banner. Server cards render from the
  same active-server list the survivors board uses (hand-written taglines keyed by
  slug, generic fallback) so new servers appear when activated. All rules copy is
  verified against the actual system during planning (grace-period minutes, emote
  count, token grant amounts) — real mechanics, no design lorem.
- **Teasers `/news`, `/obituaries`, `/fresh-spawns`** — static, no backend: kicker +
  Oswald headline + mono line in Last Stringer voice; no fake counts; `noindex` until
  real.

### 4. OG + metadata sync

- Player OG card: keep Oswald, swap Space Mono → IBM Plex Mono (co-located `.ttf`),
  move to paper/ink/red.
- Favicons/manifest from the brand kit; root metadata (title template, description)
  adopts the masthead slogan ("All the deaths fit to print").

### 5. Testing & verification

- Unit tests per repo convention (presentational components tested by props; thin
  hook wrappers untested): nav active-state helper, hero/CTA/teaser render tests.
- Existing tests asserting old classes (`font-hand`, amber) are updated where the
  compat remap changes them.
- Full `pnpm turbo run test --concurrency=1` + typecheck; then run the app and
  screenshot every route at desktop + 390px widths as the verify step.

### Explicitly out of R1

Controls rail/pill, boards restyle, life timeline, any read-model or API change,
image slots / generated imagery, `/account` and `/account/claim` changes beyond the
automatic token remap.
