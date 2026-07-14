# UP2 — Global Gamertag Claim + Autocomplete + Web

**Status:** design
**Date:** 2026-07-14
**Sub-project:** UP2 of "Universal Player" (builds on UP1's global `players`). Stacked on the
`feature/up1-global-player` branch; lands with UP1 as one PR/release.

## Goal

Make the gamertag **claim** global (a gamertag is claimed/verified once, by one user, across all
servers) and remove the server dropdown from the claim UI, replacing it with a gamertag
autocomplete over **unverified observed players**. This is the user-visible payoff of the
Universal Player work.

## Model change

`gamertag_links` becomes server-agnostic (migration `0006`):
- drop `server_id`;
- `uniqUserServerGamertag (user_id, server_id, gamertag)` → `uniqUserGamertag (user_id, gamertag)`;
- `uniqVerified (server_id, gamertag) WHERE verified` → `uniqVerified (gamertag) WHERE verified`
  (one person verified per gamertag, globally);
- `byServerGamertag (server_id, gamertag)` index → `byGamertag (gamertag)`.

`verification_challenges` is unchanged (keyed by `gamertag_link_id`).

## Changes

### 1. Schema (migration `0006`)
`packages/db/src/schema.ts` `gamertagLinks`: drop `serverId`, swap the three indexes as above.

### 2. Verifier (`apps/verifier/src/{pg-store,tick}.ts`)
- `findPendingChallenges(gamertag, at)`, `getVerifiedLinkId(gamertag)`,
  `cancelOtherPendingLinks(gamertag, exceptLinkId)` — drop `serverId` from all three.
- `verifierTick`: match by `payload.gamertag` alone; the emote event's `serverId` no longer scopes
  link matching (you can complete verification by performing the emote on ANY server). All other
  logic (monotonic guard, advance, complete → verify + cancel others) unchanged.

### 3. Claim route (`apps/api/src/routes/gamertag-links.ts`)
- `claimBody` = `{ gamertag }` (drop `serverId`).
- D6 "seen as a player" already resolves globally (UP1). D3 "already verified": drop `serverId`
  from the `gamertagLinks` filter (global).
- Link upsert: find existing by `(userId, gamertag)`; insert `{ userId, gamertag, status }` (no
  `serverId`).
- `loadLink` + the 201 response: drop `serverId`.

### 4. Autocomplete
- New read-model `searchClaimableGamertags(db, prefix, limit)` in `packages/read-models`:
  `players.gamertag ILIKE prefix || '%'` AND no `gamertag_links` row with that gamertag +
  `status='verified'`; order by gamertag; limit. (Players are global post-UP1, so one row per
  gamertag.)
- New route `GET /players/search?q=<prefix>` in `apps/api/src/routes/players.ts`: min 2 chars
  (else return `[]`), calls the read-model, returns `string[]`.

### 5. Web
- `apps/web/src/components/claim-form.tsx`: remove the server `<select>` + `servers` prop; the
  gamertag `<Input>` becomes an autocomplete backed by a debounced query to
  `/api/players/search?q=`; `onSubmit(gamertag)`.
- `apps/web/src/app/account/claim/page.tsx`: drop the `getServers` query and the servers-loading
  branch; `onSubmit={(gamertag) => claim.mutate({ gamertag }, …)}`. Update the 422 copy to
  "…on any server yet".
- `apps/web/src/lib/use-gamertag-links.ts`: `useClaimGamertag` payload `{ gamertag }`.
- `apps/web/src/lib/api.ts`: add `searchClaimableGamertags(q)`.

## Testing (TDD)
- `apps/verifier`: tick/store tests match by gamertag; a challenge verifies from an emote on a
  DIFFERENT server than any prior context; only the winning link verifies, others cancel.
- `apps/api`: claim route with `{ gamertag }` (no serverId); D3 global (verified on the gamertag
  blocks a second claimer); `GET /players/search` returns unverified matches, excludes verified,
  respects min-length + limit.
- `packages/read-models`: `searchClaimableGamertags` unit tests (prefix, verified-exclusion, limit).
- `apps/web`: claim-form renders no server select; autocomplete lists suggestions; submitting fires
  `onSubmit(gamertag)`.

## Deployment
Migration `0006` runs in the SAME gated deploy as UP1's `0005` (see the UP1 plan's corrected
Deployment runbook — migrate after `players` is cleared). `gamertag_links` is durable (NOT rebuilt);
prod currently has 0–few rows, so dropping `server_id` is safe. If any pre-existing rows would
violate the new `(user_id, gamertag)` / `(gamertag) WHERE verified` uniqueness, dedup them first
(none expected).

## Out of scope
Nothing — UP2 completes the Universal Player effort. Stats-dashboard display of the global player
remains deferred as before.
