# Obituaries: Drop Base-Building + Nav Link — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all base-building content from generated obituaries, and give `/obituaries` a link in the site navigation.

**Architecture:** Building enters obituaries two ways and both close independently — the `buildsPlaced` fact fed to the prompt (removed at the type level so it cannot be reintroduced by accident), and the model's own unprompted use of construction words (caught by the existing validator, whose banned vocabulary gains construction terms). The web half adds a fifth nav item and reallocates one mobile tab.

**Tech Stack:** TypeScript ESM, vitest, Next.js 15 App Router, pnpm workspaces + turbo.

**Spec:** `docs/superpowers/specs/2026-07-28-obituaries-drop-building-nav-design.md`

## Global Constraints

- Worktree: `~/worktrees/obituaries-drop-building-nav`, branch `feature/obituaries-drop-building-nav`. **Never run git commands in `/var/www/dayzonelife.com`** — that is the live prod checkout and a `git checkout` there silently no-ops the next deploy.
- Tab-bar label is **`Obits`**; desktop nav and footer label is **`Obituaries`**. The route is `/obituaries`.
- The mobile tab bar stays at **five tabs** in both signed-in and signed-out states.
- `NEWSDESK_MAX_ATTEMPTS` is 3: an over-broad banned word costs a retry then a permanent failure stub. Add only the terms listed in Task 2.
- Every banned term is matched with `(?<![a-z0-9])term(?![a-z0-9])`, so **singular and plural must both be listed** (`wall` does not match `walls`).
- keel requires a committed `CHANGELOG.md` Unreleased entry before the PR (Task 6).
- Run tests from the worktree root with `pnpm --filter <pkg> run test`.

---

### Task 1: Remove the build fact from obituary facts and prompt

**Files:**
- Modify: `apps/newsdesk/src/facts.ts:34` (type), `apps/newsdesk/src/facts.ts:131` (construction)
- Modify: `apps/newsdesk/src/prompt.ts:103`
- Test: `apps/newsdesk/test/prompt.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ObituaryFacts["ordeals"]` is now `{ infected: OrdealSummary; fire: OrdealSummary; pvp: OrdealSummary } | null` — Task 2 and Task 3 do not touch it, but any later edit must not re-add `buildsPlaced`.

- [ ] **Step 1: Write the failing test**

Add to `apps/newsdesk/test/prompt.test.ts`:

The file already has a `mkFacts(overrides)` helper over a shared `facts` fixture — use it:

```typescript
it("never mentions building, even when the life placed structures", () => {
  const { user } = buildObituaryPrompt(mkFacts({
    ordeals: {
      infected: { encounters: 1, hits: 2, worstEncounterHits: 2 },
      fire: { encounters: 0, hits: 0, worstEncounterHits: 0 },
      pvp: { encounters: 0, hits: 0, worstEncounterHits: 0 },
    },
  }));
  expect(user).not.toMatch(/built|building|structure/i);
});
```

Note: the existing test at line 38 constructs `ordeals` with `buildsPlaced: 0`. Remove that property there too — it is no longer part of the type and will fail typecheck.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/newsdesk run test -- prompt`
Expected: FAIL — either a type error on the missing `buildsPlaced`, or the assertion failing because the prompt still contains "Things built this life".

- [ ] **Step 3: Make the change**

In `apps/newsdesk/src/facts.ts:34`, drop `buildsPlaced` from the ordeals type:

```typescript
  ordeals: { infected: OrdealSummary; fire: OrdealSummary; pvp: OrdealSummary } | null;
```

In `apps/newsdesk/src/facts.ts`, the construction at line 131 currently spreads the read-model value straight through (`ordeals: timeline.ordeals ?? null`). The read-model still carries `buildsPlaced`, so project the three kept fields explicitly:

```typescript
    // buildsPlaced is deliberately NOT carried across: base-building is not obituary material,
    // and omitting it at the type level means a later edit cannot print it by accident.
    ordeals: timeline.ordeals
      ? { infected: timeline.ordeals.infected, fire: timeline.ordeals.fire, pvp: timeline.ordeals.pvp }
      : null,
```

In `apps/newsdesk/src/prompt.ts`, delete line 103 entirely:

```typescript
    if (o.buildsPlaced > 0) lines.push(`- Things built this life: ${o.buildsPlaced}`);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/newsdesk run test`
Expected: PASS, whole suite. Then `pnpm --filter @onelife/newsdesk run typecheck` — expected clean.

- [ ] **Step 5: Commit**

```bash
git add apps/newsdesk/src/facts.ts apps/newsdesk/src/prompt.ts apps/newsdesk/test/prompt.test.ts
git commit -m "fix(newsdesk): stop feeding base-building counts into obituaries"
```

---

### Task 2: Ban construction vocabulary in the validator

**Files:**
- Modify: `apps/newsdesk/src/no-place.ts` (the `STRUCTURE_TERRAIN` list)
- Modify: `apps/newsdesk/src/generate.ts:37` (the retry feedback string)
- Test: `apps/newsdesk/test/no-place.test.ts`, `apps/newsdesk/test/generate.test.ts`

**Interfaces:**
- Consumes: `findPlaceViolations(obituary, { exempt })` from `no-place.ts` — unchanged signature.
- Produces: no signature change. The banned list grows; the retry feedback wording changes.

- [ ] **Step 1: Write the failing tests**

Add to `apps/newsdesk/test/no-place.test.ts`:

```typescript
it("catches generic construction words the type list misses", () => {
  const dirty = { ...clean, body: "A structure raised with what little time remained." };
  expect(findPlaceViolations(dirty, { exempt: [] })).toEqual(["structure"]);
});

it("catches the verb forms, singular and plural", () => {
  const built = { ...clean, body: "He built walls faster than he used them." };
  expect(findPlaceViolations(built, { exempt: [] }).sort()).toEqual(["built", "walls"]);
  const many = { ...clean, lede: "Ninety-five structures went up." };
  expect(findPlaceViolations(many, { exempt: [] })).toEqual(["structures"]);
});

it("still exempts a gamertag that contains a construction word", () => {
  const dirty = { ...clean, body: "WallBuilder99 died alone." };
  expect(findPlaceViolations(dirty, { exempt: ["WallBuilder99"] })).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @onelife/newsdesk run test -- no-place`
Expected: FAIL — `[]` received where `["structure"]` expected, because the generic words are not banned yet.

- [ ] **Step 3: Add the vocabulary**

In `apps/newsdesk/src/no-place.ts`, extend `STRUCTURE_TERRAIN` with a clearly-commented block. Put it directly under the `// structures` group:

```typescript
  // player-built construction — base-building is not obituary material (2026-07-28). These are
  // GENERIC terms the type list above misses: an obituary said "a structure raised" and passed,
  // and another said "No structure was cleared" with no build fact in play at all.
  // ⚠️ Singular AND plural are both required — the matcher is (?<![a-z0-9])term(?![a-z0-9]),
  // so "wall" does not match "walls".
  // ⚠️ "built"/"building" also catch figurative use ("built a reputation"). That costs one retry
  // and, at NEWSDESK_MAX_ATTEMPTS, a failure stub. Accepted deliberately; if failures climb,
  // narrow to the nouns and drop these two.
  "structure", "structures", "tent", "tents", "shelter", "shelters",
  "fence", "fences", "wall", "walls", "built", "building", "buildings",
```

- [ ] **Step 4: Fix the retry feedback wording**

In `apps/newsdesk/src/generate.ts:37`, the message claims a no-place violation for every term. That is now wrong for `built`, and the feedback string is what steers the retry:

```typescript
    `Your previous draft was rejected: it used banned subject matter — ${violations.join(", ")}. Locations and player-built construction are both off-limits.`,
```

Update the line below it the same way, replacing "Rewrite the obituary with ZERO spatial or setting references — the map name is the only place you may use." with:

```typescript
    `Rewrite with ZERO spatial or setting references and no mention of building or structures — the map name is the only place you may use. Respond with only the JSON object.`,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @onelife/newsdesk run test`
Expected: PASS, whole suite. If `generate.test.ts` asserts on the old feedback wording, update that assertion to match the new string — do not revert the wording.

- [ ] **Step 6: Commit**

```bash
git add apps/newsdesk/src/no-place.ts apps/newsdesk/src/generate.ts apps/newsdesk/test/
git commit -m "fix(newsdesk): reject construction words in obituary prose"
```

---

### Task 3: State the rule in the system prompt

**Files:**
- Modify: `apps/newsdesk/src/voice.ts` (the HARD BANS block, after the NO-PLACE RULE line)
- Test: `apps/newsdesk/test/voice.test.ts`

**Interfaces:**
- Consumes: `OBITUARY_SYSTEM` string export from `voice.ts`.
- Produces: no signature change.

- [ ] **Step 1: Write the failing test**

Add to `apps/newsdesk/test/voice.test.ts`:

```typescript
describe("the no-building rule is stated in the prompt, not only enforced", () => {
  it("OBITUARY_SYSTEM forbids construction", () => {
    expect(OBITUARY_SYSTEM.toLowerCase()).toContain("no-build");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/newsdesk run test -- voice`
Expected: FAIL — the string is absent.

- [ ] **Step 3: Add the rule**

In `apps/newsdesk/src/voice.ts`, add immediately after the `THE NO-PLACE RULE:` line in HARD BANS:

```
- THE NO-BUILD RULE: base-building is never obituary material. Never mention structures, walls, fences, tents, shelters, or anything the deceased built or placed — not as a statistic, not as scenery, not as a closing image. The record of what someone constructed is inventory, not a life.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/newsdesk run test`
Expected: PASS, whole suite — including the existing seeded-attribution guard, which the new line does not affect.

- [ ] **Step 5: Commit**

```bash
git add apps/newsdesk/src/voice.ts apps/newsdesk/test/voice.test.ts
git commit -m "feat(newsdesk): state the no-build rule in the obituary system prompt"
```

---

### Task 4: Add Obituaries to the desktop nav

**Files:**
- Modify: `apps/web/src/lib/nav.ts`
- Test: `apps/web/src/lib/nav.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `NavKey` union gains `"obituaries"`. `NAV_ITEMS` is five entries in order: `home`, `maps`, `leaderboard`, `obituaries`, `about`.

- [ ] **Step 1: Update the existing test and add new cases**

In `apps/web/src/lib/nav.test.ts`, the first test asserts exactly four sections. Change it to five, in order:

```typescript
  it("lists exactly the five sections in order", () => {
    expect(NAV_ITEMS.map((i) => i.key)).toEqual(["home", "maps", "leaderboard", "obituaries", "about"]);
  });

  it("Obituaries points at the public feed", () => {
    const item = NAV_ITEMS.find((i) => i.key === "obituaries");
    expect(item?.href).toBe("/obituaries");
    expect(item?.label).toBe("Obituaries");
  });
```

Add to the `activeNavKey` `it.each` table:

```typescript
    ["/obituaries", "obituaries"],
    ["/obituaries/a-long-walk-ends-grumpy8269-1-3", "obituaries"],
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/web run test -- nav`
Expected: FAIL — four keys received where five expected, and `activeNavKey("/obituaries")` returns `null`.

- [ ] **Step 3: Add the nav item**

In `apps/web/src/lib/nav.ts`, insert between the `leaderboard` and `about` entries:

```typescript
  { key: "obituaries", href: "/obituaries", label: "Obituaries" },
```

And in `activeNavKey`, add before the `about` branch:

```typescript
  if (inSection(pathname, "/obituaries")) return "obituaries";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/web run test -- nav`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/nav.ts apps/web/src/lib/nav.test.ts
git commit -m "feat(web): add Obituaries to the primary nav"
```

---

### Task 5: Reallocate the mobile tab and add the footer link

**Files:**
- Modify: `apps/web/src/components/shell/tab-bar.tsx:19-20`
- Modify: `apps/web/src/components/footer.tsx`
- Test: `apps/web/src/components/shell/tab-bar.test.tsx`, `apps/web/src/components/footer.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks (the tab bar has its own `Tab[]` lists; it does not read `NAV_ITEMS`).
- Produces: no exported signature change.

- [ ] **Step 1: Update the tab-bar tests**

In `apps/web/src/components/shell/tab-bar.test.tsx`, replace the three affected tests:

```typescript
  test("signed in: five destinations, Obituaries in place of You", () => {
    status("verified");
    render(<TabBar />);
    for (const name of ["Home", "Map", "Survivors", "Friends", "Obits"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    // /you is still reachable — AccountAffordance in the masthead has no width gate.
    expect(screen.queryByRole("link", { name: "You" })).toBeNull();
  });

  test("signed in but unlinked still gets the full set", () => {
    status("unlinked");
    render(<TabBar />);
    expect(screen.getByRole("link", { name: "Friends" })).toBeInTheDocument();
  });

  test("signed out: five, with Sign in replacing Friends", () => {
    status("signedOut");
    render(<TabBar />);
    for (const name of ["Home", "Map", "Survivors", "Obits", "Sign in"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("link", { name: "Friends" })).toBeNull();
  });
```

Add to `apps/web/src/components/footer.test.tsx`. That file uses bare top-level `it(...)` with a
`render(<Footer />)` inside each test — there is no shared `screen` or `describe` wrapper, so match
that shape exactly:

```typescript
it("links to the obituaries feed", () => {
  render(<Footer />);
  expect(screen.getByRole("link", { name: "Obituaries" })).toHaveAttribute("href", "/obituaries");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @onelife/web run test -- tab-bar footer`
Expected: FAIL — no link named "Obits", and no footer link named "Obituaries".

- [ ] **Step 3: Make the changes**

In `apps/web/src/components/shell/tab-bar.tsx`, replace lines 19-20:

```typescript
// "Obits" not "Obituaries": the bar is five fixed-width columns at 320px and the long form does
// not fit — the same short-form split the nav already uses for Maps/Map.
const OBITS: Tab = { href: "/obituaries", label: "Obits", icon: "▧" };

// You is deliberately absent: /you stays reachable at every width via AccountAffordance in the
// masthead (no width gate, unlike the nav beside it), so the tab is free for a public surface.
const SIGNED_IN: Tab[] = [...COMMON, { href: "/friends", label: "Friends", icon: "◍" }, OBITS];
const SIGNED_OUT: Tab[] = [...COMMON, OBITS, { href: "/login", label: "Sign in", icon: "◉" }];
```

Also update the component's doc comment, which currently says the bar is "the five things a player does often — which is why Friends and You appear here": replace `Friends and You` with `Friends and Obituaries`.

In `apps/web/src/components/footer.tsx`, add an Obituaries link beside the existing About link, matching its classes exactly:

```tsx
      <Link href="/obituaries" className="underline decoration-dark-line underline-offset-4 hover:text-red">
        Obituaries
      </Link>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/web run test`
Expected: PASS, whole web suite. A failure in `header.test.tsx` means the nav count is asserted there too — update it to five rather than reverting Task 4.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/shell/tab-bar.tsx apps/web/src/components/footer.tsx apps/web/src/components/shell/tab-bar.test.tsx apps/web/src/components/footer.test.tsx
git commit -m "feat(web): put Obituaries in the mobile tab bar and footer"
```

---

### Task 6: Changelog and full-suite verification

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: the keel changelog gate's required Unreleased entry.

- [ ] **Step 1: Run the full suite**

Run: `pnpm turbo run test --concurrency=1` then `pnpm turbo run typecheck`
Expected: PASS both. Do not proceed with failures — record the actual output.

- [ ] **Step 2: Add the changelog entry**

Under `## [Unreleased]` in `CHANGELOG.md`, matching the file's existing subsection style:

```markdown
### Added
- Obituaries are reachable from the site: a primary-nav item, a mobile tab (replacing You, which
  stays reachable from the masthead avatar), and a footer link.

### Changed
- Obituaries no longer mention base-building. The `buildsPlaced` fact is removed from the obituary
  facts entirely, and `structure`/`built`/`wall`/`tent`/`shelter`/`fence` join the validator's
  banned vocabulary so the model cannot reintroduce it unprompted.
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for obituary no-build rule and nav link"
```

---

## Post-merge operator steps (NOT part of the PR)

These run on the prod host after the release deploys. **Order is load-bearing** — clearing before
the new code ships would regenerate all 69 obituaries under the old rules.

1. Deploy: `./deploy/deploy.sh` (**no `--rebuild`** — no migration, no projection-shape change).
2. Set `NEWSDESK_SINCE=2026-07-01T00:00:00Z` in `/var/www/dayzonelife.com/.env` (before the earliest qualified death, 2026-07-11).
3. `psql "$DATABASE_URL" -c "DELETE FROM articles;"` — `articles` is durable and absent from `REBUILD_TRUNCATE_TABLES`; this is a deliberate one-off.
4. `sudo systemctl restart onelife-newsdesk`.
5. Watch: 69 targets at `NEWSDESK_BATCH_CAP=10` per 300s ≈ 7 ticks ≈ 35 minutes. Raising the cap shortens it.
6. **Canary:** watch `failed` in the tick lines. A climbing count means `built`/`building` are rejecting figurative prose — narrow the Task 2 list to the nouns and ship a follow-up.
