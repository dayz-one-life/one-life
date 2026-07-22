# Identity merge — design

**Date:** 2026-07-22
**Status:** approved, not yet implemented
**Deploy:** `./deploy/deploy.sh --rebuild` (projection shape changes)
**Sequencing:** ships across **two** releases — see §7

## 1. The problem

`players` is keyed by gamertag. `packages/projections/src/fold.ts` resolves a connect with
`store.getPlayer(gamertag)` and creates a row whenever that misses, so **a rename mints a second
player**. One human becomes N identities, and every per-player surface fragments across them:
lives, kill totals, priors, the survivors board, the token ledger, In The Paper.

The reverse case is equally wrong. `players.dayz_id` is written once at creation and never
updated, so a **recycled** gamertag attaches the previous owner's account hash to a new person —
recorded in `CLAUDE.md` as a live hazard for bans.

Both fall out of the same mistake: the gamertag is treated as the identity when it is only a
current label.

## 2. Audit of the production dump

`onelife-pre-v0.37.2-full.sql` — 122 players, 8 gamertag links, 7 verified.

| Check | Result |
|---|---|
| `dayz_id` values held by more than one `players` row | **2 groups, 5 gamertags** |
| `players` with a NULL `dayz_id` | **0 / 122** |
| Gamertags held by more than one `dayz_id` (recycling) | **0** |
| Merged gamertags holding a `gamertag_link` | **0 of 8** |

The two identities:

| hash | current name (most recent) | aliases | lives |
|---|---|---|---|
| `5FE23158…` | `tds maverick12` | `daddyishome` | 3 |
| `7B99B543…` | `sombadyhalp` | `TidierCart8730`, `helpmeplz` | 13 |

Zero recycling means no old URL can currently resolve to a *different* human, and zero affected
links means no verified user is harmed today. Neither is designed around as permanent — see §3
and §6.

## 3. The identity model

**`players.dayz_id` is the identity.** The fold resolves a connect by hash first and gamertag
second. A rename finds the existing row; a recycled gamertag resolves to a different person.

**`players.gamertag` becomes the CURRENT name** — the most recently seen one.

This is a deliberate, narrow reversal of the "casing frozen at first sight" rule shipped in
migration `0024`. That rule exists because denormalised copies of a gamertag would desync from
`players.gamertag`. Renames are a different case: a historical `kills.killer_gamertag` *should*
keep the name used that day — it is a record of who someone was, not a foreign key. Casing
remains frozen; only a genuine rename moves the current name.

**New `player_gamertags` projection table** — `(player_id, gamertag, first_seen_at,
last_seen_at)`, one row per name a player has used.

- It is **derived from the event log**, so it joins the truncate list in
  `apps/projector/src/rebuild.ts` and is rebuilt like every other projection.
- **No global unique on `gamertag`.** Recycling is zero today but real on Xbox, and a global
  unique would crash the ingest the day it happens. Uniqueness is per player
  (`(player_id, lower(gamertag))`); resolution picks the most recent holder.

### 3.1 The alias-set consequence

Player-scoped read models currently match a single gamertag string (`getLifeKills`,
`getPlayerPage`, the survivors board). For a merged player they must match the **alias set** —
`IN (…)` rather than `= …`. This is the part that makes this a sub-project rather than a
migration, and it is where the implementation effort actually lands.

## 4. The fold, and why the merge is the rebuild

`onConnected` becomes:

```
getPlayerByDayzId(hash)
  → found:     update the current gamertag if it changed; upsert the alias row
  → not found: getPlayer(gamertag)   // hit/build events carry no hash
  → still not found: createPlayer
```

**No data migration merges anything.** `rebuildAll` truncates `players … RESTART IDENTITY
CASCADE` and re-folds from event 0, so the five gamertags collapse into two identities as a
consequence of the new resolution rule. The merge is not a script anyone has to trust — it is the
projection, recomputed from the source of truth.

Merged players' lives **renumber** per server, in time order, so their `/lives/{n}` URLs shift.
That affects two players (3 and 13 lives) and is precisely why `CLAUDE.md` forbids keying anything
durable on `life_number`.

## 5. Slug resolution and the redirect

`resolveGamertagBySlug` (`packages/read-models/src/player-aggregate.ts`) is the single choke point
for URL → player, so it grows one fallback: match `players.gamertag`; else match
`player_gamertags`, most recent holder winning; and report **which** it matched.

The player page `permanentRedirect()`s (308) to the current slug when resolution came from an
alias. Every historical link then works: old shared links, an obituary byline naming who someone
was in June, a `GamertagLink` in a kill list.

The sitemap continues to list **current names only**. Aliases redirect, and `CLAUDE.md` forbids
the sitemap advertising a URL that redirects.

## 6. Ownership paths

Three checks stop comparing gamertag strings and compare identity instead, each resolving a
verified link's gamertag through the alias table to a `player_id`:

- token redemption / self-unban (`packages/tokens/src/redeem.ts`)
- the player page's verified stamp (`packages/read-models/src/player-page.ts`)
- the owner-only life map (`GET /me/lives/:mapSlug/:n/track`)

Without this, a verified user who renames silently loses the ability to spend a token on their own
ban — `redeem` matches links to bans by gamertag, and bans are written from `players.gamertag`,
which now moves. That is the same failure mode fixed for casing in `0024`, and no user is affected
today only because zero merged gamertags hold a link.

Broader gamertag-keyed surfaces — In The Paper, notifications, friends — are **out of scope** and
deferred to a later sub-project (§9).

## 7. Migration and deploy — a two-release sequence

`players.dayz_id` **cannot** become unique in the migration that ships this, because the duplicates
still exist when it runs: `deploy.sh` executes the migrate phase *before* the rebuild phase.

- **This release:** migration `0025` creates `player_gamertags` and a **non-unique** index on
  `players.dayz_id`. Deploy with `./deploy/deploy.sh --rebuild`.
- **The following release:** migration `0026` promotes `players.dayz_id` to unique, once the
  rebuild has demonstrably collapsed the duplicates. Verify first:
  `SELECT dayz_id, count(*) FROM players GROUP BY 1 HAVING count(*) > 1;` must return zero rows.

The rejected alternative was performing the collapse in hand-written SQL inside `0025` so the
constraint could land immediately. That means writing a merge that duplicates what the fold
already does correctly, and trusting it against live data on its first and only run. Letting the
event log be the source of truth is worth one extra release.

## 8. Testing

Every test proven red before its fix, as with `0024`.

**Load-bearing:**

1. **A rename resolves to one player.** An event stream where one `dayz_id` connects as `A`, then
   later as `B`, produces ONE `players` row, with `gamertag = B` and two `player_gamertags` rows.
2. **A recycled gamertag resolves to two players.** Two different hashes using the same gamertag
   produce two rows — the inverse of test 1, and the case a naive gamertag-keyed fold gets wrong.
3. **Slug resolution prefers current over alias**, and reports which matched.
4. **The player page 308s** from an alias slug to the current slug.
5. **Each of the three ownership checks follows a rename** — in particular, a renamed verified user
   can still self-unban.

**Supporting:** `player_gamertags` is truncated and rebuilt by `rebuildAll`; `first_seen_at` /
`last_seen_at` are maintained across repeat connects; alias-set matching returns kills recorded
under a previous name.

## 9. Explicitly out of scope

- **The full identity-aware sweep** — articles, notifications, bans, tokens, friends following the
  person across a rename. Roughly 60 comparison sites plus several partial expression indexes
  built on gamertag expressions. Its own sub-project, after this one.
- **Merging by any signal other than `dayz_id`.** Same-console alt accounts have distinct hashes
  and are distinct people.
- **Exposing rename history in the UI.** The alias table makes it possible; showing it is a
  separate editorial decision, and naming someone's former callsigns in public is not obviously
  desirable.
