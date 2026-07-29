# Ticket hero + Join the Servers — design

**Date:** 2026-07-29
**Status:** Approved (iterated live with Steve on a browser preview harness; this records the
outcome)
**Supersedes:** the presentation half of `2026-07-29-pending-hero-design.md` (v0.61.0). The page
structure that spec built (one `#claim` anchor, `AccountPanels`' pending branch reduced to
announcer + sign-out, `PendingLead`/`ProveItPanel` retired) is unchanged; this redesigns what
renders inside and below the hero.

## 1. Why (v0.61.0 missed the mark)

Steve's critique of the shipped pending hero, all confirmed in a real browser:

1. **The chip strip read as a live tracker.** One highlighted "current" emote with a ← pointer
   promises real-time progress that the 15-minute ADM batching cannot deliver — the yellow
   warning fought the UI instead of the UI agreeing with it.
2. **Text dust.** After the giant headline, everything collapsed into four clusters of 11px mono
   caps. No balance against the headline; nothing carried the deck weight the cold hero has.
3. **The connect section looked pasted in** — bare prose paragraphs floating on empty paper, on
   every surface that mounts `HowToConnect`.
4. **Container chaos** — five different content widths on one page.

## 2. The hero: emote tickets ("Variant A")

`PendingHeroView` (`components/front-page/pending-hero.tsx`) keeps its frame (full-bleed
`bg-dark`, `border-b-[6px] border-red`, kicker, FitLine h1 + yellow gamertag) and replaces
everything below the h1:

- **Deck** (sans `text-lg`, `max-w-2xl`, cream-dim): "Join any One Life server and perform these
  three emotes, in order. Other emotes in between don't matter — the order does."
- **The sequence as three paper tickets**, full container width, `sm:grid-cols-3`, uniform
  `min-h` so mixed-length names (longest label: "point at self", 13 chars — two-line wraps are
  fine) hold one row height. Each ticket: mono ordinal overline **First / Second / Third**
  (`["First","Second","Third","Fourth","Fifth"][i] ?? `${i+1}.``), then the emote name in
  display type (`text-3xl md:text-5xl`), centered.
  - **Unconfirmed ticket:** dark, `border-2 border-dashed border-dark-line`, paper text, yellow
    ordinal.
  - **Confirmed ticket:** solid `bg-paper`, name dimmed to `opacity-30`, and a rotated red
    **CONFIRMED** rubber stamp overlaid (`-rotate-[8deg] border-4 border-red bg-paper/70`,
    display `text-2xl`) — the dossier's Verified-stamp language.
  - **⚠️ NO current-step pointer, no arrow, no highlighted "next" state.** The sequence is
    orders to carry out; only server-confirmed state renders differently. This is the honesty
    fix and must not be reintroduced.
  - SR: keep `role="list"` + `aria-label="Emote sequence"`, per-ticket `sr-only` "— confirmed by
    the server" / "— not yet confirmed", and the separate `SrStatus` progress node ("Step N of M
    confirmed") exactly as today.
- **Status paragraph** (replaces the walkthrough list + the two footnotes): sans `text-base`,
  `max-w-2xl`, `border-l-4 border-yellow pl-4`; bold yellow lead "The server has confirmed N
  of M." then: "DayZ reports emotes in batches — confirmations land up to 15 minutes behind,
  and this page does not update in real time. Perform all three and you can log off; the stamp
  catches up on its own."
  - **⚠️ This REPLACES the old verbatim batching line.** The pinned copy test moves to pin the
    NEW sentence verbatim; the no-live/instant-copy regex test
    (`/instantly|immediately|watch (this|it) update|updates? live/i`) is unchanged and must
    still pass. The negation "does not update in real time" is load-bearing.
  - The 3-step "how this works" walkthrough is deleted — the deck sentence plus the Join the
    Servers block below carry it.
- **Footer row:** mono yellow "Expires in {countdown}" + the quiet "Cancel claim" button
  (min-h-[44px]).
- **Expired state:** unchanged from v0.61.0 (same frame, "Your verification for {tag} expired"
  h1, SkewCta "Start a new challenge →", cancel). The "Step 3 of 3 — one step left" kicker still
  renders in both states (documented + pinned in v0.61.0's fix wave — keep both).

## 3. The pending home flow

`PendingSupport` becomes **`Rules` → `JoinServers` → `Fallen`** (was: `ConnectSection` variant →
`Fallen`). Full pending page: PendingHero (in `#claim`) → sign-out strip (AccountPanels,
unchanged) → Rules → JoinServers → Fallen. The dark hero → light rules strip → yellow slab →
paper Fallen rhythm mirrors the cold home's beat structure.

`ConnectSection`'s `kicker` prop (added earlier today) dies unused — see §5.

## 4. `JoinServers` — the universal connect block

New `components/front-page/join-servers.tsx`, replacing the prose connect treatment everywhere.
A full-bleed **yellow** slab (`bg-yellow`, `border-y-4 border-ink`, ink text) — the only yellow
section on the site:

1. **Heading** `Join the servers` via `FitLine` (`text-[clamp(2.5rem,8vw,9rem)]` fallback),
   filling the container width. Rendered as `h2` (it is a section, never the page h1).
2. **Three step tickets**, full width, `md:grid-cols-3`: `bg-paper`, **`border-2 border-dashed
   border-ink`** (the hero tickets' dashed grammar), centered; mono ordinal overline in
   **`text-red-deep`** (light-surface token — correct here) **First / Second / Third**, then
   display `text-2xl md:text-3xl`: **Search "One Life" / Pick your map / ★ Favorite them**.
   No body copy under the tickets — the replica below does that work.
3. **Caption** (mono 11px bold): "What you'll see on your screen", then the **console replica**,
   full container width, `border-[3px] border-ink bg-dark`:
   - Tab row: Favorites · Official · **Community** (red chip). No LB/RB chips, no controller
     button glyphs anywhere — Steve cut them.
   - Red **SEARCH BY NAME** bar with a bordered dark field: mono `ONE LIFE` + a blinking paper
     caret block (**`motion-safe:animate-pulse`** — static under reduced motion).
   - Host table: mono header row Host / Map / Players; one row per map, **Host A–Z**
     (Chernarus, Livonia, Sakhal): `★ One Life {Map} | dayzonelife.com` · map name · players.
   - Footer: `Servers found: 3`.
   - **⚠️ The replica is an ILLUSTRATION, not a data surface — Steve's explicit call.** The
     player counts are static example numbers (14/26, 3/16, 6/26) and the caption framing
     ("What you'll see on your screen") is what makes that honest: this is a stylized picture
     of the game's own UI, exactly like a screenshot in a manual. Do NOT wire it to live data,
     and do NOT flag it under live-data honesty — that rule governs surfaces presenting OUR
     data as current state. Equally: this exemption is for the framed illustration only and is
     no precedent for fabricated counts anywhere else. The server names
     (`One Life <Map> | dayzonelife.com`) are brand copy verified against Steve's real console
     screenshot (2026-07-29), maintained by hand like `SEARCH_TERM` — a Nitrado rename must
     update them here.
   - The map list is static brand copy in this component (three maps), NOT derived from
     `GET /servers` — consistent with the illustration framing; the fleet memory says never
     hardcode a COUNT in copy/grids, so the rows render from one local array a fourth entry
     (Badlands) can be added to.
   - A11y: the replica keeps ordinary text semantics (no `role="img"` — it has real text a
     screen reader should walk); the mono caption line immediately above is its label in the
     reading order, and tests target the replica's own text, not a wrapper role.
4. **Closing line**, centered display type (`text-center font-display text-2xl md:text-3xl`,
   `max-w-3xl mx-auto`): default **"Play first, claim later — your life is tracked from your
   first spawn."** One optional `closing` prop overrides it — the pending page passes
   **"Any server counts for your emotes."** ("claim later" is a done step for them). That prop
   is the ONLY per-surface variation; everything else is identical everywhere.

**Container discipline (site rule for these sections):** objects (tickets, replica) span the
full container; prose sits at one `max-w-2xl` measure; the closing line is the single centered
exception. No other widths.

## 5. Where it mounts / what retires

| Surface | Before | After |
|---|---|---|
| Cold home (signed out) | `ConnectSection` (light prose) as final block | `JoinServers` as final block |
| Unlinked home (`UnverifiedPitch`) | no connect section (ladder empty state only) | `JoinServers` appended after `CtaSlab` |
| Pending home (`PendingSupport`) | `ConnectSection` kicker variant → `Fallen` | `Rules` → `JoinServers` → `Fallen` |

- **`ConnectSection` is retired** (component + tests + its day-old `kicker` prop). The cold
  home's "ends light before the dark footer" rule survives — yellow is a light-valued surface,
  and `Fallen`/footer ordering is unchanged on cold (Hero → Rules → Fallen → CtaSlab →
  JoinServers).
- **`HowToConnect` (the compact card + region) survives** in exactly two places: the unlinked
  claim ladder's empty state and the idle server rows (`StandingGroups`). It is contextual
  furniture there, not the page's connect beat. One page can now carry both the JoinServers
  section and a HowToConnect card (unlinked home) — they have different accessible names, so
  the one-landmark rule is not violated; a test should pin both render without a duplicate
  "How to connect" landmark.
- The pending home's Rules mount means `Rules` now renders for cold, unlinked AND pending — it
  is audience-neutral copy already.

## 6. Testing

- `pending-hero.test.tsx` rewrite: tickets (ordinals, dashed/confirmed states, stamp, sr-only
  state text, NO pointer glyph anywhere — assert `←` absent), new status-paragraph verbatim
  pin, no-live-copy regex, deck, footer, expired branch + kicker-in-expired, h1 name, red-deep
  absence on the dark surface.
- New `join-servers.test.tsx`: heading, three tickets with red-deep ordinals + dashed borders,
  replica rows (names verbatim, A–Z order), "Servers found: 3", no LB/RB/button-glyph text,
  default vs `closing`-prop line, and the no-live/instant-copy regex.
- Page-flow tests: cold home ends with JoinServers (ConnectSection gone), unlinked renders it
  after CtaSlab, PendingSupport order Rules → JoinServers → Fallen; `three-modes` /
  `pending-support` updates.
- **Browser checklist (release notes):** the yellow slab + tickets at phone width; FitLine on
  "Join the servers"; the replica's table at 320px (Host cell truncates); stamp legibility.

## 7. Out of scope

- Live per-server online counts (Steve chose illustration numbers; a future block may revisit).
- Any change to claim/verify mechanics, polling, or the `#claim` anchor structure (v0.61.0).
- The `Fourth`/`Fifth` ordinal fallback exists in code but sequences are length-3 today.

No migration, no API change, no env var, no worker — plain `./deploy/deploy.sh`, no `--rebuild`.
The `design-preview` harness route is throwaway and must NOT ship.
