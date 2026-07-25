# Home is the app — drift correction

**Date:** 2026-07-25
**Status:** agreed

The pure-player-app design phase produced browser mockups
(`.superpowers/brainstorm/22307-1784929197/content/` — `pure-app-ia.html`,
`verified-mobile-v2.html`, `verified-desktop.html` are the authoritative ones). The B/C builds
drifted from them: sub-project B declared "You is a route, not a section of Home" and C then
parked the tokens panel (with Send) on `/you`, leaving the verified home a thin summary. **The
mockups are the approved design; this spec records only the deltas back to them plus four
amendments agreed 2026-07-25.**

## Amendments to the mockups (agreed, current)

1. **No mini-map strip** in the sidebar friends panel.
2. **The alive hero shows time alive only** — no kills / longest / sessions strip anywhere on the
   home cards. These servers are about surviving; the one number is time alive.
3. **No morgue / fresh-spawns blocks** in the sidebar — the content engine is retired.
4. **`/you` is the future avatar menu** (log out, update avatar, …). For now it strips to
   identity + profile link + sign out. Tokens move back to Home.

## The deltas

### 1. The alive card becomes the hero

`ServerCard`'s alive branch renders large: overline `Alive · {map} · Life {n}`, a big time-alive
readout, and two actions — `Timeline →` (existing `lifeHrefBySlug`) and `Open map` (`/maps/{slug}`).
A provisional life (inside the 5-minute window) keeps the hollow "Not yet" treatment and must not
read as qualified. Banned cards keep their current treatment (countdown + Spend — already matches
the mock). Group order stays `banned → alive → idle`.

### 2. Idle rows: `Join ▸` expands in place

Per the chosen mock (verified-mobile-v2, composition B): each idle row carries a `Join ▸`
disclosure that expands the **shared `HowToConnect` content inline** under that row. The single
`HowToConnect` instance below the groups is removed from the verified home (it stays on the cold
fork and the claim empty state). One component, rendered in the expansion — the copy cannot drift.

### 3. Tokens on Home, `/you` stripped

The verified home's `TokensSummary` is replaced by `TokensPanel` (balance + Send). The referrer
form does not render (`showReferrer={false}`) — the manual set-referrer flow is retired ahead of
sub-project F's invite links. `/you` drops the `TokensPanel` and keeps identity, the profile
link and sign out (the seed of the avatar menu).

### 4. Friends online in the main column

The friends panel renders in Home's main column below the tokens block **below `xl`** (the
xl sidebar already carries it; two mounts, one component — the `ControlsRail`/`ControlsSheet`
precedent). Presence + map link only; sharing controls stay on the map's online list (sub-project
E's model supersedes the mock's per-row share toggle here).

### 5. The sidebar earns its column

Per the IA mock, minus the amendments: friends online (existing), **your board standing** — the
top 3 of the board Home already resolves (the same `getSurvivors` fetch the page makes), with the
viewer's own row marked when present — and **notifications** (latest 3 via the existing
`useNotifications` feed, `All →` to `/notifications`). Nothing actionable lives only here.

## Honest rendering

All existing invariants hold: loading / genuinely-empty / failed stay three renders
(`balanceLoading`, `standingLoading`, `serversLoading`, `settleFeed`); no `?? 0`; the board strip
and notifications degrade independently of the friends panel.

## Out of scope (deferred, not dropped)

- Board rank + "your longest run yet / previous best" hero flourishes (need read-model additions).
- The page-header strip on Maps/Leaderboard; leaderboard restyle.
- Share-with-all on the map online list; friend rows linking to servers (E deltas).
- The avatar menu itself (update avatar etc.) — `/you` merely stops holding tokens.
- Hiding the main-column top-survivors strip for verified users (server component cannot know
  auth; acceptable duplication for now).

## Testing

RTL: hero alive card (time-alive only — a test pins the ABSENCE of kills/sessions text), Join
disclosure (expanded content is the shared component, one per idle row), Home renders
`TokensPanel` without the referrer form, `/you` renders no tokens panel, sidebar three-block
composition with each block's loading/failed/empty distinct. Deploy: web-only, plain
`./deploy/deploy.sh`, no `--rebuild`.
