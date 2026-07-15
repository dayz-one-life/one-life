# Player Page — Design

**Date:** 2026-07-14
**Status:** Approved design, ready for implementation planning
**Route:** `/players/[slug]`

## Overview

A public, SEO-optimized, share-first **player profile page** at `/players/{url-friendly-gamertag}`.
It tells a survivor's story: their current standing on every server (alive / banned / idle),
their live-life stats, and an expandable history of every past life. It doubles as the
**post-login home** for users whose gamertag is verified, unlocking owner-only actions (spend a
token to self-unban) inline.

Primary intent (in order): **flex/share page first**, utility lookup second.

## Goals

- A rich, shareable per-player page that renders great on mobile and desktop.
- Fully server-rendered and SEO-optimized: metadata, canonical URL, JSON-LD, and a **dynamic
  per-player OpenGraph share image**.
- Surface every per-life stat we can compute today; defer the two expensive/low-confidence ones.
- Show per-server ban status with a live "lifts in Xh" countdown.
- Owner-only inline self-unban (spend token), gated on a **verified** gamertag link.
- Make every gamertag on the site link to its player page (shared component).
- Become the landing page for verified users after login.

## Non-goals (deferred)

- **Distance traveled** — `positions` pings exist but nothing sums them; sampling density
  unverified. Deferred to a follow-up with a data-quality spike.
- **Hits** — `hit_events` exists but has no `life_id`; attribution needs a fuzzy gamertag+time
  window join. Deferred.
- **Ban status as a shaming/utility surface** beyond the owner's own self-unban — we show the
  ban state + countdown, but no cross-player moderation UI.
- Gamertag search/autocomplete entry to player pages (exists elsewhere; not part of this page).
- Absorbing account-management features into the player page (future; account page stays, demoted).

## Stats scope (decided)

**In scope (available today or a small new query):**
- Kills this life (count) · Longest kill (meters) · Time alive / playtime
- Death details: cause, killed-by gamertag, weapon, distance; at-death vitals (energy, water,
  bleed sources); session count
- Character **avatar** (persona name is intentionally **not** shown — avatar only)
- Per-life **kill list** (victim, weapon, distance, time) — needs a small new read-model query
- Cross-server totals: kills, lives, deaths, longest life, alive-anywhere

**Out of scope (this pass):** distance traveled, hits.

## Data model & backend

### Existing building blocks (reused)

- `resolveGamertagBySlug(db, slug)` (`packages/read-models/src/player-aggregate.ts`) — route-param
  resolver (mirrors web `playerSlug`).
- `getPlayerAcrossServers(db, gamertag, now)` — cross-server aggregate + per-map profile.
- `getPlayerLives`, `getLifeDetail`, `getPlayerProfile` (`queries.ts`); `getLifeCharacter`
  (`character.ts`); `livePlaytime` (`playtime.ts`); `isLifeQualified` / `lifeQualifiedAt`
  (`qualified.ts`); `rosterByClass` (`@onelife/domain`).
- `bans` table (`packages/db/src/schema.ts`): `serverId`, `gamertag`, `lifeStartedAt`, `bannedAt`,
  `expiresAt` (nullable lift time), `status` (`pending|applied|lift_pending|lifted|expired|failed`),
  `dryRun`, `liftedAt`. **Active ban** = row for this gamertag+server with `status IN ('applied','pending')`;
  **time remaining** = `expiresAt - now`. **Lift pending** = `status = 'lift_pending'`.
- Tokens (`@onelife/tokens`): `getBalance(db, userId)`, `redeem(db, { userId, banId })`
  (verified-gamertag ownership; sets ban → `lift_pending`; `TokenError` codes
  `no_active_ban|not_owner|insufficient_tokens`).
- Token API: `GET /me/tokens` → `{ balance, transactions }`; `POST /me/tokens/redeem`
  body `{ banId? }` → `{ lifted: { banId, gamertag } }`.

### New read-model — `packages/read-models/src/player-page.ts`

One function assembles the full page payload in a single call (page is SSR; avoid N+1):

```
getPlayerPage(db, gamertag, now): Promise<PlayerPage | null>
```

Returns `null` when the gamertag has no qualified presence anywhere (→ 404).

```
PlayerPage = {
  gamertag: string;
  verified: boolean;                 // an active verified gamertag_link exists for this gamertag
  firstSeenAt: Date;
  aliveAnywhere: boolean;
  heroCharacter: LifeCharacter | null;  // most-recent life's character → hero avatar
  totals: { kills, lives, deaths, longestLifeSeconds };
  standing: ServerStanding[];        // one per ACTIVE server (all active servers)
  pastLives: PastLife[];             // combined across servers, ordered by endedAt desc
}

ServerStanding = {
  serverId: number; map: string; slug: string;
  state: "alive" | "banned" | "idle";
  character: LifeCharacter | null;
  // when alive:
  aliveLife?: { lifeId, startedAt, timeAliveSeconds, kills: number, longestKillMeters, killList: KillRow[] };
  // when banned:
  ban?: { banId: number; bannedAt: Date; expiresAt: Date | null; liftPending: boolean;
          triggeringLife: { serverSlug, lifeNumber } };
}

PastLife = {
  lifeId; serverId; map; slug; lifeNumber;
  startedAt; endedAt; timeAliveSeconds;
  kills: number; longestKillMeters: number | null;
  character: LifeCharacter | null;
  death: { cause, byGamertag, weapon, distanceMeters } | null;
  vitals: { energy, water, bleedSources } | null;
  sessions: number;
  killList: KillRow[];
}

KillRow = { victimGamertag: string; weapon: string; distanceMeters: number; occurredAt: Date }
```

### New read-model helper — per-life kill list

`kills` has no `killerLifeId`, so kills are matched by gamertag + server + time window (same
technique `survivors.ts` already uses for counts):

```
getLifeKills(db, serverId, killerGamertag, startedAt, endedAt | null): Promise<KillRow[]>
```

`WHERE serverId = ? AND killerGamertag = ? AND occurredAt >= startedAt AND (endedAt IS NULL OR occurredAt <= endedAt)`,
ordered `occurredAt DESC`.

### API route

`GET /players/:gamertag` currently returns the older `PlayerAggregate`. Extend this route to
return the richer `PlayerPage` (superset). Update `apps/web/src/lib/api.ts` `getPlayerAggregate`
(→ `getPlayerPage`) and `apps/web/src/lib/types.ts` accordingly. Slug resolution stays server-side
via `resolveGamertagBySlug`; 404 → `{ error: "not_found" }` on `null`.

The existing `GET /players/:gamertag/:map/lives/:n` life-detail endpoint is unchanged (the page
renders all life detail inline, so it isn't used by this page, but the banned card's "view the
life that ended here" link can deep-link to it or to an on-page anchor).

## Frontend

Server components under `apps/web/src/app/players/[slug]/`. New presentational components under
`apps/web/src/components/player/`. Existing survivors board is the structural precedent
(`max-w-*` container, JSON-LD, character avatar helpers).

### Page structure (Option A — responsive)

- **Hero** (`PlayerHero`) — most-recent character avatar, gamertag, verified badge (if
  `verified`), "alive on {servers}" status line, 4 KPI tiles (Kills / Lives / Deaths / Longest
  life). Desktop: avatar+identity left, KPIs pushed right. Mobile: centered stack.
- **Current standing** (`StandingGrid` + `StandingCard`) — one card per **active** server, colored
  by `state`:
  - `alive` (green): 3 stats (Kills / Longest kill / Time alive) + expandable **kill list**.
  - `banned` (red): dimmed avatar, big **"ban lifts in Xh Ym"** countdown (from `expiresAt`),
    link to the triggering life, and the **owner-only** unban action (below). If `liftPending`,
    show the pending state.
  - `idle` (neutral): "No open life. Free to spawn back in."
  - Desktop: grid (2–3 up, `align-items:start` so collapsed cards don't stretch). Mobile: stack.
- **Past lives** (`PastLivesGrid` + `PastLifeCard`) — combined across servers, newest death first,
  each an expandable card. Collapsed: map badge + small avatar + time-alive + kills (+ death cause
  keyword). Expanded (in place, spans full width on desktop): death summary, 4-stat line (Kills /
  Longest kill / Time alive / Sessions), kill list, at-death vitals line.

**Expansion mechanism:** native `<details>`/`<summary>` so all life detail is present in the
server-rendered HTML (crawlable, no JS required, progressive enhancement). No client state needed
for expansion.

**Avatars:** reuse the survivors `avatarSrc(character)` pattern → `/characters/{name}.webp` with
the silhouette fallback for unknown/no character. Persona name is not rendered.

### Owner mode (`SelfUnbanButton`)

A **client** component on the banned card; never affects the public/SEO render (logged-out users
and crawlers get only the countdown).

- **Ownership** = signed-in user has an **active verified** `gamertag_link` whose gamertag matches
  the page gamertag. **Pending links do NOT count** and see no owner options.
- Reads session (client) + `GET /me/tokens` for balance; renders one of four states:
  1. Owner + balance ≥ 1 → primary **"Spend 1 token to unban now"** → `POST /me/tokens/redeem`
     with this server's `banId`.
  2. Owner + balance 0 → disabled "No unban tokens" + how-to-earn hint.
  3. Owner + redeem in progress / `liftPending` → "Unban pending — lifting shortly…".
  4. Not owner / signed out → nothing (countdown only).
- On success the card flips to state 3; it becomes `idle` once the enforcer lifts the ban (subject
  to the enforcer's existing dry-run gate — no change to enforcer behavior).

### Post-login landing & masthead (route linked users here)

Decided: the player page **replaces** `/account` as the home for verified users (account settings
demoted to a menu link).

- **Masthead** (`apps/web/src/components/masthead-slot.tsx`): `verified` branch `href` changes from
  `/account` to `/players/${playerSlug(status.link.gamertag)}` (gamertag already on
  `status.link`). Unlinked/pending unchanged.
- **Post-login redirect:** `login-panel.tsx` sets a static `callbackURL` before the gamertag is
  known, so add an intermediate **resolver route** (e.g. `app/welcome/page.tsx`, server component):
  reads the session + the user's active link and `redirect()`s — `verified` → `/players/{slug}`,
  `pending`/`unlinked` → existing destination (`/account` / `/account/claim`). Point both sign-in
  `callbackURL`s at this resolver. **Pending users are unaffected** (stay in the onboarding flow).
- Update affected tests (`account-status.test.ts`, masthead/header tests) for new hrefs.

### Cross-cutting: gamertag links everywhere

`apps/web/src/components/gamertag-link.tsx` (`<GamertagLink gamertag />` → `/players/{slug}`)
already exists **but is currently unused**. Wire it into every place a gamertag renders:
- `survivor-row.tsx` (currently a raw `<span>{row.gamertag}</span>`).
- Kill lists, death-by attributions, and any other gamertag render sites (including within this
  new page). Linked gamertags whose player has no qualified life will 404 — accepted behavior.

Good for UX and for SEO internal linking.

## SEO

- `generateMetadata` per player: `<title>` = `{gamertag} — One Life DayZ survivor`, meta
  description with key stats, `canonical` = `/players/{slug}`, OpenGraph + Twitter card metadata.
- **Dynamic OG image:** `app/players/[slug]/opengraph-image.tsx` using Next.js `ImageResponse`
  (1200×630): avatar + gamertag + verified status + top-line stats, cached. Fetches a lightweight
  data slice (totals + character); embeds the `.webp` avatar as image data.
- **JSON-LD:** `ProfilePage` with a `Person`/entity `mainEntity` for the survivor. (Survivors board
  uses `ItemList` as precedent.)
- Fully SSR; `<details>` keeps all history in the crawlable HTML.

## Edge cases

- Unknown/never-qualified gamertag → 404.
- Player alive on multiple servers → multiple `alive` standing cards.
- Player exists but no verified claim → page renders publicly, no verified badge, no owner options.
- `expiresAt` null on an active ban → show "banned" without a countdown (fallback to
  `bannedAt + BAN_DURATION_HOURS` if needed).
- Prolific players: lives are naturally rate-limited (a qualified death → 24h ban), so counts stay
  modest; render all past lives for v1. Pagination is a future option if needed.

## Testing (repo convention)

- **Read-models** (`getPlayerPage`, `getLifeKills`): Postgres integration tests via
  `@onelife/test-support` (states: alive/banned/idle standings, multi-server, kill-list windowing,
  no-presence → null, verified vs unverified).
- **Pure helpers** (formatting, countdown/lift-time math, standing-state derivation): unit tests.
- **Presentational components** (`PlayerHero`, `StandingCard`, `PastLifeCard`, kill list,
  `GamertagLink` — already tested): prop-based unit tests. Include the four `SelfUnbanButton`
  visual states by props.
- **Thin wrappers / server components / OG image / resolver route:** untested per convention.
- Update existing tests affected by masthead/redirect href changes.

## Implementation notes

- **Workflow:** this is feature work; per repo guardrails it must be done on a **fork**, on a
  `feature/*` branch, targeting `develop` (the canonical repo blocks feature work here). CHANGELOG.md
  + CLAUDE.md updated as the last pre-PR steps.
- No enforcer/granter/token-ledger behavior changes — the page only reads ban/token state and
  reuses the existing `redeem` endpoint.

## Open risks

- OG `ImageResponse` render cost — mitigate with caching; keep the data slice small.
- Slug collisions / normalization must stay in lock-step between `playerSlug` (web) and
  `resolveGamertagBySlug` (read-models) — they're hand-duplicated; add a shared test vector.
- Extending `GET /players/:gamertag`'s payload — confirm no other consumer depends on the old
  `PlayerAggregate` shape (superset should be safe).
