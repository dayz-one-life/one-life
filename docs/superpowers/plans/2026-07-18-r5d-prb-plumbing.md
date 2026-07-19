# R5d PR-B — plumbing (migration, upsert guards, shared body renderer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the R5d news-vertical plumbing — migration `0014` (`natural_key`, `body_blocks`, a created-at feed index, and a partial life unique index), the four matching `targetWhere` upsert guards, a shared `ArticleBody` block renderer wired through the read-models — plus one escalated deploy-gating fix so a death whose cause names no mechanism is categorised `unknown` and tagged **Unknown**, not **Environment**.

**Architecture:** Five workstreams execute strictly in order on one branch. W1 fixes the `causeCategory` derivation in `apps/newsdesk/src/facts.ts` (relocating the shared `isUnrecordedCause` predicate out of `prompt.ts`) and reconciles the image-category gates with the reclassified population. W2 adds the schema + hand-written migration; W3 repairs the four `onConflictDoUpdate` sites that the now-partial unique index breaks — the tree is deliberately red between them, and that red state must never be pushed. W4 introduces the `ArticleBlock` union, the shared `ArticleBody` component, and the read-model `bodyBlocks` passthrough; W5 writes CHANGELOG + CLAUDE.md and runs the full verification gate before opening the PR.

**Tech Stack:** TypeScript/ESM monorepo (pnpm + turbo), Postgres 16 + Drizzle ORM 0.36.4 / drizzle-kit 0.28, Vitest (node + jsdom), Next.js 15 App Router, React Testing Library, Fastify.

## Global Constraints

- Packages touched: `@onelife/newsdesk`, `@onelife/web`, `@onelife/db`, `@onelife/read-models`.
- Run tests with `pnpm --filter <pkg> test` — **NEVER append `-- run`**; every package's `test` script is already `vitest run`.
- DB-backed suites need `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test` (this dev machine remaps the host Postgres port to **5434** via a gitignored `docker-compose.override.yml`).
- Turbo strips `TEST_DATABASE_URL` under strict env mode — prefer per-package `pnpm --filter` runs, or pass `--env-mode=loose` when you must go through turbo.
- Sources import each other with a **`.js` extension** (`./facts.js`, `../src/pg-store.js`) — ESM, even for `.ts` sources.
- Line numbers drift: **anchor every edit on the quoted code**, never on a line number.
- `CHANGELOG.md` **and** `CLAUDE.md` are both required in the branch diff before `gh pr create` — the repo guard (`.claude/hooks/guard.py`, lines 130 and 132) blocks the PR without CLAUDE.md.
- Branch: `feature/r5d-prb-plumbing`, PR base `develop`, squash-merged.

## Task dependency note

**Execution order is strict — do not parallelise and do not reorder.** Several tasks change shared signatures or database schema that later tasks depend on:

- Task 1 must land before Task 2 (Task 2's derivation calls `isUnrecordedCause` from its new home in `facts.ts`).
- Tasks 2 and 3 must land before Task 4 (the coherence test asserts the fixed behaviour end-to-end).
- Task 7 (schema) must land before Task 8 (migration generation reads the schema file), and Task 9's snapshot bookkeeping depends on Task 8's generated output.
- **Tasks 6–11 (W2) and Tasks 12–17 (W3) must not be pushed separately.** Migration `0014` makes the life unique index partial, which breaks all four article upserts until W3 lands. The intermediate state is legitimately red on the local feature branch and must stay there — see Task 11.
- Task 18 must land before Tasks 19–23 (the `ArticleBlock` union and the DTO field are consumed by all of them).
- Tasks 24 and 25 must both land before Task 27 (`gh pr create` is guard-blocked otherwise).

---

### Task 1: Relocate `isUnrecordedCause` / `UNRECORDED_CAUSES` from `prompt.ts` into `facts.ts`

Pure move, no behaviour change. `facts.ts` currently imports **nothing** from `prompt.ts` (its full import list is two lines: `@onelife/read-models` types and `./pg-store.js`), while `prompt.ts` already imports from `facts.ts` — so moving the predicate *down* into `facts.ts` follows the existing one-way edge and creates no cycle. Task 2 needs the predicate inside `facts.ts`, so this must land first.

**Files:**
- Modify: `apps/newsdesk/src/facts.ts`
- Modify: `apps/newsdesk/src/prompt.ts`
- Test (modify): `apps/newsdesk/test/prompt.test.ts` (move one describe-block's import + block out)
- Test (modify): `apps/newsdesk/test/facts.test.ts` (receives the moved block)

**Interfaces:**
```ts
// produced — apps/newsdesk/src/facts.ts (new exports)
export function isUnrecordedCause(cause: string | null | undefined): boolean;
const UNRECORDED_CAUSES: Set<string>;   // module-private, NOT exported (unchanged)

// consumed — apps/newsdesk/src/prompt.ts
import { timeAliveLabel, SUICIDE_RESET_SECONDS, isUnrecordedCause } from "./facts.js";
// prompt.ts must NO LONGER export isUnrecordedCause (one public home for one predicate)
```

Anchor every edit on the quoted code below, not on line numbers.

- [ ] **Step 1.1: Move the test block to `facts.test.ts` and watch it fail.**
  In `apps/newsdesk/test/prompt.test.ts`, delete this whole block (it sits at the end of the `describeDeath` describe):
  ```ts
    it("isUnrecordedCause covers the unknown set, case- and whitespace-insensitively", () => {
      for (const c of [null, undefined, "", "  ", "died", "Died", " ENVIRONMENT ", "environmental", "unknown"]) {
        expect(isUnrecordedCause(c)).toBe(true);
      }
      for (const c of ["infected", "wolf", "bear", "animal", "fall", "pvp", "bled_out", "starvation", "suicide"]) {
        expect(isUnrecordedCause(c)).toBe(false);
      }
    });
  ```
  and drop `isUnrecordedCause` from the import at the top of that file, so the line reads:
  ```ts
  import { buildObituaryPrompt, describeDeath, parseObituary, composeTags, causeCategoryTag, OBITUARY_PROMPT_VERSION, UNKNOWN_DEATH_PHRASE, NO_MECHANISM_DIRECTIVE, causeUnrecorded } from "../src/prompt.js";
  ```
  In `apps/newsdesk/test/facts.test.ts`, change the first import to:
  ```ts
  import { buildObituaryFacts, timeAliveLabel, isUnrecordedCause } from "../src/facts.js";
  ```
  and append this describe at the end of the file:
  ```ts
  describe("isUnrecordedCause", () => {
    it("covers the unknown set, case- and whitespace-insensitively", () => {
      for (const c of [null, undefined, "", "  ", "died", "Died", " ENVIRONMENT ", "environmental", "unknown"]) {
        expect(isUnrecordedCause(c)).toBe(true);
      }
      for (const c of ["infected", "wolf", "bear", "animal", "fall", "pvp", "bled_out", "starvation", "suicide"]) {
        expect(isUnrecordedCause(c)).toBe(false);
      }
    });
  });
  ```

- [ ] **Step 1.2: Run it, see it fail.**
  ```
  pnpm --filter @onelife/newsdesk test test/facts.test.ts
  ```
  Expect a failure at import resolution, e.g. `SyntaxError: The requested module '../src/facts.js' does not provide an export named 'isUnrecordedCause'`.

- [ ] **Step 1.3: Cut the constant + predicate out of `prompt.ts`.**
  Delete this exact block from `apps/newsdesk/src/prompt.ts` (it sits between `mapLabel` and `UNKNOWN_DEATH_PHRASE`):
  ```ts
  /**
   * D4 — cause tokens that name no real mechanism. `died` is what the ADM parser writes when the
   * log line carries no killer and no entity; `environment`/`environmental` are the parser's and
   * classifier's catch-alls. Handing any of these to the model as a bare word invited invention
   * (a bare "environment" was published as the headline word "Terrain" for a death actually
   * recorded as infected). Treat them as an explicit unknown instead — the absence IS the story.
   */
  const UNRECORDED_CAUSES = new Set(["", "died", "environment", "environmental", "unknown"]);

  /** True when the cause token names no mechanism (null/empty/died/environment/unknown). */
  export function isUnrecordedCause(cause: string | null | undefined): boolean {
    return UNRECORDED_CAUSES.has((cause ?? "").trim().toLowerCase());
  }
  ```
  Then change the import at the top of `prompt.ts` from:
  ```ts
  import { timeAliveLabel, SUICIDE_RESET_SECONDS } from "./facts.js";
  ```
  to:
  ```ts
  import { timeAliveLabel, SUICIDE_RESET_SECONDS, isUnrecordedCause } from "./facts.js";
  ```
  The four internal call sites inside `prompt.ts` (`causeUnrecorded`, and the three in `describeDeath`) need no edit — they now resolve to the import.

- [ ] **Step 1.4: Paste the block into `facts.ts`.**
  In `apps/newsdesk/src/facts.ts`, immediately after the `timeAliveLabel` function and before `/** Compose the factual snapshot ... */`, insert verbatim:
  ```ts
  /**
   * D4 — cause tokens that name no real mechanism. `died` is what the ADM parser writes when the
   * log line carries no killer and no entity; `environment`/`environmental` are the parser's and
   * classifier's catch-alls. Handing any of these to the model as a bare word invited invention
   * (a bare "environment" was published as the headline word "Terrain" for a death actually
   * recorded as infected). Treat them as an explicit unknown instead — the absence IS the story.
   *
   * Lives here rather than in prompt.ts because the causeCategory derivation below is its first
   * consumer: the tag and the prose must agree on one vocabulary of "no mechanism named".
   */
  const UNRECORDED_CAUSES = new Set(["", "died", "environment", "environmental", "unknown"]);

  /** True when the cause token names no mechanism (null/empty/died/environment/unknown). */
  export function isUnrecordedCause(cause: string | null | undefined): boolean {
    return UNRECORDED_CAUSES.has((cause ?? "").trim().toLowerCase());
  }
  ```

- [ ] **Step 1.5: Run both suites, see them pass.**
  ```
  pnpm --filter @onelife/newsdesk test test/facts.test.ts
  pnpm --filter @onelife/newsdesk test test/prompt.test.ts
  ```
  Both green. Then confirm nothing else imported the old export:
  ```
  grep -rn "isUnrecordedCause" apps/ packages/ --include=*.ts
  ```
  Expected: only `apps/newsdesk/src/facts.ts` (definition), `apps/newsdesk/src/prompt.ts` (import + 4 uses), `apps/newsdesk/test/facts.test.ts`. Zero hits in `prompt.test.ts`.

- [ ] **Step 1.6: Typecheck and commit.**
  ```
  pnpm turbo run typecheck --filter @onelife/newsdesk
  git add apps/newsdesk/src/facts.ts apps/newsdesk/src/prompt.ts apps/newsdesk/test/facts.test.ts apps/newsdesk/test/prompt.test.ts
  git commit -m "refactor(newsdesk): move isUnrecordedCause into facts.ts"
  ```

---

### Task 2: Add the `unknown` arm to the `causeCategory` derivation

The defect: `cause ? "environment" : "unknown"` is a **truthiness** test, so a bare `"died"` (19 of 84 recorded deaths) lands on `"environment"` and ships an "Environment" tag while PR-A's prose says the record names no cause.

**Arm ordering — reason it through before editing.** The ladder must stay in this order:
1. `cause === "pvp" || killerGamertag` → `"pvp"`. First, unconditionally: a named killer IS the mechanism, and a pvp life whose token is a bare `"died"` (real: the parser writes `died` with a killer name) must never fall through to unknown. `causeUnrecorded` short-circuits on pvp for the same reason.
2. `cause === "suicide"` → `"suicide"`. Second: PR-A's arm, an exact token match, must outrank the generic mechanism test.
3. **new:** a mechanism is named by *either* the raw cause *or* the verdict → `"environment"`.
4. otherwise → `"unknown"`.

**Why the verdict participates in arm 3.** `classifyDeath` can infer `starvation` from death vitals when the ADM line says only `died`. Under a cause-only test, that life would get tag "Unknown" while `describeDeath` tells the model "starvation — they ran out of food" — the mirror image of the bug being fixed. Mirroring `causeUnrecorded`'s two-token logic makes the invariant `causeCategory === "unknown"` ⟺ `causeUnrecorded(facts) === true` (outside the pvp short-circuit), which is what coherence means here and is asserted in Task 4.

**Forward-only:** tags are composed at publish time and frozen into `articles.tags`, so the ~19 already-published articles keep their stale "Environment" tag. A backfill `UPDATE` is deliberately out of PR-B scope — note it in the changelog (Task 24).

**Files:**
- Modify: `apps/newsdesk/src/facts.ts`
- Test (modify): `apps/newsdesk/test/facts.test.ts`
- Test (modify): `apps/newsdesk/test/prompt.test.ts` (fixtures pairing `environment` with an unrecorded cause and no rescuing verdict)
- Test (modify): `apps/newsdesk/test/generate.test.ts` (one inert fixture)

**Interfaces:**
```ts
// consumed (unchanged signatures)
export function buildObituaryFacts(target: ObituaryTarget, timeline: LifeTimeline, priors: PlayerPriors): ObituaryFacts;
export function isUnrecordedCause(cause: string | null | undefined): boolean;   // from Task 1
// produced: no signature change. ObituaryFacts["causeCategory"] is ALREADY
//   "pvp" | "suicide" | "environment" | "unknown" — this is a derivation change only.
```

- [ ] **Step 2.1: Write the failing derivation tests.**
  In `apps/newsdesk/test/facts.test.ts`, inside the existing `describe("buildObituaryFacts", ...)`, add immediately after the `it("classifies a missing cause as unknown", ...)` case:
  ```ts
  it.each([["died"], ["environment"], ["environmental"], ["unknown"], [""], ["  DIED  "]])(
    "classifies a bare/unrecorded cause (%s) as unknown, never environment",
    (deathCause) => {
      const f = buildObituaryFacts(
        target,
        timeline({ life: { deathCause, deathByGamertag: null, deathWeapon: null, playtimeSeconds: 3600 }, kills: [] }),
        noPriors,
      );
      expect(f.causeCategory).toBe("unknown");
    },
  );

  it("a verdict that names a mechanism rescues a bare cause back to environment", () => {
    const f = buildObituaryFacts(
      target,
      timeline({
        life: { deathCause: "died", deathByGamertag: null, deathWeapon: null, playtimeSeconds: 3600 },
        kills: [],
        verdict: { cause: "starvation", confidence: "high", conditions: ["starving"], basis: {} },
      }),
      noPriors,
    );
    expect(f.causeCategory).toBe("environment");
  });

  it("a verdict that names nothing does NOT rescue a bare cause", () => {
    const f = buildObituaryFacts(
      target,
      timeline({
        life: { deathCause: "died", deathByGamertag: null, deathWeapon: null, playtimeSeconds: 3600 },
        kills: [],
        verdict: { cause: "unknown", confidence: "low", conditions: [], basis: {} },
      }),
      noPriors,
    );
    expect(f.causeCategory).toBe("unknown");
  });

  it("a bare cause with a named killer stays pvp — a player kill is never unknown", () => {
    const f = buildObituaryFacts(
      target,
      timeline({ life: { deathCause: "died", deathByGamertag: "Kilo", deathWeapon: "M4A1", playtimeSeconds: 3600 }, kills: [] }),
      noPriors,
    );
    expect(f.causeCategory).toBe("pvp");
  });
  ```

- [ ] **Step 2.2: Run it, see it fail.**
  ```
  pnpm --filter @onelife/newsdesk test test/facts.test.ts
  ```
  Expect the `it.each` rows and the "verdict that names nothing" case to fail with `expected 'environment' to be 'unknown'`. The pvp and verdict-rescue cases should already pass.

- [ ] **Step 2.3: Replace the ladder.**
  In `apps/newsdesk/src/facts.ts`, inside `buildObituaryFacts`, replace exactly:
  ```ts
    const cause = life.deathCause;
    const killerGamertag = life.deathByGamertag ?? null;
    // Order matters: a killer name outranks everything (a player did it), then the explicit suicide
    // token, then any other stated cause, then nothing at all.
    const causeCategory: ObituaryFacts["causeCategory"] =
      cause === "pvp" || killerGamertag
        ? "pvp"
        : cause === "suicide"
          ? "suicide"
          : cause
            ? "environment"
            : "unknown";
  ```
  with:
  ```ts
    const cause = life.deathCause;
    const killerGamertag = life.deathByGamertag ?? null;
    // A cause token only counts as "environment" if it NAMES a mechanism. A bare `died` (and the
    // parser's `environment`/`environmental` catch-alls) name nothing — a truthiness test used to
    // file them as Environment, which published an "Environment" tag over prose that correctly
    // said no cause was recorded. Mirrors causeUnrecorded(): the verdict can rescue the category
    // when classifyDeath inferred a real mechanism (e.g. starvation) from a bare log line, so
    // causeCategory === "unknown" <=> causeUnrecorded(facts) outside the pvp short-circuit.
    // The rescue only asks whether a mechanism was named, not which; a verdict of `pvp`/`suicide`
    // over a bare cause still lands on `environment`, unchanged from before — narrowing that is
    // out of scope.
    // Order matters: a killer name outranks everything (a player did it), then the explicit
    // suicide token, then a named mechanism, then nothing at all.
    const mechanismNamed = !isUnrecordedCause(cause) || !isUnrecordedCause(timeline.verdict?.cause ?? null);
    const causeCategory: ObituaryFacts["causeCategory"] =
      cause === "pvp" || killerGamertag
        ? "pvp"
        : cause === "suicide"
          ? "suicide"
          : mechanismNamed
            ? "environment"
            : "unknown";
  ```
  Also update the union's doc comment on the `ObituaryFacts` interface, replacing:
  ```ts
    // "suicide" is its own category: a deliberate self-inflicted end is neither a player kill nor
    // an act of the environment, and the two read completely differently in prose and imagery.
    causeCategory: "pvp" | "suicide" | "environment" | "unknown";
  ```
  with:
  ```ts
    // "suicide" is its own category: a deliberate self-inflicted end is neither a player kill nor
    // an act of the environment, and the two read completely differently in prose and imagery.
    // "environment" means a mechanism was actually NAMED (bled_out/starvation/wolf/fall/...);
    // a bare `died` with no verdict is "unknown", never environment — see the derivation below.
    causeCategory: "pvp" | "suicide" | "environment" | "unknown";
  ```

- [ ] **Step 2.4: Run it, see it pass — including the untouched anchors.**
  ```
  pnpm --filter @onelife/newsdesk test test/facts.test.ts
  ```
  All green. These pre-existing cases must still pass and must NOT be edited — they are the guard against over-correcting into "everything is unknown":
  - `"classifies a non-pvp death as environment, killer null"` (`deathCause: "bled_out"` → `"environment"`)
  - `"classifies a suicide as its own category, never environment"`
  - `"a very short suicide is NOT a fresh-spawn victim (that flag is pvp-only)"`
  - `"classifies a missing cause as unknown"`
  - `"derives kills, longest kill, sessions, cause category, killer, weapon"` (→ `"pvp"`)

- [ ] **Step 2.5: Reconcile the now-unreachable `prompt.test.ts` fixtures.**
  These hand-built `mkFacts` fixtures pair `causeCategory: "environment"` with an unrecorded cause **and no rescuing verdict** — a state the derivation can no longer produce. They still pass, but they encode the exact contradiction being removed. Change `"environment"` → `"unknown"` in each, matching on the quoted text:
  ```ts
  // in it.each("adds the no-invention constraint when the cause is unrecorded (%s)")
        causeCategory: "environment", cause, killerGamertag: null, verdict: null,
  // →   causeCategory: "unknown", cause, killerGamertag: null, verdict: null,

  // in it("an unrecorded cause with a low-confidence 'unknown' verdict ...")
        causeCategory: "environment", cause: "died", killerGamertag: null,
        verdict: { cause: "unknown", confidence: "low", conditions: [] },
  // →   causeCategory: "unknown", cause: "died", killerGamertag: null,

  // in it("causeUnrecorded is false for pvp and for any recorded mechanism") — first two lines only
      expect(causeUnrecorded(mkFacts({ causeCategory: "environment", cause: "died", killerGamertag: null, verdict: null }))).toBe(true);
      expect(causeUnrecorded(mkFacts({ causeCategory: "environment", cause: null, killerGamertag: null, verdict: null }))).toBe(true);
  // →   both become causeCategory: "unknown"

  // in it.each("no verdict + %s reads as an explicit unknown, never a mechanism")
      const s = describeDeath(mkFacts({ causeCategory: "environment", cause, verdict: null, killerGamertag: null }));
  // →   const s = describeDeath(mkFacts({ causeCategory: "unknown", cause, verdict: null, killerGamertag: null }));

  // in it("a verdict that names nothing also reads as an explicit unknown, keeping the factual state")
        causeCategory: "environment", cause: "died", killerGamertag: null,
        verdict: { cause: "unknown", confidence: "low", conditions: ["starving"] },
  // →   causeCategory: "unknown", cause: "died", killerGamertag: null,
  ```
  **Leave these alone** — each pairs `environment` with a real mechanism in the cause or a rescuing verdict, so all remain reachable: the `cause: "bled_out"` fixture, the `verdict: { cause: "starvation" ... }` and `verdict: { cause: "dehydration" ... }` fixtures, the `cause: "infected"` fixtures, the `cause: "wolf"` / `cause: "fall"` describeDeath cases, the `it.each` of known causes (`infected`/`wolf`/`bled_out`/`fall`), and every `causeCategory: "pvp"` fixture.

- [ ] **Step 2.6: Fix the one inert `generate.test.ts` fixture.**
  In `apps/newsdesk/test/generate.test.ts`, the module-scope `facts` object pairs `cause: "environment"` with `causeCategory: "environment"` — also unreachable. Change the cause to a real mechanism so the fixture stays a valid `environment` sample:
  ```ts
    timeAliveLabel: "1h 0m", kills: 0, longestKillMeters: null, sessions: 1, cause: "bled_out",
  ```

- [ ] **Step 2.7: Run the full newsdesk suite green, typecheck, commit.**
  ```
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/newsdesk test
  pnpm turbo run typecheck --filter @onelife/newsdesk
  ```
  Expect the whole file set to pass, `image-categories.test.ts` included (its fixtures are hand-built and are dealt with in Task 3).
  ```
  git add apps/newsdesk/src/facts.ts apps/newsdesk/test/facts.test.ts apps/newsdesk/test/prompt.test.ts apps/newsdesk/test/generate.test.ts
  git commit -m "fix(newsdesk): a bare 'died' cause is unknown, not environment"
  ```

---

### Task 3: Reconcile the image-category gates with the reclassified population

Reclassifying ~23% of deaths from `environment` → `unknown` silently moves them across six gates in `image-categories.ts`. Four are unaffected (`vantage`, `approached-for-comment` stay off; `first-aid-attempted` is `!== "pvp"` so stays on; `visibility-factor` already matches `unknown`). Two change and must be **decided**, not left as a side effect:
- **`effects` STOPS firing** — it gates on `environment || suicide` with no `unknown` arm. Losing "RECOVERED EFFECTS" for a quarter of obituaries shrinks the menu for no reason; recovered belongings are a cause-agnostic framing. **Add the `unknown` arm.**
- **`trail-ends-here` STARTS firing on every map** (previously only on Sakhal for these). This is correct — "THE TRAIL ENDS HERE" is the right image for a cause nobody wrote down — but it is a real widening. **Keep it; record it in the changelog.**

**Files:**
- Modify: `apps/newsdesk/src/image-categories.ts`
- Test (modify): `apps/newsdesk/test/image-categories.test.ts`

**Interfaces:**
```ts
// consumed (unchanged)
export function eligibleCategories(kind: ArticleKind, facts: FactsSnapshot): ImageCategory[];
export type FactsSnapshot = Record<string, unknown>;   // gates read causeCategory off an untyped
                                                       // record — the compiler will NOT flag a
                                                       // missing arm; tests are the only guard.
```

- [ ] **Step 3.1: Write the failing gate test for the reclassified population.**
  In `apps/newsdesk/test/image-categories.test.ts`, inside `describe("eligibleCategories — obituary gates", ...)`, add after the existing `it("trail-ends-here: ...")`:
  ```ts
  it("an unrecorded cause (causeCategory 'unknown') keeps effects and gains the mystery framing", () => {
    const unknown = { ...base, causeCategory: "unknown", cause: "died" };
    const s = slugs("obituary", unknown);
    expect(s).toContain("effects");             // recovered belongings are cause-agnostic
    expect(s).toContain("trail-ends-here");     // widened: fires on every map, not just Sakhal
    expect(s).toContain("visibility-factor");
    expect(s).toContain("first-aid-attempted");
    expect(s).not.toContain("vantage");
    expect(s).not.toContain("approached-for-comment");
  });
  ```

- [ ] **Step 3.2: Run it, see it fail.**
  ```
  pnpm --filter @onelife/newsdesk test test/image-categories.test.ts
  ```
  Expect one failure: `expected [...] to contain 'effects'`.

- [ ] **Step 3.3: Add the `unknown` arm to the `effects` gate.**
  In `apps/newsdesk/src/image-categories.ts`, replace:
  ```ts
      // Suicide included deliberately: recovered belongings are the one morgue framing that
      // reports a self-inflicted death without a body, a suspect, or an assigned blame.
      eligible: (f) => f.causeCategory === "environment" || f.causeCategory === "suicide" },
  ```
  with:
  ```ts
      // Suicide included deliberately: recovered belongings are the one morgue framing that
      // reports a self-inflicted death without a body, a suspect, or an assigned blame.
      // "unknown" included too: belongings assert no mechanism, so they stay honest for the ~23%
      // of deaths whose cause the record never named.
      eligible: (f) => f.causeCategory === "environment" || f.causeCategory === "suicide" || f.causeCategory === "unknown" },
  ```
  Note for the PR body: the existing test title in `image-categories.test.ts` already reads *"effects/visibility need environment or unknown"* — it has been describing this post-fix behaviour all along while the `effects` gate lacked the `unknown` arm. That title only becomes accurate with this edit, which is corroborating evidence the missing arm was an oversight rather than a deliberate exclusion. Do not change the title.

- [ ] **Step 3.4: Fix the unreachable `base` fixture and its dependent comment.**
  The suite's `base` pairs `causeCategory: "environment"` with `cause: "died"` — no longer producible. Give it a real mechanism so every `environment` assertion in the block stays meaningful (`bled_out` matches none of the wolf/fall/vehicle substring gates, so the dormant-gate assertions are unchanged):
  ```ts
    const base = { causeCategory: "environment", cause: "bled_out", weapon: null, killerGamertag: null,
      kills: 3, timeAliveSeconds: 7200, freshSpawnVictim: false, map: "chernarusplus" };
  ```
  and in `it("cause-string gates stay dormant on today's coarse vocabulary")` update the stale inline comment:
  ```ts
      const s = slugs("obituary", base); // cause: "bled_out" — matches no substring gate
  ```
  **Leave these alone:** the two `suspect-at-large` tests (`causeCategory: "environment", cause: "died"` **with** a `verdict` of `mauled`/`starvation`) stay reachable under the verdict-rescue rule from Task 2; and the stage-2 gate test (`causeCategory: "environment"` with `cause` of `wolf`/`bear`/`fall`/`vehicle`) is valid — those are real mechanisms.

- [ ] **Step 3.5: Run it, see it pass; then the whole suite.**
  ```
  pnpm --filter @onelife/newsdesk test test/image-categories.test.ts
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/newsdesk test
  ```
  Both green.

- [ ] **Step 3.6: Commit.**
  ```
  git add apps/newsdesk/src/image-categories.ts apps/newsdesk/test/image-categories.test.ts
  git commit -m "fix(newsdesk): image gates follow the unknown cause category"
  ```

---

### Task 4: End-to-end coherence test — a bare `died` life tags "Unknown" AND says no cause is recorded

The reported defect is only user-visible **at the tag**, and the contradiction only exists **between** the tag and the prose. A facts-level assertion alone does not guard it. This test walks the real path: `buildObituaryFacts` → `composeTags` (the tag frozen into `articles.tags` and rendered publicly by `apps/web/src/components/obituaries/obituary-article.tsx`) and `buildObituaryPrompt` (the instruction the model is actually given).

**Files:**
- Test (create): `apps/newsdesk/test/cause-coherence.test.ts`

**Interfaces:**
```ts
// consumed
import { buildObituaryFacts } from "../src/facts.js";           // (target, timeline, priors) => ObituaryFacts
import { composeTags, buildObituaryPrompt, causeUnrecorded, NO_MECHANISM_DIRECTIVE, UNKNOWN_DEATH_PHRASE } from "../src/prompt.js";
// composeTags(facts: ObituaryFacts, llmTags: string[]): string[]
// buildObituaryPrompt(facts: ObituaryFacts): { system: string; user: string }
// causeUnrecorded(facts: ObituaryFacts): boolean
// produced: none (test-only). Pure unit — no TEST_DATABASE_URL needed.
```

- [ ] **Step 4.1: Write the failing coherence test.**
  Create `apps/newsdesk/test/cause-coherence.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { buildObituaryFacts } from "../src/facts.js";
  import { composeTags, buildObituaryPrompt, causeUnrecorded, NO_MECHANISM_DIRECTIVE, UNKNOWN_DEATH_PHRASE } from "../src/prompt.js";
  import type { ObituaryTarget } from "../src/pg-store.js";
  import type { PlayerPriors } from "@onelife/read-models";

  const noPriors: PlayerPriors = {
    livesLived: 0, longestLifeSeconds: 0, totalKills: 0,
    usualDeathCause: null, lastDeathCause: null, bestLifeMap: null,
  };

  const target: ObituaryTarget = {
    lifeId: 1, serverId: 1, gamertag: "Boots", map: "chernarusplus", mapSlug: "chernarus",
    lifeNumber: 3, lifeStartedAt: new Date("2026-07-09T02:00:00Z"), endedAt: new Date("2026-07-10T02:00:00Z"),
  };

  const timelineFor = (deathCause: string | null, verdict: unknown = null) =>
    ({
      life: { deathCause, deathByGamertag: null, deathWeapon: null, deathDistance: null, playtimeSeconds: 3600 },
      sessions: [{}],
      kills: [],
      character: null,
      qualifiedAt: null,
      verdict,
      ordeals: null,
      hpLow: null,
    }) as unknown as import("@onelife/read-models").LifeTimeline;

  // The bug this file exists for: the paper contradicted itself on ~23% of deaths — an
  // "Environment" tag over prose forbidden to name terrain, exposure, or weather.
  describe("bare 'died' coherence: tag and prose agree", () => {
    it("tags Unknown and instructs the model that no mechanism is recorded", () => {
      const facts = buildObituaryFacts(target, timelineFor("died"), noPriors);

      expect(facts.causeCategory).toBe("unknown");
      expect(composeTags(facts, ["Elektro"])).toEqual(["Obituaries", "Chernarus", "Unknown", "Elektro"]);
      expect(composeTags(facts, [])).not.toContain("Environment");

      const { user } = buildObituaryPrompt(facts);
      expect(user).toContain(NO_MECHANISM_DIRECTIVE);
      expect(user).toContain(UNKNOWN_DEATH_PHRASE);
    });

    it("the invariant holds: causeCategory 'unknown' <=> causeUnrecorded, outside pvp", () => {
      for (const c of [null, "", "died", "environment", "environmental", "unknown"]) {
        const f = buildObituaryFacts(target, timelineFor(c), noPriors);
        expect(f.causeCategory).toBe("unknown");
        expect(causeUnrecorded(f)).toBe(true);
      }
      for (const c of ["bled_out", "starvation", "wolf", "fall", "infected"]) {
        const f = buildObituaryFacts(target, timelineFor(c), noPriors);
        expect(f.causeCategory).toBe("environment");
        expect(causeUnrecorded(f)).toBe(false);
      }
    });

    it("a real mechanism still tags Environment — the fix does not over-correct", () => {
      const f = buildObituaryFacts(target, timelineFor("bled_out"), noPriors);
      expect(composeTags(f, [])).toEqual(["Obituaries", "Chernarus", "Environment"]);
      expect(buildObituaryPrompt(f).user).not.toContain(NO_MECHANISM_DIRECTIVE);
    });

    it("a verdict-inferred mechanism tags Environment and drops the no-mechanism directive together", () => {
      const f = buildObituaryFacts(
        target,
        timelineFor("died", { cause: "starvation", confidence: "high", conditions: ["starving"], basis: {} }),
        noPriors,
      );
      expect(f.causeCategory).toBe("environment");
      expect(composeTags(f, [])).toContain("Environment");
      expect(buildObituaryPrompt(f).user).not.toContain(NO_MECHANISM_DIRECTIVE);
    });
  });
  ```
  Note the deliberate absence of any `expect(user).not.toMatch(/\bEnvironment\b/)` assertion: the string "Environment" appears in `prompt.ts` only inside `causeCategoryTag`, which is never interpolated into the prompt, so such an assertion would pass both before and after the fix and guard nothing. `expect(composeTags(facts, [])).not.toContain("Environment")` above is the load-bearing version of that check.

- [ ] **Step 4.2: Run it, see it pass (Tasks 2–3 already landed the fix).**
  ```
  pnpm --filter @onelife/newsdesk test test/cause-coherence.test.ts
  ```
  All four cases green.

- [ ] **Step 4.3: Prove it is a real guard — revert the fix temporarily and watch it fail.**
  In `apps/newsdesk/src/facts.ts`, momentarily change `? mechanismNamed` back to `? cause`, then:
  ```
  pnpm --filter @onelife/newsdesk test test/cause-coherence.test.ts
  ```
  **Expect the first two cases to fail** — the tag case and the invariant loop. The first fails with `expected [ 'Obituaries', 'Chernarus', 'Environment', 'Elektro' ] to deeply equal [ 'Obituaries', 'Chernarus', 'Unknown', 'Elektro' ]` — that array **is** the published contradiction. The invariant loop fails on the same reclassification. The two verdict-rescue cases are unaffected by the revert and stay green; that is expected, not a sign of a wrong revert. Restore `mechanismNamed` and re-run to green.

- [ ] **Step 4.4: Full suite, typecheck, commit.**
  ```
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/newsdesk test
  pnpm turbo run typecheck --filter @onelife/newsdesk
  git add apps/newsdesk/test/cause-coherence.test.ts
  git commit -m "test(newsdesk): guard tag/prose coherence for an unrecorded cause"
  ```

---

### Task 5: W1 verification gate — full repo green before the schema work starts

W1 is deploy-gating and independent of W2–W4. Confirm the tree is fully green here so any later breakage is unambiguously attributable to the migration work.

**Files:** none modified (verification only).

**Interfaces:** none.

- [ ] **Step 5.1: Repo-wide typecheck.**
  ```
  pnpm turbo run typecheck
  ```
  Expect all packages to succeed.

- [ ] **Step 5.2: Repo-wide tests.**
  ```
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm turbo run test --concurrency=1 --env-mode=loose
  ```
  (`--env-mode=loose` is required — turbo's strict mode strips `TEST_DATABASE_URL` and the DB suites then fail to connect.) Expect every package green. `@onelife/web` and `@onelife/api` are untouched by W1 and must not have moved.

- [ ] **Step 5.3: Confirm no stale `environment` fallback survives.**
  ```
  grep -rn 'causeCategory' apps/newsdesk/src
  ```
  Expect the derivation in `facts.ts` (now via `mechanismNamed`), `causeCategoryTag` + `causeUnrecorded` + the two suicide tone branches in `prompt.ts`, the `freshSpawnVictim` pvp test in `facts.ts`, and the six gates in `image-categories.ts` — and **no remaining `? "environment" : "unknown"` truthiness ternary**:
  ```
  grep -rn '? "environment"' apps/newsdesk/src
  ```
  Expected: no output.

---

### Task 6: RED — schema-shape test for migration 0014

**Files:**
- Create: `/Users/steveharmeyer/Development/dayz-one-life/one-life/apps/newsdesk/test/migration-0014.test.ts`

**Interfaces:**
- Consumed: `getTestDb(): { db: Database; sql: postgres.Sql }` from `@onelife/test-support` (the returned `sql` is a raw `postgres` client — use it for `pg_catalog`/`information_schema` queries).
- Produced: none (test-only). This file is the acceptance guard for Tasks 7–10.

Why this file lives in `apps/newsdesk` and not `packages/db`: `packages/db` has **no** `vitest.config.ts`, no `test/` directory, and no `@onelife/test-support` dependency — its `test` script is `vitest run --passWithNoTests`. `apps/newsdesk` already has `vitest.config.ts` wired to `GLOBAL_SETUP_PATH`, whose `globalSetup` calls `migrateDb(url)` — so simply running this suite is what applies migration 0014 to the test database.

- [ ] **Step 6.1: Create the test file.** Write exactly:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";

const { sql } = getTestDb();
afterAll(async () => { await sql.end(); });

async function indexDef(name: string): Promise<string | null> {
  const rows = await sql<{ indexdef: string }[]>`
    select indexdef from pg_indexes where schemaname = 'public' and indexname = ${name}`;
  return rows[0]?.indexdef ?? null;
}

async function columnType(table: string, column: string): Promise<string | null> {
  const rows = await sql<{ data_type: string }[]>`
    select data_type from information_schema.columns
     where table_schema = 'public' and table_name = ${table} and column_name = ${column}`;
  return rows[0]?.data_type ?? null;
}

describe("migration 0014 — articles natural_key + body_blocks + partial life index", () => {
  it("adds articles.natural_key as text", async () => {
    expect(await columnType("articles", "natural_key")).toBe("text");
  });

  it("adds articles.body_blocks as jsonb", async () => {
    expect(await columnType("articles", "body_blocks")).toBe("jsonb");
  });

  it("adds a unique index on natural_key, partial on NOT NULL", async () => {
    const def = await indexDef("articles_natural_key_uniq");
    expect(def).toBeTruthy();
    expect(def!).toMatch(/^CREATE UNIQUE INDEX/);
    expect(def!).toMatch(/natural_key IS NOT NULL/);
  });

  it("makes the life natural-key unique index PARTIAL on the two life-keyed kinds", async () => {
    const def = await indexDef("articles_kind_server_gamertag_life_uniq");
    expect(def).toBeTruthy();
    expect(def!).toMatch(/^CREATE UNIQUE INDEX/);
    // Postgres normalizes `kind IN ('a','b')` to `kind = ANY (ARRAY['a'::text, 'b'::text])`.
    expect(def!).toMatch(/WHERE/);
    expect(def!).toMatch(/obituary/);
    expect(def!).toMatch(/birth_notice/);
    // The four indexed columns must be unchanged.
    expect(def!).toMatch(/\(kind, server_id, gamertag, life_started_at\)/);
  });

  it("adds the (kind, status, created_at) feed index", async () => {
    const def = await indexDef("articles_kind_status_created_idx");
    expect(def).toBeTruthy();
    expect(def!).toMatch(/\(kind, status, created_at\)/);
  });
});
```

- [ ] **Step 6.2: Run it and watch it fail.**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
  pnpm --filter @onelife/newsdesk test test/migration-0014.test.ts
```

Expected: 5 failures. The first two read `expected null to be 'text'` / `'jsonb'`; the `natural_key` index test reads `expected null to be truthy`; the partial-index test fails on `expect(def!).toMatch(/WHERE/)` because the current index is total; the feed-index test reads `expected null to be truthy`.

Never append `-- run` — the package script is already `vitest run`.

- [ ] **Step 6.3: Commit the RED test.**

```bash
git add apps/newsdesk/test/migration-0014.test.ts
git commit -m "test(db): assert migration 0014 schema shape (RED)"
```

---

### Task 7: Drizzle schema additions in `packages/db/src/schema.ts`

**Files:**
- Modify: `/Users/steveharmeyer/Development/dayz-one-life/one-life/packages/db/src/schema.ts`
- Test: `/Users/steveharmeyer/Development/dayz-one-life/one-life/apps/newsdesk/test/migration-0014.test.ts` (stays RED until Task 10 applies the SQL — this task only makes the TypeScript model match)

**Interfaces:**
- Produced on the exported `articles` table: `naturalKey: text("natural_key")` → `string | null`; `bodyBlocks: jsonb("body_blocks")` → `unknown` at the Drizzle boundary (casting is the read-model's job, exactly as `facts` is cast).
- Produced index keys on the table's second-argument object: `uniqNaturalKey`, `kindStatusCreatedIdx`; **modified**: `uniqLife` gains `.where(...)`.
- Consumed: `text`, `jsonb`, `uniqueIndex`, `index`, `sql` — all already imported at the top of `schema.ts`; **verify before editing** with `head -20 packages/db/src/schema.ts` and add nothing that is already there.

Anchor every edit on the quoted code below, not on line numbers — they drift.

- [ ] **Step 7.1: Add the two columns.** Find the block ending:

```ts
  discordPostedAt: timestamp("discord_posted_at", { withTimezone: true }), // set when the obituary link was posted to Discord; NULL = unposted
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
```

Insert **between** `discordPostedAt` and `createdAt`:

```ts
  // R5d — kind-agnostic dedupe key for article kinds NOT keyed by a life (news items key on a
  // source-derived string). NULL for obituaries/birth notices, which keep the life natural key.
  naturalKey: text("natural_key"),
  // R5d — rich body as an ordered block array (para|subhead|quote|list). NULL on every pre-R5d
  // row; the web renderer falls back to splitting flat `body` on blank lines when it is NULL.
  bodyBlocks: jsonb("body_blocks"),
```

- [ ] **Step 7.2: Make `uniqLife` partial and add the two new indexes.** Replace this exact block:

```ts
}, (t) => ({
  uniqLife: uniqueIndex("articles_kind_server_gamertag_life_uniq").on(t.kind, t.serverId, t.gamertag, t.lifeStartedAt),
  uniqSlug: uniqueIndex("articles_slug_uniq").on(t.slug),
```

with:

```ts
}, (t) => ({
  // PARTIAL: only the two life-keyed kinds are constrained by the life tuple. A news row carries
  // no life and must not collide. Because this index is partial, EVERY onConflictDoUpdate that
  // targets it must pass a matching `targetWhere` — see apps/newsdesk/src/{pg-store,birth-pg-store}.ts.
  uniqLife: uniqueIndex("articles_kind_server_gamertag_life_uniq")
    .on(t.kind, t.serverId, t.gamertag, t.lifeStartedAt)
    .where(sql`${t.kind} IN ('obituary','birth_notice')`),
  uniqNaturalKey: uniqueIndex("articles_natural_key_uniq").on(t.naturalKey).where(sql`${t.naturalKey} IS NOT NULL`),
  uniqSlug: uniqueIndex("articles_slug_uniq").on(t.slug),
```

- [ ] **Step 7.3: Add the created-at feed index.** Find:

```ts
  bornIdx: index("articles_kind_status_born_idx").on(t.kind, t.status, t.lifeStartedAt),
```

and insert immediately after it:

```ts
  createdIdx: index("articles_kind_status_created_idx").on(t.kind, t.status, t.createdAt),
```

- [ ] **Step 7.4: Typecheck the schema package.**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
pnpm --filter @onelife/db typecheck
```

Expected: exits 0, no output. If `sql` or `jsonb` is reported as undefined, add it to the existing `drizzle-orm` / `drizzle-orm/pg-core` import lines at the top of `schema.ts`.

- [ ] **Step 7.5: Commit.**

```bash
git add packages/db/src/schema.ts
git commit -m "feat(db): articles.natural_key + body_blocks; partial life unique index"
```

---

### Task 8: Generate migration 0014, rename it, hand-write its SQL

**Files:**
- Create: `/Users/steveharmeyer/Development/dayz-one-life/one-life/packages/db/drizzle/0014_article_natural_key_and_blocks.sql`
- Create: `/Users/steveharmeyer/Development/dayz-one-life/one-life/packages/db/drizzle/meta/0014_snapshot.json` (produced by drizzle-kit, not hand-written)
- Modify: `/Users/steveharmeyer/Development/dayz-one-life/one-life/packages/db/drizzle/meta/_journal.json`
- Delete: whatever randomly-named `.sql` drizzle-kit emits (e.g. `0014_curly_squirrel_girl.sql`)

**Interfaces:**
- Consumed: `pnpm --filter @onelife/db db:generate` → `drizzle-kit generate` (config `packages/db/drizzle.config.ts`, `schema: ./src/schema.ts`, `out: ./drizzle`).
- Produced: a migration triple the `drizzle-orm/postgres-js/migrator` in `packages/db/src/migrate.ts` will apply. The journal is the authority on ordering — a `.sql` not listed in `_journal.json` is silently ignored, and a `tag` that does not match a real filename makes `migrateDb` throw at startup.

- [ ] **Step 8.1: Generate.** drizzle-kit reads only the schema file for `generate` (no DB connection needed):

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
pnpm --filter @onelife/db db:generate
```

Expected output ends with something like `[✓] Your SQL migration file ➜ drizzle/0014_<two_random_words>.sql 🚀`. Note that filename.

- [ ] **Step 8.2: See what it produced, then confirm the known gap.**

```bash
cat packages/db/drizzle/0014_*.sql
```

Expect the two `ADD COLUMN` statements and the plain `CREATE INDEX`, but a missing or wrong `DROP INDEX` + partial recreate for `articles_kind_server_gamertag_life_uniq` — drizzle-kit does not reliably emit an index-predicate change. This is exactly why 0013 was hand-written. You are about to replace the body wholesale, so the correctness of the generated SQL does not matter; only the **snapshot** matters.

- [ ] **Step 8.3: Rename to the descriptive tag.**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life/packages/db/drizzle
GEN=$(ls 0014_*.sql)
git mv "$GEN" 0014_article_natural_key_and_blocks.sql 2>/dev/null || mv "$GEN" 0014_article_natural_key_and_blocks.sql
ls 0014_*.sql
```

Expected: `0014_article_natural_key_and_blocks.sql`, one file only.

- [ ] **Step 8.4: Hand-write the SQL body.** Overwrite `/Users/steveharmeyer/Development/dayz-one-life/one-life/packages/db/drizzle/0014_article_natural_key_and_blocks.sql` with exactly:

```sql
-- R5d PR-B plumbing. Four changes, all additive to existing rows (168 articles keep working).
--
-- 1. `natural_key` — a kind-agnostic dedupe key for article kinds that are NOT keyed by a life
--    (news items dedupe on a source-derived string). Unique only where present, so every
--    obituary/birth-notice row (NULL) is untouched by the constraint.
ALTER TABLE "articles" ADD COLUMN "natural_key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "articles_natural_key_uniq" ON "articles" USING btree ("natural_key") WHERE "articles"."natural_key" IS NOT NULL;
--> statement-breakpoint
-- 2. The life natural-key unique index becomes PARTIAL, constraining only the two life-keyed
--    kinds. A news row carries a synthetic life tuple and must not collide with them.
--    CAUTION: a partial unique index cannot be inferred by a bare ON CONFLICT target — every
--    onConflictDoUpdate aimed at this index must pass a matching `targetWhere`, or Postgres
--    raises "no unique or exclusion constraint matching the ON CONFLICT specification" and
--    article publishing dies on the next newsdesk tick.
DROP INDEX IF EXISTS "articles_kind_server_gamertag_life_uniq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "articles_kind_server_gamertag_life_uniq" ON "articles" USING btree ("kind","server_id","gamertag","life_started_at") WHERE "articles"."kind" IN ('obituary','birth_notice');
--> statement-breakpoint
-- 3. Feed index for kinds ordered by publication time rather than death/birth time (news).
CREATE INDEX IF NOT EXISTS "articles_kind_status_created_idx" ON "articles" USING btree ("kind","status","created_at");
--> statement-breakpoint
-- 4. Rich body as an ordered block array. NULL on every pre-R5d row; the shared ArticleBody
--    renderer falls back to splitting flat `body` on blank lines when it is NULL.
ALTER TABLE "articles" ADD COLUMN "body_blocks" jsonb;
```

Conventions being matched from `0013_drop_obituary_birth_images.sql`: a SQL-comment header explaining *why*, double-quoted identifiers, and `--> statement-breakpoint` between every pair of statements (the journal entry sets `"breakpoints": true`).

- [ ] **Step 8.5: Do not commit yet** — the journal still points at the generated filename. Task 9 fixes it.

---

### Task 9: Journal + snapshot bookkeeping

**Files:**
- Modify: `/Users/steveharmeyer/Development/dayz-one-life/one-life/packages/db/drizzle/meta/_journal.json`
- Verify (do not hand-edit unless Step 9.4 forces it): `/Users/steveharmeyer/Development/dayz-one-life/one-life/packages/db/drizzle/meta/0014_snapshot.json`

**Interfaces:**
- Journal entry shape: `{ idx: number; version: "7"; when: number /* epoch ms */; tag: string /* .sql basename, no extension */; breakpoints: true }`.
- Snapshot invariant: `0014_snapshot.json`'s `"prevId"` must equal `0013_snapshot.json`'s `"id"`, which is `28f5c333-245f-4003-b35d-eaad7ad118a1`.

- [ ] **Step 9.1: Fix the journal `tag` to match the renamed file.** Open `_journal.json`, find the appended entry (last in `entries`) — its `tag` is the random generated name. Edit that one field:

```json
    {
      "idx": 14,
      "version": "7",
      "when": 1784500000000,
      "tag": "0014_article_natural_key_and_blocks",
      "breakpoints": true
    }
```

Leave the generated `when` value exactly as drizzle-kit wrote it (it is a real epoch-ms timestamp); only `tag` changes. If for any reason the entry is absent, add it with `when` from `node -e "console.log(Date.now())"`.

- [ ] **Step 9.2: Verify tag/file agreement mechanically.**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life/packages/db/drizzle
node -e '
const j = require("./meta/_journal.json");
const fs = require("fs");
for (const e of j.entries) {
  const f = `./${e.tag}.sql`;
  if (!fs.existsSync(f)) { console.error("MISSING", f); process.exit(1); }
}
console.log("journal ok:", j.entries.length, "entries, last =", j.entries.at(-1).tag);
'
```

Expected: `journal ok: 15 entries, last = 0014_article_natural_key_and_blocks`.

- [ ] **Step 9.3: Verify the snapshot chain and that it captured all four changes.**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life/packages/db/drizzle/meta
node -e '
const a = require("./0013_snapshot.json"), b = require("./0014_snapshot.json");
console.log("prevId ok:", b.prevId === a.id, b.prevId);
'
grep -c "natural_key" 0014_snapshot.json
grep -c "body_blocks" 0014_snapshot.json
grep -c "articles_kind_status_created_idx" 0014_snapshot.json
```

Expected: `prevId ok: true 28f5c333-245f-4003-b35d-eaad7ad118a1`, and each `grep -c` prints a non-zero count. If any count is 0, the schema edit from Task 7 did not land — re-run `pnpm --filter @onelife/db db:generate` (it will overwrite the snapshot; you will then have to redo the rename in Step 8.3 and the tag in Step 9.1).

- [ ] **Step 9.4: Verify the partial predicate actually survived into the snapshot.** The `grep -c` checks above cannot see whether drizzle-kit 0.28 serialized the `where` predicate on the *unique* index — the same weakness that forces the hand-written SQL. If it silently dropped the predicate, the snapshot drifts from reality and migration `0015` will try to re-add it.

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life/packages/db/drizzle/meta
node -e '
const s = require("./0014_snapshot.json");
const idx = s.tables["public.articles"].indexes["articles_kind_server_gamertag_life_uniq"];
console.log("uniq life index where:", JSON.stringify(idx.where));
if (!idx.where) { console.error("SNAPSHOT DRIFT: predicate not serialized — record it in the PR body"); process.exit(1); }
'
```

Expected: a non-empty `where` string is printed and the script exits 0. **If it exits 1**, hand-edit the `where` field into that index entry in `0014_snapshot.json` so it reads `"where": "\"articles\".\"kind\" IN ('obituary','birth_notice')"` — the file is machine-generated but hand-editable, and `0013`'s hand-written precedent already accepts that. Either way, record the outcome in the PR body.

- [ ] **Step 9.5: Confirm exactly three files changed under `drizzle/`,** matching the 0013 commit's shape:

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
git status --short packages/db/drizzle
```

Expected: `?? packages/db/drizzle/0014_article_natural_key_and_blocks.sql`, `?? packages/db/drizzle/meta/0014_snapshot.json`, `M packages/db/drizzle/meta/_journal.json`. Any stray `0014_<random>.sql` here means Step 8.3 was skipped — delete it.

- [ ] **Step 9.6: Commit the migration.**

```bash
git add packages/db/drizzle/0014_article_natural_key_and_blocks.sql \
        packages/db/drizzle/meta/0014_snapshot.json \
        packages/db/drizzle/meta/_journal.json
git commit -m "feat(db): migration 0014 — natural_key, body_blocks, partial life uniq, created feed idx"
```

---

### Task 10: Apply 0014 to the test database and verify the partial index

**Files:**
- Test: `/Users/steveharmeyer/Development/dayz-one-life/one-life/apps/newsdesk/test/migration-0014.test.ts` (turns GREEN here)
- Modify: none

**Interfaces:**
- Consumed: `migrateDb(url: string): Promise<void>` (`packages/db/src/migrate.ts`), invoked automatically by the vitest `globalSetup` in `packages/test-support/src/global-setup.ts`; and `drizzle-kit migrate` via `pnpm --filter @onelife/db db:migrate`, which reads `DATABASE_URL` from `packages/db/drizzle.config.ts`'s `dbCredentials`.
- Produced: the applied 0014 schema in `onelife_test`, and a verified `pg_indexes.indexdef` predicate string.

- [ ] **Step 10.1: Ensure Postgres is up.** This dev machine remaps the host port to **5434** via a gitignored `docker-compose.override.yml`.

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
docker compose up -d postgres
docker compose ps postgres
```

Expected: state `running`/`healthy`.

- [ ] **Step 10.2: Apply the migration explicitly.** (The test run in Step 10.4 would also apply it via `globalSetup`, but applying it directly first isolates a SQL syntax error from a test failure.)

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
  pnpm --filter @onelife/db db:migrate
```

Expected: drizzle-kit prints the applied migration and exits 0. A failure here is a syntax error in the hand-written SQL — read the Postgres error, fix `0014_article_natural_key_and_blocks.sql`, and note that a *partially* applied migration leaves the journal row absent, so re-running is safe for the index half: `DROP INDEX IF EXISTS` plus `CREATE ... IF NOT EXISTS` makes all three index statements idempotent. **The two `ADD COLUMN`s are the only unguarded statements** — if either already landed, drop it manually before retrying:

```bash
docker compose exec -T postgres psql -U onelife -d onelife_test -c \
  "ALTER TABLE articles DROP COLUMN IF EXISTS natural_key; ALTER TABLE articles DROP COLUMN IF EXISTS body_blocks;"
```

- [ ] **Step 10.3: Verify the partial-index predicate directly in psql — this is the change that can silently no-op.**

```bash
docker compose exec -T postgres psql -U onelife -d onelife_test -c \
  "select indexname, indexdef from pg_indexes where tablename = 'articles' order by indexname;"
```

Expected — the two lines that matter, verbatim in shape:

```
 articles_kind_server_gamertag_life_uniq | CREATE UNIQUE INDEX articles_kind_server_gamertag_life_uniq ON public.articles USING btree (kind, server_id, gamertag, life_started_at) WHERE (kind = ANY (ARRAY['obituary'::text, 'birth_notice'::text]))
 articles_natural_key_uniq               | CREATE UNIQUE INDEX articles_natural_key_uniq ON public.articles USING btree (natural_key) WHERE (natural_key IS NOT NULL)
```

Postgres normalizes `kind IN ('a','b')` into `kind = ANY (ARRAY[...])` — that is the correct, expected rendering, not a discrepancy. **If `articles_kind_server_gamertag_life_uniq` has no `WHERE` clause, the `DROP INDEX`/recreate did not take effect and W3 must not proceed.**

Also confirm the columns and the new feed index:

```bash
docker compose exec -T postgres psql -U onelife -d onelife_test -c \
  "\d articles" | grep -E "natural_key|body_blocks|kind_status_created"
```

Expected three lines: `natural_key | text`, `body_blocks | jsonb`, and the `articles_kind_status_created_idx` btree entry.

- [ ] **Step 10.4: Run the Task 6 test — it must now be GREEN.**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
  pnpm --filter @onelife/newsdesk test test/migration-0014.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  5 passed (5)`.

- [ ] **Step 10.5: Run the full newsdesk suite and record the expected RED.**

```bash
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
  pnpm --filter @onelife/newsdesk test
```

Expected: `migration-0014.test.ts` passes; **`pg-store.test.ts` and `birth-pg-store.test.ts` now FAIL** with `PostgresError: there is no unique or exclusion constraint matching the ON CONFLICT specification` (code `42P10`) raised from `publishObituary` / `recordObituaryFailure` / `publishBirthNotice` / `recordBirthNoticeFailure`. This is the predicted, correct consequence of making the index partial — it is W3's job to fix, and seeing this exact error is the confirmation that the migration truly changed the index. Copy the error text into the W3 handoff.

- [ ] **Step 10.6: Typecheck the touched packages.**

```bash
pnpm --filter @onelife/db typecheck && pnpm --filter @onelife/newsdesk typecheck
```

Expected: both exit 0.

- [ ] **Step 10.7: Commit nothing new here** unless Step 10.2 forced a SQL fix; if it did:

```bash
git add packages/db/drizzle/0014_article_natural_key_and_blocks.sql
git commit -m "fix(db): correct 0014 SQL after applying to onelife_test"
```

---

### Task 11: Hand off to W3 — sequencing so no commit leaves publishing broken

**Files:**
- Modify: none. This task produces only a git history shape and a handoff note.

**Interfaces:**
- Consumed by W3 (Tasks 12–17): the four `onConflictDoUpdate` sites — `apps/newsdesk/src/pg-store.ts` (`publishObituary`, `recordObituaryFailure`) and `apps/newsdesk/src/birth-pg-store.ts` (`publishBirthNotice`, `recordBirthNoticeFailure`). Each needs `targetWhere: inArray(articles.kind, ["obituary", "birth_notice"])` as a **sibling key of `target`** — it cannot be folded into either file's module-level `CONFLICT` array constant. `inArray` is not currently imported in either file.
- Produced: a branch state where `develop` never sees a commit in which article publishing is broken.

**The state of the tree at the end of W2 is intentionally RED.** Migration 0014 makes `articles_kind_server_gamertag_life_uniq` partial; a bare `ON CONFLICT (kind, server_id, gamertag, life_started_at)` can no longer infer a partial index, so all four upserts raise Postgres `42P10` and the newsdesk publish path is dead until W3 lands. This is not a bug to investigate — Step 10.5 predicts the exact error.

- [ ] **Step 11.1: Confirm the current W2 commits.**

```bash
cd /Users/steveharmeyer/Development/dayz-one-life/one-life
git log --oneline develop..HEAD
```

Expected, oldest-last: the migration commit, the schema commit, and the RED-test commit. All three are local to `feature/r5d-prb-plumbing`; **none has been pushed.**

- [ ] **Step 11.2: Do NOT push and do NOT open a PR until W3 (Tasks 12–17) is complete.** The required sequencing:

  1. W2 commits stay local on `feature/r5d-prb-plumbing`.
  2. W3 lands its four `targetWhere` edits plus the mandatory double-publish regression test on the same branch, immediately after.
  3. Only once `pnpm --filter @onelife/newsdesk test` is fully green does anything get pushed.
  4. The PR is squash-merged into `develop` (repo workflow), so W2+W3 reach `develop` as **one** commit — meaning no commit on a protected branch ever has a partial index without matching `targetWhere` clauses. The intermediate RED state exists only in this feature branch's local history, which is the correct place for it.

  Do not attempt to reorder W2 and W3 to avoid the RED window: `targetWhere` on a **total** index is also invalid (Postgres rejects an inference predicate that the index does not satisfy), so W3-before-W2 breaks publishing just as surely, and in a way that is harder to diagnose.

- [ ] **Step 11.3: Write the handoff line into Task 12's starting context** (paste into the implementation notes, not into a file):

> W2 is applied to `onelife_test`. `articles_kind_server_gamertag_life_uniq` is now `... WHERE (kind = ANY (ARRAY['obituary'::text, 'birth_notice'::text]))`. `pg-store.test.ts` and `birth-pg-store.test.ts` are failing with `PostgresError 42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification`. Fix by adding `targetWhere: inArray(articles.kind, ["obituary", "birth_notice"])` to all four `onConflictDoUpdate` calls and extending the `drizzle-orm` import in both files to include `inArray`. Those two suites returning to green is the pass condition.

- [ ] **Step 11.4: Deploy note for the release (carry into Task 24's CHANGELOG entry).** Migration 0014 is a normal-deploy migration — it needs **no** projection rebuild. `articles` and `article_images` are not in `apps/projector/src/rebuild.ts`'s TRUNCATE list and hold no FK to `players`/`lives`, so a rebuild cannot reach them. `./deploy/deploy.sh` without `--rebuild` is correct. The one ordering constraint is that the newsdesk binary carrying W3's `targetWhere` edits must be deployed in the same release as the migration — which the single squash-merge guarantees.

---

### Task 12: Write the blast-radius regression test (must FAIL against the partial index)

**Files:**
- Create: `apps/newsdesk/test/partial-index-upsert.test.ts`
- Modify: none
- Test: `apps/newsdesk/test/partial-index-upsert.test.ts`

**Interfaces consumed** (exact, from `apps/newsdesk/src/pg-store.ts` and `apps/newsdesk/src/birth-pg-store.ts` — anchor on these names, not line numbers):
```ts
export interface ObituaryTarget { lifeId: number; serverId: number; gamertag: string; map: string; mapSlug: string | null; lifeNumber: number; lifeStartedAt: Date; endedAt: Date }
export interface BirthNoticeTarget { lifeId: number; serverId: number; gamertag: string; map: string; mapSlug: string | null; lifeNumber: number; lifeStartedAt: Date; endedAt: Date | null }
export async function publishObituary(db: Database, input: PublishInput): Promise<void>
export async function recordObituaryFailure(db: Database, input: { target: ObituaryTarget; error: string }): Promise<void>
export async function publishBirthNotice(db: Database, input: PublishBirthInput): Promise<void>
export async function recordBirthNoticeFailure(db: Database, args: { target: BirthNoticeTarget; error: string }): Promise<void>
// PublishInput      = { target; facts: PublishFacts; obituary: PublishObituary; promptVersion: string; model: string; now: Date }
// PublishBirthInput = { target; facts: PublishBirthFacts; notice: PublishBirthNotice; promptVersion: string; model: string; now: Date }
// PublishFacts      = { sessions; killerGamertag; weapon; timeAliveSeconds; kills; longestKillMeters; cause }
// PublishBirthFacts = { minutesToQualify: number | null; persona: string | null; isKnownQuantity: boolean }
// Publish{Obituary,BirthNotice} = { headline; lede; body; pullQuote: {text;attribution} | null; tags: string[] }
```
**Interfaces produced:** none (test-only).

- [ ] **Step 12.1: Confirm migration 0014 is applied to the test database.** W2 landed the partial index; the harness runs migrations at globalSetup, but verify the index is actually partial before trusting a red bar:
  ```bash
  psql postgres://onelife:onelife@localhost:5434/onelife_test \
    -c "select indexdef from pg_indexes where indexname='articles_kind_server_gamertag_life_uniq';"
  ```
  Expected output contains `... WHERE (kind = ANY (ARRAY['obituary'::text, 'birth_notice'::text]))`. If the `WHERE` clause is absent, stop — W2 is not applied and this task's failure would be meaningless.

- [ ] **Step 12.2: Create the test file.** Write `apps/newsdesk/test/partial-index-upsert.test.ts` verbatim:
  ```ts
  import { describe, it, expect, beforeAll, afterAll } from "vitest";
  import { getTestDb } from "@onelife/test-support";
  import { servers, players, lives, articles } from "@onelife/db";
  import { eq, and, inArray } from "drizzle-orm";
  import { publishObituary, recordObituaryFailure, type ObituaryTarget } from "../src/pg-store.js";
  import { publishBirthNotice, recordBirthNoticeFailure, type BirthNoticeTarget } from "../src/birth-pg-store.js";

  // Guards the partial unique index added in migration 0014. Making
  // `articles_kind_server_gamertag_life_uniq` partial (WHERE kind IN ('obituary','birth_notice'))
  // means every ON CONFLICT that targets it must carry a matching `targetWhere` — without one
  // Postgres raises 42P10 "no unique or exclusion constraint matching the ON CONFLICT
  // specification" and publishing dies on the next newsdesk tick.
  const { db, sql } = getTestDb();
  const svc = Math.floor(Math.random() * 1e8) + 53e7;
  const t0 = new Date("2026-07-18T00:00:00Z");
  const hrs = (h: number) => new Date(t0.getTime() + h * 3600_000);

  let serverId: number;
  const pids: number[] = [];
  const lifeIds: number[] = [];

  async function seedLife(tag: string, over: Record<string, unknown>) {
    const [p] = await db.insert(players).values({ gamertag: tag }).returning();
    pids.push(p!.id);
    const [l] = await db
      .insert(lives)
      .values({ serverId, playerId: p!.id, lifeNumber: 1, startedAt: hrs(0), ...over })
      .returning();
    lifeIds.push(l!.id);
    return { lifeId: l!.id, gamertag: tag, lifeStartedAt: hrs(0) };
  }

  let dead: { lifeId: number; gamertag: string; lifeStartedAt: Date };
  let alive: { lifeId: number; gamertag: string; lifeStartedAt: Date };
  let failStub: { lifeId: number; gamertag: string; lifeStartedAt: Date };

  beforeAll(async () => {
    const [s] = await db
      .insert(servers)
      .values({ nitradoServiceId: svc, name: "pi", map: "chernarusplus", slug: `pi-${svc}`, active: true })
      .returning();
    serverId = s!.id;
    dead = await seedLife(`pi-o-${svc}`, { endedAt: hrs(2), deathCause: "pvp", playtimeSeconds: 7200 });
    alive = await seedLife(`pi-b-${svc}`, { playtimeSeconds: 7200 });
    failStub = await seedLife(`pi-f-${svc}`, { endedAt: hrs(4), deathCause: "pvp", playtimeSeconds: 7200 });
  });

  afterAll(async () => {
    await db.delete(articles).where(eq(articles.serverId, serverId));
    await db.delete(lives).where(inArray(lives.id, lifeIds));
    await db.delete(players).where(inArray(players.id, pids));
    await db.delete(servers).where(eq(servers.id, serverId));
    await sql.end();
  });

  const obitTarget = (o: typeof dead): ObituaryTarget => ({
    lifeId: o.lifeId, serverId, gamertag: o.gamertag, map: "chernarusplus",
    mapSlug: `pi-${svc}`, lifeNumber: 1, lifeStartedAt: o.lifeStartedAt, endedAt: hrs(2),
  });
  const birthTarget = (o: typeof alive): BirthNoticeTarget => ({
    lifeId: o.lifeId, serverId, gamertag: o.gamertag, map: "chernarusplus",
    mapSlug: `pi-${svc}`, lifeNumber: 1, lifeStartedAt: o.lifeStartedAt, endedAt: null,
  });

  const rowsFor = (kind: string, gamertag: string) =>
    db.select().from(articles).where(and(eq(articles.kind, kind), eq(articles.gamertag, gamertag)));

  describe("partial unique index: article upserts still conflict-resolve", () => {
    it("publishes an obituary twice — upserts in place, attempts = 2", async () => {
      const target = obitTarget(dead);
      const facts = { sessions: 1, killerGamertag: "Killer", weapon: "M4", timeAliveSeconds: 7200, kills: 3, longestKillMeters: 90, cause: "pvp" };
      const base = { target, facts, promptVersion: "obituary-v2", model: "test", now: hrs(5) };
      await publishObituary(db, { ...base, obituary: { headline: "Gone First", lede: "l1", body: "b1", pullQuote: null, tags: ["Obituaries"] } });
      await publishObituary(db, { ...base, obituary: { headline: "Gone Second", lede: "l2", body: "b2", pullQuote: null, tags: ["Obituaries"] } });

      const rows = await rowsFor("obituary", dead.gamertag);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.attempts).toBe(2);
      expect(rows[0]!.headline).toBe("Gone Second");
      expect(rows[0]!.status).toBe("published");
    });

    it("publishes a birth notice twice — upserts in place, attempts = 2", async () => {
      const target = birthTarget(alive);
      const facts = { minutesToQualify: 6, persona: null, isKnownQuantity: false };
      const base = { target, facts, promptVersion: "birth-v1", model: "test", now: hrs(5) };
      await publishBirthNotice(db, { ...base, notice: { headline: "Ashore First", lede: "l1", body: "b1", pullQuote: null, tags: ["Fresh Spawns"] } });
      await publishBirthNotice(db, { ...base, notice: { headline: "Ashore Second", lede: "l2", body: "b2", pullQuote: null, tags: ["Fresh Spawns"] } });

      const rows = await rowsFor("birth_notice", alive.gamertag);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.attempts).toBe(2);
      expect(rows[0]!.headline).toBe("Ashore Second");
      expect(rows[0]!.status).toBe("published");
    });

    it("records an obituary failure stub twice — upserts in place, attempts = 2", async () => {
      const target = obitTarget(failStub);
      await recordObituaryFailure(db, { target, error: "boom-1" });
      await recordObituaryFailure(db, { target, error: "boom-2" });

      const rows = await rowsFor("obituary", failStub.gamertag);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.attempts).toBe(2);
      expect(rows[0]!.status).toBe("failed");
      expect(rows[0]!.lastError).toBe("boom-2");
    });

    it("records a birth-notice failure stub twice — upserts in place, attempts = 2", async () => {
      const target = birthTarget(alive);
      // Same life already has a published notice: the stub must conflict onto that same row.
      await recordBirthNoticeFailure(db, { target, error: "birth-boom-1" });
      await recordBirthNoticeFailure(db, { target, error: "birth-boom-2" });

      const rows = await rowsFor("birth_notice", alive.gamertag);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.attempts).toBe(4); // 2 publishes + 2 failures on the same row
      expect(rows[0]!.status).toBe("failed");
      expect(rows[0]!.lastError).toBe("birth-boom-2");
    });
  });
  ```

- [ ] **Step 12.3: Run it and SEE IT FAIL.**
  ```bash
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test test/partial-index-upsert.test.ts
  ```
  Expected: all four tests fail with a Postgres error whose message contains
  `there is no unique or exclusion constraint matching the ON CONFLICT specification` (SQLSTATE `42P10`).
  If any test instead *passes*, the migration is not applied — go back to Step 12.1; do not proceed.

- [ ] **Step 12.4: Commit the red test.**
  ```bash
  git add apps/newsdesk/test/partial-index-upsert.test.ts && \
  git commit -m "test(newsdesk): guard article upserts against the partial unique index"
  ```

---

### Task 13: Fix site 1 of 4 — `publishObituary` in `pg-store.ts`

**Files:**
- Modify: `apps/newsdesk/src/pg-store.ts`
- Test: `apps/newsdesk/test/partial-index-upsert.test.ts` (from Task 12)

**Interfaces consumed:** `inArray` from `drizzle-orm`; `articles.kind` from `@onelife/db`.
**Interfaces produced:** none — `publishObituary(db, input): Promise<void>` signature is unchanged.

- [ ] **Step 13.1: Extend the drizzle-orm import.** Find the import line at the top of `apps/newsdesk/src/pg-store.ts`:
  ```ts
  import { and, eq, desc, asc, isNull, isNotNull, notExists, sql } from "drizzle-orm";
  ```
  Replace with:
  ```ts
  import { and, eq, desc, asc, inArray, isNull, isNotNull, notExists, sql } from "drizzle-orm";
  ```

- [ ] **Step 13.2: Add a shared `targetWhere` constant next to `CONFLICT`.** Find:
  ```ts
  // The article's identity is the natural life tuple — the conflict target for both upserts.
  const CONFLICT = [articles.kind, articles.serverId, articles.gamertag, articles.lifeStartedAt];
  ```
  Replace with:
  ```ts
  // The article's identity is the natural life tuple — the conflict target for both upserts.
  const CONFLICT = [articles.kind, articles.serverId, articles.gamertag, articles.lifeStartedAt];
  // Migration 0014 made that unique index PARTIAL. Postgres only matches an ON CONFLICT target to a
  // partial index when the statement repeats its predicate, so every upsert here must pass this
  // alongside `target` — omitting it raises 42P10 and kills publishing on the next tick.
  const CONFLICT_WHERE = inArray(articles.kind, ["obituary", "birth_notice"]);
  ```

- [ ] **Step 13.3: Add `targetWhere` to the `publishObituary` upsert.** Find (inside `publishObituary`):
  ```ts
      .onConflictDoUpdate({
        target: CONFLICT,
        set: { ...values, attempts: sql`${articles.attempts} + 1`, lastError: null },
      });
  ```
  Replace with:
  ```ts
      .onConflictDoUpdate({
        target: CONFLICT,
        targetWhere: CONFLICT_WHERE,
        set: { ...values, attempts: sql`${articles.attempts} + 1`, lastError: null },
      });
  ```
  Note: this exact `set:` text appears once per file — but `birth-pg-store.ts` has an identical block, so scope the edit to `pg-store.ts`.

- [ ] **Step 13.4: Run the guard — obituary publish test should now pass, the other three still fail.**
  ```bash
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test test/partial-index-upsert.test.ts
  ```
  Expected: `1 passed | 3 failed` — "publishes an obituary twice" green, the other three still `42P10`.

---

### Task 14: Fix site 2 of 4 — `recordObituaryFailure` in `pg-store.ts`

**Files:**
- Modify: `apps/newsdesk/src/pg-store.ts`
- Test: `apps/newsdesk/test/partial-index-upsert.test.ts`

**Interfaces consumed:** `CONFLICT_WHERE` (module-local, added in Task 13).
**Interfaces produced:** none — `recordObituaryFailure(db, { target, error }): Promise<void>` unchanged.

- [ ] **Step 14.1: Add `targetWhere` to the failure stub.** In `apps/newsdesk/src/pg-store.ts`, find (inside `recordObituaryFailure`):
  ```ts
      .onConflictDoUpdate({
        target: CONFLICT,
        set: { status: "failed", attempts: sql`${articles.attempts} + 1`, lastError: input.error },
      });
  ```
  Replace with:
  ```ts
      .onConflictDoUpdate({
        target: CONFLICT,
        targetWhere: CONFLICT_WHERE,
        set: { status: "failed", attempts: sql`${articles.attempts} + 1`, lastError: input.error },
      });
  ```
  (`input.error` is the discriminator vs. the birth-notice sibling, which uses `args.error`.)

- [ ] **Step 14.2: Run the guard.**
  ```bash
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test test/partial-index-upsert.test.ts
  ```
  Expected: `2 passed | 2 failed` — both obituary tests green, both birth-notice tests still `42P10`.

- [ ] **Step 14.3: Commit the obituary half.**
  ```bash
  git add apps/newsdesk/src/pg-store.ts && \
  git commit -m "fix(newsdesk): match the partial unique index in obituary upserts"
  ```

---

### Task 15: Fix site 3 of 4 — `publishBirthNotice` in `birth-pg-store.ts`

**Files:**
- Modify: `apps/newsdesk/src/birth-pg-store.ts`
- Test: `apps/newsdesk/test/partial-index-upsert.test.ts`

**Interfaces consumed:** `inArray` from `drizzle-orm`; `articles.kind` from `@onelife/db`.
**Interfaces produced:** none — `publishBirthNotice(db, input): Promise<void>` unchanged.

- [ ] **Step 15.1: Extend the drizzle-orm import.** Find in `apps/newsdesk/src/birth-pg-store.ts`:
  ```ts
  import { and, eq, asc, gte, notExists, sql } from "drizzle-orm";
  ```
  Replace with:
  ```ts
  import { and, eq, asc, gte, inArray, notExists, sql } from "drizzle-orm";
  ```

- [ ] **Step 15.2: Add the `CONFLICT_WHERE` constant.** Find:
  ```ts
  // The article's identity is the natural life tuple — the conflict target for both upserts.
  const CONFLICT = [articles.kind, articles.serverId, articles.gamertag, articles.lifeStartedAt];
  ```
  Replace with:
  ```ts
  // The article's identity is the natural life tuple — the conflict target for both upserts.
  const CONFLICT = [articles.kind, articles.serverId, articles.gamertag, articles.lifeStartedAt];
  // Migration 0014 made that unique index PARTIAL; an ON CONFLICT target only matches a partial
  // index when the statement repeats its predicate. Mirrors pg-store.ts — deliberately duplicated,
  // each store owns its own conflict spec (see also the mirrored CONFLICT above).
  const CONFLICT_WHERE = inArray(articles.kind, ["obituary", "birth_notice"]);
  ```

- [ ] **Step 15.3: Add `targetWhere` to the publish upsert.** Find (inside `publishBirthNotice`):
  ```ts
      .onConflictDoUpdate({
        target: CONFLICT,
        set: { ...values, attempts: sql`${articles.attempts} + 1`, lastError: null },
      });
  ```
  Replace with:
  ```ts
      .onConflictDoUpdate({
        target: CONFLICT,
        targetWhere: CONFLICT_WHERE,
        set: { ...values, attempts: sql`${articles.attempts} + 1`, lastError: null },
      });
  ```

- [ ] **Step 15.4: Run the guard.**
  ```bash
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test test/partial-index-upsert.test.ts
  ```
  Expected: `3 passed | 1 failed` — only "records a birth-notice failure stub twice" still `42P10`.

---

### Task 16: Fix site 4 of 4 — `recordBirthNoticeFailure` in `birth-pg-store.ts`

**Files:**
- Modify: `apps/newsdesk/src/birth-pg-store.ts`
- Test: `apps/newsdesk/test/partial-index-upsert.test.ts`

**Interfaces consumed:** `CONFLICT_WHERE` (module-local, added in Task 15).
**Interfaces produced:** none — `recordBirthNoticeFailure(db, { target, error }): Promise<void>` unchanged.

- [ ] **Step 16.1: Add `targetWhere` to the failure stub.** Find (inside `recordBirthNoticeFailure`):
  ```ts
      .onConflictDoUpdate({
        target: CONFLICT,
        set: { status: "failed", attempts: sql`${articles.attempts} + 1`, lastError: args.error },
      });
  ```
  Replace with:
  ```ts
      .onConflictDoUpdate({
        target: CONFLICT,
        targetWhere: CONFLICT_WHERE,
        set: { status: "failed", attempts: sql`${articles.attempts} + 1`, lastError: args.error },
      });
  ```

- [ ] **Step 16.2: Run the guard — ALL FOUR GREEN.**
  ```bash
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test test/partial-index-upsert.test.ts
  ```
  Expected: `Test Files  1 passed (1)` / `Tests  4 passed (4)`.

- [ ] **Step 16.3: Commit the birth-notice half.**
  ```bash
  git add apps/newsdesk/src/birth-pg-store.ts && \
  git commit -m "fix(newsdesk): match the partial unique index in birth-notice upserts"
  ```

---

### Task 17: Repo-wide audit — every `onConflictDoUpdate` on the partial index carries `targetWhere`

**Files:**
- Modify: none (audit only; fix anything the grep surfaces)
- Test: none new — this is a manual verification gate

**Interfaces consumed:** none.
**Interfaces produced:** none.

- [ ] **Step 17.1: Enumerate every upsert in the repo.**
  ```bash
  grep -rn "onConflictDoUpdate" --include="*.ts" \
    apps packages | grep -v node_modules
  ```
  Expected exactly 7 hits:
  ```
  apps/newsdesk/src/birth-pg-store.ts:<n>
  apps/newsdesk/src/birth-pg-store.ts:<n>
  apps/newsdesk/src/image-pg-store.ts:<n>
  apps/newsdesk/src/pg-store.ts:<n>
  apps/newsdesk/src/pg-store.ts:<n>
  apps/projector/src/pg-store.ts:<n>
  packages/event-log/src/cursor.ts:<n>
  ```
  If the count is **not 7**, a new upsert has appeared since the survey — open it and check whether its `target` is `[articles.kind, articles.serverId, articles.gamertag, articles.lifeStartedAt]`. If so it needs `targetWhere: CONFLICT_WHERE` and a case in `partial-index-upsert.test.ts`.

- [ ] **Step 17.2: Assert the four `articles` natural-key sites all carry `targetWhere`.**
  ```bash
  grep -rn -A2 "target: CONFLICT" apps/newsdesk/src/pg-store.ts apps/newsdesk/src/birth-pg-store.ts
  ```
  Expected: **four** `target: CONFLICT,` lines, each immediately followed by `targetWhere: CONFLICT_WHERE,`. Any `target: CONFLICT` without the next line being `targetWhere:` is an unfixed site — go fix it now.

- [ ] **Step 17.3: Confirm the three non-`articles` upserts are correctly untouched.**
  ```bash
  grep -n "target:" packages/event-log/src/cursor.ts apps/projector/src/pg-store.ts apps/newsdesk/src/image-pg-store.ts
  ```
  Expected targets: `consumerCursors.*` (a table-level PK), `[players.gamertag]`, `[articleImages.articleId]`. None of these is `articles_kind_server_gamertag_life_uniq`; none of them is partial; **no `targetWhere` should be added to any of them.**

- [ ] **Step 17.4: Prove no other code hardcodes the index name.**
  ```bash
  grep -rn "articles_kind_server_gamertag_life_uniq" --include="*.ts" --include="*.sql" \
    apps packages | grep -v node_modules
  ```
  Expected: only `packages/db/src/schema.ts`, `packages/db/drizzle/0014_*.sql`, and the `meta/*_snapshot.json` bookkeeping — no application code names the index directly.

- [ ] **Step 17.5: Run the full newsdesk suite.**
  ```bash
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/newsdesk test
  ```
  Expected: all files pass. Pay particular attention to `test/pg-store.test.ts` and `test/birth-pg-store.test.ts` — they exercise the same upserts through `findObituaryTargets`/`recordObituaryFailure` and are the second line of defence.

- [ ] **Step 17.6: Typecheck the workspace.**
  ```bash
  pnpm turbo run typecheck
  ```
  Expected: all tasks succeed. A failure here most likely means `inArray` was added to only one of the two import lines.

- [ ] **Step 17.7: Commit the audit outcome (only if any fix was needed).** If Steps 17.1–17.4 surfaced nothing, there is nothing to commit — record in the PR body that the audit found exactly four `articles` conflict sites, all carrying `targetWhere`, and three unrelated upserts left untouched.

---

### Task 18: Declare the `ArticleBlock` union and the optional `bodyBlocks` DTO field

**Files:**
- Modify: `/Users/steveharmeyer/Development/dayz-one-life/one-life/apps/web/src/lib/types.ts`

**Interfaces:**
- Produced: `export type ArticleBlock = { type: "para"; text: string } | { type: "subhead"; text: string } | { type: "quote"; text: string; attribution: string } | { type: "list"; items: string[] }`
- Produced: `ObituaryArticle.bodyBlocks?: ArticleBlock[] | null` and `BirthNoticeArticle.bodyBlocks?: ArticleBlock[] | null` — **optional** (`?:`, not required-nullable), so every existing fixture in `obituary-article.test.tsx` / `birth-notice-article.test.tsx` and every read-model response that omits the field still typechecks unchanged.

Anchor every edit on the quoted code below, not on line numbers — line numbers in this file drift.

- [ ] **Step 18.1: Add the `ArticleBlock` union above `ObituaryCard`.**
  In `apps/web/src/lib/types.ts`, find the line `export type ObituaryCard = {` and insert immediately **above** it:
  ```ts
  /**
   * Rich-body block union (R5d). `articles.body_blocks` is jsonb and null for every article written
   * before R5d, so this is always optional — a null/absent value means "render the flat `body`".
   * A future block type an older client does not know about is dropped by the renderer, never thrown.
   */
  export type ArticleBlock =
    | { type: "para"; text: string }
    | { type: "subhead"; text: string }
    | { type: "quote"; text: string; attribution: string }
    | { type: "list"; items: string[] };
  ```

- [ ] **Step 18.2: Add `bodyBlocks` to `ObituaryArticle`.**
  Find:
  ```ts
  export type ObituaryArticle = ObituaryCard & {
    body: string;
  ```
  Replace those two lines with:
  ```ts
  export type ObituaryArticle = ObituaryCard & {
    body: string;
    bodyBlocks?: ArticleBlock[] | null;
  ```

- [ ] **Step 18.3: Add `bodyBlocks` to `BirthNoticeArticle`.**
  Find:
  ```ts
  export type BirthNoticeArticle = BirthNoticeCard & {
    body: string;
  ```
  Replace those two lines with:
  ```ts
  export type BirthNoticeArticle = BirthNoticeCard & {
    body: string;
    bodyBlocks?: ArticleBlock[] | null;
  ```

- [ ] **Step 18.4: Typecheck — additive, nothing may break.**
  ```
  pnpm --filter @onelife/web typecheck
  ```
  Expected: exits 0 with no diagnostics. If anything errors about a missing `bodyBlocks`, the field was written as required (`bodyBlocks:`) instead of optional (`bodyBlocks?:`) — fix that, do not add the field to fixtures.

- [ ] **Step 18.5: Commit.**
  ```
  git add apps/web/src/lib/types.ts
  git commit -m "feat(web): add ArticleBlock union and optional bodyBlocks DTO field"
  ```

---

### Task 19: Create the shared `ArticleBody` renderer (TDD)

**Files:**
- Create (test first): `/Users/steveharmeyer/Development/dayz-one-life/one-life/apps/web/src/components/shared/article-body.test.tsx`
- Create: `/Users/steveharmeyer/Development/dayz-one-life/one-life/apps/web/src/components/shared/article-body.tsx`

**Interfaces:**
- Consumed: `ArticleBlock` from `@/lib/types` (Task 18); `PullQuote({ text, attribution })` from `@/components/shared/pull-quote`; `cn` from `@/lib/utils`.
- Produced: `export function ArticleBody({ blocks, fallback, className }: { blocks?: ArticleBlock[] | null; fallback: string; className?: string })` — named export, no `default`, no explicit return type (house style for shared presentational components; see `ArticleHero`/`PullQuote`/`NumberedPager`, none of which annotate a return type).

Behaviour contract, in one sentence: **when `blocks` is null/undefined/empty the component renders exactly `fallback.split(/\n{2,}/).map(p => <p>)` inside the same wrapper the two interiors use today** — that is the zero-behaviour-change guarantee for all 168 existing rows.

- [ ] **Step 19.1: Write the failing test file.**
  Create `apps/web/src/components/shared/article-body.test.tsx` verbatim:
  ```tsx
  import { render, screen } from "@testing-library/react";
  import { describe, it, expect } from "vitest";
  import { ArticleBody } from "@/components/shared/article-body";
  import type { ArticleBlock } from "@/lib/types";

  const FLAT = "First paragraph.\n\nSecond paragraph.\n\n\nThird paragraph.";

  describe("ArticleBody — flat fallback (the 168-existing-rows guarantee)", () => {
    it("splits flat prose on blank lines into one <p> per paragraph when blocks is null", () => {
      const { container } = render(<ArticleBody blocks={null} fallback={FLAT} />);
      const paras = container.querySelectorAll("p");
      expect(paras).toHaveLength(3);
      expect(paras[0]!.textContent).toBe("First paragraph.");
      expect(paras[1]!.textContent).toBe("Second paragraph.");
      expect(paras[2]!.textContent).toBe("Third paragraph.");
    });

    it("uses the flat path when blocks is undefined", () => {
      const { container } = render(<ArticleBody fallback={FLAT} />);
      expect(container.querySelectorAll("p")).toHaveLength(3);
    });

    it("uses the flat path when blocks is an empty array", () => {
      const { container } = render(<ArticleBody blocks={[]} fallback={FLAT} />);
      expect(container.querySelectorAll("p")).toHaveLength(3);
    });

    it("keeps the shared body wrapper classes and appends the caller className", () => {
      const { container } = render(<ArticleBody blocks={null} fallback={FLAT} className="mt-5" />);
      const wrapper = container.firstElementChild!;
      expect(wrapper.className).toContain("space-y-4");
      expect(wrapper.className).toContain("font-mono");
      expect(wrapper.className).toContain("text-[14px]");
      expect(wrapper.className).toContain("leading-relaxed");
      expect(wrapper.className).toContain("text-ink-soft");
      expect(wrapper.className).toContain("mt-5");
    });
  });

  describe("ArticleBody — block rendering", () => {
    it("renders a para block as a <p>", () => {
      render(<ArticleBody blocks={[{ type: "para", text: "A body paragraph." }]} fallback="unused" />);
      expect(screen.getByText("A body paragraph.")).toBeInTheDocument();
      expect(screen.queryByText("unused")).toBeNull();
    });

    it("renders a subhead block as an h2", () => {
      render(<ArticleBody blocks={[{ type: "subhead", text: "The Last Hour" }]} fallback="unused" />);
      expect(screen.getByRole("heading", { level: 2, name: "The Last Hour" })).toBeInTheDocument();
    });

    it("renders a quote block with its attribution", () => {
      render(<ArticleBody blocks={[{ type: "quote", text: "He never made the treeline.", attribution: "a bystander" }]} fallback="unused" />);
      expect(screen.getByText(/He never made the treeline/)).toBeInTheDocument();
      expect(screen.getByText(/a bystander/)).toBeInTheDocument();
    });

    it("renders a list block as a <ul> with one <li> per item", () => {
      render(<ArticleBody blocks={[{ type: "list", items: ["Rifle", "Bandage", "Nothing else"] }]} fallback="unused" />);
      const items = screen.getAllByRole("listitem");
      expect(items.map((li) => li.textContent)).toEqual(["Rifle", "Bandage", "Nothing else"]);
    });

    it("renders blocks in order and mixes kinds", () => {
      const blocks: ArticleBlock[] = [
        { type: "para", text: "Opening." },
        { type: "subhead", text: "Middle" },
        { type: "para", text: "Closing." },
      ];
      const { container } = render(<ArticleBody blocks={blocks} fallback="unused" />);
      const kids = Array.from(container.firstElementChild!.children);
      expect(kids.map((el) => el.tagName)).toEqual(["P", "H2", "P"]);
      expect(kids.map((el) => el.textContent)).toEqual(["Opening.", "Middle", "Closing."]);
    });

    it("drops an unknown future block type instead of crashing", () => {
      const blocks = [
        { type: "para", text: "Kept." },
        { type: "sidebar-map", text: "From a newer writer." },
      ] as unknown as ArticleBlock[];
      render(<ArticleBody blocks={blocks} fallback="unused" />);
      expect(screen.getByText("Kept.")).toBeInTheDocument();
      expect(screen.queryByText("From a newer writer.")).toBeNull();
    });
  });
  ```

- [ ] **Step 19.2: Run it and watch it fail on the missing module.**
  ```
  pnpm --filter @onelife/web test src/components/shared/article-body.test.tsx
  ```
  Expected: the whole file fails to collect — `Failed to resolve import "@/components/shared/article-body"`. That is the correct red.

- [ ] **Step 19.3: Write the component.**
  Create `apps/web/src/components/shared/article-body.tsx` verbatim:
  ```tsx
  import { PullQuote } from "@/components/shared/pull-quote";
  import type { ArticleBlock } from "@/lib/types";
  import { cn } from "@/lib/utils";

  /** Shared article body. `blocks` is the R5d rich body; when it is null/absent (every article
   *  written before R5d) it falls back to splitting the flat `body` on blank lines — byte-identical
   *  output to the two hand-rolled renderers this replaced. An unrecognised block type is dropped
   *  (`default: return null`) so a newer writer can ship a new kind without breaking an older page. */
  export function ArticleBody({
    blocks,
    fallback,
    className,
  }: {
    blocks?: ArticleBlock[] | null;
    fallback: string;
    className?: string;
  }) {
    const wrapper = cn("space-y-4 font-mono text-[14px] leading-relaxed text-ink-soft", className);

    if (!blocks || blocks.length === 0) {
      return (
        <div className={wrapper}>
          {fallback.split(/\n{2,}/).map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
      );
    }

    return (
      <div className={wrapper}>
        {blocks.map((block, i) => {
          switch (block.type) {
            case "para":
              return <p key={i}>{block.text}</p>;
            case "subhead":
              return (
                <h2 key={i} className="pt-2 font-display text-2xl font-bold uppercase leading-tight text-ink">
                  {block.text}
                </h2>
              );
            case "quote":
              return <PullQuote key={i} text={block.text} attribution={block.attribution} />;
            case "list":
              return (
                <ul key={i} className="list-disc space-y-1 pl-5">
                  {block.items.map((item, j) => (
                    <li key={j}>{item}</li>
                  ))}
                </ul>
              );
            default:
              return null;
          }
        })}
      </div>
    );
  }
  ```

- [ ] **Step 19.4: Run the test green.**
  ```
  pnpm --filter @onelife/web test src/components/shared/article-body.test.tsx
  ```
  Expected: `Test Files  1 passed (1)`, `Tests  10 passed (10)`.
  If the quote test fails on the attribution text, open `apps/web/src/components/shared/pull-quote.tsx` and match the assertion to how it actually renders the attribution (it may prefix an em-dash); the regex `/a bystander/` is written loose for exactly that reason.

- [ ] **Step 19.5: Typecheck and commit.**
  ```
  pnpm --filter @onelife/web typecheck
  git add apps/web/src/components/shared/article-body.tsx apps/web/src/components/shared/article-body.test.tsx
  git commit -m "feat(web): shared ArticleBody renderer with block union and flat fallback"
  ```

---

### Task 20: Move the obituary interior onto `ArticleBody`

**Files:**
- Modify: `/Users/steveharmeyer/Development/dayz-one-life/one-life/apps/web/src/components/obituaries/obituary-article.tsx`
- Test (existing, must stay green unmodified): `/Users/steveharmeyer/Development/dayz-one-life/one-life/apps/web/src/components/obituaries/obituary-article.test.tsx`

**Interfaces:**
- Consumed: `ArticleBody({ blocks, fallback, className })` from `@/components/shared/article-body` (Task 19).
- Produced: no signature change — `ObituaryArticleView({ article, more, finalReload, now }): ReactNode` is untouched.

The existing test fixture has `body: "He left 212 kills behind."` and **no** `bodyBlocks`, and asserts `screen.getByText("He left 212 kills behind.")`. That assertion is the regression guard for this task: it must pass **without editing the test**.

- [ ] **Step 20.1: Confirm the current test is green before touching anything.**
  ```
  pnpm --filter @onelife/web test src/components/obituaries/obituary-article.test.tsx
  ```
  Expected: `Tests  2 passed (2)`.

- [ ] **Step 20.2: Add the import.**
  In `apps/web/src/components/obituaries/obituary-article.tsx`, find:
  ```tsx
  import { PullQuote } from "@/components/shared/pull-quote";
  ```
  and add directly beneath it:
  ```tsx
  import { ArticleBody } from "@/components/shared/article-body";
  ```

- [ ] **Step 20.3: Swap the body renderer.**
  Find this exact block (it sits between the `PullQuote` line and the `article.tags.length > 0` block):
  ```tsx
        <div className="mt-5 space-y-4 font-mono text-[14px] leading-relaxed text-ink-soft">
          {article.body.split(/\n{2,}/).map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
  ```
  Replace it with:
  ```tsx
        <ArticleBody blocks={article.bodyBlocks} fallback={article.body} className="mt-5" />
  ```
  Keep `mt-5` — the birth notice uses `mt-6` and the two margins must not be silently unified.

- [ ] **Step 20.4: Run the existing test unmodified — this is the proof of zero behaviour change.**
  ```
  pnpm --filter @onelife/web test src/components/obituaries/obituary-article.test.tsx
  ```
  Expected: `Tests  2 passed (2)`, with no edit to the test file. `git status` must show `obituary-article.test.tsx` as unmodified.

- [ ] **Step 20.5: Typecheck and commit.**
  ```
  pnpm --filter @onelife/web typecheck
  git add apps/web/src/components/obituaries/obituary-article.tsx
  git commit -m "refactor(web): render the obituary interior through ArticleBody"
  ```

---

### Task 21: Move the birth-notice interior onto `ArticleBody`

**Files:**
- Modify: `/Users/steveharmeyer/Development/dayz-one-life/one-life/apps/web/src/components/birth-notices/birth-notice-article.tsx`
- Test (existing, must stay green unmodified): `/Users/steveharmeyer/Development/dayz-one-life/one-life/apps/web/src/components/birth-notices/birth-notice-article.test.tsx`

**Interfaces:**
- Consumed: `ArticleBody({ blocks, fallback, className })` from `@/components/shared/article-body` (Task 19).
- Produced: no signature change — `BirthNoticeArticleView({ article, more, now }): ReactNode` is untouched.

The existing fixture has `body: "The tide does not care who it drops on the sand."`, no `bodyBlocks`, and asserts that exact string — the regression guard for this task.

- [ ] **Step 21.1: Confirm the current test is green before touching anything.**
  ```
  pnpm --filter @onelife/web test src/components/birth-notices/birth-notice-article.test.tsx
  ```
  Expected: `Tests  4 passed (4)`.

- [ ] **Step 21.2: Add the import.**
  In `apps/web/src/components/birth-notices/birth-notice-article.tsx`, find:
  ```tsx
  import { PullQuote } from "@/components/shared/pull-quote";
  ```
  and add directly beneath it:
  ```tsx
  import { ArticleBody } from "@/components/shared/article-body";
  ```

- [ ] **Step 21.3: Swap the body renderer.**
  Find this exact block (it sits directly after the closing `</div>` of the red/blue masthead block and before the `{article.pullQuote && ...}` line):
  ```tsx
        <div className="mt-6 space-y-4 font-mono text-[14px] leading-relaxed text-ink-soft">
          {article.body.split(/\n{2,}/).map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
  ```
  Replace it with:
  ```tsx
        <ArticleBody blocks={article.bodyBlocks} fallback={article.body} className="mt-6" />
  ```
  Note the margin here is `mt-6`, **not** the obituary's `mt-5`.

- [ ] **Step 21.4: Run the existing test unmodified.**
  ```
  pnpm --filter @onelife/web test src/components/birth-notices/birth-notice-article.test.tsx
  ```
  Expected: `Tests  4 passed (4)`, test file untouched per `git status`.

- [ ] **Step 21.5: Verify no flat-prose renderer survives anywhere.**
  ```
  grep -rn "split(/\\\\n" apps/web/src apps/api/src
  ```
  Expected: exactly one hit — `apps/web/src/components/shared/article-body.tsx`. Three renderers are now one. If either interior still appears, Step 20.3 or 21.3 was not applied.

- [ ] **Step 21.6: Full web suite, typecheck, commit.**
  ```
  pnpm --filter @onelife/web test
  pnpm --filter @onelife/web typecheck
  ```
  Expected: all files pass, zero diagnostics.
  ```
  git add apps/web/src/components/birth-notices/birth-notice-article.tsx
  git commit -m "refactor(web): render the birth-notice interior through ArticleBody"
  ```

---

### Task 22: Pin the "null blocks ⇒ zero behaviour change" guarantee at both interiors

**Files:**
- Modify (test): `/Users/steveharmeyer/Development/dayz-one-life/one-life/apps/web/src/components/obituaries/obituary-article.test.tsx`
- Modify (test): `/Users/steveharmeyer/Development/dayz-one-life/one-life/apps/web/src/components/birth-notices/birth-notice-article.test.tsx`

**Interfaces:**
- Consumed: `ObituaryArticleView({ article, more, finalReload, now })`, `BirthNoticeArticleView({ article, more, now })`, the module-scope `article` fixtures already present in each file.
- Produced: no source change — these are pure characterization tests. Tasks 20/21 proved the *existing* assertions still pass; this task pins the multi-paragraph split behaviour, which neither fixture currently exercises (both bodies are a single paragraph).

Add these **after** the source is already migrated, so they lock in the behaviour rather than drive it.

- [ ] **Step 22.1: Add the obituary characterization test.**
  In `apps/web/src/components/obituaries/obituary-article.test.tsx`, append inside the existing `describe("ObituaryArticleView", ...)` block, after the `"renders no hero image when imageUrl is absent"` test:
  ```tsx
    test("with no bodyBlocks, splits flat body on blank lines exactly as before ArticleBody", () => {
      const flat = { ...article, body: "Para one.\n\nPara two.\n\n\nPara three." };
      const { container } = render(<ObituaryArticleView article={flat} more={[]} finalReload={null} now={new Date("2026-07-12T00:00:00Z")} />);
      const bodyParas = Array.from(container.querySelectorAll("p")).filter((p) =>
        ["Para one.", "Para two.", "Para three."].includes(p.textContent ?? ""),
      );
      expect(bodyParas.map((p) => p.textContent)).toEqual(["Para one.", "Para two.", "Para three."]);
    });

    test("renders bodyBlocks instead of body when present", () => {
      const rich = {
        ...article,
        bodyBlocks: [
          { type: "para" as const, text: "Block prose." },
          { type: "subhead" as const, text: "The Reckoning" },
        ],
      };
      render(<ObituaryArticleView article={rich} more={[]} finalReload={null} now={new Date("2026-07-12T00:00:00Z")} />);
      expect(screen.getByText("Block prose.")).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 2, name: "The Reckoning" })).toBeInTheDocument();
      expect(screen.queryByText("He left 212 kills behind.")).toBeNull();
    });
  ```

- [ ] **Step 22.2: Add the birth-notice characterization test.**
  In `apps/web/src/components/birth-notices/birth-notice-article.test.tsx`, append inside the existing `describe("BirthNoticeArticleView", ...)` block:
  ```tsx
    test("with no bodyBlocks, splits flat body on blank lines exactly as before ArticleBody", () => {
      const flat = { ...article, body: "Para one.\n\nPara two.\n\n\nPara three." };
      const { container } = render(<BirthNoticeArticleView article={flat} more={[]} now={now} />);
      const bodyParas = Array.from(container.querySelectorAll("p")).filter((p) =>
        ["Para one.", "Para two.", "Para three."].includes(p.textContent ?? ""),
      );
      expect(bodyParas.map((p) => p.textContent)).toEqual(["Para one.", "Para two.", "Para three."]);
    });

    test("renders bodyBlocks instead of body when present", () => {
      const rich = {
        ...article,
        bodyBlocks: [{ type: "list" as const, items: ["A rag", "A can", "No plan"] }],
      };
      render(<BirthNoticeArticleView article={rich} more={[]} now={now} />);
      expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["A rag", "A can", "No plan"]);
      expect(screen.queryByText("The tide does not care who it drops on the sand.")).toBeNull();
    });
  ```

- [ ] **Step 22.3: Run both files.**
  ```
  pnpm --filter @onelife/web test src/components/obituaries/obituary-article.test.tsx src/components/birth-notices/birth-notice-article.test.tsx
  ```
  Expected: `Test Files  2 passed (2)`, `Tests  8 passed (8)` (2+2 new on top of 2 and 4).
  If a `queryByText(...)` null-assertion fails, the interior is rendering both `body` and `bodyBlocks` — re-check that Step 20.3/21.3 fully replaced the old `<div>` rather than adding `<ArticleBody>` alongside it.

- [ ] **Step 22.4: Full package green, then commit.**
  ```
  pnpm --filter @onelife/web test
  pnpm --filter @onelife/web typecheck
  git add apps/web/src/components/obituaries/obituary-article.test.tsx apps/web/src/components/birth-notices/birth-notice-article.test.tsx
  git commit -m "test(web): pin the null-blocks fallback guarantee at both article interiors"
  ```

> **Out-of-scope note for the Task 24 changelog author, do not fix here:** `ArticleHero` is wired into neither interior — neither `ObituaryArticle` nor `BirthNoticeArticle` carries `imageUrl`/`imageCaption` in `apps/web/src/lib/types.ts` and neither read-model selects `articles.imageUrl`, so the two `expect(document.querySelector("img")).toBeNull()` tests touched by Tasks 20–22 are tautologies that cannot fail. R5c's hero photos are generated and stored but never displayed. Raise it as a follow-up issue; expanding W4 to fix it would widen the PR's blast radius.

---

### Task 23: Serve `bodyBlocks` from the two article read-models

Without this task `article.bodyBlocks` is `undefined` at runtime forever: Task 18 added the DTO field and Tasks 19–22 consume it, but nothing between the `articles.body_blocks` column (Task 7/8) and the web DTO ever selects it. Six additive edits — an interface field, a `.select()` entry, and a cast in the return object, in each of two files — close the loop so the column is actually served the day a writer starts populating it.

**Files:**
- Modify: `/Users/steveharmeyer/Development/dayz-one-life/one-life/packages/read-models/src/obituary-articles.ts`
- Modify: `/Users/steveharmeyer/Development/dayz-one-life/one-life/packages/read-models/src/birth-notice-articles.ts`
- Test (modify): `/Users/steveharmeyer/Development/dayz-one-life/one-life/packages/read-models/test/obituary-articles.test.ts`
- Test (modify): `/Users/steveharmeyer/Development/dayz-one-life/one-life/packages/read-models/test/birth-notice-articles.test.ts`

**Interfaces:**
```ts
// produced — packages/read-models/src/obituary-articles.ts
export type ArticleBlock =
  | { type: "para"; text: string }
  | { type: "subhead"; text: string }
  | { type: "quote"; text: string; attribution: string }
  | { type: "list"; items: string[] };
export interface ObituaryArticle extends ObituaryCard { /* ... */ bodyBlocks: ArticleBlock[] | null }

// produced — packages/read-models/src/birth-notice-articles.ts
export interface BirthNoticeArticle extends BirthNoticeCard { /* ... */ bodyBlocks: ArticleBlock[] | null }
// consumed there: import type { ArticleBlock } from "./obituary-articles.js";
//   (declared once — `packages/read-models/src/index.ts` is a barrel of `export *`,
//    so re-exporting the same name from both files would collide.)

// consumed: articles.bodyBlocks from @onelife/db (Task 7) — typed `unknown` at the Drizzle
//   boundary, cast in the read-model exactly as `articles.facts` already is.
// Both interfaces declare the field REQUIRED-nullable (`bodyBlocks: ArticleBlock[] | null`);
//   the web DTO in apps/web/src/lib/types.ts stays OPTIONAL (`bodyBlocks?:`) per Task 18.
//   Only feed CARD_COLS are untouched — the field is interior-only, never on a card.
```

Anchor every edit on the quoted code below, not on line numbers.

- [ ] **Step 23.1: Write the failing read-model tests.**
  In `packages/read-models/test/obituary-articles.test.ts`, find this fragment inside the `beforeAll` seed for the `early-` row:
  ```ts
  pullQuoteText: "q1", pullQuoteAttribution: "a coast source",
  ```
  and replace it with:
  ```ts
  pullQuoteText: "q1", pullQuoteAttribution: "a coast source", bodyBlocks: [{ type: "para", text: "Block prose." }, { type: "subhead", text: "The Reckoning" }],
  ```
  Then append these two cases inside the existing `describe("getObituaryBySlug", ...)`:
  ```ts
    it("returns bodyBlocks when the row stores them", async () => {
      const a = await getObituaryBySlug(db, `early-${svc}`);
      expect(a!.bodyBlocks).toEqual([
        { type: "para", text: "Block prose." },
        { type: "subhead", text: "The Reckoning" },
      ]);
    });
    it("returns null bodyBlocks for a pre-R5d row", async () => {
      const a = await getObituaryBySlug(db, `late-${svc}`);
      expect(a!.bodyBlocks).toBeNull();
    });
  ```
  In `packages/read-models/test/birth-notice-articles.test.ts`, find this fragment inside the `fresh-` seed row:
  ```ts
  pullQuoteText: "again?", pullQuoteAttribution: "a weary coast",
  ```
  and replace it with:
  ```ts
  pullQuoteText: "again?", pullQuoteAttribution: "a weary coast", bodyBlocks: [{ type: "list", items: ["A rag", "A can", "No plan"] }],
  ```
  Then append these two cases inside the existing `describe("getBirthNoticeBySlug", ...)`:
  ```ts
    it("returns bodyBlocks when the row stores them", async () => {
      const a = await getBirthNoticeBySlug(db, `fresh-${svc}`);
      expect(a!.bodyBlocks).toEqual([{ type: "list", items: ["A rag", "A can", "No plan"] }]);
    });
    it("returns null bodyBlocks for a pre-R5d row", async () => {
      const a = await getBirthNoticeBySlug(db, `stale-${svc}`);
      expect(a!.bodyBlocks).toBeNull();
    });
  ```

- [ ] **Step 23.2: Run them, see them fail.**
  ```bash
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/read-models test test/obituary-articles.test.ts test/birth-notice-articles.test.ts
  ```
  Expected: four failures reading `expected undefined to deeply equal [ … ]` / `expected undefined to be null`. A TypeScript error on `bodyBlocks` in the seed instead means Task 7's schema column did not land — go back and fix that first.

- [ ] **Step 23.3: Declare `ArticleBlock` and add the field in `obituary-articles.ts`.**
  In `packages/read-models/src/obituary-articles.ts`, find:
  ```ts
  export const OBITUARIES_FEED_PAGE_SIZE = 20;
  ```
  and insert immediately **below** it:
  ```ts
  /**
   * R5d rich-body block union. `articles.body_blocks` is jsonb and NULL on every pre-R5d row, so
   * every consumer must handle null by rendering the flat `body`. Declared here and imported by
   * birth-notice-articles.ts — `index.ts` is a barrel of `export *`, so declaring it twice collides.
   */
  export type ArticleBlock =
    | { type: "para"; text: string }
    | { type: "subhead"; text: string }
    | { type: "quote"; text: string; attribution: string }
    | { type: "list"; items: string[] };
  ```
  Then find:
  ```ts
  export interface ObituaryArticle extends ObituaryCard {
    body: string;
  ```
  and replace those two lines with:
  ```ts
  export interface ObituaryArticle extends ObituaryCard {
    body: string;
    bodyBlocks: ArticleBlock[] | null;
  ```

- [ ] **Step 23.4: Select and return `bodyBlocks` in `getObituaryBySlug`.**
  Still in `packages/read-models/src/obituary-articles.ts`, find (inside `getObituaryBySlug`):
  ```ts
      .select({
        ...CARD_COLS,
        body: articles.body,
        pullQuoteText: articles.pullQuoteText,
        pullQuoteAttribution: articles.pullQuoteAttribution,
        facts: articles.facts,
      })
  ```
  Replace with:
  ```ts
      .select({
        ...CARD_COLS,
        body: articles.body,
        bodyBlocks: articles.bodyBlocks,
        pullQuoteText: articles.pullQuoteText,
        pullQuoteAttribution: articles.pullQuoteAttribution,
        facts: articles.facts,
      })
  ```
  Then in the same function's return object, find:
  ```ts
      body: r.body ?? "",
      pullQuote: r.pullQuoteText ? { text: r.pullQuoteText, attribution: r.pullQuoteAttribution ?? "" } : null,
      sessions: facts.sessions ?? 0,
  ```
  Replace with:
  ```ts
      body: r.body ?? "",
      bodyBlocks: (r.bodyBlocks as ArticleBlock[] | null) ?? null,
      pullQuote: r.pullQuoteText ? { text: r.pullQuoteText, attribution: r.pullQuoteAttribution ?? "" } : null,
      sessions: facts.sessions ?? 0,
  ```
  Do **not** add `bodyBlocks` to `CARD_COLS` — the feed cards render a lede, never a body, and widening the feed select would ship jsonb blobs on every card row.

- [ ] **Step 23.5: Mirror both edits in `birth-notice-articles.ts`.**
  In `packages/read-models/src/birth-notice-articles.ts`, find:
  ```ts
  import type { PlayerPriors } from "./player-priors.js";
  ```
  and add directly beneath it:
  ```ts
  import type { ArticleBlock } from "./obituary-articles.js";
  ```
  Find:
  ```ts
  export interface BirthNoticeArticle extends BirthNoticeCard {
    body: string;
  ```
  and replace those two lines with:
  ```ts
  export interface BirthNoticeArticle extends BirthNoticeCard {
    body: string;
    bodyBlocks: ArticleBlock[] | null;
  ```
  Find (inside `getBirthNoticeBySlug`):
  ```ts
      .select({
        ...CARD_COLS,
        body: articles.body,
        pullQuoteText: articles.pullQuoteText,
        pullQuoteAttribution: articles.pullQuoteAttribution,
        endedAt: articles.deathAt,
      })
  ```
  Replace with:
  ```ts
      .select({
        ...CARD_COLS,
        body: articles.body,
        bodyBlocks: articles.bodyBlocks,
        pullQuoteText: articles.pullQuoteText,
        pullQuoteAttribution: articles.pullQuoteAttribution,
        endedAt: articles.deathAt,
      })
  ```
  Then in that function's return object, find:
  ```ts
      body: r.body ?? "",
      pullQuote: r.pullQuoteText ? { text: r.pullQuoteText, attribution: r.pullQuoteAttribution ?? "" } : null,
      priors,
  ```
  Replace with:
  ```ts
      body: r.body ?? "",
      bodyBlocks: (r.bodyBlocks as ArticleBlock[] | null) ?? null,
      pullQuote: r.pullQuoteText ? { text: r.pullQuoteText, attribution: r.pullQuoteAttribution ?? "" } : null,
      priors,
  ```
  Do **not** re-export `ArticleBlock` from this file — `packages/read-models/src/index.ts` uses `export *`, and exporting the same type name from two modules is a duplicate-export error.

- [ ] **Step 23.6: Run the tests green.**
  ```bash
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/read-models test test/obituary-articles.test.ts test/birth-notice-articles.test.ts
  ```
  Expected: `Test Files  2 passed (2)`, all four new cases green alongside the pre-existing ones.

- [ ] **Step 23.7: Full read-models suite, workspace typecheck, commit.**
  ```bash
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test \
    pnpm --filter @onelife/read-models test
  pnpm turbo run typecheck
  ```
  Expected: both exit 0. A duplicate-export diagnostic on `ArticleBlock` means Step 23.5 re-exported it instead of importing it as a type.
  ```bash
  git add packages/read-models/src/obituary-articles.ts packages/read-models/src/birth-notice-articles.ts \
          packages/read-models/test/obituary-articles.test.ts packages/read-models/test/birth-notice-articles.test.ts
  git commit -m "feat(read-models): serve articles.body_blocks on both article interiors"
  ```

---

### Task 24: CHANGELOG.md — Unreleased entry for PR-B

**Files:**
- Modify: `/Users/steveharmeyer/Development/dayz-one-life/one-life/CHANGELOG.md`

**Interfaces:**
- Consumed: none (documentation only).
- Produced: `## [Unreleased]` section populated under the existing `### Added` / `### Changed` / `### Fixed` headings. The guard at `.claude/hooks/guard.py:130` blocks `gh pr create` unless `CHANGELOG.md` appears in the branch diff.

Conventions confirmed from the file: Keep a Changelog format; `## [Unreleased]` sits at line 7 with the six empty subheadings (`### Added`, `### Changed`, `### Deprecated`, `### Removed`, `### Fixed`, `### Security`) already present and in that order. Entries are `- ` bullets, sentence-case prose, wrapped at ~100 columns, frequently prefixed with the subsystem (`newsdesk:`, `Home page:`, `Migration \`0013\``). Do **not** add a version heading or a date — release drafting does that.

- [ ] **Step 24.1: Add the user-visible W1 entry under `### Fixed`.**
  Open `CHANGELOG.md`. Anchor on the `## [Unreleased]` block (lines ~7-14), not on line numbers. The block currently reads exactly:
  ```markdown
  ## [Unreleased]

  ### Added
  ### Changed
  ### Deprecated
  ### Removed
  ### Fixed
  ### Security
  ```
  Replace the `### Fixed` line with:
  ```markdown
  ### Fixed
  - newsdesk: a death whose cause names no mechanism (a bare `died`, `environment`, `environmental`,
    an empty token, or nothing at all) is now categorised `unknown` and tagged **Unknown**, not
    **Environment**. The prose already said the record names no cause while the tag asserted terrain
    or exposure — the paper contradicted itself on roughly 23% of deaths. A cause that names a real
    mechanism (`bled_out`, `starvation`, `fall`, `wolf`, `vehicle`, …) still categorises
    `environment`. Tags are frozen into `articles.tags` at publish time, so this is **forward-only**:
    already-published obituaries keep their stale **Environment** tag until backfilled.
  - newsdesk: the `RECOVERED EFFECTS` image category now also fires for an `unknown` cause (it
    previously gated on `environment || suicide` only), so the reclassified population does not
    silently lose a menu entry.
  ```

- [ ] **Step 24.2: Add the W2/W3/W4 internal entries under `### Added` and `### Changed`.**
  Replace the `### Added` line with:
  ```markdown
  ### Added
  - Migration `0014`: `articles.natural_key` (text, unique WHERE NOT NULL) and `articles.body_blocks`
    (jsonb) — the plumbing for the R5d news vertical, whose articles are keyed by a synthetic natural
    key rather than a (server, gamertag, life) tuple and whose body is structured blocks rather than
    flat text. Also adds the `articles_kind_status_created_idx (kind, status, created_at)` feed index.
    Both new columns are nullable; all 168 existing rows are untouched and render unchanged.
  ```
  Replace the `### Changed` line with:
  ```markdown
  ### Changed
  - Migration `0014` makes `articles_kind_server_gamertag_life_uniq` **partial**
    (`WHERE kind IN ('obituary','birth_notice')`), so a news article — which has no life tuple — is
    not forced through the life natural key. Every `onConflictDoUpdate` targeting that index now
    passes a matching `targetWhere`; without it Postgres raises "no unique or exclusion constraint
    matching the ON CONFLICT specification" and publishing fails.
  - Obituary and birth-notice interiors now render their body through one shared `ArticleBody`
    component, which takes an optional structured block list (`para` / `subhead` / `quote` / `list`)
    and falls back to the existing paragraph-split of `articles.body` when none is stored. An
    unrecognised block type is dropped rather than crashing the page. The two article read-models
    now serve `body_blocks` end to end, but **no article kind writes it yet** — every published
    obituary and birth notice still renders the flat fallback, byte-identically to before.
  - The `THE TRAIL ENDS HERE` image category now fires on every map for an unnamed cause (previously
    only on Sakhal for these deaths), a consequence of the `environment` → `unknown` reclassification.
  ```

- [ ] **Step 24.3: Verify the file still parses as the expected shape and commit.**
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life && sed -n '1,45p' CHANGELOG.md
  ```
  Expected: the header, then `## [Unreleased]` with the six subheadings in their original order — `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security` — with bullets under Added/Changed/Fixed and Deprecated/Removed/Security still bare, then `## [0.21.2] - 2026-07-18` unchanged.
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life && git add CHANGELOG.md && git commit -m "docs(changelog): R5d PR-B — unknown cause category, migration 0014, ArticleBody"
  ```

---

### Task 25: CLAUDE.md — document the 0014 schema, the partial-index/targetWhere coupling, ArticleBody, and the tag change

**Files:**
- Modify: `/Users/steveharmeyer/Development/dayz-one-life/one-life/CLAUDE.md`

**Interfaces:**
- Consumed: `articles.natural_key`, `articles.body_blocks`, `articles_kind_server_gamertag_life_uniq` (now partial), `articles_kind_status_created_idx`, `ArticleBody({ blocks, fallback, className })`, `causeCategory: "pvp" | "suicide" | "environment" | "unknown"`.
- Produced: prose only. The guard at `.claude/hooks/guard.py:132` blocks `gh pr create` unless `CLAUDE.md` appears in the branch diff — **PR-A's plan deferred this and hit the block. Do not defer it.**

- [ ] **Step 25.1: Extend the `packages:` `db` entry with the 0014 columns and the partial-index warning.**
  In the `## Monorepo` section, find the `- **packages:** \`db\` (schema + migrations, …` bullet. Anchor on this exact fragment near its end:
  ```
    `image_caption`/`image_model`/`image_attempts`/`image_error` columns on `articles` in migration
    `0012` for R5c article images — also never truncated on rebuild),
  ```
  Replace it with:
  ```
    `image_caption`/`image_model`/`image_attempts`/`image_error` columns on `articles` in migration
    `0012` for R5c article images — also never truncated on rebuild; gained `natural_key` (unique
    WHERE NOT NULL), `body_blocks` (jsonb), and the `articles_kind_status_created_idx` feed index in
    migration `0014`, which also made `articles_kind_server_gamertag_life_uniq` **partial**
    (`WHERE kind IN ('obituary','birth_notice')`) — **⚠️ any `onConflictDoUpdate` targeting that index
    MUST pass `targetWhere: inArray(articles.kind, ["obituary","birth_notice"])`, or Postgres raises
    "no unique or exclusion constraint matching the ON CONFLICT specification" and article publishing
    dies on the next tick**. There are four such sites today: publish + failure-stub in each of
    `apps/newsdesk/src/pg-store.ts` and `apps/newsdesk/src/birth-pg-store.ts`. A news article, which
    has no (server, gamertag, life) tuple, is deduped on `natural_key` instead),
  ```

- [ ] **Step 25.2: Add a PR-B paragraph to the Tabloid redesign entry.**
  Find, inside the Tabloid redesign bullet, the sentence that ends the roadmap line:
  ```
    images, with **R5d** (News feed + news-led home) next.
  ```
  Replace it with:
  ```
    images, with **R5d** (News feed + news-led home) in flight —
    spec `docs/superpowers/specs/2026-07-18-r5d-news-vertical-design.md`, shipping in three PRs.
    **PR-A shipped (v0.21.2): prose fixes.** **PR-B is the plumbing**, no new vertical yet:
    migration `0014` (`natural_key`, `body_blocks`, the `(kind, status, created_at)` feed index, and
    the life natural-key unique index narrowed to `kind IN ('obituary','birth_notice')` — see the
    `db` package entry for the `targetWhere` rule that narrowing imposes on every upsert), plus a
    shared **`ArticleBody`** (`apps/web/src/components/shared/article-body.tsx`). `ArticleBody` takes
    `blocks: ArticleBlock[] | null` — a union of `{type:"para"}` / `{type:"subhead"}` /
    `{type:"quote"}` / `{type:"list"}` — and a `fallback: string`; with `blocks === null` it renders
    the historical `body.split(/\n{2,}/)` paragraph path, so all 168 pre-0014 rows render
    byte-identically. Its switch ends in `default: return null`, so a block type added by a future
    vertical is dropped rather than crashing an interior. **Both shipped interiors (obituary + birth
    notice) render through it** — three renderers collapsed into one before a third kind exists; add
    new article kinds to `ArticleBody`, never a fourth inline `.split()`. `ArticleBlock` is declared
    twice on purpose — once in `packages/read-models/src/obituary-articles.ts` (imported by
    `birth-notice-articles.ts`; the barrel is `export *`, so one declaration only) and once in
    `apps/web/src/lib/types.ts` for the DTO. `getObituaryBySlug`/`getBirthNoticeBySlug` select and
    cast `articles.bodyBlocks` (interior only — never on feed `CARD_COLS`), but **no writer populates
    the column yet**, so every live interior still takes the flat fallback.
  ```

- [ ] **Step 25.3: Record the W1 tag change on the death-cause fidelity entry.**
  Find the end of the stage-2 paragraph:
  ```
    the host). Frozen `articles.facts` stay coarse (forward-only); lives,
    priors, and web surfaces update retroactively.
  ```
  Replace with:
  ```
    the host). Frozen `articles.facts` stay coarse (forward-only); lives,
    priors, and web surfaces update retroactively.
    **Unrecorded causes are `unknown`, never `environment` (R5d PR-B).** `buildObituaryFacts`
    (`apps/newsdesk/src/facts.ts`) derives `causeCategory` in the order killer/`pvp` → `suicide` →
    a cause that names a real mechanism → `unknown`. "Names a real mechanism" is the shared predicate
    `isUnrecordedCause` — which **lives in `facts.ts`** (it moved out of `prompt.ts`, which imports
    it; `facts.ts` must never import `prompt.ts`) and rejects `""`, `died`, `environment`,
    `environmental`, `unknown`. The invariant is `causeCategory === "unknown"` ⟺
    `causeUnrecorded(facts)` for a non-pvp death, so the public tag (**Unknown**) and the prose
    (which is forbidden by `NO_MECHANISM_DIRECTIVE` from naming terrain/exposure/weather) finally
    agree. A verdict from `classifyDeath` counts as a named mechanism and rescues the category to
    `environment`. Tags are frozen into `articles.tags` at publish, so this is **forward-only** —
    already-published bare-`died` obituaries keep their stale **Environment** tag until backfilled.
  ```

- [ ] **Step 25.4: Verify and commit.**
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life && grep -n "targetWhere\|ArticleBody\|isUnrecordedCause\|natural_key" CLAUDE.md
  ```
  Expected: at least four hits — the `db` package entry (`targetWhere`, `natural_key`), the Tabloid redesign entry (`ArticleBody`), and the death-cause entry (`isUnrecordedCause`).
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life && git add CLAUDE.md && git commit -m "docs(claude): R5d PR-B — 0014 schema, targetWhere rule, ArticleBody, unknown cause category"
  ```

---

### Task 26: Full-repo verification — newsdesk + read-models + web suites and a monorepo typecheck

**Files:**
- Test: `/Users/steveharmeyer/Development/dayz-one-life/one-life/apps/newsdesk/test/*.test.ts` (whole package, DB-backed)
- Test: `/Users/steveharmeyer/Development/dayz-one-life/one-life/apps/web/src/**/*.test.tsx` (whole package, jsdom)
- Test: `/Users/steveharmeyer/Development/dayz-one-life/one-life/packages/read-models/test/*.test.ts` (DB-backed; touched by the Task 23 `bodyBlocks` wiring)
- Modify: none — this task must be pure verification. If a suite fails, fix it in the owning workstream's task, then re-run this one from the top.

**Interfaces:**
- Consumed: `pnpm --filter <pkg> test`, `pnpm turbo run typecheck`.
- Produced: green output only. No code changes.

Env caveat, non-negotiable: DB suites need `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test`. **Turbo strips it under strict env mode**, so run DB-backed packages with `pnpm --filter`, or add `--env-mode=loose` if you must go through turbo. **Never append `-- run`** — every package's `test` script is already `vitest run`.

- [ ] **Step 26.1: Confirm Postgres is up and migrations (including 0014) are applied to the test DB.**
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life && docker compose up -d postgres && \
  psql postgres://onelife:onelife@localhost:5434/onelife_test -c "\d articles" | grep -E "natural_key|body_blocks|kind_server_gamertag_life_uniq|kind_status_created"
  ```
  Expected: four lines — a `natural_key | text` column, a `body_blocks | jsonb` column, the unique index printed with a trailing `WHERE (kind = ANY (ARRAY['obituary'::text, 'birth_notice'::text]))`, and `articles_kind_status_created_idx`. If `natural_key` is missing, the test DB has not had 0014 applied — run `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/db db:migrate` and re-check. If the unique index prints **without** a `WHERE` clause, migration 0014's index recreate did not run — stop and fix W2 (Tasks 8–10) before continuing; the W3 regression test will pass for the wrong reason.

- [ ] **Step 26.2: Run the newsdesk suite (W1 + W3).**
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life && \
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/newsdesk test
  ```
  Expected: **`Test Files  28 passed (28)`**, `Tests  N passed`, exit 0. (The package held 25 test files before this PR; it adds three — `cause-coherence.test.ts` from Task 4, `migration-0014.test.ts` from Task 6, and `partial-index-upsert.test.ts` from Task 12.) Specifically confirm in the output that `facts.test.ts`, `prompt.test.ts`, `image-categories.test.ts`, `pg-store.test.ts`, and `birth-pg-store.test.ts` all pass. A failure in `pg-store.test.ts` reading `there is no unique or exclusion constraint matching the ON CONFLICT specification` means a `targetWhere` is missing at one of the four sites — go back to Tasks 13–16.

- [ ] **Step 26.3: Run the read-models suite (the Task 23 `bodyBlocks` select/cast additions).**
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life && \
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/read-models test
  ```
  Expected: all files passed, exit 0. Pay attention to `obituary-articles` and `birth-notice-articles` — after Task 23 they select `articles.bodyBlocks` and must return the stored array for a seeded row and `null` for a pre-R5d row.

- [ ] **Step 26.4: Run the web suite (W4).**
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life && pnpm --filter @onelife/web test
  ```
  Expected: all files passed, exit 0. No `TEST_DATABASE_URL` needed — the web suite is jsdom-only. Confirm `src/components/shared/article-body.test.tsx`, `src/components/obituaries/obituary-article.test.tsx`, and `src/components/birth-notices/birth-notice-article.test.tsx` are all in the passing list. Note that the web DTO's `bodyBlocks` is **optional** by Task 18's deliberate decision, so no interior fixture can ever fail for omitting it — do not add `bodyBlocks: null` to any web fixture.

- [ ] **Step 26.5: Typecheck the whole monorepo.**
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life && pnpm turbo run typecheck
  ```
  Expected: every package `cache miss`/`cache hit` then a final `Tasks: N successful, N total` with exit 0 and no `error TS` lines. Typecheck needs no database, so strict env mode is fine here. Watch for `error TS2739`/`TS2741` on the **read-model** `ObituaryArticle`/`BirthNoticeArticle` — those interfaces declare `bodyBlocks` as required-nullable (Task 23), so any other construction site of them needs the field.

- [ ] **Step 26.6: Run the full test matrix once, as the deploy gate would.**
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life && \
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm turbo run test --concurrency=1 --env-mode=loose
  ```
  Expected: `Tasks: N successful, N total`, exit 0. `--env-mode=loose` is what lets `TEST_DATABASE_URL` reach the DB-backed packages; without it the DB suites fail at `getTestDb()` with a missing-connection-string error. `--concurrency=1` is mandatory — the DB suites share one Postgres and truncate `APP_TABLES` in `globalSetup`.

- [ ] **Step 26.7: Confirm the working tree is clean.**
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life && git status --short
  ```
  Expected: no output. If a test run wrote anything (a stray snapshot, `.DS_Store`), remove it rather than committing it — the repo convention is `git add -p`/explicit paths at the root, never `git add -A`.

---

### Task 27: Open the PR into `develop`

**Files:**
- Modify: none.

**Interfaces:**
- Consumed: `gh pr create --base develop`. The repo guard (`.claude/hooks/guard.py`) enforces: base must be `develop`, `CHANGELOG.md` must be in the branch diff (Task 24), and `CLAUDE.md` must be in the branch diff (Task 25). All three are already satisfied if Tasks 24–26 completed.

- [ ] **Step 27.1: Verify the guard's two preconditions are in the diff before invoking `gh`.**
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life && git diff --name-only develop...HEAD | grep -E "^(CHANGELOG|CLAUDE)\.md$"
  ```
  Expected both lines:
  ```
  CHANGELOG.md
  CLAUDE.md
  ```
  If either is missing, `gh pr create` will be blocked with `Blocked: update CHANGELOG.md (Unreleased) before opening a PR.` or `Blocked: updating CLAUDE.md is the last step before a PR. Update it first.` — go back to Task 24 or 25.

- [ ] **Step 27.2: Push the branch.**
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life && git push -u origin feature/r5d-prb-plumbing
  ```
  Expected: a `branch 'feature/r5d-prb-plumbing' set up to track 'origin/feature/r5d-prb-plumbing'` line. This is the **first** push of this branch — Task 11 forbade pushing before W3 landed.

- [ ] **Step 27.3: Open the PR.**
  ```bash
  cd /Users/steveharmeyer/Development/dayz-one-life/one-life && gh pr create --base develop --title "R5d PR-B — plumbing (migration 0014, targetWhere, ArticleBody) + unknown cause category" --body "$(cat <<'EOF'
## Summary
The R5d plumbing slice, plus one deploy-gating prose/tag fix escalated in from PR-A review.

- **W1 (deploy-gating, user-visible):** a cause naming no mechanism now categorises `unknown` and
  tags **Unknown** instead of **Environment**, ending a self-contradiction on ~23% of deaths
  (19 of 84 carry a bare `died`). `isUnrecordedCause` moved from `prompt.ts` to `facts.ts`.
  The `RECOVERED EFFECTS` image gate gained an `unknown` arm; `THE TRAIL ENDS HERE` now fires on
  every map for these deaths. Tags are frozen at publish, so the fix is forward-only.
- **W2:** migration `0014` — `natural_key` (unique WHERE NOT NULL), `body_blocks` (jsonb),
  `articles_kind_status_created_idx`, and the life natural-key unique index narrowed to
  `kind IN ('obituary','birth_notice')`. Hand-written (drizzle-kit does not emit the partial-index
  recreate correctly; precedent `0013`).
- **W3:** all four `onConflictDoUpdate` sites against that index gained a matching `targetWhere`.
  Without them, obituary publishing dies on the next tick. Guarded by a regression test that
  publishes an obituary and a birth notice twice each. A repo-wide audit found exactly four
  `articles` conflict sites and three unrelated upserts correctly left untouched.
- **W4:** one shared `ArticleBody` renderer replaces the duplicated `body.split(/\n{2,}/)` in both
  interiors, and both article read-models now select and serve `body_blocks`. `blocks === null`
  renders the historical path, so all 168 existing rows are unchanged. No writer populates
  `body_blocks` yet, so every live interior still takes the flat fallback. Unknown block types are
  dropped, not thrown.

## Deploy notes
- Migration `0014` runs in the normal deploy path. No projection rebuild needed — `articles` is
  durable and untouched by `rebuildAll`.
- **W1 must land before the next prod deploy** — the tag contradiction is live.
- Historical **Environment** tags on already-published bare-`died` obituaries are NOT backfilled
  (out of scope; a follow-up `UPDATE articles SET tags = ...` can retag them).
- Follow-up filed separately: `ArticleHero` is wired into neither interior (no `imageUrl` on either
  DTO), so R5c hero photos are generated and stored but never displayed.

## Test plan
- `pnpm --filter @onelife/newsdesk test` (with `TEST_DATABASE_URL`) — green, 28 files
- `pnpm --filter @onelife/read-models test` (with `TEST_DATABASE_URL`) — green
- `pnpm --filter @onelife/web test` — green
- `pnpm turbo run typecheck` — green
- `pnpm turbo run test --concurrency=1 --env-mode=loose` — green
EOF
)"
  ```
  Expected: a printed PR URL against `develop`. If the guard rejects the call, read its message — it names the exact missing precondition.
