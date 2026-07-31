# Update round v0.69 — design

Date: 2026-07-30. One spec, one PR. Seven changes: the referral form slims down, the invite link
gets a real unfurl, the friends feature is removed, the dossier shows every map, the life timeline
gets the dark-stage hero, and encounters join the timeline.

## 1+2 · Referral form slim-down

The "Share to" targets did not work the way Steve anticipated; they go, and the controls slab's
two halves re-balance around what remains.

- `apps/web/src/components/account/share-bar.tsx`: delete the `TARGETS` array, the icon row, the
  "Share to" label, and the native `navigator.share` "More…" button (and its capability check).
  The component becomes: link field + **Copy link** button + the `aria-live` copy confirmation.
  The ⚠️ comments documenting the Discord/native-share constraints leave with the row they
  document.
- `apps/web/src/components/account/controls-slab.tsx`: delete `EarnChips` and `EARN_RULES`. Both
  halves now share the shape `h2 + inline figure → sentence → field+button (mt-auto) → hint`, so
  the send field and the link field sit on one line again and the bottom edges stay aligned. The
  chip row existed to mirror the share row (its own comment says so); the earn rule survives in
  the invite hint.
- Tests: drop target-row and native-share assertions; keep copy-confirmation, pending-figure, and
  hydration-safety tests. Add an RTL test pinning that both halves render exactly one control row.

## 3 · Invite unfurl (`/i/{gamertag}`)

The handler currently 307s, so unfurlers get nothing to read. It keeps setting the referral
cookie but returns **200 HTML** — an interstitial every caller gets (no UA sniffing):

- OG + Twitter meta (`og:title`, `og:description`, `og:image` absolute, `og:url`,
  `twitter:card: summary_large_image`), `robots: noindex`.
- `<script>location.replace("/")</script>` plus `<noscript><meta http-equiv="refresh"
  content="0;url=/"></noscript>` so humans bounce immediately, JS or not.
- Copy: title `{GAMERTAG} dares you to survive DayZ One Life`; description `One life. One death.
  One 24-hour ban. Earn your way back or stay in the dirt.`
- The gamertag is HTML-escaped everywhere it is interpolated. A non-storable slug sets no cookie
  and renders generic copy (`Someone dares you…`).
- The 307-shape tests become 200-shape tests; cookie behavior tests carry over unchanged.

### The card (`/i/{slug}/card`)

A Route Handler using `ImageResponse` (satori), 1200×630, same fonts/assets as the dossier card
(Oswald 700, IBM Plex Mono 400/700, wordmark, skull). Design converged 2026-07-30 (artifact
`a3b` + kicker K5):

- Ground `#0C0C08`, text `#FBFAF2`, red `#FF1E12`, dim `#8A8878`.
- **Left column** (fills remaining width, `justify-between`, padding `60px 56px 60px 74px`):
  wordmark top-left (46px tall); skull at 6% opacity bottom-left, overflowing the frame;
  center block = gray mono kicker `{GAMERTAG} IS OUT THERE WAITING` (22px, ls 3px, bold) over the
  Oswald headline `COME DIE WITH ME.` (126px, lh .94, uppercase, two lines) with **DIE** in red;
  baseline row = `EVERY LIFE ENDS IN AN OBITUARY. YOURS IS WAITING.` (17px mono, dim, nowrap) left
  and `DAYZONELIFE.COM` (17px mono bold, paper, nowrap) right.
- **Right spine**: 300px wide, solid red, three **equal thirds** (`flex:1`, each
  `justify-center`), dividers `2px rgba(251,250,242,.35)` between thirds. Each third: Oswald 44px
  nowrap label + mono 15px sublabel at .75 opacity — `ONE LIFE / No respawns`,
  `ONE DEATH / It counts`, `24H BAN / Then earn it back`.
- Kicker overflow guard: when `{GAMERTAG} IS OUT THERE WAITING` exceeds ~34 characters, drop the
  kicker font a step (same `gtSize` trick as the dossier card) so a long gamertag never wraps it.
- Generic variant (non-storable slug): kicker `SOMEONE IS OUT THERE WAITING`.
- No box-shadow, no non-flex layout — everything above is satori-safe as previewed.

## 4 · Friends teardown

Friendship existed for map sharing; session-scoped grants (sub-project E) made it unnecessary.
Everything friendship-shaped goes; everything grant-shaped stays.

**Deleted**

- `packages/friends`: `pair.ts`, `mutations.ts`, `queries.ts`, `presence.ts`, `errors.ts`, and
  the friend-request/accepted notification builders in `notify.ts`, plus their tests.
- `apps/api/src/routes/friends.ts` + tests; the presence/share_presence parts of
  `preferences.ts`.
- `apps/notifier/src/generators/presence.ts` + tests — nobody gets an online push anymore.
- Web: `/friends` page + loading, the nav entry, `components/friends/*`, `FriendButton` (and its
  render site on the dossier), `use-friends.ts`, friend types in `lib/types.ts` and calls in
  `lib/api.ts`. Privacy-policy copy updated to describe session grants only.
- Old `friend_request`/`friend_accepted` notification rows stay in the table; the inbox renderer
  gets a tolerant fallback for retired kinds instead of crashing on them.

**Kept (map location sharing runs on this)**

- `packages/friends/src/location.ts` (session grants), `writeNotification` +
  `locationSharedNotification` in `notify.ts`.
- `apps/api/src/routes/friend-map.ts` (grant/revoke/positions), `getFriendPositions`,
  `getOnlinePlayers`, `location_shares` + `session_location_shares` tables, the map's share
  panel and online list.

**Renames (honest naming)**: the slimmed package becomes `@onelife/location-sharing`
(`packages/location-sharing`); `friend-map.ts` → `map-share.ts`; `getFriendPositions` →
`getSharedPositions`; the map shell's `FriendsPanel` → `SharePanel`; UI copy says
"Sharing" / "People online", never "friends". API route paths rename too
(`/map/:mapSlug/friends…` → `/map/:mapSlug/share…`) — API and web deploy together, so the web
client changes in the same PR and there is no cross-version window beyond the deploy itself.

**Migration**: drop `friendships` and the presence-flag columns added by `0020_presence_flags`
(and the friend parts of any preferences shape). `location_shares` and `session_location_shares`
are untouched. This is a durable-table drop — irreversible, not rebuildable, deliberate.
`REBUILD_TRUNCATE_TABLES` is unchanged (friendships was never a projection).

## 5 · Dossier shows all maps

- `packages/read-models/src/player-page.ts`: stop skipping servers where the player has no
  lives/ban/open-life; emit an idle, never-played standing card for them. 404 guard: if every
  card is never-played **and** totals are zero (no lives anywhere, no bans), return `null` as
  today — unknown gamertags must keep 404ing.
- Ticket Timeline links become **alive only** (owner and public): a banned ticket loses its
  button; idle and never-played stay unlinked. The ⚠️ in `ticket-stage.tsx` records the fourth
  flip and the new rationale: only a card about a currently-running life links to a live record;
  the ban card still names its life in the sub-line, and past lives are reachable from the
  morgue.

## 6 · Life timeline hero → dark stage

`/players/[slug]/[map]/lives/[n]` restructures like `PlayerProfile`:

- No horizontal padding on `<main>`; every section states its own `px-6 md:px-10`.
- Dark back-link strip (`bg-dark`, `← {GAMERTAG}'s dossier`, dark link tokens) butting the
  masthead, exactly the dossier's pattern.
- Then the stage: `bg-dark`, `border-b-[6px] border-red`, avatar (132px, dimmed when dead),
  kicker `A life of {GAMERTAG} · {MAP}`, **Alive/Died** badge (blue/red as today), FitLine
  headline `LIFE {N} · {MAP}`, the five stats (time alive, kills, longest kill, sessions,
  qualified) restyled light-on-dark (cream values, `cream-muted` labels, qualified stays blue),
  and the obituary link when present.
- Body (withheld bar / location panel, "The record so far", track map) stays on paper, unchanged.
- RTL pins the dark-token swap (a component mounted on a dark surface needs the token test —
  house rule); the "does it actually look right" claim joins the outstanding browser checks.

## 7 · Encounters on the timeline

Every fight the player survived becomes a timeline row — wolves, hordes, firefights, fire.

- **Domain**: export the entity classifier (the `Animal_CanisLupus`→wolf ordered dict currently
  private to `death.ts`) so hit `attackerLabel`s classify with the same rules as death entities.
- **Read-model** (`life-dossier.ts`): new `encountersForLife` beside `summarizeEncounters`, same
  120s gap rule, returning per-encounter spans:
  `{ category: "wolf"|"bear"|"animal"|"infected"|"player"|"fire"|"environment",
     attackerGamertag: string|null, startedAt, durationSeconds, hits, hpLow }`.
  PvP encounters group per attacker gamertag. Fire is checked before category (a fire tick is
  attackerType "environment" but its own story), matching the existing ordeal rule.
- **Open lives**: the life-timeline read model fetches encounters for open lives too. The hit
  window end becomes `endedAt ?? lastSeenAt ?? now` (the current `?? startedAt` would give an
  open life a zero-width window). Verdict/ordeals/hpLow stay dead-only exactly as today.
- **Death-adjacent suppression**: an encounter whose last tick falls within `RECENT_HIT_WINDOW_S`
  of `endedAt` is not emitted — the death row already tells that story, and printing it twice
  reads as two fights.
- **API/web**: `encounters` rides the existing life-timeline DTO (same fetch — no new
  independently-degrading feed). `buildTimeline` interleaves `kind: "encounter"` events at
  `startedAt` with the **yellow** marker (the fourth dot; `DOT` gains `yellow`). Copy:
  - wolf/bear/animal: `WOLVES — FOUGHT OFF` / `A BEAR — FOUGHT OFF`, line
    `7 blows over 2m · HP down to 34`
  - infected: `HORDE — 12 blows over 4m` (1–2 hits: `INFECTED — 2 blows`), line with HP low
  - player: `FIREFIGHT — hit by {GamertagLink}`, line `3 hits taken · HP 58`
  - fire: `BURNED — 2 blows`, line with HP low
  - HP is omitted from the line when every tick's `victimHp` was null — never fabricate.
- A life with no hits renders no encounter rows and no empty-state (absence of fights is not a
  data state, it is a fact).

## Testing & verification

- Unit: interstitial (cookie set/skip, escaping, tag presence, 200 + bounce markup), card route
  (200, content-type, kicker size drop, generic variant), encounter grouping (gap edges, per-
  attacker PvP split, fire-before-category, suppression window, open-life window), all-maps
  standings + the 404 guard, alive-only links.
- RTL: slab rhythm (one control row per half), share bar reduced surface, hero dark-token swap,
  encounter rows (each category's copy), retired-notification-kind fallback.
- DB suite: the drop migration applies; friend tables gone, share tables intact.
- `pnpm turbo run test --concurrency=1` + `pnpm turbo run typecheck`.
- Browser-only (appended to CLAUDE.md's outstanding list): the timeline hero on a phone and at
  1024; a real Discord/X unfurl of `/i/{slug}` once deployed; the slab at 390px after the row
  removal.

## Deploy notes

- The migration drops durable tables; no `REBUILD_TRUNCATE_TABLES` change, no `--rebuild` needed
  for this release (no projection shape changes).
- API route path renames ship in the same release as the web client that calls them; the fleet
  restarts together, so no cross-version window beyond the deploy itself.
