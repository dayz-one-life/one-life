# R5b — Birth Notices / Fresh Spawns — Design

**Slice:** R5b of the Tabloid redesign content engine (follows R5a Obituaries).
**Status:** Approved design, ready for implementation plan.
**Primary sources:** `2026-07-16-tabloid-redesign-design.md` (roadmap), `2026-07-17-r5a-newsdesk-obituaries-design.md` (the pattern this mirrors).

## Goal

Retire the static **Fresh Spawns** teaser and turn it into a live editorial vertical: the newsdesk
engine writes a short, in-voice **Birth Notice** for every qualified life going forward, and the
`/fresh-spawns` section (plus two new home-page blocks) surfaces them.

## The core inversion (why this is not a find-and-replace of R5a)

An **obituary** works because death completes the arc — there is a Rap Sheet of kills and a "Final
Reload" timeline, a finished story. A **birth notice is the opposite**: the subject just qualified,
has done almost nothing, and — critically — **is still alive and out there playing**. Three
consequences shape the whole design:

1. **The current life is thin.** There is no kill list, no death, no timeline. The material comes
   instead from the **player's global priors** — every prior life they have lived, on any map. The
   notice recognizes the face: *"oh, it's you again."* First-lifers get the inverse gag —
   *"No priors. A stranger to these shores."*
2. **The subject is alive → the Fog Rule is paramount.** Map is the dateline; **never a coordinate
   or pin**. A living subject can still be hunted, so location leakage is a real harm, not just a
   style rule.
3. **The tone flips** from eulogy to **doomed optimism + recognition**. The paper welcomes the new
   fool with mock-grandeur and world-weary familiarity. Mockery targets the *record or the
   situation*, never cruelty for being new.

Section identity: **The Nursery** (a deliberate parallel to Obituaries' **The Morgue**).

## Scope

**In:**
- A new `kind = 'birth_notice'` written into the existing durable `articles` table (one small
  migration for column nullability + a feed index — see Data Model).
- A **global player-priors** read-model, and a birth-notice article read-model pair.
- A **birth pass** added to the existing `apps/newsdesk` worker (shared client, shared dry-run gate),
  **forward-only** from an explicit ISO cutoff (`NEWSDESK_BIRTH_SINCE`); **unset ⇒ birth pass off**.
- API routes `GET /birth-notices` + `GET /birth-notices/:slug`.
- Web: the real `/fresh-spawns` feed + `/fresh-spawns/[slug]` interior (retiring the teaser and its
  `noindex`), OG image + JSON-LD, and **two new home-page blocks** — Latest Obituaries and Latest
  Fresh Spawns.
- Mirrored test suites across all four surfaces.

**Out (deferred):**
- **Images** — R5c (the `articles` image columns remain reserved and unused here; birth notices are
  text-only).
- **News feed + news-led home (11a/10a)** — R5d. R5b only adds two content *blocks* to the existing
  front-page shell; it does not restructure the home page.
- **A live-arrivals ticker / real-time roster on the page** — the raw `GET /fresh-spawns` roster route
  stays available but is not consumed by this UI.
- **Regeneration UI** — birth notices are generate-once; `prompt_version` is stored for a future
  optional regeneration slice.
- **Backfill of historical births** — forward-only by design; lives born before the cutoff are never
  written up.

## Data Model

Reuse the `articles` table (`packages/db/src/schema.ts`). Birth notices are a **new `kind` value**,
`'birth_notice'`, in the same table with the same schema.

- **Natural key** `(kind, serverId, gamertag, lifeStartedAt)` — unchanged. Because `kind` is part of
  the key, a single life can carry **both** an obituary and a birth notice with no collision.
- **Feed ordering** = `lifeStartedAt DESC` (freshest spawn first). `lifeStartedAt` is already present
  and non-null (it is a natural-key column), so it is the stable, rebuild-safe sort key.
- **Column reuse:** headline / lede / body / pullQuoteText / pullQuoteAttribution / tags / facts jsonb
  / promptVersion / model / attempts / lastError / status / slug are all reused as-is. The `cause`,
  `kills`, `longestKillMeters`, `timeAliveSeconds` columns describe the *current* (thin) life and may
  be zero/null — that is expected and fine.

### Migration `0010_birth_notice_columns`

Two changes, both additive/safe on the durable table (deploy with plain `./deploy/deploy.sh`, **no
`--rebuild`**):

1. **`death_at` becomes nullable** — a living spawn has no death. Existing obituary rows keep their
   non-null `death_at`; obituary reads (which order by `death_at`) are unaffected.
2. **Add index** `articles_kind_status_born_idx` on `(kind, status, life_started_at)` — the birth
   feed's query index (parallel to the existing `articles_kind_status_death_idx`).

Birth-notice rows store `death_at = NULL` while alive, or the life's `ended_at` if it has since died
(used only for the "didn't last the day" past-tense note; not the feed sort key).

## Read-models (`packages/read-models`)

### `player-priors.ts` — the reputation source of truth (deterministic, never the LLM)

```
interface PlayerPriors {
  livesLived: number;          // count of the player's PRIOR lives (excludes the current one)
  longestLifeSeconds: number;  // best prior life; 0 if none
  totalKills: number;          // confirmed kills across all prior lives
  usualDeathCause: string | null;   // most-common death cause across prior lives
  lastDeathCause: string | null;    // cause of the most recent prior death (for a callback line)
  bestLifeMap: string | null;  // map of the longest prior life (cross-map flavor)
}

getPlayerPriors(db, gamertag: string, beforeLifeStartedAt: Date): Promise<PlayerPriors>
```

- **Global** across all servers (players are one identity per gamertag; lives are per-server).
- **Excludes the current life** — priors are what the player did *before* this one (all lives with
  `startedAt < beforeLifeStartedAt`).
- A first-lifer returns `livesLived: 0` and null/zero fields → the "No priors" branch.

### `birth-notice-articles.ts` — the article-backed reads (mirror of `obituary-articles.ts`)

```
BIRTH_NOTICES_FEED_PAGE_SIZE = 20

interface BirthNoticeCard {
  slug; gamertag; map; mapSlug; lifeNumber;
  headline; lede; tags;
  bornAt: Date;              // lives.startedAt (feed order + dateline)
  minutesToQualify: number | null;  // from facts
  priorLives: number;        // from facts (for the card fact strip)
}
interface BirthNoticesFeed { rows: BirthNoticeCard[]; total; page; pageSize }
interface BirthNoticeArticle extends BirthNoticeCard {
  body; pullQuote: { text; attribution } | null;
  priors: PlayerPriors;      // hydrated from the facts jsonb
  endedAt: Date | null;      // null while alive → drives the "still drawing breath" vs. past-tense note
}

getPublishedBirthNotices(db, { page, pageSize? }): Promise<BirthNoticesFeed>
  // WHERE kind='birth_notice' AND status='published', ORDER BY life_started_at DESC, paginated + count
getBirthNoticeBySlug(db, slug): Promise<BirthNoticeArticle | null>
  // same predicate + slug; hydrates pullQuote + priors from facts jsonb
```

Both exported from the package barrel `index.ts`.

## Worker — extend `apps/newsdesk` (not a new app)

Add a **birth pass** alongside the existing obituary pass in the same worker. Shared: the OpenRouter
client, the pino logger, the DB handle, and the **single `NEWSDESK_DRY_RUN` gate** (both passes honor
it). New files mirror the obituary set one-for-one:

- `birth-facts.ts` — `buildBirthFacts(target, timeline, priors): BirthFacts`. Assembles the arrival
  facts (bornAt, minutesToQualify from `qualifiedAt − startedAt`, persona/character from the timeline)
  and folds in `PlayerPriors`. `BirthFacts` is the snapshot stored in `facts` jsonb.
- `birth-voice.ts` — `export const BIRTH_SYSTEM`. The system prompt: the Nursery voice (doomed
  optimism + recognition), the Fog Rule, all R5a hard bans, the "never cruel to first-lifers" rule,
  and the JSON output contract.
- `birth-prompt.ts` — `BIRTH_PROMPT_VERSION = 'birth-v1'`; `buildBirthPrompt(facts): {system, user}`
  (user lines = arrival facts + priors + one of two tone directives: *known-quantity* when
  `livesLived > 0` vs. *stranger* when `0`); Zod `parseBirthNotice(raw): BirthNotice` where
  `interface BirthNotice { headline; lede; body; pullQuote: {text; attribution} | null; tags: string[] }`;
  `composeBirthTags(facts, llmTags): string[]` — deterministic reserved base
  `["Fresh Spawns", mapLabel(map), priorsTag]` + ≤1 non-reserved LLM flavor tag (`priorsTag` =
  e.g. `"First Life"` vs `"Repeat Offender"`).
- `birth-pg-store.ts` — `birthNoticeSlug(headline, gamertag, serverId, lifeNumber)` (deterministic,
  rebuild-stable); `findBirthNoticeTargets(db, { since, limit, maxAttempts })` (qualified lives,
  alive-or-dead, `startedAt >= since`, no article on the natural key with `status='published' OR
  attempts >= maxAttempts`, order by `startedAt`); `publishBirthNotice(db, input)` (upsert on the
  natural key, `status='published'`, stores `BirthFacts` in `facts` jsonb, `death_at = target.endedAt
  ?? null`); `recordBirthNoticeFailure(db, {target, error})` (failed stub, `attempts += 1`).
- `birth-tick.ts` — `birthNoticeTick(db, deps): Promise<NewsdeskResult>`, mirroring `newsdeskTick`:
  `findBirthNoticeTargets` → per target `getLifeTimeline` (null → skip) + `getPlayerPriors` →
  `buildBirthFacts` → **dry-run gate (continue before any client call or write)** →
  `generateBirthNotice(client, facts)` → `composeBirthTags` → `publishBirthNotice`; on throw →
  `recordBirthNoticeFailure`.
- `generate.ts` — add `generateBirthNotice(client, facts): Promise<BirthNotice>` beside
  `generateObituary` (same injectable `CompletionClient`).
- `main.ts` — each interval runs **both** ticks (obituary, then birth). Warns loudly under dry-run.

### New config (`config.ts`)

- **`NEWSDESK_BIRTH_SINCE`** — ISO-8601 timestamp; the forward-only cutoff. **Unset (or empty) ⇒ the
  birth pass does not run** (safe default, parallel to the dry-run safety). The operator sets it to
  the go-live moment to begin coverage.
- Birth pass reuses `NEWSDESK_MODEL`, `NEWSDESK_DRY_RUN`, `NEWSDESK_BATCH_CAP`,
  `NEWSDESK_MAX_ATTEMPTS`, `NEWSDESK_TEMPERATURE`, `NEWSDESK_INTERVAL_SECONDS`.

## API (`apps/api`)

New `apps/api/src/routes/birth-notices.ts` → `registerBirthNoticesRoutes(app, db)`:
- `GET /birth-notices?page=` (`page` coerced, `.catch(1)`) → `getPublishedBirthNotices`.
- `GET /birth-notices/:slug` (Zod slug; 400 on bad, 404 when null) → `getBirthNoticeBySlug`.

Wired into `apps/api/src/app.ts` beside `registerObituariesRoutes` / `registerFreshSpawnsRoutes`. The
existing `GET /fresh-spawns` roster route is left in place (unused by this UI).

## Web (`apps/web`)

### Feed — `app/fresh-spawns/page.tsx`

Replace the `<TeaserPage>` with a real feed and **drop `robots: { index: false }`**. Kicker
**"The Nursery"** + H1, `BirthNoticeCard` list, `BirthNoticesPagination`, empty-state copy, and a
`loading.tsx` skeleton. `generateMetadata` with canonical + OG.

### Interior — `app/fresh-spawns/[slug]/page.tsx`

Deliberately shorter than an obituary. Sections in order:
1. Header — red kicker `Birth Notice · {MAP} BUREAU · {dateline}`, Oswald H1 headline, byline
   *"Filed by The Desk · {GamertagLink} · Life N · {mapLabel}"*.
2. **One paragraph** of body (LLM).
3. **Pull quote** (LLM, in-voice, anonymous; conditional).
4. **"The Priors"** box (deterministic) — lives lived · longest life · kills across all lives · usual
   cause of death, plus a one-line arrival note (washed ashore {ago}, made it real after {N} min,
   persona). First-lifer → *"No priors. A stranger to these shores."*
5. Tags chips (conditional).
6. A **status line** — *"Still drawing breath"* while `endedAt` is null, else a past-tense
   *"Didn't last the day"*-style note.
7. **"More Fresh Meat"** rail (other recent notices, self-filtered).

Plus `generateMetadata` (title/desc/canonical/OG `type:article`), a JSON-LD `<script>` via the
shared `ldScript()` helper, and `opengraph-image.tsx` (a birth variant of the dossier card: "Birth
Notice · {dateline}" kicker, headline, a priors readout row).

### Components — `components/birth-notices/`

Mirror `components/obituaries/`: `birth-notice-card.tsx`, `birth-notice-article.tsx`
(`BirthNoticeArticleView`), `priors-box.tsx`, `more-fresh-meat.tsx`, `birth-notices-pagination.tsx`.
Promote the shared `pull-quote.tsx` and the numbered pager to a shared location so both verticals use
one implementation. Presentational pieces are props-only and unit-tested.

### Home page — `app/page.tsx` + two `front-page/` blocks

Add `front-page/latest-obituaries.tsx` (from `getObituariesFeed(1)`, top 3–4) and
`front-page/latest-fresh-spawns.tsx` (from `getBirthNoticesFeed(1)`, top 3–4), wired into `page.tsx`
below `TopSurvivors`. Style mirrors `TopSurvivors`. Each block links to its section and degrades
gracefully to an empty/quiet state when there is no content yet.

### Web lib

- `lib/birth-format.ts` — `freshSpawnsHref(page)`, `birthNoticeHref(slug)`, `birthDateline(map,
  bornAtIso, now)`, `priorsFacts(article)` (the "Priors" box rows).
- `lib/api.ts` — `getBirthNoticesFeed(page)`, `getBirthNotice(slug)`.
- `lib/types.ts` — client `BirthNoticeCard` / `BirthNoticesFeed` / `BirthNoticeArticle` (dates as
  strings).
- `lib/seo.ts` — `birthNoticeLd(a, url)` (a `NewsArticle` with `datePublished = bornAt`,
  `about: Person`, `isPartOf: CollectionPage "Fresh Spawns"`), rendered through `ldScript()`.

## Voice & Fog Rule (inherited from R5a, adapted for the living)

- **Fog Rule (hard):** map is the dateline; **no coordinates, ever**. The subject is alive.
- **Tone:** doomed optimism + recognition. Welcome the fool with mock-grandeur; the paper has seen
  this face before (or notes, pointedly, that it hasn't).
- **Protect the new:** first-lifers are ribbed *affectionately*, never mocked for being new or
  unlucky. If there is mockery, it targets a *repeat offender's record* (punch at the reputation,
  never down at a stranger).
- **Hard bans (carried over):** no sincerity clichés; no wink/meta; no corporate/data-speak; no
  slurs or real-person attacks; pull-quote attributions stay anonymous/in-voice.

## Testing

Mirror R5a's layout across all four surfaces:
- **Newsdesk** — unit (no DB): `birth-facts.test.ts`, `birth-prompt.test.ts` (`parseBirthNotice`,
  `composeBirthTags`, tone-directive selection), `generate.test.ts` addition (stub client). DB-backed
  (`getTestDb`): `birth-pg-store.test.ts` (slug, `findBirthNoticeTargets` incl. the `since` cutoff and
  re-entrancy), `birth-tick.test.ts` (dry-run writes nothing / never calls client; live path
  generates + publishes; unset-`since` ⇒ no targets), plus a `config.test.ts` case for
  `NEWSDESK_BIRTH_SINCE` parsing/off-by-default.
- **Read-models** — `player-priors.test.ts` (global aggregation, current-life exclusion, first-lifer),
  `birth-notice-articles.test.ts` (order, excludes failed, paginates, hydrate + null-on-unknown).
- **API** — `birth-notices.test.ts` (feed page, slug 200/404/400).
- **Web** — component tests for card / article view / priors box / pagination; `birth-format.test.ts`;
  `seo.test.ts` addition for `birthNoticeLd`.

## Edge cases (handled explicitly)

- **Qualified then died before the sweep** — still gets a birth notice (distinct `kind` from any
  obituary); the status line renders the past-tense variant when `endedAt` is set. Both articles
  coexist for the one life.
- **First life / no priors** — `livesLived: 0` → the "stranger to these shores" branch in both the
  prompt tone directive and the Priors box.
- **Un-slugged server (`mapSlug` null)** — null-safe throughout (mirrors R5a); the interior still
  renders, priors still resolve.
- **Before the cutoff** — `findBirthNoticeTargets` filters `startedAt >= since`; with `since` unset
  the pass is off and writes nothing.
- **Empty home blocks** — each front-page block degrades to a quiet empty state before content exists.

## Deploy / go-live notes

- Migration `0010` auto-applies on `./deploy/deploy.sh` (Phase 7). **Durable table → do not
  `--rebuild`.**
- To switch on birth coverage: set `NEWSDESK_BIRTH_SINCE` (ISO) in the shared worker env, keep
  `NEWSDESK_DRY_RUN` on for a first safe run (confirm "DRY RUN: would generate birth notice" logs),
  then set `NEWSDESK_DRY_RUN=false` and restart. Add `NEWSDESK_BIRTH_SINCE` to `.env.example`
  alongside the other newsdesk keys.
- The deploy-fleet wiring for the newsdesk worker landed in v0.14.1 (`onelife-newsdesk` is in
  `deploy/deploy.sh`'s `SERVICES`; the newsdesk env keys are in `.env.example`). The only remaining
  host-only manual step from R5a go-live is authoring `/etc/systemd/system/onelife-newsdesk.service`.
