# R5d PR-C1 — News engine (inert) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the entire targeting-and-image-prerequisite engine for the R5d news vertical — two pure trigger read-models (Standing Dead, The Long Form) and the four `ArticleKind`/menu/prompt prerequisites plus the `NEWSROOM_CATEGORIES` menu — with provably zero change to production output.

**Architecture:** Two new targeting modules in `apps/newsdesk/src` (`standing-dead-targets.ts`, `long-form-targets.ts`, with the pure clique builder split into `long-form-cluster.ts` and a two-line barrel `news-targets.ts`) compute rebuild-stable `natural_key`-identified publish targets from `lives`/`sessions`/`positions`/`hit_events`, anti-joined in TypeScript against `articles`. Alongside them, `image-categories.ts` and `image-scene.ts` gain a third `ArticleKind` member and the Newsroom menu, replacing two binary ternaries with guarded `Record` lookups. Nothing calls either half: `findImageTargets` excludes both shipped kinds and no `kind='news'` row exists, and the two targeting functions have no caller until PR-C2's `newsTick`.

**Tech Stack:** TypeScript ESM, Drizzle ORM over Postgres (postgres-js driver), Vitest, pnpm + turbo monorepo.

## Global Constraints

- Packages in scope: `@onelife/newsdesk` (the only package modified) and `@onelife/read-models` (consumed unmodified — `qualifiedLifeCondition` via the existing barrel export; already a `workspace:*` dependency of newsdesk).
- Test command: `pnpm --filter <pkg> test` — **NEVER** `pnpm --filter <pkg> test -- run`. Vitest is already `vitest run`; appending `-- run` breaks argument parsing.
- Typecheck command: `pnpm --filter @onelife/newsdesk typecheck` (script name is `typecheck`; `pnpm --filter @onelife/newsdesk run typecheck` is equivalent).
- DB suites need `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test` prefixed on the command.
- **Turbo's cache key omits `TEST_DATABASE_URL`, so any full sweep needs `--force` or it may report stale cached results.** A cached pass is not evidence.
- All relative imports carry the `.js` extension (`./long-form-cluster.js`), never `.ts` and never extensionless.
- Line numbers drift as tasks land — **anchor every edit on the quoted code**, never on a line number.
- `CHANGELOG.md` **and** `CLAUDE.md` must both be modified before `gh pr create`; the repo guard hook blocks the PR without a `CLAUDE.md` change.
- PR targets `develop`, from a `feature/*` branch on the fork.

---

## Task dependency note — the defining property of this PR

**C1 changes no production output whatsoever.**

Two independent facts guarantee it, and both are verified against the working tree, not assumed:

1. **Every image prerequisite is dead code until a news row exists.** `findImageTargets` filters
   `notInArray(articles.kind, ["obituary", "birth_notice"])`, and as of v0.22.0 no third kind is
   ever written. It therefore returns zero rows today, so `eligibleCategories`, `buildScenePrompt`,
   `NEWSROOM_CATEGORIES`, the widened `ArticleKind`, the `KIND_LABEL` guard, the news tone arm and
   the low-confidence hedge are all unreachable in production. Task 5 asserts this directly.
2. **Both trigger read-models are pure targeting functions with no caller.** `findStandingDeadTargets`
   and `findLongFormTargets` are imported by nothing outside their own test files until PR-C2's
   `newsTick` lands. They are additive files; `main.ts` is not touched by this PR.

**Any task in this plan that appears to alter existing behaviour is a bug in that task.** The two
behaviour changes that *look* like exceptions are both confined to unreachable code paths:
`eligibleCategories` now throws on an unknown kind instead of silently returning the Nursery menu,
and `buildScenePrompt` now throws on an unknown kind instead of labelling it a birth notice. Neither
can fire, because the only two kinds ever passed in production are `"obituary"` and `"birth_notice"`,
both of which have menu and label entries. If you find yourself editing `main.ts`, `image-tick.ts`,
`pg-store.ts`, `birth-pg-store.ts`, any API route, or anything under `apps/web`, stop — that is C2 or
C3 material and does not belong in this PR.

**Ordering:** Tasks 1–5 (image prerequisites) are independent of Tasks 6–14 (trigger read-models) and
come first because they are the smallest and unblock nothing else. Within each half the order is
strict. Tasks 15–17 close the PR.

---

## Task 1: Widen `ArticleKind` to three members and make `ImageTarget["kind"]` stop lying

**Files:**
- Modify: `apps/newsdesk/src/image-categories.ts`
- Modify: `apps/newsdesk/src/image-pg-store.ts`
- Test: `apps/newsdesk/test/image-categories.test.ts` (modify)

**Interfaces:**
- Produced: `export type ArticleKind = "obituary" | "birth_notice" | "news";`
- Modified: `interface ImageTarget { articleId: number; kind: ArticleKind; slug: string; gamertag: string; headline: string; lede: string | null; facts: Record<string, unknown>; }`
- Consumed unchanged: `findImageTargets(db: Database, opts: { limit: number; maxAttempts: number }): Promise<ImageTarget[]>`

- [ ] **Step 1.1 — Write the failing type-level assertion.** In `apps/newsdesk/test/image-categories.test.ts`, add after the existing imports:
  ```ts
  import type { ArticleKind } from "../src/image-categories.js";

  describe("ArticleKind", () => {
    it("admits news", () => {
      const kinds: ArticleKind[] = ["obituary", "birth_notice", "news"];
      expect(kinds).toHaveLength(3);
    });
  });
  ```
  Run `pnpm --filter @onelife/newsdesk typecheck` — expect `Type '"news"' is not assignable to type 'ArticleKind'`.

- [ ] **Step 1.2 — Widen the union.** In `apps/newsdesk/src/image-categories.ts`, anchor on the line `export type ArticleKind = "obituary" | "birth_notice";` and replace with:
  ```ts
  // Three members as of R5d. Widening this deliberately makes the MENUS / KIND_LABEL Records
  // below exhaustive-checked: a missing `news` arm is a compile error, not a silent fallthrough.
  export type ArticleKind = "obituary" | "birth_notice" | "news";
  ```

- [ ] **Step 1.3 — Retype `ImageTarget.kind`.** In `apps/newsdesk/src/image-pg-store.ts`, anchor on the import line `import type { RecentCover } from "./image-scene.js";` and add a sibling line directly beneath it:
  ```ts
  import type { ArticleKind } from "./image-categories.js";
  ```
  Then in the `ImageTarget` interface replace `kind: "obituary" | "birth_notice";` with:
  ```ts
  // Was its own inline literal union, which the `r.kind as ImageTarget["kind"]` cast below then
  // contradicted — findImageTargets selects rows whose kind is NOT in that union. ArticleKind
  // makes the cast honest and lets the value flow into eligibleCategories/buildScenePrompt.
  kind: ArticleKind;
  ```
  Leave `findImageTargets`' `notInArray(articles.kind, ["obituary", "birth_notice"])` filter and the `r.kind as ImageTarget["kind"]` cast exactly as they are — those two lines are what make this PR inert.

- [ ] **Step 1.4 — Verify.**
  ```
  pnpm --filter @onelife/newsdesk typecheck
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/newsdesk test
  ```
  Expect typecheck clean and every existing image suite green. The widening is additive; `eligibleCategories`' ternary still compiles because `"news"` falls to the `else` branch — Task 2 fixes that.

---

## Task 2: Replace `eligibleCategories`' binary ternary with a guarded keyed lookup **and** author the 13-entry `NEWSROOM_CATEGORIES` menu

These two changes are one task on purpose. Splitting them leaves a window in which
`NEWSROOM_CATEGORIES` exists but is `[]`, so `eligibleCategories("news", …)` returns an empty menu.
`image-tick.test.ts` already seeds `kind: "news"` rows and runs them through the real
`eligibleCategories`/`buildScenePrompt`, and only survives an empty menu because its completion
client is stubbed with a canned `sceneJson` — the tree would stay green by luck, not by design.
Land the menu and the lookup together and that window never exists.

**Files:**
- Modify: `apps/newsdesk/src/image-categories.ts`
- Test: `apps/newsdesk/test/image-categories.test.ts` (modify)

**Interfaces:**
- Produced: `export const NEWSROOM_CATEGORIES: ImageCategory[]` (13 entries)
- Produced: `const MENUS: Record<ArticleKind, ImageCategory[]>` (module-private)
- Unchanged signature: `eligibleCategories(kind: ArticleKind, facts: FactsSnapshot): ImageCategory[]` — behaviour changes only for a kind with no menu, which now throws instead of silently returning the Nursery menu.
- Consumed (the fact vocabulary these gates read off `FactsSnapshot`, which `newsTick` MUST freeze into `articles.facts` — this is the contract with C2's facts builders):
  `trigger: "standing_dead" | "long_form"`, `map: string`, `idleHours: number`, `timeAliveSeconds: number`, `hitsAbsorbed: number`, `lifeNumber: number`, `priors: { livesLived?: number; totalKills?: number }`, `subjectCount: number`, `allFreshSubjects: boolean`, `lastExpressiveEmote: string | null`.
- Reuses the existing module-scope helpers `s`, `n`, `priors` in `image-categories.ts` — do **not** re-declare them.

- [ ] **Step 2.1 — Write the failing kind-routing tests.** Append to `apps/newsdesk/test/image-categories.test.ts`:
  ```ts
  describe("eligibleCategories — kind routing", () => {
    it("never hands a non-obituary kind the nursery menu by default", () => {
      const newsSlugs = eligibleCategories("news", {}).map((c) => c.slug);
      const nurserySlugs = NURSERY_CATEGORIES.map((c) => c.slug);
      expect(newsSlugs.some((s) => nurserySlugs.includes(s))).toBe(false);
    });

    it("throws on a kind with no menu rather than filtering undefined", () => {
      expect(() => eligibleCategories("bogus" as ArticleKind, {})).toThrow(/no image category menu/);
    });
  });
  ```

- [ ] **Step 2.2 — Write the failing menu tests.** Extend the value import at the top of `apps/newsdesk/test/image-categories.test.ts` to
  `import { MORGUE_CATEGORIES, NURSERY_CATEGORIES, NEWSROOM_CATEGORIES, eligibleCategories } from "../src/image-categories.js";`
  and append:
  ```ts
  describe("newsroom menu", () => {
    const standing = { trigger: "standing_dead", map: "chernarusplus", idleHours: 96,
      timeAliveSeconds: 5400, hitsAbsorbed: 12, lifeNumber: 3, priors: { livesLived: 2, totalKills: 4 },
      subjectCount: 1, allFreshSubjects: false, lastExpressiveEmote: null };
    const longform = { trigger: "long_form", map: "sakhal", idleHours: 0, timeAliveSeconds: 0,
      hitsAbsorbed: 0, lifeNumber: 1, priors: { livesLived: 0, totalKills: 0 },
      subjectCount: 2, allFreshSubjects: true, lastExpressiveEmote: null };
    const newsSlugs = (f: Record<string, unknown>) => eligibleCategories("news", f).map((c) => c.slug);

    it("carries 13 entries with unique kebab slugs and CAPS captions <= 48 chars", () => {
      expect(NEWSROOM_CATEGORIES).toHaveLength(13);
      const all = [...MORGUE_CATEGORIES, ...NURSERY_CATEGORIES, ...NEWSROOM_CATEGORIES];
      expect(new Set(all.map((c) => c.slug)).size).toBe(all.length);
      for (const c of NEWSROOM_CATEGORIES) {
        expect(c.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(c.caption).toBe(c.caption.toUpperCase());
        expect(c.caption.length).toBeLessThanOrEqual(48);
        expect(c.example.length).toBeGreaterThan(20);
      }
    });

    it("never returns an empty eligible set", () => {
      expect(eligibleCategories("news", {}).length).toBeGreaterThan(0);
      expect(newsSlugs(standing).length).toBeGreaterThan(0);
      expect(newsSlugs(longform).length).toBeGreaterThan(0);
    });

    it("keeps standing-dead and long-form framings apart", () => {
      expect(newsSlugs(standing)).toContain("unattended-camp");
      expect(newsSlugs(standing)).not.toContain("two-sets-of-tracks");
      expect(newsSlugs(longform)).toContain("two-sets-of-tracks");
      expect(newsSlugs(longform)).not.toContain("unattended-camp");
    });

    it("gates the veteran and endurance framings on earned facts", () => {
      expect(newsSlugs({ ...standing, priors: { livesLived: 0, totalKills: 0 } })).not.toContain("the-regular");
      expect(newsSlugs(standing)).toContain("the-regular");
      expect(newsSlugs({ ...standing, hitsAbsorbed: 3 })).not.toContain("what-it-took");
      expect(newsSlugs({ ...standing, hitsAbsorbed: 100 })).toContain("what-it-took");
    });

    it("shares no framing with the morgue or nursery menus", () => {
      const others = new Set([...MORGUE_CATEGORIES, ...NURSERY_CATEGORIES].map((c) => c.caption));
      for (const c of NEWSROOM_CATEGORIES) expect(others.has(c.caption)).toBe(false);
    });
  });
  ```
  Run `pnpm --filter @onelife/newsdesk test image-categories` — every new assertion fails (no `NEWSROOM_CATEGORIES` export; the routing test currently gets Nursery slugs; the guard test throws `TypeError: Cannot read properties of undefined (reading 'filter')` rather than the expected message).

- [ ] **Step 2.3 — Add the fact-vocabulary comment and the menu.** In `apps/newsdesk/src/image-categories.ts`, immediately above the final `export function eligibleCategories`, insert:
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
  //
  // FOG RULE, STRICTER HERE (spec §4.1.4): a Standing Dead subject is ALIVE and non-consenting.
  // No framing may imply a death, a position fix, a route, or a recognisable locale. Favour
  // absence and vacancy — the story is that nobody came back, not that somebody died.
  export const NEWSROOM_CATEGORIES: ImageCategory[] = [
    { slug: "unattended-camp", caption: "NOBODY CAME BACK FOR THIS",
      example: "A small abandoned camp in wet pine woods at dusk: a collapsed tarp shelter, a cold fire ring gone to grey ash, an enamel mug still upright on a flat stone, nothing living anywhere in frame.",
      // Standing Dead only: vacancy is the whole story. Never offered to Long Form, where a
      // deserted camp would read as the aftermath of a death that happened somewhere else.
      eligible: (f) => f.trigger === "standing_dead" },
    { slug: "unslept-bedroll", caption: "THE BED WAS NEVER SLEPT IN",
      example: "A rolled sleeping bag lying flat and unopened on bare floorboards in a derelict wooden room, one boot tipped over beside it, grey light through a broken window and drifted dust across everything.",
      eligible: (f) => f.trigger === "standing_dead" },
    { slug: "no-forwarding-address", caption: "NO FORWARDING ADDRESS",
      example: "An empty dirt crossroads in flat farmland under low grey cloud, a leaning wooden signpost with both arms snapped off, tyre ruts filling with rain and no traffic in either direction.",
      // Deliberately signless and directionless: an intact sign would name a place and break the
      // Fog Rule for a subject who is alive and locatable.
      eligible: () => true },
    { slug: "the-regular", caption: "A KNOWN FACE, RECENTLY ABSENT",
      example: "A worn canvas jacket hanging alone on a nail in an empty wooden hallway, shoulders shaped by long use, a shut door beyond it and no one in frame.",
      // Priors gate: this framing asserts a history. A first-lifer has none, and the Standing Dead
      // predicate already refuses to cover one without earned coverage.
      eligible: (f) => (priors(f).livesLived ?? 0) >= 1 },
    { slug: "what-it-took", caption: "WHAT IT TOOK TO GET THIS FAR",
      example: "A stack of spent bandages, a bloodied rag and three empty saline bottles heaped on a scuffed table under a bare bulb, flash glaring off the wet glass.",
      // Endurance gate mirrors the earned-coverage clause (hitsAbsorbed >= 100). Objects only —
      // no wound, no body, and nothing that implies the subject stopped surviving.
      eligible: (f) => (n(f.hitsAbsorbed) ?? 0) >= 100 },
    { slug: "last-transmission", caption: "LAST RECORDED TRANSMISSION",
      example: "A battered handheld radio lying face-up in wet grass beside a fallen birch, its dial glowing faintly, nobody holding it and nothing but drizzle in the background.",
      eligible: () => true },
    { slug: "still-listed", caption: "STILL LISTED AS ACTIVE",
      example: "A rain-warped paper pinned to a rotting noticeboard, its writing washed to illegible grey smears, one dog-eared corner lifting in the wind under an overcast sky.",
      // Illegible by construction: no legible text is a hard rail, and this framing is the one
      // most likely to tempt the model into writing a name.
      eligible: () => true },
    { slug: "long-idle", caption: "SOME TIME HAS PASSED",
      example: "A rusted metal gate standing half open across a muddy farm track, grass grown thick and undisturbed through the gap where it has not swung in weeks, thin fog in the treeline behind.",
      // Idle framing only fires once the absence is genuinely long, so the photo can't out-claim
      // the copy. 72h is the trigger floor; this wants visibly more.
      eligible: (f) => (n(f.idleHours) ?? 0) >= 120 },
    { slug: "two-sets-of-tracks", caption: "TWO SETS OF TRACKS, ONE DIRECTION",
      example: "Two lines of bootprints pressed into wet mud along a forest verge, converging and then ending at a churned patch of grass, no figures anywhere and rain filling the deeper prints.",
      // Long Form only: a convergence framing. Applied to a lone Standing Dead subject it would
      // invent a companion who does not exist.
      eligible: (f) => f.trigger === "long_form" },
    { slug: "same-minute", caption: "WITHIN THE SAME MINUTE",
      example: "Two dropped backpacks lying a few metres apart in long wet grass at the edge of a clearing, both still open, rain beading on the canvas, nothing else in the frame.",
      // Objects at a distance from each other carry the coincidence without a corpse or a fix.
      eligible: (f) => f.trigger === "long_form" && (n(f.subjectCount) ?? 0) >= 2 },
    { slug: "the-world-did-this", caption: "THE WORLD DID THIS, NOT THEM",
      example: "A wide flat view of an empty rain-soaked field under a heavy pressing sky, a single leafless tree off-centre and a treeline dissolving into fog at the far edge.",
      // The fresh-subject tone branch: when every subject is a first-lifer the story is the world,
      // never the two men's competence. Punch up, never down.
      eligible: (f) => f.trigger === "long_form" && f.allFreshSubjects === true },
    { slug: "conditions-noted", caption: "CONDITIONS WERE NOTED",
      example: "Driving snow across a bare white slope at dusk, the flash lighting every falling flake into a wall of bright dots, a line of fence posts vanishing into the whiteout.",
      // Weather framing is honest for Sakhal and nowhere else — this is the one map cue the Fog
      // Rule permits, because the map is already in the dateline.
      eligible: (f) => f.map === "sakhal" },
    { slug: "the-desk-has-questions", caption: "THE DESK HAS QUESTIONS",
      example: "A cluttered corner of a derelict room lit hard by flash: an overturned wooden chair, a tin cup on its side, a single muddy bootprint on bare boards, and no one to explain any of it.",
      eligible: () => true },
  ];
  ```

- [ ] **Step 2.4 — Replace the function with the guarded keyed lookup.** Still in `apps/newsdesk/src/image-categories.ts`, anchor on the existing final function:
  ```ts
  export function eligibleCategories(kind: ArticleKind, facts: FactsSnapshot): ImageCategory[] {
    const menu = kind === "obituary" ? MORGUE_CATEGORIES : NURSERY_CATEGORIES;
    return menu.filter((c) => c.eligible(facts));
  }
  ```
  and replace it wholesale with:
  ```ts
  // Keyed lookup, not a ternary: the old `kind === "obituary" ? MORGUE : NURSERY` handed every
  // non-obituary kind the Nursery menu, so news photos would all be fresh-spawn framings.
  const MENUS: Record<ArticleKind, ImageCategory[]> = {
    obituary: MORGUE_CATEGORIES,
    birth_notice: NURSERY_CATEGORIES,
    news: NEWSROOM_CATEGORIES,
  };

  export function eligibleCategories(kind: ArticleKind, facts: FactsSnapshot): ImageCategory[] {
    // A Record lookup does NOT throw on a miss — TS types this as ImageCategory[] while the
    // runtime yields undefined for any key outside the union, and image-pg-store.ts casts a raw
    // db `text` column into ArticleKind unchecked. Without this guard, `.filter` on undefined is
    // an opaque TypeError inside imageTick's try/catch that burns an image_attempts retry.
    // Precedent: buildImagePrompt's `if (!ratio) throw new Error(\`unknown image kind: ${kind}\`)`.
    const menu = MENUS[kind];
    if (!menu) throw new Error(`no image category menu for article kind: ${kind}`);
    return menu.filter((c) => c.eligible(facts));
  }
  ```

- [ ] **Step 2.5 — Verify.**
  ```
  pnpm --filter @onelife/newsdesk typecheck
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/newsdesk test
  ```
  All seven new assertions green. The pre-existing "16 morgue and 13 nursery categories" test still passes — it builds its `all` array from only those two menus and is unaffected by a third. Confirm by inspection that `eligibleCategories("news", {})` returns exactly the **four** `eligible: () => true` entries — `no-forwarding-address`, `last-transmission`, `still-listed`, `the-desk-has-questions` — and nothing gated, i.e. non-empty, satisfying the never-empty house rule.

---

## Task 3: Fix `buildScenePrompt`'s non-obituary label and add the news tone + low-confidence hedge to `IMAGE_SCENE_SYSTEM`

**Files:**
- Modify: `apps/newsdesk/src/image-scene.ts`
- Test: `apps/newsdesk/test/image-scene.test.ts` (modify)

**Interfaces:**
- Produced: `const KIND_LABEL: Record<ArticleKind, string>` (module-private)
- Unchanged signature: `buildScenePrompt(args: { kind: ArticleKind; facts: Record<string, unknown>; headline: string; lede: string | null; eligible: ImageCategory[]; recent: RecentCover[] }): { system: string; user: string }`
- Unchanged: `IMAGE_SCENE_SYSTEM: string` (content grows), `parseScene(raw: string): SceneChoice` (untouched — the 3–48 caption / 20–600 scene caps and the salvage fallback stay exactly as they are).

- [ ] **Step 3.1 — Write the failing tests.** First extend the existing source import in `apps/newsdesk/test/image-scene.test.ts` — anchor on `import { buildScenePrompt, parseScene } from "../src/image-scene.js";` and replace it with:
  ```ts
  import { buildScenePrompt, parseScene, IMAGE_SCENE_SYSTEM } from "../src/image-scene.js";
  ```
  Then append to the same file:
  ```ts
  import type { ArticleKind } from "../src/image-categories.js";

  const args = (over: Partial<Parameters<typeof buildScenePrompt>[0]> = {}) => ({
    kind: "news" as ArticleKind, facts: {}, headline: "H", lede: null,
    eligible: [], recent: [], ...over,
  });

  describe("buildScenePrompt — kind label", () => {
    it("labels news as a news feature, not a birth notice", () => {
      const { user } = buildScenePrompt(args());
      expect(user).toContain("Article kind: news feature (The Newsroom)");
      expect(user).not.toContain("The Nursery");
    });

    it("throws on an unknown kind", () => {
      expect(() => buildScenePrompt(args({ kind: "bogus" as ArticleKind })))
        .toThrow(/unknown article kind for scene prompt/);
    });

    it("flags a low-confidence verdict explicitly instead of burying it in the facts JSON", () => {
      const { user } = buildScenePrompt(args({ facts: { verdict: { cause: "bled_out", confidence: "low" } } }));
      expect(user).toContain("The stated cause is LOW CONFIDENCE");
      expect(buildScenePrompt(args({ facts: { verdict: { cause: "pvp", confidence: "high" } } })).user)
        .not.toContain("LOW CONFIDENCE");
    });
  });

  describe("IMAGE_SCENE_SYSTEM", () => {
    it("carries a news tone arm and the alive-subject rail", () => {
      expect(IMAGE_SCENE_SYSTEM).toContain("news features =");
      expect(IMAGE_SCENE_SYSTEM).toContain("A news subject may still be ALIVE");
      expect(IMAGE_SCENE_SYSTEM).toContain("low confidence");
    });
  });
  ```
  Run `pnpm --filter @onelife/newsdesk test image-scene` — all four fail.

- [ ] **Step 3.2 — Replace the label ternary.** In `apps/newsdesk/src/image-scene.ts`, insert directly above `export function buildScenePrompt(args: {`:
  ```ts
  // Keyed lookup, not a ternary: the old `kind === "obituary" ? … : "birth notice (The Nursery)"`
  // labelled EVERY non-obituary kind a birth notice. Same non-throwing-Record caveat as
  // eligibleCategories — the explicit guard is required, not decorative.
  const KIND_LABEL: Record<ArticleKind, string> = {
    obituary: "obituary (The Morgue)",
    birth_notice: "birth notice (The Nursery)",
    news: "news feature (The Newsroom)",
  };
  ```
  Then anchor on the line
  ```ts
    lines.push(`Article kind: ${args.kind === "obituary" ? "obituary (The Morgue)" : "birth notice (The Nursery)"}`);
  ```
  and replace it with:
  ```ts
    const label = KIND_LABEL[args.kind];
    if (!label) throw new Error(`unknown article kind for scene prompt: ${args.kind}`);
    lines.push(`Article kind: ${label}`);
  ```

- [ ] **Step 3.3 — Add the explicit low-confidence line.** Anchor on `lines.push(\`Facts: ${JSON.stringify(args.facts)}\`);` and insert immediately after it:
  ```ts
    // The facts blob passes wholesale, so a hedged verdict arrives as undifferentiated JSON and
    // the caption ends up asserting a mechanism the body hedges. Surface it as its own line.
    if ((args.facts.verdict as { confidence?: string } | null | undefined)?.confidence === "low") {
      lines.push("The stated cause is LOW CONFIDENCE — choose a framing that does not assert that mechanism.");
    }
  ```

- [ ] **Step 3.4 — Add the news tone arm and the alive-subject rail.** Inside the `IMAGE_SCENE_SYSTEM` array literal, anchor on the two-line tone entry:
  ```ts
    "- Tone: obituaries = deadpan mock-gravity; birth notices = doomed optimism. Punch up, never",
    "  down. Rib first-lifers affectionately, never cruelly.",
  ```
  and replace it with:
  ```ts
    "- Tone: obituaries = deadpan mock-gravity; birth notices = doomed optimism; news features =",
    "  wire-service investigative restraint — the story is an absence or a convergence, never a",
    "  person to laugh at. Punch up, never down. Rib first-lifers affectionately, never cruelly.",
    "- A news subject may still be ALIVE. Never depict them identifiably, never imply their death,",
    "  and never show a locale that could be recognised, placed, or navigated to — no landmark, no",
    "  region, no route, no fix.",
    "- If a stated cause is marked low confidence, choose a framing that does not assert that",
    "  mechanism. Absence and aftermath assert nothing; a suspect or a weapon asserts everything.",
  ```

- [ ] **Step 3.5 — Verify.**
  ```
  pnpm --filter @onelife/newsdesk typecheck
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/newsdesk test
  ```
  All four new tests green; the existing `image-scene.test.ts` obituary/birth assertions still pass (that file asserts nothing about the tone line or the kind label).

---

## Task 4: Prove the news path end-to-end through `buildScenePrompt` with a realistic Standing Dead facts blob

**Files:**
- Test: `apps/newsdesk/test/image-scene.test.ts` (modify)

**Interfaces:**
- Consumed: `eligibleCategories(kind: ArticleKind, facts: FactsSnapshot): ImageCategory[]`, `buildScenePrompt(args): { system: string; user: string }`, `NEWSROOM_CATEGORIES`.
- Produces no source change — this is the integration guard that Tasks 1–3 compose correctly.

- [ ] **Step 4.1 — Write the composition test.** First extend the existing categories import in `apps/newsdesk/test/image-scene.test.ts` — anchor on `import { MORGUE_CATEGORIES } from "../src/image-categories.js";` and replace it with:
  ```ts
  import { MORGUE_CATEGORIES, eligibleCategories } from "../src/image-categories.js";
  ```
  Then append to the same file:
  ```ts
  describe("news scene prompt — composed path", () => {
    const facts = { trigger: "standing_dead", map: "chernarusplus", idleHours: 140,
      timeAliveSeconds: 9200, hitsAbsorbed: 140, lifeNumber: 4,
      priors: { livesLived: 3, totalKills: 6 }, subjectCount: 1, allFreshSubjects: false,
      lastExpressiveEmote: "EmoteGreeting" };

    it("offers only newsroom framings and never a nursery or morgue one", () => {
      const eligible = eligibleCategories("news", facts);
      const { user } = buildScenePrompt({ kind: "news", facts, headline: "Nobody Has Seen Him Since Tuesday",
        lede: "He logged off and the server kept going without him.", eligible, recent: [] });
      expect(user).toContain("news feature (The Newsroom)");
      for (const c of eligible) expect(user).toContain(c.caption);
      expect(user).not.toContain("PICTURED: OPTIMISM");
      expect(user).not.toContain("SCENE OF THE INCIDENT");
    });

    it("offers the long-idle, veteran and endurance framings on these facts", () => {
      const slugs = eligibleCategories("news", facts).map((c) => c.slug);
      expect(slugs).toEqual(expect.arrayContaining(["unattended-camp", "long-idle", "the-regular", "what-it-took"]));
      expect(slugs).not.toContain("two-sets-of-tracks");
    });

    it("leaks no coordinate-shaped number from a facts blob into the prompt", () => {
      const { user } = buildScenePrompt({ kind: "news", facts, headline: "H", lede: null,
        eligible: eligibleCategories("news", facts), recent: [] });
      expect(user).not.toMatch(/\d{4}\.\d/);
    });
  });
  ```

- [ ] **Step 4.2 — Verify.**
  ```
  pnpm --filter @onelife/newsdesk typecheck
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/newsdesk test
  ```
  Expect all green with **no source edits**. If the coordinate assertion fails, the fault is in the facts-builder contract, not here — the fix is to keep `x`/`y` out of `NewsFacts` (spec §11), which the type split in Tasks 6–9 already enforces on the targeting side.

---

## Task 5: Confirm the prerequisites are inert in production

**Files:**
- Test: `apps/newsdesk/test/image-pg-store.test.ts` (modify)

**Interfaces:**
- Consumed: `findImageTargets(db: Database, opts: { limit: number; maxAttempts: number }): Promise<ImageTarget[]>`, and the file's existing `seedArticle(over)` fixture helper.
- Produces no source change. This task exists because the whole PR's safety claim — "C1 cannot change a single byte of production output" — rests on `findImageTargets` returning zero rows while no `kind='news'` article exists.

- [ ] **Step 5.1 — Add the inertness assertion.** In `apps/newsdesk/test/image-pg-store.test.ts`, append to the existing `describe("findImageTargets", …)` block. Use the file's existing module-scope `seedArticle` helper and `hrs` — do not build a new fixture:
  ```ts
  it("is inert while only the two shipped kinds exist — no news row means no image target", async () => {
    // The safety claim of PR-C1 in one assertion. Both rows are published, un-imaged and have
    // zero attempts, so they are eligible on every dimension EXCEPT kind.
    const obit = await seedArticle({ kind: "obituary", imageUrl: null, imageAttempts: 0, createdAt: hrs(301) });
    const birth = await seedArticle({ kind: "birth_notice", imageUrl: null, imageAttempts: 0, createdAt: hrs(302) });

    const targets = await findImageTargets(db, { limit: 500, maxAttempts: 3 });
    const mine = targets.filter((t) => [obit.id, birth.id].includes(t.articleId));
    expect(mine).toEqual([]);
  });
  ```

- [ ] **Step 5.2 — Add the retracted-row assertion.** Immediately after it, in the same block:
  ```ts
  it("excludes a retracted row even though its kind is image-eligible", async () => {
    // `articles.status` is free-text; C2's retraction sweep will write 'retracted'. findImageTargets
    // filters eq(status,'published'), so a de-published article can never acquire a photo. Pinning
    // it here means C2 inherits the guarantee rather than having to re-derive it.
    const retracted = await seedArticle({ kind: "news", status: "retracted", createdAt: hrs(303) });
    const targets = await findImageTargets(db, { limit: 500, maxAttempts: 3 });
    expect(targets.map((t) => t.articleId)).not.toContain(retracted.id);
  });
  ```

- [ ] **Step 5.3 — Run the DB suite.**
  ```
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/newsdesk test
  ```
  Expect green. (Never `-- run`.)

- [ ] **Step 5.4 — Package sweep with the cache defeated.**
  ```
  TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm turbo run test --filter=@onelife/newsdesk --force --concurrency=1
  pnpm turbo run typecheck --concurrency=1
  ```
  Expect both clean. At this point `NEWSROOM_CATEGORIES` exists, `eligibleCategories`/`buildScenePrompt` route `news` correctly, `ArticleKind` is three members — and nothing in production reaches any of it.

---

## Task 6: Long Form pure clustering — types + `buildLongFormClusters` (clique, no chaining)

**Files:**
- Create: `apps/newsdesk/src/long-form-cluster.ts`
- Test: `apps/newsdesk/test/long-form-cluster.test.ts`

**Interfaces produced:**
```ts
/** INTERNAL to the Long Form slice — carries coordinates. Never returned from long-form-targets.ts. */
export interface DeathCandidate {
  lifeId: number; serverId: number; gamertag: string;
  map: string; mapSlug: string | null; lifeNumber: number;
  lifeStartedAt: Date; endedAt: Date; deathCause: string | null;
  x: number; y: number; fixAt: Date;
}
export interface LongFormSubject {
  lifeId: number; serverId: number; gamertag: string;
  map: string; mapSlug: string | null; lifeNumber: number;
  lifeStartedAt: Date; endedAt: Date; deathCause: string | null;
}
export interface LongFormCluster {
  serverId: number; map: string; mapSlug: string | null;
  earliestDeathAt: Date; primary: LongFormSubject;
  subjects: LongFormSubject[];   // includes primary; sorted by gamertag asc
  naturalKey: string;
}
export function buildLongFormClusters(
  candidates: DeathCandidate[],
  opts: { windowSeconds: number; radiusMeters: number },
): LongFormCluster[];
export function longFormNaturalKey(serverId: number, earliestDeathAt: Date, gamertags: string[]): string;
```
This task is pure — no DB, no `TEST_DATABASE_URL`.

- [ ] **Step 6.1: Write the failing test file.** Create `apps/newsdesk/test/long-form-cluster.test.ts`. Add a fixture factory at module scope so every case is one line:

```ts
import { describe, it, expect } from "vitest";
import { buildLongFormClusters, longFormNaturalKey, type DeathCandidate } from "../src/long-form-cluster.js";

const T0 = new Date("2026-07-11T12:00:00.000Z");
const at = (s: number) => new Date(T0.getTime() + s * 1000);
let seq = 0;
const cand = (o: Partial<DeathCandidate> & { gamertag: string; endedAt: Date; x: number; y: number }): DeathCandidate => ({
  lifeId: ++seq, serverId: 1, map: "chernarusplus", mapSlug: "chernarus",
  lifeNumber: 1, lifeStartedAt: T0, deathCause: "pvp", fixAt: o.endedAt, ...o,
});

const OPTS = { windowSeconds: 180, radiusMeters: 100 };

describe("buildLongFormClusters", () => {
  it("pairs two deaths inside both thresholds", () => {
    const rows = [
      cand({ gamertag: "Bee", endedAt: at(0), x: 7423.51, y: 9210.88 }),
      cand({ gamertag: "Ay", endedAt: at(27), x: 7443.51, y: 9245.88 }),
    ];
    const [c] = buildLongFormClusters(rows, OPTS);
    expect(c!.subjects.map((s) => s.gamertag)).toEqual(["Ay", "Bee"]); // gamertag asc
    expect(c!.primary.gamertag).toBe("Bee");                          // earliest endedAt
    expect(c!.earliestDeathAt.toISOString()).toBe(at(0).toISOString());
  });

  it("drops singletons", () => {
    const rows = [cand({ gamertag: "Solo", endedAt: at(0), x: 0, y: 0 })];
    expect(buildLongFormClusters(rows, OPTS)).toEqual([]);
  });

  it("rejects transitive chaining: A~B, B~C, but NOT A~C yields {A,B} only", () => {
    // spacing 100s apart each: A@0, B@100, C@200. A-C is 200s > 180s window.
    const rows = [
      cand({ gamertag: "A", endedAt: at(0), x: 0, y: 0 }),
      cand({ gamertag: "B", endedAt: at(100), x: 0, y: 0 }),
      cand({ gamertag: "C", endedAt: at(200), x: 0, y: 0 }),
    ];
    const out = buildLongFormClusters(rows, OPTS);
    expect(out).toHaveLength(1);
    expect(out[0]!.subjects.map((s) => s.gamertag)).toEqual(["A", "B"]);
  });

  it("admits a true 3-clique where every pair is inside both thresholds", () => {
    const rows = [
      cand({ gamertag: "A", endedAt: at(0), x: 0, y: 0 }),
      cand({ gamertag: "B", endedAt: at(50), x: 10, y: 10 }),
      cand({ gamertag: "C", endedAt: at(100), x: 20, y: 20 }),
    ];
    const out = buildLongFormClusters(rows, OPTS);
    expect(out).toHaveLength(1);
    expect(out[0]!.subjects.map((s) => s.gamertag)).toEqual(["A", "B", "C"]);
  });

  it("window boundary is inclusive at exactly 180s and exclusive past it", () => {
    const inRows = [
      cand({ gamertag: "A", endedAt: at(0), x: 0, y: 0 }),
      cand({ gamertag: "B", endedAt: at(180), x: 0, y: 0 }),
    ];
    expect(buildLongFormClusters(inRows, OPTS)).toHaveLength(1);
    const outRows = [
      cand({ gamertag: "A", endedAt: new Date(T0.getTime()), x: 0, y: 0 }),
      cand({ gamertag: "B", endedAt: new Date(T0.getTime() + 180_001), x: 0, y: 0 }),
    ];
    expect(buildLongFormClusters(outRows, OPTS)).toEqual([]);
  });

  it("radius boundary is inclusive at exactly 100m and exclusive past it", () => {
    const inRows = [
      cand({ gamertag: "A", endedAt: at(0), x: 0, y: 0 }),
      cand({ gamertag: "B", endedAt: at(1), x: 100, y: 0 }),
    ];
    expect(buildLongFormClusters(inRows, OPTS)).toHaveLength(1);
    const outRows = [
      cand({ gamertag: "A", endedAt: at(0), x: 0, y: 0 }),
      cand({ gamertag: "B", endedAt: at(1), x: 100.001, y: 0 }),
    ];
    expect(buildLongFormClusters(outRows, OPTS)).toEqual([]);
  });

  it("never spans servers", () => {
    const rows = [
      cand({ gamertag: "A", endedAt: at(0), x: 0, y: 0, serverId: 1 }),
      cand({ gamertag: "B", endedAt: at(5), x: 0, y: 0, serverId: 2 }),
    ];
    expect(buildLongFormClusters(rows, OPTS)).toEqual([]);
  });

  it("claims each death at most once", () => {
    const rows = [
      cand({ gamertag: "A", endedAt: at(0), x: 0, y: 0 }),
      cand({ gamertag: "B", endedAt: at(10), x: 0, y: 0 }),
      cand({ gamertag: "C", endedAt: at(20), x: 0, y: 0 }),
      cand({ gamertag: "D", endedAt: at(30), x: 0, y: 0 }),
    ];
    const out = buildLongFormClusters(rows, OPTS);
    const ids = out.flatMap((c) => c.subjects.map((s) => s.lifeId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is deterministic under input reordering", () => {
    const rows = [
      cand({ gamertag: "A", endedAt: at(0), x: 0, y: 0 }),
      cand({ gamertag: "B", endedAt: at(50), x: 0, y: 0 }),
      cand({ gamertag: "C", endedAt: at(100), x: 0, y: 0 }),
    ];
    const a = buildLongFormClusters(rows, OPTS);
    const b = buildLongFormClusters([...rows].reverse(), OPTS);
    expect(b.map((c) => c.naturalKey)).toEqual(a.map((c) => c.naturalKey));
  });

  it("emits the exact natural key format", () => {
    expect(longFormNaturalKey(7, new Date("2026-07-11T12:00:00.000Z"), ["Zed", "Ay"]))
      .toBe("long_form:7:2026-07-11T12:00:00.000Z:Ay+Zed");
  });

  it("carries no coordinate-shaped number in the returned clusters", () => {
    const rows = [
      cand({ gamertag: "A", endedAt: at(0), x: 7423.51, y: 9210.88 }),
      cand({ gamertag: "B", endedAt: at(20), x: 7443.19, y: 9245.02 }),
    ];
    const out = buildLongFormClusters(rows, OPTS);
    expect(JSON.stringify(out)).not.toMatch(/\d{4}\.\d/);
  });

  it("no observed gamertag contains the key separator '+'", () => {
    // Guards the un-escaped key format; see the comment in longFormNaturalKey.
    const observed = ["GabeFox101", "CUPID18", "YrJustBad", "Cee Lo GREEN 96"];
    for (const g of observed) expect(g).not.toContain("+");
  });
});
```

- [ ] **Step 6.2: Run it and watch it fail on the missing module.**
```
pnpm --filter @onelife/newsdesk test long-form-cluster
```
Expected: `Failed to resolve import "../src/long-form-cluster.js"`.

- [ ] **Step 6.3: Create `apps/newsdesk/src/long-form-cluster.ts`** with the three types above (exactly as in the Interfaces block) plus:

```ts
const metres = (a: DeathCandidate, b: DeathCandidate) => Math.hypot(a.x - b.x, a.y - b.y);
const seconds = (a: DeathCandidate, b: DeathCandidate) =>
  Math.abs(a.endedAt.getTime() - b.endedAt.getTime()) / 1000;

const byTag = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Timestamps serialize as toISOString() (UTC, ms precision); gamertags appear VERBATIM as stored
 *  in `players`, never lowercased (spec §6). A gamertag containing '+' would make the key
 *  ambiguous — the observed corpus has none (asserted in long-form-cluster.test.ts) and escaping
 *  is deliberately NOT done, because it would change the key format for every future article. */
export function longFormNaturalKey(serverId: number, earliestDeathAt: Date, gamertags: string[]): string {
  return `long_form:${serverId}:${earliestDeathAt.toISOString()}:${[...gamertags].sort(byTag).join("+")}`;
}

const strip = (c: DeathCandidate): LongFormSubject => ({
  lifeId: c.lifeId, serverId: c.serverId, gamertag: c.gamertag, map: c.map,
  mapSlug: c.mapSlug, lifeNumber: c.lifeNumber, lifeStartedAt: c.lifeStartedAt,
  endedAt: c.endedAt, deathCause: c.deathCause,
});
```

- [ ] **Step 6.4: Implement the clique walk** in the same file:

```ts
export function buildLongFormClusters(
  candidates: DeathCandidate[],
  opts: { windowSeconds: number; radiusMeters: number },
): LongFormCluster[] {
  const out: LongFormCluster[] = [];
  const byServer = new Map<number, DeathCandidate[]>();
  for (const c of candidates) {
    const bucket = byServer.get(c.serverId);
    if (bucket) bucket.push(c); else byServer.set(c.serverId, [c]);
  }

  for (const [serverId, bucket] of [...byServer.entries()].sort((a, b) => a[0] - b[0])) {
    // Sort by (endedAt, gamertag). NEVER by lives.id — it is not stable across a projection
    // rebuild, and both natural_key and the primary choice depend on this ordering (spec §4.2).
    const rows = [...bucket].sort(
      (a, b) => a.endedAt.getTime() - b.endedAt.getTime() || byTag(a.gamertag, b.gamertag));
    const claimed = new Set<number>();

    for (let i = 0; i < rows.length; i++) {
      if (claimed.has(i)) continue;
      const members = [i];
      for (let j = i + 1; j < rows.length; j++) {
        if (claimed.has(j)) continue;
        // A clique, not a chain: j must satisfy BOTH thresholds against EVERY current member,
        // not merely against the seed. With A~B and B~C but not A~C, chaining yields {A,B,C};
        // this yields {A,B} and lets C seed its own (discarded) singleton. Thresholds are
        // INCLUSIVE — exactly 180.000s / 100.000m is in, 180.001s is out.
        //
        // Admission in sorted order is GREEDY and is not guaranteed to find the MAXIMUM clique;
        // it finds *a* maximal one deterministically. Determinism is the requirement — the same
        // input must always yield the same members and therefore the same natural_key. Do not
        // "fix" this into a maximum-clique search; that would make membership order-sensitive.
        const ok = members.every((m) =>
          seconds(rows[m]!, rows[j]!) <= opts.windowSeconds &&
          metres(rows[m]!, rows[j]!) <= opts.radiusMeters);
        if (ok) members.push(j);
      }
      for (const m of members) claimed.add(m);   // a death belongs to at most one cluster, ever
      if (members.length < 2) continue;

      const subjects = members.map((m) => strip(rows[m]!)).sort((a, b) => byTag(a.gamertag, b.gamertag));
      // Computed explicitly rather than relying on `subjects[0]` or the seed, so a future change
      // to seed order cannot silently change which subject is primary.
      const primary = [...subjects].sort(
        (a, b) => a.endedAt.getTime() - b.endedAt.getTime() || byTag(a.gamertag, b.gamertag))[0]!;
      out.push({
        serverId, map: primary.map, mapSlug: primary.mapSlug,
        earliestDeathAt: primary.endedAt, primary, subjects,
        naturalKey: longFormNaturalKey(serverId, primary.endedAt, subjects.map((s) => s.gamertag)),
      });
    }
  }
  return out;
}
```

- [ ] **Step 6.5: Green the suite.**
```
pnpm --filter @onelife/newsdesk test long-form-cluster
```
Expected: `12 passed`.

---

## Task 7: Long Form exclusions — the four named filters with per-reason counts

**Files:**
- Modify: `apps/newsdesk/src/long-form-cluster.ts`
- Test: `apps/newsdesk/test/long-form-cluster.test.ts` (append a `describe`)

**Interfaces produced:**
```ts
export type LongFormExclusion =
  | "self_cluster" | "suicide_subject" | "unqualified_subject" | "suppressed_gamertag";
export interface LongFormResult {
  clusters: LongFormCluster[];
  skipped: Record<LongFormExclusion, number>;
}
export function applyLongFormExclusions(
  clusters: LongFormCluster[],
  opts: { suppressedGamertags: string[] },
): LongFormResult;
```
Still pure — no DB.

- [ ] **Step 7.1: Append the failing tests** to `apps/newsdesk/test/long-form-cluster.test.ts`. Model the fixture on the six verified production pairs; four are self-clusters, five contain a suicide, exactly one survives.

```ts
import { applyLongFormExclusions } from "../src/long-form-cluster.js";

const pair = (a: string, b: string, ca: string, cb: string) =>
  buildLongFormClusters(
    [cand({ gamertag: a, endedAt: at(0), x: 0, y: 0, deathCause: ca }),
     cand({ gamertag: b, endedAt: at(27), x: 40, y: 0, deathCause: cb })],
    OPTS)[0]!;

describe("applyLongFormExclusions", () => {
  it("drops a self-cluster (same gamertag twice)", () => {
    const r = applyLongFormExclusions([pair("YrJustBad", "YrJustBad", "pvp", "pvp")], { suppressedGamertags: [] });
    expect(r.clusters).toEqual([]);
    expect(r.skipped.self_cluster).toBe(1);
  });

  it("drops a cluster CONTAINING a suicide, not only an all-suicide one", () => {
    const r = applyLongFormExclusions([pair("Ay", "Bee", "suicide", "mauled")], { suppressedGamertags: [] });
    expect(r.clusters).toEqual([]);
    expect(r.skipped.suicide_subject).toBe(1);
  });

  it("does not treat a NULL death cause as a suicide", () => {
    const c = buildLongFormClusters(
      [cand({ gamertag: "Ay", endedAt: at(0), x: 0, y: 0, deathCause: null }),
       cand({ gamertag: "Bee", endedAt: at(27), x: 40, y: 0, deathCause: "infected" })], OPTS)[0]!;
    const r = applyLongFormExclusions([c], { suppressedGamertags: [] });
    expect(r.clusters).toHaveLength(1);
    expect(r.skipped.suicide_subject).toBe(0);
  });

  it("drops a cluster containing a suppressed gamertag, case-insensitively", () => {
    const r = applyLongFormExclusions([pair("DevAccount", "Bee", "pvp", "pvp")], { suppressedGamertags: ["devaccount"] });
    expect(r.clusters).toEqual([]);
    expect(r.skipped.suppressed_gamertag).toBe(1);
  });

  it("counts self-cluster before suicide when a cluster trips both", () => {
    const r = applyLongFormExclusions([pair("YrJustBad", "YrJustBad", "suicide", "suicide")], { suppressedGamertags: [] });
    expect(r.skipped).toEqual({ self_cluster: 1, suicide_subject: 0, unqualified_subject: 0, suppressed_gamertag: 0 });
  });

  it("survives exactly one of the six verified production pairs", () => {
    const clusters = [
      pair("GabeFox101", "CUPID18", "infected", "died"),
      pair("YrJustBad", "YrJustBad", "suicide", "suicide"),
      pair("YrJustBad", "YrJustBad", "suicide", "suicide"),
      pair("YrJustBad", "YrJustBad", "suicide", "suicide"),
      pair("YrJustBad", "YrJustBad", "suicide", "suicide"),
      pair("YrJustBad", "Cee Lo GREEN 96", "pvp", "pvp"),
    ];
    const r = applyLongFormExclusions(clusters, { suppressedGamertags: [] });
    expect(r.clusters).toHaveLength(2); // 4 self-clusters removed; the two mixed pairs remain
    expect(r.skipped.self_cluster).toBe(4);
  });

  it("returns a zeroed skip record when nothing is excluded", () => {
    const r = applyLongFormExclusions([], { suppressedGamertags: [] });
    expect(r.skipped).toEqual({ self_cluster: 0, suicide_subject: 0, unqualified_subject: 0, suppressed_gamertag: 0 });
  });
});
```

- [ ] **Step 7.2: Run and confirm the failure** is `applyLongFormExclusions is not a function`.
```
pnpm --filter @onelife/newsdesk test long-form-cluster
```

- [ ] **Step 7.3: Implement in `apps/newsdesk/src/long-form-cluster.ts`.** Exclusions are applied AFTER construction, one predicate per named reason, in a fixed order so counts are reproducible:

```ts
export type LongFormExclusion =
  | "self_cluster" | "suicide_subject" | "unqualified_subject" | "suppressed_gamertag";

export interface LongFormResult {
  clusters: LongFormCluster[];
  /** Per-reason skip counts for the tick's log line (spec §14 observability).
   *  NOTE: `unqualified_subject` is structurally always 0 here — the qualified gate lives in the
   *  candidate SQL (long-form-targets.ts), so an unqualified death is a "candidate not selected"
   *  and never reaches cluster construction. The field exists so the log shape is stable and the
   *  exclusion is enumerated where a reader looks for it. */
  skipped: Record<LongFormExclusion, number>;
}

export function applyLongFormExclusions(
  clusters: LongFormCluster[],
  opts: { suppressedGamertags: string[] },
): LongFormResult {
  const skipped: Record<LongFormExclusion, number> = {
    self_cluster: 0, suicide_subject: 0, unqualified_subject: 0, suppressed_gamertag: 0,
  };
  const supp = new Set(opts.suppressedGamertags.map((g) => g.toLowerCase()));
  const kept: LongFormCluster[] = [];

  for (const c of clusters) {
    const tags = c.subjects.map((s) => s.gamertag);
    // 1. Self-cluster — one player's own consecutive rerolls are not a shared fate.
    if (new Set(tags).size !== tags.length) { skipped.self_cluster++; continue; }
    // 2. ANY suicide subject discards the whole cluster (spec §4.2) — a mixed cluster would
    //    narrate a named real player's suicide as half of a shared fate, which is factually false.
    //    Compare the literal "suicide": causeFamily() must NOT be used, it would fold the
    //    distinction away. A NULL cause is not a suicide.
    if (c.subjects.some((s) => s.deathCause === "suicide")) { skipped.suicide_subject++; continue; }
    // 4. Suppressed gamertags (§13.3). Belt-and-braces: the candidate SQL also filters them, so
    //    a suppressed player cannot claim a seed slot and suppress a legitimate cluster around it.
    //    Removing a candidate can change cluster membership — that is intended, a suppressed
    //    subject is not part of the story.
    if (supp.size > 0 && c.subjects.some((s) => supp.has(s.gamertag.toLowerCase()))) {
      skipped.suppressed_gamertag++; continue;
    }
    kept.push(c);
  }
  return { clusters: kept, skipped };
}
```

- [ ] **Step 7.4: Green.**
```
pnpm --filter @onelife/newsdesk test long-form-cluster
```
Expected: `19 passed`.

---

## Task 8: Long Form candidate query — the positions lateral

**Files:**
- Create: `apps/newsdesk/src/long-form-targets.ts`
- Test: `apps/newsdesk/test/long-form-targets.test.ts` (DB harness)

**Interfaces consumed:**
```ts
qualifiedLifeCondition(db: Database): SQL          // @onelife/read-models
lives, players, servers, positions                  // @onelife/db
```
**Interfaces produced:**
```ts
export interface LongFormCandidateOpts {
  since: Date;                 // NEWSDESK_NEWS_SINCE — forward-only on lives.ended_at
  now: Date;
  maxFixAgeSeconds: number;    // NEWSDESK_LONGFORM_MAX_FIX_AGE_SECONDS, default 120
  suppressedGamertags: string[];
  candidateLimit: number;      // pre-clustering row cap
}
export async function findLongFormCandidates(
  db: Database, opts: LongFormCandidateOpts,
): Promise<DeathCandidate[]>;
```

- [ ] **Step 8.1: Write the DB test.** Create `apps/newsdesk/test/long-form-targets.test.ts` following the seven-point harness idiom — random `svc`, gamertags suffixed with it, fixed `t0`, FK-ordered teardown ending in `await sql.end()`, assertions filtered to this test's own rows.

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, positions } from "@onelife/db";
import { inArray } from "drizzle-orm";
import { findLongFormCandidates } from "../src/long-form-targets.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 53e7;
const t0 = new Date("2026-07-11T00:00:00.000Z");
const mins = (m: number) => new Date(t0.getTime() + m * 60_000);
let serverId: number;
const pids: number[] = [];
const tag = (n: string) => `lf-${n}-${svc}`;

async function mkPlayer(name: string) {
  const [p] = await db.insert(players).values({ gamertag: tag(name), lastSeenAt: mins(600) }).returning();
  pids.push(p!.id);
  return p!.id;
}

beforeAll(async () => {
  const [s] = await db.insert(servers).values({
    nitradoServiceId: svc, name: "lf", map: "chernarusplus", slug: `lf-${svc}`, active: true,
  }).returning();
  serverId = s!.id;

  const ay = await mkPlayer("ay");        // qualified (playtime), fresh fix
  const bee = await mkPlayer("bee");      // qualified, fresh fix, near Ay
  const shorty = await mkPlayer("short"); // NOT qualified — 30s playtime, no kills, not pvp
  const stale = await mkPlayer("stale");  // qualified but fix is 10 minutes old
  const nofix = await mkPlayer("nofix");  // qualified, no positions row at all

  await db.insert(lives).values([
    { serverId, playerId: ay,     lifeNumber: 1, startedAt: mins(0), endedAt: mins(60), deathCause: "pvp",         playtimeSeconds: 3600 },
    { serverId, playerId: bee,    lifeNumber: 1, startedAt: mins(0), endedAt: mins(61), deathCause: "infected",    playtimeSeconds: 3660 },
    { serverId, playerId: shorty, lifeNumber: 1, startedAt: mins(0), endedAt: mins(60), deathCause: "environment", playtimeSeconds: 30 },
    { serverId, playerId: stale,  lifeNumber: 1, startedAt: mins(0), endedAt: mins(60), deathCause: "mauled",      playtimeSeconds: 3600 },
    { serverId, playerId: nofix,  lifeNumber: 1, startedAt: mins(0), endedAt: mins(60), deathCause: "mauled",      playtimeSeconds: 3600 },
  ]);

  await db.insert(positions).values([
    { serverId, playerId: ay,     gamertag: tag("ay"),    x: 7423.51, y: 9210.88, recordedAt: mins(60) },
    { serverId, playerId: ay,     gamertag: tag("ay"),    x: 1111.11, y: 2222.22, recordedAt: mins(90) }, // AFTER death — must be ignored
    { serverId, playerId: bee,    gamertag: tag("bee"),   x: 7443.19, y: 9245.02, recordedAt: mins(61) },
    { serverId, playerId: shorty, gamertag: tag("short"), x: 7430.00, y: 9220.00, recordedAt: mins(60) },
    { serverId, playerId: stale,  gamertag: tag("stale"), x: 7430.00, y: 9220.00, recordedAt: mins(50) }, // 10 min stale
  ]);
});

afterAll(async () => {
  await db.delete(positions).where(inArray(positions.serverId, [serverId]));
  await db.delete(sessions).where(inArray(sessions.serverId, [serverId]));
  await db.delete(lives).where(inArray(lives.serverId, [serverId]));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(inArray(servers.id, [serverId]));
  await sql.end();
});

const OPTS = { since: t0, now: mins(600), maxFixAgeSeconds: 120, suppressedGamertags: [], candidateLimit: 200 };
const mine = (rows: { gamertag: string }[]) => rows.filter((r) => r.gamertag.endsWith(`-${svc}`));

describe("findLongFormCandidates", () => {
  it("returns only qualified deaths with a fresh fix, oldest death first", async () => {
    const rows = mine(await findLongFormCandidates(db, OPTS));
    expect(rows.map((r) => r.gamertag)).toEqual([tag("ay"), tag("bee")]);
  });

  it("takes the last fix AT OR BEFORE ended_at, never a later one", async () => {
    const rows = mine(await findLongFormCandidates(db, OPTS));
    const a = rows.find((r) => r.gamertag === tag("ay"))!;
    expect(a.x).toBeCloseTo(7423.51, 2);
    expect(a.y).toBeCloseTo(9210.88, 2);
  });

  it("drops a death whose only fix is older than maxFixAgeSeconds", async () => {
    const rows = mine(await findLongFormCandidates(db, OPTS));
    expect(rows.map((r) => r.gamertag)).not.toContain(tag("stale"));
  });

  it("drops a death with no positions row at all (INNER lateral, not LEFT)", async () => {
    const rows = mine(await findLongFormCandidates(db, OPTS));
    expect(rows.map((r) => r.gamertag)).not.toContain(tag("nofix"));
  });

  it("drops an unqualified death before it can seed or join a clique", async () => {
    const rows = mine(await findLongFormCandidates(db, OPTS));
    expect(rows.map((r) => r.gamertag)).not.toContain(tag("short"));
  });

  it("drops a suppressed gamertag case-insensitively", async () => {
    const rows = mine(await findLongFormCandidates(db, {
      ...OPTS, suppressedGamertags: [tag("ay").toUpperCase()],
    }));
    expect(rows.map((r) => r.gamertag)).toEqual([tag("bee")]);
  });

  it("honours the forward-only `since` cutoff on ended_at", async () => {
    const rows = mine(await findLongFormCandidates(db, { ...OPTS, since: mins(61) }));
    expect(rows.map((r) => r.gamertag)).toEqual([tag("bee")]);
  });
});
```

- [ ] **Step 8.2: Run and confirm the import failure.**
```
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/newsdesk test long-form-targets
```
Expected: `Failed to resolve import "../src/long-form-targets.js"`.

- [ ] **Step 8.3: Create `apps/newsdesk/src/long-form-targets.ts`** as a **raw `db.execute(sql\`…\`)` statement**, not a drizzle query builder. Drizzle's `innerJoin` takes a table or a subquery, not a raw `SQL` fragment, so `JOIN LATERAL … ON TRUE` cannot be expressed through the builder — writing it raw from the start avoids a compile failure and also removes the column-alias guesswork on `fix.x`/`fix.y`. `qualifiedLifeCondition(db)` is a correlated `SQL` over un-aliased `lives`/`players`, so it interpolates directly as long as both tables are joined without aliases (they are).

Note there is **no article anti-join here** — the Long Form key depends on the whole clique, so it cannot be computed in SQL at all; the anti-join is a second TS-side query (Task 9).

```ts
import type { Database } from "@onelife/db";
import { lives, players, servers, positions } from "@onelife/db";
import { sql } from "drizzle-orm";
import { qualifiedLifeCondition } from "@onelife/read-models";
import type { DeathCandidate } from "./long-form-cluster.js";

export interface LongFormCandidateOpts {
  since: Date;
  now: Date;
  maxFixAgeSeconds: number;
  suppressedGamertags: string[];
  candidateLimit: number;
}

/** postgres-js returns a RowList (a real Array) from db.execute; node-postgres would return
 *  `{ rows }`. Normalise once so the mapping below is driver-agnostic. */
function resultRows(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  return ((res as { rows?: unknown[] }).rows ?? []) as Record<string, unknown>[];
}

/** postgres-js already parses timestamptz into a Date; a raw driver could hand back a string. */
const toDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const orNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export async function findLongFormCandidates(
  db: Database,
  opts: LongFormCandidateOpts,
): Promise<DeathCandidate[]> {
  // Suppressed players are filtered HERE as well as post-clustering: a suppressed death must not
  // be able to claim a cluster seed slot and thereby suppress a legitimate cluster around it.
  // Removing a candidate can change cluster membership — that is intended.
  const suppressed = opts.suppressedGamertags.length === 0
    ? sql`TRUE`
    : sql`lower(${players.gamertag}) <> ALL(${opts.suppressedGamertags.map((g) => g.toLowerCase())}::text[])`;

  // Neither `lives` nor `kills` stores coordinates; `positions` is the only source. JOIN LATERAL
  // ... ON TRUE (INNER, never LEFT): a death with no fix must be DROPPED, not carried with NULL
  // coordinates into the distance maths. ORDER BY recorded_at DESC LIMIT 1 is "the last fix at or
  // before ended_at" and is served backwards by positions_player_idx
  // (server_id, player_id, recorded_at) with no sort. The fix-age guard sits in the WHERE so it
  // prunes BEFORE clustering.
  const res = await db.execute(sql`
    SELECT
      ${lives.id}          AS life_id,
      ${lives.serverId}    AS server_id,
      ${players.gamertag}  AS gamertag,
      ${servers.map}       AS map,
      ${servers.slug}      AS map_slug,
      ${lives.lifeNumber}  AS life_number,
      ${lives.startedAt}   AS life_started_at,
      ${lives.endedAt}     AS ended_at,
      ${lives.deathCause}  AS death_cause,
      fix.x                AS x,
      fix.y                AS y,
      fix.recorded_at      AS fix_at
    FROM ${lives}
    INNER JOIN ${players} ON ${players.id} = ${lives.playerId}
    INNER JOIN ${servers} ON ${servers.id} = ${lives.serverId}
    JOIN LATERAL (
      SELECT pos.x, pos.y, pos.recorded_at
      FROM ${positions} pos
      WHERE pos.server_id = ${lives.serverId}
        AND pos.player_id = ${lives.playerId}
        AND pos.recorded_at <= ${lives.endedAt}
      ORDER BY pos.recorded_at DESC
      LIMIT 1
    ) fix ON TRUE
    WHERE ${lives.endedAt} IS NOT NULL
      AND ${lives.endedAt} >= ${opts.since}
      AND ${lives.endedAt} <= ${opts.now}
      AND ${qualifiedLifeCondition(db)}
      AND fix.recorded_at >= ${lives.endedAt} - make_interval(secs => ${opts.maxFixAgeSeconds}::double precision)
      AND ${suppressed}
    ORDER BY ${lives.endedAt} ASC, ${players.gamertag} ASC
    LIMIT ${opts.candidateLimit}
  `);

  return resultRows(res).map((r) => ({
    lifeId: Number(r.life_id),
    serverId: Number(r.server_id),
    gamertag: String(r.gamertag),
    map: String(r.map),
    mapSlug: orNull(r.map_slug),
    lifeNumber: Number(r.life_number),
    lifeStartedAt: toDate(r.life_started_at),
    endedAt: toDate(r.ended_at),
    deathCause: orNull(r.death_cause),
    x: Number(r.x),
    y: Number(r.y),
    fixAt: toDate(r.fix_at),
  }));
}
```

- [ ] **Step 8.4: Green the suite.**
```
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/newsdesk test long-form-targets
```
Expected: `7 passed`.

---

## Task 9: Long Form assembly — anti-join against published articles

**Files:**
- Modify: `apps/newsdesk/src/long-form-targets.ts`
- Test: `apps/newsdesk/test/long-form-targets.test.ts` (append a `describe`)

**Interfaces produced:**
```ts
/** Nine required fields in total: the five inherited from LongFormCandidateOpts
 *  (since, now, maxFixAgeSeconds, suppressedGamertags, candidateLimit) plus these four.
 *  Every one is required — a call site that omits `now` or `candidateLimit` is a TS error,
 *  which is exactly what PR-C2's newsTick call must satisfy. */
export interface LongFormTargetOpts extends LongFormCandidateOpts {
  windowSeconds: number; radiusMeters: number; maxAttempts: number; limit: number;
}
export async function findLongFormTargets(
  db: Database, opts: LongFormTargetOpts,
): Promise<LongFormResult>;
```

- [ ] **Step 9.1: Append the failing tests.**

```ts
import { articles } from "@onelife/db";
import { findLongFormTargets } from "../src/long-form-targets.js";

const T_OPTS = { ...OPTS, windowSeconds: 180, radiusMeters: 100, maxAttempts: 3, limit: 2 };
const mineC = (r: { clusters: { primary: { gamertag: string } }[] }) =>
  r.clusters.filter((c) => c.primary.gamertag.endsWith(`-${svc}`));

describe("findLongFormTargets", () => {
  it("clusters the two fresh qualified deaths into one target", async () => {
    const r = await findLongFormTargets(db, T_OPTS);
    const cs = mineC(r);
    expect(cs).toHaveLength(1);
    expect(cs[0]!.subjects.map((s) => s.gamertag)).toEqual([tag("ay"), tag("bee")]);
    expect(cs[0]!.naturalKey).toBe(
      `long_form:${serverId}:${mins(60).toISOString()}:${[tag("ay"), tag("bee")].sort().join("+")}`);
  });

  it("returns a coordinate-free target — the fixture rows DO contain coordinates", async () => {
    const r = await findLongFormTargets(db, T_OPTS);
    expect(JSON.stringify(mineC(r))).not.toMatch(/\d{4}\.\d/);
  });

  it("suppresses a cluster whose natural key is already published", async () => {
    const r0 = await findLongFormTargets(db, T_OPTS);
    const key = mineC(r0)[0]!.naturalKey;
    await db.insert(articles).values({
      kind: "news", status: "published", naturalKey: key,
      serverId, gamertag: tag("ay"), map: "chernarusplus", lifeNumber: 1,
      lifeStartedAt: mins(0), deathAt: mins(60),
      slug: `lf-published-${svc}`, headline: "H", lede: "L", body: "B",
      promptVersion: "news-v1", model: "test", attempts: 1,
    });
    expect(mineC(await findLongFormTargets(db, T_OPTS))).toEqual([]);
    await db.delete(articles).where(inArray(articles.naturalKey, [key]));
  });

  it("suppresses a cluster whose failed article has exhausted attempts, but not one that has not", async () => {
    const key = mineC(await findLongFormTargets(db, T_OPTS))[0]!.naturalKey;
    await db.insert(articles).values({
      kind: "news", status: "failed", naturalKey: key, attempts: 1,
      serverId, gamertag: tag("ay"), map: "chernarusplus", lifeNumber: 1,
      lifeStartedAt: mins(0), promptVersion: "news-v1", model: "test",
    });
    expect(mineC(await findLongFormTargets(db, T_OPTS))).toHaveLength(1); // 1 < maxAttempts 3
    await db.update(articles).set({ attempts: 3 }).where(inArray(articles.naturalKey, [key]));
    expect(mineC(await findLongFormTargets(db, T_OPTS))).toEqual([]);
    await db.delete(articles).where(inArray(articles.naturalKey, [key]));
  });

  it("reports per-reason skip counts", async () => {
    const r = await findLongFormTargets(db, T_OPTS);
    expect(Object.keys(r.skipped).sort()).toEqual(
      ["self_cluster", "suicide_subject", "suppressed_gamertag", "unqualified_subject"]);
  });
});
```
Also extend `afterAll` with `await db.delete(articles).where(inArray(articles.serverId, [serverId]));` as the **first** delete.

- [ ] **Step 9.2: Run and confirm the failure.**
```
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/newsdesk test long-form-targets
```
Expected: `findLongFormTargets is not a function`.

- [ ] **Step 9.3: Implement `findLongFormTargets`** in `apps/newsdesk/src/long-form-targets.ts`. Extend the existing imports — add `articles` to the `@onelife/db` import and `and, inArray` to the `drizzle-orm` import (`sql` is already imported):

```ts
import { articles } from "@onelife/db";
import { and, inArray } from "drizzle-orm";
import { applyLongFormExclusions, buildLongFormClusters, type LongFormResult } from "./long-form-cluster.js";

/** Nine required fields in total — see the interface note: a C2 call site that omits `now` or
 *  `candidateLimit` will not compile. */
export interface LongFormTargetOpts extends LongFormCandidateOpts {
  windowSeconds: number; radiusMeters: number; maxAttempts: number; limit: number;
}

export async function findLongFormTargets(
  db: Database,
  opts: LongFormTargetOpts,
): Promise<LongFormResult> {
  const candidates = await findLongFormCandidates(db, opts);
  const built = buildLongFormClusters(candidates, opts);
  const { clusters, skipped } = applyLongFormExclusions(built, opts);
  if (clusters.length === 0) return { clusters, skipped };

  // Two-query anti-join, deliberately NOT a SQL-computed key. The Long Form key depends on the
  // whole clique, so it cannot be built in SQL at all; doing it in TS also makes toISOString()
  // the SOLE producer of every key, so the written key and the anti-joined key are the same
  // string by construction. (A SQL to_char() rendering that drifted from JS would make the
  // anti-join a silent no-op and re-publish the same subject every tick.)
  const keys = clusters.map((c) => c.naturalKey);
  const blocked = await db
    .select({ k: articles.naturalKey })
    .from(articles)
    .where(and(
      inArray(articles.naturalKey, keys),
      sql`(${articles.status} = 'published' OR ${articles.attempts} >= ${opts.maxAttempts})`,
    ));
  const blockedSet = new Set(blocked.map((r) => r.k!));

  // The limit is applied AFTER the anti-join drop, so a blocked cluster never consumes a slot.
  return { clusters: clusters.filter((c) => !blockedSet.has(c.naturalKey)).slice(0, opts.limit), skipped };
}
```

- [ ] **Step 9.4: Green, then typecheck.**
```
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/newsdesk test long-form-targets
pnpm --filter @onelife/newsdesk typecheck
```
Expected: `12 passed`, then typecheck clean.

---

## Task 10: Standing Dead natural key + option type (pure)

**Files:**
- Create: `apps/newsdesk/src/standing-dead-targets.ts`
- Test: `apps/newsdesk/test/standing-dead-key.test.ts`

**Interfaces produced:**
```ts
export interface StandingDeadTarget {
  lifeId: number;            // transient — loads getLifeTimeline in the tick; NEVER persisted
  serverId: number; gamertag: string;
  map: string; mapSlug: string | null; lifeNumber: number;
  lifeStartedAt: Date; playtimeSeconds: number;
  lastSeenAt: Date; eligibleAt: Date; idleSeconds: number;
  priorLives: number; hitsAbsorbed: number;
  naturalKey: string;
}
export interface StandingDeadOpts {
  now: Date; since: Date;
  standingDeadHours: number;        // 72
  minPlaytimeSeconds: number;       // 1800
  minHitsAbsorbed: number;          // 100
  suppressedGamertags: string[];
  maxAttempts: number; limit: number;
}
export function standingDeadNaturalKey(serverId: number, gamertag: string, lifeStartedAt: Date): string;
```

**Deliberate omission:** `StandingDeadTarget` carries **no** emote field. The Newsroom facts
vocabulary names `lastExpressiveEmote`, but no image gate reads it and no targeting predicate needs
it — sourcing it here would put an unused, unsourced column in the hot query. PR-C2's facts builder
sources the allowlisted emote itself and must not expect it on the target.

- [ ] **Step 10.1: Write the failing key test.** Create `apps/newsdesk/test/standing-dead-key.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { standingDeadNaturalKey } from "../src/standing-dead-targets.js";

describe("standingDeadNaturalKey", () => {
  it("emits the exact spec §4.1.3 format", () => {
    expect(standingDeadNaturalKey(7, "GabeFox101", new Date("2026-07-11T12:00:00.000Z")))
      .toBe("standing_dead:7:GabeFox101:2026-07-11T12:00:00.000Z");
  });

  it("preserves gamertag casing verbatim and never lowercases", () => {
    expect(standingDeadNaturalKey(1, "Cee Lo GREEN 96", new Date("2026-01-02T03:04:05.678Z")))
      .toBe("standing_dead:1:Cee Lo GREEN 96:2026-01-02T03:04:05.678Z");
  });

  it("contains no numeric row id — the key must survive a projection rebuild", () => {
    const k = standingDeadNaturalKey(7, "Ay", new Date("2026-07-11T12:00:00.000Z"));
    expect(k.split(":")[1]).toBe("7"); // server id only; lives.id appears nowhere
    expect(k).not.toMatch(/lifeId|life_id/);
  });
});
```

- [ ] **Step 10.2: Run and confirm failure.**
```
pnpm --filter @onelife/newsdesk test standing-dead-key
```
Expected: `Failed to resolve import "../src/standing-dead-targets.js"`.

- [ ] **Step 10.3: Create `apps/newsdesk/src/standing-dead-targets.ts`** with the two interfaces above and:

```ts
/** Rebuild-stable identity: server id + gamertag verbatim + the life's start instant as an
 *  ISO string (UTC, ms precision). NEVER a projection row id — `articles` survives --rebuild and
 *  `lives.id` does not. Computed BEFORE generation and written by BOTH the publish path and the
 *  failure-stub path; a stub with a NULL natural_key escapes articles_natural_key_uniq and the
 *  retry inserts a second stub forever. */
export function standingDeadNaturalKey(serverId: number, gamertag: string, lifeStartedAt: Date): string {
  return `standing_dead:${serverId}:${gamertag}:${lifeStartedAt.toISOString()}`;
}
```

- [ ] **Step 10.4: Green.**
```
pnpm --filter @onelife/newsdesk test standing-dead-key
```
Expected: `3 passed`.

---

## Task 11: Standing Dead targeting — idle gate, `lastSeen` COALESCE, boundary + open-session cases

**Files:**
- Modify: `apps/newsdesk/src/standing-dead-targets.ts`
- Test: `apps/newsdesk/test/standing-dead-targets.test.ts` (DB harness)

**Interfaces consumed:** `qualifiedLifeCondition(db)`, `lives`, `players`, `servers`, `sessions`.
**Interfaces produced:** `findStandingDeadTargets(db, opts: StandingDeadOpts): Promise<StandingDeadTarget[]>` (earned coverage and the anti-join land in Tasks 12–13).

- [ ] **Step 11.1: Write the DB test.** Create `apps/newsdesk/test/standing-dead-targets.test.ts`. **`now` is always passed explicitly — never `new Date()`**, because the whole predicate is relative to a caller-supplied reference instant, and that is what makes the 72h boundary testable.

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, hitEvents, articles } from "@onelife/db";
import { inArray } from "drizzle-orm";
import { findStandingDeadTargets } from "../src/standing-dead-targets.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 53e7;
const t0 = new Date("2026-07-01T00:00:00.000Z");
const hrs = (h: number) => new Date(t0.getTime() + h * 3_600_000);
const NOW = hrs(200);
const tag = (n: string) => `sd-${n}-${svc}`;
let serverId: number;
const pids: number[] = [];
const lifeIds = new Map<string, number>();

async function seed(name: string, o: {
  playtime: number; connectedAt: Date; disconnectedAt: Date | null;
  priorLife?: boolean; hits?: number; startedAt?: Date;
}) {
  const [p] = await db.insert(players).values({ gamertag: tag(name), lastSeenAt: o.connectedAt }).returning();
  pids.push(p!.id);
  const started = o.startedAt ?? hrs(1);
  if (o.priorLife) {
    await db.insert(lives).values({
      serverId, playerId: p!.id, lifeNumber: 1, startedAt: hrs(0),
      endedAt: hrs(0.5), deathCause: "pvp", playtimeSeconds: 1800,
    });
  }
  const [l] = await db.insert(lives).values({
    serverId, playerId: p!.id, lifeNumber: o.priorLife ? 2 : 1,
    startedAt: started, endedAt: null, deathCause: null, playtimeSeconds: o.playtime,
  }).returning();
  lifeIds.set(name, l!.id);
  await db.insert(sessions).values({
    serverId, playerId: p!.id, lifeId: l!.id,
    connectedAt: o.connectedAt, disconnectedAt: o.disconnectedAt,
    durationSeconds: o.playtime, closeReason: o.disconnectedAt ? "disconnect" : null,
  });
  for (let i = 0; i < (o.hits ?? 0); i++) {
    await db.insert(hitEvents).values({
      serverId, victimGamertag: tag(name), attackerGamertag: `zed-${i}`,
      attackerType: "infected", bodyPart: `part-${i}`,
      occurredAt: new Date(started.getTime() + i * 1000),
    });
  }
  return p!.id;
}

beforeAll(async () => {
  const [s] = await db.insert(servers).values({
    nitradoServiceId: svc, name: "sd", map: "sakhal", slug: `sd-${svc}`, active: true,
  }).returning();
  serverId = s!.id;

  // idle 80h, 2h playtime, has a prior life -> the canonical subject
  await seed("veteran", { playtime: 7200, connectedAt: hrs(118), disconnectedAt: hrs(120), priorLife: true });
  // exactly 72h idle as of NOW (200h): last seen 128h -> eligibleAt == NOW -> IN (inclusive)
  await seed("edge-in", { playtime: 7200, connectedAt: hrs(126), disconnectedAt: hrs(128), priorLife: true });
  // 71.99h idle: last seen 128.01h -> eligibleAt > NOW -> OUT
  await seed("edge-out", { playtime: 7200, connectedAt: hrs(126), disconnectedAt: hrs(128.01), priorLife: true });
  // crashed and never returned: disconnected_at IS NULL, connected 100h ago
  await seed("crashed", { playtime: 7200, connectedAt: hrs(100), disconnectedAt: null, priorLife: true });
  // idle but only 25 min of playtime -> below the 1800s gate
  await seed("brief", { playtime: 1500, connectedAt: hrs(98), disconnectedAt: hrs(100), priorLife: true });
});

afterAll(async () => {
  await db.delete(articles).where(inArray(articles.serverId, [serverId]));
  await db.delete(hitEvents).where(inArray(hitEvents.serverId, [serverId]));
  await db.delete(sessions).where(inArray(sessions.serverId, [serverId]));
  await db.delete(lives).where(inArray(lives.serverId, [serverId]));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(inArray(servers.id, [serverId]));
  await sql.end();
});

const OPTS = {
  now: NOW, since: t0, standingDeadHours: 72, minPlaytimeSeconds: 1800,
  minHitsAbsorbed: 100, suppressedGamertags: [], maxAttempts: 3, limit: 50,
};
const tagsOf = async (o = OPTS) =>
  (await findStandingDeadTargets(db, o)).filter((r) => r.gamertag.endsWith(`-${svc}`)).map((r) => r.gamertag);

describe("findStandingDeadTargets", () => {
  it("returns idle, qualified, long-enough open lives", async () => {
    const t = await tagsOf();
    expect(t).toContain(tag("veteran"));
    expect(t).not.toContain(tag("brief"));
  });

  it("includes a life idle by exactly the threshold and excludes one a hair under", async () => {
    const t = await tagsOf();
    expect(t).toContain(tag("edge-in"));
    expect(t).not.toContain(tag("edge-out"));
  });

  it("treats an OPEN session (disconnected_at IS NULL) as last-seen = connected_at", async () => {
    // The COALESCE is load-bearing: a naive MAX(disconnected_at) evaluates NULL and silently
    // excludes exactly the crash-and-never-returned case this vertical exists for.
    expect(await tagsOf()).toContain(tag("crashed"));
  });

  it("orders oldest-idle first so the backlog drains stably across ticks", async () => {
    const rows = (await findStandingDeadTargets(db, OPTS)).filter((r) => r.gamertag.endsWith(`-${svc}`));
    const seen = rows.map((r) => r.lastSeenAt.getTime());
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it("computes eligibleAt as lastSeen + standingDeadHours", async () => {
    const row = (await findStandingDeadTargets(db, OPTS)).find((r) => r.gamertag === tag("edge-in"))!;
    expect(row.eligibleAt.toISOString()).toBe(NOW.toISOString());
  });

  it("gates NEWS_SINCE on the ELIGIBILITY instant, not lives.started_at", async () => {
    // All subjects were born at hour 1; a `since` after that but before their eligibility instants
    // must still return them, and a `since` after every eligibility instant must return none.
    expect(await tagsOf({ ...OPTS, since: hrs(2) })).toContain(tag("veteran"));
    expect(await tagsOf({ ...OPTS, since: hrs(199) })).not.toContain(tag("veteran"));
  });

  it("excludes an ended life", async () => {
    await db.update(lives).set({ endedAt: hrs(130), deathCause: "pvp" })
      .where(inArray(lives.id, [lifeIds.get("veteran")!]));
    expect(await tagsOf()).not.toContain(tag("veteran"));
    await db.update(lives).set({ endedAt: null, deathCause: null })
      .where(inArray(lives.id, [lifeIds.get("veteran")!]));
  });

  it("honours the limit", async () => {
    const rows = await findStandingDeadTargets(db, { ...OPTS, limit: 1 });
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 11.2: Run and confirm the import failure.**
```
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/newsdesk test standing-dead-targets
```
Expected: `findStandingDeadTargets is not a function`.

- [ ] **Step 11.3: Implement `findStandingDeadTargets`** in `apps/newsdesk/src/standing-dead-targets.ts`. Earned coverage and the anti-join are stubbed as `sql\`TRUE\`` placeholders that Tasks 12–13 replace — write the `earnedCoverage`/`notPublished` locals now so the diff there is one line each. Unlike the Long Form lateral, this query has no `JOIN LATERAL`, so the drizzle query builder handles it: correlated scalar subqueries interpolate fine inside `.select()` and `.where()`.

```ts
import type { Database } from "@onelife/db";
import { lives, players, servers, sessions } from "@onelife/db";
import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";
import { qualifiedLifeCondition } from "@onelife/read-models";

export async function findStandingDeadTargets(
  db: Database,
  opts: StandingDeadOpts,
): Promise<StandingDeadTarget[]> {
  // `sessions` are per-life (sessions.life_id), so correlate on lives.id — not on the player.
  // COALESCE(disconnected_at, connected_at) is LOAD-BEARING: disconnected_at is nullable and a
  // stale OPEN session is exactly the crash-and-never-returned case this vertical exists for.
  // A naive MAX(disconnected_at) evaluates NULL and silently drops it.
  const lastSeen = sql<Date>`(
    SELECT MAX(COALESCE(s.disconnected_at, s.connected_at))
    FROM ${sessions} s
    WHERE s.life_id = ${lives.id}
  )`;
  // Expressed once and reused: §4.1.3 gates NEWS_SINCE on this same eligibility instant, NOT on
  // lives.started_at (which would make every verified subject ineligible forever).
  const eligibleAt = sql<Date>`(${lastSeen} + make_interval(hours => ${opts.standingDeadHours}))`;

  const suppressed = opts.suppressedGamertags.length === 0
    ? sql`TRUE`
    : sql`lower(${players.gamertag}) <> ALL(${opts.suppressedGamertags.map((g) => g.toLowerCase())}::text[])`;

  const earnedCoverage = sql`TRUE`;   // replaced in Task 12
  const notPublished = sql`TRUE`;     // replaced in Task 13 (TS-side two-query anti-join)

  const rows = await db
    .select({
      lifeId: lives.id, serverId: lives.serverId, gamertag: players.gamertag,
      map: servers.map, mapSlug: servers.slug, lifeNumber: lives.lifeNumber,
      lifeStartedAt: lives.startedAt, playtimeSeconds: lives.playtimeSeconds,
      lastSeenAt: lastSeen, eligibleAt,
      priorLives: sql<number>`0`, hitsAbsorbed: sql<number>`0`,
    })
    .from(lives)
    .innerJoin(players, eq(players.id, lives.playerId))
    .innerJoin(servers, eq(servers.id, lives.serverId))
    .where(and(
      isNull(lives.endedAt),
      qualifiedLifeCondition(db),
      gte(lives.playtimeSeconds, opts.minPlaytimeSeconds),
      // A qualified open life with ZERO session rows is not "gone quiet" — it never arrived.
      // The `<=` below would exclude it anyway (NULL comparison), but stating it makes the
      // intent explicit and testable.
      sql`${lastSeen} IS NOT NULL`,
      sql`${eligibleAt} <= ${opts.now}`,     // idle >= N hours as of the reference instant
      sql`${eligibleAt} >= ${opts.since}`,   // forward-only, on the ELIGIBILITY instant
      earnedCoverage,
      suppressed,
      notPublished,
    ))
    // Oldest-idle first: the ~7-subject pool drains in a stable order across ticks.
    .orderBy(sql`${lastSeen} ASC`, asc(players.gamertag))
    .limit(opts.limit);

  return rows.map((r) => ({
    lifeId: r.lifeId, serverId: r.serverId, gamertag: r.gamertag,
    map: r.map, mapSlug: r.mapSlug, lifeNumber: r.lifeNumber,
    lifeStartedAt: r.lifeStartedAt, playtimeSeconds: r.playtimeSeconds,
    lastSeenAt: new Date(r.lastSeenAt as unknown as string),
    eligibleAt: new Date(r.eligibleAt as unknown as string),
    idleSeconds: Math.round(
      (opts.now.getTime() - new Date(r.lastSeenAt as unknown as string).getTime()) / 1000),
    priorLives: Number(r.priorLives), hitsAbsorbed: Number(r.hitsAbsorbed),
    naturalKey: standingDeadNaturalKey(r.serverId, r.gamertag, r.lifeStartedAt),
  }));
}
```

- [ ] **Step 11.4: Green.**
```
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/newsdesk test standing-dead-targets
```
Expected: `8 passed`.

---

## Task 12: Standing Dead earned-coverage clause (`priorLives >= 1 OR hitsAbsorbed >= 100`)

**Files:**
- Modify: `apps/newsdesk/src/standing-dead-targets.ts`
- Test: `apps/newsdesk/test/standing-dead-targets.test.ts` (extend fixture + append a `describe`)

**Interfaces consumed:** `hitEvents` from `@onelife/db`. No signature change.

- [ ] **Step 12.1: Add three fixture subjects** inside the existing `beforeAll`, after the current `seed` calls:

```ts
  // first life, no prior, 5 hits -> FAILS earned coverage (the "low-contact bounce" case)
  await seed("bounce", { playtime: 7200, connectedAt: hrs(98), disconnectedAt: hrs(100), hits: 5 });
  // first life, no prior, exactly 100 hits -> PASSES on the hits arm (inclusive boundary)
  await seed("battered", { playtime: 7200, connectedAt: hrs(98), disconnectedAt: hrs(100), hits: 100 });
  // first life, no prior, 99 hits -> FAILS (one short)
  await seed("bruised", { playtime: 7200, connectedAt: hrs(98), disconnectedAt: hrs(100), hits: 99 });
```

- [ ] **Step 12.2: Append the failing tests** to `standing-dead-targets.test.ts`:

```ts
describe("earned coverage", () => {
  it("admits a subject with a prior life and no hits", async () => {
    expect(await tagsOf()).toContain(tag("veteran"));
  });

  it("rejects a first-life, low-contact bounce — a hard predicate clause, not prompt guidance", async () => {
    expect(await tagsOf()).not.toContain(tag("bounce"));
  });

  it("admits on the hits arm at exactly the threshold and rejects one short", async () => {
    const t = await tagsOf();
    expect(t).toContain(tag("battered"));
    expect(t).not.toContain(tag("bruised"));
  });

  it("reports priorLives and hitsAbsorbed on the target", async () => {
    const rows = await findStandingDeadTargets(db, OPTS);
    const b = rows.find((r) => r.gamertag === tag("battered"))!;
    expect(b.priorLives).toBe(0);
    expect(b.hitsAbsorbed).toBe(100);
    const v = rows.find((r) => r.gamertag === tag("veteran"))!;
    expect(v.priorLives).toBeGreaterThanOrEqual(1);
  });

  it("does not count hits outside the life window", async () => {
    await db.insert(hitEvents).values({
      serverId, victimGamertag: tag("bruised"), attackerGamertag: "before",
      attackerType: "infected", bodyPart: "pre", occurredAt: hrs(0),   // before startedAt (hrs 1)
    });
    expect(await tagsOf()).not.toContain(tag("bruised"));
  });

  it("excludes a suppressed gamertag case-insensitively", async () => {
    expect(await tagsOf({ ...OPTS, suppressedGamertags: [tag("veteran").toUpperCase()] }))
      .not.toContain(tag("veteran"));
  });
});
```

- [ ] **Step 12.3: Run and confirm failure** — `bounce`/`bruised` currently appear because `earnedCoverage` is `TRUE`.
```
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/newsdesk test standing-dead-targets
```

- [ ] **Step 12.4: Replace the placeholder.** In `apps/newsdesk/src/standing-dead-targets.ts`, add `hitEvents` to the `@onelife/db` import and swap `const earnedCoverage = sql\`TRUE\`;` for:

```ts
  // priorLives: any earlier life by the SAME PLAYER on ANY server (players are one global identity
  // per gamertag; lives are per-server). Mirrors getPlayerPriors' `lt(lives.startedAt, before)` —
  // this must agree with `priors.livesLived` in the facts builder.
  // EXISTS, not count(*) >= 1: same result, short-circuits on the first row.
  const priorLifeExists = sql`EXISTS (
    SELECT 1 FROM ${lives} pl
    WHERE pl.player_id = ${lives.playerId}
      AND pl.started_at < ${lives.startedAt}
  )`;

  // hitsAbsorbed: hit_events against this subject inside the life window. Keyed on
  // victim_gamertag, which is NOT NULL and is the leading column of hit_events_natural_uniq, so
  // this is indexed. hit_events.victim_player_id is NULLABLE — joining on it would silently
  // undercount, so it must NOT be used.
  const hitsAbsorbed = sql<number>`(
    SELECT count(*) FROM ${hitEvents} h
    WHERE h.server_id = ${lives.serverId}
      AND h.victim_gamertag = ${players.gamertag}
      AND h.occurred_at >= ${lives.startedAt}
      AND (${lives.endedAt} IS NULL OR h.occurred_at <= ${lives.endedAt})
  )`;

  // The subject has EARNED coverage: they either chose to come back after a previous life, or
  // physically endured something worth reporting. A first-life, zero-kill, low-contact bounce is
  // never a Standing Dead subject (spec §4.1.1). The OR means Postgres may evaluate the count for
  // every row failing priorLifeExists; at this pool size (7 subjects) that is fine — do NOT add
  // an index for it.
  const earnedCoverage = sql`(${priorLifeExists} OR ${hitsAbsorbed} >= ${opts.minHitsAbsorbed})`;
```
Then change the two placeholder select columns to the real expressions:
```ts
      priorLives: sql<number>`(SELECT count(*) FROM ${lives} pl
        WHERE pl.player_id = ${lives.playerId} AND pl.started_at < ${lives.startedAt})`,
      hitsAbsorbed,
```

- [ ] **Step 12.5: Green.**
```
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/newsdesk test standing-dead-targets
```
Expected: `14 passed`.

---

## Task 13: Standing Dead anti-join against published/exhausted articles

**Files:**
- Modify: `apps/newsdesk/src/standing-dead-targets.ts`
- Test: `apps/newsdesk/test/standing-dead-targets.test.ts` (append a `describe`)

**Interfaces consumed:** `articles` from `@onelife/db`. No signature change.

- [ ] **Step 13.1: Append the failing tests:**

```ts
describe("article anti-join", () => {
  const stub = (naturalKey: string, o: { status: string; attempts: number }) => db.insert(articles).values({
    kind: "news", status: o.status, naturalKey, attempts: o.attempts,
    serverId, gamertag: tag("veteran"), map: "sakhal", lifeNumber: 2,
    lifeStartedAt: hrs(1), deathAt: null,            // NULL for Standing Dead (spec §6)
    slug: `sd-${naturalKey.length}-${svc}`, headline: "H", lede: "L", body: "B",
    promptVersion: "news-v1", model: "test",
  });
  const keyFor = async () =>
    (await findStandingDeadTargets(db, OPTS)).find((r) => r.gamertag === tag("veteran"))!.naturalKey;

  it("suppresses a subject whose natural key is already published", async () => {
    const k = await keyFor();
    await stub(k, { status: "published", attempts: 1 });
    expect(await tagsOf()).not.toContain(tag("veteran"));
    await db.delete(articles).where(inArray(articles.naturalKey, [k]));
  });

  it("keeps retrying a failed subject until attempts reach maxAttempts", async () => {
    const k = await keyFor();
    await stub(k, { status: "failed", attempts: 2 });
    expect(await tagsOf()).toContain(tag("veteran"));           // 2 < 3
    await db.update(articles).set({ attempts: 3 }).where(inArray(articles.naturalKey, [k]));
    expect(await tagsOf()).not.toContain(tag("veteran"));       // exhausted
    await db.delete(articles).where(inArray(articles.naturalKey, [k]));
  });

  it("applies the limit AFTER the anti-join so a blocked subject never consumes a slot", async () => {
    const rows = await findStandingDeadTargets(db, OPTS);
    const first = rows[0]!;
    await stub(first.naturalKey, { status: "published", attempts: 1 });
    const capped = await findStandingDeadTargets(db, { ...OPTS, limit: 1 });
    expect(capped.map((r) => r.naturalKey)).not.toContain(first.naturalKey);
    expect(capped).toHaveLength(1);
    await db.delete(articles).where(inArray(articles.naturalKey, [first.naturalKey]));
  });
});
```

- [ ] **Step 13.2: Run and confirm failure.**
```
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/newsdesk test standing-dead-targets
```

- [ ] **Step 13.3: Convert to the two-query shape.** Delete the `notPublished` placeholder and its use in the `and(...)`, and instead over-fetch then filter in TS. Change the `.limit(opts.limit)` on the SQL query to an over-fetch:

```ts
    // Over-fetch: the limit is applied AFTER the article anti-join, so a blocked subject never
    // consumes a slot. The pool is ~7 subjects, so the multiplier is free.
    .limit(opts.limit * 4 + 20);
```
and add the anti-join after the `.map(...)`:
```ts
  const targets = rows.map((r) => ({ /* ...existing mapping, unchanged... */ }));
  if (targets.length === 0) return targets;

  // Two-query anti-join rather than a SQL-computed key. Building the key in SQL would need a
  // to_char() rendering that must match TS toISOString() EXACTLY; any drift makes the anti-join a
  // silent no-op and every tick re-publishes the same subject as a new row — and the rows would
  // not even collide on articles_natural_key_uniq, because the WRITTEN key comes from TS while the
  // ANTI-JOINED key came from SQL. Doing it here makes toISOString() the sole producer of every key.
  const blocked = await db
    .select({ k: articles.naturalKey })
    .from(articles)
    .where(and(
      inArray(articles.naturalKey, targets.map((t) => t.naturalKey)),
      sql`(${articles.status} = 'published' OR ${articles.attempts} >= ${opts.maxAttempts})`,
    ));
  const blockedSet = new Set(blocked.map((r) => r.k!));
  return targets.filter((t) => !blockedSet.has(t.naturalKey)).slice(0, opts.limit);
```
Add `articles` to the `@onelife/db` import and `inArray` to the `drizzle-orm` import.

- [ ] **Step 13.4: Green, then typecheck.**
```
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/newsdesk test standing-dead-targets
pnpm --filter @onelife/newsdesk typecheck
```
Expected: `17 passed`, typecheck clean.

---

## Task 14: Barrel module, funnel sanity check + coordinate rail, and a package sweep

**Files:**
- Create: `apps/newsdesk/src/news-targets.ts`
- Test: `apps/newsdesk/test/standing-dead-targets.test.ts` (append), `apps/newsdesk/test/long-form-targets.test.ts` (append)

**Interfaces produced:** a single import surface for PR-C2. Everything else in this task is assertions that pin §4.1.2's funnel shape and §11's coordinate rail against the real predicate stack.

- [ ] **Step 14.1: Create the barrel.** Two targeting modules with two different filenames is one import site too many for `newsTick`, and it is the seam where a wrong module name would surface as a C2 compile error. Create `apps/newsdesk/src/news-targets.ts` containing exactly:

```ts
// One import surface for the R5d news triggers. newsTick (PR-C2) imports from HERE, never from
// the two implementation files — the split between `standing-dead-targets.ts` and
// `long-form-targets.ts` is an implementation detail of this slice.
export * from "./standing-dead-targets.js";
export * from "./long-form-targets.js";
```

- [ ] **Step 14.2: Pin the barrel with a smoke assertion.** Append to `apps/newsdesk/test/long-form-targets.test.ts`:

```ts
it("re-exports both finders through the news-targets barrel", async () => {
  const barrel = await import("../src/news-targets.js");
  expect(typeof barrel.findStandingDeadTargets).toBe("function");
  expect(typeof barrel.findLongFormTargets).toBe("function");
  expect(typeof barrel.findLongFormCandidates).toBe("function");
  expect(typeof barrel.standingDeadNaturalKey).toBe("function");
});
```

- [ ] **Step 14.3: Append the funnel narrowing test** to `standing-dead-targets.test.ts`. It asserts each successive gate strictly narrows, which is the property the §4.1.2 table (110 → 78 → 29 → 15 → 7) encodes:

```ts
describe("population funnel (§4.1.2 shape)", () => {
  it("each successive gate is a strict subset of the looser one", async () => {
    const loose = { ...OPTS, minPlaytimeSeconds: 0, minHitsAbsorbed: 0, standingDeadHours: 0 };
    const setOf = async (o: typeof OPTS) =>
      new Set((await findStandingDeadTargets(db, { ...o, limit: 500 }))
        .filter((r) => r.gamertag.endsWith(`-${svc}`)).map((r) => r.gamertag));

    const all = await setOf(loose);
    const idle = await setOf({ ...loose, standingDeadHours: 72 });
    const played = await setOf({ ...loose, standingDeadHours: 72, minPlaytimeSeconds: 1800 });
    const earned = await setOf(OPTS);

    for (const g of idle) expect(all.has(g)).toBe(true);
    for (const g of played) expect(idle.has(g)).toBe(true);
    for (const g of earned) expect(played.has(g)).toBe(true);
    expect(earned.size).toBeLessThan(played.size);   // the earned-coverage clause bites
  });

  it("returns no coordinate-shaped number — a Standing Dead target carries no fix at all", async () => {
    const rows = await findStandingDeadTargets(db, OPTS);
    expect(JSON.stringify(rows)).not.toMatch(/\d{4}\.\d/);
    expect(Object.keys(rows[0] ?? {})).not.toContain("x");
    expect(Object.keys(rows[0] ?? {})).not.toContain("y");
  });
});
```

- [ ] **Step 14.4: Append the exported-type coordinate rail** to `long-form-targets.test.ts`, asserting the type split holds at runtime as well as at compile time:

```ts
it("the exported target type carries no x/y even though DeathCandidate does", async () => {
  const cands = await findLongFormCandidates(db, OPTS);
  expect(cands.some((c) => typeof c.x === "number")).toBe(true);   // source rows DO have coords
  const r = await findLongFormTargets(db, T_OPTS);
  for (const c of mineC(r)) for (const s of c.subjects) {
    expect(Object.keys(s)).not.toContain("x");
    expect(Object.keys(s)).not.toContain("y");
    expect(Object.keys(s)).not.toContain("fixAt");
  }
});
```

- [ ] **Step 14.5: Run every newsdesk suite plus typecheck.**
```
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm --filter @onelife/newsdesk test
pnpm --filter @onelife/newsdesk typecheck
```
Expected: every pre-existing newsdesk suite still green, plus the four new files (`long-form-cluster`, `long-form-targets`, `standing-dead-key`, `standing-dead-targets`) and the two image suites extended in Tasks 1–5.

---

## Task 15: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

The repo workflow requires a CHANGELOG update on **every** PR. Be honest about what this one is: groundwork with no user-visible effect.

- [ ] **Step 15.1: Add the entry.** Under `## [Unreleased]` → `### Added`, insert:

```markdown
- R5d news engine, **inert**: the two news trigger read-models and the article-image prerequisites,
  with no caller and no production effect. `apps/newsdesk/src/standing-dead-targets.ts` finds
  qualified open lives whose player has gone quiet for 72h and has *earned* coverage (a prior life
  or >= 100 absorbed hits); `apps/newsdesk/src/long-form-targets.ts` +
  `long-form-cluster.ts` find cliques of qualified deaths inside a shared time window and radius,
  with four named exclusions (self-cluster, any suicide subject, unqualified subject, suppressed
  gamertag) and per-reason skip counts. Both key their targets on a rebuild-stable `natural_key`
  built only by `toISOString()` — never a projection row id, and never rendered in SQL — and
  anti-join against `articles` in TypeScript so the written key and the anti-joined key are the
  same string by construction. Neither carries coordinates off the boundary (spec §11); a
  `news-targets.ts` barrel is the single import surface for the worker pass that follows.
- `NEWSROOM_CATEGORIES` — a 13-entry image-framing menu for the news vertical, weighted to absence
  and vacancy because a Standing Dead subject is alive and non-consenting.
```

Under `### Changed`, insert:

```markdown
- `ArticleKind` widens to three members (`obituary | birth_notice | news`), and the two binary
  ternaries that keyed off it — `eligibleCategories`' menu choice and `buildScenePrompt`'s kind
  label — become `Record` lookups with explicit runtime guards. The old ternaries handed *every*
  non-obituary kind the Nursery menu and the "birth notice" label. `ImageTarget["kind"]` is retyped
  to `ArticleKind`, so `findImageTargets`' `r.kind as ImageTarget["kind"]` cast stops contradicting
  the query it sits under. `buildScenePrompt` also gains a news tone arm, an explicit
  alive-subject rail, and a dedicated line when the stated death cause is low confidence.
  **No production behaviour changes:** `findImageTargets` still excludes both shipped kinds and no
  `kind='news'` row exists, so every one of these paths is unreachable until the news worker pass
  lands. Normal deploy, no `--rebuild`, no migration.
```

---

## Task 16: CLAUDE.md update

**Files:**
- Modify: `CLAUDE.md`

The repo guard hook blocks `gh pr create` unless `CLAUDE.md` is modified. Per the project workflow this is the **last step before opening the PR**.

- [ ] **Step 16.1: Extend the Tabloid redesign section.** In `CLAUDE.md`, anchor on the sentence ending `with **R5d** (News feed + news-led home) next.` in the Tabloid redesign bullet and append immediately after it:

```markdown
  **R5d in flight, PR-C1 (inert engine) shipped.** The news vertical's targeting layer and image
  prerequisites exist but **nothing calls them** — production output is byte-identical. Two trigger
  read-models live in `apps/newsdesk/src`, behind one barrel `news-targets.ts`: **Standing Dead**
  (`standing-dead-targets.ts` — a qualified *open* life whose player has been idle 72h, measured by
  `MAX(COALESCE(sessions.disconnected_at, sessions.connected_at))` so the crash-and-never-returned
  case is caught, gated on **earned coverage**: a prior life OR >= 100 absorbed `hit_events`) and
  **The Long Form** (`long-form-targets.ts` + the pure `long-form-cluster.ts` — a *clique*, never a
  chain: a death joins only if it is inside both the time window and the radius of **every** current
  member, with inclusive boundaries; four named exclusions with per-reason counts). Two rails are
  structural, not stylistic: **`natural_key` is produced only by `toISOString()` in TypeScript** and
  the article anti-join is a **second TS-side query**, never a SQL-rendered key — a `to_char()` that
  drifted from JS would make the anti-join a silent no-op and re-publish the same subject forever;
  and **no coordinate ever crosses the boundary** — `DeathCandidate` carries `x`/`y` internally,
  `LongFormSubject` and `StandingDeadTarget` do not (spec §11, asserted at runtime). The Long Form
  candidate query is a raw `db.execute(sql\`…\`)` because `JOIN LATERAL … ON TRUE` cannot be
  expressed through drizzle's `innerJoin`. Alongside it, `ArticleKind` is now a **three**-member
  union and the two binary ternaries that keyed off it (`eligibleCategories`, `buildScenePrompt`'s
  label) are guarded `Record` lookups — the old ternaries gave every non-obituary kind the Nursery
  menu and the "birth notice" label. `NEWSROOM_CATEGORIES` (13 entries) is the news image menu,
  weighted to **absence and vacancy** because a Standing Dead subject is **alive and
  non-consenting** — no framing may imply a death, a fix, a route, or a recognisable locale.
  Inertness is guaranteed by `findImageTargets`' `notInArray(articles.kind, ["obituary",
  "birth_notice"])` plus the fact that nothing writes a `kind='news'` row yet — asserted directly
  in `image-pg-store.test.ts`. PR-C2 (`newsTick`, shipped OFF) and PR-C3 (API + web) follow.
```

- [ ] **Step 16.2: Verify the file changed** so the guard hook is satisfied:
```
git diff --stat CLAUDE.md CHANGELOG.md
```
Expect both files listed with a non-zero insertion count.

---

## Task 17: Final full-repo verification

**Files:** none — verification only.

- [ ] **Step 17.1: Full-repo test sweep with the cache defeated.** Turbo's cache key omits `TEST_DATABASE_URL`, so a cached pass is not evidence and `--force` is mandatory:
```
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm turbo run test --concurrency=1 --force
```
Expect every package green. Never `-- run`.

- [ ] **Step 17.2: Full-repo typecheck.**
```
pnpm turbo run typecheck --concurrency=1
```
Expect clean.

- [ ] **Step 17.3: Prove the inertness claim from the diff itself.** Confirm the PR touches no runtime entrypoint and no consumer:
```
git diff --name-only origin/develop...HEAD
```
Expect **only**: `apps/newsdesk/src/{image-categories,image-pg-store,image-scene,long-form-cluster,long-form-targets,news-targets,standing-dead-targets}.ts`,
`apps/newsdesk/test/{image-categories,image-pg-store,image-scene,long-form-cluster,long-form-targets,standing-dead-key,standing-dead-targets}.test.ts`,
`CHANGELOG.md`, `CLAUDE.md`, and this plan file.
If `apps/newsdesk/src/main.ts`, `image-tick.ts`, `config.ts`, `pg-store.ts`, `birth-pg-store.ts`, anything under `apps/api`, or anything under `apps/web` appears in that list, **stop** — C2/C3 material has leaked into this PR.

- [ ] **Step 17.4: Confirm no `kind='news'` writer exists.** The inertness guarantee is that nothing writes the third kind:
```
grep -rn "\"news\"\|'news'" apps/newsdesk/src --include="*.ts" | grep -v "image-categories.ts\|image-scene.ts"
```
Expect no `insert`/`values` hit — only type-level and test-fixture occurrences.

- [ ] **Step 17.5: Open the PR** into `develop` from the `feature/*` branch, per the repo workflow (`finishing-a-feature`). In the PR body, state the inertness claim explicitly and link Step 17.3's file list as its evidence.

---

## Forward notes

Findings from the reviewer's list that concern PR-C2 or PR-C3 material. **They are recorded here so
they are not lost — none of them is actionable inside C1.**

### For PR-C2 (`newsTick`, shipped OFF)

1. **BLOCKER — the seven threshold config vars do not exist yet.** `apps/newsdesk/src/config.ts`
   today has **no** `NEWSDESK_STANDING_DEAD_*`, `NEWSDESK_LONGFORM_*`, or
   `NEWSDESK_NEWS_SUPPRESSED_GAMERTAGS`. C1 deliberately does not add them: every C1 read-model
   takes its thresholds as explicit `opts`, so it neither reads nor needs `cfg`. *(Note: the PR-C
   scope decision listed "Threshold config" under C1. That placement is wrong — with no C1 consumer,
   adding config there would ship seven unread env vars. It belongs with its first caller.)*
   C2's config task must add **all seven** alongside `newsEnabled`/`newsSince`/`newsMaxPerTick`:
   `NEWSDESK_STANDING_DEAD_HOURS` (72), `NEWSDESK_STANDING_DEAD_MIN_PLAYTIME_SECONDS` (1800),
   `NEWSDESK_STANDING_DEAD_MIN_HITS` (100 — this one has **no** env var anywhere today, only a
   hardcoded `minHitsAbsorbed`), `NEWSDESK_LONGFORM_WINDOW_SECONDS` (180),
   `NEWSDESK_LONGFORM_RADIUS_METERS` (100), `NEWSDESK_LONGFORM_MAX_FIX_AGE_SECONDS` (120), and
   `NEWSDESK_NEWS_SUPPRESSED_GAMERTAGS: z.string().default("")` parsed through a `parseList` helper
   (`raw.split(",").map((s) => s.trim()).filter(Boolean)`). Test the list parse (empty string → `[]`)
   and each default. Also generalise `parseBirthSince` → `parseSince`.
2. **BLOCKER — the Long Form call site must pass nine options.** `LongFormTargetOpts` requires
   `since`, `now`, `maxFixAgeSeconds`, `suppressedGamertags`, `candidateLimit`, `windowSeconds`,
   `radiusMeters`, `maxAttempts`, `limit`. The C2 draft passed only seven, omitting `now` and
   `candidateLimit`. C1 keeps all nine required (the interface carries a comment saying so) and the
   test fixtures pass `candidateLimit: 200`, so the omission is a compile error rather than a
   silent default. Add `candidateLimit` to `NewsTickDeps` (recommend 200) and pass `now: deps.now`.
3. **BLOCKER — module naming.** Import from `./news-targets.js` (the barrel created in Task 14),
   and call `findLongFormTargets` — **not** `findLongFormClusters`, which is not a function that
   exists. The pure builder is `buildLongFormClusters(candidates, opts)` and is an implementation
   detail behind `findLongFormTargets`.
4. **HIGH — the §13.4 brand blocker must be Step 0, before any other C2 work.** The two brand
   tone-map rows (*Standing Dead — elegiac, baffled, warm*; *The Long Form — reverent when fresh,
   prosecutorial only when geared*) do not exist in `../brand/brand-bible.md`; line 128 only states
   the open-ended rule. Run `grep -n "Standing Dead\|Long Form" ../brand/brand-bible.md` first; if
   empty, stop and request the rows from the owner. Do not author `news-voice.ts` without them
   (brand repo first, then re-vendor). C1 and C3 are unblocked and can proceed in parallel.
5. **HIGH — several C2 steps were sketched in prose rather than written as code** and must be
   written out in full before execution: the tick test with a fake store injected via module mock;
   the tick's "identical generate → dedupe → compose → publish" comment placeholder; the five news
   store tests (which need a real `beforeAll` — server + player + life + a `NewsArticleDraft`
   literal + three `NewsPublishTarget` literals, and an obituary-coexistence case calling
   `publishObituary` with its real signature from `apps/newsdesk/src/pg-store.ts`); the retraction
   assertions; and the `sdFacts`/`lfFacts` fixtures used throughout the facts tests but never
   constructed.
6. **MEDIUM — the facts-key vocabulary is now pinned by C1.** `NEWSROOM_CATEGORIES`' contract
   comment names `timeAliveSeconds` and `lastExpressiveEmote` — **not** `playtimeSeconds`, **not**
   `lastEmote`. The facts builders must emit those exact key names. Note also that
   `StandingDeadTarget` deliberately carries **no** emote field (see the note on Task 10): the facts
   builder sources the allowlisted emote itself, with `EmoteSuicide` hard-excluded and `EmoteSitA`
   treated as absence.
7. **Duplication to avoid.** The earlier draft had two separate `.env.example` tasks and three
   writes to CHANGELOG/CLAUDE.md across the C2/C3 groups. Keep exactly one `.env.example` task
   (which must include the `LONGFORM_*` vars and `STANDING_DEAD_MIN_HITS`) and one CHANGELOG/
   CLAUDE.md pair per PR.
8. **Retraction + images already interlock.** Task 5 of this plan asserts that `findImageTargets`
   excludes a `status='retracted'` row, so a de-published article can never acquire a photo. C2's
   retraction sweep inherits that guarantee and need not re-derive it.

### For PR-C3 (API + web)

9. **`newsShowingLine` argument order is a live spec/brief conflict.** Spec §9 says to follow the
   *birth* signature — `(page, total, pageSize)`; the api-web brief recommends the *obituary* order
   `(page, pageSize, total)`. All three params are `number`, so a wrong choice is type-silent and
   renders garbage. The spec is authority: use birth order and pin it with a literal-string test
   written first. Flag the underlying inconsistency in the PR body; unifying the two is out of scope.
10. **`ArticleHero`'s `accent` is a closed `"red" | "blue"` union** and the component has never
    rendered in production. If news takes a third accent, widen it to the `Kicker` colors-map
    pattern rather than adding a third ternary arm — that is precisely the defect class C1 fixed in
    `eligibleCategories` and `buildScenePrompt`. Also verify the `/media/:path*` rewrite and
    `GET /media/heroes/:file` actually resolve before wiring a hero; R5c's serving path is
    unvalidated.
11. **Read-model naming.** Keep `getNewsArticleBySlug` (it disambiguates from the `NewsArticle`
    DTO) and correct the CLAUDE.md paragraph, which elsewhere says `getNewsBySlug`. Import
    `ArticleBlock` from `obituary-articles.js` — never redeclare it.
12. **Roadmap correction owed.** C3's CLAUDE.md update must record that the news-led home page
    moved to follow-ups (spec §3), and retire the News teaser plus `components/teaser-page.tsx`
    (News is its last caller).
