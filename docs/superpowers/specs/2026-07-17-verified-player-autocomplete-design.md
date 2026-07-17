# Verified-player autocomplete for Send & Referrer — design (2026-07-17)

## Context

The controls rail's verified state (`apps/web/src/components/controls/tokens-panel.tsx`) has two
free-text inputs — **Send to verified player** (token transfer) and **Referred by** (referral
grant). Both `POST /me/tokens/transfer` (`{ toGamertag }`) and `POST /me/referrer`
(`{ referrerGamertag }`) resolve their target case-insensitively against **verified**
`gamertag_links` and return `not_verified` on a miss. Today the user must type the exact gamertag
blind; a typo just returns an error.

The claim field (`LinkTagPanel`) already solves the same "help the user type a real gamertag"
problem with autocomplete, but over the *opposite* set — **unverified** (claimable) gamertags. This
feature gives the two token fields the same affordance, sourced from **verified** players and
**excluding the signed-in user** (who is always verified in this state and cannot send to / be
referred by themselves).

### Data reality (verified against the codebase during brainstorming)

- `LinkTagPanel` (`apps/web/src/components/controls/link-panel.tsx`) owns the autocomplete pattern
  inline: 200ms debounce, an in-flight **race guard** (`searchSeq`), a **skip-after-pick** flag
  (`skipSearch`), a min-2-char gate, and an inline suggestions `<ul>`. It calls
  `searchClaimableGamertags(q)` (`@/lib/api`) → `GET /api/players/search?q=` →
  `searchClaimableGamertags(db, prefix, 10)` (`packages/read-models/src/claimable.ts`), which
  returns `players` gamertags with **no** verified `gamertag_links` row.
- The API route (`apps/api/src/routes/players.ts`, `GET /players/search`) trims `q`, returns `[]`
  for `< 2` chars, else the read-model with `limit = 10`. It is **public/unauthenticated**.
- Verified gamertags are exactly `gamertag_links` rows with `status = 'verified'`. UP2 migration
  `0006` made that table **verified-unique on gamertag**, so a verified search needs no dedup.
- The current player's verified gamertag is **already in scope** at both `TokensPanel` render sites:
  `rail.tsx:98` (`const gamertag = c.status.link.gamertag`) and `mobile-controls.tsx:39`. No new
  fetch is needed to know who to exclude.
- On mobile, `mobile-controls.tsx` renders `TokensPanel` with `showReferrer={false}` — only the Send
  field exists there.
- Gamertags are already public across the whole site (survivor board, kill lists, player pages), so
  a public verified-gamertag prefix search exposes nothing new.

### Decisions made during brainstorming

- **Extract a shared `<GamertagAutocomplete>`** (user-selected over inlining). One place owns the
  debounce/race-guard/dropdown; `LinkTagPanel` is refactored onto it alongside the two token fields.
- **Exclude the current player client-side**, not in SQL — the rail already knows the gamertag, so
  the endpoint stays stateless/public and never touches session/auth.
- **A separate endpoint** `GET /players/search/verified` (not a `?verified=1` flag on
  `/players/search`) — symmetric with the two distinct read-model names, and the two routes return
  semantically opposite sets.
- **The dropdown becomes an absolutely-positioned overlay** (in a `relative` wrapper) in all three
  consumers. Required because the token fields are a `flex` row (input beside a Send button) where an
  inline `<ul>` breaks layout. For the claim panel this is a minor, accepted visual change: the list
  floats over the "Claim it" button instead of pushing it down.

## Architecture

### Backend

1. **Read-model** `searchVerifiedGamertags(db, prefix, limit): Promise<string[]>`
   (`packages/read-models/src/claimable.ts`, exported alongside `searchClaimableGamertags`):
   select `gamertagLinks.gamertag` where `ilike(gamertag, prefix%)` and `status = 'verified'`,
   `orderBy(asc(gamertag))`, `limit`. Verified-unique on gamertag ⇒ no dedup.
2. **Route** `GET /players/search/verified?q=` (`apps/api/src/routes/players.ts`): mirrors
   `/players/search` — trim `q`, `< 2` chars → `[]`, else `searchVerifiedGamertags(db, prefix, 10)`.
   Distinct static path; no conflict with `/players/search` or the `:gamertag` routes.
3. **Web client** `searchVerifiedGamertags(q)` (`apps/web/src/lib/api.ts`):
   `apiGet<string[]>('/api/players/search/verified?q=' + encodeURIComponent(q))`.

### Frontend

4. **New** `apps/web/src/components/controls/gamertag-autocomplete.tsx` — a controlled
   **input + dropdown** (no wrapping form/button; the parent keeps those and reads `value`). It owns
   the full autocomplete lifecycle extracted verbatim from `LinkTagPanel`:
   - 200ms debounce; min-2-char gate (clears suggestions below 2).
   - Race guard via a `searchSeq` ref (drop out-of-order responses; on error, clear only if current).
   - `skipSearch` ref so selecting a suggestion fills the value **without** re-triggering a search.
   - **Exclusion:** `results.filter(r => r.toLowerCase() !== exclude?.toLowerCase())` — applied to
     fetched results, case-insensitive (matches backend gamertag resolution).
   - Layout: `<div className="relative">` → `<input>` → absolutely-positioned
     `<ul className="absolute left-0 right-0 top-full z-…">`.

   Props:

   ```ts
   {
     value: string;
     onChange: (v: string) => void;
     fetchSuggestions: (q: string) => Promise<string[]>;
     exclude?: string;                 // current player — filtered case-insensitively
     placeholder?: string;
     id?: string;
     "aria-label"?: string;
     inputClassName?: string;          // per-site styling (paper vs. dark)
     listClassName?: string;
   }
   ```

5. **Refactor `LinkTagPanel`** to render `<GamertagAutocomplete>` with
   `fetchSuggestions={searchClaimableGamertags}`, no `exclude`, and its existing input/list classes
   passed via `inputClassName`/`listClassName`. Its `<form>` + "Claim it" button stay.

6. **`TokensPanel`** gains a `myGamertag?: string` prop (optional so the mobile site's
   `string | null` gamertag threads through without a cast), imports `searchVerifiedGamertags` from
   `@/lib/api`, and replaces both raw `<input>`s (Send `to`, Referrer `ref`) with
   `<GamertagAutocomplete fetchSuggestions={searchVerifiedGamertags} exclude={myGamertag} …>`. The
   existing `<form>`s, submit buttons, `send.ok`-clears-`to`, and `showReferrer`/`!referrer.ok`
   gating are unchanged.

7. **Wiring:** `rail.tsx` passes `myGamertag={gamertag}` (its line-98 value, a `string`);
   `mobile-controls.tsx` passes `myGamertag={gamertag ?? undefined}` (its line-39 value is
   `string | null`). Mobile keeps `showReferrer={false}` — only Send is affected there.

## Data flow

User types in Send/Referrer → `<GamertagAutocomplete>` debounces → `searchVerifiedGamertags(q)` →
`GET /api/players/search/verified?q=` → verified `gamertag_links` prefix rows → component filters out
`exclude` (self) → dropdown renders remaining → pick fills the field's `value` (no re-search) →
submit runs the existing transfer/referrer mutation.

## Error / edge handling

- Fetch rejection → suggestions cleared (only if the response is still current), same as
  `LinkTagPanel` today. No user-facing error from search itself; submit errors surface as before.
- Exclusion may leave fewer than `limit` items; the component does **not** backfill (only ever
  removes the single self entry). Acceptable.
- `< 2` chars, whitespace-only, and rapid typing are covered by the min-char gate + debounce +
  race guard.
- Autocomplete only renders where the field renders (referrer hidden on mobile and after set).

## Testing

- **New** `gamertag-autocomplete.test.tsx`: debounce fires once after settle; race guard drops a
  stale response; `exclude` filters self case-insensitively; picking a suggestion fills value and
  suppresses the immediate re-search; `< 2` chars clears suggestions.
- **New** DB test for `searchVerifiedGamertags` added to the existing
  `packages/read-models/test/claimable.test.ts` (mirrors the `searchClaimableGamertags` cases):
  returns only verified, prefix-matched, ordered, limited.
- **Update** `tokens-panel.test.tsx`: mock `searchVerifiedGamertags`, pass `myGamertag`.
- `link-verify-panels.test.tsx` keeps mocking `searchClaimableGamertags` and must still pass after
  the `LinkTagPanel` refactor.
- Containers (`rail`, `mobile-controls`, `use-controls`) stay thin/untested per repo convention.

## Out of scope

- Server-side exclusion / any auth on the search route.
- Changing transfer/referrer request shapes or their `not_verified` semantics.
- Gamertag search anywhere outside the controls rail.

## Shipping

Feature work under solo-maintainer mode: branch `feature/verified-player-autocomplete` off
`develop`, PR into `develop`. `CHANGELOG.md` updated on the PR; `CLAUDE.md` updated as the last step
before opening it (the SP2 controls-rail description gains the two-field autocomplete + the new
`searchVerifiedGamertags` read-model / `/players/search/verified` route).
