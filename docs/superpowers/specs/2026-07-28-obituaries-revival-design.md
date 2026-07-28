# Obituaries revival (design)

**Date:** 2026-07-28
**Reverses (partially):** `2026-07-24-content-engine-removal-design.md`
**Restores from:** the parent of `aaeabd0` ("retire the content engine (Release 1)", PR #260)

## Goal

Bring back LLM-written obituaries — and only obituaries. One qualified death → one obituary in the
One Life tabloid voice, published to a public `/obituaries` feed and per-article page, linked from
the life timeline. Nothing else from the retired content engine returns: no birth notices, no news
vertical, no editorial newsroom, no Discord webhook, no image pipeline, no notification kind.

Two deliberate changes from the R5a-era system:

1. **No images.** `article_images` stays dead; the article page has no hero and no bespoke OG route.
2. **The No-Place Rule.** The old Fog Rule allowed "general circumstance" and locale flavor tags,
   which is the door invented barns and apartment blocks walked through — scenery the record does
   not contain. Prose may now name **the map and nothing finer**. Enforced in the prompt AND by a
   deterministic post-generation validator.

## Why a restore, not a fresh build

PR #260 deleted the engine in one commit, so the obituary slice is recoverable file-by-file from
`aaeabd0^`: battle-tested code, an already-tuned voice, and its tests. Approach chosen over a
fresh lean build (rewrites a working pipeline for the same output) — see the brainstorm.

The old prose is **not** restored. The 168+ pre-removal articles exist only in the pre-`0027`
backup and stay there; history restarts at the `NEWSDESK_SINCE` cutoff.

## Architecture

```
qualified death (lives.ended_at set, isLifeQualified)
      │  apps/newsdesk sweep — interval loop, batch-capped,
      │  NEWSDESK_DRY_RUN (default true) + NEWSDESK_SINCE (unset = off)
      ▼
facts bundle (life stats, kills, verdict via describeDeath, ordeals, priors)
      → OpenRouter (Claude slug via NEWSDESK_MODEL, strict JSON, no SDK)
      → validators (incl. the new no-place lint) → publish
      ▼
articles row (kind='obituary'), matched to the life by the rebuild-stable
tuple (server_id, gamertag, life_started_at) — NEVER life_number
      ▼
getPublishedObituaries / getObituaryBySlug (packages/read-models)
      ▼
GET /obituaries, GET /obituaries/:slug (apps/api)
      ▼
/obituaries feed + /obituaries/[slug] pages, life-timeline hero link,
sitemap entries
```

## Prompt & validation (the deliberate changes)

**System prompt (`voice.ts`), prompt version → `obituary-v3`:**

- The Fog Rule is replaced by the **No-Place Rule**: prose (headline, lede, body, pull quote,
  tags) may contain no spatial or setting references — no buildings or structures, no town or
  landmark names, no terrain ("the coast", "deep woods", "a ridge"), no compass directions, no
  "somewhere north of". **The map name is the one exception** — it is confirmed data, stays in the
  facts block as the dateline line, and the model may use it in prose.
- Locale flavor tags (the old "Elektro" example) are removed from the tag instructions.
- Everything else in the voice — the six constants, tone ladder, hard bans, duty-of-care framing
  for suicides and outmatched fresh spawns, anti-repetition recent-prose block — is restored
  verbatim.

**Deterministic no-place validator** (new, in `@onelife/newsdesk` beside the existing draft
validators): rejects any draft whose prose fields match, word-boundary and case-insensitive:

- (a) any real place name from the vendored `apps/web/src/lib/map-places.json` (321 places across
  all three maps — a ready-made banned list), or
- (b) a curated structure/terrain wordlist (barn, shed, church, castle, apartment, coast, forest,
  hill, ridge, road, …).

Exemptions: the deceased's and killer's gamertags (a callsign like "BarnOwl" must not
false-positive) and the three map labels (Chernarus, Sakhal, Livonia) plus their codenames.
A rejected draft gets **one retry** with the violated words named in the feedback; a second
failure skips that death this tick (picked up by a later sweep) and logs the skip. The prompt
alone is not trusted — the validator is the enforcement.

Note on the wordlist's data source: `map-places.json` lives in `apps/web`. The newsdesk must not
import across app boundaries; the plan decides between vendoring a copy and lifting the JSON into
a shared package — either is acceptable, drift is bounded (the file only changes on a DayZ
terrain update).

## Worker, config & data model

**`apps/newsdesk`** returns as the obituary sweep alone:
`main.ts` loop → `tick.ts` (select up to `batchCap` qualified deaths with `ended_at >=
NEWSDESK_SINCE` and no existing article for the tuple) → `facts.ts` → `prompt.ts` / `voice.ts` →
`openrouter.ts` → validators → `pg-store.ts` upsert.

**Not restored** (deleted in place in the restore commit, never revived): every `birth-*`,
`news-*`, `image-*` file, `newsroom/`, `discord.ts`, `notify.ts`, `long-form-*`,
`standing-dead-targets.ts`, and the `.claude/skills/drafting-an-article` editorial skill.

**Env (restored to `.env.example`):**

- `OPENROUTER_API_KEY` — the only LLM key; plain-`fetch` client, no SDK.
- `NEWSDESK_MODEL` — Claude model slug via OpenRouter; default pinned in the plan.
- `NEWSDESK_DRY_RUN` — defaults `true`; parsed on the safe-side `!== "false"` convention
  (unparseable input lands on dry-run). No spend and no rows until deliberately enabled.
- `NEWSDESK_SINCE` — **new**, forward-only cutoff on the death's `ended_at`; **unset means
  generation is OFF**, never a silent epoch default (the `NOTIFIER_SINCE` pattern). This is what
  prevents the first live sweep from generating an obituary for every qualified death in history
  at real API cost.
- Interval / batch-cap vars as before.

**Migration `0030`** recreates `articles` in its pre-`0027` shape, minus any column that existed
only to serve images. `kind` stays a plain text column; only `'obituary'` is written.
`article_images` is **not** recreated.

- `articles` is **durable**: added to `APP_TABLES` (`packages/test-support/src/global-setup.ts`),
  never to `REBUILD_TRUNCATE_TABLES`. The rebuild-before-migrate hazard does not apply (durable,
  not projection).
- Deploys with a plain `./deploy/deploy.sh`, **no `--rebuild`**.
- `deploy/deploy.sh` re-adds `newsdesk` to `SERVICES`; `deploy/README.md` regains the
  `onelife-newsdesk` unit section — the operator re-creates the unit file by hand (mirror of the
  removal runbook step).

## Read-models, API & web

**`packages/read-models`:**

- `obituary-articles.ts` restored: `getPublishedObituaries` (paginated feed, newest first) +
  `getObituaryBySlug`.
- `life-timeline.ts` regains `obituarySlug: string | null` — the published-obituary sub-select on
  `(server_id, gamertag, life_started_at)` — **and its regression test**, restoring the executable
  proof of the tuple-match convention that `CLAUDE.md` records as lost with the removal.
- `sitemap.ts` regains an articles query. **Every fetch keeps its own try/catch** — the
  independent-degradation invariant extends to the third fetch, pinned by a test proven red
  against a shared catch.

**`apps/api`:** `routes/obituaries.ts` restored — public `GET /obituaries` (paginated) +
`GET /obituaries/:slug`. No media route, no `GET /players/:slug/articles`, no
`NEWS_PREVIEW_TOKEN` (obituaries publish directly; there is no editorial preview step).

**`apps/web`:**

- `/obituaries` feed + `/obituaries/[slug]` article pages, restored minus every image element
  (no `ArticleHero`, no OG-image route — the default OG treatment applies). `ArticleBody`,
  `PullQuote`, obituary components and skeletons return; `linkify-gamertags` returns so callsigns
  in prose link to dossiers via `GamertagLink`.
- The life-timeline hero regains its "Read the obituary →" link when `obituarySlug` is non-null.
- The sitemap regains obituary URLs with real `lastmod` (`published_at`).
- **Deliberately not restored:** nav item, tab-bar slot, front-page block, dossier "In the
  Paper", `obituary_published` notifications. Discovery is the timeline link, the sitemap, and
  the URL. A nav decision can come later; nothing in this pass forecloses it.

## Error handling

- OpenRouter failure / malformed JSON / validator double-failure → skip the death this tick, log,
  retry on a later sweep. The tick never crashes the loop on a single bad draft.
- Dry-run: full generation path minus the publish write, logging what would publish (the
  established dry-run-gate convention).
- Feed/article web pages follow the existing settle-feed honesty rules: failed fetch renders as a
  failure, never as an empty feed.

## Testing

- Restored suites come back with their files: facts, prompt, tick selection, dry-run gate,
  read-models, routes, web components.
- New: no-place validator (place-name hit, structure/terrain hit, gamertag exemption, map-label
  exemption, retry-then-skip), `NEWSDESK_SINCE` cutoff (unset = no candidates; deaths before the
  cutoff excluded), the restored tuple-match regression test, sitemap third-fetch independence
  (proven red).

## Out of scope

Birth notices, news, the editorial newsroom, Discord, images, notifications, nav/front-page/
dossier surfaces, restoring the pre-removal article rows, and any change to death-cause
classification or the life timeline beyond the `obituarySlug` field.
