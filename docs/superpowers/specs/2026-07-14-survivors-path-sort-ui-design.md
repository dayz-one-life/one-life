# Survivors page refinements — path-based sort, SEO H1, bigger avatar, single stat

**Date:** 2026-07-14
**Branch:** `feature/survivors-path-sort-ui`
**Scope:** UI/SEO refinements to the existing public survivors leaderboard
(`/survivors`, `/survivors/[map]`). No read-model or projection changes.

## Motivation

The survivors leaderboard works but has rough edges: sort lives in a query string
(`?sort=`) which is weak for SEO and sharing, the default sort (kills) isn't the most
compelling framing, the H1 is generic, the character avatar is small, and every row shows
all three stats even when only one is being sorted on — noisy on mobile.

## Requirements

1. **Default sort → time alive, descending.** (Direction is already always-descending.)
2. **Sort moves from query string into the URL path.** Page stays as `?page=`.
3. **SEO-friendly `<h1>`** on every board page.
4. **Bigger character avatar** (~80px).
5. **Show only the stat being sorted by** (hide the other two).
6. **Rename "Longest" → "Longest kill"** in the row.

## Design

### 1. Default sort

- `parseSort` (`apps/web/src/lib/board-params.ts`) default flips `kills` → `time`.
- API route (`apps/api/src/routes/survivors.ts`) `sort` schema `.catch("kills")` → `.catch("time")`
  for consistency. The web always passes an explicit sort, so this only affects direct API hits.
- Read-model sort direction is unchanged (always descending, nulls last).

### 2. Path-based sort routing

Only **sort** moves to the path; **page** stays a query param.

| URL | Board | Sort |
|---|---|---|
| `/survivors` | Combined (all maps) | time (default) |
| `/survivors/kills` | Combined | kills |
| `/survivors/sakhal` | Sakhal | time (default) |
| `/survivors/sakhal/kills` | Sakhal | kills |
| `/survivors/sakhal/kills?page=2` | Sakhal | kills, page 2 |

Next's app router allows one dynamic segment name per level, so the folders are:

- `app/survivors/page.tsx` — combined board, default (time) sort.
- `app/survivors/[map]/page.tsx` — depth-1 resolver (see below).
- `app/survivors/[map]/[sort]/page.tsx` — map + explicit sort.

**Depth-1 resolution of `[map]`:**
- value ∈ `{kills, time, longest}` → **combined board**, sorted by that word.
  These three become **reserved words** — a server slug can never be one of them.
  - If the word is the default (`time`) → `redirect()` to `/survivors` (avoid duplicate).
- value is a real, active server slug → **that map**, default (time) sort.
- otherwise → `notFound()`.

**Depth-2 `[map]/[sort]`:**
- `map` must be a real active server slug; `sort` must be a valid `SurvivorSort`.
- If `sort` is the default (`time`) → `redirect()` to `/survivors/<map>` (avoid duplicate).
- Invalid map or sort → `notFound()`.

**`boardHref` rewrite** (`apps/web/src/components/survivors/links.ts`): emit paths.
- base = `/survivors` or `/survivors/<slug>`
- append `/<sort>` only when `sort !== "time"` (the default)
- append `?page=<n>` only when `n > 1`

Because `Pagination`, `SurvivorControls`, and the JSON-LD `itemListLd` all already call
`boardHref`, they pick up path URLs with no further change.

**Old `?sort=` query URLs:** dropped. The param is simply ignored (renders default). No
redirect for the old form. The *new* explicit-default forms (`/survivors/time`,
`/survivors/<map>/time`) redirect to the bare path so there's no duplicate-content; our own
links never generate them, and canonical stays self-referential via `boardHref`.

### 3. SEO H1

The `<h1>` in `SurvivorsBoard` becomes `Top {Map} survivors by {sort}`; the combined board
drops the map name. Built from the same `SORT_LABELS` the metadata builder uses
(`longest` already reads "Longest kill" there).

- `/survivors` → **Top survivors by time alive**
- `/survivors/sakhal/kills` → **Top Sakhal survivors by kills**
- `/survivors/chernarus/longest` → **Top Chernarus survivors by longest kill**

The `{n} survivors still drawing breath` subtitle stays beneath the H1.

### 4. Bigger avatar

`SurvivorRow`'s `Avatar`: `h-10 w-10` → `h-20 w-20` on both the `<img>` and the
silhouette-fallback `<span>`; the inline SVG scales up accordingly. The row already wraps to
a column on mobile, so the taller avatar fits.

### 5. Single stat per sort

`SurvivorRow` takes a new `sort: SurvivorSort` prop and renders one stat column instead of
the 3-col grid:
- time → **Time alive** only
- kills → **Kills** only
- longest → **Longest kill** only

`SurvivorsBoard` passes `page.sort` down to each row.

### 6. Label rename

Row stat label `Longest` → `Longest kill` (matches the sort chip and metadata).

## Testing

Repo convention: presentational components are unit-tested by props; thin hook/wrapper
components are untested.

- `board-params.test` — default sort now `time`.
- `links.test` — `boardHref` path output for all four URL shapes + `?page=` combos.
- `survivor-row.test` — single-stat rendering per sort, "Longest kill" label, avatar size class.
- `survivors-board.test` — new H1 wording (combined + map, per sort).
- `survivor-controls.test` / `pagination.test` — path-based hrefs.
- Route-resolution coverage for the `[map]` reserved-word / slug / 404 branches and the
  explicit-default redirect (pure resolver helper, unit-tested).
- `apps/api/test/survivors.test` — default sort `time`.

## Out of scope

- Gamertag filtering.
- Moving pagination into the path (stays `?page=`).
- Sort-direction toggling (stays descending).
- Web display of per-life character head beyond the existing avatar.
