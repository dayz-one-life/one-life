# Sub-project C — Home, three modes

**Date:** 2026-07-24
**Status:** proposed
**Parent:** `2026-07-24-pure-player-app-decomposition.md` (§C)
**Depends on:** B (shipped — PR #266)
**Blocks:** nothing; D runs alongside

---

## 1. What this is

Home becomes the app's control panel. It renders one of three modes off the existing
`accountStatus` union, and for a verified player it is where they see every server they can play,
what state they are in on each, and the one action that state affords.

**Unlike B, this one is not presentation-only.** It needs a read-model change (§3), because the
data to render the states honestly does not exist yet.

---

## 2. The bug this fixes

**`ServerStanding.state === "alive"` currently means "has an open life", not "has a qualified
life".** `profile.alive` is `openLife !== null` (`packages/read-models/src/queries.ts:64`), and
`getPlayerPage` branches on it directly.

So a player inside the five-minute grace period is rendered as **`Qualified · 0h 2m this life`**
(`serverFactLine`, `components/account/format.ts`). That is not a cosmetic slip — it is backwards
in the way that matters most:

- The grace period is the one window where **death is free** and a reroll costs nothing.
- The site currently tells the player, in that exact window, that their life is qualified — i.e.
  that dying now costs them 24 hours.

A player who believes that will not reroll a bad spawn. **This is a live-data-honesty violation of
the same family as the dry-run phantom bans** (v0.29.4): the UI asserts a state the backend has not
established. It has been shipped since the rail existed.

Fixing it is the reason "not yet qualified" is a distinct state in this design rather than a
styling flourish.

---

## 3. Read-model change

`getPlayerPage`'s alive branch gains **`qualified: boolean`** and **`qualifiedAt: Date | null`** on
`AliveStanding`, computed with the existing `lifeQualifiedAt()` over the open life's sessions and
kills.

**⚠️ Qualification stays DERIVED at read time and is never materialized.** This is the
`isLifeQualified` precedent, and it is load-bearing in three places already (the survivors board,
the enforcer, the notifier's `life_qualified` generator). A fourth source of truth — a
`lives.qualified` column — would drift from the other three the first time the fold changed.

**⚠️ There is deliberately no SQL prefilter on `lives.playtime_seconds`.** That column only
advances at session close, so it is stale mid-session — which is exactly the window this feature
exists to describe. `apps/notifier/src/generators/lives.ts` documents the same trap.

The `state` union is **not** widened to `"unqualified"`. The card's state stays
`alive | banned | idle`, and `alive.qualified` refines it. Widening the union would force every
existing consumer (`serverCards`, the dossier, `aliveAnywhere`) to handle a fourth case whose
meaning is "alive, but".

**`aliveAnywhere` keeps its current meaning — an open life, qualified or not.** It feeds the
dossier's `Alive ×N` badge, which is about presence, not leaderboard eligibility. Changing it here
would silently alter a public page this sub-project does not otherwise touch.

---

## 4. The three modes

### 4.1 Cold (`signedOut`)

A pitch, and a **fork**, because the highest-intent visitor is one who already plays and bounces
off marketing:

1. **"Already playing? Claim your life."** → `/login`
2. **"New here? Here's how to join."** → the How to connect panel (§5)

The parent spec notes a referral sub-case (a visitor arriving via `/j/<code>` gets one CTA naming
the referrer). **That is F's**, not C's — `/j/` does not exist yet. C leaves the fork as the only
cold layout, and F adds the named variant on top.

### 4.2 Signed in, no verified gamertag (`unlinked` | `pending`)

A three-step ladder — signed in → claim your gamertag → prove it's you — with the current step
expanded and the others collapsed to a line. Not a pitch; they are already sold.

**⚠️ "Go play a session" is NOT a step.** The claim autocomplete searches gamertags the *logs* have
seen, and anyone can type any gamertag, so **the site can never know whether a signed-in user has
played until they verify**. "Go play" is the **empty state of the claim search**, nowhere else.

The existing `LinkTagPanel` and `ProveItPanel` do the work; C restructures the frame around them.

### 4.3 Verified — the control panel

Grouped server rows, tokens summary, friends.

---

## 5. The verified home

### 5.1 Grouped rows

Group by state in the order the backend already ranks: **`banned → alive → idle`**. One row per
server, **every server always shown** — the fleet is three today and four when Badlands ships, and
a row that disappears when idle makes the player wonder whether the server is down.

A row is self-contained: **pip · server · the one number that matters · the one-word reason · its
own action.**

| State | Pip | The number | Action |
|---|---|---|---|
| `banned` | red | ban countdown | **Spend a token** (§5.3) |
| `alive`, qualified | green | time alive this life | Timeline → |
| `alive`, **not yet qualified** | **amber, hollow** | time until qualification | Timeline → |
| `idle` | neutral | — | How to connect |

**A group holding exactly one row, when it is the only group, renders expanded.** That is the
entire definition of "hero" — no separate hero component, no promotion tie-break, no layout that
only works at N ≤ 3. With one server you get one big row; with four spread across three states you
get three small groups. The rule is a single conditional, and it scales with the fleet by
construction.

### 5.2 The unqualified row

Amber, **hollow** pip — hollow because the state is provisional, and amber because it is neither
safe (green) nor costly (red).

Its number is **time remaining to qualification**, derived client-side from the open life's
`startedAt` + the 300s threshold, capped the same way every other presence-implying duration in
this codebase is: at `lastSeenAt ?? connectedAt ?? now`, **never clamped to `now`** (`survivors.ts`
`livePlaytime`, `queries.ts`, `life-timeline.ts` all do this, and a `Math.min(now, …)` diverges from
them under `servers.clockOffsetMs`).

⚠️ **Qualification is not only about time.** `lifeQualifiedAt` qualifies a life on
`pvp OR playtime ≥ 300 OR a kill in the window`, so a player who throws a punch qualifies
instantly. The countdown must therefore be presented as *"free until"*, not as a guarantee, and the
row must flip to green the moment `alive.qualified` turns true on the next poll rather than when
the local timer expires.

### 5.3 Spend lives on the ban row

Not in the tokens panel. Spending means choosing **which** ban to lift, which is exactly what
`redeem(banId)` takes. A "spend a token" button in a tokens panel has to then ask which server —
a question the ban row has already answered.

The existing `SelfUnbanButton` states (hidden / ready / no-tokens / pending) carry over unchanged,
including the rule that **a dry-run ban is invisible and unspendable** (`bans.dry_run = false` in
both `player-page.ts`'s `activeBans` and `redeem.ts`'s candidate query — do not widen either).

### 5.4 No fake join

There is no "Join server" button, because there is no join URL for a console server. The **How to
connect** panel is: search one site-wide term, then a verbatim list of `servers.name` for every
active server, then "favourite them".

Used in three places — the verified home's idle rows, the cold page, and the claim empty state —
so it is one component. **The server list is derived from `getServers()`**, never hardcoded.

### 5.5 Tokens

A two-line summary — balance and what it is for — with `Earn / buy →` pointing at `/tokens`.
**`/tokens` does not exist until F**, so C renders the summary without the link and F adds it.
Sending and the referrer field stay on `/you`, where B put them.

---

## 6. Honest rendering

Three modes × each panel's loading / empty / failed states is the largest such matrix in the app,
and this is the repo's most-repeated bug class. The rules:

- `useControls` already exposes `standingLoading` and `balanceLoading`. **Gate on them.** Never
  `?? 0`, never `[]`-means-idle.
- A **failed** standing fetch renders an explicit line, not an idle row for every server — an idle
  row is a claim that the player has no life there.
- A **resolved zero** balance renders as a real zero.
- The unqualified countdown renders nothing rather than a negative number if the clock skews.

---

## 7. Out of scope

- **`/tokens`** (F) — C renders the summary, not the destination.
- **The referral cold variant** (F).
- **Anything on `/maps` or the board** (D).
- **Notifications** — the bell and `/notifications` are untouched.

---

## 8. Testing

Unit: the grouping function (`banned → alive → idle`, every server present, the
one-group-one-row-expands rule at N = 1, 3 and 4 servers), the unqualified countdown (including
skew and the pvp-qualifies-early case), and each mode's loading/failed/empty renders.

Read-model: `getPlayerPage` returns `qualified: false` inside the grace window and `true` after
300s of playtime, and `true` immediately after a kill regardless of elapsed time. **Mutation-test
the grace case** — it is the bug this sub-project exists to fix.

Browser: the four-server layout at 320px, and that no action is stranded in the `xl` sidebar.
**Drive real Chrome, not headless** — headless clamps the layout viewport to ~500px CSS (recorded
in `CLAUDE.md` during B).

---

## 9. Deploy

Read-model + web. No migration, no new table, no env var, no worker. Plain `./deploy/deploy.sh`,
**no `--rebuild`** — qualification is derived, so nothing is stored and nothing needs re-folding.
