# Contrast & type floors — design

**Date:** 2026-07-20
**Status:** Approved
**Scope:** `apps/web` only. Sub-project 1 of 4 from the 2026-07-20 full-site UX review.
Classes, attributes, and two documented policies — no behavioral changes.

## 1. Problem

The full-site UX review's two systemic findings:

1. **Brand red fails contrast at small sizes.** `--red` (#FF1E12) on paper ≈ 3.7:1 — below the
   4.5:1 AA floor for text under ~19px bold. Small `text-red` leaked across every surface even
   though `--red-deep` (#C41208, 5.8:1) exists and is documented as the small-text red.
2. **Reading text drifts below legibility floors.** Article bodies (the primary reading
   surface) are 14px; About prose 15px; ~15 content elements sit at 9.5–10px inside an
   86-occurrence sub-12px mono idiom that every new surface re-imports.

Plus mechanical CLS/polish items from the same review: wordmark layout shift, board-skeleton
row mismatch, missing `tabular-nums`, ungated `animate-pulse`, missing truncation guards, and
the login form's raw hex + source-order-dependent focus visibility.

## 2. Red policy (documented, then enforced)

**Policy:** `text-red`/plain red foregrounds are reserved for large display text (≥19px bold —
rank digits, hero stats, display headlines) and non-text accents (borders, tints, stamps).
**All small-text red uses `red-deep`.** The policy is written as a comment beside the token
definitions in `globals.css` and added to CLAUDE.md.

**Sweep list (from the review — every small `text-red` → `text-red-deep`):**
- `components/tabloid/kicker.tsx` — the default `color="red"` maps to `text-red-deep`
  (component-level fix; covers home hero, about, login call sites).
- `app/about/page.tsx` — rules-list `dt` labels.
- `components/player/past-life-card.tsx` — death-cause line + killer `GamertagLink`.
- `components/player/standing-card.tsx` — "Kills this life" heading.
- `components/player/player-hero.tsx` — Verified stamp **text** (the stamp border stays
  `border-red`: non-text accent).
- `components/obituaries/obituary-article.tsx` — dateline.
- `components/news/news-article.tsx` — retraction banner text; `components/news/news-status-line.tsx`.
- `components/news/editorial-article.tsx` — draft/retracted banner text.
- `components/survivors/survivor-controls.tsx` — active sort chip.

Red borders/tints and ≥19px-bold red text are untouched everywhere.

## 3. Type-floor policy (documented, then applied)

Three tiers, written beside the tokens in `globals.css` and in CLAUDE.md:

1. **Reading prose ≥ 16px.** `ArticleBody` base becomes `text-base` and its own wrapper gains
   `max-w-[68ch]` (the page shell stays `max-w-3xl`; the measure cap is the body's own).
   About page prose (`text-[15px]` STEPS body + RULES `dd`) → 16px.
2. **Functional content ≥ 11px** — text that IS the information, not a label of it:
   - `components/obituaries/rap-sheet.tsx` `dt`s (10px → 11px)
   - `components/birth-notices/priors-box.tsx` `dt`s (10px → 11px)
   - `components/player/stat.tsx` small-variant sub-labels (9.5px → 11px)
   - `components/life/hero.tsx` labels/overlines currently 10px → 11px
   - `components/notifications/row.tsx` timestamp/meta row (10px → 11px)
3. **Decorative chrome may stay 10px** (kickers, folio lines, overlines whose information
   exists elsewhere). We deliberately do NOT flatten all 86 sub-12px occurrences.

## 4. Mechanical batch

- **Wordmark CLS:** `components/header.tsx` `<img>` gains `width={1641} height={499}`
  (measured intrinsic size; CSS `w-[150px]/md:w-[280px] h-auto` keeps rendering identical,
  the attributes reserve the aspect-ratio box).
- **BoardSkeleton:** compact skeleton rows 7 → 22 (`components/skeletons.tsx`), matching a
  full 25-row page. Known limitation documented in the component comment: page-2+ boards have
  no hero/podium but the skeleton always shows them (a real fix needs client `useSearchParams`
  in loading UI — out of scope).
- **`tabular-nums`:** survivor-row stat values, dossier stat band (`player/stat.tsx`), ban
  countdowns (`controls/server-cards.tsx`, `controls/sheet.tsx`, `player/standing-card.tsx`),
  and the pill token balance.
- **`motion-safe:` on every `animate-pulse`:** `components/skeletons.tsx`,
  `notifications/inbox.tsx`, `app/notifications/loading.tsx`, `controls/rail.tsx` — reduced
  motion gets static placeholder blocks (`motion-safe:animate-pulse`).
- **Truncation guards:** `break-words` on the dossier `<h1>` (`player/player-hero.tsx`);
  `truncate` on survivor-row gamertags (hero/podium/compact variants in
  `survivors/survivor-row.tsx`).
- **Login form (`components/login-form.tsx`):** `bg-[#111]` → `bg-dark-well`; and all four
  `outline-none` occurrences app-wide (`login-form.tsx`, `controls/tokens-panel.tsx` ×2,
  `controls/link-panel.tsx`) become explicit
  `outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red`
  so focus visibility stops depending on the global rule's source-order luck. (Focus outlines
  are non-text: `red` at 3.7:1 clears the 3:1 non-text bar; on the dark inputs it's 5.1:1.)

## 5. Error handling

None applicable — classes, attributes, and comments only. The one behavior-adjacent surface
(skeletons under reduced motion) fails safe to static blocks.

## 6. Testing

- Update existing pinned-class tests where values changed (same assertion strength, new
  values).
- New pins: Kicker renders `text-red-deep` by default; `ArticleBody` paragraph carries
  `text-base` and the wrapper `max-w-[68ch]`; survivor-row gamertag `truncate`; masthead img
  `width`/`height` attributes present.
- Floor guard: a small test asserting the named content files contain no `text-[9` or
  `text-[10` size utilities (rap-sheet, priors-box, stat, life/hero, notifications/row) — a
  cheap regression tripwire for the policy.
- Full suite + typecheck green.

## 7. Non-goals

- No flattening of decorative 10px chrome; no redesign of the mono idiom.
- No `next/image` migration for the wordmark.
- No page-2 skeleton branching.
- Sub-projects 2–4 (SR structure, live-data honesty, pill re-homing) are separate specs.
