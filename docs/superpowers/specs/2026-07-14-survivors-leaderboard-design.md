# Survivors Leaderboard (`/survivors`) — Design

**Date:** 2026-07-14
**Status:** Approved (brainstorm), pending implementation plan
**Branch:** `feature/survivors-leaderboard`

## 1. Goal

A public, SEO-friendly, mobile-first **live leaderboard of currently-alive survivors**. One
row per alive survivor, ranked by a chosen metric. It embodies the One Life concept: you
appear on the board *only while your current life is alive* — die, and your record leaves the
board with you.

This replaces the earlier "all players, per-server columns" idea. It is not a full player
directory; it is a living leaderboard.

## 2. Scope

### In scope
- Three+ routes: `/survivors` (all maps), `/survivors/chernarus`, `/survivors/sakhal`, and any
  future map via a dynamic slug route.
- Server-rendered, query-param-driven **sort** and **pagination** (shareable/crawlable URLs).
- Five displayed fields per row: **avatar, gamertag, time alive, kills (this life), longest kill (this life)** — plus a **map badge** on the combined board.
- A new read-model that lists alive survivors with these aggregates (set-based, not N+1).
- New public API endpoint(s).
- Web page (App Router server components), responsive cards→rows, masthead nav item.

### Out of scope (explicitly deferred)
- Dead players, ban status, verified badge, career totals, "# of lives", longest life.
- "Current killstreak" — dropped: for alive-only rows it is identical to kills-this-life
  (every kill this life happened without dying). A damage-reset streak (kills since last hit)
  was considered and rejected for MVP.
- Online/offline indicator (a life can be open while the player is logged off). Future nicety.
- Player detail pages (already exist elsewhere; may be linked from a row later).

## 3. Definitions & semantics (decided)

- **Alive survivor:** a player with an **open, qualified life** on a given server — i.e. a
  `lives` row with `endedAt IS NULL` that satisfies `isLifeQualified` (`QUALIFY_SECONDS = 300`,
  or a kill in-life, or `deathCause = 'pvp'`). This matches `Profile.alive` semantics. Fresh
  spawns under the qualification threshold do **not** appear until qualified (avoids board spam).
- **Rows are per (player × server).** Lives are per-server, so a player alive on both maps
  appears as **two rows** on the combined `/survivors` board (one per map). On a single-map page
  they appear once.
- **Time alive = active playtime**, not wall-clock. Computed via `livePlaytime(storedSeconds,
  openSession, upTo)` with `upTo` capped at `players.lastSeenAt` (heartbeat). A logged-off player
  with an open life stays on the board but their time freezes. Consistent with the rest of the product.
- **Kills (this life):** `count(kills)` where `killerGamertag = player.gamertag AND serverId =
  server.id AND occurredAt >= life.startedAt` (life is open, so no upper bound).
- **Longest kill (this life):** `max(kills.distance)` over the same predicate. `NULL` distance
  rows ignored; if none, display `—`.
- **Avatar:** the character of the **open life**, resolved via `getLifeCharacter(db, serverId,
  gamertag, life.startedAt, null)` → `characterClass` → `rosterByClass(class)` → `.name` →
  `/characters/${name.toLowerCase()}.webp`. Unknown/modded class → neutral silhouette placeholder.

## 4. Routing

Next.js App Router, under `apps/web/src/app/survivors/`:

- `survivors/page.tsx` — combined board (all active, slugged maps). Map badge shown per row.
- `survivors/[map]/page.tsx` — single-map board. `[map]` validated against `servers.slug`
  (`resolveServerBySlug`); unknown slug → `notFound()` (404). Map badge omitted (redundant).

Future maps require **no code change**: add a slugged, active `servers` row and its
`/survivors/<slug>` page resolves automatically. The combined board and the map toggle both
enumerate active slugged servers dynamically (as `getGlobalRoster` already does).

All pages are **server components** so the ranked, paginated HTML is crawlable.

### Query params (validated with zod; invalid → default, never 500)
- `sort`: `kills` (default) | `time` | `longest`
- `page`: 1-based integer ≥ 1 (default `1`); out-of-range high → empty page (not error)
- Direction is fixed **descending** for all three metrics (higher = better). No `dir` param
  for MVP (can add later without breaking existing links).
- **Page size:** 25 rows.
- **Deterministic tie-break:** primary metric desc, then `timeAlive` desc, then `gamertag` asc —
  so ordering is stable across requests and pages.

Canonical example: `/survivors/chernarus?sort=kills&page=2`.

### Pagination UI & links (decided: server pagination links)
Rejected infinite scroll / lazy loading — it would undercut the SEO + linking + Discord-unfurl
goals that drove the routing design. A progressive "Load more" (append + `pushState` URL sync) is
a possible **later** enhancement, not MVP.
- Rendered as real `<Link>` elements (`◀ Prev  1 2 [3] 4 5  Next ▶`), each preserving the current
  `map` and `sort` and setting `page`. Works without JS; crawlable; deep-linkable.
- Derived from `SurvivorsPage.total` + `pageSize`. `Prev` hidden/disabled on page 1; `Next`
  hidden/disabled on the last page. Windowed page numbers for large totals.

## 5. Backend

### 5.1 Read-model — `packages/read-models/src/survivors.ts`

```ts
export type SurvivorSort = "kills" | "time" | "longest";

export interface SurvivorRow {
  gamertag: string;
  map: string;            // servers.map, e.g. "chernarusplus"
  slug: string;           // servers.slug, e.g. "chernarus"
  timeAliveSeconds: number;
  killsThisLife: number;
  longestKillMeters: number | null;
  character: {
    name: string | null;    // "Helga" | null
    head: string | null;    // roster head key, for asset fallback
    gender: string | null;
  } | null;
}

export interface SurvivorsPage {
  rows: SurvivorRow[];
  total: number;          // total alive survivors matching the map filter (for pagination)
  page: number;
  pageSize: number;
  sort: SurvivorSort;
}

export function getAliveSurvivors(
  db: Database,
  opts: { slug?: string; sort: SurvivorSort; page: number; pageSize: number },
  now: Date,
): Promise<SurvivorsPage>;
```

Implementation notes:
- **Set-based, not N+1.** A single SQL pass over active slugged servers computes, per open
  qualified life: the open session for live playtime, `killsThisLife`, and `longestKillMeters`
  (LEFT JOIN/lateral aggregate on `kills`). Qualification is applied in SQL where feasible
  (playtime ≥ 300s OR has an in-life kill OR `deathCause = 'pvp'` — though an open life has no
  deathCause, so effectively playtime-or-kill).
- Character resolution: batch-resolve for the page's gamertags (the alive set is small — tens,
  maybe low hundreds). Prefer a set-based query mirroring `getLifeCharacter`'s logic over the
  page's `(serverId, gamertag, startedAt)` tuples; per-row calls are an acceptable fallback given
  small N, but the batched form is the target to avoid N sighting-queries.
- Sorting and `LIMIT/OFFSET` happen in SQL using the decided tie-break. `total` is a `COUNT`
  over the same alive+qualified predicate (map-filtered) for pagination controls.
- `slug` omitted → all active slugged servers; `slug` set → that server only.

### 5.2 API route — `apps/api/src/routes/survivors.ts`

Public (registered outside the `if (opts)` auth block, alongside the other read routes):

- `GET /survivors?sort=&page=&pageSize=` → `SurvivorsPage` (all maps)
- `GET /survivors/:slug?sort=&page=` → `SurvivorsPage` (single map); unknown slug → `404 { error: "not_found" }`

zod-validate query (`sort` enum default `kills`; `page` coerced int ≥1 default 1; `pageSize`
capped, default 25) and `:slug` (`z.enum` of active slugs, or resolve-and-404). Return the plain
object (Fastify serializes). Mirror existing handler style in `routes/player-aggregate.ts`.

## 6. Web

### 6.1 Data fetching
Add typed wrappers in `apps/web/src/lib/api.ts`:
```ts
export const getSurvivors = (params: { slug?: string; sort: string; page: number }) =>
  apiGet<SurvivorsPage>(`/api/survivors${slug ? "/" + slug : ""}?sort=${sort}&page=${page}`);
```
Fetch **server-side** in the page component (like the login page), reading `searchParams`.
Duplicate `SurvivorsPage`/`SurvivorRow` types into `apps/web/src/lib/types.ts` (project convention;
no shared type package).

### 6.2 Components (`apps/web/src/components/survivors/`)
- `SurvivorsBoard` (server) — receives `SurvivorsPage` + current route/slug + params; renders header,
  control bar, list, pagination.
- `SurvivorControls` — the filter/sort bar. **Map toggle = `<Link>`s** to `/survivors`,
  `/survivors/chernarus`, `/survivors/sakhal` (active from route). **Sort chips = `<Link>`s**
  that set `?sort=` (preserving map, resetting `page=1`).
  - **Gamertag filter — OPEN DECISION (flagged for review).** A purely client-side filter only
    searches the current 25-row page, which misleads (typed name may be on page 3). Two honest
    options: **(a)** defer the filter to post-MVP (the board is for ranking; player lookup exists
    elsewhere), or **(b)** make it a server param `?q=` that filters the alive set before
    sort/paginate (cheap — the alive set is small). Recommendation: **(a) defer** for MVP to avoid
    a half-working control; add `?q=` later if wanted. The mock's filter box is illustrative.
- `SurvivorRow` — one leaderboard entry. **Responsive:** stacked card on mobile (avatar+gamertag
  line, then a 3-tile stat strip), horizontal row on desktop (rank → avatar → gamertag + map badge,
  three right-aligned stat tiles). Single ranked column; top-3 get a faint amber border.
- `MapBadge` — green (Chernarus) / ice-blue (Sakhal); shown only on the combined board.
- `Pagination` — prev/next + page number as `<Link>`s preserving `sort`.
- Avatar: plain `<img src="/characters/${name}.webp">` (project uses plain `<img>`, not
  `next/image`); silhouette fallback on `null`/unknown.

Styling uses existing Tailwind semantic tokens (`bg-panel`, `border-line`, `text-bone`,
`text-amber`, `text-muted`) and `font-display` for the title. Palette matches the mockups.

### 6.3 Masthead
Add a `<Link href="/survivors">Survivors</Link>` nav item in `apps/web/src/components/header.tsx`
between the logo and the account CTA (CTA keeps `ml-auto`). Active-state styling optional.

### 6.4 SEO & pagination metadata
Per-route `generateMetadata(props)` reads the resolved `map` + `sort` + `page` and emits:
- **Title/description** per map+sort, e.g. "Top Chernarus survivors by kills — One Life"; include
  "· Page N" for N>1. Empty/unknown handled gracefully.
- **Self-referential canonical** — each page canonicals to *itself* (including `sort`/`page`), **not**
  to page 1. (Current Google guidance; do not collapse paginated pages to a single canonical.)
- **`rel="prev"` / `rel="next"`** `<link>` tags where applicable. Google no longer uses these for
  indexing but Bing does and they're harmless/semantic. Emit via the `alternates`/`other` metadata
  or a small head element.
- **Open Graph + Twitter card** per route+params (`og:title`, `og:description`, `og:url`, an
  `og:image`) — this is the **Discord/social unfurl** path for shared leaderboard links; high value
  for this community. `og:url` matches the canonical.
- **Optional (nice-to-have):** `ItemList` schema.org JSON-LD of the ranked rows for rich results.
- Because rows render server-side, each `map`/`sort`/`page` combination is a distinct crawlable,
  linkable, unfurlable ranked page.

## 7. Edge cases
- **No alive survivors** (map or all): friendly empty state, HTTP 200.
- **Unknown/modded character class:** silhouette placeholder; still ranked normally.
- **Player alive on both maps:** two rows on combined board; one row per single-map page.
- **Logged-off but alive:** shown; `timeAlive` frozen at last heartbeat.
- **`longestKill` with no ranged kills:** display `—`; sorts as lowest under `sort=longest`.
- **Ties:** deterministic tie-break (§4) keeps pagination stable.
- **`page` beyond last:** empty rows, valid `total`; UI shows "no more" / clamps.
- **Invalid `sort`/`page`:** coerced to defaults, never an error.

## 8. Testing
- **Read-model** (`packages/read-models/test/survivors.test.ts`, Postgres harness): alive-only
  filtering; qualification gate (unqualified fresh spawn excluded); per-life kill/longest scoping
  to `startedAt`; two-map player yields two rows; sort + tie-break; pagination `total`/`LIMIT`;
  character resolution incl. unknown-class fallback.
- **API** (`apps/api/test/survivors.test.ts`): route shapes, default/invalid params, unknown slug
  404, single-map vs combined.
- **Web** (`*.test.tsx`, Vitest + Testing Library): `SurvivorRow` responsive render, `MapBadge`
  presence rules, control links build correct hrefs (sort resets page), pagination hrefs,
  avatar fallback.

## 9. Deliverables checklist
- [ ] `packages/read-models/src/survivors.ts` + export + tests
- [ ] `apps/api/src/routes/survivors.ts` + register in `app.ts` + tests
- [ ] `apps/web/src/app/survivors/page.tsx` + `survivors/[map]/page.tsx` + `generateMetadata`
- [ ] `apps/web/src/components/survivors/*` + tests
- [ ] `getSurvivors` in `lib/api.ts`; types in `lib/types.ts`
- [ ] Masthead `Survivors` nav link
- [ ] CHANGELOG.md + CLAUDE.md updates (pre-PR)
