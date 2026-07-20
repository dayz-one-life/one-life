# The Editorial Newsroom — a human-in-the-loop news desk (amends R5d)

**Status:** approved in session; re-grounded to `v0.26.0` after a three-release deploy gap
surfaced mid-design (the first draft was written against the deployed `v0.23.0` checkout, before
discovering R5d PR-C2/PR-C3 had already shipped in `v0.24.0`/`v0.25.0`).
**Amends:** `2026-07-18-r5d-news-vertical-design.md` (operational posture of PR-C2; additive
surface changes to PR-C3).

---

## 1. Summary

The news vertical's writer is not the `newsTick` worker pass. It is a recurring Claude Code
**editorial session** — a few times a week, human + model reading the whole dataset together,
drafting an article, reviewing it rendered on the live site behind a token gate, then
publishing it.

R5d shipped in full (PR-C1 `v0.23.0`, PR-C2 `v0.24.0`, PR-C3 `v0.25.0`), so the desk is a
**delta on a built surface**, one PR: migration `0016` (nullable subject columns), a token-gated
draft preview, an **editorial rendering arm** in the shipped news interior, a validated
`newsroom` CLI as the only write path, a `drafting-an-article` repo skill, and a brand-bible
binding. `newsTick` shipped disabled behind a double gate (`NEWSDESK_NEWS_ENABLED` **and**
`NEWSDESK_NEWS_SINCE`, either unset ⇒ zeros before any DB or model touch) — the pivot is simply
that **those two vars stay unset permanently**; nothing is deleted.

## 2. Why editorial beats automation at this scale

- **Volume.** ~11 deaths/day, 2 token redemptions in the first week, 3 servers. R5d §13.1
  already concedes the Long Form "may go dark for multiple weeks."
- **Story range.** The two strongest pieces drafted while validating this design — a Ledger
  bailout reconstruction (`bans` ⋈ `token_transactions` ⋈ `kills`) and a three-map census with
  a judgment call to exclude one player's artefact from a map median — are undiscoverable by
  fixed triggers. Triggers only find the shapes someone predicted in advance.
- **The rails get cheaper.** R5d's hardest problems (living non-consenting subjects,
  suppression, tone) are hard because nothing reviews before publish. A human gate in front of
  every publish converts hard rails into checklist items — and the automation's consent
  machinery (suppression env, retraction sweep, Fog-Rule test walls) stays active underneath.

## 3. Amendment to the R5d plan of record

- **`newsTick` stays disabled** — `NEWSDESK_NEWS_ENABLED`/`NEWSDESK_NEWS_SINCE` are never set.
  The shipped pass, prompts, and stores are kept warm as the fallback if volume ever outgrows
  the desk.
- **The trigger read-models become scouts.** `newsroom scout` invokes the shipped
  `standing-dead-targets` / `long-form-targets` finders (their Fog-Rule test rails were
  hardened in `v0.25.0`) as story tips, not auto-writers.
- **Suppression carries over unchanged:** the desk ritual reads the same
  `NEWSDESK_NEWS_SUPPRESSED_GAMERTAGS` the shipped exclusions use.
- **Editorial formats are brand verticals.** The Almanac and The Ledger landed in the brand
  bible (tone rows §6, verticals §8, lexicon §9) in brand commit `475b2c4` — before any
  publish, honoring "any new recurring module gets a row when it's born."
- **Precondition:** the deploy backlog (`v0.24.0`–`v0.26.0`) catches up **before** the desk
  release ships (§12 step 0).

## 4. Data model — migration `0016_editorial_articles`

(`0015` is taken by `v0.26.0`'s `0015_notifications.sql`.)

Five statements: `ALTER COLUMN … DROP NOT NULL` on `articles.server_id`, `gamertag`, `map`,
`life_number`, `life_started_at`. Nothing else.

**Why safe:** the partial unique covers only `obituary`/`birth_notice`, whose writers always
supply full tuples; the `server_id` FK tolerates NULL; `articles` is durable → **no
`--rebuild`**.

**The ripple — now three consumers, two strategies:**

- **Obituary + birth-notice read-models:** an `assertSubjectful(row)` guard that **throws
  loudly** — for those kinds a null subject is data corruption, and a crash beats rendering an
  empty gamertag on a public page.
- **The news read-model** (`news-articles.ts`, shipped in `v0.25.0`): `NewsCard`/detail types
  currently hard-assume a primary subject (`gamertag: string`, `map: string`,
  `lifeNumber: number`). These become genuinely nullable — R5d §6 declined nullability "for no
  benefit"; institutional editorial formats are the benefit arriving. Feed cards and the
  interior degrade per §6 below.

**Mandatory regression pair** (R5d §6's blast-radius guard): publish an obituary and a birth
notice twice each; proves `0016` disturbed neither the upsert paths nor the partial unique.

## 5. The article contract

One Zod schema in `apps/newsdesk`, used by the CLI, doubling as the format documentation.

| Field | Rule |
| --- | --- |
| `kind` | pinned `'news'` — formats are editorial flavor, never new kinds |
| `facts.format` | `'ledger' \| 'almanac' \| …` — rendered as the interior kicker (THE ALMANAC); never a column |
| `body_blocks` | canonical prose, required; CLI derives flat `body` (para blocks joined `\n\n`) — the same derivation `newsTick` ships, so OG/meta can never quote text that is not on the page |
| `natural_key` | required; validated against a per-format prefix registry: `ledger:transfer:<uuid>`, `ledger:redeem:<banId>`, `almanac:week:<YYYY-Www>` (the ISO week *covered*); generic `editorial:<key>` escape hatch. **Editorial prefixes are a namespace disjoint from the shipped `standing_dead:`/`long_form:` keys by construction** |
| `facts.factCheck` | **required** — the claim→source table; freezes publish-time truth (live aggregates drift). CLI rejects a payload without it |
| subject columns | optional — set only when the story has one real primary; NULL for institutional pieces. `facts.subjects[]` carries everyone involved (gamertags + ISO timestamps only; never row ids) |
| `slug` | computed by the CLI **at draft time** (the preview URL needs it), format-prefixed (`almanac-…`, `ledger-…`) exactly as `newsTick` prefixes its trigger slugs, `[a-z0-9-]+`; pre-checked against `articles_slug_uniq`; payload may override |
| `tags` | ≤ 2 flavor tags, house style |
| LLM bookkeeping | `prompt_version = 'editorial-v1'`, `generated_at` = draft time, `model` NULL — no OpenRouter call is ever made for an editorial piece |

**New rail — `newsTriggerOf` must learn the third family.** The shipped classifier is binary:
`natural_key` prefix `standing_dead:` else **`long_form`** — its "unreachable in practice"
fallback becomes reachable the day an `almanac:` row publishes, and would render a census as a
Long Form. A widened `newsFormatOf(naturalKey)` distinguishes
`standing_dead | long_form | editorial:<format>` and drives interior-arm selection. The shipped
retraction sweep is prefix-scoped (`starts_with('standing_dead:')`) and never touches editorial
rows.

**Image pass interface.** Unchanged from shipped behavior: a **published** news row is
image-eligible the instant it publishes (`v0.24.0` notes this explicitly), so the desk's first
publish is the first live image generation since `v0.21.0` — a planned event (§12). `facts`
carries whatever gate inputs the story honestly has; institutional pieces fall through to the
four ungated NEWSROOM categories. Hand-authored scenes are a follow-up (§13).

## 6. Render-surface delta (PR-C3 shipped the rest)

**Already shipped in `v0.25.0`, not re-built:** `/news` feed + interior + `loading.tsx`, public
`GET /news` / `GET /news/:slug`, `getPublishedNews` / `getNewsArticleBySlug` /
`getNewsSubjectStatus`, dynamic OG + `NewsArticle` JSON-LD (via `ldScript()`), the **`ink`**
`ArticleHero` accent, live `ArticleBody` blocks rendering, the Standing Dead status line, Long
Form dual timelines, retraction rendering (banner, `RETRACTED` OG overprint, feed exclusion),
and teaser retirement.

**To build:**

1. **Preview gate.** `getNewsArticleBySlug` gains `{ includeDraft }`; `GET /news/:slug` accepts
   `?preview=<token>`, compared against `NEWS_PREVIEW_TOKEN` via `crypto.timingSafeEqual`.
   **Unset/empty env ⇒ preview disabled** (fail closed; the `MAGIC_LINK_ENABLED` precedent).
   Drafts stay invisible to the feed by the existing `status='published'` predicate; the
   by-slug fetch already admits `retracted` for the banner path, and `draft` composes alongside
   it without touching that behavior.
2. **Draft rendering:** a visible **DRAFT banner** (a screenshot must never pass for live),
   `noindex`, no caching.
3. **The editorial interior arm**, selected by `newsFormatOf`: kicker from `facts.format`, no
   dossier, no status line, no timelines — headline → lede → `ArticleBody` → pull quote →
   tags → more-from-the-desk. Feed cards degrade for null subject columns (no gamertag/map
   chips; headline, lede, tags, and thumb carry the card).
4. **`unpublish` ≠ retraction.** `status='draft'` (pre-release recall: page 404s, invisible
   everywhere) is distinct from the shipped `status='retracted'` (post-publish correction:
   public banner, overprinted OG, working URL). The CLI never writes `retracted`; the
   retraction sweep never touches editorial rows.

## 7. The `newsroom` CLI

`apps/newsdesk/src/newsroom/`, run as `pnpm --filter @onelife/newsdesk run newsroom -- <cmd>`.
**The only write path to editorial rows** — sessions never hand-INSERT. No LLM calls anywhere.

| Command | Does | Refuses |
| --- | --- | --- |
| `draft <file.json>` | validate → slug + flat body → INSERT `status='draft'` → print preview URL | contract violations, `natural_key`/slug collisions — named, single-line errors |
| `publish <slug>` | draft→published, `created_at = now()` (feed orders by publish time), print live URL | missing slug; already-published is a friendly no-op |
| `unpublish <slug>` | published→draft — the mistake hatch; a generated hero survives for republish | ever writing `retracted` |
| `spike <slug>` | delete a **draft** | ever touching a published row |
| `list [--drafts]` | slug · status · format · created_at | |
| `scout` | run the shipped Standing Dead + Long Form finders + the aggregate digest; suppressed gamertags excluded | |

Discord stays out of scope; `publish` printing the live URL makes the manual paste a one-liner.

## 8. Brand-voice binding

**The bible governs, read live.** The ritual's voice step reads `brand-bible.md` **§6** (six
constants + tone map) and **§9** (vocabulary, both ban tiers) before composing, from
`/var/www/brand` (provisioned 2026-07-20, acab-owned), falling back to a scratchpad
shallow-clone if absent. `apps/newsdesk/src/news-voice.ts` (which vendors the three *trigger*
tone rows for the disabled `newsTick`) is precedent, not the desk's source — the desk has a
human in the loop and reads the bible directly, so there is nothing to drift.

**Format rows are landed:** The Almanac and The Ledger tone rows, §8 vertical entries, and §9
lexicon mentions are in the bible as of brand commit `475b2c4`.

**Mechanical lint, vendored.** The CLI contract vendors §9 **Tier 1 verbatim** (sincere-grief
clichés, wink/meta, corporate/data-speak — including "our data shows," the Almanac's standing
temptation — meme slang, emoji, ALL-CAPS in prose, exclamation points) under the `IMAGE_STYLE`
rule: brand repo first, then re-vendor. **Tier 2 stays human** — punch-down detection and
Fog-Rule fogging are judgment; a lint that claims to check ethics manufactures false
confidence. The skill quotes the bible's Fog Rule phrasing (past tense fair, present tense
fogged).

## 9. The session ritual (`drafting-an-article` repo skill)

Sessions run on the production host against the live database — exploration is read-only;
writes go through the CLI only.

1. **`newsroom scout`** — shipped trigger finders + aggregate digest.
2. **Explore freely** — the skill appends the founding session's query cookbook (ledger⋈bans
   reconstruction, idle-alive, per-map medians, retention, hour-of-day), with two standing
   rails: *check whether one player is moving your aggregate* (the Livonia 1.0-minute-median
   lesson) and *state n when it is small*.
3. **Consent pass** — suppression list; living subjects get the Standing Dead rails (no
   implied death, fix, route, or locale); banned subjects get the Ledger rule: *aim at the
   paperwork, never the player serving the sentence*.
4. **Voice** — bible §6 + §9 live (§8 above); `recentProse` — recent attributions and headline
   constructions are burned.
5. **Compose the payload** — every claim in the prose has a row in `facts.factCheck`.
6. **`newsroom draft`** → review the real page at the preview URL.
7. **`newsroom publish`** after human approval; optionally paste the URL into Discord.
8. **No manufactured cadence** — the desk prints when there is news.

## 10. Error handling

- `natural_key` collision → named error ("story already covered"); `list` shows where.
- `NEWS_PREVIEW_TOKEN` unset → preview fails closed; `draft` works but warns the preview URL
  will 404.
- `imageTick` failure → existing retry counters and the `NEWSDESK_IMAGES_ENABLED` kill switch;
  a text-only article renders the established DOM.
- Post-publish data drift → `factCheck` froze publish-time truth; corrections are a new
  paragraph, a new piece, or (for a real error of fact) the shipped **retraction** path —
  never a silent edit.
- A null subject reaching the obituary/birth read-models → `assertSubjectful` crashes loudly.
- Editorial rows and the retraction sweep are mutually inert by prefix scoping (§5).

## 11. Testing

- **The regression pair** (§4) — obituary + birth notice published twice each.
- **`newsFormatOf` matrix** — all shipped and editorial prefixes, plus the null/garbage
  fallback; asserts an `almanac:` key can never classify `long_form`.
- **Read-models** — feed ordering/paging; `includeDraft` matrix; draft-invisible-to-feed;
  `assertSubjectful` throw; null-subject card mapping.
- **CLI contract** — validation matrix (missing `factCheck` rejected; prefix registry; slug
  shape; body flattening; Tier-1 lint hits); state transitions; `spike`/`unpublish` refusal
  rules.
- **API** — preview-token matrix including unset-env ⇒ fail closed.
- **Web** — editorial arm renders (kicker, no dossier); DRAFT banner presence; feed card
  degradation. (No OG/route tests exist repo-wide — `v0.25.0` documents why; the preview gate
  is tested at the API layer.)
- One literal `natural_key` string asserted per format (house precedent).
- DB suites need `TEST_DATABASE_URL`.

## 12. Rollout

**Step 0 — catch up the deploy backlog (before the desk PR ships).** Prod runs `v0.23.0`
(deployed 2026-07-19 18:16 UTC); `v0.24.0`–`v0.26.0` are tagged, undeployed, all **normal
deploys, no `--rebuild`, no backfills**. One host prerequisite: **author
`/etc/systemd/system/onelife-notifier.service`** (clone of the granter/newsdesk units;
`ExecStart=… --filter @onelife/notifier start`) *before* deploying — `v0.26.0`'s `deploy.sh`
restarts a ten-unit fleet including it, and the v0.8.0 rebooter precedent shows a missing unit
does **not** fail the deploy; the worker just sits silently inactive behind a green result.
The notifier itself ships safe-off (`NOTIFIER_SINCE` unset ⇒ generation off;
`NOTIFIER_DRY_RUN` defaults true; push warns loudly, not fatally, without VAPID keys) — keys
and enablement are a separate, optional follow-up. Post-deploy, verify the API by curling
`/api/auth/providers` directly (the health-check's `api=000000` quirk).

**Then the desk PR:** feature branch from `develop` (post-`v0.26.0`) per `starting-work`; one
new env `NEWS_PREVIEW_TOKEN` on the API unit (+ `.env.example`); migration `0016` rides the
normal deploy, **no `--rebuild`**; CHANGELOG on the PR; CLAUDE.md updated last; the R5d spec
gains an amendment note pointing here.

**First desk run doubles as the smoke test:** draft the Almanac (numbers re-run at draft time —
the founding sample's figures are already stale, which is exactly what `factCheck` exists to
pin), preview on a phone, publish, then watch the next newsdesk tick generate the hero — the
first live image since `v0.21.0`, as a planned event.

## 13. Follow-ups (explicitly not in this slice)

- Discord notifier generalization (kind→path resolver) so news publishes announce like
  obituaries.
- Hand-authored image scenes for editorial pieces (bypassing the scene-writer).
- Institutional-format image categories in the NEWSROOM menu (brand repo §10.4 first).
- Rendering `facts.factCheck` publicly as a "The Record" box.
- `article_subjects` normalization (carried over from R5d §15).
- Notifier enablement (`NOTIFIER_SINCE`, VAPID keys, `NOTIFIER_PUSH_ENABLED`) — unrelated to
  the desk; safe-off until wanted.
- Re-enabling `newsTick`, if volume ever outgrows the desk — the pass is shipped, disabled,
  and kept warm; editorial and trigger articles coexist by natural-key namespace.
