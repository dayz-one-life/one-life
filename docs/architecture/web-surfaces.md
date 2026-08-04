# Web surfaces: boards, dossiers, home, shell, avatars

Split out of `CLAUDE.md` (2026-07-29), verbatim. Feature entries in original order.

## Survivors leaderboard + player pages

- **Survivors leaderboard** ✅: public, mobile-first live leaderboard of every currently-alive
  survivor (**alive** = open qualified life: `lives.endedAt IS NULL` and `isLifeQualified`), one row
  per (player × server).
  **⚠️ REWRITTEN BY SUB-PROJECT D2 — the whole sort layer is deleted.** There is **one board per
  map, ranked by time alive descending, and no combined board**. `/survivors/[map]` (by
  `servers.slug`) is the board and is the stable, shareable, indexable URL; the bare `/survivors`
  is a **per-viewer redirect** through the shared map-resolution rule (see the D1 entry), carries
  `robots: { index: false }`, and must never appear in the sitemap. Gone entirely:
  `/survivors/kills`, `/survivors/longest`, the `/survivors/[map]/[sort]` route tree, the
  explicit-default redirect, the `GET /survivors` API route, `SORTS`/`DEFAULT_SORT`/`isSort`,
  `TIE_ORDER`/`metricFor`, the sort pills, the **All maps** tab, and the per-row map label.
  **⚠️ THE RESERVED-SLUG RULE IS GONE, NOT MERELY UNENFORCED.** A server's `servers.slug` **may
  now be `kills`, `time` or `longest`**. Those words only ever mattered because they shadowed a
  slug in the depth-1 segment; with no sort segment there is nothing to shadow. Do not
  reintroduce the constraint "defensively" — a test in `board-params.test.ts` asserts such a slug
  resolves to its own board.
  One pure `resolveSurvivorsRoute(segments, slugs)` (`apps/web/src/lib/board-params.ts`) still
  drives resolution, now trivially: exactly one segment, which must be a known slug, else
  `notFound()`. It never returns a redirect. All board URLs are built by the pure
  **`boardHref(slug, page)`** (drives `SurvivorControls`, `Pagination`, canonical/OG/JSON-LD, and
  the sitemap); `buildTabs` returns one tab per slugged server, alphabetical by label.
  **R2 restyle (still current):** the visible `<h1>` is `{Map} survivors` (the SEO phrase
  `Top {Map} survivors` — no `by {sort}` clause since D2 — lives only in `<title>`/OG via
  `survivor-metadata.ts`); rows are **tiered by global rank** (`tierFor`,
  `@/components/survivors/format`): rank 1 = hero row on tint with a 96px avatar and the
  only stat label, ranks 2–5 = podium rows with 60px avatars, 6+ (and all of pages 2+) = compact
  text rows with a 28px initial-disc avatar. **Every row shows time alive and nothing else** — kills and longest
  kill survive as TIE-BREAKS in the read-model, never as a displayed stat; the hero row keeps a
  kills flourish. Portraits are decorative
  (`alt=""`, no img role — tests query the DOM directly). Pagination is a mono-box bar with a
  clamped `showingLine` and non-focusable disabled edges; board + dossier routes have `loading.tsx`
  skeletons (`@/components/skeletons`). Backed by the `getAliveSurvivors` read-model
  (`packages/read-models/src/survivors.ts`; **one tie-break chain** — time alive → kills → longest
  kill → gamertag, via a NaN-safe skip-if-equal comparator, which is load-bearing because two
  survivors with no ranged kills both metric to `-Infinity`) and the public
  `GET /survivors/:slug` API route. **⚠️ The `sort` query parameter is DROPPED from the Zod
  schema, not accepted-and-ignored** — silently tolerating a dead parameter is how a caller comes
  to believe it still works. **Avatar/account pass:** portraits are login avatars now, not
  character art — a verified, non-tombstoned `avatars` row's hash, silhouette/initial-disc
  fallback otherwise. Gamertag filtering was scoped out of this pass.
- **Player pages** ✅: a public, SEO-optimized profile at `/players/[slug]` — a cross-server totals
  hero, per-server current standing (alive / banned / idle) with a live ban countdown, paginated
  past-life history (since R2: compact **funeral cards** — map, dateline, death line, and a
  kills/longest-kill/sessions counts strip only; the per-life kill lists + vitals now live on the
  R4 life-timeline page, reached via `TIMELINE →` links on the standing + funeral cards), a
  dynamic OpenGraph share image, and
  `ProfilePage` JSON-LD. The slug is the gamertag slugified (`playerSlug`, `@/lib/slug`) and resolved
  back via `resolveGamertagBySlug` (`packages/read-models/src/player-aggregate.ts`); the page is
  powered by a new `getPlayerPage` read-model (`packages/read-models/src/player-page.ts`) and an
  extended `GET /players/:gamertag` API route. **Owner-only self-unban:** the page's signed-in owner
  (session gamertag matches the page, and their link is **verified** — pending/unverified visitors
  never see the control) can spend an unban token to lift their own ban, in four states
  (`UnbanState`: hidden/ready/no-tokens/pending) driven by `SelfUnbanButton`/`UnbanView`
  (`apps/web/src/components/player/self-unban-button.tsx`). Gamertags across the site (survivor
  board rows, kill lists, death-by attributions) now route through a shared `GamertagLink` component
  to `/players/{slug}`. A `/welcome` post-login resolver (`apps/web/src/app/welcome/page.tsx`)
  sends a verified user straight to their player page and everyone else to `/` (the rail carries the
  next action). Since R3, `SelfUnbanButton` reads the balance from the shared `["tokens"]` query and
  invalidates `["tokens"]`+`["player-page"]` on redeem, so the dossier and the rail stay in sync.
  **Redesign (v0.11.0):** single roomy column, everything always visible (no `<details>`
  expand/collapse). The hero is **avatar-free** with a full-width stat band via the shared
  `heroStats` helper (`@/components/player/format`) — always Lives / Deaths / Longest life; **Kills
  only when > 0**; since R2, **Deaths is the red-highlighted (`hot`) stat** (the OG card inherits
  this via `heroStats`), plus a first-seen over-line (`aliveMaps` helper), a blue `Alive ×N` skew
  badge, and a red rubber-stamp Verified mark. Current-standing cards are
  **state-colored** (green alive / red banned / neutral idle); past-life cards are **muted archive**
  styling to read as history. Past lives are **paginated** — `getPlayerPage(db, gamertag, now, { page,
  pageSize })` (`PLAYER_PAST_LIVES_PAGE_SIZE = 10`) gathers the lightweight full set for totals +
  ordering but **enriches only the visible slice** (O(pageSize) kills/sessions/character), returns
  `pastLivesTotal/Page/PageSize`, and **no longer returns `heroCharacter`**; `GET /players/:gamertag`
  takes `?page=` (Zod `.catch(1)`) and the page route's canonical is page-aware
  (`?page=N` for N>1, `PlayerPagination` control). The OpenGraph image (`opengraph-image.tsx`) is a
  **survivor dossier** — the real logo + the **logo-skull only** motif, callsign in real casing,
  "Surviving since {MON YYYY}," and the same `heroStats` readout, rendered in Oswald/Space Mono from
  co-located `.ttf`/`logo.png`/`skull.png` assets (read via `fs.readFile`, since the Node OG runtime's
  `fetch` can't read `file:` URLs).
  **Map naming:** a server's `servers.map` is the DayZ mission **codename** (`chernarusplus`, `sakhal`,
  `enoch`); player-page display labels come from `mapLabel` (`@/components/player/format` — `enoch` →
  "Livonia", unknown codenames title-case as a fallback). The per-life API route
  `GET /players/:gamertag/:map/lives/:n` takes a server **slug** (not a codename) and resolves it via
  `resolveServerBySlug` — **no hardcoded map allow-list**, so adding a server (e.g. Livonia) stays a
  pure `servers` insert; an unknown slug is a `404`.
- *(historical)* Device-based alt detection (RPT Feature A): the device signal
  is **cut** — DayZ removed the `[MAM]` device-hash log lines in 1.29; alts fall back to Nitrado's
  built-in Multi-Account Mitigation.
## Tabloid redesign (R1–R4), sitemap, cross-linking

- **Tabloid redesign** (R1+R2+R3+R4 shipped): a visual relaunch replacing the old
  dark "field journal" theme with a light "Clean Glossy" tabloid look. Roadmap + full R1 design:
  `docs/superpowers/specs/2026-07-16-tabloid-redesign-design.md` — **R1** design system + shell,
  **R2** boards restyle (survivors + player dossier;
  spec `docs/superpowers/specs/2026-07-16-r2-boards-restyle-design.md`), **R3** controls rail
  (spec `docs/superpowers/specs/2026-07-16-r3-controls-rail-design.md`), **R4** life timeline
  (spec `docs/superpowers/specs/2026-07-17-r4-life-timeline-design.md`). The R5 tiers (R5a–R5d)
  built the content engine and are **retired** — see the Content engine retired entry below.
  **R4 shipped — the life timeline.** A public per-life page at
  `/players/[slug]/[map]/lives/[n]` (canvas 14a): a character-portrait hero (`LifeHero`, the life's
  resolved `getLifeCharacter` → `/characters/<name>.webp`) with a **factual** `Life {n} · {mapLabel}`
  headline + a Time-alive/Kills/Longest-kill/Sessions/Qualified stat
  band, and a newest-first event **`Timeline`** (`@/components/life/`).
  **⚠️ Every event offset is PLAYED time, not wall-clock time since `life.startedAt`** — the
  `playedSecondsAt` helper in `@/lib/life-timeline`, whose session accounting mirrors
  `liveTimeAlive` exactly (closed sessions contribute their stored `durationSeconds`; an open one
  accrues only to `lastSeenAt ?? connectedAt`; only the session containing the instant is
  pro-rated). It shipped as wall-clock and read as broken data: a two-week-old life with three
  hours of play labelled its events `463h 04m in` directly beneath a hero reading
  `TIME ALIVE 3h 35m`. Both numbers were true; putting two clocks on one axis was the bug. The
  terminal death row is labelled from the life's stored `playtimeSeconds` rather than from
  `playedSecondsAt(endedAt)` so the last row can never disagree with the hero, the board or the
  obituary by a minute. The event list is built by a
  pure **`buildTimeline(data, now)`** (`@/lib/life-timeline`): birth → life qualified → session
  starts (consecutive **kill-free** sessions collapse into one `Sessions N–M` row) → kills (a yellow
  **Longest kill** chip on the max-distance kill) → the terminal `death` row (carrying the
  **vitals at death** — energy/water/bleed — this is where R2's dropped per-life detail returns) or,
  for an open life, a live **Still drawing breath** row. **Captions are deterministic + factual — no
  LLM**. **Location was voice-only at R4 ship time; it no
  longer is.** A "Positions withheld" notice still renders **only while a life is alive** to
  everyone except the verified owner of that gamertag — coordinates **have always been stored**
  (the `positions` table, populated since SP1) and, since the owner-only life location map
  sub-project below, **are shown**, to that one person, in place of the withheld notice. What
  remains true, and is why every marker on that map is approximate: kills and deaths themselves
  still carry no recorded coordinates. Standing + funeral cards link in via a pure **`lifeHref(gamertag, mapSlug,
  lifeNumber)`** (`@/lib/life-href`); `AliveStanding` gained a `lifeNumber` for the alive-standing
  link. Backed by **`getLifeTimeline`** (`packages/read-models/src/life-timeline.ts`, composing
  `getLifeDetail` + `getLifeKills` + `getLifeCharacter` + `lifeQualifiedAt`) and the extended
  `GET /players/:gamertag/:map/lives/:n` route (now returns `kills` + `qualifiedAt` + `gamertag`/`map`/
  **R3 shipped — the controls rail is the whole account surface.** Root layout is an `xl:`
  two-column grid (`max-w-[1440px]`, `[minmax(0,1fr)_380px]`): pages flow in the main column
  (ink right-border at `xl`), the **`ControlsRail`** (`@/components/controls/`) is the sticky right
  column, and below `xl` a fixed **`ControlsPill` + `ControlsSheet`** (bottom sheet) replace it
  *(superseded by pill re-homing, UX review sub-project 4, below — `ControlsPill` is retired; the
  sheet is unchanged but now opens from a masthead trigger, `MobileAccount`)*. All
  three surfaces are driven by **`useControls`/`useControlsActions`** over the `accountStatus` union:
  signed-out → sign-in CTA (rail; on mobile a fixed **`SignInPill`** floating box → `/login`, so
  logged-out mobile visitors don't scroll to the footer to sign in — **also retired, see below**);
  unlinked → identity + in-rail
  gamertag link panel (autocomplete over `GET /players/search`, race-guarded); pending → in-rail
  "prove it's you" emote challenge (live via the 5s poll); verified → identity + Verified stamp +
  **tokens panel** (balance, send-by-gamertag, quiet referrer) + **server cards** (alive/no-life/banned;
  banned shows a live ban countdown + the shared `SelfUnbanButton` spend CTA). The **sign-out footer
  renders in every signed-in state** (rail `SignedInFooter` + mobile sheet) — the profile link only
  appears when verified — so an unlinked/pending user can always log out. Presentational
  pieces are props-only + unit-tested; `useControls`/containers are thin (untested, per convention).
  **⚠️ THE TWO-SURFACE TOKEN RULE — NARROWED BY SUB-PROJECT B, NOT DELETED.** It used to govern
  the rail (light paper) versus `ControlsSheet` (`bg-dark`): any panel mounted on both had to swap
  its text/border/tint tokens or render **ink-on-dark — present in the DOM, fully functional,
  invisible on a phone**, exactly how the notifications panel shipped in v0.26.0. B deleted the
  sheet, so every account panel is light-surface only and the `boxed` variants are gone.
  **The failure mode is still live for `NotificationRow`/`NotificationList`**, whose bell popover
  is dark and whose `/notifications` inbox is light — those two still need their variants.
  **RTL asserts the DOM, not contrast, so the whole web suite stays green** on this class of bug;
  any component mounted on both a dark and a light surface needs a test pinning the swap itself.
  **The notifications restructure removed the notifications panel from both the rail and the mobile
  sheet** (`controls/notifications-panel.tsx` deleted; `useControls` dropped its notification fields
  + `markRead`) — notifications moved to a masthead bell + the permanent `/notifications` inbox
  (see the Player notifications sub-project entry). The ⚠️ two-surface token rule above now applies
  to `NotificationRow`/`NotificationList` instead: the bell's popover is dark, the inbox page is
  light, and each needs its own token variant for exactly the reason the old panel did.
  The web API client **`apiSend` attaches `content-type: application/json` only when a body is present** —
  a bodyless `DELETE` (cancel claim) with the header set is rejected by Fastify as an empty JSON body (400).
  The mobile menu and sheet share **`useModalBehavior`** (`@/lib/use-modal-behavior` — focus trap,
  Escape, scroll lock, focus restore; keyed on `open` only via an `onCloseRef` so parent re-renders
  don't steal focus). **`POST /me/tokens/transfer` and `POST /me/referrer` take a verified gamertag**
  (`{ toGamertag }`/`{ referrerGamertag }`, resolved case-insensitively against verified
  `gamertag_links`; `not_verified` on miss), not a raw user id. **Both token fields (send + referrer)
  autocomplete over verified players, excluding the signed-in user** — a `searchVerifiedGamertags`
  read-model (`packages/read-models/src/claimable.ts`, verified mirror of `searchClaimableGamertags`)
  served at public `GET /players/search/verified` (a static route alongside `/players/search`), with
  client-side case-insensitive self-exclusion. The claim field and both token fields share one
  presentational **`<GamertagAutocomplete>`** (`@/components/controls/gamertag-autocomplete` — debounce,
  race guard, skip-after-pick, absolutely-positioned overlay dropdown; `fetchSuggestions` is injected,
  so pass a **stable** reference); `TokensPanel` takes `myGamertag?` (from `rail`/`mobile-account`,
  the latter renamed from `mobile-controls` by pill re-homing, UX review sub-project 4)
  as its `exclude`. **R3 also closed the R1 compat-shim
  story:** the legacy token aliases and `font-hand` are deleted, `--tint` was renamed **`--bone`**
  (brand "Bone" surface), the `ui/` primitives (Button/Input/Table) are gone, and the login page was
  restyled into the tabloid language. **R1 shipped:** Paper/Ink/Red RGB-triple design tokens
  (`globals.css` + `tailwind.config.ts`); a dark masthead with a raster wordmark and the nav
  (originally 5 items; now Survivors · Maps · About) plus a full-screen mobile menu; a dark
  mono footer; a front-page shell (manifesto hero, top-5 survivors, sign-in CTA); a live About
  page with bureau/server cards;
  a brand favicon kit + wordmarks vendored
  from the sibling `../brand` repo (source of truth, no cross-repo build dependency); and the
  player OG card moved onto the brand palette. Fonts are Oswald + IBM Plex Mono via
  `next/font/google`; Anton (the wordmark's display face) ships only inside the raster wordmark
  assets, never as a webfont. The mobile-controls polish pass gave the sheet swipe-dismiss
  (`useSheetDrag`, header-zone only), a two-phase motion-safe enter/exit, and a route-change close
  *(this behavior lives on the sheet, not the trigger, so pill re-homing, UX review sub-project 4,
  left it unchanged — only `mobile-controls.tsx`'s trigger + mount point moved, into
  `mobile-account.tsx`)*; the controls dark surface uses four named tokens — `dark-well`/
  `dark-hollow`/`dark-edge`/`dark-edge-bright` — no raw hexes (grep-gated).
  **Contrast & type floors (UX review sub-project 1) shipped:** plain `--red` (3.7:1 on paper)
  is now display-only — reserved for ≥19px-bold text, borders, tints, and stamps — with every
  smaller red text run moved to `--red-deep` (5.8:1), per the RED POLICY comment at the tokens
  in `globals.css`. A three-tier type floor is likewise documented there (TYPE FLOORS comment):
  reading prose sits at a 16px floor (`text-base`) with a 68ch measure, functional content at
  an 11px floor, and decorative overlines/chrome may drop to 10px only when the same
  information also exists elsewhere — enforced by the `src/type-floor-guard.test.ts` tripwire.
  **`--red-deep` is a light-surface (paper/bone) token only** — on DARK surfaces the ratios
  invert (plain red ~5.1:1 passes AA, red-deep ~3.2:1 fails), so dark surfaces keep `red`/
  `red-soft`, never `red-deep`.
  **Screen-reader structure (UX review sub-project 2) shipped** (spec
  `docs/superpowers/specs/2026-07-21-sr-structure-design.md`): a status-message policy — a DOM
  change from a user action or a background poll, with no accompanying focus move, announces
  through a shared `role="status" aria-live="polite"` `SrStatus` (`@/components/shared/sr-status`),
  including a persistent `VerificationAnnouncer` that outlives the pending→verified panel swap
  (mounted as an unconditional sibling, never inside the branch it announces) and is gated
  `xl:hidden` on the mobile sheet so it doesn't double-announce "Verification complete" against
  the rail's own copy at `xl`; list semantics (`role="list"`/`<li>`, `<ol>` for the life timeline)
  on the notification, standing/past-life, and timeline collections; the gamertag autocomplete is
  a full WAI-ARIA 1.2 combobox-with-listbox with an always-present announced result count; and web
  a11y tests query by ARIA role rather than DOM structure.
  **Live-data honesty (UX review sub-project 3) shipped** (spec
  `docs/superpowers/specs/2026-07-21-live-data-honesty-design.md`): an audit of every live/derived/
  polled surface found the UI presenting state as current/confirmed when it was stale, phantom, or
  fabricated — a dry-run ban (never actually placed on the game server) rendered as a real "Banned"
  standing and could burn a real unban token; the life-timeline "time alive" outran the survivor
  board/dossier for a ghosted player; an expired ban countdown floored at a dead "0h 0m" forever;
  three loading/error paths fabricated an authoritative "0 tokens"/idle/empty. Plus one small fix:
  the player-page OG card now says "First seen" (was "Surviving since," which implied continuous
  survival). **Invariants a future change would silently break (don't "tidy"
  them back):**
  1. **A ban is real only if `dry_run=false`.** `packages/read-models/src/player-page.ts`'s
     `activeBans` query and `packages/tokens/src/redeem.ts`'s candidate query both filter
     `and(…, eq(bans.dryRun, false))` alongside their existing status filters
     (`ACTIVE_BAN_STATUSES` / `["pending","applied"]`, both unchanged) — do not widen either back.
     A dry-run ban must never render as banned or be spendable. Backlog: the enforcer's expire arm
     only touches `status='applied'`, so a dry-run `pending` ban never expires (moot now that it's
     invisible to both display and spend); already-spent phantom redemptions are not migrated.
     **⚠️ And an active real ban OUTRANKS a newer open life in the per-server standing**
     (`getPlayerPage`, `player-page.ts`): the branch order is `banned > alive > idle`, NOT
     `alive > banned`. A life ends on DEATH — never on disconnect or on being banned — so after a
     player dies on a qualified life (real ban placed) and respawns past the 5-minute threshold
     before the enforcer poll lands, both an active `bans` row and an open qualified life
     (`profile.alive`) persist for the whole 24h. If the alive branch won, the card would read
     "Alive" and the self-unban control (which renders only on a `banned` card) would be unreachable
     for the entire ban. Do not reorder these branches back; the standing self-heals to Alive once
     the ban lifts/expires. Pinned by the "respawn race" test in `test/player-page.test.ts`. Two
     intended second-order effects, not regressions: such a server no longer counts toward
     `aliveAnywhere` / the hero `Alive ×N` badge (a banned player isn't alive); and an
     expired-but-still-`applied` ban the enforcer hasn't reconciled yet now also outranks an open
     life (bounded — `banCountdown` degrades to "Lifting…", self-heals on the next enforcer poll).
  2. **Presence-implying durations cap at `lastSeenAt ?? connectedAt ?? now`**, matching
     `survivors.ts`'s `livePlaytime` cap and the dossier's `queries.ts` cap EXACTLY — **no clamp to
     `now`** (a `Math.min(now, …)` clamp diverges from those two under clock skew, since
     `servers.clockOffsetMs` means a real `lastSeenAt` can land a few seconds ahead of request-time
     `now`). The life-timeline (`apps/web/src/lib/life-timeline.ts`'s `liveTimeAlive`) was the last
     surface brought into line; its NOW row also dropped "and counting" (a server-baked snapshot
     that never ticks).
  3. **`banCountdown` (`apps/web/src/components/player/format.ts`) returns `null` past expiry**,
     never a clamped "0h 0m." Every render site (`standing-card.tsx`, `controls/server-cards.tsx`,
     `controls/sheet.tsx`) branches on null to a terminal "Lifting…" state, not a dead-looking live
     timer.
  4. **Loading/error is never rendered as an authoritative zero/empty.** `useControls` exposes
     `standingLoading`/`balanceLoading`; surfaces (`self-unban-button.tsx`, `TokensPanel`,
     `ServerCard`/`SheetServerRow`, the pill chip, `pillStatus`) gate on them instead of falling
     through to a `?? 0`/`[]`-means-idle default; the home page's four feed fetches distinguish a
     resolved-empty desk from a failed fetch via `settleFeed` + a `FeedFailedBanner`. (The pill chip
     and `pillStatus` were later deleted as dead code by pill re-homing, UX review sub-project 4 —
     the invariant now holds on the remaining surfaces only.)
  **Pill re-homing (UX review sub-project 4) shipped** (spec
  `docs/superpowers/specs/2026-07-21-pill-rehome-design.md`): the mobile account surface is no
  longer a floating pill fixed to the bottom of every page — it is now a **masthead trigger**
  (**`MobileAccount`**, `@/components/controls/mobile-account.tsx`) that colocates the trigger and
  the existing `ControlsSheet` (plus their shared open-state), mirroring how `MastheadBell` owns its
  button + popover + state: an avatar-disc button when signed in (`aria-haspopup="dialog"`,
  `aria-controls="controls-sheet"`) opening the sheet, a compact "Sign in" chip when signed out
  (replacing `SignInPill`), nothing while `loading`; the trigger itself is `xl:hidden` (`MastheadBell`
  is not — it still renders at every width). The masthead right cluster (`header.tsx`) — previously
  the bell alone self-positioning `absolute right-4` — now wraps both in one positioned `flex` box so
  they sit side by side without colliding. **`ControlsPill`/`SignInPill`
  (`controls/pill.tsx`) and `mobile-controls.tsx` are retired — do not reintroduce a fixed-bottom
  account pill.** The content column's `pb-24` bottom gutter is gone (no floating chrome remains to
  reserve space for). Only the trigger and its location moved: the sheet, its drag-to-dismiss, focus
  management (restored to the masthead trigger for free — `useModalBehavior` already captures
  `document.activeElement` on open), the `VerificationAnnouncer`, and every panel inside the sheet
  (identity, link/verify, tokens, server cards, self-unban, the SP2 live regions, the SP3 loading
  affordances) are unchanged.
  **⚠️ THE APP HAS EXACTLY THREE Z-ALTITUDES — the LAYER LEGEND at the `<header>` in
  `header.tsx` is the source of truth.** `z-auto` page content → **`z-40` masthead** → **`z-50`
  full-screen overlays** (the skip-to-content link in `app/layout.tsx`). Since sub-project B the
  `z-40` layer had two occupants — the masthead and the mobile `TabBar`
  (`components/shell/tab-bar.tsx`) — which never overlapped spatially and so shared it rather than
  adding a fourth altitude. **The hamburger-nav/sticky-masthead change (2026-07-30, below) deletes
  `TabBar` outright, so the masthead is the layer's only occupant again** — the legend in
  `header.tsx` was corrected to say so; do not restore the "two occupants" framing. The masthead **must** be a positioned layer: the bell popover's own
  `z-50` only ranks it *inside* the right cluster, whose `-translate-y-1/2` opens a stacking
  context — so without a layer on the header, any later-in-DOM positioned-at-`z-auto` element
  paints over the popover (**`sticky` opens a stacking context regardless of z-index**, as does
  any later `relative` wrapper). That was the v0.29.6 bug: notifications rendered *behind* the
  page. The masthead must equally stay **strictly below 50** — the skip link renders *before*
  the header, so an equal value is decided by DOM order and silently buries the only control
  keyboard users have. Both halves are one-directional: raising the masthead breaks a11y,
  removing it breaks the popover. jsdom cannot observe paint order, so `header.test.tsx` pins
  the altitude numerically (`0 < z < 50`) and the real ordering was verified with
  `elementFromPoint` in a browser.
- **Sitemap + robots.txt** ✅: `apps/web/src/app/sitemap.ts` (`force-dynamic`; the hourly window is
  on the FETCH, not the route — see the ⚠️ below) and
  `apps/web/src/app/robots.ts`, fed by `getSitemapEntries` (`packages/read-models/src/sitemap.ts`)
  through public `GET /sitemap`. A few hundred URLs today against a 50,000 limit, so there is deliberately
  **no sitemap index and no `generateSitemaps`**. Spec
  `docs/superpowers/specs/2026-07-21-sitemap-design.md`.
  **⚠️ The sitemap must never advertise a URL that 404s or redirects.** A life's map segment is a
  `servers.slug` and a life on an un-slugged server is omitted entirely; only players with at least
  one life are listed; board URLs are built with `boardHref`,
  **which collapses the default sort for you** — hand-building `/survivors/time` would advertise a
  redirect. Each rule is mutation-tested (removing the clause makes a named test fail).
  **`lastmod` is real** — life `ended_at ?? started_at`, player `MAX` of their
  lives' activity. A `new Date()` would train crawlers to ignore the field; static and board entries
  carry none at all.
  **The payload carries `gamertag`, not a slug.** The web builds the path with `playerSlug`, the same
  function behind every other player link, rather than adding a third copy of the slug rule
  (`read-models` already hand-syncs `slugNorm` — see the note at `player-aggregate.ts:19`).
  **⚠️ The two fetches degrade INDEPENDENTLY** (separate try/catch): losing the server list must not
  cost the ~470 content URLs, and vice versa. A single shared try/catch passes the "data fails" test
  and silently guts the sitemap — pinned by a test proven red against exactly that change.
  **⚠️ The route is `force-dynamic`, and `export const revalidate` must NOT be restored.** Making it
  static/ISR means `next build` prerenders it and fetches the API at build time; the build does not
  run alongside a serving API, so it fails outright (three 60s attempts, then `Export encountered an
  error on /sitemap.xml/route`) — and a fetch timeout only downgrades that to a *baked* sitemap
  holding the static + board entries alone, which ISR then serves for an hour, missing every player
  and life URL. The hourly enumeration window instead lives on the fetch: `apiGetCached`
  (`@/lib/api`) sends `next: { revalidate }` and, unlike `apiGet`, never awaits `cookies()` and
  never forwards a cookie header — a crawler's cookies have no business reaching a shared cache
  entry. Do not point the ordinary `getServers()` at it; authenticated RSC pages need the
  cookie-forwarding version.
  **`lives.life_number` IS the URL segment here** — this generates the URL the router itself
  resolves by number.

- **⚠️ `export const revalidate` is a NO-OP on a `[slug]` route without `generateStaticParams`.**
  This is the single most counter-intuitive rule in the caching story and it fails silently.
  Without a `generateStaticParams` export — *even one returning `[]`* — Next classifies a dynamic
  segment as fully dynamic and serves
  `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`, which no CDN may
  store; `revalidate` is simply ignored. Declaring it marks the route static-capable, so unknown
  slugs are generated on demand and then cached (`s-maxage=N, stale-while-revalidate`). Confirmed
  by measurement, not by reading: `next build` reports `ƒ (Dynamic)` vs `● (SSG)`, and
  `next start` shows the header flip plus `x-nextjs-cache: MISS` then `HIT`. **None of this is
  observable in dev**, which re-renders every request.
  `/obituaries/[slug]` and its `opengraph-image` carry it (returning `[]` — prerendering real
  slugs would fetch the API during `next build`, the same hang `sitemap.ts` documents above).
  This mattered in production: uncached, every social scrape paid a cold origin render — API
  round-trip, font load, PNG encode — and Facebook's crawler intermittently timed out and
  published posts with a blank card.
  **⚠️ Relatedly, an `opengraph-image` is served `public, immutable, max-age=31536000`.** For a
  real obituary that is right — the death already happened. For the *failure-path* card it is a
  trap: one scrape landing during an API outage freezes the generic fallback at the CDN, and in
  Facebook's cache, for a year, and re-scraping cannot heal it. The obituary card therefore
  overrides `cache-control` to 60s **on the failure path only**, pinned by a test.
  The home entry uses `SITE_URL` directly, not `absoluteUrl("")`, which would emit a trailing slash.
  AI crawlers are deliberately **not** blocked — the paper wants citations.
- **Cross-linking, PR-1** ✅: links between players and lives that need no schema change.
  Controls-rail + mobile-sheet server cards link to the life they describe.
  Spec `docs/superpowers/specs/2026-07-21-cross-linking-design.md` (§4 = this PR; §5/§6 covered the
  article cross-links, retired with the content engine).
  **Two href builders, and picking the wrong one is silent:** `lifeHref(gamertag, mapSlug, n)`
  slugifies for you; **`lifeHrefBySlug(playerSlug, mapSlug, n)`** takes an ALREADY-slugified
  callsign and is what the rail/sheet use (they hold `ownSlug`). Passing a slug to `lifeHref`
  double-slugifies; passing a gamertag to `lifeHrefBySlug` leaves it unslugified.
  **⚠️ The map segment of a life URL is a `servers.slug`, NEVER `servers.map`.** The route resolves
  it with `resolveServerBySlug` (404s on a miss — see the comment at
  `apps/api/src/routes/player-aggregate.ts`); `map` is the non-nullable mission codename
  (`chernarusplus`/`enoch`), which is display-only, via `mapLabel`.
  **A life link renders only when its life number is known.** `ban.triggeringLifeNumber` and
  `ServerStanding.lastLifeNumber` are both nullable; a null renders NO link, never `/lives/0` or
  `/lives/undefined`. Specifically, when a ban cannot be matched to its triggering life the banned
  card shows no link — it deliberately does **not** fall back to the most recent life, because a
  banned card's whole claim is "this ban came from this life." `lastLifeNumber` on an **idle** card
  does resolve to the most recent life; that fallback is correct there and only there.
## Pure-player rebuild: sub-projects B, C, D

- **Sub-project B — App shell** ✅ (spec `docs/superpowers/specs/2026-07-24-b-app-shell-design.md`,
  plan `docs/superpowers/plans/2026-07-24-b-app-shell.md`): the chrome the rest of the pure-player
  rebuild hangs off. **Presentation only** — no migration, no API route, no env var, no worker;
  plain `./deploy/deploy.sh`.
  **Nav is Home · Maps · Survivors · Obituaries · About.** (Survivors was renamed back from
  "Leaderboard" by the UX-consistency pass, 2026-07-27 — the internal nav key is still
  `leaderboard`. **Obituaries** joined 2026-07-28, when the revived feed got its first route in
  from anywhere but a life timeline.) The Survivors route is
  still `/survivors`, because sub-project D owns the move to a per-map board.
  **⚠️ `activeNavKey` matches Home by EXACT path, never `inSection`**: every path starts
  with `/`, so a prefix rule lights Home up on every page in the site.
  **`components/controls/` no longer exists.** The rail, the `ControlsSheet`, its `MobileAccount`
  trigger, the rail's `SignInPanel` and `useSheetDrag` are deleted; the surviving panels moved to
  `components/account/` (identity, link, verify, tokens, `use-controls`, `format`,
  `verification-announcer`), `components/servers/` (server cards), `components/friends/` and
  `components/shared/` (`GamertagAutocomplete`).
  **⚠️ EVERYTHING IN THIS PARAGRAPH ABOUT `TabBar` IS HISTORICAL — the component is DELETED by the
  hamburger-nav/sticky-masthead change (2026-07-30, its own entry below).** Kept verbatim because
  the reasoning (the safe-area calc, the footer gutter placement) is the worked example the new
  entry's footer-gutter note points back to; do not resurrect any of it.
  **Below `md` a fixed `TabBar`** (`components/shell/tab-bar.tsx`) carries Home · Map · Survivors ·
  Friends · **Obits**, swapping Friends for Sign in when signed out (**five tabs in both states**,
  since 2026-07-28) and rendering
  **nothing** while identity resolves. **⚠️ `You` is deliberately NOT a tab** — `/you` stays
  reachable at every width via the masthead `AccountAffordance`, which has no width gate (unlike
  the nav beside it), so the slot was freed for a public surface. The label is the short **`Obits`**
  only here: the bar is five fixed-width columns at 320px, and the nav and footer both say
  Obituaries. It **shares the `z-40` chrome layer with the masthead**
  (they never overlap spatially) rather than adding a fourth altitude, and its height is
  `h-[calc(4rem+env(safe-area-inset-bottom))]` — **the inset must stay inside the calc**, since as
  padding under `border-box` it is subtracted from the box and collapses the row on a notched
  phone. **⚠️ The matching `pb-[calc(...)]` gutter lives on the `<Footer/>`, NOT on the layout's
  content column** — the footer is a sibling after that column and so is the last in-flow element
  in the document, so padding the column leaves the footer itself under the bar. That shipped once
  and hid the footer's **About** link, which is About's only route below `md` (verified in a
  browser: `elementFromPoint` on the link returned the bar). jsdom cannot see the overlap, so
  `footer.test.tsx` pins the gutter class. **This is NOT a return of the retired
  `ControlsPill`** — that was a floating account surface; this is app-wide navigation that renders
  for signed-out visitors too. **(2026-07-30: the bar itself is gone, and the gutter it justified
  is gone with it — see below.)**
  **The hamburger and its full-screen menu are gone**, and **About moved to the footer**, which is
  its only route below `md`.
  **`/you` is the account page** (identity, tokens, sign-out), reached from a masthead avatar that
  renders at **every** width — the old `MobileAccount` trigger was `xl:hidden` because the rail
  covered desktop, and with the rail gone a width gate would strand desktop users.
  **⚠️ The claim/verify ladder deliberately stays on Home, not `/you`** — `unlinked`/`pending` are
  onboarding states that sub-project C's three-mode home owns, and `/you` must never be the only
  route to claiming a gamertag. Sign-out renders in every signed-in state.
  **⚠️ THERE IS NO SIDEBAR. Home is ONE COLUMN at every width.** The `xl` glance rail
  (`HomeSidebar`) and its `HomeShell` wrapper were deleted on 2026-07-30: the verified home is the
  ticket stage, the controls slab and the morgue, full-bleed, and a 380px rail beside them fought
  that. Nothing reachable only there was lost — friends render for everyone in `AccountPanels`
  (the `xl:hidden` on that mount existed *purely* because the rail duplicated it, so removing the
  rail without removing that guard would have deleted friends from the desktop home), and the
  board and notification glances already had `/survivors`, `/notifications` and the masthead bell.
  Deleting it also removed three per-request server fetches from every home render — `getServers`,
  the board resolution and `getSurvivors` existed **only** to fill that rail, and `page.test.tsx`
  now asserts they are not called in either cookie state. Do not reintroduce a fetch here for a
  column that no longer renders.
  **`PageHeader`** (`components/shared/page-header.tsx`) is the shared *title · count · control*
  strip. Its `count` is a **discriminated union** (`loading | ready | failed`), not a number, so
  loading, resolved-zero and failed are three distinct renders defined once — this repo's
  most-repeated bug class. It carries **no z-index and no sticky**. Adopted by `/you` and
  `/friends`; the board keeps its own larger header until D restyles it.
  **Browser-verified in real Chrome** (the tab-bar gutter/footer overlap above, no horizontal
  overflow, the sidebar hidden below `xl`, no masthead collision). **⚠️ Headless Chrome is USELESS
  for this** — it clamps the layout viewport to ~500px CSS regardless of `--window-size`, in both
  headless modes, which reads as a horizontal-overflow bug that also reproduces on `main`. Drive
  real Chrome instead.
  **⚠️ CORRECTION (found during C): window resizing bottoms out at ~500px CSS in REAL Chrome on
  macOS too** — the OS enforces a minimum window width. So **no window-resize check can verify
  anything below ~500px**, and this entry's earlier claim to have verified the five tabs at 320px
  is not supported by that method. Below 500px needs devtools device emulation or a real handset.
  **⚠️ Still outstanding and needing a real device or a signed-in session:** the 320px tab row,
  the safe-area calc in PWA/standalone on a notched phone, and the bell popover painting over the
  tab bar. M1's own browser pass (real mirrored tiles) also remains outstanding.

- **Sub-project C — Home, three modes** ✅ (spec
  `docs/superpowers/specs/2026-07-24-c-home-three-modes-design.md`): Home becomes the app's control
  panel, rendering one of three modes off the existing `accountStatus` union. Read-model + web; no
  migration, no new table, no env var, no worker — plain `./deploy/deploy.sh`, **no `--rebuild`**
  (qualification stays derived, so nothing is stored and nothing needs re-folding).
  **Provisional lives are visible.** `getPlayerPage` gained an **additive** open-life lookup so a
  life inside the five-minute grace window renders as `state: "alive"` with `alive.qualified:
  false` instead of the server reading **idle** while the player is standing on it.
  **⚠️ Do NOT loosen `getPlayerLives`** (`packages/read-models/src/queries.ts`) to do this — it is
  the shared qualified-lives filter behind the dossier's past-life list, the standing AND the
  totals, so widening it would add provisional lives to a public profile's history and to the
  lives/deaths counts. **`aliveAnywhere` must keep excluding them** for the same reason: it feeds
  the dossier's public `Alive ×N` badge and the survivors board's notion of alive.
  The `state` union was deliberately **not** widened to a fourth `"unqualified"` case;
  `alive.qualified` refines it, so no existing consumer has to handle "alive, but".
  **Server rows are grouped `banned → alive → idle`** (`components/servers/grouping.ts`) — the same
  order `getPlayerPage` already ranks. Every server the caller passes comes back; **nothing is
  keyed to a fleet count** (three today, four when Badlands ships). `isSoleRow` is the entire
  definition of "hero": one group holding one row drops its heading. No separate hero component, no
  promotion tie-break.
  **⚠️ There is no "Join server" button anywhere, and there never will be** — a console DayZ server
  has no join URL. `JoinServers` (`components/front-page/join-servers.tsx`) is the honest
  substitute — a full-bleed yellow slab with the three moves as dashed paper tickets and a
  stylized replica of the Xbox server-browser screen, identical on every surface it's mounted on,
  so the copy cannot drift. It **replaced** `HowToConnect` (`components/servers/how-to-connect.tsx`,
  now deleted), which covered the same no-join-URL reasoning with a plainer text panel; that file
  and its three separate mount points are gone, and `JoinServers` is the only connect block left.
  **The search term "One Life" is BRAND COPY, not fleet data.** It is inlined in `join-servers.tsx`'s
  `STEPS` copy ("Search “One Life”") — there is no `SEARCH_TERM` constant. Every server's in-game
  browser name is `One Life <Map> | dayzonelife.com`, so one term finds all of them. It is
  deliberately NOT derived from `servers.name`, which holds the map label alone ("Chernarus") —
  telling a player to search that returns thousands of unrelated servers. `JoinServers`' replica
  DOES print the full browser name per host (`One Life <Map> | dayzonelife.com` in `BrowserReplica`)
  — hand-maintained brand copy verified against a real console screenshot, not derived data; see
  below for the same fact in more detail.
  **`useControls` still exposes `serversLoading`**, the third instance of the loading/empty/failed
  shape after `standingLoading`/`balanceLoading` — `servers: []` is both the unresolved fallback
  and a genuinely empty fleet, so a consumer must check the flag before announcing an empty fleet
  out loud. `HowToConnect`, the panel this flag was introduced for, is gone; `JoinServers` is a
  static illustration (see below) that never reads `servers`/`serversLoading` at all, so the flag
  currently has no consumer. It stays in `useControls`, mutation-tested, for whichever surface
  next lists the live fleet.
  **Home's two RSC fetches (`getSurvivors`, `getServers`) degrade INDEPENDENTLY**, each through its
  own `settleFeed`. A single shared try/catch still passes the older feed-honesty tests while
  silently gutting the other half of the page — pinned by two tests proven red against exactly
  that change (the sitemap has the same rule for the same reason).
  **⚠️ The three-step ladder is GONE — `ladderSteps`/`ladder.ts` and `LadderFrame` were deleted by
  the claim-modal pass (see that entry below); the claim is a dialog now.** What survives from it is
  the reason there was never a fourth step: **"Go play a session" is NOT a step**, because the claim
  autocomplete searches gamertags the LOGS have seen and anyone can type any gamertag, so the site
  can never know whether a signed-in user has played until they verify — a step that can never be
  marked done would strand every player on it. "Go play" is the claim panel's empty state — today
  that's `JoinServers`' closing line ("Play first, claim later — your life is tracked from your
  first spawn."), the surface that replaced the deleted `HowToConnect` — nowhere else.
  **Home's tokens block is a `TokensSummary`, not `TokensPanel`** — balance and purpose only.
  Sending and the referrer stay on `/you`; **spending stays on the ban row** (`ServerCard`'s
  `UnbanView`), which already knows which ban to lift, so a spend control in a tokens panel would
  have to ask which server. `Earn / buy →` is deliberately absent until `/tokens` exists in F.
  `ColdFork` (`components/front-page/cold-fork.tsx`) renders for `signedOut` ONLY — not for
  `unlinked`/`pending` (already sold; they get the ladder) and not while `loading`, so a signed-in
  player never sees a sign-in pitch flash. `SignInCta` survives, still used by `/about`.

- **Sub-project D — Maps + Leaderboard** (D1 + D2 shipped; D3 outstanding) (spec
  `docs/superpowers/specs/2026-07-24-d-maps-leaderboard-design.md`): the two map-shaped surfaces
  stop being separate products. Read-model + API + web; **no migration, no `--rebuild`**.
  **D1 — ONE map-resolution rule, shared by `/maps` and `/survivors`:**
  `last map viewed THIS SESSION → last map PLAYED → alphabetical by display label`. One pure
  `resolveMapDestination` (`apps/web/src/lib/map-resolution.ts`) + one server-side
  `resolveDestinationSlug`/`resolveDestinationFrom` (`lib/resolve-destination.ts`), so the two bare
  paths cannot drift. Both bare paths `redirect()`; `/maps/<slug>` and `/survivors/<slug>` are
  stable and never redirect.
  **⚠️ Tier 3 sorts by `mapLabel`, NEVER the codename** — `enoch` is labelled "Livonia" and sorts
  under L, not E. Today's fleet does not discriminate the two orderings (both put Chernarus
  first), so a naive test passes against the bug; the real test pairs `enoch` against a codename
  falling between "enoch" and "Livonia". `DEFAULT_MAP_CODENAME = "chernarusplus"` is **retired**:
  it happened to be first anyway, so it bought nothing and would go silently wrong the day the
  fleet changed.
  **`ol_last_map` is retired for `ol_map_session`** — a real session cookie (no `max-age`). A year
  is the wrong memory for "where was I?": it lets a map you opened once last spring outrank the one
  you have played all week.
  **⚠️ `GET /me/last-map` takes NO subject parameter** — the session is the only input, so serving
  another player's map history is unexpressible rather than merely rejected (the same shape the
  coordinate routes hold). It answers a signed-out viewer `{ slug: null }` with a **200, not a
  401**: it is a resolution HINT and both callers are public pages, which would have to translate
  a 401 back to "no memory" anyway. `cache-control: no-store, private`.
  **⚠️ `getLastPlayedMapSlug` (`packages/read-models/src/last-played.ts`) resolves the IDENTITY
  first, then queries sessions** — a gamertag is a current label since migration `0025`, so a
  recycled name can match two `players` rows and a direct join would mix a departed holder's
  history in. Most-recently-seen wins, `id` ascending as the tie-break (the same rule `getPlayer`,
  `resolveSlugMatch` and `friend-positions` apply). Its `servers` join is INNER and filters
  `active` + slugged, so a session on a retired server yields NO ROW rather than a slug the router
  must re-reject. Ordered `connected_at DESC` — never `disconnected_at` (null on an open session,
  the very case this exists for).
  **⚠️ No `(player_id, connected_at)` index exists, and none is needed AT THIS FLEET SIZE**: the
  `servers` join bounds the work to one lookup per active server against `sessions_open_idx`.
  Measured on a production dump: **0.083 ms**, a nested loop over 3 servers. **At tens of servers
  this degrades linearly and wants a real index** — that is a migration, and this line is its
  trigger.
  **⚠️ The two fetches in `resolveDestinationSlug` degrade INDEPENDENTLY.** Losing `getServers`
  loses the resolution (we render an honest failure and never guess a path — a remembered slug is
  never trusted without the live list). Losing `getLastPlayedMap` loses only a TIER. And
  `redirect()` throws `NEXT_REDIRECT`, so it must stay OUTSIDE the fetch error handling — inside
  it, the catch swallows the redirect and every visitor gets the error page. That is why the
  fetching lives in the resolver and the throw lives in the page.
  **D2 — the leaderboard.** See the rewritten Survivors leaderboard entry above; the load-bearing
  parts are that the reserved-slug rule is GONE (not unenforced) and that `sort` is dropped from
  the API rather than ignored. Home's board strip follows the same rule and **names the map it is
  scoped to** — an unlabelled top-5 would be silently partial. ⚠️ A failed `getServers` now costs
  that strip too (there is no map to ask a board about), which narrows an independence claim made
  in sub-project C; what still holds is that it renders as a **failure**, never as an empty coast.
  **D3 (outstanding):** `/maps/[map]` moves into `app/(site)/`, gaining the masthead and footer;
  `TopBar`/`MapBottomBar`/`CoordChip`/the `onCenterChange` path/`PlaceSearch`/`searchPlaces` are
  deleted. ⚠️ `MapPage` must drop its own `#main-content` when it moves (the `(site)` layout
  supplies it, and two elements with that id make the skip link resolve to whichever comes first).

## Login avatars, cold-home hero, home consistency + claim modal

- **Login avatars** ✅ (spec `docs/superpowers/specs/2026-07-27-login-avatars-design.md`):
  replaces the RPT character pipeline (SP5, above — removed outright, not deprecated) with
  avatars sourced from a player's login method. The RPT persona mapping mis-attributed across
  players often enough (charID inheritance, cross-gender phantoms from `head_asset`) that the
  portraits it drove were confidently wrong; the fix is to stop generating a persona at all and
  instead show the player's own picture.
  **A new durable `avatars` table** (`user_id` PK → `"user"(id)`, `image bytea`, `hash`,
  `source`, `updated_at`; absent from `REBUILD_TRUNCATE_TABLES`, present in `APP_TABLES`) holds
  three row states: no row (untouched — auto-populate allowed), a row with `image` (live
  avatar), and a row with `image IS NULL` — an **explicit removal tombstone**.
  **⚠️ The tombstone rule is the whole point of a nullable `image` on a durable table: NULL
  means "this player removed their avatar on purpose," and auto-populate must never resurrect
  it.** The after-sign-in mirror only fires when no row exists at all; a re-sync or a fresh
  upload are the only two paths that can turn a tombstone back into a live avatar.
  **One `sharp` pipeline serves both sources** — a direct upload and a provider-image mirror
  both pass through the same decode → 5 MB pre-processing cap → `resize(256, 256, { fit: "cover"
  })` → webp encode (quality 80, which also strips EXIF) → `hash = sha256(bytes).slice(0, 16)`
  → upsert. SVG is rejected (scripting surface). Provider mirroring additionally restricts
  itself to https, at most 3 redirects, a 5s timeout, and the same byte cap streamed.
  **⚠️ Provider CDNs (Discord/Google avatar URLs) are never hotlinked on a public page** — every
  avatar we show is our own mirrored, re-encoded copy at our own URL. Hotlinking would leak a
  visitor's IP to a third party on every page view and would rot the moment a provider's
  rotating CDN URL expired.
  **Hash-addressed public serving**: `GET /avatars/:hash.webp` serves bytes by content hash with
  `cache-control: public, max-age=31536000, immutable` — honest because the hash changes
  whenever the image does, so a URL never needs revalidating. A miss is a 404; the hash discloses
  nothing since it's content-derived and already appears in public payloads.
  **⚠️ All four `/me` avatar routes (`GET /me/avatar`, `POST /me/avatar`, `POST /me/avatar/sync`,
  `DELETE /me/avatar`) take NO subject parameter** — same shape as every other `/me` route in
  this codebase (self-unban, the token routes, the coordinate routes): the session is the only
  input, so reading or writing another user's avatar is unexpressible, not merely rejected.
  **`POST /me/avatar/sync` distinguishes a stale provider URL from a genuine fetch failure
  (2026-07-28):** when `fetchProviderImage` fails with a response status (the provider answered
  but the stored `session.user.image` URL 404s/403s — Discord rotates its avatar CDN URLs, so the
  copy captured at sign-in eventually goes dead), the route returns `409 provider_image_stale`
  rather than the generic `502 fetch_failed`; any existing avatar row is left untouched either
  way. The web maps it to an explicit message telling the player to sign out and back in (which
  re-mirrors a fresh URL) or upload directly, instead of the earlier generic error copy.
  **Read-model `avatarHash` joins are verified-links-only, and require `image IS NOT NULL`** —
  the survivor board (hero + podium rows) and the life timeline hero join `avatars` through a
  `verified` `gamertag_links` row on `lower(gamertag)`, exactly the boundary self-unban and
  friend location sharing already enforce, and a tombstoned row must resolve to `null` →
  silhouette exactly like no row at all. An unverified or renamed-away gamertag also yields
  `null`. **The dossier is no longer avatar-free (avatar/account pass).** It joins `avatars`
  through the same verified + non-tombstoned rule as the board and timeline, and the page's
  signed-in owner (session gamertag matches the page, verified) gets an edit control there.
  **`/you` is DELETED**: avatar management moved onto the dossier (verified players only), and
  sign-out lives in the masthead avatar menu (`account-affordance.tsx`) instead.
  **The avatar edit is a modal dialog, not an in-place panel (avatar-dialog pass, 2026-07-30).**
  `StageAvatar` (`components/player/stage-avatar.tsx`) renders the stage's identity circle plus,
  for the owner only, a pencil that opens `AvatarDialog` (`components/account/avatar-dialog.tsx`)
  — portalled to `document.body`, `z-50`, a drag-and-zoom crop stage
  (`components/account/avatar-cropper.tsx`) over a staged draft that Save is the only commit point
  for. `AvatarPanel` is now dialog-only: its interface is `{ onSaved, onCancel, onAnnounce,
  cropToBlob? }`, it owns no live region, and it is no longer reachable outside `AvatarDialog`.
  **⚠️ `SrStatus` ownership: the live region lives in `StageAvatar`, a SIBLING of the dialog, not
  a descendant of it or of `AvatarPanel`.** A successful save calls `onSaved`, which closes
  (unmounts) the dialog in the SAME commit that would set the announcement text — a `role="status"`
  node that unmounts alongside its own text change announces nothing to a screen reader, because
  the node is gone from the accessibility tree before the change would have been observed. Putting
  `SrStatus` in `StageAvatar` (which outlives the dialog for as long as the pencil is mounted)
  is what makes the announcement survive the close. `onAnnounce` is threaded unchanged from
  `StageAvatar` through `AvatarDialog` to `AvatarPanel`, which calls it imperatively per-mutation
  settlement (never derived from TanStack's `isSuccess`/`isError`) and blanks it in each
  mutation's `onMutate` so a repeated outcome still re-announces. A rejected mutation is ALSO
  surfaced as a visible `role="alert"` inside the panel — the `sr-only` live region alone isn't
  enough for a sighted player, especially one who never opened the dialog's dark surface with
  assistive tech running (2026-07-30 review finding).
  **Deploy:** migration `0029` creates `avatars` and drops `characters`, `character_sightings`
  **and `rpt_files`** (the RPT ingest-cursor table) — touches one durable table and drops three
  projection tables, so it deploys with a plain `./deploy/deploy.sh`, **no `--rebuild`** (nothing
  needs re-folding; the event log never carried character data). `@onelife/rpt-parser` is deleted
  as a workspace package; a normal `pnpm install` on deploy handles it.
  **⚠️ `sharp` is a native dependency, not a pure-JS one** — the API now needs pnpm to fetch its
  linux-x64 prebuilt binary on the deploy host. A failed or skipped native-binary fetch
  (offline install, an overly aggressive `--ignore-scripts`, an unsupported platform) is a
  runtime failure, not a build failure: the api unit fails to boot rather than failing
  `pnpm install`. See `deploy/README.md`.
  **⚠️ `user.image` is user-writable, so `fetchProviderImage` treats it as attacker input, not a
  trusted provider URL.** Better Auth's default `/update-user` endpoint accepts an arbitrary
  `image` string and has no cheap per-field disable (`name`/`image` are hardcoded into the route,
  only `additionalFields` are configurable) — so production fetches are restricted to an https
  **provider-host allowlist** (`cdn.discordapp.com`, any `.googleusercontent.com` host,
  `avatars.githubusercontent.com`), re-checked on every redirect hop so a compliant host cannot
  redirect to an internal target. The old http+loopback carve-out is gated behind an explicit
  `allowTestHosts` param (production always passes `false`, via config env var
  `AVATAR_TEST_FETCH_ALLOW_LOOPBACK`, parsed on the `NOTIFIER_*` safe-side convention — unparseable
  input lands OFF), never a code path a production request can reach.
  **⚠️ Outstanding — needs a real-browser pass pre-ship**, matching how sub-projects B and M1
  record their own outstanding browser checks: the `/you` avatar round trip (upload → the board/
  masthead actually rendering the mirrored image) has never been exercised end-to-end in a real
  browser, only through jsdom/route-level tests.

- **Cold-home ledger hero** ✅ (spec
  `docs/superpowers/specs/2026-07-28-cold-home-ledger-hero-design.md`): the signed-out home's
  `<h1>` is a live casualty ledger — "Deaths to date: N. Still standing: M." — with the death
  figure counting up on load; the brand line demotes to the kicker. Backed by `getSiteStats`
  (`packages/read-models/src/site-stats.ts`) at public `GET /stats`. **Deaths = SQL COUNT of ALL
  ended lives — qualification deliberately does NOT apply** (changed 2026-07-28 from
  qualified-only): the ledger answers "how many lives ended here," so sub-5-minute blips count,
  and this is the one surface whose number exceeds the qualified-only record (boards, funerals,
  bans) — don't "reconcile" it back, and don't point a qualified-only surface at it. Alive =
  `getAliveSurvivors(...).total`, delegated so the headline and the boards can never disagree
  (still qualified-only, the boards' own definition). The deaths/alive fleets also deliberately
  differ (deaths count all servers ever; alive only active slugged ones) — don't "fix" either
  side to match. **A failed
  stats fetch renders the previous evergreen hero** (no banner, never a zero); the fetch is its
  own `settleFeed`, gated on `!signedIn` (the hero is cold-only — don't make it unconditional:
  `getAliveSurvivors` loads the whole kills table). `CountUp` SSRs the real final number,
  animates only post-hydration when motion is allowed, and is `aria-hidden` behind an `sr-only`
  sentence. No migration, no env var — plain `./deploy/deploy.sh`, **no `--rebuild`**.
  **Relaunched (2026-07-28) into the full cold-home pitch.** The hero is now DARK with a
  two-line no-trailing-periods headline ("DEATHS TO DATE" / "STILL STANDING") rendered via
  `FitLine` (hidden-clone measurement to the final string, jsdom-safe against a 0-width
  container) so it fills the container at any width, with the claim button in the hero itself.
  **⚠️ `FitLine`'s measuring clone MUST stay inside its zero-size `overflow-hidden` wrapper.**
  The clone is `absolute` + `whitespace-nowrap` at a fixed 50px, so its box is far wider than a
  phone, and **`visibility: hidden` does NOT remove an element from the document's scrollable
  overflow** — the box still extends the scroll area. Unclipped it made the WHOLE SITE scroll
  sideways on every phone: `documentElement.scrollWidth` measured 453 against a 390px viewport
  and 452 against 320px (the clone's width never changes, so the narrower the screen the worse
  it got), and the home page was the only surface affected because it is the only one that
  renders a `FitLine`. Clipping costs nothing: an ancestor's `overflow` never changes a
  descendant's own box, so `clone.scrollWidth` — the whole point of the clone — is unaffected
  (verified in a real browser at 428px/372px, identical either way). Isolated in a minimal page:
  the hidden span alone gives `scrollWidth` 411 at a 390px viewport, the wrapped one gives 390.
  The cold home is a five-beat pitch, and since the home-consistency pass (2026-07-29, entry
  below) the order is **`Hero` → `Rules` (the three rules of the game) → `JoinServers` (the
  universal yellow slab — see that entry — which replaced `ConnectSection`, now RETIRED with the
  earlier `ColdFork`/`TopSurvivors`) → `CtaSlab` (closing call-to-action) → `Fallen` (a wall of
  recent obituaries)** — **do not reintroduce any of the retired three**, and note this order
  **supersedes the earlier Fallen-before-CtaSlab-before-Join rhythm**: the connect instructions
  now sit with the rules that motivate them and the page closes on the dead. `Fallen` renders
  NOTHING on a failed OR an empty obituaries feed, never a placeholder.
  **The home-polish pass (2026-07-28) extended the pitch to signed-in-but-unverified visitors —
  narrowed to UNLINKED ONLY by the pending-verification experience (2026-07-29).**
  `UnverifiedPitch` (`components/front-page/unverified-pitch.tsx`) renders the same five beats
  for a signed-in user whose `accountStatus` is `unlinked`, with every CTA pointed at
  `#claim` — the hash-driven claim MODAL since the home-consistency pass, not an on-page ladder —
  instead of `/login`. **`pending` renders NOTHING there** — a
  pending player already claimed, so every pitch CTA would demand a done step.
  **The pending-hero pass (2026-07-29, spec
  `docs/superpowers/specs/2026-07-29-pending-hero-design.md`) made the challenge ITSELF the
  pending home's hero.** `PendingHero`/`PendingHeroView`
  (`components/front-page/pending-hero.tsx`, client-gated on pending like `UnverifiedPitch` is
  on unlinked) is a full-bleed dark hero in the cold hero's language — red bottom frame, yellow
  for everything live, a "Step 3 of 3 — one step left" kicker (the 3-step ladder folded to one
  line; it deliberately renders in the expired state too), the gamertag in the `FitLine` h1 (the
  pending page's only h1). It **absorbed the retired `ProveItPanel` and `PendingLead` — do not
  reintroduce them**; `LadderFrame`/`ladder.ts` went the same way in the home-consistency pass
  (entry below) and no longer exist at all.
  **The join-the-servers pass (2026-07-29, spec
  `docs/superpowers/specs/2026-07-29-join-the-servers-design.md`) rebuilt the hero's body as
  EMOTE TICKETS.** The sequence renders as three paper tickets (First/Second/Third mono
  ordinals; `["First",…,"Fifth"][i] ?? `${i+1}.``), a server-confirmed emote flips to solid
  paper with a rotated red CONFIRMED rubber stamp (name dimmed under it), unconfirmed tickets
  are dark with dashed borders. **⚠️ THERE IS DELIBERATELY NO CURRENT-STEP POINTER — no `←`, no
  highlighted "next"** (a test asserts the glyph absent): the old chip strip read as a live
  tracker, which the 15-minute ADM batching cannot honor. The walkthrough list and footnotes are
  gone; one deck sentence + one yellow-flagged status paragraph carry the copy, whose batching
  sentence is pinned VERBATIM ("DayZ reports emotes in batches — confirmations land up to 15
  minutes behind, and this page does not update in real time. Perform all three and you can log
  off; the stamp catches up on its own.") — and a test still pins that no copy claims
  live/instant updates.
  **`id="claim"` is `PendingHero`'s own section** (`page.tsx`) — the masthead's "Finish
  verification → /#claim" lands at the hero top — and for `unlinked` the same hash instead opens
  the modal, so there is no inline claim section on any surface. `AccountPanels`' pending branch
  renders **no visible body** — only the unconditional `VerificationAnnouncer` sibling, pinned by
  `account-panels-pending.test.tsx` (the sign-out footer that used to ride along is gone; the
  masthead avatar menu owns sign-out). `PendingSupport`
  (`components/front-page/pending-support.tsx`) follows below the anchor: **`Rules` →
  `JoinServers` → `Fallen`** (props narrowed to `{ obits }`), so the pending page mirrors the
  cold beat rhythm; it takes the same universal `JoinServers` closing line as everywhere else
  (the pending-only "Any server counts for your emotes." was retired with the `closing` prop).
  **`JoinServers` (`components/front-page/join-servers.tsx`) is the UNIVERSAL connect beat** —
  a full-bleed yellow slab (the only yellow section on the site): FitLine "Join the servers" h2,
  three dashed paper step-tickets (`red-deep` ordinals — correct, they sit on paper), and a
  static replica of the Xbox server-browser screen captioned "What you'll see on your screen".
  Mounted on cold, unlinked and pending, in each case between the rules and the closing beat.
  **It takes NO PROPS** — the `closing` prop was deleted by the home-consistency pass, so the
  closing line is one verbatim string ("Play first, claim later — your life is tracked from your
  first spawn.") on every surface; do not reintroduce a per-surface variant.
  **⚠️ THE REPLICA IS AN ILLUSTRATION, NOT A DATA SURFACE** —
  its player counts are static example numbers, made honest by the caption framing (a picture
  of the game's own UI, like a screenshot in a manual). Do NOT wire it to live data, do NOT
  flag it under live-data honesty (that rule governs surfaces presenting OUR data), and do NOT
  cite it as precedent for fabricated counts elsewhere. Its host names
  (`One Life <Map> | dayzonelife.com`) are brand copy verified against a real console
  screenshot, hand-maintained like `SEARCH_TERM`; the `HOSTS` array (Host A–Z) is where a
  fourth map (Badlands) gets added.
  The masthead `AccountAffordance` has a pending branch: menu item "Finish verification →" →
  `/#claim`, the claimed tag's initial in the disc, and a `border-yellow` cue.
  `UnverifiedPitch` is **client-gated on `useAccountStatus`,
  not server-gated on the session cookie** — SSR renders nothing, and it stays rendering nothing
  until status resolves to `unlinked`, because a `verified` player must never see a
  pitch flash before the branch below it takes over; appearing beats vanishing for the
  unverified case. **Fetch gating is no longer cold-only** — `stats` and `obituaries` (now
  fetched via `getSiteStatsCached`/`getObituariesFeedCached`, a cookie-free 60s shared fetch
  cache, not the cookie-forwarding `getSiteStats`/`getObituariesFeed`) are fetched
  **UNCONDITIONALLY, cold and signed-in alike**, since both the cold pitch and `UnverifiedPitch`
  need them; only `survivors` (the verified sidebar's data) stays signed-in-only. **This
  supersedes the original two-directional gating claim above — do not restore
  stats/obituaries to cold-only.** The signed-out home renders no `AccountPanels` wrapper at
  all — that div (with the `#claim` anchor) exists only on the signed-in branch, alongside
  `UnverifiedPitch`. (The verified-only `HomeSidebar`/`HomeShell` gate this paragraph used to
  describe is gone — see the one-column note above.)

- **Home consistency + claim modal** ✅ (spec
  `docs/superpowers/specs/2026-07-29-home-consistency-claim-modal-design.md`, plan
  `docs/superpowers/plans/2026-07-29-home-consistency-claim-modal.md`): one beat rhythm for all
  three cold-ish homes and the claim ladder replaced by a dialog. **Presentation only** — no
  migration, no API route, no env var; plain `./deploy/deploy.sh`.
  **The beats are `Hero` → `Rules` → `JoinServers` → `CtaSlab` → `Fallen`** on cold and unlinked,
  and `PendingHero` → `Rules` → `JoinServers` → `Fallen` on pending (no `CtaSlab` — a pending
  player has already answered the call). `JoinServers` takes no props at all now.
  **`ClaimModal` (`components/account/claim-modal.tsx`) is HASH-DRIVEN, and that is the whole
  design**: every trigger — hero CTA, `CtaSlab`, the masthead menu item — is a plain link to
  `/#claim`, so no shared open state is threaded anywhere and the modal works from any page.
  It opens **ONLY for `unlinked`**; the same hash is inert for pending, where it is
  `PendingHero`'s scroll anchor.
  **⚠️ Dismissing CLEARS the hash** (`history.replaceState`, not `location.hash = ""`, which would
  add a history entry and jump the scroll). A hash left behind swallows the next CTA click
  outright — a same-hash click fires no `hashchange` — and would re-open the modal on refresh.
  **⚠️ The masthead's unlinked item is a plain `<a>`, NOT a Next `<Link>`.** Same-page hash
  navigation through `<Link>` goes via `pushState`, which fires no `hashchange`, so the modal
  would never open from the home page. Pending's item can stay a `<Link>` because it only needs
  the scroll.
  **⚠️ Every account-menu item closes the menu explicitly** (`account-affordance.tsx`).
  Route-change close is not enough for a hash-only item: `/#claim` from `/` changes no route, so
  the popover stayed open ON TOP of the modal it had just opened — and, because each surface
  saved and restored `body.style.overflow` itself, the last one out restored the `hidden` it had
  captured from the first, leaving the page scroll-locked with no dialog on screen. Hence
  **`useModalBehavior`'s scroll lock is REF-COUNTED** (module-level `lockCount`/`savedOverflow`,
  `apps/web/src/lib/use-modal-behavior.ts`): only the first lock saves, only the last unlock
  restores. Both were found in the browser, not by the suite — jsdom sees the DOM, and the DOM was
  correct in both cases.
  **`AccountPanels` owns its own padding** and its unlinked/pending branches render no visible
  body, so no empty padded wrapper can reappear on a page whose claim UI has moved into a dialog.
  `ladder.ts`/`ladderSteps`/`LadderFrame` and the inline sign-out bar are **deleted** — sign-out
  lives in the masthead avatar menu alone.
  **Browser-verified in real Chrome** (beat order on all three homes, the modal from all three
  triggers, ✕/Escape/backdrop closing + hash clearing + focus restore, claim → pending flip,
  "Finish verification" scrolling to the hero) and **at 390×844 via CDP
  `Emulation.setDeviceMetricsOverride`** (no horizontal overflow, replica rows ellipsised not
  clipped, five tabs, the footer's About link not under the tab bar). ⚠️ Window resizing bottoms
  out around 500–1000px CSS in real Chrome on macOS, so **device-metrics emulation over CDP is the
  only method that verifies anything below that** — `--window-size` and `resize_window` both lie.

## Legal pages

- **`/terms` and `/privacy`** ✅ (spec `docs/superpowers/specs/2026-07-29-legal-pages-design.md`):
  two static prose routes under `(site)/(boxed)/`, rendered by one shared `LegalDoc` from typed
  `LegalSection[]` modules in `apps/web/src/content/legal/`. No fetches — the loading/failed/empty
  rule has nothing to apply to.
  **⚠️ Invariants:**
  1. **Both pages print one `EFFECTIVE_DATE` constant.** Two separately-maintained dates would
     drift, and a stale date on a legal page is a claim about when you last told the truth.
  2. **The page tests pin clauses by CONTENT, not by count.** Each asserted string is a disclosure
     or a limitation — the contact address, the no-affiliation disclaimer, tokens having no cash
     value, obituaries being machine-written, the OpenRouter/Anthropic disclosure, Arizona
     governing law, the append-only deletion carve-out. A failure means restore the clause, never
     relax the assertion.
  3. **The AI disclosure is the sharpest omission risk.** `apps/newsdesk` sends the player's
     gamertag and their killer's gamertag to OpenRouter/Anthropic to write the obituary. Nobody
     would guess that; it must stay disclosed as `apps/newsdesk` evolves.
  4. **The deletion promise is bounded by the event log.** Account data goes; lives, deaths, kills,
     positions and obituaries stay, because `events` is append-only and every projection rebuilds
     from it. Do not widen the promise without building the erasure first.
  5. **Section `id`s are stable anchors.** They are how a support reply links straight to a clause;
     renaming one silently breaks every link already sent.


## Verified home + profile redesign

- **The verified home and `/players/{slug}` are ONE surface** ✅ (spec
  `docs/superpowers/specs/2026-07-30-verified-home-redesign-design.md`, plan
  `docs/superpowers/plans/2026-07-30-verified-home-redesign.md`): a **life-tickets stage**
  (`components/player/ticket-stage.tsx`) with the gamertag as the `h1` and one ticket per server,
  a **controls slab** (`components/account/controls-slab.tsx`, owner only), and a **morgue** of
  filed obituaries (`components/player/morgue.tsx`). `VerifiedHome` composes the owner's three;
  `PlayerProfile` composes the public two. `viewer: "owner" | "public"` is the single switch, so
  the two pages cannot drift apart.
  **⚠️ This retires several rules recorded above.** `PlayerHero`, `StandingCard`, `PastLifeCard`,
  `OwnerAvatar`, `TokensPanel`, `TokensSummary` and `StandingGroups` are **deleted**. Statements
  earlier in this file about "Home's tokens block is a `TokensSummary`", about `TokensPanel`'s
  `myGamertag`/`exclude`, and about `standing-card.tsx` rendering the `banCountdown` null branch
  describe code that no longer exists — the invariants they carried moved, they were not dropped:
  `banCountdown`'s null-means-"Lifting…" rule now lives on the ticket, and the
  loading-is-not-zero rule now lives on `FigurePending` and on `Morgue`'s `state` prop.
  **⚠️ Invariants:**
  1. **`/players/{me}` redirects `307`, NEVER 308.** Whether that URL redirects depends on WHO is
     asking. A permanent redirect would be cached by browsers and crawlers against a
     session-dependent decision and would follow the player after sign-out. The rename redirect
     immediately below it in the same route stays 308 — a rename is permanent for everyone. The
     two live three lines apart; do not unify them.
  2. **The morgue lists FILED OBITUARIES only, and zero is a real, common state.** `apps/newsdesk`
     files one only for a qualified death, only past the forward-only `NEWSDESK_SINCE` cutoff, and
     can fail permanently at `NEWSDESK_MAX_ATTEMPTS` — so the list is a strict SUBSET of the
     player's ended lives and unfiled lives appear nowhere. That is intended. Do not "restore" the
     missing lives by falling back to `pastLives`.
  3. **`Morgue` takes `state`, not just `entries`.** `entries.length === 0` cannot tell "nothing
     filed" from "the fetch died", and printing "no obituary has been filed" over a failed fetch
     is a lie about the player's own history. The heading count is withheld entirely until the
     fetch resolves.
  4. **The controls split is `lg` (1024), never `md` (768).** At `md` each half is ~336px —
     narrower than the share row (label + five 44px targets + native-share button) and narrower
     than "INVITE A SURVIVOR" plus its figure on one line. Both wrapped raggedly across the whole
     768–1023 band. Do not move it back to `md` to "use the space"; the space isn't there.
  5. **Every ticket carries a Timeline link, in BOTH viewers**, pointing at THIS ticket's life —
     the running one when alive, the triggering one when banned, the last one when idle. `life ==
     null` (never played this map) renders NO link rather than a broken one. This reverses an
     earlier "no ticket links out" rule; the link is back and it stays (Steve, 2026-07-30).
  6. **Spend is owner-only AND banned-only.** The ticket is the one place that knows WHICH ban a
     token would lift, which is why the affordance lives there and not in the controls slab.
     `TicketSpend` does not re-derive owner-ness from a client session query — the server's
     `viewer` prop decides.
  7. **Discord has no web share intent.** Its share target is an honest copy-to-clipboard whose
     label says so. There is no `discord.com/share` URL to "fix" this with.
  8. **`navigator.share` is an EXTRA button, never the only path** — it is absent on desktop
     Chrome/Firefox — and the capability check runs in an effect after mount so SSR and the first
     client render agree.
  9. **The stage's avatar pencil is the SINGLE edit path.** The dossier's old "Update photo ↓"
     disclosure was retired with it; two edit paths on one page is how the avatar work shipped
     twice.
  10. **Referral claims are recorded at SIGN-IN, not at verification**, because verification runs
      in `apps/verifier` — a background worker with no HTTP request and therefore no cookie. Hence
      `claimReferrer` (only the REFERRER must be verified; a repeat is a silent no-op) as distinct
      from `setReferrer`. It is safe because `grantReferral` inner-joins `gamertag_links` on
      `verified`, so the row pays nothing until the referee verifies, and pays automatically once
      they do.
  11. **Every failure mode of `POST /me/referrer/claim` is a 200 with `claimed: false`.** An
      unknown slug, an unverified referrer, a self-referral and an already-claimed referee are all
      things the VISITOR cannot be blamed for and must not be told about. The one real error is
      401.
  12. **The invite cookie is cleared WHATEVER happens.** A cookie that survives a failed claim
      retries forever, on every page load, for thirty days.
  13. **A referral pays ONCE per referee, ever.** `yyyymm` is deliberately not in the idempotency
      key — it used to be, which made this an annuity: ten referees minted 11 tokens a month
      against a 1/month base grant.
  14. **The signed-in home's placeholders are LAYOUT RESERVATIONS, and their geometry is
      load-bearing.** `StageSkeleton` (`ticket-stage.tsx`) and `Morgue`'s loading render exist to
      hold open the space their resolved content will occupy — the home measured **CLS 0.672** on
      production against a 0.1 "good" budget, essentially all of it one shift when a ~150px
      "Reading your file…" stub was replaced by a 583px stage and a morgue. Consequences:
      - **`StageSkeleton` must track `TicketStage`'s geometry** — same section padding, same
        `cols` formula, same `min-h-[210px]` cards. A card GRID rather than one fixed `min-h` is
        what makes the reservation hold at every width, including the mobile column where the
        stacked tickets are several times the desktop row's height.
      - **`slots` is a count of empty boxes, not a claim about the fleet.** It follows the
        `servers` query when that has resolved and falls back to `FALLBACK_TICKET_SLOTS`
        otherwise. Being wrong costs a small shift, never a false statement, which is why the
        "never hardcode a server count" rule (which governs copy and the real ticket grid) does
        not reach it.
      - **`PanelsSkeleton` reserves the VERIFIED shape deliberately**, before `useControls` knows
        which mode it is in: right for every returning verified player, close enough for `pending`
        (whose `PendingHero` renders its own dark hero), wrong only for `unlinked` — a first-run
        state an account passes through once.
      - **Reserving space must not become stating a fact.** The skeletons carry no gamertag, no
        tally, no per-server state and no obituary count; `aria-busy`/`role="status"` mark the
        wait, and the error render drops both (a failure is not a load in progress).
      - **RTL cannot prove any of this** — it has no layout. The suites pin the structure (box
        count, absence of fabricated facts); the numbers come from the browser.

## Hamburger nav + sticky masthead + one width

- **The mobile `TabBar` and the desktop inline nav row are both gone, replaced by ONE menu** ✅
  (spec `docs/superpowers/specs/2026-07-30-app-shell-hamburger-sticky-masthead-design.md`, plan
  `docs/superpowers/plans/2026-07-30-app-shell-hamburger-sticky-masthead.md`). **Presentation
  only** — no migration, no API route, no env var, no worker; plain `./deploy/deploy.sh`.
  **`components/shell/nav-menu.tsx` is THE navigation now, at every width** — one hamburger
  dropdown in the masthead carrying the site nav (Home, Maps, Survivors, Obituaries, About),
  Friends when signed in, and the account items (Your profile / Finish verification / Claim your
  gamertag / Sign out / Sign in). This retires everything the Sub-project B and "Home consistency"
  entries above say about `TabBar` (`components/shell/tab-bar.tsx`, deleted along with the two
  bottom gutters that reserved space for it — the footer's `4rem` and the map friends sheet's
  offset; the `env(safe-area-inset-bottom)` insets themselves survive) and about the masthead
  avatar owning a popover of account items — **`shell/account-affordance.tsx` is now just an
  avatar disc that LINKS to `/` (the player's own home) plus the signed-out `Sign in` link; its
  popover moved into `nav-menu.tsx`.** Every claim elsewhere in this file that an account item
  (claim/verify/sign-out/"Finish verification →") lives in "the masthead avatar menu" or
  `account-affordance.tsx` now means `nav-menu.tsx` — the mechanics (plain `<a>` for the hash-only
  claim items, every item closing the menu explicitly, the ref-counted scroll lock) carried over
  unchanged, just relocated.
  **The masthead is `sticky top-0`, not static** — navigation stays reachable scrolling a long
  board or obituary. `html { scroll-padding-top: 3.5rem }` was added so in-page anchors (`/#claim`)
  land below it rather than under it.
  **`app/(site)/(boxed)/layout.tsx` is now the ONLY place a content width is declared, at
  `max-w-5xl` (1024px, was 1440px)** — see the ⚠️ comment on that file, which is the source of
  truth. This retires the `max-w-[1440px]` two-column grid described in the R3 entry near the top
  of this file (already noted superseded there by pill re-homing and again by "THERE IS NO
  SIDEBAR" above). **Be precise about what actually changed width**, because the wrong version of
  this sentence is how a future reader concludes the rule is broader than it is: the `max-w-[68ch]`
  containers on `/friends` and on the `/survivors` redirect's FAILURE page were stripped (the
  user-visible board is `/survivors/[map]`, which was already 1024), `inbox.tsx`'s `max-w-2xl`
  (672) was stripped, and the redundant `max-w-5xl` on `survivors-board.tsx` and
  `player-profile.tsx` was stripped too — those two already equalled the box, but a component
  restating the box's width silently diverges the moment the box moves. `/welcome` was never in
  scope: it renders nothing, it is a redirect. Terms and Privacy did NOT widen — `legal-doc.tsx`
  is 768 and stays 768, a prose measure. **`/obituaries` moved inside
  `(boxed)`** (URLs unchanged — route groups are not path segments). `/maps/[map]` stays outside
  `(boxed)` and full-bleed — and so does the `/maps` redirect's failure page, which therefore
  KEEPS its `mx-auto max-w-[68ch]` while its byte-identical `/survivors` twin lost one: nothing
  else would constrain it. `/login`'s `max-w-md` form and the `max-w-3xl` prose measures
  (`legal-doc.tsx`, `obituary-article.tsx`) survive as narrow-by-design elements inside the box,
  not exceptions to the rule.
  **The LAYER LEGEND still has exactly three altitudes — this work adds none.** `z-40` is the
  masthead alone again now that `TabBar` is gone (see the correction on that entry above);
  `nav-menu.tsx`'s panel is `z-50`, ranking it inside the masthead's own stacking context, same as
  the old account popover and the retired hamburger's full-screen menu before it.
  **Nothing here is verified in a real browser** — see the outstanding-work entry in `CLAUDE.md`
  added alongside this one; it must not be trimmed at PR time.
