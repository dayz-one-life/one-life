# Cold-home ledger hero — design

**Date:** 2026-07-28
**Status:** Approved

## 1. What this is

The signed-out (cold) home page's hero becomes a dynamic casualty ledger built from real
fleet-wide numbers:

> **Deaths to date: 1,247. Still standing: 38.**

The ledger IS the `<h1>`. The evergreen brand line "One life. No respawns." is demoted to the
kicker — present on every render, never gone. The death figure counts up from 0 to the real
number on load.

Scope: one read-model, one public API route, a rework of `Hero`, a small `CountUp` client
component. Signed-in home is untouched (the pitch block already renders for cold visitors only).
No migration, no worker, no env var — plain `./deploy/deploy.sh`, no `--rebuild`.

## 2. Definitions — one well, all surfaces agree

- **Deaths** = count of **ended qualified lives**, fleet-wide, all time. This matches every other
  surface (the boards' "alive", ban triggers, funeral cards are all qualified lives), so the
  headline can never be accused of books that don't balance against the visible record.
- **Still standing** = currently-open qualified lives across the whole fleet — the survivors
  boards' exact definition, summed over maps.

Unqualified lives (the sub-5-minute grace window) count in neither number.

## 3. Read-model + API

New `getSiteStats(db)` in `packages/read-models` (own file, `site-stats.ts`) returning
`{ deaths: number, alive: number }`.

- **Deaths**: a SQL `COUNT` over lives with `ended_at IS NOT NULL` AND `qualifiedLifeCondition`.
  Using the SQL condition is safe **for ended lives only**: `lives.playtime_seconds` advances at
  session close, so it is stale mid-session (why the notifier must not use it) but final once the
  life has ended — every session of an ended life is closed. A test pins qualified-only and
  ended-only, each proven by mutation (an unqualified ended life and an open qualified life each
  excluded).
- **Alive**: the derived-in-JS path the survivors board uses — load open lives with their
  sessions/kills, filter `isLifeQualified` — so this number and the boards are one fact. The
  candidate set is small (currently-open lives). Deliberately NOT a SQL prefilter, for the same
  staleness reason as above.

Served at a new **public `GET /stats`** route (Fastify, no session, no parameters). Nothing in the
payload is player-scoped, so no cache-control restrictions are needed.

## 4. Hero rework

`Hero` takes an optional `stats?: { deaths: number; alive: number } | null` prop.

- **With stats:** kicker = "One life. No respawns." (replacing "The record of record"); `<h1>` =
  the ledger — "Deaths to date: **{deaths}**. Still standing: **{alive}**." Death figure in red
  display type (≥19px bold, so plain `--red` is legal under the RED POLICY), alive figure in ink,
  labels in mono. The deck paragraph and "How it works →" link stay.
- **Without stats (fetch failed / null):** the exact current hero renders, unchanged — evergreen
  headline, no banner, no zero. A missing number is never rendered as `0` (live-data honesty).

Home fetches via its own `settleFeed(getStats())`, degrading **independently** from the servers
and survivors feeds (house rule; each feed has its own `settleFeed`). The fetch is server-side in
the RSC pass — fresh per load, no polling.

Numbers are formatted with thousands separators (`toLocaleString`-style, deterministic locale
`en-US` so server and client HTML agree).

## 5. Count-up

A small client component `<CountUp value={n} />`, used for the **death figure only** — one moving
number reads better than two; the alive figure just appears.

- SSR / no-JS render the real final number in the HTML — SEO and curl see the truth.
- On hydration, if `prefers-reduced-motion` is not set, animate 0 → n over ~1.5s with rAF,
  ease-out (slams into the final figure). Reduced-motion renders `n` directly, no animation.
- A11y: an `sr-only` static sentence carries the final numbers; the animated span is
  `aria-hidden="true"`. Screen readers hear one clean announcement, never ticking digits.

## 6. Testing

- **Read-model** (`packages/read-models`): qualified-only and ended-only for deaths; alive matches
  the board definition; both exclusions mutation-proven.
- **Route**: shape + public access.
- **Web**: hero with stats renders the ledger `<h1>` and the demoted kicker; hero without stats
  renders the evergreen headline and **no zero anywhere**; `CountUp` renders the final value under
  reduced-motion and in SSR output; the stats feed failing does not disturb the board strip or
  cold fork (independent degradation).
