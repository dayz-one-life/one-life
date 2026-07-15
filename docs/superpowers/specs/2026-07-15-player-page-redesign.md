# Player Page Redesign — Design

**Date:** 2026-07-15
**Status:** Approved design, ready for implementation planning
**Builds on:** `docs/superpowers/specs/2026-07-14-player-page-design.md` (the original player page, shipped in v0.10.0)

## Why

The shipped player page (`/players/[slug]`) works but reads as low-quality: the hero crams four stat tiles into a narrow right column, the `<details>` expand/collapse click targets aren't obvious, expanded spacing is cramped, and the two-column grids feel busy. This redesign moves to a **single, roomy column with everything visible** (no expand/collapse), a cleaner hero, clear state-vs-archive color language, and **pagination** so prolific players don't produce an endless page.

Scope is a **visual/layout overhaul + past-life pagination**. No change to what data is shown, the owner-only self-unban, gamertag linking, or the SEO surface (beyond per-page canonical/rel-prev-next).

## What changes

### 1. Hero — avatar-free, full-width stat band
- **Remove the character avatar from the hero.** A player is a global identity across many characters; a single portrait there is misleading. (Character avatars stay on the per-life/standing cards.)
- Centered identity: large gamertag → verified pill (if verified) → a muted "First seen {month year} · Alive on {maps}" line.
- The totals render in a **full-width stat band** below the identity — its own generously-padded row, not a cramped side column.
- **Stat set + highlight rule (applies to the hero band AND the OG card, identically):**
  - Always show **Lives / Deaths / Longest life**. Show **Kills only when kills > 0** — a 0-kills survivor drops the Kills column entirely (no "0 KILLS"); the band becomes 3 columns.
  - **Longest life is always the highlighted (amber) stat** — it's the on-brand "survival" metric, playstyle-neutral, and never zero for a qualified player. Nothing else is highlighted (Kills is a normal value, not the accent).

### 2. Current standing — colored by live state, always expanded
- Single column; **one card per active server**, colored by state:
  - 🟢 **Alive** (green border + faint green fill): avatar + map title + "Alive {duration} · started …" + a 3-stat row (Kills / Longest kill / Time alive) + the **kill list inline** (no toggle).
  - ⛔ **Banned** (red border + faint red fill): dimmed avatar + map + "died {ago} · killed by {who}" + a prominent **"ban lifts in Xh Ym"** countdown and, for the verified owner, the **spend-token unban button** inline.
  - ⚪ **Idle**: neutral, "No open life."
- **No `<details>`/`<summary>`** — content is always visible.

### 3. Past lives — muted archive cards, paginated
- Single column; **muted/neutral cards** (very faint fill, quiet border) so they read as archived history, visually distinct from the live-state standing cards. The death line inside uses a quieter red than the banned card.
- Each card always shows (no toggle): dimmed avatar + map + "{relative date} · lasted {duration}", the death summary, a **3-stat row (Kills / Longest kill / Sessions)** — time-alive is dropped from the row since it's already in the "lasted {duration}" sub-line — the kill list, and the at-death vitals line. (The alive standing card keeps Kills / Longest kill / Time alive, since its header shows a start time, not a duration.)
- **Pagination (server-side):** show **10 past-life cards per page**, ordered newest death first, with a Prev/Next footer ("‹ Newer · Page N of M · Older ›"). Hero + current standing render on **every** page (page-independent); only the past-lives slice changes.

### 4. Spacing & typography
- Roomier: larger card padding, clear inter-card gaps, uppercase section dividers ("Current standing", "Past lives · N") with a hairline rule.
- Stronger hierarchy: larger gamertag, monospace kill metadata, muted labels.

### 5. OpenGraph share card — full redesign
The current OG image is text-only and generic. Replace it with a **survivor dossier** grounded in the permadeath theme (validated visually during design). 1200×630.

- **Palette:** overcast near-black radial background (`#14170f → #0a0c0a → #060706`), bone ink (`#e7e3d7`/`#f3efe4`), weathered amber accent (`#e0a13a`), muted labels (`#7a7568`). A faint 46px tactical grid overlay and a short amber accent bar in the top-left corner.
- **Type:** **Oswald** (condensed, military) for the logo-adjacent callsign + stat numbers; **Space Mono** for the "surviving since" line and stat labels. These must be **loaded into `ImageResponse` as font buffers** (ship the needed weights as local `.ttf`/`.woff` under the app, or fetch at build) — `ImageResponse` does not use system fonts.
- **Content (simplified — this is the full set):**
  - The **real One Life logo** (`one-life-horizontal.png`) top-left, inlined as a data URI / fetched buffer.
  - The **callsign** = gamertag in its **real casing** (Oswald 700, ~120px; **scale the font down for long gamertags** so it never overflows the safe width).
  - **"Surviving since {MON YYYY}"** (from `firstSeenAt`; Space Mono). No maps.
  - The **stat readout** at the bottom, using the **exact same stat set + highlight rule as the hero band** (§1): Lives / Deaths / Longest life always; Kills only if > 0; **Longest life highlighted amber**.
  - **No** eyebrow, **no** maps, **no** alive/dead status stamp.
- **Signature — the logo skull, and only the logo skull:** a large, faint (~7% opacity) motif on the right, bleeding off the edge, using the **skull extracted from the actual logo** — never a different or generic skull (a foreign skull dilutes the brand). Ship a **skull-only asset** (`apps/web/public/one-life-skull.png`, cropped from `one-life-horizontal.png`) and inline it.
- Achievable entirely within `ImageResponse` (flexbox + gradients + `<img>`; no CSS grid, no box-shadow).

## Backend changes

### `getPlayerPage` — paginate past lives
Today `getPlayerPage(db, gamertag, now)` builds **every** past life with full enrichment (per-life `getLifeKills` + session count + character) — O(all lives). For a player with hundreds of lives that's both a huge payload and expensive. Change to paginate:

```
getPlayerPage(db, gamertag, now, opts?: { page?: number; pageSize?: number }): Promise<PlayerPage | null>
```

- Gather the lightweight qualified-ended-life rows across all active servers (for **count + ordering**) — no per-life kill/session/character enrichment yet.
- Sort newest death (`endedAt`) first; take the page slice (`pageSize` default **10**, `page` default 1).
- **Enrich only the page slice** (`getLifeKills` + session count + `charShape`) — turns O(all lives) into O(pageSize) for the expensive work.
- Hero totals, `standing`, and `heroCharacter`… note `heroCharacter` is no longer rendered (hero has no avatar) — it can be dropped from the payload, or left and ignored. **Decision:** drop `heroCharacter` from `PlayerPage` to keep the payload honest (removes a `getLifeCharacter` call per request).
- Add to `PlayerPage`: `pastLivesTotal: number`, `pastLivesPage: number`, `pastLivesPageSize: number`. `pastLives` becomes the current page's slice.

Totals (`kills`, `lives`, `deaths`, `longestLifeSeconds`) still reflect **all** lives — they are computed from the lightweight full set, not the slice.

### API route
`GET /players/:gamertag` gains an optional `?page=` query (Zod, coerce positive int, default 1; out-of-range clamps to the last page or returns an empty slice — match the survivors board's `.catch(1)` behavior). Passes it to `getPlayerPage`. Web `getPlayerPage(slug, page)` client + types updated (`pastLivesTotal/Page/PageSize`, drop `heroCharacter`).

## Frontend structure

Rewrites within `apps/web/src/components/player/`:
- **`player-hero.tsx`** — remove avatar; identity + full-width stat band. (`PlayerAvatar` import goes away here.)
- **`standing-card.tsx`** — drop `<details>`; always-visible content; state-colored container (green/red/neutral); banned card lays out countdown + `SelfUnbanButton` inline.
- **`past-life-card.tsx`** — drop `<details>`; always-visible; muted archive styling.
- **`player-profile.tsx`** — single column (remove `sm:grid-cols-2`), section dividers, and a **pagination control** under past lives.
- **Pagination:** reuse the survivors board's approach. The board's `Pagination` (`components/survivors/pagination.tsx`) is coupled to board hrefs; add a small **`components/player/player-pagination.tsx`** (or generalize) that links `/players/{slug}?page=N` with Prev/Next + "Page N of M". Keep it a server component (plain `<Link>`s).
- **`kill-list.tsx`, `player-avatar.tsx`, `self-unban-button.tsx`, `format.ts`** — largely unchanged. `format.ts` may gain a small **relative-date** helper ("2 days ago") for the life card sub-lines if not already present.

### Page + SEO
- `app/players/[slug]/page.tsx` — read `searchParams.page` (a `Promise` in Next 15), pass to `getPlayerPage`; `notFound()` on null; if `page` exceeds the last page, render the last page (or empty past-lives with the pager showing the real total).
- `generateMetadata` — canonical = `/players/{playerSlug(gamertag)}` for page 1, `?page=N` for N>1; add `alternates` **rel prev/next** (or the equivalent `other` meta) so paginated history is crawlable. Title/description unchanged (page 1 stats).
- `opengraph-image.tsx` — **fully redesigned** (see §5). Page-independent (always all-time stats), so it does not read `?page=`.
- JSON-LD `ProfilePage` — unchanged.

## Testing

- **Read-model** (`getPlayerPage`): update existing tests + add pagination cases — totals reflect all lives while `pastLives` is a `pageSize`-bounded slice ordered newest-first; `pastLivesTotal`/`Page` correct; page 2 returns the next slice; a page beyond the end returns an empty slice with the true total; enrichment happens only for returned lives (assert kill lists present on the slice). Drop `heroCharacter` assertions.
- **API route**: `?page=` parsed/clamped; response carries `pastLivesTotal`/`Page`/`PageSize`.
- **Components** (unit, prop-driven): `player-hero` renders no avatar + the stat band, **omits the Kills column when kills = 0**, and marks **Longest life** as the highlighted stat; `standing-card` renders alive/banned/idle without a `<details>` element and shows content unconditionally (assert no `<details>` in the DOM); `past-life-card` renders full detail with no `<details>`; `player-pagination` builds correct `?page=` hrefs and disables/omits Prev on page 1 / Next on the last page.
- **Stat-band helper** (pure, if extracted): a small function that returns the ordered stat list for given totals (drops Kills when 0, flags Longest life as highlighted) — unit-tested for the with-kills and zero-kills cases. Shared by the hero band and the OG card so they never diverge.
- **Page / OG / metadata**: untested per repo convention (server components / image route), verified by typecheck + `build`. The OG route additionally needs a **manual visual check** (render `/players/<gamertag>/opengraph-image` and confirm logo, skull motif, fonts, and the stat rule) since `ImageResponse` output isn't unit-testable — the design was already validated in the browser during design.

## Non-goals / preserved

- No change to owner-only **verified** self-unban semantics, `GamertagLink` site-wide, or the `ProfilePage` JSON-LD. (The OG image **is** redesigned — see §5.)
- Distance-traveled and hits remain out of scope.
- No per-life detail page (the paginated cards already carry full detail; there's no "condensed log" tail in this design).

## Workflow

Feature work on a fresh `feature/*` branch → PR into `develop` → release. CHANGELOG + CLAUDE.md updated as the last pre-PR steps (CLAUDE.md's player-page bullet gets a redesign note: avatar-free hero, no expand/collapse, state-colored standing, paginated past lives).
