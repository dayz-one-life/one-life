# R5d — The News vertical (design)

**Status:** design, pending implementation plan.
**Slice:** the fifth and last tier of the Tabloid redesign roadmap. Retires the static `/news` teaser.
**Predecessors:** R5a (newsdesk + Obituaries), R5b (Birth Notices), R5c (article images).

All production figures in this document were derived from a restored 7-day production dump
(`2026-07-11` → `2026-07-18 20:12:31 UTC`, referred to below as *the reference instant*) and independently
re-verified. Where a statistic is definition-sensitive, the definition is stated inline.

---

## 1. Summary

R5d adds a third article kind — `news` — to the existing `apps/newsdesk` engine and ships a `/news` feed and
interior. News articles are **features**: longer than the routine notices, image-led, and about events the
other two verticals structurally cannot cover.

Two triggers:

- **The Standing Dead** — a qualified life, still open, whose player has stopped playing *and who has earned
  coverage* (§4.1). The subject is an abandonment, not a death.
- **The Long Form** — two or more qualified deaths clustered in time and space on one server. The subject is
  a shared ending.

Everything else previously proposed for News is out of scope, for the reasons in §2.

---

## 2. Why this slice is much smaller than it was designed to be

Three design passes produced a menu of roughly twenty News formats. A production dump was then restored and
mined. **Fourteen are dead on arrival**, and the reason is a single number.

| Reality (verified) | Consequence |
|---|---|
| **6 PvP kills exist in total**, made by 2 killers — one of them the dev test account | Every combat-keyed format dies. Excluding the test account, a single player accounts for all remaining kills. |
| **68 of 97 players have exactly one life, and 63 of those lives are still open** — they left without ever dying | There is no cast of recurring celebrities to rank or profile. |
| **Median ended life = 408s (6.8 min)** by `playtime_seconds` | The modal life has almost no story in it. |
| **7 days of archive exist** | Anniversary and "On This Day" formats are temporally impossible. |
| **Suicide is 46 of 84 ended lives**; the dev account is 27 of those | Most "deaths" are spawn rerolls, not drama. |
| **4,795 infected hits produced 3 infected deaths** | Players are mauled constantly and survive it. |

The abundant material is what nobody designed for: **5,096 `hit_events`, 5,633 `positions`, 542 emotes** (369
of them `EmoteSitA`, the logout pose), and **78 open qualified lives whose owners have walked away**. The
paper publishes obituaries for 45 deaths while ignoring a larger population of disappearances.

**Design consequence:** News is not about violence. It is about *absence* — people who stopped, and people
who ended together.

### The fiction lane is rejected

A prior pass designed a complete no-data lane (invented correspondents filing dispatches). It is **not**
built, now or later.

The moat is that every sentence is checkable against something a real player lived through. A
majority-invented front page destroys that, and thin real data makes the invented share *larger*, not
smaller. There is also direct evidence it would produce worse copy rather than more of it — see §10 defect 5,
where the engine already repeats itself verbatim once facts run out.

The correct response to a slow week is a shorter paper.

---

## 3. Scope, and the three-PR split

This spec describes eight workstreams, three of which can break currently-working production output on their
own. **It ships as three PRs**, in order. A revert of the news feature must not revert the obituary-quality
fixes.

- **PR-A — Phase 0 (no schema change).** Defects 1, 2, 4 and 5 in §10, plus `recentProse`. Ships
  immediately, revertable alone, improves 100% of future obituary and birth-notice output.
- **PR-B — plumbing (no user-visible change).** Migration `0014`, the four `targetWhere` edits, the
  partial-index regression test, and the shared `ArticleBody` renderer with both shipped interiors moved onto
  it.
- **PR-C — the vertical.** Trigger read-models, `newsTick`, the `NEWSROOM` image menu and its prerequisites,
  API, web surface, teaser retirement.

**Out of scope:** every other format from the earlier menus; the fiction lane; regenerating the 45 published
obituaries (`articles.facts` is frozen forward-only — the Phase 0 fixes protect future output only); Discord
notification for news; and **the news-led home page, which moves to §14 follow-ups** — this narrows R5d as
previously scoped, and the CLAUDE.md roadmap line is updated in PR-C.

---

## 4. The two triggers

### 4.1 The Standing Dead

**Predicate.** A life where:

- `ended_at IS NULL`;
- the shared `qualifiedLifeCondition` holds;
- `MAX(COALESCE(s.disconnected_at, s.connected_at)) < referenceInstant - NEWSDESK_STANDING_DEAD_HOURS`
  (default **72**). The `COALESCE` is load-bearing: `disconnected_at` is nullable, and a stale *open* session
  is exactly the crash-and-never-returned case this vertical exists for. A naive `MAX(disconnected_at)`
  evaluates NULL and silently excludes it. 7 of 627 sessions in the dump have no disconnect.
- `playtime_seconds >= NEWSDESK_STANDING_DEAD_MIN_PLAYTIME_SECONDS` (default **1800**);
- **the subject has earned coverage** — `priorLives >= 1 OR hitsAbsorbed >= 100` (§4.1.1);
- the trigger's eligibility instant is at or after `NEWSDESK_NEWS_SINCE` (§4.1.3).

#### 4.1.1 The earned-coverage clause — the ethical core of this format

Without it, the verified subject pool is **15 lives, of which 11 are the player's first-ever life and all 15
belong to players who have never killed anyone**; 13 of 14 distinct gamertags have never verified a link,
meaning they have never visited the site. That is a machine for writing permanent, indexed articles about
strangers who tried the server once and left — the exact class the brand bible protects ("what's never fair
game is the helpless"), and it is not fixable with a tone rail, because the problem is *subject selection*.

With the clause (`priorLives >= 1 OR hitsAbsorbed >= 100`, where `hitsAbsorbed` counts `hit_events` against
the subject within the life window), the pool is **7 of 15** today. Every survivor either chose to come back
after a previous life or physically endured something worth reporting.

**A first-life, zero-kill, low-contact bounce is never a Standing Dead subject.** This is a hard predicate
clause, not prompt guidance.

#### 4.1.2 Verified population (at the reference instant)

| filter | count |
|---|---|
| open lives | 110 |
| open and qualified | 78 |
| + idle ≥ 72h | 29 |
| + playtime ≥ 30 min | 15 |
| + earned coverage | **7** |

#### 4.1.3 Eligibility, idempotency, and retraction

`NEWSDESK_NEWS_SINCE` gates on the **trigger's eligibility instant** (the moment the life crossed the idle
threshold), *not* on `lives.started_at`. Gating on `started_at` would make all seven verified subjects
ineligible forever and leave `/news` empty for days, while the `NEWSDESK_NEWS_MAX_PER_TICK` default of **2**
would be guarding against a flood that could not occur.

`natural_key = standing_dead:{serverId}:{gamertag}:{lifeStartedAt}` — one article per life, ever. It is
computed **before** generation and written by **both** the publish path and the failure-stub path; the news
upsert targets `natural_key` with `targetWhere: isNotNull(articles.naturalKey)`. Without this, every failed
tick inserts a fresh row, `attempts` never increments, and the anti-join never fires.

**Retraction is required, in the same PR.** This is the only thing the paper publishes that its subject can
falsify by acting, and it stays live and indexed. `newsTick` runs a de-publication sweep: any published
`standing_dead` article whose life has a session after the article's `created_at` moves to a retired status —
the interior `noindex`es and the feed drops it. In the 7-day dump, 5 distinct players resumed after a gap
exceeding 72h, and a 7-day window can barely contain a 72h gap plus a return, so that is a floor.

The interior also renders a **status line computed at request time** — still idle ("as of publication, N days
without a sighting"), returned ("UPDATE: subject was seen again on {date}"), or died since (link to the
obituary). The prose is never regenerated; only the status line is live. This mirrors the "still drawing
breath" line the Fresh Spawns interior already ships.

Because `article_images.article_id` FKs into `articles` with `ON DELETE CASCADE`, deleting a retracted
article also drops its image. That is the desired behaviour.

#### 4.1.4 Fog Rule — stricter than any existing vertical

The subject is a **live character standing somewhere**. No coordinates, no landmark, no region, no route,
no distance between two fixes. Map dateline only.

**Safe material:** `playtime_seconds`, hits absorbed and survived, deaths avoided, life number, priors,
character persona, total distance covered **as a scalar only** (never a start or end fix), and the idle
duration — labelled honestly as idle time, never as survival time.

**The last recorded emote is not safe as specified.** It is `EmoteSitA` for 13 of the 15 subjects (the
remaining 2 are NULL), so it carries zero variance and would reintroduce §10 defect 5 by design. Worse,
`EmoteSuicide` is the second most common emote in the database (68 occurrences); on an *open* life it would
narrate a suicide gesture as the last act of a living, non-consenting person. Therefore: the last recorded
**expressive** emote only, from an allowlist (`EmoteTaunt | EmoteGreeting | EmotePoint | EmoteSurrender`),
with `EmoteSuicide` hard-excluded and `EmoteSitA` treated as absence-of-signal and never rendered as an act.
Honestly noted: that allowlist covers roughly 49 events in the entire corpus, so this slot cannot carry the
format.

### 4.2 The Long Form

**Predicate.** A **clique**: a maximal set of lives on the same server in which *every pair* satisfies both
`NEWSDESK_LONGFORM_WINDOW_SECONDS` (default **180**) and `NEWSDESK_LONGFORM_RADIUS_METERS` (default **100**),
seeded from the earliest unclaimed death. Transitive chaining is rejected — with three deaths, chaining and
cliques give different member sets, which feed both `natural_key` and the primary-subject choice, so the same
event would yield different articles. All six verified rows are pairs, so the dump never exercises this.

**Death position source.** Neither `lives` nor `kills` stores coordinates; the only source is `positions` —
the last fix at or before `ended_at`. Coverage is **84/84 deaths (100%)** and every fix is coincident with the
death instant (max staleness 0.0 min in the dump). A `NEWSDESK_LONGFORM_MAX_FIX_AGE_SECONDS` guard (default
**120**) discards any subject whose fix is older, as protection against future data — ten minutes of movement
is roughly a kilometre against a 100 m radius.

The lookup resolves `player_id` by joining `players` inside the query, which uses the existing
`(server_id, player_id, recorded_at)` index. The id is transient and never persisted, which §11 permits. No
new index is required.

**Verified fire rate at 180s / 100m — six pairs:**

| A | B | causes | server | Δt | Δm |
|---|---|---|---|---|---|
| GabeFox101 | CUPID18 | infected / died | Chernarus | 27s | 40m |
| YrJustBad | YrJustBad | suicide / suicide | Livonia | 27s | 90m |
| YrJustBad | YrJustBad | suicide / suicide | Livonia | 35s | 88m |
| YrJustBad | YrJustBad | suicide / suicide | Livonia | 35s | 74m |
| YrJustBad | YrJustBad | suicide / suicide | Livonia | 39s | 96m |
| YrJustBad | Cee Lo GREEN 96 | pvp / pvp | Chernarus | 152s | 51m |

**Four mandatory exclusions**, each a real failure mode visible above:

1. **Self-cluster** — all subjects must have distinct gamertags. Removes 4 of 6.
2. **Any suicide subject** — discard a cluster *containing* a suicide, not merely an all-suicide one. A
   mixed cluster would narrate a named real player's suicide as half of a shared fate, which is factually
   false: a reroll and a companion's mauling are two unrelated events. Suicides span 15s–5381s in the dump,
   so a suicide can easily be a qualified subject.
3. **Qualified subjects only** — every subject life must satisfy `qualifiedLifeCondition`.
4. **Suppressed gamertags** (§13.3).

After exclusions: **one clean fire in seven days.** Do **not** widen the window to compensate — 300s/150m
yields twelve pairs and the six additional ones are all dev-account noise. The Long Form is rare by design.
**It may go multiple weeks dark; that is not a bug to be tuned away.**

**Primary subject** = earliest `ended_at`, tie-broken by gamertag ascending. Never by `lives.id`, which is not
stable across a projection rebuild.

**`natural_key = long_form:{serverId}:{earliestDeathAt}:{sortedGamertags.join("+")}`.** A cluster that later
grows a third member yields a different key and therefore a second article. At a once-weekly fire rate this
is an accepted, bounded risk; the operator remedy is to manually retire the smaller article.

**The fresh-subject tone branch.** The worked example — CUPID18 and GabeFox101 — were both on their
first-ever life, both roughly 1.85 hours old, and neither had ever killed anyone. That is two fresh spawns
eaten by zombies: the protected class. No exclusion catches this, and none should, because it is the best
story in the database. Instead, `facts.allFreshSubjects` (mirroring the existing `freshSpawnVictim` flag)
drives a tone branch: **when every subject is a first-life, zero-kill player, the story is about the world —
the outbreak, the coincidence, the server — never about the two men's competence.** Subjects named neutrally,
no gear-gap ledger, no needle.

---

## 5. Article length, and why it is a consequence rather than a setting

The existing corpus is 168 articles with a **median of 112 words and a maximum of 165** (words = whitespace
tokens across `lede + body`). The longest article ever produced is 3.6× short of the 600-word target; the
median is 5.4× short.

A hand-written spike (the CUPID18/GabeFox101 story, 619 words) established why, and it is not a prompt
problem. The spike carried **thirteen distinct verified facts**, and each fact bought a paragraph. The
routine notices are short because an ordinary single life yields perhaps four facts and the model correctly
stops.

**Therefore: length is funded by fact density, never requested.** Both triggers were chosen partly because
they are fact-dense. The prompt states a target range; **nothing enforces a minimum**, because a hard floor
is a padding instruction and, worse, a genuinely thin cluster would burn an attempt against
`NEWSDESK_MAX_ATTEMPTS` and write a failure stub instead of a short honest article.

The spike also established the structure both triggers use: **a timeline with a turn in it** — arrival,
contact, the long middle, the crisis, and then a *second* crisis after the obvious one, which is where the
story lives.

For the Long Form the turn is what happened after the deaths. **For the Standing Dead the turn is the moment
the world stopped receiving word of him, reported from inside the fiction.** The prompt forbids `the player`,
`logged off`, `stopped playing`, `lost interest`, and any second-person real-player framing, asserted as a
forbidden-token test alongside the §11 coordinate rail. Narrating a real human's off-server decision as the
climax would breach the bible's Tier-2 ban on targeting a real person rather than an in-game persona —
especially given 13 of 14 subjects have never visited the site.

**Known risk:** after the §4.1.1 earned-coverage clause and the §4.2 exclusions, the verified corpus is ~7
Standing Dead subjects and ~1 Long Form cluster in seven days. The vertical may be too small to sustain a
feed at current player counts. The honest answer if so is to **ship the plumbing and hold the prose** until
the community grows.

---

## 6. Data model

**Decision: one `kind='news'`, a `natural_key` column, a deterministic primary subject, co-subjects in
`facts`.**

`natural_key` gives rebuild-stable idempotency without changing a single inferred Drizzle type. Making the
existing key columns nullable would turn `articles.gamertag` into `string | null` and ripple through both
read-models, the image store, and every web serializer for no benefit. A normalized `article_subjects` child
table is the correct long-term shape but cannot prevent a duplicate parent row, so it is deferred;
`facts.subjects[]` is shaped to match its eventual columns so that migration is a pure jsonb backfill.

**Migration `0014_news_articles`** (hand-written — `drizzle-kit generate` does not emit the partial-index
recreate correctly; precedent is `0013`):

- add `natural_key text`, unique where not null;
- make `articles_kind_server_gamertag_life_uniq` **partial**, `WHERE kind IN ('obituary', 'birth_notice')`;
- add `articles_kind_status_created_idx (kind, status, created_at)`;
- add `body_blocks jsonb` (§8).

It rewrites an index on a live table but needs **no `--rebuild`** — `articles` is durable and excluded from
the projection rebuild.

**Serialization is part of the contract.** Timestamps serialize as `toISOString()` (UTC, millisecond
precision); gamertags appear verbatim as stored in `players`, never lowercased (gamertags are matched
case-insensitively elsewhere in this codebase, so this must be pinned). A unit test asserts one literal key
string.

**The riskiest edit in the release** follows from the partial index: both existing stores'
`onConflictDoUpdate` must gain a matching `targetWhere`, or Postgres raises *"no unique or exclusion
constraint matching the ON CONFLICT specification"* and **obituary publishing dies on the next tick**. There
are exactly four call sites — publish and failure-stub in each of `pg-store.ts` and `birth-pg-store.ts`. The
regression test that publishes an obituary and a birth notice twice each is the blast-radius guard and is
mandatory.

**Rebuild stability.** `articles` is not truncated by the projector rebuild, and its only outbound FK is to
`servers` (`article_images.article_id` FKs *inbound* with `ON DELETE CASCADE`). News prose and images survive
`--rebuild` *provided no row id is ever persisted* — `natural_key` and `facts.subjects` carry gamertags and
ISO timestamps only, enforced by a snapshot test.

**Slug:** cloned from `birthNoticeSlug` but **prefixed with the trigger** (`standing-dead-…`, `long-form-…`),
so a news article about the same life as an obituary cannot collide on `articles_slug_uniq`. Must match
`[a-z0-9-]+` so the existing media route serves its hero image unchanged.

`death_at` is the primary's `ended_at` for Long Form and **NULL** for Standing Dead — legal since `0010`.

---

## 7. Images

News is now the **only** vertical with images, since v0.21.0 retired them from obituaries and birth notices.
This matches the brand bible's §10.4 rationing rule better than the prior arrangement: the photo becomes the
signal that a piece is a feature rather than a routine filing.

**What comes free.** `findImageTargets` already excludes only `obituary` and `birth_notice`, with a comment
noting a future `news` kind becomes image-eligible automatically. The media route is kind-agnostic, and
`ArticleHero` is built and tested but currently used by zero kinds.

**Four code prerequisites** — all required before the first news image generates:

1. **`eligibleCategories` is a binary ternary** (`kind === "obituary" ? MORGUE : NURSERY`), so news would be
   silently handed the **Nursery** menu. Replace with `const menu = MENUS[kind]; if (!menu) throw …` — a
   `Record<ArticleKind, …>` does **not** throw on a miss, so the guard must be explicit.
2. **A second binary ternary** in `image-scene.ts` labels every non-obituary as "birth notice (The Nursery)".
   Since news is the only image-eligible kind, *every* generated prompt would carry the wrong label.
   `IMAGE_SCENE_SYSTEM` likewise needs a news tone arm.
3. **`ArticleKind` is a closed two-member union** and must be widened.
4. **`NEWSROOM_CATEGORIES`** must be authored — the plan owns this, against the same checklist every sibling
   menu satisfies (slug, caption, example, `eligible` predicate), plus **Fog-Rule compliance for a live
   subject**: every Standing Dead scene example must be a generic unidentifiable locale with no legible
   landmark. Morgue has 16 entries, Nursery 13.

**Carried from Phase 0:** the scene prompt passes `facts` wholesale via `JSON.stringify` with no
confidence-awareness, so `verdict.confidence: "low"` arrives as undifferentiated JSON and the caption asserts
a mechanism the body hedges. The fix is a standing hedging rule in `IMAGE_SCENE_SYSTEM` plus an explicit
low-confidence instruction in `buildScenePrompt`. This only matters for news, since no other kind can receive
an image.

**Accent colour:** widen `ArticleHero`'s `accent` prop from `"red" | "blue"` to include `"ink"`, with token
names taken from `../brand`. Morgue is red, Nursery is blue, and yellow already means beef; ink lets the
photograph carry the page. Its only other reference is the skeletons component.

---

## 8. Rich body

**Decision: a nullable `body_blocks jsonb` column plus a shared `ArticleBody` renderer.**

`body` is flat text rendered at exactly two call sites as `body.split(/\n{2,}/).map(p => <p>)`. The spike
used subheads, a pull quote and a fact list; none of that is representable today.

Markdown is the weakest option: the repo has no markdown renderer, markdown permits raw HTML and
`javascript:` URLs by spec, and `z.string()` cannot enforce a subset — you would rebuild the union's
guarantees in a linter.

```ts
type Block =
  | { type: "para";    text: string }
  | { type: "subhead"; text: string }
  | { type: "quote";   text: string; attribution: string }
  | { type: "list";    items: string[] };
```

`<ArticleBody blocks={…} fallback={article.body} />` — a `switch` with `default: return null` so an unknown
future block is dropped rather than crashing. When `blocks` is null it renders the existing flat path, so
there is **zero behaviour change for all 168 existing rows**.

**Precedence is one-way, so the share card can never quote text that is not on the page:** the model emits
`blocks` only; **`body` is derived** post-parse as the `para` blocks joined by `\n\n`, and stored for the OG
card, meta description and any future Discord unfurl. It is never independently authored, so it cannot
diverge. A test asserts derived-body equals the para join.

Zod validates **shape** only — union well-formedness, non-empty strings, a cap on list items and block count.
It does not impose a minimum (§5).

Every block leaf is a React text child, so there is no markup channel. `ldScript()` remains mandatory for
JSON-LD, since LLM-authored headlines can contain `</script>`.

---

## 9. The newsdesk pass, read-model, and web surface

**Pass.** A fifth `newsTick`, hooked into `main.ts` as its own try/catch sibling, following the established
shape: find targets → build facts → prompt → generate → parse → publish, idempotent and failure-isolated.
Gated by `NEWSDESK_DRY_RUN` (shared) plus `NEWSDESK_NEWS_ENABLED` and the forward-only `NEWSDESK_NEWS_SINCE`
(§4.1.3). `NEWSDESK_NEWS_MAX_PER_TICK` defaults to **2**. Prompt version string: **`news-v1`**.

**Read-model** `packages/read-models/src/news-articles.ts` — `getPublishedNews` / `getNewsArticleBySlug`,
mirroring the obituary pair. **Ordering is `created_at DESC`**, not `death_at`: a Standing Dead article has no
death. The new `articles_kind_status_created_idx` serves it.

**API** `GET /news` and `GET /news/:slug`, structural twins of the obituaries routes, with the same Zod page
handling and the same static-route-before-catch-all ordering.

**Web** — a 1:1 mirror of `apps/web/src/app/obituaries/`: feed page, `[slug]` interior, `loading.tsx`,
`opengraph-image.tsx`, plus `components/news/`. Interior order: masthead → `ArticleHero` → lede → status line
(Standing Dead only, §4.1.3) → dossier → `ArticleBody` → pull quote → tags → more-from-the-desk.

**Timeline embed:** one `Timeline` for Standing Dead; **two** for the Long Form — parallel timelines
converging on the same minute is the flagship's visual argument. Both guard on `mapSlug !== null` and degrade
gracefully, as the obituary interior already does.

Retiring the teaser removes `robots: { index: false }` from the news route.

**Note the existing arg-order trap:** `obituaryShowingLine` is `(page, pageSize, total)` while
`birthShowingLine` is `(page, total, pageSize)`. All args are `number`, so a wrong order is type-silent.
Follow the birth signature and test it.

---

## 10. Phase 0 — four defects minting bad prose, plus one carried into the news image pass

`articles.facts` is frozen at publish and forward-only, so **every tick that runs before these land
permanently mints bad articles**. Defects 1, 2, 4 and 5 ship in **PR-A**.

1. **Suicides are tagged `Environment`.** `facts.ts` reads
   `cause === "pvp" || killerGamertag ? "pvp" : cause ? "environment" : "unknown"`. Verified: 11 of 45
   published obituaries have `cause='suicide'`, every one tagged Environment. Add a `suicide` arm ahead of
   the environment fallback. **The new value is not free** — it must be threaded through **six**
   `causeCategory`-gated image predicates plus three non-image consumers: the `prompt.ts` tone branch,
   `causeCategoryTag` (which has no `suicide` arm), and `facts.ts`'s `freshSpawnVictim`.
   Note also that a suicide spans 15s–5381s in this data: a 20-second reroll and a 90-minute life ending the
   same way must not read identically, so the tag alone is insufficient and the prompt needs the duration.

2. **Obituaries lack the priors block birth notices get.** `tick.ts` never calls `getPlayerPriors`, so the
   model sees only a per-map `lifeNumber` and infers "rookie". Verified: **24 of 45 obituaries (53%)** are
   about a player with prior lives, producing published headlines including an 11th life headlined *"Livonia
   Debut"* and a 7-prior player headlined *"Sakhal Rookie"*. Mirror `birth-tick.ts`.

3. **(Carried to §7, news image pass only.)** Captions assert mechanisms the body hedges. No obituary or
   birth notice can receive an image any more, so this is not a live prose defect.

4. **A bare mechanism token invites invention.** `describeDeath` falls back to handing the model the bare word
   `environment`, which it dressed as "Terrain" in a published headline for a death now recorded as
   `infected`. Treat `environment`, `died`, `unknown` and `null` as an explicit unknown and instruct the model
   that *the absence of a cause is the story*. **19 of 84 deaths carry the bare `died` cause and 18 of 45
   obituaries were written from it** — the most-exercised path in the system.

5. **The prompt seeds its own repetition.** Verified: **89 of 123 birth notices (72%) use the byte-identical
   attribution `"a voice on the coast"`**, with its own variants next (4 and 3). Separately, **8 obituaries
   use `"a rival"`**. Both strings appear verbatim as *examples* in `birth-voice.ts` and `voice.ts`
   respectively. The model is being obedient, not unimaginative.
   - **Delete the concrete examples**, describing the register instead. Proven necessary in `birth-voice.ts`;
     prophylactic in `voice.ts`. One line, probably worth more than the rest of this item combined.
   - Add `recentProse(db, kind, limit)` — the `recentCovers` pattern applied to prose, no migration — and a
     shared do-not-reuse block in all three system prompts, hoisted once per tick above the loop.
   - Deterministic backstop: post-parse, null the pull quote if its attribution case-insensitively matches a
     recent one.

---

## 11. Hard rails (asserted as tests, not prose)

- **Fog Rule, asserted on the output rather than the source.** Coordinates live in `positions` *and* in
  `events.payload` (5,633 `player.position` rows) — and the emote fact this format wants is only reachable
  through that same JSON column, so a read-model could pick up coordinates in the same query and still pass a
  source-scoped rail. Therefore: assert that **no field of a built `NewsFacts` and no string in the rendered
  interior matches a coordinate-shaped number**, over a fixture whose source rows *do* contain coordinates.
  Read-models project named columns only, never `SELECT payload` or `SELECT *`.
- **Forbidden real-player framing** (§5) — a token test over generated prose.
- **`EmoteSuicide` never reaches a fact payload** (§4.1.4).
- **Never print wall-clock as survival time.** Always `playtime_seconds`. A fixture where the two diverge must
  produce the playtime figure. The current wall-clock leader has played 1.56 hours across 7.14 days at the
  reference instant; publishing that as endurance would be the paper's first outright lie.
- **No row ids in durable fields** — snapshot test over a built facts object.
- **Punch up, never down.** Enforced primarily by the §4.1.1 predicate and the §4.2 tone branch, not by prose
  rails.

---

## 12. Testing

Repo convention holds: pure functions and presentational components are unit-tested; hooks and thin wiring
are not. DB-touching code uses the Postgres harness.

Highest-value tests, in order:

1. **The partial-index regression** — publish an obituary and a birth notice twice each and assert the upsert
   still works. If a `targetWhere` is missed, obituary publishing dies.
2. **The four Long Form exclusions** — self-cluster rejected (4 of 6 real prod pairs), any-suicide cluster
   rejected, unqualified subject rejected, suppressed gamertag rejected. Plus the **A~B~C non-clique** case,
   window/radius boundaries, the fix-age guard, and deterministic primary selection.
3. **Standing Dead targeting** — the earned-coverage clause, the idle threshold exactly in and out at 72h,
   **the open-session (`disconnected_at IS NULL`) case**, the min-playtime gate, the `NEWS_SINCE` eligibility
   instant, and the anti-join against published and max-attempts rows.
4. **Failure-stub dedupe** — two consecutive failing news ticks for one target yield one row with
   `attempts = 2`.
5. **Retraction** — a subject with a session after `created_at` is de-published.
6. The hard rails in §11.
7. `eligibleCategories` — every kind yields ≥1 category; an unknown kind **throws** (explicit guard).
8. `ArticleBody` — blocks path, fallback path, unknown block dropped; derived-body equals the para join.

---

## 13. Open decisions

1. **Long Form cadence.** Roughly weekly after exclusions, and it may go dark for multiple weeks.
   *Recommendation: accept.* Widening only admits dev-account noise.
2. **Standing Dead go-live.** 7 subjects clear the full gate today. *Recommendation:* eligibility-instant
   gating (§4.1.3) with `MAX_PER_TICK=2`, draining the backlog over ~4 days.
3. **Subject suppression.** `NEWSDESK_NEWS_SUPPRESSED_GAMERTAGS` (comma-separated, default empty) — a subject
   opt-out honoured on request, with the dev account as its first entry. Standing Dead subjects are by
   construction not around to ask, which makes an opt-out mechanism a requirement rather than a courtesy.
4. **Two brand tone-map rows are needed before implementation** (brand repo first, then re-vendor). The bible
   says any new recurring module gets a row when it's born, and these are the two most ethically loaded
   formats in the product: *Standing Dead — elegiac, baffled, warm; never dismissive of a departure.*
   *The Long Form — reverent when the subjects are fresh, prosecutorial only when a subject is geared.*

---

## 14. Rollout

- **No `--rebuild`.** Migration `0014` rewrites an index on a live table; `articles` is durable.
- **Seven new env vars** must reach the host's `onelife-newsdesk` unit — enumerated in the implementation
  plan with defaults, and added to `.env.example`.
- **Sequence:** deploy with `NEWSDESK_NEWS_ENABLED` unset → enable with `NEWSDESK_DRY_RUN=true` for one
  interval → read the log and eyeball the selected subjects by hand → go live.
- **Observability:** per-tick log fields — targets found, published, failed, and skipped-by-exclusion with
  per-reason counts. Without the last one, "why did the Long Form not fire this week" is unanswerable.
- **Workflow:** CHANGELOG.md on every PR; CLAUDE.md updated last, in PR-C.

---

## 15. Follow-ups (explicitly not in this slice)

- Regenerating the 45 published obituaries against fixed facts.
- Generalising the Discord notifier from obituary-only to a kind→path resolver.
- A News block on the home page.
- `article_subjects` normalization, if a third multi-subject trigger lands.
- Re-running the PvP, token and retention analyses after ~30 days of live enforcement. The enforcer had been
  live for 22 hours when this dump was taken; those numbers measure the window, not the players.
