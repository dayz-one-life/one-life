# Contrast & Type Floors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the site's two systemic UX-review findings — small-red-text contrast and sub-floor type — plus the mechanical CLS/polish batch, with both policies documented at the tokens.

**Architecture:** Pure class/attribute sweeps guided by two written policies (red-deep for small text; three-tier type floors). No behavior changes; tests pin the policy-bearing components and a floor-guard test trips on regression.

**Tech Stack:** Next.js + Tailwind (RGB-triple tokens), RTL + vitest.

**Spec:** `docs/superpowers/specs/2026-07-20-contrast-type-floors-design.md`

## Global Constraints

- `apps/web` only; classes/attributes/comments — zero behavior changes.
- Red policy: plain `text-red` only for ≥19px-bold display text; all smaller red text → `text-red-deep`. Red **borders/tints/stamp-borders stay `red`** (non-text accents).
- Type floors: reading prose ≥16px; functional content ≥11px; decorative chrome may stay 10px (do NOT flatten all sub-12px text — only the named files).
- Tests: `pnpm --filter @onelife/web run test`; update pinned classes at same assertion strength.
- Branch: `feature/contrast-type-floors` (created; spec committed at b1e2d77).

---

### Task 1: Red policy — token doc + small-text sweep

**Files:**
- Modify: `apps/web/src/app/globals.css` (policy comment at the red tokens)
- Modify: `apps/web/src/components/tabloid/kicker.tsx:4`
- Modify: `apps/web/src/app/about/page.tsx:110`
- Modify: `apps/web/src/components/player/past-life-card.tsx:20,23`
- Modify: `apps/web/src/components/player/standing-card.tsx:60`
- Modify: `apps/web/src/components/player/player-hero.tsx:25`
- Modify: `apps/web/src/components/obituaries/obituary-article.tsx:27`
- Modify: `apps/web/src/components/news/news-article.tsx:72`, `apps/web/src/components/news/news-status-line.tsx:32`
- Modify: `apps/web/src/components/news/editorial-article.tsx` (both banner `<p>`s, ~lines 35 & 40)
- Modify: `apps/web/src/components/survivors/survivor-controls.tsx:51`
- Test: `apps/web/src/components/tabloid/kicker.test.tsx` (extend or create)

**Interfaces:** none new — class values only.

- [ ] **Step 1: Write the failing Kicker pin**

In the kicker test file (create `apps/web/src/components/tabloid/kicker.test.tsx` if absent, using the repo's RTL idiom):

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Kicker } from "./kicker";

describe("Kicker", () => {
  test("default red maps to red-deep — small-text red must clear 4.5:1", () => {
    render(<Kicker>The front desk</Kicker>);
    expect(screen.getByText("The front desk").className).toContain("text-red-deep");
    expect(screen.getByText("The front desk").className).not.toContain("text-red ");
  });
});
```

(If `kicker.tsx`'s export/props differ — e.g. a `color` prop with children — match its actual API; the assertion is the class value.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @onelife/web run test -- src/components/tabloid`
Expected: FAIL on `text-red-deep`.

- [ ] **Step 3: Apply the sweep**

Exact replacements (each is the only `text-red` on its line; leave every `border-red`, tint, and hover alone):

- `kicker.tsx:4`: `red: "text-red",` → `red: "text-red-deep",` (blue/yellow/ink entries untouched).
- `about/page.tsx:110`: `text-red` → `text-red-deep` (the 6xl step number at line 95 is large display text — leave it).
- `past-life-card.tsx:20`: `text-red` → `text-red-deep`; `:23`: `className="text-red underline"` → `className="text-red-deep underline"`.
- `standing-card.tsx:60`: `text-red` → `text-red-deep`.
- `player-hero.tsx:25`: `text-red` → `text-red-deep` (keep `border-red` — non-text).
- `obituary-article.tsx:27`: `text-red` → `text-red-deep`.
- `news-article.tsx:72`: `text-red` → `text-red-deep` (keep `border-red`).
- `news-status-line.tsx:32`: `text-red` → `text-red-deep` (keep `border-red`).
- `editorial-article.tsx` both banner `<p>`s: `text-red` → `text-red-deep` (keep `border-red`).
- `survivor-controls.tsx:51`: `font-bold text-red` → `font-bold text-red-deep` (keep `border-red` underline).

In `apps/web/src/app/globals.css`, directly above the `--red:` definition, add:

```css
  /* RED POLICY: plain --red (3.7:1 on paper) is display-only — ≥19px-bold text, borders,
     tints, stamps. ALL smaller red text uses --red-deep (5.8:1). A new small text-red is
     a contrast bug. */
```

- [ ] **Step 4: Run the full suite**

Run: `pnpm --filter @onelife/web run test`
Expected: PASS. Any test pinning an old `text-red` on a swept element gets updated to `text-red-deep` (same strength) — list them in your report.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "fix(web): small-text red goes red-deep site-wide (4.5:1); policy documented"
```

---

### Task 2: Type floors — article body, About prose, content floor raises, guard test

**Files:**
- Modify: `apps/web/src/components/shared/article-body.tsx:19`
- Modify: `apps/web/src/app/about/page.tsx:97,111`
- Modify: `apps/web/src/components/obituaries/rap-sheet.tsx:17`
- Modify: `apps/web/src/components/birth-notices/priors-box.tsx:19`
- Modify: `apps/web/src/components/player/stat.tsx:31`
- Modify: `apps/web/src/components/life/hero.tsx:13,33`
- Modify: `apps/web/src/components/notifications/row.tsx:53`
- Modify: `apps/web/src/app/globals.css` (type-floor policy comment, same block as Task 1's)
- Test: extend `apps/web/src/components/shared/article-body.test.tsx`; create `apps/web/src/type-floor-guard.test.ts`

**Interfaces:** none new.

- [ ] **Step 1: Write the failing tests**

Extend the existing article-body test file:

```tsx
  test("prose is 16px reading text with a measure cap", () => {
    render(<ArticleBody blocks={null} fallback={"One paragraph."} />);
    const wrapper = screen.getByText("One paragraph.").closest("div")!;
    expect(wrapper.className).toContain("text-base");
    expect(wrapper.className).toContain("max-w-[68ch]");
    expect(wrapper.className).not.toContain("text-[14px]");
  });
```

Create `apps/web/src/type-floor-guard.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/** Type-floor tripwire (spec §3): these files carry CONTENT, not chrome — nothing in them
 *  may use a 9px/10px text utility. Decorative overlines elsewhere are exempt on purpose. */
const CONTENT_FILES = [
  "components/obituaries/rap-sheet.tsx",
  "components/birth-notices/priors-box.tsx",
  "components/player/stat.tsx",
  "components/life/hero.tsx",
  "components/notifications/row.tsx",
];

describe("type floor", () => {
  test.each(CONTENT_FILES)("%s has no sub-11px text utility", (file) => {
    const src = readFileSync(join(__dirname, file), "utf8");
    expect(src).not.toMatch(/text-\[(9|10)(\.\d+)?px\]/);
  });
});
```

- [ ] **Step 2: Run to verify failures**

Run: `pnpm --filter @onelife/web run test -- src/components/shared/article-body.test.tsx src/type-floor-guard.test.ts`
Expected: both FAIL (14px body; 10px utilities present).

- [ ] **Step 3: Apply the raises**

- `article-body.tsx:19`: `"space-y-4 font-mono text-[14px] leading-relaxed text-ink-soft"` → `"max-w-[68ch] space-y-4 font-mono text-base leading-relaxed text-ink-soft"`.
- `about/page.tsx:97` and `:111`: `text-[15px]` → `text-base` (both).
- `rap-sheet.tsx:17`: `text-[10px]` → `text-[11px]`.
- `priors-box.tsx:19`: `text-[10px]` → `text-[11px]`.
- `stat.tsx:31`: `"mt-1 text-[10px] tracking-[.08em]"` → `"mt-1 text-[11px] tracking-[.08em]"` and `"mt-0.5 text-[9.5px] tracking-[.07em]"` → `"mt-0.5 text-[11px] tracking-[.07em]"`.
- `life/hero.tsx:13` and `:33`: `text-[10px]` → `text-[11px]` (both).
- `notifications/row.tsx:53`: `text-[10px]` → `text-[11px]`.

In `globals.css`, extend the policy comment from Task 1 with:

```css
  /* TYPE FLOORS: reading prose ≥16px (text-base); functional content ≥11px; decorative
     overlines/chrome may sit at 10px only when the information also exists elsewhere.
     Guard test: src/type-floor-guard.test.ts. */
```

- [ ] **Step 4: Run the full suite**

Run: `pnpm --filter @onelife/web run test`
Expected: PASS (update any pinned old sizes — same strength, new values — and list them).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "fix(web): 16px article prose with measure cap; 11px content floor + guard test"
```

---

### Task 3: Mechanical batch — CLS, tabular-nums, motion-safe, truncation, login focus

**Files:**
- Modify: `apps/web/src/components/header.tsx:51` (wordmark)
- Modify: `apps/web/src/components/skeletons.tsx` (Bar + BoardSkeleton rows)
- Modify: `apps/web/src/components/survivors/survivor-row.tsx` (truncate + tabular-nums)
- Modify: `apps/web/src/components/player/stat.tsx` (value element tabular-nums)
- Modify: `apps/web/src/components/player/standing-card.tsx`, `apps/web/src/components/controls/server-cards.tsx`, `apps/web/src/components/controls/sheet.tsx:113`, `apps/web/src/components/controls/pill.tsx` (countdown/balance tabular-nums)
- Modify: `apps/web/src/components/notifications/inbox.tsx:21-23`, `apps/web/src/app/notifications/loading.tsx:5-10`, `apps/web/src/components/controls/rail.tsx:20-22` (motion-safe)
- Modify: `apps/web/src/components/player/player-hero.tsx:18` (break-words)
- Modify: `apps/web/src/components/login-form.tsx:85`; plus `apps/web/src/components/controls/tokens-panel.tsx:57,84`, `apps/web/src/components/controls/link-panel.tsx:40` (focus-visible)
- Test: extend `apps/web/src/components/header.test.tsx`, `apps/web/src/components/survivors/survivor-row.test.tsx` (or the board test file that renders rows)

**Interfaces:** none new.

- [ ] **Step 1: Write the failing pins**

Header test addition:

```tsx
  it("wordmark declares intrinsic dimensions so the masthead cannot shift", () => {
    render(<Masthead />);
    const img = screen.getByAltText("One Life");
    expect(img).toHaveAttribute("width", "1641");
    expect(img).toHaveAttribute("height", "499");
  });
```

Survivor-row test addition (in whichever file renders rows — adapt fixtures):

```tsx
  test("gamertags truncate instead of wrapping the row", () => {
    // render a hero-tier row with any fixture; assert the gamertag link carries `truncate`
    expect(screen.getByRole("link", { name: /.+/ }).className).toContain("truncate");
  });
```

(Adapt the query to the file's existing fixtures — the assertion is the `truncate` class on the gamertag link in each tier variant; one tier pinned is sufficient.)

- [ ] **Step 2: Run to verify failures**

Run: `pnpm --filter @onelife/web run test -- src/components/header.test.tsx src/components/survivors`
Expected: the new assertions FAIL.

- [ ] **Step 3: Apply the batch**

- `header.tsx:51`: add `width={1641} height={499}` to the wordmark `<img>` (className unchanged — `w-[150px]/md:w-[280px] h-auto` keeps rendering identical; the attributes reserve aspect ratio).
- `skeletons.tsx:4` (the shared `Bar`): `"animate-pulse bg-bone"` → `"motion-safe:animate-pulse bg-bone"` — this single change covers every `Bar`-based skeleton. In `BoardSkeleton`, change the compact-row `Array.from({ length: 7 }, …)` to `length: 22`, and add above it: `{/* Known limitation: page 2+ has no hero/podium rows but this skeleton always shows them — loading.tsx cannot read ?page. */}`.
- `notifications/inbox.tsx:21-23`, `app/notifications/loading.tsx:5,6,10`, `controls/rail.tsx:20-22`: each `animate-pulse` → `motion-safe:animate-pulse`.
- `survivor-row.tsx`: add `truncate` to the gamertag `GamertagLink`/wrapper class in all three tier variants (lines ~48, 66, 78); add `tabular-nums` to the stat-value element in all three variants (lines ~52, 69, 81).
- `stat.tsx`: add `tabular-nums` to the value element's className.
- Countdown/balance `tabular-nums`: the countdown value span in `standing-card.tsx` (the `banCountdown` render), the countdown span in `controls/server-cards.tsx`, `controls/sheet.tsx:113` (`font-display text-base font-bold text-paper` countdown), and the balance span in `controls/pill.tsx` (`font-display text-[15px] font-bold …`). Append `tabular-nums` to each className.
- `player-hero.tsx:18`: append `break-words` to the `<h1>` className.
- Focus-visible (all four inputs): in `login-form.tsx:85`, `tokens-panel.tsx:57,84`, `link-panel.tsx:40`, replace the bare `outline-none` token with `outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red` (keeps the existing `focus:border-paper` treatments). Also in `login-form.tsx:85`: `bg-[#111]` → `bg-dark-well`.

- [ ] **Step 4: Run the full suite + hex gate**

Run: `pnpm --filter @onelife/web run test && grep -rn "\[#111" apps/web/src/components`
Expected: suite PASS; grep empty.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "fix(web): wordmark CLS, skeleton fidelity, tabular-nums, motion-safe pulses, truncation, explicit input focus"
```

---

### Task 4: CHANGELOG, CLAUDE.md, full verification

**Files:** `CHANGELOG.md`, `CLAUDE.md`.

- [ ] **Step 1: CHANGELOG** — under `## [Unreleased]` → `### Fixed`, matching house style:

```markdown
- Contrast & type floors (UX review sub-project 1): all small red text moved to `red-deep`
  (4.5:1+), article prose is now 16px with a 68ch measure, content labels rise to an 11px
  floor (guard-tested), the masthead wordmark declares intrinsic dimensions (no more load
  shift), the survivors skeleton matches a full page, stat/countdown digits are tabular,
  skeleton pulses respect reduced motion, long gamertags truncate, and form inputs carry an
  explicit focus-visible outline. Both policies are documented at the tokens in `globals.css`.
```

- [ ] **Step 2: CLAUDE.md** — in the Tabloid redesign section, append two sentences stating the red policy (plain red = display-only; small text = `red-deep`) and the three-tier type floor (16px prose / 11px content / 10px decorative-only), pointing at the `globals.css` policy comments and the `type-floor-guard.test.ts` tripwire.

- [ ] **Step 3: Verify** — `pnpm turbo run typecheck && pnpm --filter @onelife/web run test` → both green.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: changelog + CLAUDE.md for contrast & type floors"
```

Then hand off to `finishing-a-feature` for the PR into `develop`.
