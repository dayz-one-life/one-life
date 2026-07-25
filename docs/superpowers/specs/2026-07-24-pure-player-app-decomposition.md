# Pure Player App — decomposition

**Date:** 2026-07-24
**Status:** agreed, sub-project A specced

## What changed

One Life stops being a tabloid that happens to have player tools and becomes a **player tool**:
onboarding, a control panel, a live map, friends, and a leaderboard. The LLM content engine —
obituaries, birth notices, the news vertical and the editorial newsroom — is removed entirely.

Growth moves from content to **referrals**. SEO is explicitly not a goal; the site is not trying to
be found, it is trying to be useful to someone who already found the servers.

## The three audiences

The home page renders one of three modes, derived from the existing `accountStatus` union:

1. **Cold** (`signedOut`) — a pitch. Two sub-cases that the site *cannot distinguish*: a visitor
   who arrived via a referral link (we know the referrer, so they get one CTA naming that person),
   and an uninvited visitor who may or may not already play. The uninvited page therefore leads
   with a **fork** — "already playing? claim your life" above "new here? here's how to join" —
   because the already-playing visitor is the highest-intent one and bounces off marketing.
2. **Signed in, unlinked or pending** (`unlinked` | `pending`) — a three-step ladder: signed in →
   claim your gamertag → prove it's you. Not a pitch; they are already sold.
3. **Verified** — the control panel. Lives, tokens, friends, map.

**We can never know whether a signed-in user has played until they verify.** The claim
autocomplete searches gamertags the *logs* have seen; anyone can type any gamertag. "Go play a
session" is therefore not a step in the ladder — it is the empty state of the claim search.

## Sub-projects

| | Sub-project | Depends on | Spec |
|---|---|---|---|
| **A** | Retire the content engine | — | `2026-07-24-content-engine-removal-design.md` |
| **B** | App shell | A | not yet written |
| **C** | Home — three modes | B | not yet written |
| **D** | Maps + Leaderboard | B | not yet written |
| **E** | Session location sharing | D | not yet written |
| **F** | Referral system | — | not yet written |
| **G** | Token purchase | F | not yet written |

`A → B → C` is the critical path. `D → E` can run alongside C once B lands. `F` is independent of
everything and can ship at any point. `G` wants F's `/tokens` page to exist first.

### A — Retire the content engine

Pure deletion. `apps/newsdesk`, the `articles` and `article_images` tables, the article
read-models, the obituaries/fresh-spawns/news routes and components, the Discord notifier, the
image pipeline, the editorial CLI and the `drafting-an-article` skill.

Kept deliberately: **player pages, life timelines and the death-cause classifier**. `classifyDeath`
and `dossierForLife` are player-facing features that the newsdesk happened to consume; they are not
part of the content engine.

Sequenced first, and alone. It is the only purely subtractive sub-project, so doing it before B
means B is not designing a nav around routes that are about to vanish. It is also the one release
that is irreversible — dropping `articles` destroys 168+ rows of generated prose and their images —
so it gets its own deploy and its own verified backup.

### B — App shell

- Retire `ControlsRail`, `ControlsSheet`, `MobileAccount` and everything under
  `components/controls/` that is not reused by the new home panels.
- Mobile **tab bar**: Home · Map · Board · Friends · You, dropping to four items (Home · Map ·
  Board · Sign in) when signed out. The tab bar is *not* the nav; it is the five things a player
  does often.
- Shared **page-header strip** below the invariant masthead: **title · count · control**. Used by
  Home, Maps, Leaderboard and Friends. The count is the only live part, so honest loading/failed
  rendering is solved once.
- Nav reduces to Home · Maps · Leaderboard · About.
- Desktop keeps a 380px sidebar on Home only: friends online, your standing on the map you are
  alive on, notifications. Nothing actionable is exiled to it.

### C — Home, three modes

- **Grouped server rows.** Group by state in the order the backend already ranks
  (`banned → alive → idle`), one row per server, **every server always shown**. A row is
  self-contained: pip, server, the one number that matters, the one-word reason, its own action.
- **A group holding exactly one row, when it is the only group, renders expanded.** That is the
  entire definition of "hero" — no separate hero component, no promotion tie-break, no layout that
  only works at N ≤ 3.
- **Spend lives on the ban row**, not in the tokens panel — spending means choosing *which* ban to
  lift, which matches `redeem(banId)`.
- **"Not yet qualified" is a distinct state** (amber, hollow pip). A life under the five-minute
  threshold carries no ban risk and the site currently never says so.
- **No fake join.** A shared **How to connect** panel: search one site-wide term, then a verbatim
  list of `servers.name` for every active server, then "favourite them". Used on the verified home,
  the cold landing, and the claim empty state. Idle rows link to it rather than repeating it.
- Tokens panel is a two-line summary; `Earn / buy →` points at `/tokens`.

### D — Maps + Leaderboard

- **One resolution rule, two surfaces:** last map viewed *this session* → last map **played**
  (`getLastPlayedMapSlug`, inner-joined to an active **slugged** server) → alphabetical **by
  display label** (`mapLabel`, not slug or codename — `enoch` would sort under E). `ol_last_map`
  is retired.
- `/maps` and `/survivors` redirect; `/maps/livonia` and `/survivors/livonia` are stable
  shareable URLs that never redirect. The map segment stays a `servers.slug`.
- **Leaderboard is time-alive only, per map, living players only.** Deletes the whole sort layer:
  `/survivors/kills`, `/survivors/longest`, the explicit-default redirect, and the rule that a
  server slug must never be `kills`/`time`/`longest`. **No combined board.**
- **The map rejoins the site shell** — `/maps/[map]` moves into `app/(site)/`, gains the standard
  masthead and footer and the shared page header. Deletes `MapTopBar`, `MapBottomBar`, `CoordChip`,
  the crosshair, the whole `onCenterChange` path, and place search (`PlaceSearch`, `searchPlaces`,
  and `GamertagAutocomplete`'s `onPick` if unused elsewhere). Town labels stay.
- Locate and Online overlay the map bottom-right. The empty board is a designed state.

### E — Session location sharing

Replaces F2's consent model wholesale.

- **Effective share** = a `location_shares` row exists, **and** the granter is online, **and**
  `granted_at ≥ the granter's current session's connected_at`. The third clause makes it
  self-expiring — no cleanup worker, no TTL, no cron — and it keys on a **timestamp, never a
  session id**, so a projection rebuild cannot resurrect a stale share.
- **Per-person grants, from the map's online list only**, friends and strangers alike. A
  **share-with-all** shortcut grants to everyone online *at that moment* — a snapshot, not a
  standing rule, so it fails closed for late joiners and keeps the model to one concept.
- **Online players only.** A grant is always made during a session, which is what anchors clause 3.
- A permanent **"N can see you · Stop"** chip on the map. Every session starts closed.
- **A 13th notification kind**, `location_shared`, push + in-app, written inline in the API request
  like the friend notifications. Natural key
  `location_shared:<granteeUserId>:<granterGamertag>:<granterSessionConnectedAt ISO>` — one per
  granter, per grantee, per game session.
- **Drops** `friendships.a_shares_location`, `friendships.b_shares_location`,
  `user_preferences.share_location` and `shouldShareLocation`. Dropped outright, not left dormant.
- **Friends loses sharing entirely** — presence + roster only. A friend row links to the server they
  are on, or last played; the label promises a person only when they are actually sharing.
- Every existing coordinate rail is retained: one egress route with **no subject parameter**,
  `cache-control: no-store, private`, last-known-position only (never a trail),
  `MARKER_MAX_AGE_SECONDS`, the verified-link inner join, and the collapsed reciprocity boolean.

### F — Referral system

- `/j/<code>` sets a first-party cookie and redirects home. **Attribution only — clicks are not
  recorded.**
- Attributed at signup from the cookie; **paid out on verification, not signup**, because signup is
  farmable with throwaway accounts and verification requires an in-game emote.
- Invite link lives on `/tokens`. Replaces `POST /me/referrer`.

### G — Token purchase

$5 per token, quantity stepper, on `/tokens`. Needs a processor, an **idempotent** crediting
webhook, refunds and chargebacks. Real money — its own spec and its own tests.

## Cross-cutting decisions

**Mobile floors.** Every control below `md` is min 52px at 15px, not the 44/13 accessibility floor —
44/13 shipped in v0.40.0 and still read as fiddly on a real phone.

**Three z-altitudes, still.** Content → z-40 bar → z-50 overlay. The tab bar must not become a
fourth; it is ordinary flow content where possible, and shares the z-40 altitude where not.

**Honest rendering is the recurring risk.** Three modes multiplied by each panel's
loading/empty/failed states is a large matrix, and this is the class of bug that has bitten this
repo repeatedly. Loading, genuinely-empty and failed are three distinct renders everywhere. Never
`?? 0`, never `[]`-means-idle.

**The green-suite trap.** Contrast, stacking, layout collapse, safe-area and the dark-token swap are
all invisible to jsdom — RTL asserts the DOM, not paint. Every sub-project touching layout needs a
real-device verification task, not a hope. M1's browser pass is *still outstanding*; it should be
folded into B or D rather than deferred again.
