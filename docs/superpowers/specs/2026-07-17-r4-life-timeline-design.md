# R4 — Life timeline + obituary/birth groundwork (14a) — design (2026-07-17)

## Context

Fourth sub-project of the tabloid redesign roadmap
(`docs/superpowers/specs/2026-07-16-tabloid-redesign-design.md`). R1 shipped the design
system + shell, R2 restyled the boards, R3 replaced the account surface with the controls
rail. R4 delivers the design-canvas **14a** "life detail" page — a per-life event timeline —
plus the obituary/birth read-model groundwork R5's content engine will consume, built behind
the still-static teasers.

R4 builds on `GET /players/:gamertag/:map/lives/:n` (added v0.11.1). It is one feature branch
→ PR into `develop`, roughly the size of the player-page-redesign PR.

### Data reality (verified against the codebase during brainstorming)

- The per-life API route (`apps/api/src/routes/player-aggregate.ts`) → `getLifeDetail`
  (`packages/read-models/src/queries.ts`) returns the full `lives` row (death attribution +
  vitals), the ordered `sessions`, and the resolved character (`getLifeCharacter`). It does
  **not** return the kill list or qualification timing.
- `getPlayerPage` (`packages/read-models/src/player-page.ts`) **already** computes
  `killList`, `vitals`, `sessions` count, and `longestKillMeters` per past life; R2 only
  *hid* killList/vitals in the funeral-card presentation. Returning per-life detail is a
  presentation/routing decision, not new persistence.
- `getLifeKills(...)` exists and is used by `getPlayerPage`. `lifeQualifiedAt(...)`
  (`packages/read-models/src/qualified.ts`) returns `{ at, by: "playtime" | "kill" |
  "pvp-death" }`; `QUALIFY_SECONDS = 300`. `isLifeQualified` is the boolean gate.
- Death attribution + PvP-vs-environment classification is precomputed and stored on the
  `lives` row (`deathCause`, `deathByGamertag`, `deathWeapon`, `deathDistance`,
  `energyAtDeath`, `waterAtDeath`, `bleedSourcesAtDeath`).
- **No per-kill or per-death coordinates are stored.** `kills` and `lives` carry
  weapon/distance/attribution but no location. Coords live only in `positions`, `hitEvents`,
  `characterSightings`, correlatable only fuzzily by gamertag + timestamp, with no
  coord→region naming anywhere.
- No obituary/birth/fresh-spawn read-models exist; the three teaser pages
  (`apps/web/src/app/{news,obituaries,fresh-spawns}/page.tsx`) are static Server Components,
  `noindex`, sharing `components/teaser-page.tsx`.

### Decisions made during brainstorming

- **Location → withheld bar as voice-only.** Because no kill/death coordinates exist, R4
  does not implement the canvas's "withheld while alive → released with the obituary"
  data reveal. Instead it keeps the **"Positions withheld" notice bar as a pure brand-voice
  policy statement, shown only while a life is alive**, with no per-event redaction and
  nothing revealed after death. The real withheld-then-revealed mechanic (needs a
  coord→region map + the content engine) is R5.
- **Obituary/birth groundwork built now:** `getObituaries` + `getFreshSpawns` read-models +
  public API routes, fully tested. Teasers stay static/unchanged (voice-first — no fake
  counts, no dry copy until R5 can write them).
- **Hero image = the life's character portrait** (`/characters/<name>.webp` via
  `getLifeCharacter`, silhouette fallback), not the canvas's R5 "in-game snapshot" slot.
- **Session granularity: group quiet session runs** — consecutive sessions with no kill
  between them collapse into one `Sessions N–M` row (per the canvas).
- **Captions are deterministic on-brand labels + factual sub-lines — no LLM.** The timeline
  is factual by nature; editorial prose and generated headlines are R5.
- **Timeline page is the home for returned per-life detail.** Funeral cards stay compact and
  gain a `TIMELINE →` link rather than re-inlining the kill list; kills + vitals surface on
  the timeline. This honors R2's "per-life detail returns in R4's life timeline."

## 1. Architecture & backend

### Route

- New public web page **`/players/[slug]/[map]/lives/[n]`** (mirrors the API
  `GET /players/:gamertag/:map/lives/:n`; `slug` = gamertag slug via `playerSlug`, `map` =
  server slug resolved via `resolveServerBySlug`, `n` = life number).
- Server component, SEO-friendly like the dossier: `title` / `description` / canonical
  metadata. **No custom OG image in R4** (defer to R5). Unknown slug/map/n → `notFound()`.
- A `loading.tsx` skeleton for the route (dossier-skeleton language).

### Per-life data extension

The timeline needs kills and qualification timing, which the current per-life path omits.

- Extend the per-life read-model path to also pull `getLifeKills(...)` and
  `lifeQualifiedAt(...)`. The API route returns the raw pieces —
  `{ life, sessions, character, kills, qualifiedAt }` — with no presentation baked in.
  (Concretely: either a new `getLifeTimelineData` read-model wrapping `getLifeDetail` +
  `getLifeKills` + `lifeQualifiedAt`, or extend the existing route composition; the plan
  picks the smaller diff. `qualifiedAt` is `lifeQualifiedAt`'s `{ at, by } | null`.)
- The web mirror type gains `kills: PlayerKill[]` and `qualifiedAt: { at, by } | null`.

### Timeline assembly (pure, web-side)

- A pure helper **`buildTimeline({ life, sessions, kills, qualifiedAt, character }, now)`**
  (e.g. `apps/web/src/lib/life-timeline.ts`) assembles the ordered event list, groups quiet
  session runs, and attaches factual captions. Pure + prop-tested; the read-model stays
  thin and the grouping/caption logic is testable without a DB.
- **Event model** (newest-first ordering), each event `{ kind, at, marker, title, line,
  … }`:
  - `now` — alive lives only. Title "Still drawing breath"; line `{duration} and counting`.
    Blue marker.
  - `death` — dead lives only, terminal-adjacent. Title "Killed by {name}" (name via
    `GamertagLink`) for `deathCause === "pvp"`, else "Died — {cause}". Sub-line
    `{weapon} · {N}m` (segments dropped when null) plus vitals `Energy {e} · Water {w} ·
    bleeding ×{n}` when present. Red marker. **No obituary link** (R5).
  - `kill` — each kill. Title "Kill — {victim}" (victim via `GamertagLink`); line
    `{weapon} · {N}m`. Red marker. A yellow **Longest kill** skew-chip on the life's
    max-distance kill (single winner; ties → earliest).
  - `session` — a session start not absorbed into a group. Title "Session {n} began";
    factual line. Gray marker.
  - `session-group` — consecutive sessions with no kill between them, collapsed. Title
    "Sessions {N}–{M}"; line `{count} logins`. Gray marker.
  - `qualified` — title "Life qualified"; factual line keyed off `qualifiedAt.by`
    (playtime / kill / pvp-death) — e.g. "Five minutes survived — the grace period ends;
    from here, death counts." Blue marker. **No birth-announcement link** (R5).
  - `birth` — terminal (oldest). Title "Washed ashore — life begins"; line "Session 1.
    Grace period active." Gray marker.
- Grouping rule: walk sessions oldest→newest; a run of ≥2 consecutive sessions with no kill
  `occurredAt` falling inside the run's span collapses to one `session-group`; a lone
  session (or one bracketing a kill) stays a `session` row. Deterministic and unit-tested.

### Obituary / birth groundwork (behind untouched teasers)

- **`getObituaries(db, { page, pageSize })`** — recent **qualified** deaths (`isLifeQualified`
  and `endedAt IS NOT NULL`), ordered `endedAt` desc, paginated. Row: gamertag + slug, map +
  slug, lifeNumber, `{ cause, byGamertag, weapon, distanceMeters }`, timeAliveSeconds,
  endedAt. Returns `{ rows, total, page, pageSize }`.
- **`getFreshSpawns(db, { page, pageSize })`** — recent **qualified** lives (births),
  ordered by qualification time desc, paginated. Row: gamertag + slug, map + slug,
  lifeNumber, startedAt, qualifiedAt. Returns `{ rows, total, page, pageSize }`.
- Public paginated **`GET /obituaries`** + **`GET /fresh-spawns`** API routes (Zod `page`
  `.catch(1)`), fully tested. **No UI wiring** — the teasers stay static. Pure foundation
  R5 consumes.

## 2. Timeline page UI (14a)

Sits in the R3 shell (masthead + controls rail slot); single main column matching the
dossier metrics.

### Back link + hero (over a 3px ink bottom rule)

- Mono 11px uppercase `← {gamertag}'s dossier` back link → `/players/[slug]`.
- **Character portrait** left: 132px square, `/characters/<name>.webp` via the resolved
  character (same image hygiene as the boards — explicit width/height, `loading="lazy"`,
  `decoding="async"`, `alt=""`; silhouette fallback `aria-hidden`). Mono `SNAPSHOT · THIS
  LIFE` caption under it.
- Over-line: mono uppercase `A life of {gamertag} · {mapLabel}` (gamertag → dossier) plus an
  **Alive** solid-blue badge when the life is open, or a solid-red **Died** chip when closed.
- **h1** — factual: `Life {n} · {mapLabel}`, Oswald 700 uppercase, 64px desktop scale
  responsive down. (Editorial headlines like the canvas's "The Sakhal streak" are R5.)
- **Stat band** per canvas: `TIME ALIVE · KILLS · LONGEST KILL · SESSIONS · QUALIFIED` —
  Oswald 700 28px values + mono 10px uppercase labels. `QUALIFIED` shows a blue ✓ when
  qualified, `—` when not. `LONGEST KILL` shows `—` when null.

### Withheld bar (voice-only, alive lives only)

- The bone notice bar (`bg-bone`, 1px hairline): Oswald `POSITIONS WITHHELD` label + mono
  copy "This survivor is alive. The desk does not print the coordinates of the living."
- **Omitted entirely once the life is dead** — nothing to reveal, no per-event redaction
  anywhere.

### Timeline ("The record so far" h2)

- Newest-first. Each row a `96px | 1fr` grid: mono time-marker left (blue+bold for
  `now`/`qualified`/`birth`-anchor moments per canvas; muted for the rest), event block right
  with a colored dot on a 2px vertical rail (`border-left`), Oswald title + mono sub-line.
- Row variants render the `buildTimeline` events (§1): `now`, `death` (with vitals sub-line —
  this is where R2's dropped vitals land), `kill` (+ Longest kill chip), `session`,
  `session-group`, `qualified`, `birth`.
- Decorative dots/glyphs (`✝`, chip dots) wrapped `aria-hidden`; names via `GamertagLink`.

## 3. Entry points & the return of per-life detail

The timeline page is the home for the per-life detail R2 stripped; cards link out rather
than re-inlining it.

- **Standing cards** (`apps/web/src/components/player/standing-card.tsx` or equivalent) —
  add the canvas mono `TIMELINE →` link in the sub-line, to the current life's timeline for
  that server. Self-unban CTA, ban countdown, chips unchanged.
- **Funeral cards** (`past-life-card.tsx`) — add a `TIMELINE →` link. The compact counts
  strip is otherwise unchanged; no inline kill list re-added (kills + vitals live on the
  timeline).
- **Survivors board rows** — no timeline links added (board stays lean; rows already route
  to the dossier). Keeps the PR scoped to the dossier↔timeline pair.
- **Link plumbing:** one pure helper **`lifeHref(slug, mapSlug, lifeNumber)`** (alongside
  `boardHref`/`playerSlug`), unit-tested, used by both card types and the timeline's own
  internal links so the URL shape has a single source of truth.

## 4. Testing & verification

Per repo convention — presentational pieces tested by props, thin containers/hooks untested,
explicit vitest imports:

- **Pure helpers:** `buildTimeline` — event ordering (newest-first); quiet-session grouping
  into `Sessions N–M` (run of ≥2, kill-in-span splits, lone session stays); Longest-kill
  chip on the max-distance kill (single winner, tie → earliest); alive → `now` row + withheld
  bar vs dead → `death` terminal row + no bar; qualified caption by `qualifiedAt.by`;
  edge cases (no kills, single session, not-yet-qualified, no character). `lifeHref` URL
  shape.
- **Timeline components:** hero (stat band incl. `QUALIFIED` ✓/—, character portrait +
  silhouette fallback, Alive badge vs Died chip, factual h1); withheld bar (present alive /
  absent dead); each event-row variant; death row with vitals sub-line.
- **Card link additions:** standing card `TIMELINE →`, funeral card `TIMELINE →`.
- **Read-models (DB suites):** `getObituaries` (only qualified + dead; endedAt-desc;
  pagination; attribution fields), `getFreshSpawns` (only qualified; qualification-time-desc;
  pagination). Extended per-life route data returns kills + qualifiedAt.
- **API routes:** `GET /obituaries` + `GET /fresh-spawns` (Zod page `.catch(1)`, shapes),
  extended per-life route.
- `loading.tsx` skeleton render test.
- **Gates:** full `pnpm turbo run test --concurrency=1` (DB suites against
  `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test`) +
  `pnpm turbo run typecheck`. Then a Chrome visual sweep at 1440px + 390px: the timeline page
  for an **alive** life (withheld bar + `now` row) and a **dead** life (death terminal row +
  vitals, no bar) from `onelife_visual`, the new card links, and a console check.

## Explicitly out of R4

- Editorial/LLM captions + generated headlines (R5).
- The "in-game snapshot" image slot / any generated imagery (R5).
- Real location/coordinate data + the "released after death" reveal (R5).
- Obituary/birth **pages**, or wiring the teasers to real data (R5 — teasers stay static).
- Custom OG image for the timeline page.
- Survivors-board timeline links.
- Any read-model persistence/migration change (all data already exists).
