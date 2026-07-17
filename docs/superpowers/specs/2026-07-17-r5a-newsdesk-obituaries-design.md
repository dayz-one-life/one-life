# R5a — Newsdesk foundation + Obituaries (design)

**Status:** approved design, ready for implementation planning.
**Roadmap:** first slice of R5+ (content engine) in the tabloid redesign
(`docs/superpowers/specs/2026-07-16-tabloid-redesign-design.md`). Consumes the R4 read-model
groundwork (`getObituaries`, `getLifeTimeline`, `qualifiedLifeCondition`).

## Goal

Stand up the content engine end-to-end on its flagship format: a background worker turns each
qualified death into an **obituary** — written in the One Life tabloid voice via an LLM — and the
public **Obituaries** section renders those obituaries as a reverse-chron feed plus a full interior
article per death. This proves the whole **event → LLM → stored article → rendered page** loop and
retires the static Obituaries teaser.

## Scope

**In:**
- A new `articles` persistence table (+ migration).
- A generation library `@onelife/newsdesk` (OpenRouter client, voice system prompt, pure prompt
  builder, output schema/parser).
- A sweep worker `apps/newsdesk` that generates obituaries for ungenerated qualified deaths, behind
  a dry-run gate.
- Read-models `getPublishedObituaries` (feed) and `getObituaryBySlug` (single).
- Public API routes `GET /obituaries` (feed) and `GET /obituaries/:slug` (single).
- Web: the Obituaries index feed (`/obituaries`, canvas 12a) and the interior obituary article
  (`/obituaries/[slug]`), retiring the teaser + its `noindex`.

**Out (deferred):**
- **Images** — R5c. The `articles` table reserves nullable image columns now so images land with no
  migration, but R5a is text-only.
- **Other verticals** — Birth Notices / Fresh Spawns (R5b), Breaking, The Beef, Power Rankings, The
  Disgraces, Sightings, Survival Odds, Editorials (R5e).
- **News feed + news-led home** (11a/10a) — R5d.
- **Fabricated death-beat narrative** — the "Final Reload" uses only R4's real events; no invented
  minute-by-minute beats.
- **Regeneration UI** — articles are generate-once; `prompt_version` is stored so a future slice can
  add optional regeneration, but R5a never regenerates.

## Architecture

Data flow:

```
qualified death (lives, endedAt set)          ── R4 qualifiedLifeCondition
        │  apps/newsdesk sweep (dry-run gated)
        ▼
gather facts (getObituaries row + getLifeTimeline)
        │  @onelife/newsdesk: buildObituaryPrompt → OpenRouter → parse
        ▼
insert articles row  (kind='obituary', unique (kind, life_id))
        │  packages/read-models: getPublishedObituaries / getObituaryBySlug
        ▼
apps/api  GET /obituaries , GET /obituaries/:slug
        │
        ▼
apps/web  /obituaries (feed 12a) , /obituaries/[slug] (interior article)
```

New units:
- **`packages/db`** — `articles` table + migration `0009`.
- **`packages/newsdesk`** (new library) — voice + prompt + OpenRouter client + parser.
- **`apps/newsdesk`** (new worker) — the sweep loop (mirrors `apps/granter` shape: `config.ts` /
  `tick.ts` / `main.ts`).
- **`packages/read-models`** — `obituaries-published.ts` (read stored articles).
- **`apps/api`** — obituary routes (repurpose the R4 `GET /obituaries` groundwork route).
- **`apps/web`** — index + interior pages and their components.

## Data model — `articles`

One row per generated article. R5a only writes `kind='obituary'`; the table is vertical-generic so
later slices reuse it.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | serial PK | |
| `kind` | text | `'obituary'` for R5a. |
| `slug` | text, unique | Permalink slug — `slugify(headline)` + a short disambiguator (e.g. `-a3f2`) to guarantee uniqueness. |
| `player_id` | int → players.id | Subject. |
| `gamertag` | text | Denormalized subject callsign (immutable snapshot). |
| `server_id` | int → servers.id | |
| `life_id` | int → lives.id | The death this obituary covers. |
| `life_number` | int | Denormalized. |
| `headline` | text | LLM — the Oswald screamer. |
| `lede` | text | LLM — opening paragraph. |
| `body` | text | LLM — 1–3 paragraphs. |
| `pull_quote_text` | text, null | LLM — in-voice pull quote. |
| `pull_quote_attribution` | text, null | LLM — **anonymous/in-voice only** (never a real gamertag's fabricated words). |
| `tags` | text[] | Bounded set: `Obituaries` + map label + cause category + ≤1 flavor tag. |
| `facts` | jsonb | Immutable snapshot of the death facts the prose was written from (see below). |
| `prompt_version` | text | e.g. `obituary-v1`. Enables future optional regeneration. |
| `model` | text | The OpenRouter model slug used. |
| `attempts` | int, default 0 | Generation attempts; bounds retries on a poison death. |
| `image_url` | text, null | **Reserved for R5c.** Unused in R5a. |
| `image_prompt` | text, null | **Reserved for R5c.** |
| `image_kind` | text, null | **Reserved for R5c** (`hero`/`card`/`breaking`). |
| `generated_at` | timestamptz | |

- **Idempotency:** a partial unique index on `(kind, life_id)` — a life dies once, so at most one
  obituary per death. The worker inserts; a duplicate is a no-op.
- **Immutable & self-contained:** storing `facts` + the rendered prose means an article never changes
  even if projections are later rebuilt — the permanent-archive promise from the brand bible.
- The `articles` table is **durable** (like `bans`): a projection rebuild (`deploy.sh --rebuild`)
  must not truncate it.

`facts` JSON snapshot (what the prompt is built from and the Rap Sheet renders from):

```
{
  gamertag, map,            // "chernarusplus" codename; label via mapLabel at render
  mapSlug,                  // servers.slug (nullable) — builds the R4 life href / Final Reload fetch
  lifeNumber,
  daysSurvived,             // derived from timeAliveSeconds
  timeAliveSeconds,
  kills, longestKillMeters,
  sessions,
  cause,                    // lives.deathCause
  causeCategory,            // 'pvp' | 'environment' | 'unknown' (for tags + tone)
  killerGamertag,           // when pvp, else null
  weapon,                   // when pvp, else null
  isLegend,                 // derived flag → reverent tone (see Voice)
  endedAt
}
```

## Generation library — `@onelife/newsdesk`

Pure, testable prompt building split from the thin network client.

- **`buildObituaryPrompt(facts): { system, user }`** (pure) —
  - **`system`** encodes the brand voice (distilled verbatim from `../brand/brand-bible.md` §6/§8/§9):
    the six voice constants (deadpan; literate & precise; sensational in *judgment*; in-character;
    principled savagery — punch **up** at big killers, never **down** at victims; specific over
    generic), the obituary tone dial (**dry mock-gravity** standard; **reverent with one needle** for
    a legend), and the **hard bans** (no "RIP/gone too soon/rest in peace" sincerity clichés; no
    wink/meta; no corporate/data-speak; no slurs or real-person attacks; the **Fog Rule** — map is
    the dateline, never a coordinate/pin). One worked example from the bible is included as a
    style anchor.
  - **`user`** = the death `facts` as clean structured data.
- **Output contract** — the model returns strict JSON
  `{ headline, lede, body, pullQuote: { text, attribution } | null, tags: string[] }`. A
  Zod schema validates it; malformed/empty output → a failed attempt (no partial write).
  Pull-quote attributions are constrained by the prompt to anonymous/in-voice forms
  ("A rival…", "Sources on the coast…", "The Desk"). Tags are constrained to
  `Obituaries` + the map label + the cause category + at most one LLM flavor tag.
- **`generateObituary(client, facts): Promise<Obituary>`** — builds the prompt, calls the OpenRouter
  client, parses/validates. The client is an injected interface (`{ complete(req): Promise<string> }`)
  so tests never hit the network.
- **OpenRouter client** — a thin `fetch` wrapper over the OpenRouter chat-completions API using
  `OPENROUTER_API_KEY` and `NEWSDESK_MODEL`, requesting JSON output. No SDK dependency.

**Determinism/versioning:** moderate temperature (voice needs life, bounded for consistency); every
article records `prompt_version` + `model`.

## Sweep worker — `apps/newsdesk`

Mirrors `apps/granter` (`config.ts` / `tick.ts` / `main.ts`, pino, poll loop).

- **`newsdeskTick(db, deps)`** —
  1. Select up to `batchCap` qualified deaths (`qualifiedLifeCondition`, `endedAt` set) that have
     **no** `(obituary, life_id)` article **and** `attempts < maxAttempts` (join/anti-join on
     `articles`; attempts tracked on a lightweight row or a companion — see note).
  2. For each: gather facts (`getObituaries` row for core fields + `getLifeTimeline` for kills /
     sessions / character), derive `daysSurvived`, `causeCategory`, `isLegend`.
  3. **Dry-run gate** (`NEWSDESK_DRY_RUN`, default `true` like `enforcer`/`granter`): when dry, log
     the candidate + the built prompt and **do not** call OpenRouter or write. When live, call
     `generateObituary`, then insert the `articles` row (idempotent on `(kind, life_id)`).
  4. On failure (LLM error, parse failure), increment `attempts` and leave no article — retried next
     sweep until `maxAttempts`, then parked (logged, skipped) so a content-filter refusal can't burn
     tokens forever.
- **Attempts tracking note:** since a failed generation writes no `articles` row, `attempts` needs a
  home even on failure. R5a uses a minimal companion table `article_attempts(kind, life_id, attempts,
  last_error, updated_at)` (or an equivalent nullable pre-insert row) — the implementation plan picks
  the least-intrusive option; the requirement is: failures are counted and bounded.
- **Config (`NEWSDESK_*` env):** `DATABASE_URL`, `OPENROUTER_API_KEY`, `NEWSDESK_MODEL` (default a
  strong Claude model via OpenRouter, pinned in the plan), `NEWSDESK_DRY_RUN` (default `true`),
  `NEWSDESK_INTERVAL_SECONDS` (default 300), `NEWSDESK_BATCH_CAP` (e.g. 10), `NEWSDESK_MAX_ATTEMPTS`
  (e.g. 3), `LOG_LEVEL`.
- **Deploy:** a `onelife-newsdesk` systemd unit alongside the other workers; documented in
  `deploy/README.md`. Ships **dry-run on** — no spend until deliberately enabled.

## Read-models

- **`getPublishedObituaries(db, { page, pageSize }): { rows, total, page, pageSize }`** — reads
  `articles WHERE kind='obituary'`, newest death first (`generated_at` desc, or the `facts.endedAt` —
  plan pins one), paginated (`OBITUARIES_PAGE_SIZE = 20`). Each row carries the card fields:
  `slug`, `gamertag`, `map`, `lifeNumber`, `headline`, `lede` (for the dek), `tags`, plus the Rap
  Sheet facts.
- **`getObituaryBySlug(db, slug): ObituaryArticle | null`** — the full article for the interior page:
  all voice fields + the `facts` snapshot. The interior page separately calls the existing
  `getLifeTimeline` (via the life route or a direct read-model call) to render the **Final Reload**
  from real events, and `getPublishedObituaries` (small slice, excluding self) for **More From the
  Morgue**.

## API routes (public)

- **`GET /obituaries`** — repurpose the R4 groundwork route to return `getPublishedObituaries`
  (Zod `?page` default 1, `.catch(1)`), replacing the raw-deaths payload.
- **`GET /obituaries/:slug`** — `getObituaryBySlug`; `404` on miss. Returns the article + the facts;
  the web interior page composes the Final Reload from the life route it already can call.

## Web

**Obituaries index — `/obituaries` (canvas 12a):**
- Replaces `TeaserPage`; drops `robots: noindex`.
- Reverse-chron feed of **obituary cards**: the Oswald headline (links to the interior page), a dek
  (the lede, clamped), a dateline (`{Map} Bureau · {relative time}`), the subject via `GamertagLink`,
  and a compact factual Rap Sheet strip (days · kills · cause).
- Paginated (`?page=`, `PlayerPagination`-style mono box); `loading.tsx` skeleton; in-voice empty
  state ("The morgue desk is quiet. Give it time.") for the pre-generation window.
- `Obituaries` metadata + a section OG.

**Interior article — `/obituaries/[slug]`** (the `obituary.html` mockup):
- Red-framed hero + Oswald **headline**; byline/dateline "Filed by The Desk · {Map} Bureau ·
  {date}".
- **Lede + body** prose; **pull quote** (when present) in the mockup's callout treatment.
- **Rap Sheet** factual stat box — days survived / kills / longest kill / sessions / cause — from the
  article `facts` (deterministic, never LLM).
- **The Final Reload** — R4's real-event timeline for this life, fetched via the existing life route
  `GET /players/:gamertag/:map/lives/:n` (using `facts.gamertag` / `facts.mapSlug` / `facts.lifeNumber`)
  → `buildTimeline`, showing the actual last session, last kills, and the death row with vitals. A
  "positions withheld" notice does **not** apply (the life is dead — past-tense location is allowed,
  but we hold no coords, so it's map-only regardless). If `facts.mapSlug` is null (an un-slugged
  server), the life route can't be built — the Final Reload section is **omitted gracefully** and the
  rest of the article still renders.
- **Tags** row; **More From the Morgue** rail (recent other obituaries, excluding self).
- A `TIMELINE →` link to the R4 life page as the factual "home."
- `Article`/`NewsArticle` JSON-LD + a dynamic OG image (headline + Rap Sheet, brand palette — same
  approach as the player dossier OG; text-only, no generated hero image in R5a).
- `notFound()` on an unknown slug; `generateMetadata` with a `.catch`.

**Slug:** stored on the article at generation (`slugify(headline)` + disambiguator), resolved by
`getObituaryBySlug`. Gamertags everywhere route through the shared `GamertagLink`.

**Nav:** the masthead already links **Obituaries**; `activeNavKey` lights it for `/obituaries*`.

## Voice & content rules (binding)

Distilled from `../brand/brand-bible.md` — these are hard requirements the reviewer checks:
- **Voice-first:** the page renders **only written obituaries**. No dry placeholder rows, no
  templated fallback, ever. A death without an article simply isn't listed yet.
- **Receipts are real:** the Rap Sheet and the Final Reload are **facts only** (R4 read-models). The
  LLM writes voice, never invents events, stats, kills, or locations.
- **Fog Rule:** map/dateline only; **no coordinates** anywhere (consistent with R4's no-coords
  decision). Deaths are past-tense so the cause/killer/weapon (already public on the timeline) are
  fair game.
- **Ethics bans (hard):** no slurs; no real-person attacks; punch **up** at big killers, never
  **down** at fresh spawns/victims; pull-quote attributions stay anonymous/in-voice.
- **No sincerity clichés / no wink / no corporate-speak** (per the bible's Tier-1 bans).

## Config / env & deploy

- New env: `OPENROUTER_API_KEY`, `NEWSDESK_MODEL`, `NEWSDESK_DRY_RUN` (default `true`),
  `NEWSDESK_INTERVAL_SECONDS`, `NEWSDESK_BATCH_CAP`, `NEWSDESK_MAX_ATTEMPTS` — documented in
  CLAUDE.md's env notes.
- `onelife-newsdesk` systemd unit added to the deploy docs; the fleet gains one worker.
- Migration `0009` (articles table) runs in the normal migrate step; the table is **durable** (never
  truncated on `--rebuild`).

## Testing

- **`@onelife/newsdesk`:** unit tests for `buildObituaryPrompt` (voice constraints + bans present,
  facts injected, legend vs standard tone selection) and the output parser (valid JSON accepted;
  malformed/empty/over-long rejected; attribution/tag constraints). OpenRouter client tested with a
  stubbed `fetch`.
- **`apps/newsdesk`:** `newsdeskTick` against the Postgres harness with a stubbed generation client —
  selects only ungenerated qualified deaths, respects the dry-run gate (no write/no client call when
  dry), is idempotent on `(kind, life_id)`, and bounds retries at `maxAttempts`.
- **`packages/read-models`:** `getPublishedObituaries` (ordering, pagination, kind filter) and
  `getObituaryBySlug` (hit/miss) on the harness.
- **`apps/api`:** route tests for `GET /obituaries` and `GET /obituaries/:slug` (shape, 404).
- **`apps/web`:** the index feed card, the interior article sections (Rap Sheet from facts, pull
  quote present/absent, tags), and the empty state — presentational component tests; containers thin.
- **No live LLM in any test** — the client is always injected/stubbed.

## Open items folded into the plan (low-ambiguity defaults)

- Exact `NEWSDESK_MODEL` default slug — pinned in the plan (a strong Claude model via OpenRouter),
  env-overridable.
- Feed ordering key (`generated_at` vs `facts.endedAt`) — plan pins `endedAt` desc so the feed reads
  as "most recent deaths."
- Attempts-tracking mechanism (companion table vs pre-insert row) — plan picks the least intrusive.
