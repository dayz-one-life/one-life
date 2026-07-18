# Death-Cause Fidelity — Design

**Date:** 2026-07-18
**Status:** Approved (brainstormed with maintainer)
**Prior art:** the archived `../one-life-platform` death-cause fidelity initiative (its PR #30, v0.15.0):
`docs/superpowers/specs/2026-07-13-death-cause-fidelity-design.md`,
`docs/superpowers/notes/2026-07-13-death-cause-fidelity-findings.md`, and
`packages/newsroom/src/death-cause.ts` in that repo.

## 1. Problem

A death today reaches prose and UI as a coarse token. The newsdesk collapses every cause to a
3-way `causeCategory` (`pvp | environment | unknown`, `apps/newsdesk/src/facts.ts:51-52`) and the
obituary LLM literally reads `Cause of death: bled_out`. The web timeline and funeral cards render
raw tokens (`Died — bled_out`). The three R5c Morgue image categories gated on cause substrings
(`wolf|bear|animal`, `fell|fall`, `vehicle|car|transport|truck` —
`apps/newsdesk/src/image-categories.ts:42-48`) never fire.

Meanwhile the hard part already shipped. The lean port carried the old platform's **mechanical**
death-fidelity pipeline byte-for-byte:

- Parser captures the `Stats>` vitals tail (energy/water/bleed sources) and requires a real death
  verb, killing the phantom-death bug (`packages/adm-parser/src/death.ts:6-7,35`).
- The fold stores vitals on `lives` (columns in the baseline migration `0000`) and enriches the
  two-line suicide cluster (`died. Stats>` closes the life; the same-timestamp
  `committed suicide` line upgrades `died → suicide`, upgrade-only, idempotent —
  `packages/projections/src/fold.ts:57-92`, `apps/projector/src/pg-store.ts:56-69`).
- The lossless `raw_lines` archive + `apps/projector/src/backfill-death-stats.ts` prove the
  re-parse-and-patch backfill pattern.

What the port dropped (with the news stack) is the **interpretation layer**: `classifyDeath` —
the pure mechanism-first cause ladder that turns mechanism + vitals + recent hits into
starvation/dehydration/mauled verdicts with confidence — and `getLifeDossier`, the ordeals fact
sheet that fed obituary color. And one thing the old initiative never built: the parser still
discards the killer entity on non-player `killed by X` lines, flattening wolves, bears, falls,
and vehicles into `environment` (`death.ts:48`).

## 2. Goals and non-goals

**Goals**

1. Port the interpretation layer: classified death verdicts (starvation, dehydration, mauled,
   bled_out, plus conditions and confidence) computed lazily at read time, surfaced in newsdesk
   prose **and** on web death surfaces (timeline death row, funeral cards, Rap Sheet).
2. Port the ordeals dossier (encounters with infected/fire/pvp, HP low, builds) into obituary
   facts for richer prose.
3. Extend the parser to name non-player killers (wolf/bear/animal/infected/fall/vehicle/
   explosion), lighting the dormant image gates, with a raw_lines backfill for history.
4. Give the obituary LLM the victim's `deathDistance` (known gap: the web renders it, the LLM
   never sees it).

**Non-goals**

- No continuous vitals curve (the ADM emits Water/Energy only on the death line).
- No new event types; the exactly-once ingest key set is untouched.
- No change to qualification, enforcement, or kill-row projection: **PvP deaths keep the literal
  `"pvp"`** everywhere (`packages/read-models/src/qualified.ts:15`, `qualified-lives.ts:16`,
  `apps/enforcer/src/decide.ts:26`, `fold.ts:84`).
- Published articles keep their frozen `articles.facts` — richer causes are forward-only for
  articles (the R5c rule), retroactive for lives/priors/web.
- Priors do not classify every historical life (verdicts stay O(pageSize)); priors gain only
  cause-family grouping in stage 2.

## 3. Architecture

Approach: **lazy shared classifier + in-place cause enrichment** (approach 1 of 3 considered).
The verdict is never materialized — computed at read time wherever needed, so ladder thresholds
tune with no projector rebuild (the `isLifeQualified` precedent, and the old design's explicit
choice). Richer causes are new values of the existing untyped `lives.death_cause` text column —
zero migration (`packages/db/src/schema.ts:84` has no enum/check; the payload zod is
`z.string()`).

Rejected: materializing the verdict at fold time (every ladder tweak forces a rebuild; the fold
gains cross-table lookups); a newsdesk-local classifier + `death_detail` column (web read-models
could not reach it, needs a migration and gate rewrites).

Delivered in two stages — two feature PRs, stage 1 first (zero deploy ceremony), stage 2 with a
backfill + rebuild runbook.

## 4. Stage 1 — the interpretation layer

### 4.1 `packages/domain`: `classifyDeath`

Port essentially verbatim from the archived `packages/newsroom/src/death-cause.ts` (61 lines,
pure), beside the emote/weapon dicts:

- Types: `DeathRawFacts { mechanism, energy, water, bleedSources, weapon }`,
  `RecentHit { attackerType, attackerLabel, secondsBeforeDeath }`,
  `DeathVerdict { cause, confidence, conditions, basis }`.
- Verdict causes: `pvp | suicide | starvation | dehydration | bled_out | mauled | environmental |
  unknown`; confidence `high | low`; conditions from
  `starving | dehydrated | bleeding | hunted | drowned | healthy`.
- Constants: `STARVE_ENERGY_MAX = 1`, `DEHYDRATE_WATER_MAX = 1`, `RECENT_HIT_WINDOW_S = 120`.
- Ladder (mechanism-first): stated mechanisms (`pvp`/`suicide`/`bled_out`/`drowned`/
  `environment`) pass through at high confidence and **subtract their own side-effects** (a blade
  suicide's bleed source is the knife, not a pre-existing wound — `suicide` never adds
  `bleeding`). Inference runs only for `died`/`unknown`/null mechanism: energy ≤ 1 → `starvation`
  (low confidence if any hit within 120 s), water ≤ 1 → `dehydration` (same rule),
  bleedSources > 0 + recent hits → `mauled` (recent infected hit) else `bled_out`, else
  `unknown`/low. `basis` records the evidence for auditability.
- Stage 2 note: the new mechanism tokens (`wolf`, `bear`, `fall`, …) also pass through at high
  confidence (see §5.3).

Golden tests port with it: flaminx0r (`suicide`, conditions `starving`+`hunted`, never
`bleeding`) and RonaldRaygun552 (`suicide`, `healthy`), plus every ladder branch.

### 4.2 `packages/read-models`: dossier + verdict plumbing

New `getLifeDossier(db, serverId, lifeId)` adapted from the archived
`packages/read-models/src/dossier.ts` to the current schema:

- `hit_events` is gamertag-keyed: hits fetched by `(serverId, victimGamertag,
  occurredAt ∈ [startedAt, endedAt])`.
- Encounter collapsing: hit ticks with gaps > `ENCOUNTER_GAP_S = 120` s become distinct
  encounters (`OrdealSummary { encounters, hits, worstEncounterHits }`); fire detected by
  `attackerLabel` containing "fire" **before** infected/pvp categorization; builds counted by the
  `build_events.lifeId` FK; `hpLow` from hit lines.
- `recentHits` = hits within 120 s of the window end, shape-compatible with `classifyDeath`.
- `death` block read off the lives row (mechanism, vitals, weapon).

Verdict consumers (each computes lazily via `classifyDeath`):

- `getLifeTimeline` returns `verdict` alongside the life.
- `getPlayerPage` computes `death.verdict` for the **enriched visible slice only** (stays
  O(pageSize); the lightweight full set used for totals/ordering is untouched).
- Newsdesk `buildObituaryFacts` gains `verdict`, `ordeals`, and `deathDistance`
  (from `lives.death_distance`).

### 4.3 Newsdesk prose + image facts

- `apps/newsdesk/src/prompt.ts` renders the death qualitatively: verdict cause + conditions as
  words (**never raw stat integers** — "starving and hunted, he ended it himself"), hedged when
  confidence is `low` ("the record is murky"). `causeCategory` and the reserved
  PvP/Environment/Unknown tags are unchanged in stage 1.
- `verdict` + `ordeals` freeze into `articles.facts` at publish (`pg-store.ts` publish upsert),
  so the image pass sees them: `suspect-at-large` gains an OR-condition on
  `verdict.cause === "mauled"`; the scene-writer already receives the full facts JSON verbatim.
- Ordeal color reaches the prompt as counts/encounters ("nineteen run-ins with the infected,
  caught fire twice"), following the old prompt's `character` facts shape.
- Birth notices unchanged in stage 1.

### 4.4 Web + API

- API: `GET /players/:gamertag/:map/lives/:n` and `GET /players/:gamertag` responses gain the
  verdict on their death payloads (additive fields; web types extended in
  `apps/web/src/lib/types.ts`).
- **One shared cause/verdict formatting lib** (`apps/web/src/lib/cause-format.ts`): today
  `causeLabel` is duplicated in `obituary-format.ts:19-23` + `birth-format.ts:29-33` and absent
  from `timeline.tsx:51-58` / `past-life-card.tsx:18-29` (raw tokens render). Consolidate;
  add `verdictPhrase(verdict)` → "starvation" / "likely starvation" (low → "likely"),
  suicide-with-conditions → "Suicide — starving and hunted".
- Timeline death row: PvP unchanged ("Killed by X" + GamertagLink); otherwise the headline is
  verdict-driven via `verdictPhrase`; the mono detail line stays strictly factual
  (weapon · distance · vitals).
- Funeral cards and the Rap Sheet Cause row (hot red) show the verdict phrase; the obituary OG
  card inherits through `rapSheetFacts` automatically.

Stage 1 requires no migration, no backfill, no rebuild.

## 5. Stage 2 — richer parser vocabulary + backfill

### 5.1 Parser (`packages/adm-parser/src/death.ts`)

The non-player `killed by X` branch captures the entity token and maps it through a dict
co-located with the verb ladder:

| Entity pattern | Cause token | Dormant gate it lights |
|---|---|---|
| `Animal_CanisLupus*` | `wolf` | `suspect-at-large` (`/wolf\|bear\|animal/`) |
| `Animal_UrsusArctos*` | `bear` | `suspect-at-large` |
| other `Animal_*` | `animal` | `suspect-at-large` |
| `Zmb*` (infected classes) | `infected` | — (deliberately not "animal") |
| `FallDamage` | `fall` | `gravity-undefeated` (`/fell\|fall/`) |
| vehicle/transport classes | `vehicle` | `driver-not-pictured` (`/vehicle\|car\|transport\|truck/`) |
| explosion sources | `explosion` | — |
| anything unmapped | `environment` (today's behavior) | — |

Tokens are chosen so the three dormant gates fire on substring match with **zero gate changes**.
The raw entity string rides `ParsedLine` and the `player.died` payload as new nullish
`deathEntity` (provenance + future prompt color; **no** `lives` column — YAGNI, revisit if prose
ever needs the specific vehicle class). The PvP branch is untouched. The fold needs no change:
new tokens flow through `endLife`, and the cluster-enrichment CASE (`died` → specific,
`pg-store.ts:64`) already accepts them if an environment death arrives as a two-line cluster.

Both local DBs are empty, so the dict cannot be pre-validated against real data. The initial
dict ships only patterns confirmable from DayZ class-name conventions (`Animal_*`, `Zmb*`,
`FallDamage`); families whose class names are unconfirmed (vehicle, explosion) may start in the
`environment` fallback rather than guessed. The backfill run on prod **doubles as the survey** —
it logs every unmapped entity it meets, and the dict tunes from that log (a second backfill run
is idempotent and cheap).

### 5.2 Backfill (`apps/projector/src/backfill-death-causes.ts`)

New script modeled on `backfill-death-stats.ts` (which cannot be reused — it skips any event
whose payload already has stats). For every `player.died` event with a `raw_line_id`: re-parse
the raw text with the current parser; patch the payload when the re-parsed cause differs **and**
the stored cause ∈ `{environment, died, unknown}` (never touching `pvp`, `suicide`, `bled_out`,
`drowned`); add `deathEntity`; log unmapped entities; idempotent (second run patches 0). Then a
full projection rebuild re-folds.

**Ops runbook (stage 2 release):** merge → release → on the host run
`backfill-death-causes` → `./deploy/deploy.sh --rebuild`. Retroactive effect: lives, priors, and
web surfaces update; frozen articles do not.

### 5.3 Downstream accommodation

- `classifyDeath`: the new tokens are stated mechanisms — pass through at high confidence with
  `withHealthy(baseConditions)` (a wolf death with energy 0 still reports `starving` as a
  condition; the verdict cause stays `wolf`). The `DeathVerdict.cause` union widens accordingly
  in stage 2 — it is the stage-1 eight values plus the new mechanism tokens.
- `verdictPhrase`/`causeLabel`: labels for the new tokens ("Wolf", "Fell", "Vehicle", …); the
  obituary prompt's environment branch renders a readable phrase instead of the raw token.
- Priors: `usualDeathCause` computes its mode over **cause families** (wolf/bear/animal →
  `animal`; the rest map 1:1) so the finer vocabulary doesn't fragment the mode; display shows
  the winning family's label. Family map lives beside `causeLabel`.
- Optional, deferred: new reserved article tags (Animal/Vehicle) via `causeCategoryTag` — not in
  this design's scope.

## 6. Error handling

- `classifyDeath` is total: missing vitals (PvP lines carry none; pre-fidelity rows) degrade to
  mechanism-passthrough or `unknown`/low — never throws.
- An empty `recentHits` window is a valid input (no hits ⇒ `healthy` substitution applies).
- All payload additions are zod `nullish` — historical events without `deathEntity`/vitals stay
  valid at fold time.
- Backfill: skips events with null `raw_line_id`; unmapped entities are logged and left as
  `environment`, never dropped or errored.
- Newsdesk: a verdict/dossier failure must not block article generation — facts assembly treats
  the verdict as optional enrichment (falls back to today's coarse rendering).

## 7. Testing

- **Domain:** ported golden fixtures (flaminx0r, RonaldRaygun552) + every ladder branch
  (starvation high/low, dehydration high/low, mauled vs bled_out, unknown-healthy, stated
  mechanisms incl. the new stage-2 tokens).
- **Read-models (real DB, `TEST_DATABASE_URL`):** dossier encounter collapsing (gap boundary),
  fire-before-infected categorization, hits windowing on `[startedAt, endedAt]`, recentHits
  120 s cut, `getLifeTimeline`/`getPlayerPage` verdict wiring, O(pageSize) slice boundary.
- **Newsdesk:** facts assembly (verdict + ordeals + deathDistance present; optional on failure),
  prompt wording (qualitative conditions, hedging on `low`), image-gate `mauled` condition.
- **Web:** component tests for verdict phrases on timeline death row, funeral card, Rap Sheet;
  shared `causeLabel` consolidation keeps existing obituary/birth formatting tests green.
- **Parser:** each entity mapping + unmapped fallback + `deathEntity` capture; existing death
  fixtures unchanged.
- **Backfill (real DB):** seeds a `killed by Animal_CanisLupus` raw line with an `environment`
  payload, asserts `wolf` + `deathEntity` patched, pvp/suicide rows untouched, second run
  patches 0.

## 8. Delivery

Two feature PRs from `feature/*` branches into `develop` (CHANGELOG + CLAUDE.md on each, per
workflow):

1. **Stage 1 — interpretation layer** (domain classifier, dossier, newsdesk prose, web/API
   verdict surfaces). No deploy ceremony; cut a release when merged.
2. **Stage 2 — parser vocabulary + backfill** (entity dict, `deathEntity`, backfill script,
   priors family grouping, label additions). Release with the backfill + `--rebuild` runbook.
