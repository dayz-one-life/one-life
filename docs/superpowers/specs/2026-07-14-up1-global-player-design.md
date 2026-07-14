# UP1 — Global Player Identity + Projection Refactor + Rebuild

**Status:** design
**Date:** 2026-07-14
**Sub-project:** UP1 of the "Universal Player" effort (UP2 = global gamertag claim + autocomplete + web, specced separately).

## Goal

Make a **player a global identity** keyed by gamertag (one row per gamertag across all
servers), while **lives remain per-server**. This is the correct domain model for DayZ Xbox,
where a gamertag uniquely identifies one person. No user-facing change in UP1 — it is the
foundation the global gamertag claim (UP2) rests on.

**Decided:** "one life" stays **per-server** (a player has one active life on each server;
death-ban policy is unchanged). The global player only unifies identity and cross-server stats.

## Key facts that shape the design

- Lives are **already** managed per `(serverId, playerId)` in the fold
  (`getOpenLife`, `getMaxLifeNumber`, `createLife` all take `serverId`). So `life_number` is
  already per-server-per-player. **The only real change is resolving/creating the player by
  gamertag alone instead of `(serverId, gamertag)`.**
- `players.current_life_id` has **no readers** anywhere (the fold only writes it). With a global
  player holding open lives on multiple servers a single pointer is wrong, so it is **dropped**.
- Projections are derived from the **immutable `events` log**. The data migration is therefore a
  **truncate + rebuild**, not a hand-written row migration.

## Changes

### 1. Schema (migration `0005`)
- `players`: drop `server_id`; drop `current_life_id`; replace unique index
  `players_server_gamertag_uniq (server_id, gamertag)` → `players_gamertag_uniq (gamertag)`.
- `lives`: **unchanged** (`server_id` + `player_id` stay; `player_id` now references the global
  player). `life_number` stays per `(server_id, player_id)`.
- No other projection table changes (`sessions`, `kills`, `hit_events`, `positions`,
  `build_events` reference `player_id`/`server_id`, both still valid).
- `gamertag_links`, `bans` untouched (UP2 / durable).

### 2. Store interface (`packages/projections/src/store.ts` + both stores)
- `getPlayer(gamertag)` — drop `serverId`.
- `createPlayer(gamertag, dayzId, seenAt)` — drop `serverId`; upsert conflict target becomes
  `players.gamertag`.
- Remove `setCurrentLife` and `PlayerRow.currentLifeId`.
- `getOpenLife`, `getMaxLifeNumber`, `createLife`, sessions, etc. keep `serverId` — unchanged.

### 3. Fold (`packages/projections/src/fold.ts`)
- Change the 6 `store.getPlayer(e.serverId, tag)` calls → `store.getPlayer(tag)`.
- Change the connect handler's `createPlayer(e.serverId, tag, …)` → `createPlayer(tag, …)`.
- Remove the two `setCurrentLife` calls (lines ~45, ~84).
- Life resolution (`getOpenLife(serverId, playerId)`) is unchanged — still per-server.

### 4. Postgres store (`apps/projector/src/pg-store.ts`)
- `getPlayer`: `where gamertag` (drop serverId clause).
- `createPlayer`: insert `{ gamertag, dayzId, firstSeenAt, lastSeenAt }`; `onConflictDoUpdate`
  target `[players.gamertag]`, set `lastSeenAt`.
- Remove `setCurrentLife`.

### 5. Read-models (`packages/read-models`)
- `queries.ts` (roster, ~lines 35/65): resolve player by `gamertag` alone; keep the per-server
  scoping by filtering **lives/sessions** on `serverId`, not the player row.
- `player-aggregate.ts`: already gamertag-based; simplifies (one player row per gamertag now).
- `leaderboards.ts` / `global.ts`: joins are by `player_id`; per-map scoping stays on
  `lives.server_id`. Review each query and adjust any `players.server_id` reference.

### 6. Enforcer
- No policy change. It works off qualified per-server deaths (lives + server) and bans by
  gamertag on that server's Nitrado list. Verify its queries don't reference `players.server_id`;
  adjust if any.

## Data rebuild (the migration)

1. Apply migration `0005`.
2. Truncate the **derived** projection tables (players, lives, sessions, kills, hit_events,
   positions, build_events, consumer_cursors) — NOT `events`, `raw_lines`, `bans`,
   `gamertag_links`, `character_*`.
3. Run the projector **rebuild** (`apps/projector` `rebuild` script) to replay `events` → the fold
   regenerates one global player per gamertag with per-server lives.
4. Verify: `players` has one row per distinct gamertag; total lives count is unchanged from
   pre-rebuild; a spot-check gamertag that played both servers has one player row and lives on
   both `server_id`s.

## Testing (TDD)

- `packages/projections`: update `memory-store` to the global model; fold tests assert a gamertag
  seen on two servers yields **one** player with a life per server; life_number increments
  per-server; no `currentLifeId`.
- `apps/projector`: `pg-store` test for global `getPlayer`/`createPlayer` upsert-by-gamertag; a
  rebuild test (two servers, same gamertag → one player, two lives).
- `packages/read-models`: adjust fixtures that insert `players` with `server_id`; assert roster /
  leaderboards / player-aggregate still correct under global players.
- `apps/enforcer`: confirm existing tests pass unchanged (or adjust fixtures).

## Out of scope (UP2)

`gamertag_links` server-decoupling, the server-agnostic claim route, verifier match-by-gamertag,
the non-verified autocomplete endpoint, and the web claim-form changes.

## Risks & rollback

- **Rebuild on prod data**: the rebuild is deterministic from `events`; if anything looks wrong,
  re-truncate + re-run. `events`/`raw_lines` are never mutated, so it's always recoverable. Take a
  `pg_dump` of the projection tables (or the whole DB) before the prod rebuild as a belt-and-suspenders checkpoint.
- **Duplicate-gamertag merge**: handled implicitly by the rebuild (the fold creates one player per
  gamertag); no manual row-merge needed. Existing per-server duplicate rows vanish on truncate.
- **Blast radius**: contained to projections + read-models + one migration; the enforcer and the
  event log are effectively untouched.
