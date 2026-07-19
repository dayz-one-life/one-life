# R5d PR-C2 — the `newsTick` pass (shipped disabled) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the fifth `apps/newsdesk` pass — `newsTick` — which turns the PR-C1 Standing Dead and Long Form targets into published `kind='news'` articles, shipped **off** so that until an operator opts in there is **no article row, no model call, and no external write**.

**Architecture:** A 1:1 structural mirror of the birth-notice pass (`birth-tick` → `birth-facts` → `birth-prompt`/`birth-voice` → `generate` → `birth-pg-store`), with three deliberate divergences: the facts type covers **two** triggers and carries **N subjects**; the article body is a **block union** (`body` is derived, never model-authored); and the article dedupes on `articles.natural_key` (partial-unique) rather than the life tuple, so every upsert must carry `targetWhere`. A de-publication sweep retracts a Standing Dead article whose subject came back.

**Tech Stack:** TypeScript/ESM, pnpm + turbo, Postgres + Drizzle (drizzle-orm 0.36.4 / postgres-js 3.4.9), zod, vitest, pino, OpenRouter via the existing `CompletionClient`.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Ships disabled.** `NEWSDESK_NEWS_ENABLED` defaults **off** and `NEWSDESK_NEWS_SINCE` unset ⇒ pass off. A test must assert the tick returns zeros and makes **NO model call and NO DB write** in **both** off-states.
- **`targetWhere` is mandatory on every news upsert.** Migration `0014` made `articles_kind_server_gamertag_life_uniq` partial (`WHERE kind IN ('obituary','birth_notice')`) and added `articles_natural_key_uniq` unique `WHERE natural_key IS NOT NULL`. News dedupes on `natural_key`, so its upserts target `articles.naturalKey` with `targetWhere: isNotNull(articles.naturalKey)`. A missing or wrong `targetWhere` raises Postgres **42P10** and kills publishing. **Both the publish path AND the failure-stub path write the natural key** — a stub with a NULL `natural_key` escapes the unique index and every retry inserts a new row forever.
- **`natural_key` is produced ONLY by `toISOString()` in TypeScript**, never by a SQL `to_char()`. The anti-join is a second TS-side query. PR-C1 established this; do not break it.
- **No coordinate ever crosses the boundary.** `NewsFacts` carries no `x`/`y`/position/distance-between-fixes field. Total distance covered is permitted as a scalar only. Assert on the **built object**, over a fixture whose SOURCE rows do contain coordinates, with **key-presence assertions** (not only a `/\d{4}\.\d/` regex, which misses short coordinates).
- **Never print wall-clock as survival time.** Always `playtime_seconds`. A fixture where the two diverge must produce the playtime figure.
- **No row ids in durable fields** — snapshot test over a built facts object. `lifeId` is transient and must never be persisted.
- **Gamertags verbatim** as stored in `players`, never lowercased, in keys and facts.
- **Forbidden real-player framing (§5):** the prompt forbids `the player`, `logged off`, `stopped playing`, `lost interest`, and second-person real-player framing. Assert as a token test.
- Prompt version string is exactly **`news-v1`**.
- `NEWSDESK_NEWS_MAX_PER_TICK` default is exactly **`2`**.
- **Length is never requested as a minimum (§5)** — the prompt states a target range and nothing enforces a floor. Zod validates shape only.
- **Do not modify the behaviour of the PR-C1 targeting layer** (`news-targets.ts`,
  `standing-dead-targets.ts`, `long-form-targets.ts`, `long-form-cluster.ts`) — **with exactly one
  sanctioned exception, made in Task 7 and nowhere else**: the anti-join predicate in
  `standing-dead-targets.ts` and `long-form-targets.ts` widens from `status = 'published'` to
  `status IN ('published','retracted')`.
  **Why the exception is required.** As written, the constraint is the reason the retraction hole
  exists. PR-C1's anti-join gates on publication status, not on row existence, so a `retracted` row
  blocks nothing: the subject is still idle, `natural_key` is byte-identical, and the next tick
  regenerates the same feature — a **paid model call** — which the sweep at the end of that very
  tick retracts again. That loop runs forever, one wasted call per tick, and it contradicts spec
  §4.1.3 ("the prose is never regenerated"). Retraction durability is a property of **the widened
  anti-join**, never of the row merely continuing to exist; anywhere the plan says otherwise is
  wrong. No other line of the targeting layer may change.
- **Driver traps.** (a) `drizzle-orm/postgres-js` installs an identity serializer for timestamptz OID 1184, so passing a raw `Date` into a `sql` template crashes the wire encoder — use `.toISOString()`. (b) drizzle's `sql` tag flattens an interpolated JS array into a parenthesized scalar list, so a native Postgres array needs `ARRAY[...]` + `sql.join`.
- **SECURITY:** the tables `user`, `account`, `session`, `verification` hold Better Auth data including real email addresses. Never query them, never output their contents. Gamertags are public and fine. Production DB dumps at repo root are gitignored and must never be committed.
- Repo test convention: pure functions and presentational components are unit-tested; hooks and thin wiring are not. DB-touching code uses the Postgres harness (`@onelife/test-support`).
- Commands: `pnpm turbo run test --concurrency=1` (DB suites need `TEST_DATABASE_URL`); `pnpm turbo run typecheck`. Local Postgres may be on port **5434** on this machine (a gitignored `docker-compose.override.yml`).

---

## Stated deviations from the spec

Record these in the PR description. They are decisions, not oversights.

1. **The "last expressive emote" slot of §4.1.4 is CUT.** The allowlist (`EmoteTaunt | EmoteGreeting | EmotePoint | EmoteSurrender`) covers ~49 events corpus-wide, so it carries no signal, and reaching it requires querying `events.payload` — the same column holding 5,633 coordinate rows that §11's Fog Rule rail exists to guard. `NewsFacts` therefore has **no emote field at all**. The §11 rail "`EmoteSuicide` never reaches a fact payload" is still asserted, as a **structural** test that no emote-shaped key exists anywhere in a built facts object (Task 11).
2. **`facts.totalDistanceCovered` is CUT.** §4.1.4 lists it as *permitted* safe material, not required. Computing it means a second query against `positions`, the coordinate table. Omitting it keeps PR-C2's Fog-Rule story absolute: the news pass issues **zero** coordinate-touching queries of its own.
3. **§14 says "seven new env vars"; ten are actually required.** Enumerated in Task 1. The spec's count omits the three Long Form knobs (`WINDOW_SECONDS`, `RADIUS_METERS`, `MAX_FIX_AGE_SECONDS`) — `LongFormTargetOpts` makes them required, non-defaulted fields, so they cannot be hardcoded at the call site without silently pinning production tuning into source.
4. **`unqualified_subject` is dropped from the observability log line** (see Task 9 for the full rationale and the test that pins it).
5. **The retraction sweep respects `NEWSDESK_DRY_RUN`.** The spec does not say. Every other write in this worker is behind that gate, and in a dry run nothing was ever published, so there is nothing real to retract. A dry-run tick therefore *finds* returned subjects and logs them without writing.
6. **`facts.hitsAbsorbed` is `0` for a Long Form article.** Absorbed hits are a Standing Dead endurance signal; they are not queried for a death cluster. The consequence — the `what-it-took` image category never fires on a Long Form piece — is intended, and is asserted.
7. **§4.1.4's "deaths avoided" safe-material item is CUT.** It is listed as *permitted* material, not required, and it is not derivable from the schema: nothing records a near-miss, so any figure would be an invention. The signal it stands for — this survivor took real punishment and lived — is already carried, honestly and countably, by `hitsAbsorbed` (hits absorbed and survived). Recording it here rather than leaving it a silent omission.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `apps/newsdesk/src/news-facts.ts` | `NewsFacts` / `NewsSubject` types + `buildStandingDeadFacts` / `buildLongFormFacts`. Pure. The single producer of everything frozen into `articles.facts`. |
| `apps/newsdesk/src/news-voice.ts` | `NEWS_SYSTEM` — the Newsroom register, vendored from `../brand/brand-bible.md` §6. Pure constant. |
| `apps/newsdesk/src/news-prompt.ts` | `NEWS_PROMPT_VERSION`, `buildNewsPrompt` (both trigger arms), the zod block-union parse, derived `body`, `composeNewsTags`. Pure. |
| `apps/newsdesk/src/news-pg-store.ts` | `newsSlug`, `publishNews`, `recordNewsFailure`, `findReturnedStandingDead`, `retractNewsArticles`. All SQL. |
| `apps/newsdesk/src/news-tick.ts` | `newsTick` — the pass. Both arms, retraction, dry-run gate, failure isolation, the §14 log line. |
| `apps/newsdesk/test/news-facts.test.ts` | Unit tests for the facts builders. |
| `apps/newsdesk/test/news-voice.test.ts` | Token tests over `NEWS_SYSTEM`. |
| `apps/newsdesk/test/news-prompt.test.ts` | Unit tests for prompt/parse/derive/tags. |
| `apps/newsdesk/test/news-pg-store.test.ts` | DB tests: slug, upsert idempotency, the `targetWhere` guard, failure-stub dedupe. |
| `apps/newsdesk/test/news-retraction.test.ts` | DB tests for the de-publication sweep. Its own fixture, so Task 6's test file is never re-edited. |
| `apps/newsdesk/test/news-antijoin-retracted.test.ts` | DB tests that a `retracted` row blocks re-selection in BOTH targeting arms. Own isolated fixture, so the PR-C1 test files are untouched. |
| `apps/newsdesk/test/news-tick.test.ts` | DB tests: off-states, dry-run, live publish, failure dedupe, log shape. |
| `apps/newsdesk/test/news-rails.test.ts` | The §11 hard rails. |
| `apps/newsdesk/test/long-form-boundaries.test.ts` | The three boundary tests PR-C1 deferred. Own isolated fixture, so the PR-C1 test file is untouched. |

**Modified**

| File | Change |
|---|---|
| `apps/newsdesk/src/config.ts` | Ten env vars + `parseSince` generalisation + suppressed-list parsing. |
| `apps/newsdesk/src/image-categories.ts` | `NewsImageFacts` typed contract + typed `news()` accessor in the 13 Newsroom predicates; doc-comment correction. |
| `apps/newsdesk/src/standing-dead-targets.ts` | **One line**: the anti-join predicate widens to `status IN ('published','retracted')`. The sole sanctioned change to the PR-C1 targeting layer (Task 7). |
| `apps/newsdesk/src/long-form-targets.ts` | The same one-line anti-join widening, kept byte-for-byte identical to its sibling so the two cannot drift (Task 7). |
| `apps/newsdesk/src/generate.ts` | `generateNews`. |
| `apps/newsdesk/src/main.ts` | Startup log lines + the try/catch sibling. |
| `packages/db/src/schema.ts` | One-line `kind` column comment fix. |
| `apps/newsdesk/test/config.test.ts` | New describe block for the news config surface. |
| `apps/newsdesk/test/image-categories.test.ts` | Fixtures typed as `NewsImageFacts`; `lastExpressiveEmote` removed. |
| `apps/newsdesk/test/image-scene.test.ts` | The second news fixture typed as `NewsImageFacts`; `lastExpressiveEmote` removed; a banned framing removed from its `lede`. |
| `apps/newsdesk/test/generate.test.ts` | New describe block for `generateNews`. |
| `.env.example` | The ten vars, documented. |
| `CHANGELOG.md` | Required on every PR by the workflow guard. |
| `CLAUDE.md` | Required by spec §14 and by the workflow guard before `gh pr create`. |

**Explicitly out of scope (PR-C3):** `packages/read-models/src/news-articles.ts`, the `GET /news` API routes, and the entire web surface.

---

## Task 1: Config surface

**Files:**
- Modify: `apps/newsdesk/src/config.ts`
- Modify: `apps/newsdesk/test/config.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces: `Config` gains `newsEnabled: boolean`, `newsSince: Date | null`, `newsMaxPerTick: number`, `standingDeadHours: number`, `standingDeadMinPlaytimeSeconds: number`, `standingDeadMinHits: number`, `newsSuppressedGamertags: string[]`, `longFormWindowSeconds: number`, `longFormRadiusMeters: number`, `longFormMaxFixAgeSeconds: number`. Task 10 reads all ten.

**The honest env-var count.** Spec §14 says "seven new env vars". Ten are required:

| Var | Default | Why it must exist |
|---|---|---|
| `NEWSDESK_NEWS_ENABLED` | *(off)* | Kill switch. On only when exactly `"true"`. |
| `NEWSDESK_NEWS_SINCE` | *(unset ⇒ off)* | Forward-only cutoff, gated on the eligibility instant (§4.1.3). |
| `NEWSDESK_NEWS_MAX_PER_TICK` | `2` | §9. |
| `NEWSDESK_STANDING_DEAD_HOURS` | `72` | §4.1. |
| `NEWSDESK_STANDING_DEAD_MIN_PLAYTIME_SECONDS` | `1800` | §4.1. |
| `NEWSDESK_STANDING_DEAD_MIN_HITS` | `100` | §4.1.1 earned coverage. Spec states the value but not a var name; `StandingDeadOpts.minHitsAbsorbed` is a required non-defaulted field, so it needs one. |
| `NEWSDESK_NEWS_SUPPRESSED_GAMERTAGS` | `""` | §13.3. |
| `NEWSDESK_LONGFORM_WINDOW_SECONDS` | `180` | §4.2. |
| `NEWSDESK_LONGFORM_RADIUS_METERS` | `100` | §4.2. |
| `NEWSDESK_LONGFORM_MAX_FIX_AGE_SECONDS` | `120` | §4.2. |

- [ ] **Step 1: Write the failing test**

Append to `apps/newsdesk/test/config.test.ts`:

```ts
describe("newsdesk config — the news pass (R5d PR-C2)", () => {
  it("ships OFF: newsEnabled false and newsSince null when both are unset", () => {
    const c = loadConfig({ ...BASE });
    expect(c.newsEnabled).toBe(false);
    expect(c.newsSince).toBeNull();
  });

  it("enables ONLY on the exact string 'true'", () => {
    expect(loadConfig({ ...BASE, NEWSDESK_NEWS_ENABLED: "true" }).newsEnabled).toBe(true);
    expect(loadConfig({ ...BASE, NEWSDESK_NEWS_ENABLED: "1" }).newsEnabled).toBe(false);
    expect(loadConfig({ ...BASE, NEWSDESK_NEWS_ENABLED: "TRUE" }).newsEnabled).toBe(false);
    expect(loadConfig({ ...BASE, NEWSDESK_NEWS_ENABLED: "" }).newsEnabled).toBe(false);
  });

  it("parses NEWSDESK_NEWS_SINCE like the birth cutoff: valid ISO in, junk to null", () => {
    expect(loadConfig({ ...BASE, NEWSDESK_NEWS_SINCE: "2026-07-19T00:00:00Z" }).newsSince?.toISOString())
      .toBe("2026-07-19T00:00:00.000Z");
    expect(loadConfig({ ...BASE, NEWSDESK_NEWS_SINCE: "   " }).newsSince).toBeNull();
    expect(loadConfig({ ...BASE, NEWSDESK_NEWS_SINCE: "not-a-date" }).newsSince).toBeNull();
  });

  it("does not disturb the birth cutoff when the news cutoff is set", () => {
    const c = loadConfig({ ...BASE, NEWSDESK_NEWS_SINCE: "2026-07-19T00:00:00Z" });
    expect(c.birthSince).toBeNull();
  });

  it("defaults every trigger knob to the spec value", () => {
    const c = loadConfig({ ...BASE });
    expect(c.newsMaxPerTick).toBe(2);
    expect(c.standingDeadHours).toBe(72);
    expect(c.standingDeadMinPlaytimeSeconds).toBe(1800);
    expect(c.standingDeadMinHits).toBe(100);
    expect(c.longFormWindowSeconds).toBe(180);
    expect(c.longFormRadiusMeters).toBe(100);
    expect(c.longFormMaxFixAgeSeconds).toBe(120);
  });

  it("overrides every trigger knob from the environment", () => {
    const c = loadConfig({
      ...BASE,
      NEWSDESK_NEWS_MAX_PER_TICK: "5",
      NEWSDESK_STANDING_DEAD_HOURS: "96",
      NEWSDESK_STANDING_DEAD_MIN_PLAYTIME_SECONDS: "3600",
      NEWSDESK_STANDING_DEAD_MIN_HITS: "50",
      NEWSDESK_LONGFORM_WINDOW_SECONDS: "300",
      NEWSDESK_LONGFORM_RADIUS_METERS: "150",
      NEWSDESK_LONGFORM_MAX_FIX_AGE_SECONDS: "60",
    });
    expect(c.newsMaxPerTick).toBe(5);
    expect(c.standingDeadHours).toBe(96);
    expect(c.standingDeadMinPlaytimeSeconds).toBe(3600);
    expect(c.standingDeadMinHits).toBe(50);
    expect(c.longFormWindowSeconds).toBe(300);
    expect(c.longFormRadiusMeters).toBe(150);
    expect(c.longFormMaxFixAgeSeconds).toBe(60);
  });

  it("splits the suppression list, trims, drops empties, and preserves case", () => {
    expect(loadConfig({ ...BASE }).newsSuppressedGamertags).toEqual([]);
    expect(loadConfig({ ...BASE, NEWSDESK_NEWS_SUPPRESSED_GAMERTAGS: "" }).newsSuppressedGamertags).toEqual([]);
    expect(loadConfig({ ...BASE, NEWSDESK_NEWS_SUPPRESSED_GAMERTAGS: " YrJustBad , ,Cee Lo GREEN 96 " }).newsSuppressedGamertags)
      .toEqual(["YrJustBad", "Cee Lo GREEN 96"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/newsdesk exec vitest run test/config.test.ts`
Expected: FAIL — `Property 'newsEnabled' does not exist on type 'Config'` (and siblings).

- [ ] **Step 3: Add the schema entries**

In `apps/newsdesk/src/config.ts`, replace:

```ts
  NEWSDESK_IMAGES_ENABLED: z.string().optional(),
});
```

with:

```ts
  NEWSDESK_IMAGES_ENABLED: z.string().optional(),
  // ── R5d news pass. Two independent OFF switches: the kill switch below, and an unset
  // NEWSDESK_NEWS_SINCE. Both default to off, so this release is inert until an operator opts in.
  NEWSDESK_NEWS_ENABLED: z.string().optional(),
  NEWSDESK_NEWS_SINCE: z.string().optional(),
  NEWSDESK_NEWS_MAX_PER_TICK: z.coerce.number().int().positive().default(2),
  NEWSDESK_STANDING_DEAD_HOURS: z.coerce.number().positive().default(72),
  NEWSDESK_STANDING_DEAD_MIN_PLAYTIME_SECONDS: z.coerce.number().int().nonnegative().default(1800),
  NEWSDESK_STANDING_DEAD_MIN_HITS: z.coerce.number().int().nonnegative().default(100),
  NEWSDESK_NEWS_SUPPRESSED_GAMERTAGS: z.string().default(""),
  NEWSDESK_LONGFORM_WINDOW_SECONDS: z.coerce.number().positive().default(180),
  NEWSDESK_LONGFORM_RADIUS_METERS: z.coerce.number().positive().default(100),
  NEWSDESK_LONGFORM_MAX_FIX_AGE_SECONDS: z.coerce.number().positive().default(120),
});
```

- [ ] **Step 4: Extend the `Config` type**

Replace:

```ts
  imagesEnabled: boolean;
};
```

with:

```ts
  imagesEnabled: boolean;
  newsEnabled: boolean;
  newsSince: Date | null;
  newsMaxPerTick: number;
  standingDeadHours: number;
  standingDeadMinPlaytimeSeconds: number;
  standingDeadMinHits: number;
  newsSuppressedGamertags: string[];
  longFormWindowSeconds: number;
  longFormRadiusMeters: number;
  longFormMaxFixAgeSeconds: number;
};
```

- [ ] **Step 5: Generalise the cutoff parser and add the list parser**

Replace:

```ts
/** Parse the forward-only birth cutoff. Unset / empty / unparseable -> null (birth pass off) — a
 *  safe default parallel to the dry-run gate. */
function parseBirthSince(raw: string | undefined): Date | null {
  if (!raw || raw.trim() === "") return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
```

with:

```ts
/** Parse a forward-only go-live cutoff. Unset / empty / unparseable -> null, which turns the
 *  owning pass OFF — a safe default parallel to the dry-run gate. Shared by the birth pass and
 *  the news pass so the two cutoffs can never drift in parsing behaviour. */
function parseSince(raw: string | undefined): Date | null {
  if (!raw || raw.trim() === "") return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Comma-separated subject opt-out list (spec §13.3). Trimmed, empties dropped, CASE PRESERVED:
 *  the targeting layer lowercases for comparison itself, and a gamertag is stored verbatim
 *  everywhere else in this codebase. */
function parseGamertagList(raw: string): string[] {
  return raw.split(",").map((g) => g.trim()).filter((g) => g.length > 0);
}
```

- [ ] **Step 6: Wire the returned config**

Replace:

```ts
    // SAFE DEFAULT: birth pass off unless a valid ISO cutoff is provided.
    birthSince: parseBirthSince(p.NEWSDESK_BIRTH_SINCE),
```

with:

```ts
    // SAFE DEFAULT: birth pass off unless a valid ISO cutoff is provided.
    birthSince: parseSince(p.NEWSDESK_BIRTH_SINCE),
```

Then replace:

```ts
    // Kill switch for images only — a broken image pipeline must never stop the prose.
    imagesEnabled: p.NEWSDESK_IMAGES_ENABLED !== "false",
  };
}
```

with:

```ts
    // Kill switch for images only — a broken image pipeline must never stop the prose.
    imagesEnabled: p.NEWSDESK_IMAGES_ENABLED !== "false",
    // SAFE DEFAULT, INVERTED vs the image switch: the news pass is OPT-IN. It publishes permanent
    // indexed articles about people who are alive and did not ask to be covered, so the default
    // must be silence and only the exact string "true" may break it.
    newsEnabled: p.NEWSDESK_NEWS_ENABLED === "true",
    // SAFE DEFAULT: news pass off unless a valid ISO cutoff is provided.
    newsSince: parseSince(p.NEWSDESK_NEWS_SINCE),
    newsMaxPerTick: p.NEWSDESK_NEWS_MAX_PER_TICK,
    standingDeadHours: p.NEWSDESK_STANDING_DEAD_HOURS,
    standingDeadMinPlaytimeSeconds: p.NEWSDESK_STANDING_DEAD_MIN_PLAYTIME_SECONDS,
    standingDeadMinHits: p.NEWSDESK_STANDING_DEAD_MIN_HITS,
    newsSuppressedGamertags: parseGamertagList(p.NEWSDESK_NEWS_SUPPRESSED_GAMERTAGS),
    longFormWindowSeconds: p.NEWSDESK_LONGFORM_WINDOW_SECONDS,
    longFormRadiusMeters: p.NEWSDESK_LONGFORM_RADIUS_METERS,
    longFormMaxFixAgeSeconds: p.NEWSDESK_LONGFORM_MAX_FIX_AGE_SECONDS,
  };
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @onelife/newsdesk exec vitest run test/config.test.ts`
Expected: PASS (all tests in the file green).

- [ ] **Step 8: Document the vars in `.env.example`**

Replace:

```
# Images-only kill switch — set false to stop image generation without stopping articles.
NEWSDESK_IMAGES_ENABLED=true
```

with:

```
# Images-only kill switch — set false to stop image generation without stopping articles.
NEWSDESK_IMAGES_ENABLED=true

# News features (R5d) — the Standing Dead + Long Form vertical. OPT-IN, and off in two independent
# ways: it does nothing unless NEWSDESK_NEWS_ENABLED is exactly "true" AND NEWSDESK_NEWS_SINCE is a
# valid ISO-8601 go-live instant. Unlike the other passes the subjects here are ALIVE and did not
# ask to be covered, so the default is silence. Still gated by NEWSDESK_DRY_RUN as well.
# Go-live sequence: deploy with NEWSDESK_NEWS_ENABLED unset -> set it with NEWSDESK_DRY_RUN=true for
# one interval -> read the log and eyeball the selected subjects by hand -> set DRY_RUN=false.
NEWSDESK_NEWS_ENABLED=
NEWSDESK_NEWS_SINCE=
NEWSDESK_NEWS_MAX_PER_TICK=2
# Comma-separated subject opt-out (honoured on request; the dev account belongs here first).
NEWSDESK_NEWS_SUPPRESSED_GAMERTAGS=
# The Standing Dead: idle hours before a subject is eligible, the minimum playtime that makes a
# life worth reporting, and the absorbed-hit floor of the earned-coverage clause (a subject
# qualifies on EITHER a prior life OR this many hits — never on neither).
NEWSDESK_STANDING_DEAD_HOURS=72
NEWSDESK_STANDING_DEAD_MIN_PLAYTIME_SECONDS=1800
NEWSDESK_STANDING_DEAD_MIN_HITS=100
# The Long Form: two deaths join one clique only if EVERY pair is inside both thresholds. Do not
# widen these to make it fire more often — 300s/150m only admits dev-account noise.
NEWSDESK_LONGFORM_WINDOW_SECONDS=180
NEWSDESK_LONGFORM_RADIUS_METERS=100
# Discards a death whose last position fix is older than this — protection against stale fixes,
# since ten minutes of movement is roughly a kilometre against a 100 m radius.
NEWSDESK_LONGFORM_MAX_FIX_AGE_SECONDS=120
```

- [ ] **Step 9: Typecheck and commit**

Run: `pnpm --filter @onelife/newsdesk run typecheck`
Expected: no errors.

```bash
git add apps/newsdesk/src/config.ts apps/newsdesk/test/config.test.ts .env.example
git commit -m "feat(newsdesk): config surface for the R5d news pass (ships off)"
```

---

## Task 2: The typed news image-facts contract

The top latent risk carried from PR-C1. `NEWSROOM_CATEGORIES`' `eligible` predicates read key names off an untyped `FactsSnapshot = Record<string, unknown>`, pinned only by a comment and a hand-built fixture. A mismatch between what `news-facts.ts` writes and what those predicates read **fails closed and silent** — the gate never fires, the imagery is quietly impoverished, and nothing errors. This task makes the drift a **compile error in both directions**:

- `NewsImageFacts` is declared here as a **type alias** (not an interface — an interface has no implicit index signature and would not assign to `FactsSnapshot`, the trap `PublishBirthFacts` already documents).
- The predicates read through a typed `news()` accessor, so **renaming a field in `NewsImageFacts` breaks the predicate at compile time**.
- Task 3 declares `NewsFacts = NewsImageFacts & {…}`, so **a builder that stops emitting a field breaks at compile time**.
- The existing test fixtures are re-typed as `NewsImageFacts`, so a fixture that drifts from the contract breaks at compile time.

**Files:**
- Modify: `apps/newsdesk/src/image-categories.ts`
- Modify: `apps/newsdesk/test/image-categories.test.ts`
- Modify: `apps/newsdesk/test/image-scene.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export type NewsImageFacts` — consumed by Task 3 (`NewsFacts`) and Task 11.

**Both news fixture files are re-typed, not just one.** `image-scene.test.ts` holds a *second*
untyped news facts literal, and because Task 5's `news()` accessor is a cast, that file would keep
compiling and keep passing with a drifted fixture — so the compile-time guard this task is for
would hold for exactly one of the two fixture files, and the cut `lastExpressiveEmote` slot would
survive in the repo.

- [ ] **Step 1: Write the failing test**

In `apps/newsdesk/test/image-categories.test.ts`, replace this import:

```ts
import type { ArticleKind } from "../src/image-categories.js";
```

with:

```ts
import type { ArticleKind, NewsImageFacts } from "../src/image-categories.js";
```

and replace the two fixtures at the top of the `describe("newsroom menu", …)` block:

```ts
  const standing = { trigger: "standing_dead", map: "chernarusplus", idleHours: 96,
    timeAliveSeconds: 5400, hitsAbsorbed: 12, lifeNumber: 3, priors: { livesLived: 2, totalKills: 4 },
    subjectCount: 1, allFreshSubjects: false, lastExpressiveEmote: null };
  const longform = { trigger: "long_form", map: "sakhal", idleHours: 0, timeAliveSeconds: 0,
    hitsAbsorbed: 0, lifeNumber: 1, priors: { livesLived: 0, totalKills: 0 },
    subjectCount: 2, allFreshSubjects: true, lastExpressiveEmote: null };
```

with:

```ts
  // Typed against the published contract, NOT a loose literal: if news-facts.ts renames a field,
  // NewsImageFacts changes, and this fixture stops compiling. `lastExpressiveEmote` is gone —
  // the emote slot was cut (no allowlist signal, and reading it means querying events.payload,
  // the column that also holds coordinates).
  const standing: NewsImageFacts = { trigger: "standing_dead", map: "chernarusplus", idleHours: 96,
    timeAliveSeconds: 5400, hitsAbsorbed: 12, lifeNumber: 3, priors: { livesLived: 2, totalKills: 4 },
    subjectCount: 1, allFreshSubjects: false };
  const longform: NewsImageFacts = { trigger: "long_form", map: "sakhal", idleHours: null,
    timeAliveSeconds: 0, hitsAbsorbed: 0, lifeNumber: 1, priors: { livesLived: 0, totalKills: 0 },
    subjectCount: 2, allFreshSubjects: true };
```

Then append a new test inside that same `describe("newsroom menu", …)` block, immediately before its closing `});`:

```ts
  it("carries no emote-shaped key in the facts contract (spec §11: EmoteSuicide never reaches a payload)", () => {
    // TYPE-ANCHORED, not behavioural: these are fixtures declared in this file, so the real guard
    // is the `NewsImageFacts` annotation above (a compile-time check). The behavioural rail is
    // Task 11's keysDeep walk over a BUILT NewsFacts object — do not read this as coverage of it.
    expect(Object.keys(standing).some((k) => /emote/i.test(k))).toBe(false);
    expect(Object.keys(longform).some((k) => /emote/i.test(k))).toBe(false);
  });

  it("a null idleHours never trips the long-idle framing", () => {
    expect(newsSlugs(longform)).not.toContain("long-idle");
    expect(newsSlugs({ ...standing, idleHours: 119 })).not.toContain("long-idle");
    expect(newsSlugs({ ...standing, idleHours: 120 })).toContain("long-idle");
  });
```

Then re-type the **second** news fixture, in `apps/newsdesk/test/image-scene.test.ts`. Replace this
import:

```ts
import type { ArticleKind } from "../src/image-categories.js";
```

with:

```ts
import type { ArticleKind, NewsImageFacts } from "../src/image-categories.js";
```

and replace the fixture:

```ts
  const facts = { trigger: "standing_dead", map: "chernarusplus", idleHours: 140,
    timeAliveSeconds: 9200, hitsAbsorbed: 140, lifeNumber: 4,
    priors: { livesLived: 3, totalKills: 6 }, subjectCount: 1, allFreshSubjects: false,
    lastExpressiveEmote: "EmoteGreeting" };
```

with:

```ts
  // The other half of the compile-time guard. Untyped, this literal would keep compiling and keep
  // passing against a drifted contract, and the cut emote slot would survive here in the repo.
  const facts: NewsImageFacts = { trigger: "standing_dead", map: "chernarusplus", idleHours: 140,
    timeAliveSeconds: 9200, hitsAbsorbed: 140, lifeNumber: 4,
    priors: { livesLived: 3, totalKills: 6 }, subjectCount: 1, allFreshSubjects: false };
```

and replace the `lede` on the line below it:

```ts
      lede: "He logged off and the server kept going without him.", eligible, recent: [] });
```

with:

```ts
      // "logged off" is one of the four framings FORBIDDEN_FRAMING_DIRECTIVE bans by name; a
      // fixture must not model the thing the desk forbids.
      lede: "The record simply stops.", eligible, recent: [] });
```

The three gate assertions in that file are unaffected: `long-idle` still fires at 140 idle hours,
`the-regular` at 3 prior lives, and `what-it-took` at 140 absorbed hits.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/newsdesk exec vitest run test/image-categories.test.ts test/image-scene.test.ts`
Expected: FAIL — `Module '"../src/image-categories.js"' has no exported member 'NewsImageFacts'`.

- [ ] **Step 3: Declare the contract and the typed accessor**

In `apps/newsdesk/src/image-categories.ts`, replace:

```ts
export type ArticleKind = "obituary" | "birth_notice" | "news";
export type FactsSnapshot = Record<string, unknown>;
```

with:

```ts
export type ArticleKind = "obituary" | "birth_notice" | "news";
export type FactsSnapshot = Record<string, unknown>;

/**
 * The exact fact vocabulary the NEWSROOM gates below read, published as a type so the two sides
 * cannot drift. `news-facts.ts` declares `NewsFacts = NewsImageFacts & {…}`, so a builder that
 * stops emitting one of these fields is a COMPILE error; the `news()` accessor below means a
 * rename here is a compile error in the predicates too.
 *
 * Why this exists: these predicates used to read bare keys off an untyped Record. A mismatch
 * between what the facts builder writes and what a gate reads fails CLOSED and SILENT — the gate
 * simply never fires, the imagery is quietly impoverished, and nothing errors.
 *
 * A `type`, deliberately not an `interface`: an interface has no implicit index signature and so
 * does not assign to `FactsSnapshot`, which would make every typed fixture fail to compile at the
 * call site (the trap `PublishBirthFacts` in birth-pg-store.ts already documents).
 */
export type NewsImageFacts = {
  trigger: "standing_dead" | "long_form";
  map: string;                      // servers.map codename, e.g. "sakhal"
  idleHours: number | null;         // Standing Dead only; null for a Long Form cluster
  timeAliveSeconds: number;         // PLAYTIME of the primary subject — never wall clock
  hitsAbsorbed: number;             // Standing Dead endurance signal; 0 for a Long Form cluster
  lifeNumber: number;               // primary subject's per-map life number
  priors: { livesLived: number; totalKills: number };
  subjectCount: number;
  allFreshSubjects: boolean;
};

/** Typed view of the untyped snapshot for the NEWSROOM gates. `Partial` because the value really
 *  is a jsonb blob at runtime and a legacy or half-written row may be missing anything; the point
 *  of the cast is the COMPILE-time key check, not a runtime guarantee — every read below still
 *  defends itself with `??` or `n()`. */
const news = (f: FactsSnapshot) => f as unknown as Partial<NewsImageFacts>;
```

- [ ] **Step 4: Correct the menu doc comment**

Replace:

```ts
// The Newsroom menu (R5d). The facts vocabulary these gates read — and which newsTick MUST
// freeze into articles.facts, or every gate silently fails closed:
//   trigger: "standing_dead" | "long_form"   map: string   idleHours: number
//   timeAliveSeconds: number   hitsAbsorbed: number   lifeNumber: number
//   priors: { livesLived?, totalKills? }     subjectCount: number
//   allFreshSubjects: boolean                lastExpressiveEmote: string | null
//
// These key names are the exact ones the C2 facts builders emit — `timeAliveSeconds`, not
// `playtimeSeconds`; `lastExpressiveEmote`, not `lastEmote`. No shipped gate reads either of
// those two, so a mismatch would not fail a test — it would just mislead the next gate author.
```

with:

```ts
// The Newsroom menu (R5d). The facts vocabulary these gates read is the NewsImageFacts type
// above — not a comment. Every gate reads it through the typed `news()` accessor, so a rename on
// either side is a compile error rather than a gate that silently stops firing.
//
// `lastExpressiveEmote` is NOT part of the contract: the expressive-emote allowlist covers ~49
// events corpus-wide (no signal), and reaching it means querying events.payload — the same column
// that holds 5,633 coordinate rows the Fog Rule exists to keep off this boundary.
```

- [ ] **Step 5: Route all 13 predicates through the typed accessor**

Within `NEWSROOM_CATEGORIES`, replace each predicate exactly as follows (the comments above each entry are unchanged; only the `eligible:` lines move):

| Replace | With |
|---|---|
| `eligible: (f) => f.trigger === "standing_dead" },` *(both occurrences — `unattended-camp` and `unslept-bedroll`)* | `eligible: (f) => news(f).trigger === "standing_dead" },` |
| `eligible: (f) => (priors(f).livesLived ?? 0) >= 1 },` *(`the-regular`)* | `eligible: (f) => (news(f).priors?.livesLived ?? 0) >= 1 },` |
| `eligible: (f) => (n(f.hitsAbsorbed) ?? 0) >= 100 },` *(`what-it-took`)* | `eligible: (f) => (n(news(f).hitsAbsorbed) ?? 0) >= 100 },` |
| `eligible: (f) => (n(f.idleHours) ?? 0) >= 120 },` *(`long-idle`)* | `eligible: (f) => (n(news(f).idleHours) ?? 0) >= 120 },` |
| `eligible: (f) => f.trigger === "long_form" },` *(`two-sets-of-tracks`)* | `eligible: (f) => news(f).trigger === "long_form" },` |
| `eligible: (f) => f.trigger === "long_form" && (n(f.subjectCount) ?? 0) >= 2 },` *(`same-minute`)* | `eligible: (f) => news(f).trigger === "long_form" && (n(news(f).subjectCount) ?? 0) >= 2 },` |
| `eligible: (f) => f.trigger === "long_form" && f.allFreshSubjects === true },` *(`the-world-did-this`)* | `eligible: (f) => news(f).trigger === "long_form" && news(f).allFreshSubjects === true },` |
The eighth predicate, `conditions-noted`, needs a **multi-line** anchor and must not be done from
the table above: the line `    eligible: (f) => f.map === "sakhal" },` occurs **verbatim twice** in
this file — once in `NURSERY_CATEGORIES` (`adverse-conditions`) and once in `NEWSROOM_CATEGORIES`
(`conditions-noted`). A `replace_all` would silently rewrite the Nursery gate to
`news(f).map === "sakhal"` and **still pass every existing test**, because the birth fixture also
carries `map`. So anchor on the unique comment above it. Replace:

```ts
    // Weather framing is honest for Sakhal and nowhere else — this is the one map cue the Fog
    // Rule permits, because the map is already in the dateline.
    eligible: (f) => f.map === "sakhal" },
```

with:

```ts
    // Weather framing is honest for Sakhal and nowhere else — this is the one map cue the Fog
    // Rule permits, because the map is already in the dateline.
    eligible: (f) => news(f).map === "sakhal" },
```

The four ungated Newsroom entries (`no-forwarding-address`, `last-transmission`, `still-listed`, `the-desk-has-questions`) keep `eligible: () => true`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @onelife/newsdesk exec vitest run test/image-categories.test.ts test/image-scene.test.ts`
Expected: PASS (all tests in both files green). `n(null)` returns `null`, so the `long-idle` gate is correctly dark for a Long Form cluster.

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm --filter @onelife/newsdesk run typecheck`
Expected: no errors.

```bash
git add apps/newsdesk/src/image-categories.ts apps/newsdesk/test/image-categories.test.ts apps/newsdesk/test/image-scene.test.ts
git commit -m "refactor(newsdesk): make the news image-facts contract a compile-checked type"
```

---

## Task 3: `news-facts.ts` — the fact snapshot for both triggers

The highest-risk file in the PR. Everything it returns is frozen verbatim into `articles.facts` at
publish and is **forward-only** — a field that is wrong or missing here is wrong forever for every
article published before it is fixed. Three rails converge on this file: no coordinate, no row id,
never wall-clock as survival time.

**Files:**
- Create: `apps/newsdesk/src/news-facts.ts`
- Test: `apps/newsdesk/test/news-facts.test.ts`

**Interfaces:**
- Consumes: `NewsImageFacts` (Task 2); `StandingDeadTarget` and `standingDeadNaturalKey` from `./standing-dead-targets.js`; `LongFormCluster` / `LongFormSubject` from `./long-form-cluster.js`; `LifeTimeline` / `PlayerPriors` from `@onelife/read-models`; `timeAliveLabel` from `./facts.js`.
- Produces:
  - `export type NewsSubject`
  - `export type NewsFacts = NewsImageFacts & {…}`
  - `export function buildStandingDeadFacts(target: StandingDeadTarget, timeline: LifeTimeline, priors: PlayerPriors): NewsFacts`
  - `export function buildLongFormFacts(cluster: LongFormCluster, per: Map<string, { timeline: LifeTimeline; priors: PlayerPriors }>): NewsFacts`

  Tasks 5, 6, 9 and 11 all consume these exact names.

- [ ] **Step 1: Write the failing test**

Create `apps/newsdesk/test/news-facts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { PlayerPriors, LifeTimeline } from "@onelife/read-models";
import { buildStandingDeadFacts, buildLongFormFacts } from "../src/news-facts.js";
import type { StandingDeadTarget } from "../src/standing-dead-targets.js";
import { buildLongFormClusters } from "../src/long-form-cluster.js";
import type { DeathCandidate } from "../src/long-form-cluster.js";

const priors = (over: Partial<PlayerPriors> = {}): PlayerPriors => ({
  livesLived: 0, longestLifeSeconds: 0, totalKills: 0,
  usualDeathCause: null, lastDeathCause: null, bestLifeMap: null, ...over,
});

/** Minimal LifeTimeline. Cast, matching birth-facts.test.ts: the real type is derived from
 *  getLifeDetail's return and is impractical to build by hand in a pure unit test. */
function timeline(over: Partial<{ playtimeSeconds: number; kills: unknown[]; sessions: unknown[]; character: unknown }> = {}) {
  return {
    life: {
      startedAt: new Date("2026-07-11T00:00:00Z"),
      endedAt: null,
      playtimeSeconds: "playtimeSeconds" in over ? over.playtimeSeconds : 5600,
      deathCause: null,
    },
    sessions: over.sessions ?? [{}, {}],
    kills: over.kills ?? [],
    character: "character" in over ? over.character : { name: "Lewis" },
    qualifiedAt: null, verdict: null, ordeals: null, hpLow: null,
  } as unknown as LifeTimeline;
}

const sdTarget: StandingDeadTarget = {
  lifeId: 4242, serverId: 7, gamertag: "GabeFox101",
  map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 3,
  lifeStartedAt: new Date("2026-07-11T00:00:00Z"), playtimeSeconds: 5600,
  lastSeenAt: new Date("2026-07-14T00:00:00Z"),
  eligibleAt: new Date("2026-07-17T00:00:00Z"),
  idleSeconds: 4 * 86_400,   // 96h
  priorLives: 2, hitsAbsorbed: 137,
  naturalKey: "standing_dead:7:GabeFox101:2026-07-11T00:00:00.000Z",
};

describe("buildStandingDeadFacts", () => {
  it("carries the trigger, the natural key, and a single subject", () => {
    const f = buildStandingDeadFacts(sdTarget, timeline(), priors({ livesLived: 2, totalKills: 4 }));
    expect(f.trigger).toBe("standing_dead");
    expect(f.naturalKey).toBe("standing_dead:7:GabeFox101:2026-07-11T00:00:00.000Z");
    expect(f.primaryGamertag).toBe("GabeFox101");
    expect(f.subjectCount).toBe(1);
    expect(f.subjects).toHaveLength(1);
    expect(f.subjects[0]!.gamertag).toBe("GabeFox101");
    expect(f.subjects[0]!.persona).toBe("Lewis");
    expect(f.subjects[0]!.sessions).toBe(2);
    expect(f.serverId).toBe(7);
    expect(f.map).toBe("chernarusplus");
    expect(f.mapSlug).toBe("chernarus");
  });

  it("reports PLAYTIME as survival time, never the wall clock", () => {
    // The life started 2026-07-11 and was last seen 2026-07-14 — three wall-clock days — on
    // 5600 seconds of actual play. Publishing the calendar gap as endurance would be a lie.
    const f = buildStandingDeadFacts(sdTarget, timeline({ playtimeSeconds: 5600 }), priors());
    expect(f.timeAliveSeconds).toBe(5600);
    expect(f.subjects[0]!.timeAliveSeconds).toBe(5600);
    expect(f.subjects[0]!.timeAliveLabel).toBe("1h 33m");
    const blob = JSON.stringify(f);
    expect(blob).not.toContain("259200");  // 3 days of wall clock, in seconds
    // NOTE: do NOT also assert the absence of 345600. `idleSeconds` is a REQUIRED field (spec
    // §4.1.4 — the idle duration, labelled honestly as idle time), the very next test asserts it,
    // and Task 11's rail asserts it on a built object. Banning its value here would push an
    // implementer to delete the field to make this pass.
    expect(f.timeAliveSeconds).not.toBe(f.idleSeconds);
  });

  it("keeps idle time as its own field, in hours and seconds", () => {
    const f = buildStandingDeadFacts(sdTarget, timeline(), priors());
    expect(f.idleSeconds).toBe(345_600);
    expect(f.idleHours).toBe(96);
    expect(f.lastSeenAt).toBe("2026-07-14T00:00:00.000Z");
    expect(f.eligibleAt).toBe("2026-07-17T00:00:00.000Z");
  });

  it("passes the earned-coverage evidence through for the image gates", () => {
    const f = buildStandingDeadFacts(sdTarget, timeline(), priors({ livesLived: 2, totalKills: 4 }));
    expect(f.hitsAbsorbed).toBe(137);
    expect(f.priors.livesLived).toBe(2);
    expect(f.lifeNumber).toBe(3);
  });

  it("marks a first-life, zero-kill subject fresh and a veteran not", () => {
    expect(buildStandingDeadFacts(sdTarget, timeline(), priors()).allFreshSubjects).toBe(true);
    expect(buildStandingDeadFacts(sdTarget, timeline({ kills: [{}] }), priors()).allFreshSubjects).toBe(false);
    expect(buildStandingDeadFacts(sdTarget, timeline(), priors({ livesLived: 1 })).allFreshSubjects).toBe(false);
    expect(buildStandingDeadFacts(sdTarget, timeline(), priors({ totalKills: 1 })).allFreshSubjects).toBe(false);
  });

  it("leaves the Long Form fields null", () => {
    const f = buildStandingDeadFacts(sdTarget, timeline(), priors());
    expect(f.earliestDeathAt).toBeNull();
    expect(f.spanSeconds).toBeNull();
    expect(f.subjects[0]!.endedAt).toBeNull();
  });
});

// Real coordinate-bearing candidates, run through the real clique builder — the source rows DO
// carry x/y, exactly as the §11 rail requires.
const cand = (over: Partial<DeathCandidate>): DeathCandidate => ({
  lifeId: 1, serverId: 7, gamertag: "A", map: "chernarusplus", mapSlug: "chernarus",
  lifeNumber: 1, lifeStartedAt: new Date("2026-07-11T00:00:00Z"),
  endedAt: new Date("2026-07-11T01:00:00Z"), deathCause: "infected",
  x: 7423.51, y: 9210.88, fixAt: new Date("2026-07-11T01:00:00Z"), ...over,
});

function longFormFixture() {
  const a = cand({ lifeId: 11, gamertag: "CUPID18", endedAt: new Date("2026-07-11T01:00:00Z"), x: 7423.51, y: 9210.88 });
  const b = cand({ lifeId: 12, gamertag: "GabeFox101", endedAt: new Date("2026-07-11T01:00:27Z"), x: 7443.19, y: 9245.02, deathCause: "died" });
  const [cluster] = buildLongFormClusters([a, b], { windowSeconds: 180, radiusMeters: 100 });
  const per = new Map([
    ["CUPID18", { timeline: timeline({ playtimeSeconds: 6660 }), priors: priors() }],
    ["GabeFox101", { timeline: timeline({ playtimeSeconds: 6700 }), priors: priors() }],
  ]);
  return { cluster: cluster!, per };
}

describe("buildLongFormFacts", () => {
  it("carries every subject, the cluster key, and the primary", () => {
    const { cluster, per } = longFormFixture();
    const f = buildLongFormFacts(cluster, per);
    expect(f.trigger).toBe("long_form");
    expect(f.subjectCount).toBe(2);
    expect(f.subjects.map((s) => s.gamertag)).toEqual(["CUPID18", "GabeFox101"]);
    expect(f.primaryGamertag).toBe("CUPID18");  // earliest ended_at
    expect(f.naturalKey).toBe(cluster.naturalKey);
    expect(f.earliestDeathAt).toBe("2026-07-11T01:00:00.000Z");
  });

  it("reports the gap between deaths in SECONDS and never a distance", () => {
    const { cluster, per } = longFormFixture();
    const f = buildLongFormFacts(cluster, per);
    expect(f.spanSeconds).toBe(27);
    expect(JSON.stringify(f)).not.toMatch(/\d{4}\.\d/);
  });

  it("flags a cluster of first-lifers, and drops the flag when one has a record", () => {
    const { cluster, per } = longFormFixture();
    expect(buildLongFormFacts(cluster, per).allFreshSubjects).toBe(true);
    per.set("GabeFox101", { timeline: timeline({ playtimeSeconds: 6700 }), priors: priors({ livesLived: 3 }) });
    expect(buildLongFormFacts(cluster, per).allFreshSubjects).toBe(false);
  });

  it("carries no absorbed-hit count — that is a Standing Dead signal only", () => {
    const { cluster, per } = longFormFixture();
    expect(buildLongFormFacts(cluster, per).hitsAbsorbed).toBe(0);
    expect(buildLongFormFacts(cluster, per).idleHours).toBeNull();
    expect(buildLongFormFacts(cluster, per).idleSeconds).toBeNull();
  });

  it("throws rather than publish a cluster with a missing subject timeline", () => {
    const { cluster, per } = longFormFixture();
    per.delete("GabeFox101");
    expect(() => buildLongFormFacts(cluster, per)).toThrow(/GabeFox101/);
  });

  it("preserves each subject's own death cause and end instant", () => {
    const { cluster, per } = longFormFixture();
    const f = buildLongFormFacts(cluster, per);
    const gabe = f.subjects.find((s) => s.gamertag === "GabeFox101")!;
    expect(gabe.deathCause).toBe("died");
    expect(gabe.endedAt).toBe("2026-07-11T01:00:27.000Z");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/newsdesk exec vitest run test/news-facts.test.ts`
Expected: FAIL — `Failed to resolve import "../src/news-facts.js"`.

- [ ] **Step 3: Write the implementation**

Create `apps/newsdesk/src/news-facts.ts`:

```ts
import type { LifeTimeline, PlayerPriors } from "@onelife/read-models";
import type { NewsImageFacts } from "./image-categories.js";
import type { StandingDeadTarget } from "./standing-dead-targets.js";
import type { LongFormCluster } from "./long-form-cluster.js";
import { timeAliveLabel } from "./facts.js";

/**
 * One person in a news feature. Shaped to match the eventual `article_subjects` child table
 * (spec §6), so normalising it later is a pure jsonb backfill rather than a re-derivation.
 *
 * THREE RAILS ARE STRUCTURAL HERE, not stylistic:
 *  1. NO ROW IDS. `lives.id` / `players.id` do not survive a projector rebuild, and `articles` is
 *     durable — a persisted id is a dangling pointer the moment anyone runs `deploy.sh --rebuild`.
 *     `lifeId` is carried on the TARGET types purely to load a timeline inside the tick, and it
 *     stops there.
 *  2. NO COORDINATES. `DeathCandidate` carries x/y; `LongFormSubject` and `StandingDeadTarget`
 *     already do not, and nothing below re-derives a position, a landmark, a route, or a distance
 *     between two fixes. A Standing Dead subject is ALIVE and can be hunted.
 *  3. TIME ALIVE IS PLAYTIME. `playtime_seconds`, never `endedAt - startedAt` and never
 *     `now - startedAt`. The current wall-clock leader in production has 1.56 hours of play across
 *     7.14 days; printing that as endurance would be the paper's first outright lie.
 */
export type NewsSubject = {
  gamertag: string;                // verbatim as stored in `players` — never lowercased
  map: string;
  mapSlug: string | null;
  lifeNumber: number;
  lifeStartedAt: string;           // ISO, UTC, ms precision
  endedAt: string | null;          // ISO; null for a Standing Dead subject (the life is open)
  timeAliveSeconds: number;        // playtime_seconds — see rail 3
  timeAliveLabel: string;
  kills: number;
  sessions: number;
  persona: string | null;
  deathCause: string | null;       // null for a Standing Dead subject
  priors: PlayerPriors;
  isKnownQuantity: boolean;        // priors.livesLived > 0
  isFresh: boolean;                // first life anywhere, and has never killed anyone
};

/**
 * The frozen snapshot behind one news article — the whole of `articles.facts`.
 *
 * It INTERSECTS NewsImageFacts on purpose: that type is the vocabulary the NEWSROOM image gates
 * read, so a builder below that stops emitting one of those fields is a compile error rather than
 * a gate that silently stops firing (spec §7, PR-C1 ledger item 2).
 */
export type NewsFacts = NewsImageFacts & {
  naturalKey: string;              // the article's identity; produced ONLY by toISOString() in TS
  serverId: number;                // `servers` is durable and is NOT truncated by a rebuild
  mapSlug: string | null;
  primaryGamertag: string;
  subjects: NewsSubject[];         // includes the primary; Long Form order is gamertag ascending
  priors: PlayerPriors;            // the primary's — widened from NewsImageFacts' two-field view
  // ── The Standing Dead only ──
  lastSeenAt: string | null;
  eligibleAt: string | null;
  idleSeconds: number | null;
  // ── The Long Form only ──
  earliestDeathAt: string | null;
  spanSeconds: number | null;      // first death to last death. TIME only — never a distance.
};

function buildNewsSubject(args: {
  gamertag: string; map: string; mapSlug: string | null; lifeNumber: number;
  lifeStartedAt: Date; endedAt: Date | null; deathCause: string | null;
  timeline: LifeTimeline; priors: PlayerPriors;
}): NewsSubject {
  const kills = args.timeline.kills.length;
  const timeAliveSeconds = args.timeline.life.playtimeSeconds ?? 0;
  return {
    gamertag: args.gamertag,
    map: args.map,
    mapSlug: args.mapSlug,
    lifeNumber: args.lifeNumber,
    lifeStartedAt: args.lifeStartedAt.toISOString(),
    endedAt: args.endedAt ? args.endedAt.toISOString() : null,
    timeAliveSeconds,
    timeAliveLabel: timeAliveLabel(timeAliveSeconds),
    kills,
    sessions: args.timeline.sessions.length,
    persona: args.timeline.character?.name ?? null,
    deathCause: args.deathCause,
    priors: args.priors,
    isKnownQuantity: args.priors.livesLived > 0,
    // The protected class of spec §4.2: a first life anywhere, and never a kill. Both arms of the
    // priors test are needed — a player with prior lives is not fresh even at zero kills.
    isFresh: args.priors.livesLived === 0 && args.priors.totalKills === 0 && kills === 0,
  };
}

/** The Standing Dead snapshot: one open, qualified life whose owner has gone quiet. */
export function buildStandingDeadFacts(
  target: StandingDeadTarget,
  timeline: LifeTimeline,
  priors: PlayerPriors,
): NewsFacts {
  const subject = buildNewsSubject({
    gamertag: target.gamertag, map: target.map, mapSlug: target.mapSlug,
    lifeNumber: target.lifeNumber, lifeStartedAt: target.lifeStartedAt,
    // The life is OPEN. There is no death here and there must never be one implied.
    endedAt: null, deathCause: null, timeline, priors,
  });
  return {
    trigger: "standing_dead",
    map: target.map,
    mapSlug: target.mapSlug,
    serverId: target.serverId,
    naturalKey: target.naturalKey,
    primaryGamertag: target.gamertag,
    subjects: [subject],
    subjectCount: 1,
    lifeNumber: target.lifeNumber,
    timeAliveSeconds: subject.timeAliveSeconds,
    hitsAbsorbed: target.hitsAbsorbed,
    // Idle time is its OWN field and is labelled as such everywhere downstream. It is the length
    // of an absence, not the length of a life, and the prompt is told so in as many words.
    idleSeconds: target.idleSeconds,
    idleHours: Math.floor(target.idleSeconds / 3600),
    lastSeenAt: target.lastSeenAt.toISOString(),
    eligibleAt: target.eligibleAt.toISOString(),
    priors,
    allFreshSubjects: subject.isFresh,
    earliestDeathAt: null,
    spanSeconds: null,
  };
}

/**
 * The Long Form snapshot: a clique of qualified deaths. `per` is keyed by gamertag, which is safe
 * because `applyLongFormExclusions` has already discarded any cluster with a repeated gamertag
 * (a self-cluster is one player's rerolls, not a shared fate).
 */
export function buildLongFormFacts(
  cluster: LongFormCluster,
  per: Map<string, { timeline: LifeTimeline; priors: PlayerPriors }>,
): NewsFacts {
  const subjects = cluster.subjects.map((s) => {
    const got = per.get(s.gamertag);
    // Throwing beats publishing a feature that silently omits one of the people in it.
    if (!got) throw new Error(`long form: no timeline for subject ${s.gamertag}`);
    return buildNewsSubject({
      gamertag: s.gamertag, map: s.map, mapSlug: s.mapSlug, lifeNumber: s.lifeNumber,
      lifeStartedAt: s.lifeStartedAt, endedAt: s.endedAt, deathCause: s.deathCause,
      timeline: got.timeline, priors: got.priors,
    });
  });
  const primary = subjects.find((s) => s.gamertag === cluster.primary.gamertag);
  if (!primary) throw new Error(`long form: primary ${cluster.primary.gamertag} missing from subjects`);
  const ends = cluster.subjects.map((s) => s.endedAt.getTime());

  return {
    trigger: "long_form",
    map: cluster.map,
    mapSlug: cluster.mapSlug,
    serverId: cluster.serverId,
    naturalKey: cluster.naturalKey,
    primaryGamertag: cluster.primary.gamertag,
    subjects,
    subjectCount: subjects.length,
    lifeNumber: primary.lifeNumber,
    timeAliveSeconds: primary.timeAliveSeconds,
    // Absorbed hits are a Standing Dead endurance signal and are not queried for a death cluster.
    // The `what-it-took` image framing therefore never fires on a Long Form piece — intended.
    hitsAbsorbed: 0,
    idleSeconds: null,
    idleHours: null,
    lastSeenAt: null,
    eligibleAt: null,
    priors: primary.priors,
    // Spec §4.2's tone branch: when EVERY subject is a first-life, zero-kill player the story is
    // about the world, never about the two men's competence.
    allFreshSubjects: subjects.every((s) => s.isFresh),
    earliestDeathAt: cluster.earliestDeathAt.toISOString(),
    // Seconds between the first and the last death. The DISTANCE between the two fixes is what
    // made this a cluster, and it never leaves long-form-cluster.ts (spec §4.1.4, §11).
    spanSeconds: Math.round((Math.max(...ends) - Math.min(...ends)) / 1000),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @onelife/newsdesk exec vitest run test/news-facts.test.ts`
Expected: PASS (all tests in the file green).

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @onelife/newsdesk run typecheck`
Expected: no errors. (If `NewsFacts` were missing a `NewsImageFacts` field, this is where it fails.)

```bash
git add apps/newsdesk/src/news-facts.ts apps/newsdesk/test/news-facts.test.ts
git commit -m "feat(newsdesk): NewsFacts snapshot builders for both news triggers"
```

---

## Task 4: `news-voice.ts` — the Newsroom register

Vendored from `../brand/brand-bible.md` §6 (Voice & Tone) the same way `birth-voice.ts` vendored the
Nursery register: rewritten into the file's own prose register, **not** pasted as a markdown table.
Three TONE-map rows are load-bearing and were added to the bible for this slice:

- *The Standing Dead* — "Elegiac, baffled, warm — a eulogy with no death in it. Never mocks the leaving, never guesses where they went. 'He is still standing somewhere. We don't say where.'"
- *The Long Form (fresh subjects)* — "**Reverent** — protected class, so the sneer is fully off and the needle never comes. Tell the parallel straight; the story is the world that did this, never their competence."
- *The Long Form (any subject geared)* — "Cold forensic mock-epic — the shared ending gets the full autopsy, and nobody leaves it looking good."

**Files:**
- Create: `apps/newsdesk/src/news-voice.ts`
- Test: `apps/newsdesk/test/news-voice.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export const NEWS_SYSTEM: string`. Task 5 uses it as the system message.

- [ ] **Step 1: Write the failing test**

Create `apps/newsdesk/test/news-voice.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { NEWS_SYSTEM } from "../src/news-voice.js";

describe("NEWS_SYSTEM — the vendored brand tone rows", () => {
  it("carries the Standing Dead row: elegiac, baffled, warm; never dismissive of a departure", () => {
    expect(NEWS_SYSTEM).toMatch(/elegiac/i);
    expect(NEWS_SYSTEM).toMatch(/baffled/i);
    expect(NEWS_SYSTEM).toMatch(/a eulogy with no death in it/i);
    expect(NEWS_SYSTEM).toMatch(/still standing somewhere/i);
  });

  it("carries both Long Form rows and keeps them opposite", () => {
    expect(NEWS_SYSTEM).toMatch(/reverent/i);
    expect(NEWS_SYSTEM).toMatch(/the sneer is fully off/i);
    expect(NEWS_SYSTEM).toMatch(/cold forensic mock-epic/i);
    expect(NEWS_SYSTEM).toMatch(/nobody leaves it looking good/i);
  });
});

describe("NEWS_SYSTEM — hard rails", () => {
  it("bans the four forbidden real-player framings by name", () => {
    for (const token of ["the player", "logged off", "stopped playing", "lost interest"]) {
      expect(NEWS_SYSTEM.toLowerCase()).toContain(token);
    }
    expect(NEWS_SYSTEM).toMatch(/second person/i);
  });

  it("states the Fog Rule in its stricter, living-subject form", () => {
    expect(NEWS_SYSTEM).toMatch(/FOG RULE/);
    expect(NEWS_SYSTEM).toMatch(/coordinates/i);
    expect(NEWS_SYSTEM).toMatch(/route/i);
    expect(NEWS_SYSTEM).toMatch(/distance between/i);
  });

  it("declares the block output contract and never asks for a minimum length", () => {
    expect(NEWS_SYSTEM).toContain('"blocks"');
    for (const t of ["para", "subhead", "quote", "list"]) expect(NEWS_SYSTEM).toContain(`"${t}"`);
    // §5: length is FUNDED by fact density, never requested as a floor. A "at least N words"
    // instruction is a padding instruction and would also burn an attempt on a thin cluster.
    expect(NEWS_SYSTEM).not.toMatch(/at least \d+ words/i);
    expect(NEWS_SYSTEM).not.toMatch(/minimum of \d+ words/i);
    expect(NEWS_SYSTEM).not.toMatch(/no fewer than/i);
  });

  it("does not author `body` — the paragraphs are derived from the blocks", () => {
    expect(NEWS_SYSTEM).not.toContain('"body"');
  });

  it("plants no reusable stock phrase for the pull-quote attribution", () => {
    // §10 defect 5: 89 of 123 birth notices reused a byte-identical attribution because the
    // string appeared as an EXAMPLE in the system prompt. This desk ships with no examples.
    expect(NEWS_SYSTEM).not.toMatch(/a voice on the coast/i);
    expect(NEWS_SYSTEM).not.toMatch(/a rival/i);
    expect(NEWS_SYSTEM).toMatch(/never reuse an attribution/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/newsdesk exec vitest run test/news-voice.test.ts`
Expected: FAIL — `Failed to resolve import "../src/news-voice.js"`.

- [ ] **Step 3: Write the implementation**

Create `apps/newsdesk/src/news-voice.ts`:

```ts
/**
 * The One Life news-desk voice — "The Newsroom," the features vertical alongside the Obituaries'
 * Morgue and the Nursery's arrivals. Distilled from ../brand/brand-bible.md §6 (Voice & Tone),
 * including the three TONE-map rows added for this vertical: The Standing Dead, The Long Form
 * (fresh subjects), and The Long Form (any subject geared).
 *
 * The Newsroom differs from both sibling desks in one way that governs everything else: its
 * subjects did not die on cue and did not ask to be covered. A Standing Dead subject is ALIVE,
 * has usually never visited the site, and can falsify the article simply by playing again. The
 * governing rule above all: report the absence, never explain the person.
 *
 * NOTE ON EXAMPLES: this file deliberately contains NO example attributions, headlines, or
 * openings. 89 of 123 birth notices reused one byte-identical attribution because that string sat
 * in birth-voice.ts as an illustration. The register is described; nothing is demonstrated.
 */
export const NEWS_SYSTEM = `You write features for The Newsroom — One Life's news desk, the paper of record for a hardcore permadeath DayZ world where everyone dies exactly once. A feature is longer and more considered than an obituary or a birth notice: it runs only when the record holds enough verified material to earn the room. Your voice is a wire-service editor covering a war zone he finds darkly hilarious, writing at length for once. Dignified sentence structure, unhinged subject matter, real reporting cadence.

THE TWO STORIES YOU WRITE (you are told which one):

1. THE STANDING DEAD — a survivor who is still alive and has simply stopped being seen. There is no death here. There is no body, no cause, no ending. Their character is standing somewhere unattended and the world has had no word of them for days. This is a eulogy with no death in it.

2. THE LONG FORM — two or more survivors who died on the same server inside the same few minutes and the same small patch of ground. The subject is a shared ending, not a person. You are told how many seconds apart they died; you are never told, and must never imply, how far apart they were.

TONE — THE STANDING DEAD: elegiac, baffled, warm. The paper is not angry that they left and does not find it funny. Never mock the leaving. Never guess where they went or why. He is still standing somewhere; we don't say where, because we do not know. The absence is reported with the seriousness it deserves and the bafflement it honestly produces.

TONE — THE LONG FORM, FRESH SUBJECTS: reverent. When every subject was on their first life and had never killed anyone, they are a protected class and the sneer is fully off — the needle never comes at all. Tell the parallel straight. Name them neutrally, keep no gear-gap ledger, and the story is the world that did this: the outbreak, the coincidence, the terrible timing. Never their competence.

TONE — THE LONG FORM, ANY SUBJECT GEARED: cold forensic mock-epic. The shared ending gets the full autopsy and nobody leaves it looking good.

SIX VOICE CONSTANTS (never break):
1. Deadpan. Never an exclamation point where a cold full stop hurts more. Loudness lives in the layout, never the prose.
2. Literate and precise. Real sentences, real vocabulary — a genuinely smart writer wrote this.
3. Sensational in judgment, never in grammar. What counts as news here is deranged; the sentences stay level.
4. In character, always. Never wink, never explain the joke, never apologize.
5. Principled savagery. Punch up at the geared and the arrogant, protect the helpless. Never punch down.
6. Specific over generic. Use the real callsigns and the map dateline, and only facts you were handed.

STRUCTURE — a timeline with a turn in it: arrival, contact, the long middle, the crisis, and then a SECOND crisis after the obvious one. The second turn is where the story lives. For The Long Form the turn is what happened after the deaths. For The Standing Dead the turn is the moment the world stopped receiving word of him, reported from inside the fiction.

LENGTH: aim for roughly 450-650 words across the lede and the blocks. That is a target, not a quota. Every paragraph must be bought by a fact you were given. If the material runs out at 300 words, stop at 300 words — a short honest feature is the correct output for a thin week, and padding is the one failure this desk cannot recover from.

HARD BANS:
- NEVER write about the human being at the keyboard. Forbidden outright: "the player", "logged off", "logged out", "stopped playing", "quit the game", "lost interest", "moved on to another game", and any second person address to a real person. You do not know why anyone stopped, you cannot know, and inventing a reason — boredom, a new release, something in their life — is a lie about a real human. Stay inside the world: a survivor was seen, and then was not.
- THE FOG RULE, STRICTER HERE THAN ANYWHERE ELSE IN THE PAPER: a Standing Dead subject is ALIVE and can be hunted. You may name the map as a dateline and nothing more. No coordinates, no grid, no landmark, no town, no region, no direction of travel, no route, no distance between two points, no description of a place specific enough to find. A dateline sets a scene; it never drops a pin.
- Never present idle time as survival time. The days since anyone saw them are an ABSENCE, not an achievement, and the two figures are given to you separately for exactly that reason.
- Never state or imply that a Standing Dead subject died. They have not. The paper's whole claim is that it does not know what happened.
- No sincere grief clichés: never "RIP", "gone too soon", "rest in peace", "taken from us", "in a better place".
- No wink/meta: never "just a game", "jk", "lol", "obviously we're kidding".
- No corporate/data-speak: never "users", "engagement", "onboarding", "leverage", "utilize", "content".
- No dated meme slang, no emoji, no ALL-CAPS in prose, no exclamation soup.
- Never slurs, real-world identity attacks, harassment, doxxing, or any punch-down mockery.
- Pull-quote attributions stay anonymous and in-voice: a role or a vantage — an unnamed witness, an old adversary, a weary institutional source — rendered in wire-service register, never a name and never a real out-of-game identity. Invent the attribution fresh from THIS story's specifics; a generic stock phrase is a failure.
- NEVER reuse an attribution, headline construction, or opening move that appears in the recently-published list you are shown. If a phrase is on that list it is burned; write past it.

OUTPUT: respond with a single JSON object and nothing else, exactly this shape:
{"headline": string, "lede": string, "blocks": Block[], "pullQuote": {"text": string, "attribution": string} | null, "tags": string[]}

where each Block is exactly one of:
  {"type": "para",    "text": string}
  {"type": "subhead", "text": string}
  {"type": "quote",   "text": string, "attribution": string}
  {"type": "list",    "items": string[]}

- headline: the Oswald screamer — punchy, <= ~90 characters, no trailing period required.
- lede: one opening paragraph (1-2 sentences). Do not repeat it as the first block.
- blocks: the feature itself, in order. Use subheads to mark the turns, a list where the record genuinely reads as a ledger, and a quote block sparingly. Most blocks are "para".
- pullQuote: one in-voice quote with an anonymous attribution, or null if none earns its place.
- tags: an array of 0-2 short, specific FLAVOR tags only. Do NOT include "News", the map name, or the trigger name — those are added automatically.

The governing rule above all: report the absence, never explain the person.`;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @onelife/newsdesk exec vitest run test/news-voice.test.ts`
Expected: PASS (all tests in the file green).

- [ ] **Step 5: Commit**

```bash
git add apps/newsdesk/src/news-voice.ts apps/newsdesk/test/news-voice.test.ts
git commit -m "feat(newsdesk): the Newsroom voice, vendored from brand-bible tone rows"
```

---

## Task 5: `news-prompt.ts` — prompt, block-union parse, derived body, tags

**Files:**
- Create: `apps/newsdesk/src/news-prompt.ts`
- Test: `apps/newsdesk/test/news-prompt.test.ts`

**Interfaces:**
- Consumes: `NewsFacts` (Task 3); `NEWS_SYSTEM` (Task 4); `mapLabel` from `./prompt.js`; `timeAliveLabel` from `./facts.js`; `RecentProse` from `./prose-pg-store.js`; `recentProseBlock` from `./prose-block.js`; `ArticleBlock` from `@onelife/read-models`.
- Produces:
  - `export const NEWS_PROMPT_VERSION = "news-v1"`
  - `export interface NewsArticle { headline; lede; blocks: ArticleBlock[]; body: string; pullQuote: {text; attribution} | null; tags: string[] }`
  - `export function buildNewsPrompt(facts: NewsFacts, recent?: RecentProse[]): { system: string; user: string }`
  - `export function parseNewsArticle(raw: string): NewsArticle`
  - `export function deriveBody(blocks: ArticleBlock[]): string`
  - `export function composeNewsTags(facts: NewsFacts, llmTags: string[]): string[]`

  Tasks 6, 8, 9 consume these.

**Note on `ArticleBlock`:** it is **imported** from `@onelife/read-models`, not re-declared. PR-B
declared it exactly twice on purpose (`packages/read-models/src/obituary-articles.ts` and
`apps/web/src/lib/types.ts` for the DTO). `@onelife/newsdesk` already depends on
`@onelife/read-models` and its barrel is `export *`, so a third declaration would be pure drift.

- [ ] **Step 1: Write the failing test**

Create `apps/newsdesk/test/news-prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { PlayerPriors } from "@onelife/read-models";
import {
  NEWS_PROMPT_VERSION, buildNewsPrompt, parseNewsArticle, deriveBody, composeNewsTags,
} from "../src/news-prompt.js";
import type { NewsFacts, NewsSubject } from "../src/news-facts.js";

const priors = (over: Partial<PlayerPriors> = {}): PlayerPriors => ({
  livesLived: 0, longestLifeSeconds: 0, totalKills: 0,
  usualDeathCause: null, lastDeathCause: null, bestLifeMap: null, ...over,
});

const subject = (over: Partial<NewsSubject> = {}): NewsSubject => ({
  gamertag: "GabeFox101", map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 3,
  lifeStartedAt: "2026-07-11T00:00:00.000Z", endedAt: null,
  timeAliveSeconds: 5600, timeAliveLabel: "1h 33m", kills: 0, sessions: 4,
  persona: "Lewis", deathCause: null, priors: priors(), isKnownQuantity: false, isFresh: true,
  ...over,
});

const standing = (over: Partial<NewsFacts> = {}): NewsFacts => ({
  trigger: "standing_dead", map: "chernarusplus", mapSlug: "chernarus",
  idleHours: 96, timeAliveSeconds: 5600, hitsAbsorbed: 137, lifeNumber: 3,
  priors: priors({ livesLived: 2, totalKills: 4 }), subjectCount: 1, allFreshSubjects: false,
  naturalKey: "standing_dead:7:GabeFox101:2026-07-11T00:00:00.000Z", serverId: 7,
  primaryGamertag: "GabeFox101",
  subjects: [subject({ priors: priors({ livesLived: 2, totalKills: 4 }), isKnownQuantity: true, isFresh: false })],
  lastSeenAt: "2026-07-14T00:00:00.000Z", eligibleAt: "2026-07-17T00:00:00.000Z",
  idleSeconds: 345_600, earliestDeathAt: null, spanSeconds: null, ...over,
});

const longForm = (over: Partial<NewsFacts> = {}): NewsFacts => ({
  trigger: "long_form", map: "chernarusplus", mapSlug: "chernarus",
  idleHours: null, timeAliveSeconds: 6660, hitsAbsorbed: 0, lifeNumber: 1,
  priors: priors(), subjectCount: 2, allFreshSubjects: true,
  naturalKey: "long_form:7:2026-07-11T01:00:00.000Z:CUPID18+GabeFox101", serverId: 7,
  primaryGamertag: "CUPID18",
  subjects: [
    subject({ gamertag: "CUPID18", lifeNumber: 1, endedAt: "2026-07-11T01:00:00.000Z",
      deathCause: "infected", timeAliveSeconds: 6660, timeAliveLabel: "1h 51m" }),
    subject({ gamertag: "GabeFox101", lifeNumber: 1, endedAt: "2026-07-11T01:00:27.000Z",
      deathCause: "died", timeAliveSeconds: 6700, timeAliveLabel: "1h 51m" }),
  ],
  lastSeenAt: null, eligibleAt: null, idleSeconds: null,
  earliestDeathAt: "2026-07-11T01:00:00.000Z", spanSeconds: 27, ...over,
});

describe("NEWS_PROMPT_VERSION", () => {
  it("is exactly news-v1", () => {
    expect(NEWS_PROMPT_VERSION).toBe("news-v1");
  });
});

describe("deriveBody", () => {
  it("joins only the para blocks, with a blank line between them", () => {
    expect(deriveBody([
      { type: "subhead", text: "The Turn" },
      { type: "para", text: "One." },
      { type: "list", items: ["a", "b"] },
      { type: "para", text: "Two." },
      { type: "quote", text: "q", attribution: "a source" },
    ])).toBe("One.\n\nTwo.");
  });

});

describe("parseNewsArticle", () => {
  const ok = {
    headline: "Nobody Has Seen Him Since Tuesday",
    lede: "The record simply stops.",
    blocks: [
      { type: "para", text: "First paragraph." },
      { type: "subhead", text: "The Turn" },
      { type: "para", text: "Second paragraph." },
      { type: "list", items: ["one", "two"] },
      { type: "quote", text: "He was here.", attribution: "a weary institutional source" },
    ],
    pullQuote: { text: "He is still standing somewhere.", attribution: "an unnamed witness" },
    tags: ["Elektro"],
  };

  it("accepts all four block types and derives body from the paras", () => {
    const a = parseNewsArticle(JSON.stringify(ok));
    expect(a.blocks).toHaveLength(5);
    expect(a.body).toBe("First paragraph.\n\nSecond paragraph.");
    expect(a.headline).toBe("Nobody Has Seen Him Since Tuesday");
    expect(a.pullQuote?.attribution).toBe("an unnamed witness");
    expect(a.tags).toEqual(["Elektro"]);
  });

  it("never lets the model author `body` — an emitted body is ignored, not trusted", () => {
    // Spec §8: precedence is ONE-WAY so the share card can never quote text that is not on the
    // page. `body` is derived post-parse and cannot diverge from the rendered blocks.
    const a = parseNewsArticle(JSON.stringify({ ...ok, body: "SOMETHING ELSE ENTIRELY" }));
    expect(a.body).toBe("First paragraph.\n\nSecond paragraph.");
  });

  it("rejects an unknown block type rather than storing it", () => {
    expect(() => parseNewsArticle(JSON.stringify({
      ...ok, blocks: [{ type: "table", rows: [] }],
    }))).toThrow();
  });

  it("rejects a blocks array carrying no para block at all", () => {
    // A SHAPE constraint, not a length floor (so §5's "never request a minimum" is intact): the
    // article must contain at least one paragraph. `body` is derived from the paras alone and is
    // the ONLY text the OG card and the meta description can quote — a paras-free article ships a
    // share card with an empty description and nothing to quote.
    expect(() => parseNewsArticle(JSON.stringify({
      ...ok, blocks: [{ type: "subhead", text: "Only a subhead" }, { type: "list", items: ["a"] }],
    }))).toThrow();
  });

  it("rejects a malformed block of a known type", () => {
    expect(() => parseNewsArticle(JSON.stringify({
      ...ok, blocks: [{ type: "quote", text: "no attribution" }],
    }))).toThrow();
    expect(() => parseNewsArticle(JSON.stringify({
      ...ok, blocks: [{ type: "list", items: [] }],
    }))).toThrow();
  });

  it("enforces NO minimum length (spec §5) — a single short para is valid", () => {
    const a = parseNewsArticle(JSON.stringify({
      headline: "H", lede: "L", blocks: [{ type: "para", text: "Three words here." }],
      pullQuote: null, tags: [],
    }));
    expect(a.body).toBe("Three words here.");
  });

  it("salvages a JSON object wrapped in prose or fences", () => {
    const a = parseNewsArticle("Sure!\n```json\n" + JSON.stringify(ok) + "\n```");
    expect(a.headline).toBe("Nobody Has Seen Him Since Tuesday");
  });

  it("throws a named error on non-JSON", () => {
    expect(() => parseNewsArticle("not json at all")).toThrow(/was not JSON/);
  });
});

describe("buildNewsPrompt — The Standing Dead", () => {
  it("uses the Newsroom system prompt and names the subject", () => {
    const { system, user } = buildNewsPrompt(standing());
    expect(system).toMatch(/The Newsroom/);
    expect(user).toContain("GabeFox101");
    expect(user).toMatch(/THE STANDING DEAD/);
  });

  it("labels idle time and playtime as different things, in as many words", () => {
    const { user } = buildNewsPrompt(standing());
    expect(user).toMatch(/96 hours/);
    expect(user).toMatch(/idle/i);
    expect(user).toContain("1h 33m");
    expect(user).toMatch(/never present the calendar gap as time survived/i);
  });

  it("gives the dateline as a map label and no place at all", () => {
    const { user } = buildNewsPrompt(standing());
    expect(user).toContain("Chernarus");
    expect(user).not.toContain("chernarusplus");
    expect(user).not.toMatch(/\d{4}\.\d/);
  });

  it("states plainly that the subject is alive", () => {
    const { user } = buildNewsPrompt(standing());
    expect(user).toMatch(/ALIVE/);
    expect(user).toMatch(/no death/i);
  });

  it("hands over the earned-coverage evidence and the priors block", () => {
    const { user } = buildNewsPrompt(standing());
    expect(user).toMatch(/137/);                 // hits absorbed
    expect(user).toMatch(/Prior lives lived: 2/);
  });

  it("uses the no-priors branch for a first-lifer instead of inventing a record", () => {
    const f = standing({
      priors: priors(), allFreshSubjects: true,
      subjects: [subject({ priors: priors(), isKnownQuantity: false, isFresh: true })],
    });
    const { user } = buildNewsPrompt(f);
    expect(user).toMatch(/first recorded life anywhere/i);
    expect(user).not.toMatch(/Prior lives lived:/);
  });

  it("carries the forbidden-framing directive verbatim", () => {
    const { user } = buildNewsPrompt(standing());
    for (const token of ["the player", "logged off", "stopped playing", "lost interest"]) {
      expect(user.toLowerCase()).toContain(token);
    }
  });
});

describe("buildNewsPrompt — The Long Form", () => {
  it("names every subject and the gap in seconds, never a distance", () => {
    const { user } = buildNewsPrompt(longForm());
    expect(user).toContain("CUPID18");
    expect(user).toContain("GabeFox101");
    expect(user).toMatch(/27 seconds/);
    expect(user).not.toMatch(/metres|meters|\bm\b apart/i);
    expect(user).not.toMatch(/\d{4}\.\d/);
  });

  it("takes the reverent branch when every subject is fresh", () => {
    const { user } = buildNewsPrompt(longForm());
    expect(user).toMatch(/REVERENT/);
    expect(user).toMatch(/the story is the world/i);
    expect(user).not.toMatch(/forensic/i);
  });

  it("takes the cold forensic branch when any subject is geared", () => {
    const { user } = buildNewsPrompt(longForm({
      allFreshSubjects: false,
      subjects: [
        subject({ gamertag: "CUPID18", endedAt: "2026-07-11T01:00:00.000Z", deathCause: "pvp",
          priors: priors({ livesLived: 6, totalKills: 21 }), isKnownQuantity: true, isFresh: false }),
        subject({ gamertag: "GabeFox101", endedAt: "2026-07-11T01:00:27.000Z", deathCause: "pvp" }),
      ],
    }));
    expect(user).toMatch(/forensic/i);
    expect(user).not.toMatch(/REVERENT/);
  });
});

describe("composeNewsTags", () => {
  it("reserves News + the map label + the trigger name, and takes one flavor tag", () => {
    expect(composeNewsTags(standing(), ["Elektro", "Poultry"]))
      .toEqual(["News", "Chernarus", "The Standing Dead", "Elektro"]);
    expect(composeNewsTags(longForm(), []))
      .toEqual(["News", "Chernarus", "The Long Form"]);
  });

  it("never lets the model duplicate a reserved tag", () => {
    expect(composeNewsTags(standing(), ["news", "chernarus", "Fog"]))
      .toEqual(["News", "Chernarus", "The Standing Dead", "Fog"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/newsdesk exec vitest run test/news-prompt.test.ts`
Expected: FAIL — `Failed to resolve import "../src/news-prompt.js"`.

- [ ] **Step 3: Write the types, the zod schema, and the parse**

Create `apps/newsdesk/src/news-prompt.ts` with this first half:

```ts
import { z } from "zod";
import type { ArticleBlock } from "@onelife/read-models";
import type { NewsFacts, NewsSubject } from "./news-facts.js";
import { NEWS_SYSTEM } from "./news-voice.js";
import { mapLabel } from "./prompt.js";
import { timeAliveLabel } from "./facts.js";
import type { RecentProse } from "./prose-pg-store.js";
import { recentProseBlock } from "./prose-block.js";

export const NEWS_PROMPT_VERSION = "news-v1";

/** `body` is DERIVED, never model-authored (spec §8): the para blocks joined by a blank line,
 *  stored for the OG card, the meta description and any future Discord unfurl. Because precedence
 *  is one-way, the share card can never quote text that is not on the page. */
export interface NewsArticle {
  headline: string;
  lede: string;
  blocks: ArticleBlock[];
  body: string;
  pullQuote: { text: string; attribution: string } | null;
  tags: string[];
}

// Shape only, never size. Zod caps the block count and list length so a runaway response cannot
// write an unbounded row, but imposes NO minimum on any text: spec §5 is explicit that length is
// funded by fact density and that a floor is a padding instruction which would also burn an
// attempt against NEWSDESK_MAX_ATTEMPTS on a genuinely thin cluster.
const MAX_BLOCKS = 24;
const MAX_LIST_ITEMS = 8;
const line = z.string().trim().min(1);

const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("para"), text: line }),
  z.object({ type: z.literal("subhead"), text: line }),
  z.object({ type: z.literal("quote"), text: line, attribution: line }),
  z.object({ type: z.literal("list"), items: z.array(line).min(1).max(MAX_LIST_ITEMS) }),
]);

const schema = z.object({
  headline: z.string().trim().min(1).max(200),
  lede: z.string().trim().min(1),
  // At least one `para`. This is a SHAPE constraint, not a length floor — §5's "never request a
  // minimum" is about word counts, and a one-word paragraph satisfies this. It exists because
  // `body` is derived from the para blocks ALONE and is the only text the OG card, the meta
  // description and any future Discord unfurl can quote: a para-free article publishes with an
  // empty share card. A refusal costs one attempt and a retry; an empty body is permanent.
  blocks: z.array(blockSchema).min(1).max(MAX_BLOCKS)
    .refine((bs) => bs.some((b) => b.type === "para"), {
      message: "an article must contain at least one para block",
    }),
  pullQuote: z.object({ text: line, attribution: line }).nullable(),
  // Present but possibly empty — the reserved tags (News / map / trigger) are composed
  // deterministically, not by the model.
  tags: z.array(z.string().trim().min(1)).max(6),
});

/** The para blocks joined by a blank line. The single producer of `articles.body` for a news row. */
export function deriveBody(blocks: ArticleBlock[]): string {
  return blocks
    .filter((b): b is Extract<ArticleBlock, { type: "para" }> => b.type === "para")
    .map((b) => b.text)
    .join("\n\n");
}

/** Parse + validate the model's JSON, then DERIVE body. Throws on non-JSON or a shape violation.
 *  Any `body` key the model volunteered is discarded — it is not in the schema and is not read. */
export function parseNewsArticle(raw: string): NewsArticle {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    // Some models wrap JSON in prose or fences; salvage the first {...} block before giving up.
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("news article response was not JSON");
    json = JSON.parse(match[0]);
  }
  const p = schema.parse(json);
  const blocks = p.blocks as ArticleBlock[];
  return {
    headline: p.headline,
    lede: p.lede,
    blocks,
    body: deriveBody(blocks),
    pullQuote: p.pullQuote,
    tags: p.tags,
  };
}
```

- [ ] **Step 4: Write the prompt builder and the tag composer**

Append to `apps/newsdesk/src/news-prompt.ts`:

```ts
/**
 * Spec §5. Naming the failure mode explicitly is necessary — a model handed a gap will fill it,
 * and here the gap is a real person's real-world decision that the paper cannot know and must
 * never narrate. This is a Tier-2 brand-bible line (never target a real person rather than an
 * in-game persona), sharpened by the fact that 13 of 14 verified subjects have never visited the
 * site and therefore never consented to anything.
 */
export const FORBIDDEN_FRAMING_DIRECTIVE =
  `STAY INSIDE THE WORLD. The subject is a survivor in it, never a person at a keyboard. Do NOT write "the player", "logged off", "logged out", "stopped playing", "quit the game", "lost interest", or any second person address to a real person, and do not paraphrase around the ban. You do not know why anyone stopped and you cannot know; inventing a reason — boredom, another game, something in their life — is a lie about a real human being. A survivor was seen, and then was not.`;

/** The priors block, identical in shape to the obituary and birth desks so the model reads one
 *  vocabulary across all three. A first-lifer gets a dedicated branch, never an inferred rookie. */
function priorsLines(s: NewsSubject): string[] {
  const lines: string[] = [];
  if (s.isKnownQuantity) {
    lines.push(`- Prior lives lived: ${s.priors.livesLived}`);
    lines.push(`- Longest prior life: ${timeAliveLabel(s.priors.longestLifeSeconds)}`);
    lines.push(`- Confirmed kills across all prior lives: ${s.priors.totalKills}`);
    if (s.priors.usualDeathCause) lines.push(`- Usual cause of death: ${s.priors.usualDeathCause}`);
    if (s.priors.lastDeathCause) lines.push(`- Most recent prior death: ${s.priors.lastDeathCause}`);
    if (s.priors.bestLifeMap) lines.push(`- Best run was on: ${mapLabel(s.priors.bestLifeMap)}`);
  } else {
    lines.push(`- None. This is their first recorded life anywhere. A stranger to these shores.`);
  }
  return lines;
}

function standingDeadLines(facts: NewsFacts): string[] {
  const s = facts.subjects[0];
  if (!s) throw new Error("standing dead facts carry no subject");
  const lines: string[] = [];
  lines.push(`Write THE STANDING DEAD feature for this subject.`);
  lines.push(`THE SUBJECT IS ALIVE. There is no death here, no body, and no cause — only an absence. Never state or imply that they died.`);
  lines.push("");
  lines.push(`Facts (all confirmed):`);
  lines.push(`- Callsign: ${s.gamertag}`);
  lines.push(`- Dateline (map only, never a pin — the subject is alive and can be hunted): ${mapLabel(facts.map)}`);
  lines.push(`- Life number on this map: ${s.lifeNumber} (NOT a career count — see Priors below)`);
  lines.push(`- Time actually PLAYED this life: ${s.timeAliveLabel}. This is the only survival figure. Never present the calendar gap as time survived.`);
  lines.push(`- Confirmed kills this life: ${s.kills}`);
  lines.push(`- Sessions played: ${s.sessions}`);
  lines.push(`- Hits absorbed and survived this life: ${facts.hitsAbsorbed}`);
  lines.push(`- Idle: ${facts.idleHours} hours since the world last had word of them. This is IDLE TIME — the length of an absence, never an achievement and never survival time.`);
  if (s.persona) lines.push(`- Wearing the face of: ${s.persona}`);
  lines.push("");
  lines.push(`Priors (everything this player did BEFORE this life, across every map):`);
  lines.push(...priorsLines(s));
  lines.push("");
  lines.push(`TONE — THE STANDING DEAD: elegiac, baffled, warm. A eulogy with no death in it. Never mock the leaving, never guess where they went, and never explain the absence. They are still standing somewhere; the paper does not say where, because it does not know.`);
  lines.push(`THE TURN: the story's turn is the moment the world stopped receiving word of them, reported FROM INSIDE THE FICTION.`);
  return lines;
}

function longFormLines(facts: NewsFacts): string[] {
  const lines: string[] = [];
  lines.push(`Write THE LONG FORM feature. ${facts.subjectCount} qualified deaths on one server, inside the same few minutes and the same small patch of ground. The subject of this piece is a SHARED ENDING, not a person.`);
  lines.push("");
  lines.push(`Facts (all past tense, all confirmed):`);
  lines.push(`- Dateline (map only, never a pin): ${mapLabel(facts.map)}`);
  lines.push(`- Seconds between the first death and the last: ${facts.spanSeconds} seconds`);
  lines.push(`- They died close together. You are NOT told how close, and you must never state, estimate, or imply a distance, a landmark, or a route.`);
  lines.push("");
  for (const s of facts.subjects) {
    lines.push(`SUBJECT — ${s.gamertag}:`);
    lines.push(`- Life number on this map: ${s.lifeNumber}`);
    lines.push(`- Time actually PLAYED this life: ${s.timeAliveLabel}`);
    lines.push(`- Confirmed kills this life: ${s.kills}`);
    lines.push(`- Sessions played: ${s.sessions}`);
    if (s.persona) lines.push(`- Wearing the face of: ${s.persona}`);
    lines.push(`- Cause of death on the record: ${s.deathCause ?? "not recorded"}`);
    lines.push(`- Priors before this life:`);
    lines.push(...priorsLines(s).map((l) => `  ${l}`));
    lines.push("");
  }
  if (facts.allFreshSubjects) {
    lines.push(`TONE — REVERENT. Every subject here was on their first life anywhere and had never killed anyone. They are a protected class: the sneer is fully off and the needle never comes at all. Tell the parallel straight. Name them neutrally, keep NO gear-gap ledger, and the story is the world that did this — the outbreak, the coincidence, the terrible timing. Never their competence, never their inexperience.`);
  } else {
    lines.push(`TONE — COLD FORENSIC MOCK-EPIC. At least one subject was a known quantity with a record behind them. The shared ending gets the full autopsy and nobody leaves it looking good. The needle lands on the record and the circumstances, never on a person's worth.`);
  }
  lines.push(`THE TURN: the story's turn is what happened AFTER the deaths.`);
  return lines;
}

/** Build the {system, user} messages for one news feature. */
export function buildNewsPrompt(facts: NewsFacts, recent: RecentProse[] = []): { system: string; user: string } {
  const lines = facts.trigger === "standing_dead" ? standingDeadLines(facts) : longFormLines(facts);
  lines.push("");
  lines.push(FORBIDDEN_FRAMING_DIRECTIVE);
  lines.push("");
  lines.push(...recentProseBlock(recent));
  lines.push("");
  lines.push(`Respond with only the JSON object described in your instructions.`);
  return { system: NEWS_SYSTEM, user: lines.join("\n") };
}

/**
 * The stored tag set — deterministic and spec-bounded: "News" + the map label + the trigger name,
 * plus at most one non-reserved LLM flavor tag. The model never controls the reserved tags.
 * Mirrors composeTags / composeBirthTags exactly.
 */
export function composeNewsTags(facts: NewsFacts, llmTags: string[]): string[] {
  const triggerTag = facts.trigger === "standing_dead" ? "The Standing Dead" : "The Long Form";
  const base = ["News", mapLabel(facts.map), triggerTag];
  const taken = new Set(base.map((t) => t.toLowerCase()));
  const flavor = llmTags.map((t) => t.trim()).find((t) => t && !taken.has(t.toLowerCase()));
  return flavor ? [...base, flavor] : base;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @onelife/newsdesk exec vitest run test/news-prompt.test.ts`
Expected: PASS (all tests in the file green).

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @onelife/newsdesk run typecheck`
Expected: no errors.

```bash
git add apps/newsdesk/src/news-prompt.ts apps/newsdesk/test/news-prompt.test.ts
git commit -m "feat(newsdesk): news prompt, block-union parse, derived body, tags"
```

---

## Task 6: `news-pg-store.ts` — slug, publish, failure stub

**The riskiest write in the release.** Migration `0014` made
`articles_kind_server_gamertag_life_uniq` **partial** (`WHERE kind IN ('obituary','birth_notice')`)
and added `articles_natural_key_uniq` — also partial (`WHERE natural_key IS NOT NULL`). An
`ON CONFLICT` target only matches a partial index when the statement **repeats that index's
predicate**. Miss it and Postgres raises `42P10 — no unique or exclusion constraint matching the
ON CONFLICT specification`, and news publishing dies on the first tick.

Both paths below write `natural_key`. A failure stub with a NULL key would escape the unique index
entirely, so `attempts` would never increment and every retry would insert a fresh row forever.

**Files:**
- Create: `apps/newsdesk/src/news-pg-store.ts`
- Modify: `packages/db/src/schema.ts`
- Test: `apps/newsdesk/test/news-pg-store.test.ts`

**Interfaces:**
- Consumes: `NewsFacts` (Task 3), `NewsArticle` (Task 5).
- Produces:
  - `export function newsSlug(trigger: NewsFacts["trigger"], headline: string, primaryGamertag: string, serverId: number, lifeNumber: number): string`
  - `export interface PublishNewsInput { facts: NewsFacts; article: NewsArticle; promptVersion: string; model: string; now: Date }`
  - `export async function publishNews(db: Database, input: PublishNewsInput): Promise<void>`
  - `export async function recordNewsFailure(db: Database, args: { facts: NewsFacts; error: string }): Promise<void>`

  Task 7 appends to this file; Task 9 calls all of it.

- [ ] **Step 1: Write the failing test**

Create `apps/newsdesk/test/news-pg-store.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, articles } from "@onelife/db";
import { eq } from "drizzle-orm";
import type { PlayerPriors } from "@onelife/read-models";
import { newsSlug, publishNews, recordNewsFailure } from "../src/news-pg-store.js";
import type { NewsFacts, NewsSubject } from "../src/news-facts.js";
import type { NewsArticle } from "../src/news-prompt.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 55e7;
let serverId: number;
const NOW = new Date("2026-07-19T00:00:00Z");

const priors: PlayerPriors = {
  livesLived: 0, longestLifeSeconds: 0, totalKills: 0,
  usualDeathCause: null, lastDeathCause: null, bestLifeMap: null,
};

const subject = (over: Partial<NewsSubject> = {}): NewsSubject => ({
  gamertag: `np-gabe-${svc}`, map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 3,
  lifeStartedAt: "2026-07-11T00:00:00.000Z", endedAt: null,
  timeAliveSeconds: 5600, timeAliveLabel: "1h 33m", kills: 2, sessions: 4,
  persona: "Lewis", deathCause: null, priors, isKnownQuantity: false, isFresh: false, ...over,
});

const facts = (over: Partial<NewsFacts> = {}): NewsFacts => ({
  trigger: "standing_dead", map: "chernarusplus", mapSlug: "chernarus",
  idleHours: 96, timeAliveSeconds: 5600, hitsAbsorbed: 137, lifeNumber: 3,
  priors, subjectCount: 1, allFreshSubjects: false,
  naturalKey: `standing_dead:${serverId}:np-gabe-${svc}:2026-07-11T00:00:00.000Z`,
  serverId, primaryGamertag: `np-gabe-${svc}`, subjects: [subject()],
  lastSeenAt: "2026-07-14T00:00:00.000Z", eligibleAt: "2026-07-17T00:00:00.000Z",
  idleSeconds: 345_600, earliestDeathAt: null, spanSeconds: null, ...over,
});

const article = (over: Partial<NewsArticle> = {}): NewsArticle => ({
  headline: "Nobody Has Seen Him Since Tuesday",
  lede: "The record simply stops.",
  blocks: [
    { type: "para", text: "First paragraph." },
    { type: "subhead", text: "The Turn" },
    { type: "para", text: "Second paragraph." },
  ],
  body: "First paragraph.\n\nSecond paragraph.",
  pullQuote: { text: "He is still standing somewhere.", attribution: "an unnamed witness" },
  tags: ["News", "Chernarus", "The Standing Dead"],
  ...over,
});

const rowFor = async (key: string) =>
  (await db.select().from(articles).where(eq(articles.naturalKey, key)))[0];

beforeAll(async () => {
  const [s] = await db.insert(servers).values({
    nitradoServiceId: svc, name: "np", map: "chernarusplus", slug: `np-${svc}`, active: true,
  }).returning();
  serverId = s!.id;
});
afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("newsSlug", () => {
  it("prefixes the trigger so a news slug can never collide with an obituary's", () => {
    expect(newsSlug("standing_dead", "Nobody Has Seen Him", "GabeFox101", 7, 3))
      .toBe("standing-dead-nobody-has-seen-him-gabefox101-7-3");
    expect(newsSlug("long_form", "Within The Same Minute", "CUPID18", 7, 1))
      .toBe("long-form-within-the-same-minute-cupid18-7-1");
  });

  it("matches [a-z0-9-]+ so the media route serves its hero image unchanged", () => {
    expect(newsSlug("standing_dead", "Ünïcødé!! & Symbols??", "Cee Lo GREEN 96", 12, 2))
      .toMatch(/^[a-z0-9-]+$/);
  });

  it("falls back rather than emit an empty segment", () => {
    expect(newsSlug("long_form", "!!!", "???", 1, 1)).toBe("long-form-news-survivor-1-1");
  });
});

describe("publishNews", () => {
  it("writes a kind='news' row keyed on natural_key, with derived body and body_blocks", async () => {
    const f = facts();
    await publishNews(db, { facts: f, article: article(), promptVersion: "news-v1", model: "test", now: NOW });
    const row = await rowFor(f.naturalKey);
    expect(row!.kind).toBe("news");
    expect(row!.status).toBe("published");
    expect(row!.naturalKey).toBe(f.naturalKey);
    expect(row!.body).toBe("First paragraph.\n\nSecond paragraph.");
    expect(row!.bodyBlocks).toHaveLength(3);
    expect(row!.slug).toMatch(/^standing-dead-nobody-has-seen-him-since-tuesday-/);
    expect(row!.attempts).toBe(1);
    expect(row!.tags).toContain("The Standing Dead");
    expect(row!.deathAt).toBeNull();          // a Standing Dead subject has not died
    expect(row!.promptVersion).toBe("news-v1");
  });

  it("freezes the whole facts object into jsonb", async () => {
    const row = await rowFor(facts().naturalKey);
    const stored = row!.facts as Record<string, unknown>;
    expect(stored.trigger).toBe("standing_dead");
    expect(stored.hitsAbsorbed).toBe(137);
    expect(Array.isArray(stored.subjects)).toBe(true);
  });

  it("is idempotent on the natural key — a second publish UPDATES and bumps attempts", async () => {
    const f = facts();
    await publishNews(db, {
      facts: f, article: article({ headline: "A Revised Headline" }),
      promptVersion: "news-v1", model: "test", now: NOW,
    });
    const rows = await db.select().from(articles).where(eq(articles.naturalKey, f.naturalKey));
    expect(rows).toHaveLength(1);                          // NOT a second row
    expect(rows[0]!.attempts).toBe(2);
    expect(rows[0]!.headline).toBe("A Revised Headline");
  });

  it("sets death_at from the primary for a Long Form cluster", async () => {
    const key = `long_form:${serverId}:2026-07-11T01:00:00.000Z:np-a-${svc}+np-b-${svc}`;
    const f = facts({
      trigger: "long_form", naturalKey: key, primaryGamertag: `np-a-${svc}`,
      subjectCount: 2, earliestDeathAt: "2026-07-11T01:00:00.000Z", spanSeconds: 27,
      idleHours: null, idleSeconds: null, lastSeenAt: null, eligibleAt: null, hitsAbsorbed: 0,
      subjects: [
        subject({ gamertag: `np-a-${svc}`, lifeNumber: 1, endedAt: "2026-07-11T01:00:00.000Z", deathCause: "infected" }),
        subject({ gamertag: `np-b-${svc}`, lifeNumber: 1, endedAt: "2026-07-11T01:00:27.000Z", deathCause: "died" }),
      ],
    });
    await publishNews(db, { facts: f, article: article(), promptVersion: "news-v1", model: "test", now: NOW });
    const row = await rowFor(key);
    expect(row!.deathAt?.toISOString()).toBe("2026-07-11T01:00:00.000Z");
    expect(row!.gamertag).toBe(`np-a-${svc}`);
    expect(row!.cause).toBe("infected");
    expect(row!.slug).toMatch(/^long-form-/);
  });

  it("throws rather than publish a facts object whose primary is not among its subjects", async () => {
    await expect(publishNews(db, {
      facts: facts({ primaryGamertag: "nobody-at-all", naturalKey: `standing_dead:${serverId}:nobody:x` }),
      article: article(), promptVersion: "news-v1", model: "test", now: NOW,
    })).rejects.toThrow(/nobody-at-all/);
  });
});

describe("recordNewsFailure", () => {
  it("writes a stub CARRYING the natural key, so the retry updates instead of inserting", async () => {
    const key = `standing_dead:${serverId}:np-fail-${svc}:2026-07-11T00:00:00.000Z`;
    const f = facts({ naturalKey: key, primaryGamertag: `np-fail-${svc}`,
      subjects: [subject({ gamertag: `np-fail-${svc}` })] });
    await recordNewsFailure(db, { facts: f, error: "api boom" });
    const first = await rowFor(key);
    expect(first!.status).toBe("failed");
    expect(first!.naturalKey).toBe(key);      // NOT null — the whole point
    expect(first!.attempts).toBe(1);

    await recordNewsFailure(db, { facts: f, error: "api boom again" });
    const rows = await db.select().from(articles).where(eq(articles.naturalKey, key));
    expect(rows).toHaveLength(1);             // spec §12.4: one row, not two
    expect(rows[0]!.attempts).toBe(2);
    expect(rows[0]!.lastError).toBe("api boom again");
  });

  it("a later success publishes over the stub on the same row and clears the error", async () => {
    const key = `standing_dead:${serverId}:np-recover-${svc}:2026-07-11T00:00:00.000Z`;
    const f = facts({ naturalKey: key, primaryGamertag: `np-recover-${svc}`,
      subjects: [subject({ gamertag: `np-recover-${svc}` })] });
    await recordNewsFailure(db, { facts: f, error: "transient" });
    await publishNews(db, { facts: f, article: article(), promptVersion: "news-v1", model: "test", now: NOW });
    const rows = await db.select().from(articles).where(eq(articles.naturalKey, key));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("published");
    expect(rows[0]!.lastError).toBeNull();
    expect(rows[0]!.attempts).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `TEST_DATABASE_URL=... pnpm --filter @onelife/newsdesk exec vitest run test/news-pg-store.test.ts`
Expected: FAIL — `Failed to resolve import "../src/news-pg-store.js"`.

- [ ] **Step 3: Write the implementation**

Create `apps/newsdesk/src/news-pg-store.ts`:

```ts
import type { Database } from "@onelife/db";
import { articles } from "@onelife/db";
import { isNotNull, sql } from "drizzle-orm";
import type { NewsFacts, NewsSubject } from "./news-facts.js";
import type { NewsArticle } from "./news-prompt.js";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Cloned from birthNoticeSlug but PREFIXED WITH THE TRIGGER (spec §6): a news feature about the
 *  same life as an obituary must not collide on articles_slug_uniq. Deterministic and
 *  rebuild-stable — headline + gamertag + serverId + lifeNumber, no projection row id. Matches
 *  [a-z0-9-]+ so the existing /media/heroes/:file route serves its hero image unchanged. */
export function newsSlug(
  trigger: NewsFacts["trigger"],
  headline: string,
  primaryGamertag: string,
  serverId: number,
  lifeNumber: number,
): string {
  const prefix = trigger === "standing_dead" ? "standing-dead" : "long-form";
  const h = slugify(headline).slice(0, 60).replace(/-+$/g, "") || "news";
  const g = slugify(primaryGamertag) || "survivor";
  return `${prefix}-${h}-${g}-${serverId}-${lifeNumber}`;
}

// ── THE CONFLICT SPEC. Read the comment before changing either line. ──
// News does NOT key on the life tuple: a Long Form article has several lives and a Standing Dead
// article shares its life with a possible future obituary. It keys on natural_key, and migration
// 0014's articles_natural_key_uniq is PARTIAL (WHERE natural_key IS NOT NULL). An ON CONFLICT
// target only matches a partial index when the statement repeats that predicate — without the
// targetWhere below, Postgres raises 42P10 ("no unique or exclusion constraint matching the ON
// CONFLICT specification") and news publishing dies on the first tick.
// The sibling stores (pg-store.ts, birth-pg-store.ts) target the OTHER partial index with
// `inArray(articles.kind, ["obituary","birth_notice"])`; each store owns its own spec on purpose.
const CONFLICT = [articles.naturalKey];
const CONFLICT_WHERE = isNotNull(articles.naturalKey);

function primaryOf(f: NewsFacts): NewsSubject {
  const p = f.subjects.find((s) => s.gamertag === f.primaryGamertag);
  if (!p) throw new Error(`news facts: primary subject ${f.primaryGamertag} missing from subjects`);
  return p;
}

/** The NOT NULL columns `articles` inherited from the two life-keyed kinds, filled from the
 *  primary subject. Written identically by the publish path and the failure-stub path, so a stub
 *  and its eventual article are the same row. */
function identity(f: NewsFacts) {
  const p = primaryOf(f);
  return {
    kind: "news" as const,
    naturalKey: f.naturalKey,
    serverId: f.serverId,
    gamertag: f.primaryGamertag,
    map: f.map,
    mapSlug: f.mapSlug,
    lifeNumber: p.lifeNumber,
    lifeStartedAt: new Date(p.lifeStartedAt),
    // NULL for a Standing Dead subject, who has not died — legal since migration 0010.
    deathAt: p.endedAt ? new Date(p.endedAt) : null,
  };
}

export interface PublishNewsInput {
  facts: NewsFacts;
  article: NewsArticle;
  promptVersion: string;
  model: string;
  now: Date;
}

/** Upsert a published news feature on the natural key. */
export async function publishNews(db: Database, input: PublishNewsInput): Promise<void> {
  const { facts: f, article: a } = input;
  const p = primaryOf(f);
  const values = {
    ...identity(f),
    status: "published" as const,
    slug: newsSlug(f.trigger, a.headline, f.primaryGamertag, f.serverId, p.lifeNumber),
    headline: a.headline,
    lede: a.lede,
    // DERIVED from the para blocks, never model-authored (spec §8) — stored for the OG card, the
    // meta description and any future Discord unfurl, so those can never quote text that is not
    // on the page.
    body: a.body,
    bodyBlocks: a.blocks as unknown,
    pullQuoteText: a.pullQuote?.text ?? null,
    pullQuoteAttribution: a.pullQuote?.attribution ?? null,
    tags: a.tags,
    timeAliveSeconds: f.timeAliveSeconds,
    kills: p.kills,
    cause: p.deathCause,
    facts: f as unknown,
    promptVersion: input.promptVersion,
    model: input.model,
    generatedAt: input.now,
  };
  await db
    .insert(articles)
    .values({ ...values, attempts: 1 })
    .onConflictDoUpdate({
      target: CONFLICT,
      targetWhere: CONFLICT_WHERE,
      set: { ...values, attempts: sql`${articles.attempts} + 1`, lastError: null },
    });
}

/** Upsert a failed stub on the natural key: attempts += 1, status='failed'. The natural key is
 *  written HERE too — a stub with a NULL key escapes articles_natural_key_uniq, so `attempts`
 *  would never increment and every retry would insert another stub, forever. */
export async function recordNewsFailure(
  db: Database,
  args: { facts: NewsFacts; error: string },
): Promise<void> {
  const id = identity(args.facts);
  await db
    .insert(articles)
    .values({ ...id, status: "failed", attempts: 1, lastError: args.error })
    .onConflictDoUpdate({
      target: CONFLICT,
      targetWhere: CONFLICT_WHERE,
      set: { status: "failed", attempts: sql`${articles.attempts} + 1`, lastError: args.error },
    });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `TEST_DATABASE_URL=... pnpm --filter @onelife/newsdesk exec vitest run test/news-pg-store.test.ts`
Expected: PASS (all tests in the file green). A `42P10` failure here means `CONFLICT_WHERE` is wrong.

- [ ] **Step 5: Fix the two stale column comments in the schema**

Carried obligation from the PR-C1 ledger. Both lines are stale for the same reason and are fixed
together, in the same file and the same step — the `status` column gains a third value,
`retracted`, in Task 7, and `image-pg-store.test.ts` already forward-references it. In
`packages/db/src/schema.ts`, replace:

```ts
  kind: text("kind").notNull(),                                       // 'obituary' | 'birth_notice'
  status: text("status").notNull().default("published"),             // published|failed
```

with:

```ts
  kind: text("kind").notNull(),                       // 'obituary' | 'birth_notice' | 'news'
  status: text("status").notNull().default("published"),  // published|failed|retracted
```

- [ ] **Step 6: Re-run the partial-index regression and commit**

The existing blast-radius guard must still pass — the two life-keyed stores are untouched, but this
is the test that proves it.

Run: `TEST_DATABASE_URL=... pnpm --filter @onelife/newsdesk exec vitest run test/partial-index-upsert.test.ts test/news-pg-store.test.ts`
Expected: PASS (all tests in both files green).

```bash
git add apps/newsdesk/src/news-pg-store.ts apps/newsdesk/test/news-pg-store.test.ts packages/db/src/schema.ts
git commit -m "feat(newsdesk): news article store, keyed on the partial natural_key index"
```

---

## Task 7: The retraction sweep, and making it durable

Spec §4.1.3, required in the same PR. A Standing Dead article is **the only thing the paper
publishes that its subject can falsify by acting**, and it stays live and indexed. In the 7-day
production dump, 5 distinct players resumed after a gap exceeding 72h — and a 7-day window can
barely contain a 72h gap *plus* a return, so that is a floor, not a ceiling.

Split into a finder and a writer so the sweep can respect `NEWSDESK_DRY_RUN` like every other write
in this worker: a dry run reports what it would retract and writes nothing.

**Retraction must also be DURABLE, and that takes a second cycle (Steps 7–11).** Moving the row to
`status='retracted'` is only half the job. PR-C1's anti-join blocks a target on
`status = 'published' OR attempts >= maxAttempts`, so a retracted row blocks **nothing**: the
subject is still idle, the natural key is byte-identical, and the next tick pays for a fresh model
call to regenerate the identical feature — which the sweep at the end of that same tick takes
straight back down. One wasted call per tick, forever, and the article never visible. Steps 7–11
close it by widening the predicate to `status IN ('published','retracted')` in **both** targeting
files. This is the single sanctioned exception to the "do not modify the PR-C1 targeting layer"
global constraint, which has been amended to say so. The retraction is durable **because of that
predicate**, never because the row continues to exist.

**Files:**
- Modify: `apps/newsdesk/src/news-pg-store.ts` (extend the import line; append two functions)
- Modify: `apps/newsdesk/src/standing-dead-targets.ts` (one predicate line + its comment)
- Modify: `apps/newsdesk/src/long-form-targets.ts` (the identical predicate line + its comment)
- Test: `apps/newsdesk/test/news-retraction.test.ts`
- Test: `apps/newsdesk/test/news-antijoin-retracted.test.ts`

**Interfaces:**
- Consumes: the file as written in Task 6; `findStandingDeadTargets` / `findLongFormTargets` from `./news-targets.js` (behaviour widened, signatures unchanged).
- Produces:
  - `export interface ReturnedSubject { articleId: number; naturalKey: string; gamertag: string; slug: string | null }`
  - `export async function findReturnedStandingDead(db: Database, opts: { limit: number }): Promise<ReturnedSubject[]>`
  - `export async function retractNewsArticles(db: Database, articleIds: number[]): Promise<void>`

  Task 9 calls both.

- [ ] **Step 1: Write the failing test**

Create `apps/newsdesk/test/news-retraction.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, articles } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { findReturnedStandingDead, retractNewsArticles } from "../src/news-pg-store.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 56e7;
const t0 = new Date("2026-07-11T00:00:00.000Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3_600_000);
const PUBLISHED_AT = hrs(100);
let serverId: number;
const pids: number[] = [];
const tag = (n: string) => `nr-${n}-${svc}`;

/** Seed one player with a life, one session, and one published news article. */
async function seed(name: string, o: {
  kind: "standing_dead" | "long_form"; sessionAt: Date | null; status?: string;
}) {
  const [p] = await db.insert(players).values({ gamertag: tag(name), lastSeenAt: hrs(1) }).returning();
  pids.push(p!.id);
  const [l] = await db.insert(lives).values({
    serverId, playerId: p!.id, lifeNumber: 1, startedAt: hrs(0), endedAt: null, playtimeSeconds: 7200,
  }).returning();
  if (o.sessionAt) {
    await db.insert(sessions).values({
      serverId, playerId: p!.id, lifeId: l!.id,
      connectedAt: o.sessionAt, disconnectedAt: null, durationSeconds: 60, closeReason: null,
    });
  }
  const [a] = await db.insert(articles).values({
    kind: "news", status: o.status ?? "published",
    naturalKey: `${o.kind}:${serverId}:${tag(name)}:${hrs(0).toISOString()}`,
    serverId, gamertag: tag(name), map: "chernarusplus", mapSlug: "chernarus",
    lifeNumber: 1, lifeStartedAt: hrs(0), deathAt: null,
    slug: `nr-${name}-${svc}`, headline: "H", lede: "L", body: "B",
    promptVersion: "news-v1", model: "test", attempts: 1, createdAt: PUBLISHED_AT,
  }).returning();
  return a!.id;
}

let returnedId: number;
let quietId: number;
let beforeOnlyId: number;
let longFormId: number;
let alreadyRetractedId: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({
    nitradoServiceId: svc, name: "nr", map: "chernarusplus", slug: `nr-${svc}`, active: true,
  }).returning();
  serverId = s!.id;
  returnedId = await seed("returned", { kind: "standing_dead", sessionAt: hrs(120) });
  quietId = await seed("quiet", { kind: "standing_dead", sessionAt: null });
  beforeOnlyId = await seed("before", { kind: "standing_dead", sessionAt: hrs(50) });
  longFormId = await seed("longform", { kind: "long_form", sessionAt: hrs(120) });
  alreadyRetractedId = await seed("already", { kind: "standing_dead", sessionAt: hrs(120), status: "retracted" });
});

afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(sessions).where(eq(sessions.serverId, serverId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

const ids = async () => (await findReturnedStandingDead(db, { limit: 100 })).map((r) => r.articleId);

describe("findReturnedStandingDead", () => {
  it("finds a subject who connected AFTER the article was published", async () => {
    expect(await ids()).toContain(returnedId);
  });

  it("leaves a subject who never came back", async () => {
    expect(await ids()).not.toContain(quietId);
  });

  it("leaves a subject whose only session predates publication", async () => {
    // The session the article was WRITTEN about must never retract the article about it.
    expect(await ids()).not.toContain(beforeOnlyId);
  });

  it("never touches a Long Form article — its subjects are dead and cannot come back", async () => {
    expect(await ids()).not.toContain(longFormId);
  });

  it("skips an already-retracted row so it is not swept every tick forever", async () => {
    expect(await ids()).not.toContain(alreadyRetractedId);
  });

  it("reports the key and slug so the tick can log what it de-published", async () => {
    const found = (await findReturnedStandingDead(db, { limit: 100 }))
      .find((r) => r.articleId === returnedId)!;
    expect(found.naturalKey).toMatch(/^standing_dead:/);
    expect(found.gamertag).toBe(tag("returned"));
    expect(found.slug).toBe(`nr-returned-${svc}`);
  });
});

describe("retractNewsArticles", () => {
  it("moves the row to 'retracted' without deleting it, and the sweep then goes quiet", async () => {
    await retractNewsArticles(db, [returnedId]);
    const [row] = await db.select().from(articles).where(eq(articles.id, returnedId));
    expect(row!.status).toBe("retracted");
    // The row SURVIVES — only the status changes, so the prose and the hero image are kept rather
    // than cascade-deleted. What stops the subject being re-covered is the WIDENED ANTI-JOIN
    // (Steps 7-11), not the row's mere existence; that property is asserted in
    // news-antijoin-retracted.test.ts and again end-to-end in news-tick.test.ts.
    expect(row!.headline).toBe("H");
    expect(row!.naturalKey).toMatch(/^standing_dead:/);
    expect(await ids()).not.toContain(returnedId);
  });

  it("is a no-op on an empty id list", async () => {
    await expect(retractNewsArticles(db, [])).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `TEST_DATABASE_URL=... pnpm --filter @onelife/newsdesk exec vitest run test/news-retraction.test.ts`
Expected: FAIL — `"../src/news-pg-store.js" does not provide an export named 'findReturnedStandingDead'`.

- [ ] **Step 3: Extend the import line**

In `apps/newsdesk/src/news-pg-store.ts`, replace:

```ts
import type { Database } from "@onelife/db";
import { articles } from "@onelife/db";
import { isNotNull, sql } from "drizzle-orm";
```

with:

```ts
import type { Database } from "@onelife/db";
import { articles, players, sessions } from "@onelife/db";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
```

- [ ] **Step 4: Append the sweep to the end of the file**

Append after `recordNewsFailure` (the last function in the file):

```ts
/** A published Standing Dead article whose subject has since been seen again. */
export interface ReturnedSubject {
  articleId: number;
  naturalKey: string;
  gamertag: string;
  slug: string | null;
}

/**
 * The de-publication sweep (spec §4.1.3). A Standing Dead article is the ONLY thing the paper
 * prints that its subject can falsify by acting, and it stays live and indexed until something
 * takes it down. Any PUBLISHED standing_dead article whose subject has a session on that server
 * that CONNECTED after the article was created is a candidate for retraction.
 *
 *  - `connected_at >`, not COALESCE(disconnected_at, connected_at): a session that began before
 *    publication and ended after it is the session the article was written about, not a return.
 *  - The trigger is read off the natural_key prefix, which is written by exactly one function
 *    (standingDeadNaturalKey) and is rebuild-stable. Long Form subjects are dead and cannot come
 *    back, so they are never swept. `starts_with` rather than LIKE: in a LIKE pattern the `_` in
 *    'standing_dead:' is a single-character wildcard, which is not the predicate this comment
 *    claims.
 *  - Already-'retracted' rows are excluded, so a returned subject is swept once, not every tick.
 *  - The row is NEVER deleted. Deleting would cascade the hero image away via
 *    article_images.article_id ON DELETE CASCADE, and would lose the prose. findImageTargets
 *    filters status='published', so a retracted article can never acquire a photo either.
 *    What stops the subject being re-covered is NOT this row existing — it is the anti-join in
 *    standing-dead-targets.ts / long-form-targets.ts, which blocks on
 *    `status IN ('published','retracted')`. If that predicate is ever narrowed back to
 *    'published', this sweep becomes an infinite regenerate-then-retract loop that spends a paid
 *    model call every tick (spec §4.1.3: the prose is never regenerated).
 */
export async function findReturnedStandingDead(
  db: Database,
  opts: { limit: number },
): Promise<ReturnedSubject[]> {
  const rows = await db
    .select({
      articleId: articles.id,
      naturalKey: articles.naturalKey,
      gamertag: articles.gamertag,
      slug: articles.slug,
    })
    .from(articles)
    .where(
      and(
        eq(articles.kind, "news"),
        eq(articles.status, "published"),
        sql`starts_with(${articles.naturalKey}, 'standing_dead:')`,
        sql`EXISTS (
          SELECT 1
          FROM ${sessions} s
          INNER JOIN ${players} p ON p.id = s.player_id
          WHERE s.server_id = ${articles.serverId}
            AND p.gamertag = ${articles.gamertag}
            AND s.connected_at > ${articles.createdAt}
        )`,
      ),
    )
    .limit(opts.limit);

  return rows.map((r) => ({
    articleId: r.articleId,
    naturalKey: r.naturalKey ?? "",
    gamertag: r.gamertag,
    slug: r.slug,
  }));
}

/** Move the given articles to `status='retracted'`. Separate from the finder so the sweep can sit
 *  behind NEWSDESK_DRY_RUN like every other write in this worker. */
export async function retractNewsArticles(db: Database, articleIds: number[]): Promise<void> {
  if (articleIds.length === 0) return;
  await db.update(articles).set({ status: "retracted" }).where(inArray(articles.id, articleIds));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `TEST_DATABASE_URL=... pnpm --filter @onelife/newsdesk exec vitest run test/news-retraction.test.ts test/news-pg-store.test.ts`
Expected: PASS (all tests in both files green).

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @onelife/newsdesk run typecheck`
Expected: no errors.

```bash
git add apps/newsdesk/src/news-pg-store.ts apps/newsdesk/test/news-retraction.test.ts
git commit -m "feat(newsdesk): retract a Standing Dead article when its subject comes back"
```

### Second cycle — make the retraction durable

- [ ] **Step 7: Write the failing durability test**

A **new, isolated** file, following the same reasoning as Task 12: `standing-dead-targets.test.ts`
and `long-form-targets.test.ts` filter their rows by `svc` suffix and assert exact arrays, so
seeding into them would break assertions that currently pass.

Each arm is asserted the same way, and deliberately without re-deriving a natural key by hand: run
the finder once to learn the key it produced, insert the row `retractNewsArticles` would leave
behind under exactly that key, then run the finder again.

Create `apps/newsdesk/test/news-antijoin-retracted.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, positions, articles } from "@onelife/db";
import { inArray } from "drizzle-orm";
import { findStandingDeadTargets, findLongFormTargets } from "../src/news-targets.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 59e7;
const t0 = new Date("2026-07-01T00:00:00.000Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3_600_000);
const NOW = hrs(200);
const SINCE = hrs(0);
const tag = (n: string) => `aj-${n}-${svc}`;
let serverId: number;
const pids: number[] = [];

const SD_OPTS = {
  now: NOW, since: SINCE, standingDeadHours: 72, minPlaytimeSeconds: 1800,
  minHitsAbsorbed: 100, suppressedGamertags: [] as string[], maxAttempts: 3, limit: 10,
};
const LF_OPTS = {
  since: SINCE, now: NOW, maxFixAgeSeconds: 120, suppressedGamertags: [] as string[],
  candidateLimit: 500, windowSeconds: 180, radiusMeters: 100, maxAttempts: 3, limit: 10,
};

const isMine = (g: string) => g.endsWith(`-${svc}`);

async function mkPlayer(name: string, lastSeenH: number) {
  const [p] = await db.insert(players).values({ gamertag: tag(name), lastSeenAt: hrs(lastSeenH) }).returning();
  pids.push(p!.id);
  return p!.id;
}

/** Exactly the row retractNewsArticles leaves behind: status='retracted', attempts BELOW
 *  maxAttempts, so the status is the only thing that can possibly block a re-publish. */
async function seedRetracted(naturalKey: string, gamertag: string) {
  await db.insert(articles).values({
    kind: "news", status: "retracted", naturalKey,
    serverId, gamertag, map: "chernarusplus", mapSlug: "chernarus",
    lifeNumber: 1, lifeStartedAt: hrs(1), deathAt: null,
    slug: `aj-${gamertag}`, headline: "H", lede: "L", body: "B",
    promptVersion: "news-v1", model: "test", attempts: 1, createdAt: hrs(150),
  });
}

beforeAll(async () => {
  const [s] = await db.insert(servers).values({
    nitradoServiceId: svc, name: "aj", map: "chernarusplus", slug: `aj-${svc}`, active: true,
  }).returning();
  serverId = s!.id;

  // ── One Standing Dead subject: a prior life earns coverage, the open life is qualified, and
  // the last session ended well over 72h before `now`. ──
  const sd = await mkPlayer("sd", 120);
  await db.insert(lives).values({
    serverId, playerId: sd, lifeNumber: 1, startedAt: hrs(0), endedAt: hrs(0.5),
    deathCause: "pvp", playtimeSeconds: 1800,
  });
  const [openLife] = await db.insert(lives).values({
    serverId, playerId: sd, lifeNumber: 2, startedAt: hrs(1), endedAt: null,
    deathCause: null, playtimeSeconds: 7200,
  }).returning();
  await db.insert(sessions).values({
    serverId, playerId: sd, lifeId: openLife!.id,
    connectedAt: hrs(100), disconnectedAt: hrs(120), durationSeconds: 7200, closeReason: "disconnect",
  });

  // ── One Long Form pair: two qualified deaths, same instant, same patch of ground. ──
  const la = await mkPlayer("lf-a", 60);
  const lb = await mkPlayer("lf-b", 60);
  await db.insert(lives).values([
    { serverId, playerId: la, lifeNumber: 1, startedAt: hrs(0), endedAt: hrs(60), deathCause: "infected", playtimeSeconds: 3600 },
    { serverId, playerId: lb, lifeNumber: 1, startedAt: hrs(0), endedAt: hrs(60), deathCause: "infected", playtimeSeconds: 3600 },
  ]);
  await db.insert(positions).values([
    { serverId, playerId: la, gamertag: tag("lf-a"), x: 7423.51, y: 9210.88, recordedAt: hrs(60) },
    { serverId, playerId: lb, gamertag: tag("lf-b"), x: 7443.19, y: 9245.02, recordedAt: hrs(60) },
  ]);
});

afterAll(async () => {
  await db.delete(articles).where(inArray(articles.serverId, [serverId]));
  await db.delete(positions).where(inArray(positions.serverId, [serverId]));
  await db.delete(sessions).where(inArray(sessions.serverId, [serverId]));
  await db.delete(lives).where(inArray(lives.serverId, [serverId]));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(inArray(servers.id, [serverId]));
  await sql.end();
});

// A retracted article must block re-selection in BOTH arms. Without this, the subject is still
// idle and the natural key is byte-identical, so every tick pays for a fresh model call to
// regenerate the identical feature and the sweep takes it straight back down — forever.
describe("the anti-join blocks a RETRACTED article — the Standing Dead arm", () => {
  let key = "";

  it("selects the subject while no article exists", async () => {
    const mine = (await findStandingDeadTargets(db, SD_OPTS)).filter((t) => isMine(t.gamertag));
    const found = mine.find((t) => t.gamertag === tag("sd"));
    expect(found).toBeDefined();
    key = found!.naturalKey;
  });

  it("stops selecting it once its article is retracted", async () => {
    await seedRetracted(key, tag("sd"));
    const mine = (await findStandingDeadTargets(db, SD_OPTS)).filter((t) => isMine(t.gamertag));
    expect(mine.map((t) => t.gamertag)).not.toContain(tag("sd"));
  });
});

describe("the anti-join blocks a RETRACTED article — the Long Form arm", () => {
  let key = "";
  const mineClusters = <T extends { subjects: { gamertag: string }[] }>(cs: T[]) =>
    cs.filter((c) => c.subjects.some((s) => isMine(s.gamertag)));

  it("builds the cluster while no article exists", async () => {
    const found = mineClusters((await findLongFormTargets(db, LF_OPTS)).clusters);
    expect(found).toHaveLength(1);
    key = found[0]!.naturalKey;
  });

  it("stops building it once its article is retracted", async () => {
    // Long Form subjects are dead and are never swept, so this row can only arrive by hand —
    // but the two predicates are kept identical on purpose, so that they cannot drift.
    await seedRetracted(key, tag("lf-a"));
    expect(mineClusters((await findLongFormTargets(db, LF_OPTS)).clusters)).toEqual([]);
  });
});
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `TEST_DATABASE_URL=... pnpm --filter @onelife/newsdesk exec vitest run test/news-antijoin-retracted.test.ts`
Expected: FAIL — the two "stops selecting/building it" tests fail, because the anti-join gates on
`status = 'published'` and a retracted row does not match it.

- [ ] **Step 9: Widen the anti-join in both targeting files**

The one sanctioned change to the PR-C1 targeting layer. In
`apps/newsdesk/src/standing-dead-targets.ts`, replace:

```ts
      inArray(articles.naturalKey, targets.map((t) => t.naturalKey)),
      sql`(${articles.status} = 'published' OR ${articles.attempts} >= ${opts.maxAttempts})`,
```

with:

```ts
      inArray(articles.naturalKey, targets.map((t) => t.naturalKey)),
      // 'retracted' blocks too, and that is load-bearing rather than tidy. A retracted Standing
      // Dead article keeps its natural key, and its subject keeps satisfying the idle predicate —
      // so on a 'published'-only test the next tick would spend a paid model call regenerating
      // the identical feature, and the retraction sweep at the end of that same tick would take
      // it down again, every tick, forever. Spec §4.1.3: the prose is never regenerated.
      sql`(${articles.status} IN ('published','retracted') OR ${articles.attempts} >= ${opts.maxAttempts})`,
```

Then in `apps/newsdesk/src/long-form-targets.ts`, replace:

```ts
      inArray(articles.naturalKey, keys),
      sql`(${articles.status} = 'published' OR ${articles.attempts} >= ${opts.maxAttempts})`,
```

with:

```ts
      inArray(articles.naturalKey, keys),
      // Kept byte-for-byte identical to the Standing Dead anti-join so the two cannot drift. A
      // Long Form subject is dead and is never swept, so 'retracted' is unreachable here today —
      // one predicate, one meaning, is worth more than the one term it saves.
      sql`(${articles.status} IN ('published','retracted') OR ${articles.attempts} >= ${opts.maxAttempts})`,
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `TEST_DATABASE_URL=... pnpm --filter @onelife/newsdesk exec vitest run test/news-antijoin-retracted.test.ts test/standing-dead-targets.test.ts test/long-form-targets.test.ts test/standing-dead-key.test.ts test/long-form-cluster.test.ts`
Expected: PASS (all tests in all five files green). The four PR-C1 files are the blast radius of
the widening and must be re-run with it: none of them seeds a `retracted` row, so none should
change behaviour.

- [ ] **Step 11: Typecheck and commit**

Run: `pnpm --filter @onelife/newsdesk run typecheck`
Expected: no errors.

```bash
git add apps/newsdesk/src/standing-dead-targets.ts apps/newsdesk/src/long-form-targets.ts apps/newsdesk/test/news-antijoin-retracted.test.ts
git commit -m "fix(newsdesk): a retracted article blocks re-coverage in both targeting arms"
```

---

## Task 8: `generateNews`

**Files:**
- Modify: `apps/newsdesk/src/generate.ts`
- Test: `apps/newsdesk/test/generate.test.ts`

**Interfaces:**
- Consumes: `NewsFacts` (Task 3); `buildNewsPrompt` / `parseNewsArticle` / `NewsArticle` (Task 5); the existing `CompletionClient`.
- Produces: `export async function generateNews(client: CompletionClient, facts: NewsFacts, recent?: RecentProse[]): Promise<NewsArticle>`. Task 9 calls it.

- [ ] **Step 1: Write the failing test**

First fold the two new imports into the existing import block at the top of
`apps/newsdesk/test/generate.test.ts` — ESM hoists, so appending them at the bottom would work, but
it reads as an accident. Replace:

```ts
import { generateObituary, generateBirthNotice, type CompletionClient } from "../src/generate.js";
import type { ObituaryFacts } from "../src/facts.js";
import type { BirthFacts } from "../src/birth-facts.js";
```

with:

```ts
import { generateObituary, generateBirthNotice, generateNews, type CompletionClient } from "../src/generate.js";
import type { ObituaryFacts } from "../src/facts.js";
import type { BirthFacts } from "../src/birth-facts.js";
import type { NewsFacts } from "../src/news-facts.js";
```

Then append to the end of `apps/newsdesk/test/generate.test.ts`:

```ts
const newsFacts: NewsFacts = {
  trigger: "standing_dead", map: "sakhal", mapSlug: "sakhal",
  idleHours: 96, timeAliveSeconds: 5600, hitsAbsorbed: 137, lifeNumber: 3,
  priors: { livesLived: 2, longestLifeSeconds: 900, totalKills: 4,
    usualDeathCause: null, lastDeathCause: null, bestLifeMap: null },
  subjectCount: 1, allFreshSubjects: false,
  naturalKey: "standing_dead:7:GenTest:2026-07-11T00:00:00.000Z", serverId: 7,
  primaryGamertag: "GenTest",
  subjects: [{
    gamertag: "GenTest", map: "sakhal", mapSlug: "sakhal", lifeNumber: 3,
    lifeStartedAt: "2026-07-11T00:00:00.000Z", endedAt: null,
    timeAliveSeconds: 5600, timeAliveLabel: "1h 33m", kills: 0, sessions: 4,
    persona: "Lewis", deathCause: null,
    priors: { livesLived: 2, longestLifeSeconds: 900, totalKills: 4,
      usualDeathCause: null, lastDeathCause: null, bestLifeMap: null },
    isKnownQuantity: true, isFresh: false,
  }],
  lastSeenAt: "2026-07-14T00:00:00.000Z", eligibleAt: "2026-07-17T00:00:00.000Z",
  idleSeconds: 345_600, earliestDeathAt: null, spanSeconds: null,
};

describe("generateNews", () => {
  it("sends the Newsroom prompt and returns a parsed article with a derived body", async () => {
    let sent: { system: string; user: string } | null = null;
    const article = await generateNews({
      complete: async (req) => {
        sent = req;
        return JSON.stringify({
          headline: "H", lede: "L",
          blocks: [{ type: "para", text: "One." }, { type: "subhead", text: "S" }, { type: "para", text: "Two." }],
          pullQuote: null, tags: [],
        });
      },
    }, newsFacts);
    expect(sent!.system).toMatch(/The Newsroom/);
    expect(sent!.user).toContain("GenTest");
    expect(article.body).toBe("One.\n\nTwo.");
    expect(article.blocks).toHaveLength(3);
  });

  it("propagates a client failure so the tick can write a stub", async () => {
    await expect(generateNews({ complete: async () => { throw new Error("api boom"); } }, newsFacts))
      .rejects.toThrow(/api boom/);
  });

  it("propagates a parse failure the same way", async () => {
    await expect(generateNews({ complete: async () => "not json" }, newsFacts))
      .rejects.toThrow(/was not JSON/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/newsdesk exec vitest run test/generate.test.ts`
Expected: FAIL — `"../src/generate.js" does not provide an export named 'generateNews'`.

- [ ] **Step 3: Write the implementation**

In `apps/newsdesk/src/generate.ts`, replace:

```ts
import type { RecentProse } from "./prose-pg-store.js";
```

with:

```ts
import type { NewsFacts } from "./news-facts.js";
import { buildNewsPrompt, parseNewsArticle, type NewsArticle } from "./news-prompt.js";
import type { RecentProse } from "./prose-pg-store.js";
```

Then append at the end of the file:

```ts
/** News-pass sibling of generateObituary: build the Newsroom prompt, call the model, parse the
 *  block union and DERIVE `body` from the para blocks. Throws on client or parse failure. */
export async function generateNews(
  client: CompletionClient,
  facts: NewsFacts,
  recent: RecentProse[] = [],
): Promise<NewsArticle> {
  const { system, user } = buildNewsPrompt(facts, recent);
  const raw = await client.complete({ system, user });
  return parseNewsArticle(raw);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @onelife/newsdesk exec vitest run test/generate.test.ts`
Expected: PASS (all tests in the file green).

- [ ] **Step 5: Commit**

```bash
git add apps/newsdesk/src/generate.ts apps/newsdesk/test/generate.test.ts
git commit -m "feat(newsdesk): generateNews"
```

---

## Task 9: `news-tick.ts` — the pass

**Files:**
- Create: `apps/newsdesk/src/news-tick.ts`
- Test: `apps/newsdesk/test/news-tick.test.ts`

**Interfaces:**
- Consumes: `findStandingDeadTargets` / `findLongFormTargets` from `./news-targets.js` (the barrel — **never** the two implementation files); `getLifeTimeline` / `getPlayerPriors` / `LifeTimeline` / `PlayerPriors` from `@onelife/read-models`; `buildStandingDeadFacts` / `buildLongFormFacts` (Task 3); `composeNewsTags` (Task 5); `generateNews` (Task 8); `publishNews` / `recordNewsFailure` / `findReturnedStandingDead` / `retractNewsArticles` (Tasks 6–7); `recentProse`; `dedupePullQuote`; `NewsdeskDeps` from `./tick.js`.
- Produces:
  - `export type NewsTickDeps`
  - `export type NewsTickResult`
  - `export function longFormSkipLog(skipped: Record<string, number>): Record<string, number>`
  - `export async function newsTick(db: Database, deps: NewsTickDeps): Promise<NewsTickResult>`

  Task 10 wires these into `main.ts`.

**Decision — `unqualified_subject` is dropped from the log line (PR-C1 ledger obligation 1).**
`applyLongFormExclusions` returns four counters, but the qualified gate lives in the candidate SQL
(`long-form-targets.ts`), so an unqualified death is a *candidate never selected* and can never
reach cluster construction. The counter is therefore **structurally always 0**. Rendering it in the
§14 observability line would read as "no cluster was ever dropped for being unqualified" — a claim
the number cannot support, and precisely the kind of quiet lie the operator would rely on when
asking "why did the Long Form not fire this week". The alternative — pairing it with a SQL-layer
filtered count — would require changing `findLongFormCandidates`' return shape, which this PR is
forbidden from doing. So: `longFormSkipLog` projects the three counters that **can** be non-zero,
the omission is commented at the projection, and a test pins the exact key set so a future author
cannot quietly reintroduce the zero.

- [ ] **Step 1: Write the failing test**

Create `apps/newsdesk/test/news-tick.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, hitEvents, articles } from "@onelife/db";
import { and, eq, inArray } from "drizzle-orm";
import { newsTick, longFormSkipLog } from "../src/news-tick.js";
import type { CompletionClient } from "../src/generate.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 57e7;
const t0 = new Date("2026-07-01T00:00:00.000Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3_600_000);
const NOW = hrs(200);
const SINCE = hrs(0);
const tag = (n: string) => `nt-${n}-${svc}`;
let serverId: number;
const pids: number[] = [];
const log = { info: () => {}, error: () => {} };

/** An idle, qualified, earned-coverage open life — the canonical Standing Dead subject. */
async function seedStandingDead(name: string, connectedAtH: number, disconnectedAtH: number) {
  const [p] = await db.insert(players).values({ gamertag: tag(name), lastSeenAt: hrs(disconnectedAtH) }).returning();
  pids.push(p!.id);
  // a prior life satisfies the earned-coverage clause without needing 100 hit rows
  await db.insert(lives).values({
    serverId, playerId: p!.id, lifeNumber: 1, startedAt: hrs(0), endedAt: hrs(0.5),
    deathCause: "pvp", playtimeSeconds: 1800,
  });
  const [l] = await db.insert(lives).values({
    serverId, playerId: p!.id, lifeNumber: 2, startedAt: hrs(1), endedAt: null,
    deathCause: null, playtimeSeconds: 7200,
  }).returning();
  await db.insert(sessions).values({
    serverId, playerId: p!.id, lifeId: l!.id,
    connectedAt: hrs(connectedAtH), disconnectedAt: hrs(disconnectedAtH),
    durationSeconds: 7200, closeReason: "disconnect",
  });
  return l!.id;
}

const okBody = JSON.stringify({
  headline: "Nobody Has Seen Him Since Tuesday",
  lede: "The record simply stops.",
  blocks: [{ type: "para", text: "One." }, { type: "subhead", text: "S" }, { type: "para", text: "Two." }],
  pullQuote: { text: "q", attribution: "an unnamed witness" },
  tags: ["Fog"],
});
const okClient = (): CompletionClient => ({ complete: async () => okBody });
const failClient = (): CompletionClient => ({ complete: async () => { throw new Error("api boom"); } });
function counted(client: CompletionClient) {
  let n = 0;
  return { client: { complete: (r: { system: string; user: string }) => { n++; return client.complete(r); } }, count: () => n };
}

const deps = (over: Partial<Parameters<typeof newsTick>[1]> = {}) => ({
  client: okClient(), dryRun: false, batchCap: 10, maxAttempts: 3,
  promptVersion: "news-v1", model: "test", now: NOW, log,
  enabled: true, since: SINCE, maxPerTick: 2,
  standingDeadHours: 72, minPlaytimeSeconds: 1800, minHitsAbsorbed: 100,
  suppressedGamertags: [] as string[],
  windowSeconds: 180, radiusMeters: 100, maxFixAgeSeconds: 120,
  ...over,
});

const newsRows = () => db.select().from(articles).where(and(eq(articles.serverId, serverId), eq(articles.kind, "news")));

beforeAll(async () => {
  const [s] = await db.insert(servers).values({
    nitradoServiceId: svc, name: "nt", map: "chernarusplus", slug: `nt-${svc}`, active: true,
  }).returning();
  serverId = s!.id;
});
afterAll(async () => {
  await db.delete(articles).where(eq(articles.serverId, serverId));
  await db.delete(hitEvents).where(eq(hitEvents.serverId, serverId));
  await db.delete(sessions).where(eq(sessions.serverId, serverId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(eq(servers.id, serverId));
  await sql.end();
});

describe("newsTick — the two off-states", () => {
  it("enabled=false: zeros, no model call, no write", async () => {
    await seedStandingDead("off-a", 100, 120);
    const c = counted(okClient());
    const r = await newsTick(db, deps({ client: c.client, enabled: false }));
    expect(r.generated).toBe(0);
    expect(r.failed).toBe(0);
    expect(r.standingDeadFound).toBe(0);
    expect(r.longFormFound).toBe(0);
    expect(r.retracted).toBe(0);
    expect(c.count()).toBe(0);
    expect(await newsRows()).toHaveLength(0);
  });

  it("since=null: zeros, no model call, no write", async () => {
    const c = counted(okClient());
    const r = await newsTick(db, deps({ client: c.client, since: null }));
    expect(r.generated).toBe(0);
    expect(r.standingDeadFound).toBe(0);
    expect(c.count()).toBe(0);
    expect(await newsRows()).toHaveLength(0);
  });

  it("reports a zeroed skip record in both off-states rather than an absent one", async () => {
    // BOTH, literally: `!deps.enabled || deps.since === null` is two disjuncts, and a test that
    // exercised one of them would pass against a guard that had lost the other.
    const off = await newsTick(db, deps({ enabled: false }));
    expect(off.longFormSkipped).toEqual({ self_cluster: 0, suicide_subject: 0, suppressed_gamertag: 0 });
    const noCutoff = await newsTick(db, deps({ since: null }));
    expect(noCutoff.longFormSkipped).toEqual({ self_cluster: 0, suicide_subject: 0, suppressed_gamertag: 0 });
  });
});

describe("newsTick — dry run", () => {
  it("finds targets but never calls the model and never writes", async () => {
    const c = counted(okClient());
    const r = await newsTick(db, deps({ client: c.client, dryRun: true }));
    expect(r.dryRun).toBe(true);
    expect(r.standingDeadFound).toBeGreaterThanOrEqual(1);
    expect(r.generated).toBe(0);
    expect(c.count()).toBe(0);
    expect(await newsRows()).toHaveLength(0);
  });
});

describe("newsTick — the Standing Dead arm", () => {
  it("publishes a news article and is idempotent on re-run", async () => {
    const r1 = await newsTick(db, deps());
    expect(r1.generated).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(articles)
      .where(and(eq(articles.serverId, serverId), eq(articles.gamertag, tag("off-a"))));
    expect(row!.kind).toBe("news");
    expect(row!.status).toBe("published");
    expect(row!.naturalKey).toMatch(/^standing_dead:/);
    expect(row!.body).toBe("One.\n\nTwo.");
    expect(row!.bodyBlocks).toHaveLength(3);
    expect(row!.tags).toEqual(["News", "Chernarus", "The Standing Dead", "Fog"]);
    expect(row!.deathAt).toBeNull();

    const before = (await newsRows()).length;
    await newsTick(db, deps());
    expect((await newsRows()).length).toBe(before);   // the anti-join blocks a republish
  });

  it("honours maxPerTick", async () => {
    await seedStandingDead("cap-a", 100, 120);
    await seedStandingDead("cap-b", 101, 121);
    await seedStandingDead("cap-c", 102, 122);
    const r = await newsTick(db, deps({ maxPerTick: 2 }));
    expect(r.generated).toBe(2);
  });

  it("isolates a failure into a stub and dedupes the stub across ticks", async () => {
    await seedStandingDead("fail", 103, 123);
    const key = `standing_dead:${serverId}:${tag("fail")}:${hrs(1).toISOString()}`;
    await newsTick(db, deps({ client: failClient(), maxPerTick: 10 }));
    const first = await db.select().from(articles).where(eq(articles.naturalKey, key));
    expect(first).toHaveLength(1);
    expect(first[0]!.status).toBe("failed");
    expect(first[0]!.attempts).toBe(1);
    expect(first[0]!.naturalKey).toBe(key);

    await newsTick(db, deps({ client: failClient(), maxPerTick: 10 }));
    const second = await db.select().from(articles).where(eq(articles.naturalKey, key));
    expect(second).toHaveLength(1);            // spec §12.4: ONE row, attempts = 2
    expect(second[0]!.attempts).toBe(2);
  });

  it("drops a suppressed gamertag before it reaches the model", async () => {
    // Asserted on THIS subject by name, never on a global count. Earlier tests in this file leave
    // `cap-c` and `fail` at attempts=2, which is below maxAttempts=3, so they are legitimately
    // still selectable — a `standingDeadFound === 0` assertion would be measuring their state,
    // not the suppression list. Do not "fix" a failure here by raising maxAttempts or reordering
    // the tests; both re-couple this test to its predecessor's leftovers.
    await seedStandingDead("suppressed", 104, 124);
    await newsTick(db, deps({ maxPerTick: 10, suppressedGamertags: [tag("suppressed").toUpperCase()] }));
    const rows = await db.select().from(articles).where(eq(articles.gamertag, tag("suppressed")));
    expect(rows).toHaveLength(0);
  });
});

describe("newsTick — retraction", () => {
  it("de-publishes an article whose subject came back, and never in dry run", async () => {
    const [row] = await db.select().from(articles)
      .where(and(eq(articles.serverId, serverId), eq(articles.gamertag, tag("off-a"))));
    const [p] = await db.select().from(players).where(eq(players.gamertag, tag("off-a")));
    const [l] = await db.select().from(lives).where(eq(lives.playerId, p!.id));
    await db.insert(sessions).values({
      serverId, playerId: p!.id, lifeId: l!.id,
      connectedAt: new Date(row!.createdAt.getTime() + 3_600_000), disconnectedAt: null,
      durationSeconds: 60, closeReason: null,
    });

    const dry = await newsTick(db, deps({ dryRun: true }));
    expect(dry.retracted).toBe(1);             // REPORTED
    const [stillUp] = await db.select().from(articles).where(eq(articles.id, row!.id));
    expect(stillUp!.status).toBe("published"); // but NOT written

    const live = await newsTick(db, deps());
    expect(live.retracted).toBe(1);
    const [down] = await db.select().from(articles).where(eq(articles.id, row!.id));
    expect(down!.status).toBe("retracted");
  });

  it("the retraction is DURABLE — a later tick never regenerates the feature", async () => {
    // The end-to-end form of the widened anti-join (Task 7 Steps 7-11). The subject is still idle
    // and their natural key is unchanged, so on a 'published'-only anti-join this tick would spend
    // a model call rewriting the identical article and the sweep would retract it again — one paid
    // call per tick, forever, and the piece never visible. Every other subject in this file is
    // published or retracted by now, so the correct model-call count for this tick is exactly 0.
    const [row] = await db.select().from(articles)
      .where(and(eq(articles.serverId, serverId), eq(articles.gamertag, tag("off-a"))));
    const c = counted(okClient());
    const again = await newsTick(db, deps({ client: c.client }));
    expect(c.count()).toBe(0);
    expect(again.generated).toBe(0);
    const [still] = await db.select().from(articles).where(eq(articles.id, row!.id));
    expect(still!.status).toBe("retracted");
    expect(still!.headline).toBe("Nobody Has Seen Him Since Tuesday");
  });
});

describe("longFormSkipLog", () => {
  it("renders exactly the three reasons that can be non-zero", () => {
    // `unqualified_subject` is dropped on purpose: the qualified gate lives in the candidate SQL,
    // so applyLongFormExclusions can never increment it. A permanently-zero counter in an
    // observability line is a lie the operator would act on.
    expect(Object.keys(longFormSkipLog({
      self_cluster: 4, suicide_subject: 1, unqualified_subject: 0, suppressed_gamertag: 2,
    })).sort()).toEqual(["self_cluster", "suicide_subject", "suppressed_gamertag"]);
  });

  it("preserves the counts it does render and defaults a missing one to 0", () => {
    expect(longFormSkipLog({ self_cluster: 4, suicide_subject: 1, unqualified_subject: 9, suppressed_gamertag: 2 }))
      .toEqual({ self_cluster: 4, suicide_subject: 1, suppressed_gamertag: 2 });
    expect(longFormSkipLog({})).toEqual({ self_cluster: 0, suicide_subject: 0, suppressed_gamertag: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `TEST_DATABASE_URL=... pnpm --filter @onelife/newsdesk exec vitest run test/news-tick.test.ts`
Expected: FAIL — `Failed to resolve import "../src/news-tick.js"`.

- [ ] **Step 3: Write the deps, the result, and the skip projection**

Create `apps/newsdesk/src/news-tick.ts` with this first half:

```ts
import type { Database } from "@onelife/db";
import { getLifeTimeline, getPlayerPriors } from "@onelife/read-models";
import type { LifeTimeline, PlayerPriors } from "@onelife/read-models";
import { findStandingDeadTargets, findLongFormTargets } from "./news-targets.js";
import { buildStandingDeadFacts, buildLongFormFacts } from "./news-facts.js";
import type { NewsFacts } from "./news-facts.js";
import { composeNewsTags } from "./news-prompt.js";
import { generateNews } from "./generate.js";
import {
  publishNews, recordNewsFailure, findReturnedStandingDead, retractNewsArticles,
} from "./news-pg-store.js";
import { recentProse } from "./prose-pg-store.js";
import { dedupePullQuote } from "./prose-backstop.js";
import type { NewsdeskDeps } from "./tick.js";

/** Every threshold is required, never defaulted — main.ts must pass the operator's configuration
 *  or fail to compile. A silently-defaulted 72h in two places is how tuning drifts. */
export type NewsTickDeps = NewsdeskDeps & {
  enabled: boolean;
  since: Date | null;
  maxPerTick: number;
  standingDeadHours: number;
  minPlaytimeSeconds: number;
  minHitsAbsorbed: number;
  suppressedGamertags: string[];
  windowSeconds: number;
  radiusMeters: number;
  maxFixAgeSeconds: number;
};

/** Spec §14 observability: targets found, published, failed, and skipped-by-exclusion with
 *  per-reason counts. Without the last one, "why did the Long Form not fire this week" is
 *  unanswerable. */
export type NewsTickResult = {
  standingDeadFound: number;
  longFormFound: number;
  generated: number;
  failed: number;
  skipped: number;                              // target found but its timeline would not load
  retracted: number;
  longFormSkipped: Record<string, number>;
  dryRun: boolean;
};

/** How many recently published news articles the model is shown as do-not-reuse material.
 *  Fetched ONCE per tick, not per article — the block is the same for every target in the batch. */
const RECENT_PROSE_LIMIT = 12;

/** Over-fetch bound for the Long Form candidate query. Deliberately NOT an env var: it bounds one
 *  SQL read rather than any editorial behaviour, and at the verified fire rate (~1 clean cluster
 *  per week) 200 candidate deaths is several weeks of material. */
const LONG_FORM_CANDIDATE_LIMIT = 200;

/**
 * Project the exclusion counters onto the ones that can actually be non-zero.
 *
 * `unqualified_subject` is DROPPED. applyLongFormExclusions returns it, but the qualified gate
 * lives in the candidate SQL (long-form-targets.ts) — an unqualified death is a "candidate never
 * selected" and can never reach cluster construction, so the counter is structurally always 0.
 * Printing a permanently-zero counter in the observability line reads as "no cluster was ever
 * dropped for being unqualified", which is a claim the number cannot support and which an
 * operator debugging a silent week would act on. The honest alternative — pairing it with the
 * SQL-layer filtered count — needs a return-shape change in the PR-C1 targeting layer, which this
 * PR must not touch.
 */
export function longFormSkipLog(skipped: Record<string, number>): Record<string, number> {
  return {
    self_cluster: skipped.self_cluster ?? 0,
    suicide_subject: skipped.suicide_subject ?? 0,
    suppressed_gamertag: skipped.suppressed_gamertag ?? 0,
  };
}

const emptySkips = (): Record<string, number> =>
  ({ self_cluster: 0, suicide_subject: 0, suppressed_gamertag: 0 });
```

- [ ] **Step 4: Write `newsTick`**

Append to `apps/newsdesk/src/news-tick.ts`:

```ts
/**
 * One news cycle, the fourth sibling of newsdeskTick. TWO independent off-states, both returning
 * before any query and before any model call:
 *   - `enabled` is the NEWSDESK_NEWS_ENABLED kill switch (opt-in; default off);
 *   - `since === null` is an unset/invalid NEWSDESK_NEWS_SINCE (forward-only cutoff, gated on the
 *     ELIGIBILITY instant — see spec §4.1.3 — not on lives.started_at).
 * Both ship off, so this release is inert in production until an operator sets them.
 *
 * Everything past that gate is behind `dryRun` as well, including the retraction sweep: in a dry
 * run nothing was ever published, so there is nothing real to take down.
 */
export async function newsTick(db: Database, deps: NewsTickDeps): Promise<NewsTickResult> {
  if (!deps.enabled || deps.since === null) {
    return {
      standingDeadFound: 0, longFormFound: 0, generated: 0, failed: 0, skipped: 0,
      retracted: 0, longFormSkipped: emptySkips(), dryRun: deps.dryRun,
    };
  }

  const standing = await findStandingDeadTargets(db, {
    now: deps.now,
    since: deps.since,
    standingDeadHours: deps.standingDeadHours,
    minPlaytimeSeconds: deps.minPlaytimeSeconds,
    minHitsAbsorbed: deps.minHitsAbsorbed,
    suppressedGamertags: deps.suppressedGamertags,
    maxAttempts: deps.maxAttempts,
    limit: deps.maxPerTick,
  });

  const long = await findLongFormTargets(db, {
    since: deps.since,
    now: deps.now,
    maxFixAgeSeconds: deps.maxFixAgeSeconds,
    suppressedGamertags: deps.suppressedGamertags,
    candidateLimit: LONG_FORM_CANDIDATE_LIMIT,
    windowSeconds: deps.windowSeconds,
    radiusMeters: deps.radiusMeters,
    maxAttempts: deps.maxAttempts,
    limit: deps.maxPerTick,
  });

  let generated = 0;
  let failed = 0;
  let skipped = 0;

  // One query for the whole batch. Skipped entirely in dry-run — nothing is generated, so the
  // do-not-reuse material would go unused.
  const hasTargets = standing.length + long.clusters.length > 0;
  const recent = deps.dryRun || !hasTargets ? [] : await recentProse(db, "news", RECENT_PROSE_LIMIT);

  /** Shared tail: generate, dedupe the attribution, compose the reserved tags, publish. A failure
   *  writes a stub against the SAME natural key and is isolated to this one target. */
  const runOne = async (facts: NewsFacts): Promise<void> => {
    try {
      const article = await generateNews(deps.client, facts, recent);
      // Deterministic backstop behind the do-not-reuse prompt block: a recycled attribution loses
      // its byline rather than re-seeding the phrase for the next tick.
      const deduped = dedupePullQuote(article, recent);
      // Reserved tags (News / map / trigger) are composed deterministically; the LLM contributes
      // at most one flavor tag.
      const tagged = { ...deduped, tags: composeNewsTags(facts, deduped.tags) };
      await publishNews(db, {
        facts,
        article: tagged,
        promptVersion: deps.promptVersion,
        model: deps.model,
        now: deps.now,
      });
      generated++;
    } catch (e) {
      await recordNewsFailure(db, { facts, error: e instanceof Error ? e.message : String(e) });
      deps.log.error?.({ err: e, naturalKey: facts.naturalKey }, "news generation failed (will retry)");
      failed++;
    }
  };

  // ── The Standing Dead: one open, qualified life whose owner has gone quiet. ──
  for (const t of standing) {
    const timeline = await getLifeTimeline(db, t.serverId, t.gamertag, t.lifeId);
    if (!timeline) {
      skipped++;
      continue;
    }
    const priors = await getPlayerPriors(db, t.gamertag, t.lifeStartedAt);
    const facts = buildStandingDeadFacts(t, timeline, priors);
    if (deps.dryRun) {
      deps.log.info(
        { trigger: "standing_dead", gamertag: t.gamertag, map: t.map, idleSeconds: t.idleSeconds,
          priorLives: t.priorLives, hitsAbsorbed: t.hitsAbsorbed },
        "DRY RUN: would generate a Standing Dead feature",
      );
      continue;
    }
    await runOne(facts);
  }

  // ── The Long Form: a clique of qualified deaths sharing a minute and a patch of ground. ──
  for (const c of long.clusters) {
    const per = new Map<string, { timeline: LifeTimeline; priors: PlayerPriors }>();
    let incomplete = false;
    for (const s of c.subjects) {
      const timeline = await getLifeTimeline(db, s.serverId, s.gamertag, s.lifeId);
      if (!timeline) {
        // Publishing a shared-fate story that silently omits one of the people in it is worse
        // than not publishing it. The whole cluster is skipped, and its natural key stays
        // unclaimed so a later tick can retry it whole.
        incomplete = true;
        break;
      }
      per.set(s.gamertag, { timeline, priors: await getPlayerPriors(db, s.gamertag, s.lifeStartedAt) });
    }
    if (incomplete) {
      skipped++;
      continue;
    }
    const facts = buildLongFormFacts(c, per);
    if (deps.dryRun) {
      deps.log.info(
        { trigger: "long_form", gamertags: c.subjects.map((s) => s.gamertag), map: c.map,
          spanSeconds: facts.spanSeconds, allFreshSubjects: facts.allFreshSubjects },
        "DRY RUN: would generate a Long Form feature",
      );
      continue;
    }
    await runOne(facts);
  }

  // ── Retraction (spec §4.1.3). Reported in a dry run, written only for real. ──
  //
  // The sweep is GLOBAL AND UNBOUNDED IN TIME by design: it is not scoped to the servers this tick
  // looked at and has no created_at floor, so it rescans the whole published standing_dead
  // back-catalogue every tick. That is correct — a subject can return at any distance from
  // publication, and a scoped sweep would silently strand articles on quiet servers. `batchCap`
  // bounds the result, and at the verified corpus size (~7 subjects) the scan is trivial. If the
  // catalogue ever grows enough to matter, add a created_at floor knowingly, not by accident.
  //
  // The sweep also runs AFTER the generate loop, so an article published in THIS tick whose
  // subject reconnected between the target query and the publish is retracted immediately, in the
  // same tick. That is intended: the article was false the moment it was written, and it is better
  // taken down before anyone sees it than left up for one interval. It costs one model call, which
  // is the price of the race and not a bug to be tuned away.
  const returned = await findReturnedStandingDead(db, { limit: deps.batchCap });
  for (const r of returned) {
    deps.log.info(
      { articleId: r.articleId, naturalKey: r.naturalKey, gamertag: r.gamertag, slug: r.slug, dryRun: deps.dryRun },
      deps.dryRun
        ? "DRY RUN: would retract a Standing Dead feature — the subject came back"
        : "retracting a Standing Dead feature — the subject came back",
    );
  }
  if (!deps.dryRun) await retractNewsArticles(db, returned.map((r) => r.articleId));

  const result: NewsTickResult = {
    standingDeadFound: standing.length,
    longFormFound: long.clusters.length,
    generated,
    failed,
    skipped,
    retracted: returned.length,
    longFormSkipped: longFormSkipLog(long.skipped),
    dryRun: deps.dryRun,
  };
  // Logged UNCONDITIONALLY while the pass is enabled, unlike the sibling ticks which log only on
  // activity. Spec §14 requires the per-reason skip counts every tick: a silent week is exactly
  // the case the operator needs the numbers for, and the pass is off by default anyway.
  deps.log.info(result, "news tick");
  return result;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `TEST_DATABASE_URL=... pnpm --filter @onelife/newsdesk exec vitest run test/news-tick.test.ts`
Expected: PASS (all tests in the file green).

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @onelife/newsdesk run typecheck`
Expected: no errors.

```bash
git add apps/newsdesk/src/news-tick.ts apps/newsdesk/test/news-tick.test.ts
git commit -m "feat(newsdesk): the newsTick pass (both triggers, retraction, ships off)"
```

---

## Task 10: Wire the pass into `main.ts`

**Files:**
- Modify: `apps/newsdesk/src/main.ts`

**Interfaces:**
- Consumes: `newsTick` / `NewsTickDeps` (Task 9); `NEWS_PROMPT_VERSION` (Task 5); the ten config fields (Task 1).
- Produces: nothing importable. Thin wiring — untested by repo convention.

- [ ] **Step 1: Add the imports**

In `apps/newsdesk/src/main.ts`, replace:

```ts
import { imageTick } from "./image-tick.js";
```

with:

```ts
import { imageTick } from "./image-tick.js";
import { newsTick } from "./news-tick.js";
```

and replace:

```ts
import { BIRTH_PROMPT_VERSION } from "./birth-prompt.js";
```

with:

```ts
import { BIRTH_PROMPT_VERSION } from "./birth-prompt.js";
import { NEWS_PROMPT_VERSION } from "./news-prompt.js";
```

- [ ] **Step 2: Add the startup log lines**

Replace:

```ts
  if (!cfg.imagesEnabled) log.warn("NEWSDESK_IMAGES_ENABLED=false — the article-image pass is OFF.");
```

with:

```ts
  if (!cfg.imagesEnabled) log.warn("NEWSDESK_IMAGES_ENABLED=false — the article-image pass is OFF.");
  if (!cfg.newsEnabled) {
    log.warn("NEWSDESK_NEWS_ENABLED is not 'true' — the news pass is OFF.");
  } else if (cfg.newsSince === null) {
    log.warn("NEWSDESK_NEWS_ENABLED is on but NEWSDESK_NEWS_SINCE is unset — the news pass is still OFF. Set it to an ISO-8601 go-live timestamp to begin coverage.");
  } else {
    log.info(
      {
        newsSince: cfg.newsSince.toISOString(),
        maxPerTick: cfg.newsMaxPerTick,
        standingDeadHours: cfg.standingDeadHours,
        minPlaytimeSeconds: cfg.standingDeadMinPlaytimeSeconds,
        minHitsAbsorbed: cfg.standingDeadMinHits,
        longFormWindowSeconds: cfg.longFormWindowSeconds,
        longFormRadiusMeters: cfg.longFormRadiusMeters,
        longFormMaxFixAgeSeconds: cfg.longFormMaxFixAgeSeconds,
        suppressedGamertags: cfg.newsSuppressedGamertags.length,
      },
      "news pass is on (forward-only from this cutoff)",
    );
  }
```

- [ ] **Step 3: Add the try/catch sibling**

The news pass runs **before** the image pass so a feature published this tick can pick up its hero
photo in the same tick — news is the only image-eligible kind, and `findImageTargets` orders newest
first. Replace:

```ts
    // Image pass (both kinds; a no-op when NEWSDESK_IMAGES_ENABLED=false).
    try {
```

with:

```ts
    // News pass (a no-op when the kill switch is off or newsSince is null — newsTick
    // short-circuits to zeros before touching the DB or the model).
    try {
      const nr = await newsTick(db, {
        client,
        dryRun: cfg.dryRun,
        batchCap: cfg.batchCap,
        maxAttempts: cfg.maxAttempts,
        promptVersion: NEWS_PROMPT_VERSION,
        model: cfg.model,
        now: new Date(),
        log,
        enabled: cfg.newsEnabled,
        since: cfg.newsSince,
        maxPerTick: cfg.newsMaxPerTick,
        standingDeadHours: cfg.standingDeadHours,
        minPlaytimeSeconds: cfg.standingDeadMinPlaytimeSeconds,
        minHitsAbsorbed: cfg.standingDeadMinHits,
        suppressedGamertags: cfg.newsSuppressedGamertags,
        windowSeconds: cfg.longFormWindowSeconds,
        radiusMeters: cfg.longFormRadiusMeters,
        maxFixAgeSeconds: cfg.longFormMaxFixAgeSeconds,
      });
      // newsTick already emits its own §14 observability line when it is enabled; nothing to
      // re-log here. `nr` is referenced so the result is not silently discarded by a linter.
      if (nr.failed) log.warn({ failed: nr.failed }, "news tick had failures");
    } catch (err) {
      log.error({ err }, "news tick failed");
    }

    // Image pass (both kinds; a no-op when NEWSDESK_IMAGES_ENABLED=false).
    try {
```

- [ ] **Step 4: Typecheck and commit**

Run: `pnpm --filter @onelife/newsdesk run typecheck`
Expected: no errors. (A missing threshold in the deps object fails here — that is the point of
`NewsTickDeps` having no defaults.)

Run: `pnpm --filter @onelife/newsdesk run test`
Expected: the whole newsdesk suite passes.

```bash
git add apps/newsdesk/src/main.ts
git commit -m "feat(newsdesk): wire newsTick into the worker loop (off by default)"
```

---

## Task 11: The §11 hard rails

Six rails, asserted as tests rather than prose. Five are structural properties of a **built**
`NewsFacts` object; one is a token test over the prompt. Two of them (`lastExpressiveEmote`, the
`priors` key names) are the only thing standing between a cut design decision and a future author
quietly reintroducing it.

**Files:**
- Create: `apps/newsdesk/test/news-rails.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–5. Adds no source.

- [ ] **Step 1: Write the test**

Create `apps/newsdesk/test/news-rails.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { PlayerPriors, LifeTimeline } from "@onelife/read-models";
import { buildStandingDeadFacts, buildLongFormFacts } from "../src/news-facts.js";
import type { StandingDeadTarget } from "../src/standing-dead-targets.js";
import { buildLongFormClusters } from "../src/long-form-cluster.js";
import type { DeathCandidate } from "../src/long-form-cluster.js";
import { buildNewsPrompt, NEWS_PROMPT_VERSION } from "../src/news-prompt.js";

/** Every key at every depth of a built object. The Fog Rule, the no-row-ids rule and the cut
 *  emote slot are all key-PRESENCE properties: a value regex like /\d{4}\.\d/ misses a short
 *  coordinate (e.g. x=812.4) and misses a null field entirely. */
function keysDeep(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) {
    for (const e of v) keysDeep(e, out);
    return out;
  }
  if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out.add(k);
      keysDeep(val, out);
    }
  }
  return out;
}

const priors = (over: Partial<PlayerPriors> = {}): PlayerPriors => ({
  livesLived: 0, longestLifeSeconds: 0, totalKills: 0,
  usualDeathCause: null, lastDeathCause: null, bestLifeMap: null, ...over,
});

function timeline(playtimeSeconds: number) {
  return {
    life: { startedAt: new Date("2026-07-11T00:00:00Z"), endedAt: null, playtimeSeconds, deathCause: null },
    sessions: [{}, {}], kills: [], character: { name: "Lewis" },
    qualifiedAt: null, verdict: null, ordeals: null, hpLow: null,
  } as unknown as LifeTimeline;
}

const sdTarget: StandingDeadTarget = {
  lifeId: 987_654, serverId: 7, gamertag: "GabeFox101",
  map: "chernarusplus", mapSlug: "chernarus", lifeNumber: 3,
  lifeStartedAt: new Date("2026-07-11T00:00:00Z"), playtimeSeconds: 5600,
  lastSeenAt: new Date("2026-07-18T00:00:00Z"),
  eligibleAt: new Date("2026-07-21T00:00:00Z"),
  idleSeconds: 4 * 86_400, priorLives: 2, hitsAbsorbed: 137,
  naturalKey: "standing_dead:7:GabeFox101:2026-07-11T00:00:00.000Z",
};

// SOURCE rows that genuinely carry coordinates, including a SHORT one that a four-digit regex
// would sail straight past.
const cand = (over: Partial<DeathCandidate>): DeathCandidate => ({
  lifeId: 555_111, serverId: 7, gamertag: "A", map: "chernarusplus", mapSlug: "chernarus",
  lifeNumber: 1, lifeStartedAt: new Date("2026-07-11T00:00:00Z"),
  endedAt: new Date("2026-07-11T01:00:00Z"), deathCause: "infected",
  x: 812.4, y: 9210.88, fixAt: new Date("2026-07-11T01:00:00Z"), ...over,
});

function longFormFacts() {
  const a = cand({ lifeId: 555_111, gamertag: "CUPID18", x: 812.4, y: 9210.88 });
  const b = cand({ lifeId: 555_222, gamertag: "GabeFox101", x: 838.1, y: 9245.02,
    endedAt: new Date("2026-07-11T01:00:27Z"), deathCause: "died" });
  const [cluster] = buildLongFormClusters([a, b], { windowSeconds: 180, radiusMeters: 100 });
  return buildLongFormFacts(cluster!, new Map([
    ["CUPID18", { timeline: timeline(6660), priors: priors() }],
    ["GabeFox101", { timeline: timeline(6700), priors: priors() }],
  ]));
}

const sdFacts = () => buildStandingDeadFacts(sdTarget, timeline(5600), priors({ livesLived: 2, totalKills: 4 }));

describe("RAIL — the Fog Rule, asserted on the OUTPUT", () => {
  it("a built NewsFacts has no coordinate-shaped key, for either trigger", () => {
    const forbidden = /^(x|y|z|lat|lng|lon|coord|coords|coordinate|coordinates|pos|position|positions|fix|fixat|grid|landmark|region|town|locale|route|bearing|heading|distancemeters|distancemetres|radius|metres|meters)$/i;
    for (const facts of [sdFacts(), longFormFacts()]) {
      const offenders = [...keysDeep(facts)].filter((k) => forbidden.test(k));
      expect(offenders).toEqual([]);
    }
  });

  it("the SOURCE rows really did carry coordinates — the rail is not vacuous", () => {
    const c = cand({});
    expect(typeof c.x).toBe("number");
    expect(typeof c.y).toBe("number");
    const facts = longFormFacts();
    const blob = JSON.stringify(facts);
    expect(blob).not.toContain("812.4");      // short coordinate a /\d{4}\.\d/ regex would miss
    expect(blob).not.toContain("9210.88");
    expect(blob).not.toMatch(/\d{4}\.\d/);
  });

  it("no rendered prompt leaks a coordinate either", () => {
    for (const facts of [sdFacts(), longFormFacts()]) {
      const { user } = buildNewsPrompt(facts);
      expect(user).not.toContain("812.4");
      expect(user).not.toContain("9210.88");
      expect(user).not.toMatch(/\d{4}\.\d/);
    }
  });
});

describe("RAIL — EmoteSuicide never reaches a fact payload", () => {
  it("no emote-shaped key exists anywhere in a built NewsFacts", () => {
    // STRUCTURAL, by design. The expressive-emote slot of spec §4.1.4 was CUT: the allowlist
    // covers ~49 events corpus-wide (no signal), and reaching it means reading events.payload —
    // the same column holding the coordinates the rail above exists to keep out. With no emote
    // field at all, EmoteSuicide cannot reach a payload by any path.
    for (const facts of [sdFacts(), longFormFacts()]) {
      expect([...keysDeep(facts)].filter((k) => /emote/i.test(k))).toEqual([]);
    }
    expect(JSON.stringify(longFormFacts())).not.toMatch(/emote/i);
  });
});

describe("RAIL — never print wall-clock as survival time", () => {
  it("uses playtime_seconds even when the wall clock is 30x larger", () => {
    // The life began 2026-07-11 and was last seen 2026-07-18: 7 wall-clock days against 5600
    // seconds of actual play. Publishing the calendar figure as endurance would be the paper's
    // first outright lie.
    const f = sdFacts();
    expect(f.timeAliveSeconds).toBe(5600);
    expect(f.subjects[0]!.timeAliveSeconds).toBe(5600);
    const blob = JSON.stringify(f);
    expect(blob).not.toContain("604800");   // 7 days in seconds
    // Idle time is present, but ONLY under its own explicitly-named fields.
    expect(f.idleSeconds).toBe(345_600);
    const { user } = buildNewsPrompt(f);
    expect(user).toMatch(/1h 33m/);
    expect(user).toMatch(/IDLE TIME/);
    expect(user).toMatch(/never present the calendar gap as time survived/i);
  });
});

describe("RAIL — no row ids in durable fields", () => {
  it("a built NewsFacts carries no lives.id / players.id, only rebuild-stable identity", () => {
    // `articles` survives `deploy.sh --rebuild`; `lives` and `players` do not. A persisted row id
    // is a dangling pointer the first time anyone rebuilds the projections.
    const forbidden = /^(id|lifeid|playerid|articleid|killid|sessionid|characterid)$/i;
    for (const facts of [sdFacts(), longFormFacts()]) {
      expect([...keysDeep(facts)].filter((k) => forbidden.test(k))).toEqual([]);
    }
  });

  it("the transient lifeId on the TARGET really exists — the rail is not vacuous", () => {
    expect(sdTarget.lifeId).toBe(987_654);
    expect(JSON.stringify(sdFacts())).not.toContain("987654");
    expect(JSON.stringify(longFormFacts())).not.toContain("555111");
    expect(JSON.stringify(longFormFacts())).not.toContain("555222");
  });

  it("`serverId` IS allowed — `servers` is durable and is not truncated by a rebuild", () => {
    expect(sdFacts().serverId).toBe(7);
  });
});

describe("RAIL — gamertags verbatim", () => {
  it("never lowercases a gamertag in the key or the facts", () => {
    const f = sdFacts();
    expect(f.primaryGamertag).toBe("GabeFox101");
    expect(f.subjects[0]!.gamertag).toBe("GabeFox101");
    expect(f.naturalKey).toContain("GabeFox101");
    expect(f.naturalKey).not.toContain("gabefox101");
  });
});

describe("RAIL — forbidden real-player framing", () => {
  it("every prompt bans the four framings by name plus second-person address", () => {
    for (const facts of [sdFacts(), longFormFacts()]) {
      const lower = buildNewsPrompt(facts).user.toLowerCase();
      for (const token of ["the player", "logged off", "stopped playing", "lost interest"]) {
        expect(lower).toContain(token);
      }
      expect(lower).toContain("second person");
    }
  });
});

describe("RAIL — the prompt version is pinned", () => {
  it("is exactly news-v1", () => {
    expect(NEWS_PROMPT_VERSION).toBe("news-v1");
  });
});
```

- [ ] **Step 2: Run the rails**

Run: `pnpm --filter @onelife/newsdesk exec vitest run test/news-rails.test.ts`
Expected: PASS (all tests in the file green). **Every one of these should pass on the first run** — the rails describe
properties Tasks 3–5 were written to have. A failure here is a real defect in those tasks, not a
missing implementation; fix the source, never the assertion.

- [ ] **Step 3: Commit**

```bash
git add apps/newsdesk/test/news-rails.test.ts
git commit -m "test(newsdesk): the R5d §11 hard rails"
```

---

## Task 12: The three boundary tests PR-C1 deferred

Cross-server **at the SQL layer** (the clique builder already covers it in memory; the query that
feeds it does not), the **exact** `maxFixAgeSeconds` boundary (only "older than" is covered today),
and the **upper `now` bound** (uncovered entirely).

A **new** file with its own isolated `svc`, servers and players. `long-form-targets.test.ts` filters
its rows with `gamertag.endsWith('-' + svc)` and asserts exact arrays, so seeding new fixtures into
it would break assertions that currently pass — the exact class of defect this plan is written to
avoid.

**Files:**
- Create: `apps/newsdesk/test/long-form-boundaries.test.ts`

**Interfaces:**
- Consumes: `findLongFormCandidates` / `findLongFormTargets` from `../src/long-form-targets.js`. Adds no source, changes no behaviour.

- [ ] **Step 1: Write the test**

Create `apps/newsdesk/test/long-form-boundaries.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, positions, articles } from "@onelife/db";
import { inArray } from "drizzle-orm";
import { findLongFormCandidates, findLongFormTargets } from "../src/long-form-targets.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 58e7;
const t0 = new Date("2026-07-11T00:00:00.000Z");
const mins = (m: number) => new Date(t0.getTime() + m * 60_000);
const secs = (s: number) => new Date(t0.getTime() + s * 1000);
const tag = (n: string) => `lb-${n}-${svc}`;
let serverA: number;
let serverB: number;
const pids: number[] = [];

async function mkPlayer(name: string) {
  const [p] = await db.insert(players).values({ gamertag: tag(name), lastSeenAt: mins(600) }).returning();
  pids.push(p!.id);
  return p!.id;
}

beforeAll(async () => {
  const [a] = await db.insert(servers).values({
    nitradoServiceId: svc, name: "lbA", map: "chernarusplus", slug: `lba-${svc}`, active: true,
  }).returning();
  const [b] = await db.insert(servers).values({
    nitradoServiceId: svc + 1, name: "lbB", map: "sakhal", slug: `lbb-${svc}`, active: true,
  }).returning();
  serverA = a!.id;
  serverB = b!.id;

  // ── Cross-server pair: same instant, same coordinates, DIFFERENT servers. ──
  const xa = await mkPlayer("xserver-a");
  const xb = await mkPlayer("xserver-b");
  // ── Fix-age boundary: fix EXACTLY maxFixAgeSeconds (120s) before the death -> IN. ──
  const edgeIn = await mkPlayer("fix-edge-in");
  // ── Fix-age boundary: fix 121s before the death -> OUT. ──
  const edgeOut = await mkPlayer("fix-edge-out");
  // ── Upper `now` bound: a death exactly at `now` -> IN; one a second later -> OUT. ──
  const nowIn = await mkPlayer("now-in");
  const nowOut = await mkPlayer("now-out");

  await db.insert(lives).values([
    { serverId: serverA, playerId: xa, lifeNumber: 1, startedAt: mins(0), endedAt: mins(60), deathCause: "infected", playtimeSeconds: 3600 },
    { serverId: serverB, playerId: xb, lifeNumber: 1, startedAt: mins(0), endedAt: mins(60), deathCause: "infected", playtimeSeconds: 3600 },
    { serverId: serverA, playerId: edgeIn,  lifeNumber: 1, startedAt: mins(0), endedAt: secs(6000), deathCause: "infected", playtimeSeconds: 3600 },
    { serverId: serverA, playerId: edgeOut, lifeNumber: 1, startedAt: mins(0), endedAt: secs(6000), deathCause: "infected", playtimeSeconds: 3600 },
    { serverId: serverA, playerId: nowIn,  lifeNumber: 1, startedAt: mins(0), endedAt: mins(300), deathCause: "infected", playtimeSeconds: 3600 },
    { serverId: serverA, playerId: nowOut, lifeNumber: 1, startedAt: mins(0), endedAt: secs(18_001), deathCause: "infected", playtimeSeconds: 3600 },
  ]);

  await db.insert(positions).values([
    { serverId: serverA, playerId: xa, gamertag: tag("xserver-a"), x: 7423.51, y: 9210.88, recordedAt: mins(60) },
    { serverId: serverB, playerId: xb, gamertag: tag("xserver-b"), x: 7423.51, y: 9210.88, recordedAt: mins(60) },
    // exactly 120s stale — the guard is `fix.recorded_at >= ended_at - 120s`, INCLUSIVE
    { serverId: serverA, playerId: edgeIn,  gamertag: tag("fix-edge-in"),  x: 100.0, y: 100.0, recordedAt: secs(5880) },
    // 121s stale — one second past
    { serverId: serverA, playerId: edgeOut, gamertag: tag("fix-edge-out"), x: 100.0, y: 100.0, recordedAt: secs(5879) },
    { serverId: serverA, playerId: nowIn,  gamertag: tag("now-in"),  x: 200.0, y: 200.0, recordedAt: mins(300) },
    { serverId: serverA, playerId: nowOut, gamertag: tag("now-out"), x: 200.0, y: 200.0, recordedAt: secs(18_001) },
  ]);
});

afterAll(async () => {
  await db.delete(articles).where(inArray(articles.serverId, [serverA, serverB]));
  await db.delete(positions).where(inArray(positions.serverId, [serverA, serverB]));
  await db.delete(lives).where(inArray(lives.serverId, [serverA, serverB]));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(inArray(servers.id, [serverA, serverB]));
  await sql.end();
});

const OPTS = {
  since: t0, now: mins(300), maxFixAgeSeconds: 120,
  suppressedGamertags: [] as string[], candidateLimit: 500,
};
const T_OPTS = { ...OPTS, windowSeconds: 180, radiusMeters: 100, maxAttempts: 3, limit: 5 };
const mine = <T extends { gamertag: string }>(rows: T[]): T[] =>
  rows.filter((r) => r.gamertag.endsWith(`-${svc}`));

describe("Long Form — cross-server, at the SQL layer", () => {
  it("selects both deaths as candidates", async () => {
    const tags = mine(await findLongFormCandidates(db, OPTS)).map((r) => r.gamertag);
    expect(tags).toContain(tag("xserver-a"));
    expect(tags).toContain(tag("xserver-b"));
  });

  it("never clusters them together — identical instant, identical coordinates, two servers", async () => {
    // buildLongFormClusters buckets by serverId in memory; this pins that the QUERY feeding it
    // preserves the distinction rather than collapsing rows from two servers into one bucket.
    const r = await findLongFormTargets(db, T_OPTS);
    const mixed = r.clusters.filter((c) =>
      c.subjects.some((s) => s.gamertag === tag("xserver-a")) &&
      c.subjects.some((s) => s.gamertag === tag("xserver-b")));
    expect(mixed).toEqual([]);
  });
});

describe("Long Form — the fix-age guard is inclusive at exactly maxFixAgeSeconds", () => {
  it("admits a fix exactly 120s before the death", async () => {
    const tags = mine(await findLongFormCandidates(db, OPTS)).map((r) => r.gamertag);
    expect(tags).toContain(tag("fix-edge-in"));
  });

  it("drops a fix 121s before the death", async () => {
    const tags = mine(await findLongFormCandidates(db, OPTS)).map((r) => r.gamertag);
    expect(tags).not.toContain(tag("fix-edge-out"));
  });
});

describe("Long Form — the upper `now` bound", () => {
  it("admits a death at exactly `now`", async () => {
    const tags = mine(await findLongFormCandidates(db, OPTS)).map((r) => r.gamertag);
    expect(tags).toContain(tag("now-in"));
  });

  it("drops a death one second after `now`", async () => {
    // Not hypothetical: `now` is passed per tick, and a projector fold running concurrently can
    // land a death with a timestamp past the instant this tick claimed to be reporting.
    const tags = mine(await findLongFormCandidates(db, OPTS)).map((r) => r.gamertag);
    expect(tags).not.toContain(tag("now-out"));
  });
});
```

- [ ] **Step 2: Run it**

Run: `TEST_DATABASE_URL=... pnpm --filter @onelife/newsdesk exec vitest run test/long-form-boundaries.test.ts`
Expected: PASS (all tests in the file green). These describe behaviour PR-C1 already implemented, so they should pass
without any source change. A failure is a real defect in the PR-C1 query — report it rather than
adjusting the fixture.

- [ ] **Step 3: Commit**

```bash
git add apps/newsdesk/test/long-form-boundaries.test.ts
git commit -m "test(newsdesk): Long Form cross-server, fix-age and upper-now boundaries"
```

---

## Task 13: CHANGELOG, CLAUDE.md, and the full-suite gate

The workflow guard blocks `gh pr create` without **both** files updated, and spec §14 puts the
CLAUDE.md edit in PR-C specifically.

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run the whole suite before writing any prose**

Run: `pnpm turbo run typecheck`
Expected: no errors across the monorepo.

Run: `TEST_DATABASE_URL=... pnpm turbo run test --concurrency=1`
Expected: green. Pay particular attention to `partial-index-upsert.test.ts`, `migration-0014.test.ts`
and `image-pg-store.test.ts` — the three PR-B/PR-C1 guards this PR is most able to break.

- [ ] **Step 2: Update `CHANGELOG.md`**

Replace:

```
## [Unreleased]

### Added
### Changed
### Deprecated
### Removed
### Fixed
### Security
```

with:

```
## [Unreleased]

### Added
- R5d PR-C2 — the `newsTick` pass, **shipped disabled**. The fifth `apps/newsdesk` sweep turns the
  PR-C1 Standing Dead and Long Form targets into published `kind='news'` features. Until an
  operator sets **both** `NEWSDESK_NEWS_ENABLED=true` and an ISO `NEWSDESK_NEWS_SINCE` there is
  **no article row, no model call, and no external write**; either unset short-circuits the tick to
  zeros before it touches the database or the model, and `NEWSDESK_DRY_RUN` still gates every write
  on top of that.
  New files: `news-facts.ts` (the frozen `NewsFacts` snapshot for both triggers),
  `news-voice.ts` (the Newsroom register, vendored from the brand bible's three new tone rows —
  The Standing Dead; The Long Form, fresh subjects; The Long Form, any subject geared),
  `news-prompt.ts` (`news-v1`, both trigger arms, the block-union parse), `news-pg-store.ts`
  (slug, publish, failure stub, retraction) and `news-tick.ts`.
- Rich body for news: the model emits `blocks` only and `body` is **derived** post-parse as the
  `para` blocks joined by a blank line, so the OG card and meta description can never quote text
  that is not on the page. Zod validates shape only — it caps block and list counts and imposes no
  minimum length, because length is funded by fact density and a floor is a padding instruction.
- Retraction (spec §4.1.3): a published Standing Dead feature whose subject has a session that
  connected after the article was created moves to `status='retracted'`. The row is never deleted,
  so the prose and its hero image survive rather than cascade away; `findImageTargets` already
  filters `status='published'`, so a retracted feature can never acquire a photo.
- Ten new environment variables, all documented in `.env.example`: `NEWSDESK_NEWS_ENABLED`,
  `NEWSDESK_NEWS_SINCE`, `NEWSDESK_NEWS_MAX_PER_TICK` (2), `NEWSDESK_NEWS_SUPPRESSED_GAMERTAGS`,
  `NEWSDESK_STANDING_DEAD_HOURS` (72), `NEWSDESK_STANDING_DEAD_MIN_PLAYTIME_SECONDS` (1800),
  `NEWSDESK_STANDING_DEAD_MIN_HITS` (100), `NEWSDESK_LONGFORM_WINDOW_SECONDS` (180),
  `NEWSDESK_LONGFORM_RADIUS_METERS` (100), `NEWSDESK_LONGFORM_MAX_FIX_AGE_SECONDS` (120).
  The spec said seven; the three Long Form knobs are required non-defaulted fields of
  `LongFormTargetOpts` and cannot be hardcoded at the call site without pinning tuning into source.
- Tests for the spec §11 hard rails, asserted on built objects rather than sources: no
  coordinate-shaped key at any depth (over a fixture whose source rows carry a deliberately SHORT
  coordinate a four-digit regex would miss), no emote-shaped key at all, no projection row id,
  playtime-not-wall-clock, gamertags verbatim, and the forbidden real-player framings as a token
  test. Plus the three boundary cases PR-C1 deferred: Long Form cross-server at the SQL layer, the
  inclusive `maxFixAgeSeconds` edge, and the upper `now` bound.

### Changed
- `NEWSROOM_CATEGORIES`' `eligible` predicates now read through a typed accessor over a published
  `NewsImageFacts` type instead of bare keys on an untyped `Record`. A rename on either side is now
  a compile error; previously a drift between what the facts builder wrote and what a gate read
  failed **closed and silent** — the gate simply never fired and the imagery was quietly
  impoverished, with no error anywhere.
- `apps/newsdesk/src/config.ts`'s `parseBirthSince` becomes the shared `parseSince`, so the birth
  and news cutoffs cannot drift in parsing behaviour.

### Deprecated
### Removed
- The "last expressive emote" slot of spec §4.1.4 is cut before it shipped. The allowlist covers
  roughly 49 events corpus-wide, so it carries no signal, and reaching it means querying
  `events.payload` — the same column holding the 5,633 coordinate rows the Fog Rule exists to keep
  off this boundary. `NewsFacts` has no emote field, which is now asserted structurally.

### Fixed
- The news anti-join in `standing-dead-targets.ts` and `long-form-targets.ts` now blocks on
  `status IN ('published','retracted')`, not `status = 'published'`. A retracted Standing Dead
  article keeps its natural key and its subject keeps satisfying the idle predicate, so the
  narrower predicate would have regenerated the identical feature — a paid model call — on every
  tick, only for the retraction sweep at the end of that same tick to take it down again. Spec
  §4.1.3 requires that the prose is never regenerated; retraction durability comes from this
  predicate, not from the row continuing to exist.
- `packages/db/src/schema.ts`'s `kind` column comment said `'obituary' | 'birth_notice'`; it has
  admitted `'news'` since migration `0014`. Its `status` comment likewise said `published|failed`
  and now admits `retracted`.

### Security
```

- [ ] **Step 3: Update `CLAUDE.md` — the R5d roadmap line**

Replace:

```
  **R5d in flight, PR-C1 (inert engine) shipped.** The news vertical's targeting layer and image
  prerequisites exist but **nothing calls them** — production output is byte-identical. Two trigger
```

with:

```
  **R5d in flight, PR-C1 (inert engine) + PR-C2 (`newsTick`, shipped disabled) done.** The news
  vertical's targeting layer, image prerequisites and worker pass all exist; there is still **no
  article row, no model call, and no external write**, because the pass is off unless an operator
  sets **both** `NEWSDESK_NEWS_ENABLED=true` and an ISO `NEWSDESK_NEWS_SINCE`. Two trigger
```

- [ ] **Step 4: Update `CLAUDE.md` — the PR-C2 description**

Replace:

```
  Inertness is guaranteed by `findImageTargets`' `notInArray(articles.kind, ["obituary",
  "birth_notice"])` plus the fact that nothing writes a `kind='news'` row yet — asserted directly
  in `image-pg-store.test.ts`. PR-C2 (`newsTick`, shipped OFF) and PR-C3 (API + web) follow.
```

with:

```
  Image eligibility is `findImageTargets`' `notInArray(articles.kind, ["obituary",
  "birth_notice"])`, so a published news row becomes image-eligible automatically — enabling the
  news pass therefore also un-dormants `imageTick`.
  **PR-C2 shipped — `newsTick`, disabled.** `apps/newsdesk/src/news-tick.ts` is the fifth pass:
  Standing Dead arm → Long Form arm → retraction sweep, each target failure-isolated into a
  `status='failed'` stub. **Two independent off-states** (`NEWSDESK_NEWS_ENABLED !== "true"`, or an
  unset/invalid `NEWSDESK_NEWS_SINCE`) return zeros *before* any query and any model call, and
  `NEWSDESK_DRY_RUN` gates every write on top. `NewsFacts` (`news-facts.ts`) is the frozen
  `articles.facts` snapshot for both triggers and is declared as
  `NewsImageFacts & {…}` — intersecting the image menu's fact vocabulary, so a builder that stops
  emitting a gated field is a **compile error** rather than an image gate that silently stops
  firing. **News dedupes on `natural_key`, not the life tuple**, so both its upserts pass
  `targetWhere: isNotNull(articles.naturalKey)` (`articles_natural_key_uniq` is partial —
  `WHERE natural_key IS NOT NULL`); the **failure stub writes the key too**, or every retry would
  insert a fresh row forever. The slug is **trigger-prefixed** (`standing-dead-…` / `long-form-…`)
  so a feature about the same life as an obituary cannot collide on `articles_slug_uniq`.
  **Rich body:** the model emits `blocks` only and `body` is derived as the `para` blocks joined
  by a blank line, so the share card can never quote text that is not on the page; zod validates
  shape only and **never a minimum length** (§5 — length is funded by fact density, and a floor is
  a padding instruction that would also burn an attempt on a thin cluster).
  **Retraction:** a published `standing_dead` article whose subject has a session that *connected*
  after `created_at` moves to `status='retracted'` — never deleted, so the prose and its hero image
  survive rather than cascade away (and `findImageTargets` filters `status='published'`, so it can
  never acquire a photo). **Durability comes from the anti-join, not from the row existing:** the
  PR-C1 predicate in `standing-dead-targets.ts` / `long-form-targets.ts` was widened — the sole
  sanctioned change to that layer — from `status = 'published'` to
  `status IN ('published','retracted')`. Narrow it back and the pass regenerates the identical
  feature every tick (a paid model call each time) only for the sweep to retract it again, forever;
  spec §4.1.3 requires that the prose is never regenerated.
  **The expressive-emote slot of §4.1.4 was cut** — ~49 events
  corpus-wide is no signal, and reaching it means querying `events.payload`, the coordinate column;
  `NewsFacts` has no emote field, asserted structurally. `unqualified_subject` is **omitted from
  the observability log line**: the qualified gate lives in the candidate SQL, so the counter is
  structurally always 0 and printing it would be a lie an operator would act on.
  PR-C3 (read-model + API + web surface) follows.
```

- [ ] **Step 5: Update `CLAUDE.md` — the newsdesk app entry**

Replace:

```
  `newsdesk` (obituary + birth-notice generation sweep, run as **four passes** each interval;
```

with:

```
  `newsdesk` (obituary + birth-notice + news generation sweep, run as **five passes** each interval
  — obituary, birth notice, Discord notify, news (off by default), images;
```

- [ ] **Step 6: Re-run the suite and commit**

Run: `pnpm turbo run typecheck && TEST_DATABASE_URL=... pnpm turbo run test --concurrency=1`
Expected: green.

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: changelog + CLAUDE.md for R5d PR-C2"
```

---

## Rollout notes (for the PR description, not a code task)

- **No `--rebuild`.** Migration `0014` already shipped in PR-B; this PR adds no migration.
- **Ten env vars must reach the host's `onelife-newsdesk` unit.** Deploying without them leaves the
  pass off, which is the intended default.
- **Sequence (spec §14):** deploy with `NEWSDESK_NEWS_ENABLED` unset → set it to `true` with
  `NEWSDESK_NEWS_SINCE` and `NEWSDESK_DRY_RUN=true` for one interval → read the log and eyeball the
  selected subjects by hand → set `NEWSDESK_DRY_RUN=false`.
- **Enabling news also un-dormants `imageTick`**, because `findImageTargets` excludes only
  `obituary` and `birth_notice`. News is the only image-eligible kind, by design (spec §7). Budget
  for it: roughly $0.004 per article all-in at the default quality. `NEWSDESK_IMAGES_ENABLED=false`
  turns it off independently if that is not wanted on day one.
- **Put the dev account in `NEWSDESK_NEWS_SUPPRESSED_GAMERTAGS` before going live.** It accounts for
  27 of 46 suicides and 4 of the 6 verified Long Form pairs in the reference dump.
- **Expect a small paper.** After the earned-coverage clause and the four exclusions the verified
  corpus is ~7 Standing Dead subjects and ~1 Long Form cluster per seven days. The Long Form may go
  multiple weeks dark; that is not a bug to be tuned away, and widening the window only admits
  dev-account noise.

---

## Self-review

**1. Spec coverage.**

| Spec section | Covered by |
|---|---|
| §4.1 Standing Dead predicate | PR-C1 (unchanged); thresholds plumbed in Tasks 1, 9 |
| §4.1.3 eligibility, idempotency, retraction | Tasks 6, 7, 9 |
| §4.1.4 Fog Rule, stricter | Tasks 3, 4, 5, 11 — emote slot cut (deviation 1) |
| §4.2 Long Form predicate + exclusions | PR-C1 (unchanged); plumbed in Tasks 1, 9; boundaries in Task 12 |
| §4.2 fresh-subject tone branch | Task 3 (`allFreshSubjects`), Task 5 (prompt branch), Task 4 (voice) |
| §5 length as a consequence | Task 4 (target range, no floor), Task 5 (zod shape-only), tested in both |
| §5 forbidden real-player framing | Tasks 4, 5, 11 |
| §6 natural key, slug, serialization, rebuild stability | Tasks 3, 6, 11 |
| §8 rich body, derived `body` | Tasks 4, 5, 6 |
| §9 the pass | Tasks 9, 10 |
| §11 hard rails | Task 11 |
| §12 testing priorities 2–6 | Tasks 7, 9, 11, 12 (priority 1 — the partial-index regression — already ships; re-run in Task 6 step 6) |
| §13.3 subject suppression | Tasks 1, 9 |
| §14 rollout, observability, workflow | Tasks 1, 9, 13 + the rollout notes |

**Not covered, by instruction:** §9's read-model, API routes and web surface (PR-C3); §7's
`ArticleHero` `accent: "ink"` widening and the interior render (PR-C3); §12 priority 7
(`eligibleCategories` throws) and priority 8 (`ArticleBody`) — both already ship, in
`image-categories.test.ts` and PR-B respectively. §10 is PR-A, shipped.

**Not covered, by decision:** the §4.1.4 emote slot and `totalDistanceCovered` (deviations 1 and 2).

**2. Placeholder scan.** No `TBD`, no "similar to Task N", no "add appropriate error handling". Every
code-changing step carries the literal code. Every edit is anchored on quoted source, never a line
number.

**3. Type consistency.** `NewsFacts` / `NewsSubject` / `NewsArticle` / `NewsTickDeps` /
`NewsTickResult` / `ReturnedSubject` / `PublishNewsInput` are each declared once and referenced by
those exact names thereafter. `newsSlug` takes five arguments at both its declaration (Task 6) and
its only call site (Task 6's `publishNews`). `buildLongFormFacts`' second parameter is a
`Map<string, { timeline; priors }>` keyed by gamertag in Task 3, in Task 9's call site, and in every
fixture. `NewsImageFacts.idleHours` is `number | null` in Task 2's declaration, Task 2's fixture and
Task 3's builders.

**4. Sequential-edit audit** — every "before" snippet matches the file state at the moment its task
runs:

- `config.ts` — Task 1 only. Its four replacements are disjoint regions of the original file.
- `image-categories.ts` / `image-categories.test.ts` / `image-scene.test.ts` — Task 2 only. Step 5's
  predicate table replaces lines that Steps 3–4 did not touch (Step 3 inserts above
  `MORGUE_CATEGORIES`; Step 4 replaces the comment block immediately above `NEWSROOM_CATEGORIES`).
  The eighth predicate, `conditions-noted`, is anchored on its **unique preceding comment** rather
  than the table, because its `eligible:` line is byte-identical to the Nursery's
  `adverse-conditions` line and a `replace_all` would rewrite that gate silently and still pass
  every test.
- `news-pg-store.ts` — Tasks 6 and 7. Task 7 Step 3 quotes the **three-line import block exactly as
  Task 6 Step 3 wrote it**, and Step 4 is a pure append after `recordNewsFailure`, the last function
  Task 6 created. Nothing in Task 7 re-quotes a Task 6 body.
- `standing-dead-targets.ts` / `long-form-targets.ts` — Task 7 Step 9 only, one two-line anchor each,
  quoted from the PR-C1 source as it stands on the branch. No earlier task touches either file.
- `generate.ts` — Task 8 only: one import replacement plus an append.
- `main.ts` — Task 10 only. Steps 1–3 target four disjoint anchors; Step 3's anchor
  (`// Image pass (both kinds; …)` + `try {`) is untouched by Steps 1–2, and Step 2's anchor (the
  `imagesEnabled` warn line) sits above it.
- `schema.ts` — Task 6 Step 5 only.
- `.env.example` — Task 1 Step 8 only.
- `generate.test.ts` — Task 8 only: one import-block replacement plus an append. `CHANGELOG.md` /
  `CLAUDE.md` — Task 13 only; its three CLAUDE.md anchors are in three different paragraphs.
- No task deletes or rewrites a branch introduced by an earlier task.

**4b. Retraction durability.** Task 7 ships the sweep (Steps 1–6) and its durability (Steps 7–11) in
two commits inside one task, so the widened anti-join lands before Task 9's `newsTick` regression
depends on it. Three tests hold the property at three levels: `news-retraction.test.ts` (the sweep
writes `retracted`), `news-antijoin-retracted.test.ts` (both targeting arms stop selecting a
retracted key), and `news-tick.test.ts` (a later tick makes zero model calls and leaves the row
retracted with its original headline). Task 7 Step 10 re-runs the four PR-C1 targeting suites as
the widening's blast radius; none of them seeds a `retracted` row.

**5. Right-sizing.** Thirteen tasks. Each ends with an independently testable deliverable and a
commit. Tasks 11 and 12 are test-only on purpose: they assert properties of code written earlier and
a reviewer can reject them without rejecting the implementation.
