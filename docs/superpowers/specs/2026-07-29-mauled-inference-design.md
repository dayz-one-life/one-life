# Mauled inference — corroborated infected deaths

**Date:** 2026-07-29
**Status:** design approved, implementation pending

## 1. Problem

DayZ writes some deaths with no `killed by` clause at all — a bare `died.` — so the parser's entity
dict has nothing to map and `lives.death_cause` lands as `died`. `classifyDeath` then infers, and
its infected branch is gated on `bleedSources > 0`:

```ts
if (facts.bleedSources != null && facts.bleedSources > 0 && recent.length > 0) {
  return { cause: hunted ? "mauled" : "bled_out", ... };
}
return { cause: "unknown", confidence: "low", ... };
```

Deaths caused by infected routinely report `Bleed sources: 0` — the wounds close before the player
expires — so they fall through to `unknown`.

### The case that surfaced it

Life 313, `GreenGreg420`, Chernarus, died `2026-07-28 23:42:19Z`. Nineteen infected hits across
twelve minutes drove him from 30.4 HP to **0.392 HP** at 23:40:51. No further damage of any kind.
He died 88 seconds later:

```
19:42:19 | Player "GreenGreg420" (DEAD) (id=…) died. Stats> Water: 572.133 Energy: 286.571 Bleed sources: 0
```

Energy 287 and water 572 rule out starvation and dehydration; there is no fall hit; there is no
killer clause. Verdict: `unknown`, `confidence: "low"`, `conditions: ["hunted"]`.

The classifier already knows he was hunted. It is not allowed to promote that into a cause.

## 2. What the corpus says

All 31 bare-`died` lives in production, cross-referenced against infected hits inside the 120 s
window and against `is unconscious` lines in `raw_lines`:

| Lives | Infected hits in window | `bleedSources` | Unconscious line | Verdict today |
| --- | --- | --- | --- | --- |
| 5 — 119, 171, 324, 18, 199 | yes | > 0 | 4 of 5 | `mauled` ✅ |
| 5 — 165, 166, 10, 31, **313** | yes | **0** | 4 of 5 | `unknown` ❌ |
| 21 | none | — | 1 (a fall) | `unknown` / starvation ✅ |

Two findings shaped the design.

**HP is not a usable threshold on its own.** Life 165 took 18 infected hits and died at **HP 88**:

```
09:25:44 | Player "XxBE4zyxX" … has been disconnected
09:25:44 | …[HP: 99.3825] hit by Infected … (MeleeInfected)
…
09:25:58 | Player "XxBE4zyxX" … is disconnecting while being unconscious
09:25:58 | Player "XxBE4zyxX" (DEAD) … died. Stats> … Bleed sources: 0
```

Infected deal **shock**, which never appears in the `[HP: …]` field. They knock a player unconscious
at near-full health and DayZ then kills them for logging out unconscious. Any HP cutoff rejects this
death and three like it while catching only life 313.

**The `is unconscious` line is the strong signal, and nothing reads it.** It correlates with 9 of
the 10 infected cases and with **zero** of the 21 non-infected ones. `packages/adm-parser` does not
match it: all 63 lines containing `unconscious` produced a `player.position` event and nothing else
(verified — the group-by over `events.raw_line_id` returns a single row, `player.position/0`, ×63).

## 3. The rule

Replace the bleed-gated branch with an infected gate plus interchangeable corroboration:

```
hunted AND (bleeding OR wentUnconscious OR terminalHp <= 1)  →  mauled
bleeding AND recent hits (not hunted)                        →  bled_out
```

Against every prod case:

| Life | bleed | unconscious | min HP in window | Qualifies via |
| --- | --- | --- | --- | --- |
| 119 CUPID18 | 2 | — | 0.00 | bleeding + HP |
| 171, 324, 18, 199 | 1–2 | ✓ | 29–78 | bleeding + unconscious |
| 165, 166, 10, 31 | 0 | ✓ | 10–88 | unconscious |
| **313 GreenGreg420** | 0 | — | **0.39** | terminal HP |

Every case rests on real corroboration; none rests on a bare scratch. The three clauses are
non-overlapping in coverage, so removing any one regresses named lives — each is mutation-testable.

This **inverts** the current logic. Today `bleedSources` is the gate and `hunted` only picks the
label. After this, `hunted` is the gate and the other three are interchangeable evidence — the shape
the corpus actually has.

### Sub-decisions

- **`terminalHp` reads INFECTED hits only** — the same hits that satisfy the `hunted` gate. Over
  *all* hits in the window, a fire tick or a player's shot that left the victim at ~0 HP is
  corroborated by an unrelated infected scratch, and the death is published as `mauled` at high
  confidence: fire is a real recurring cause here, fire ticks run to 0 HP, and a fire death carries
  no killer clause. Coverage-neutral against the table above (life 313's 0.392 and life 119's 0.00
  are both infected hits).
- **`terminalHp` is the MINIMUM `victimHp` across those hits**, not the last hit's value.
  Hits arrive with jitter — life 313's HP reads 3.07, then 3.15, then 2.34 — so "the last one" is not
  reliably the lowest. The two coincide on both affected lives (313 → 0.392, 119 → 0.00), so this is
  a robustness choice, not a coverage one.
- **`<= 1`, not `<= 0`.** The fall rung uses `<= 0` because a fall's own hit lands the killing blow.
  Infected stop just short and the player expires afterward, so the threshold means "left at
  effectively zero health". `<= 1` and `<= 5` are identical on current data (the next value up is
  10.66, which qualifies via unconscious anyway); take the tighter one.
- **Ladder position unchanged** — below the fall rung and below starvation/dehydration. None of the
  10 are starving or dehydrated, so nothing is taken from a higher rung, and a starving man chased by
  zombies still reads as starvation with `hunted` in `conditions`.
- **No new verdict.** The 7 combat-log cases stay `mauled`. A distinct `combat_log` cause would be a
  publicly visible accusation of behaviour players consider cheating, printed on a dossier, obituary
  and priors permanently. The infected did cause the death; that is what we publish.
- **`weapon` stays unread.** It remains reserved on `DeathRawFacts`; melee/firearm distinction is a
  different question and would blur this rung's single purpose.

## 4. Parser and event plumbing

### Parser

New `packages/adm-parser/src/unconscious.ts` matching two forms:

```
Player "X" (id=… pos=<…>) is unconscious                            56 lines
Player "X" (id=… pos=<…>) is disconnecting while being unconscious   6 lines
```

Both yield one `kind: "unconscious"` carrying `disconnecting: boolean`. The flag is recorded because
it is free at parse time and is what a future combat-log verdict would need; the rule ignores it.

Explicitly **not** matched:

- the single `(DEAD) … is unconscious` corpse line — post-death noise;
- the 45 `regained consciousness` lines. The rule asks "did they go down during the fight", not
  "what was their consciousness state". Modelling the state machine is out of scope.

### ⚠️ Dispatch ordering is load-bearing

`parseUnconscious` must be appended **after** `parsePosition` in `parseLine`, not before.

`subIndex` is the array position of the parsed result (`apps/ingest-worker/src/process-file.ts:56`),
and all 63 historical unconscious lines already hold `player.position` at `subIndex 0` (verified — no
other event type appears against any of them). Inserting ahead of position renumbers it to 1 and
collides with `events_idempotency_uniq` on every one of them.

This inverts the file's "Primary event(s) first, then position" comment. Amend the comment to record
why, or a later tidy-up will restore the convention and break the backfill.

### Event type and projection

- `player.unconscious` added to `EVENT_TYPES` (`packages/domain/src/events.ts`).
- `KIND_TO_TYPE` in `apps/ingest-worker/src/map-events.ts` is a
  `Record<ParsedLine["kind"], EventType>`, so adding the kind is a **compile error until mapped** —
  no runtime enforcement needed.
- New `unconscious_events` table with an FK to `players(id)`.
- `packages/projections/src/fold.ts` gains `case "player.unconscious"`.

**⚠️ `unconscious_events` gets NO entry in `REBUILD_TRUNCATE_TABLES`.** `players` is already in that
list, so `TRUNCATE … RESTART IDENTITY CASCADE` clears the child for free. Naming a table the current
release creates is what killed the v0.42.1 deploy: the rebuild phase runs *before* the migrate phase,
so the relation does not exist yet and the whole `TRUNCATE` aborts with the fleet already stopped.

**⚠️ `fold.ts`'s switch ends in `default: return`,** so a missing `case` is silently ignored rather
than caught. This needs its own test.

## 5. Read-model wiring

Half the evidence is already present. `recentHits` carries `victimHp` for every hit in the window, so
the `terminalHp <= 1` clause is computed inside `classifyDeath` from data it already receives — no
read-model change for that clause.

Only the unconscious signal needs plumbing, in `packages/read-models/src/life-dossier.ts`:

- one query against `unconscious_events`, reusing the already-resolved `p.id` and the same
  `life.startedAt … windowEnd` bounds, mapped to `secondsBeforeDeath` and filtered by
  `RECENT_HIT_WINDOW_S` exactly as `recentHits` is;
- `LifeDossier` gains `recentUnconscious: DossierUnconscious[]`.

### Signature: required third parameter, not optional

```ts
classifyDeath(facts, recentHits, recentUnconscious)   // no default
```

An optional `= []` would let a caller silently omit the evidence and produce a wrong verdict — the
exact failure this change exists to fix. This follows the `sampleAgeSeconds` precedent from the
life-track work: non-optional, so a caller must *actively* discard it. Two call sites, so the cost is
nil.

## 6. Backfill and deploy

New `backfill-unconscious` projector command, mirroring `backfill-death-causes`: scan `raw_lines`,
re-parse, append only the new events. Idempotent via `events_idempotency_uniq`, so it is safe to
re-run. Current corpus: 36,796 rows, of which 63 contain `unconscious` and **62 are matched** (the
`(DEAD)` corpse line is deliberately skipped, per §4).

**No `--rebuild`.** The backfilled events receive fresh ids at the tail of `events`, so the running
projector folds them forward on its normal cursor. `unconscious_events` is insert-only with no
ordering dependency, so out-of-chronological-order arrival is harmless.

```
./deploy/deploy.sh                                          # migrate creates the table
pnpm --filter @onelife/projector run backfill-unconscious   # `run`, never bare
```

Verify on the host that the projector picked the new events up (`select count(*) from
unconscious_events`). If it has not, `pnpm --filter @onelife/projector run rebuild` is the fallback.

Verdicts are computed lazily and never materialized, so all 10 lives correct themselves as soon as
the events land. Published obituary prose is frozen at publish time and is **not** regenerated;
correcting those is a separate decision.

## 7. Tests

Each proven against the mutation it guards.

| Test | Mutation it must fail against |
| --- | --- |
| hunted + bleed 0 + unconscious → `mauled` | remove the unconscious clause |
| hunted + bleed 0 + terminal HP 0.39 → `mauled` (life 313's real numbers) | remove the HP clause |
| hunted + bleed 0 + no corroboration + HP 45 → `unknown` | drop the gate entirely |
| starving + hunted + unconscious → `starvation` | move the rung above starvation |
| fatal fall + hunted + unconscious → `fall` | move the rung above the fall rung |
| not hunted + bleeding + hits → `bled_out` | collapse the two branches |
| `parseLine` on an unconscious line → `[position, unconscious]` | reorder the dispatch |
| fold inserts a row for `player.unconscious` | omit the `case`, hitting the silent `default:` |
| unconscious 121 s before death → excluded | window boundary |
| `regained consciousness` → no match | parser over-matching |
| `(DEAD) … is unconscious` → no match | parser over-matching |
| `rebuildAll` empties `unconscious_events` via cascade | dropping the FK to `players` |

## 8. Out of scope

- **`dossierForLife:60` resolves the player with a bare `eq(players.gamertag, gamertag)` taking
  `[0]`,** without the "most-recently-seen, `id` ascending" tie-break that CLAUDE.md names as living
  in four places. Since migration `0025` a recycled gamertag can match two `players` rows, so this is
  a latent mis-attribution. The new query reuses the same resolved `p.id` and therefore adds no new
  instance of the bug. Logged as a separate fix.
- Regenerating already-published obituaries for the 10 corrected lives.
- Parsing `regained consciousness` and modelling consciousness as state.
- A distinct combat-log verdict. The `disconnecting` flag is recorded so this stays cheap later.
