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

## 2. The gap this closes

**Corrected 2026-07-24, after reading the code rather than inferring it.** An earlier draft of this
spec claimed the standing renders **"Qualified"** during the five-minute grace period — i.e. that
the site tells a player death costs 24 hours during the window where it is free. **That is wrong,
and the opposite mistake is the real one.**

`getPlayerLives` (`packages/read-models/src/queries.ts:76`) already filters its rows through
`isLifeQualified`. `getPlayerPage`'s `openLife` is drawn from that filtered list, so the `alive`
branch is only ever reached for a life that has *already* qualified. The `Qualified · …` fact line
is accurate wherever it appears.

**The real behaviour: an unqualified life is invisible.** During the grace period the player's own
home page shows that server as **idle** — "Spawn in any time. First 5 minutes are free." — or omits
it entirely if they have no other qualified life there. A player who has just washed ashore, is
holding the controller, and looks at the site, sees no sign of the life they are living.

That is a smaller bug than the one I first described, and a different kind: **an omission, not a
false statement.** It still justifies the "not yet qualified" state, for two reasons:

1. It is the only window in which a reroll is free, so it is the window where a player most wants
   to know where they stand — and it is the one window the site is silent.
2. "Idle" is a positive claim ("you have no life here") that is false while they are playing.

**⚠️ Scope consequence.** Surfacing it is NOT a one-field addition. `getPlayerLives` is the shared
qualified-lives filter behind the dossier's past-life list, the standing, and the totals; making it
return unqualified lives would change all three. The change must therefore be **additive** — a
separate lookup for the open unqualified life — rather than a loosening of that filter. §3 is
written accordingly.

## 3. Read-model change

`getPlayerPage` gains an **additive** lookup: when a server has no qualified open life, query for an
**open life regardless of qualification**, and if one exists emit the card as
`state: "alive"` with `alive.qualified: false` and `alive.qualifiedAt: null`.

**⚠️ Do NOT loosen `getPlayerLives`.** It is the shared qualified-lives filter behind the dossier's
past-life list, the standing and the totals; widening it would silently add provisional lives to a
public profile's history and to the lives/deaths counts. The new lookup is a separate query whose
result is used for the standing card only, and **it must not touch `totals`**.

For a qualified open life the card gains `qualified: true` and the `qualifiedAt` instant, computed
with the existing `lifeQualifiedAt()`.

**⚠️ Qualification stays DERIVED at read time and is never materialized** — the `isLifeQualified`
precedent, already load-bearing for the survivors board, the enforcer and the notifier's
`life_qualified` generator. A `lives.qualified` column would be a fourth source of truth and would
drift the first time the fold changed.

**⚠️ There is deliberately no SQL prefilter on `lives.playtime_seconds`.** That column only advances
at session close, so it is stale mid-session — exactly the window this feature describes.
`apps/notifier/src/generators/lives.ts` documents the same trap.

The `state` union is **not** widened to `"unqualified"`; `alive.qualified` refines it. Widening it
would force every existing consumer (`serverCards`, the dossier, `aliveAnywhere`) to handle a
fourth case meaning "alive, but".

**`aliveAnywhere` keeps its current meaning and must NOT count an unqualified life.** It feeds the
dossier's public `Alive ×N` badge and the survivors board's notion of alive, both of which are
leaderboard-facing. Counting provisional lives there would put grace-period players into a public
count they are not yet part of.

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
