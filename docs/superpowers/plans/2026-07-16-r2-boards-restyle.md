# R2 Boards Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the survivors board (design 13a) and player dossier (13b) to the tabloid design system, and land board skeletons + a11y + three site basics.

**Architecture:** In-place restyle — the existing component tree, routes, read-models, API, and URL logic are untouched; each presentational component's markup/classes are rewritten to the canvas, reusing R1 tabloid primitives (`SkewCta`) and small new format helpers. Loading states are Next.js route-level `loading.tsx` files rendering static skeleton components.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind v3 (RGB-triple tokens via `rgb(var(--x) / <alpha-value>)`), Vitest 2 + Testing Library.

## Global Constraints

- **New code uses new tokens only**: `paper ink red red-deep yellow blue tint dark hairline hairline-2 archive dash ink-soft ink-muted discord` (+ Tailwind default `white`). Never the legacy aliases (`bg panel panel-2 line bone dim muted wash amber blood steel`) or `font-hand` in code this plan touches.
- **Test files import vitest APIs explicitly** (`import { describe, expect, test } from "vitest"`) — the tsconfig has no vitest globals.
- **Voice:** deadpan, no exclamation points, no emoji in UI copy. Uppercase comes from CSS classes, not the string.
- **Copy is final, verbatim:** dek `{N} still drawing breath. Every name is one bad decision from Obituaries.` · empty board `The coast is quiet. No qualified survivors on record.` · showing line `Showing {from}–{to} of {total} still breathing` · kill-list empty `None yet. The pacifist era.` · banned sub-line `Died — awaiting respawn` · ban box label `Ban lifts in` · unban CTA `Spend 1 token — skip the wait` · past-lives suffix `· {N} funerals on file` (`· 1 funeral on file`).
- **No backend change**: no read-model, API, route, redirect, canonical, or JSON-LD behavior changes.
- Yellow surfaces take ink text only. Solid blue/red chips take white text.
- Pagination tap targets ≥ 44px; disabled edges are non-focusable `<span>`s; arrows `aria-hidden`.
- Portrait `img`s: `alt=""`, explicit `width`/`height`, `loading="lazy"`, `decoding="async"`; silhouette fallbacks `aria-hidden="true"`; portraits are **square** (no `rounded-full`).
- Run web tests from `apps/web` with `pnpm test -- <file>`; full suite from repo root with `TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm turbo run test --concurrency=1`.
- Spec: `docs/superpowers/specs/2026-07-16-r2-boards-restyle-design.md`.

---

### Task 1: Tokens + site basics (red-deep, focus ring, skip link)

**Files:**
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/tailwind.config.ts`
- Modify: `apps/web/src/app/layout.tsx`

**Interfaces:**
- Produces: Tailwind color `red-deep` (#C41208, 5.8:1 on paper — used by Task 9); global `:focus-visible` ring; `#content` skip target.

- [ ] **Step 1: Add the `--red-deep` token.** In `apps/web/src/app/globals.css`, in the "Canvas neutrals" block, directly under the `--dash` line, add:

```css
  --red-deep: 196 18 8;      /* #C41208 — small-text error red (5.8:1 on paper) */
```

- [ ] **Step 2: Add the focus ring.** At the end of `globals.css`, after the `body` rule, add:

```css
:focus-visible {
  outline: 2px solid rgb(var(--red));
  outline-offset: 2px;
}
```

- [ ] **Step 3: Expose the token to Tailwind.** In `apps/web/tailwind.config.ts`, in the brand-tokens block directly after `red: v("red"),`, add:

```ts
        "red-deep": v("red-deep"),
```

- [ ] **Step 4: Add the skip link + content target.** In `apps/web/src/app/layout.tsx`, replace the `<body>` contents:

```tsx
      <body className="flex min-h-screen flex-col font-sans antialiased">
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-yellow focus:px-3 focus:py-2 focus:font-display focus:text-sm focus:font-bold focus:uppercase focus:text-ink"
        >
          Skip to content
        </a>
        <QueryProvider>
          <Masthead />
          <StatusBannerContainer />
          <div id="content" className="flex-1">{children}</div>
          <Footer />
        </QueryProvider>
      </body>
```

- [ ] **Step 5: Verify.** Run: `cd apps/web && pnpm typecheck && pnpm test`
Expected: typecheck clean; all existing web tests still pass (nothing asserted on layout).

- [ ] **Step 6: Commit.**

```bash
git add apps/web/src/app/globals.css apps/web/tailwind.config.ts apps/web/src/app/layout.tsx
git commit -m "feat(web): red-deep token, global focus-visible ring, skip-to-content link"
```

---

### Task 2: GamertagLink neutral default + survivors format helpers

**Files:**
- Modify: `apps/web/src/components/gamertag-link.tsx`
- Modify: `apps/web/src/components/survivors/format.ts`
- Test: `apps/web/src/components/survivors/format.test.ts`

**Interfaces:**
- Produces: `GamertagLink({ gamertag, className })` — renders a Next `Link` to `/players/{slug}` with only `hover:text-red` by default; **consumers now pass their own typography** via `className`. `tierFor(rank: number): "hero" | "podium" | "compact"` (1 → hero, 2–3 → podium, else compact). `dekLine(total: number): string`. `showingLine(page: number, pageSize: number, total: number): string`. All three exported from `@/components/survivors/format`.
- Consumed by: Tasks 4, 5, 6 (survivors), 10, 11 (player kill/death lines).

- [ ] **Step 1: Write the failing tests.** Append to `apps/web/src/components/survivors/format.test.ts` (inside the file, keeping its existing imports/tests; add any missing vitest imports):

```ts
import { tierFor, dekLine, showingLine } from "./format";

describe("tierFor", () => {
  test("rank 1 is hero, 2-3 podium, 4+ compact", () => {
    expect(tierFor(1)).toBe("hero");
    expect(tierFor(2)).toBe("podium");
    expect(tierFor(3)).toBe("podium");
    expect(tierFor(4)).toBe("compact");
    expect(tierFor(26)).toBe("compact");
  });
});

describe("dekLine", () => {
  test("counts still drawing breath", () => {
    expect(dekLine(56)).toBe("56 still drawing breath. Every name is one bad decision from Obituaries.");
    expect(dekLine(1)).toBe("1 still drawing breath. Every name is one bad decision from Obituaries.");
  });
});

describe("showingLine", () => {
  test("ranges within the total", () => {
    expect(showingLine(1, 25, 56)).toBe("Showing 1–25 of 56 still breathing");
    expect(showingLine(3, 25, 56)).toBe("Showing 51–56 of 56 still breathing");
  });

  test("clamps an out-of-range page", () => {
    expect(showingLine(4, 25, 56)).toBe("Showing 56–56 of 56 still breathing");
  });
});
```

- [ ] **Step 2: Run to verify failure.** Run: `cd apps/web && pnpm test -- src/components/survivors/format.test.ts`
Expected: FAIL — `tierFor` is not exported.

- [ ] **Step 3: Implement.** Append to `apps/web/src/components/survivors/format.ts`:

```ts
export type RowTier = "hero" | "podium" | "compact";

/** Visual tier by global rank: 1 = hero row, 2-3 = podium, everything else compact. */
export function tierFor(rank: number): RowTier {
  if (rank === 1) return "hero";
  if (rank <= 3) return "podium";
  return "compact";
}

export function dekLine(total: number): string {
  return `${total} still drawing breath. Every name is one bad decision from Obituaries.`;
}

export function showingLine(page: number, pageSize: number, total: number): string {
  const to = Math.min(page * pageSize, total);
  const from = Math.min((page - 1) * pageSize + 1, to);
  return `Showing ${from}–${to} of ${total} still breathing`;
}
```

- [ ] **Step 4: Neutralize GamertagLink.** Replace `apps/web/src/components/gamertag-link.tsx` with:

```tsx
import Link from "next/link";
import { cn } from "@/lib/utils";
import { playerSlug } from "@/lib/slug";

/**
 * Site-wide link to a player's dossier. Typography comes from the caller —
 * the default carries only the hover accent.
 */
export function GamertagLink({ gamertag, className }: { gamertag: string; className?: string }) {
  return (
    <Link href={`/players/${playerSlug(gamertag)}`} className={cn("hover:text-red", className)}>
      {gamertag}
    </Link>
  );
}
```

- [ ] **Step 5: Run the web suite.** Run: `cd apps/web && pnpm test`
Expected: format tests PASS. If any existing test asserted GamertagLink's old classes (`font-hand`, `text-bone`), update that assertion to the link's href/text instead — behavior (href, label) is unchanged.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/src/components/gamertag-link.tsx apps/web/src/components/survivors/format.ts apps/web/src/components/survivors/format.test.ts
git commit -m "feat(web): survivors tier/dek/showing helpers; GamertagLink typography moves to callers"
```

---

### Task 3: SurvivorControls restyle (skewed map chips + mono sort links)

**Files:**
- Modify: `apps/web/src/components/survivors/survivor-controls.tsx`
- Test: `apps/web/src/components/survivors/survivor-controls.test.tsx`

**Interfaces:**
- Consumes: `boardHref` (unchanged), props `{ slug, sort, tabs }` (unchanged).
- Produces: same component signature; only presentation changes.

- [ ] **Step 1: Update the tests.** In `survivor-controls.test.tsx`, keep every existing behavioral assertion (labels, hrefs, `aria-current`). Add class-shape assertions for the new design (adapt to the file's existing render helpers):

```tsx
  test("active map tab is solid ink; inactive is outlined", () => {
    render(<SurvivorControls slug={null} sort="time" tabs={tabs} />);
    const all = screen.getByRole("link", { name: "All maps" });
    expect(all).toHaveAttribute("aria-current", "page");
    expect(all.className).toContain("bg-ink");
    const cherno = screen.getByRole("link", { name: "Chernarus" });
    expect(cherno.className).toContain("border-ink");
    expect(cherno.className).not.toContain("bg-ink ");
  });

  test("active sort is red with a red underline; inactive is muted", () => {
    render(<SurvivorControls slug={null} sort="kills" tabs={tabs} />);
    const kills = screen.getByRole("link", { name: "Kills" });
    expect(kills).toHaveAttribute("aria-current", "page");
    expect(kills.className).toContain("text-red");
    expect(kills.className).toContain("border-red");
    expect(screen.getByRole("link", { name: "Time alive" }).className).toContain("text-ink-muted");
  });
```

- [ ] **Step 2: Run to verify failure.** Run: `cd apps/web && pnpm test -- src/components/survivors/survivor-controls.test.tsx`
Expected: FAIL on the new class assertions.

- [ ] **Step 3: Implement.** Replace the component body of `survivor-controls.tsx` (imports and `SORT_CHIPS` stay):

```tsx
export function SurvivorControls({
  slug,
  sort,
  tabs,
}: {
  slug: string | null;
  sort: SurvivorSort;
  tabs: { slug: string | null; label: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-ink pb-3.5">
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const active = tab.slug === slug;
          return (
            <Link
              key={tab.slug ?? "all"}
              href={boardHref(tab.slug, sort, 1)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-skew-x-[5deg] px-3 pb-0.5 pt-1 font-display text-xs font-semibold uppercase tracking-[.09em]",
                active ? "bg-ink text-paper" : "border border-ink text-ink hover:bg-ink hover:text-paper"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <div className="ml-auto flex flex-wrap gap-x-5 gap-y-2 font-mono text-[11.5px] uppercase tracking-[.05em]">
        {SORT_CHIPS.map((chip) => {
          const active = chip.sort === sort;
          return (
            <Link
              key={chip.sort}
              href={boardHref(slug, chip.sort, 1)}
              aria-current={active ? "page" : undefined}
              className={cn(
                active ? "border-b-2 border-red pb-0.5 font-bold text-red" : "text-ink-muted hover:text-ink"
              )}
            >
              {chip.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass.** Run: `cd apps/web && pnpm test -- src/components/survivors/survivor-controls.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/components/survivors/survivor-controls.tsx apps/web/src/components/survivors/survivor-controls.test.tsx
git commit -m "feat(web): tabloid survivors controls — skewed map chips, mono sort links"
```

---

### Task 4: SurvivorRow tiers (hero / podium / compact) + delete MapBadge

**Files:**
- Modify: `apps/web/src/components/survivors/survivor-row.tsx`
- Delete: `apps/web/src/components/survivors/map-badge.tsx`
- Test: `apps/web/src/components/survivors/survivor-row.test.tsx`

**Interfaces:**
- Consumes: `tierFor`, `avatarSrc`, `formatTimeAlive` from `./format`; `GamertagLink` (pass typography via `className`).
- Produces: same props `{ row, rank, showMap, sort }`. Rendering rules: tier = `tierFor(rank)`; only the sorted stat renders; the stat **label** renders on the hero row only; portraits (76px hero / 60px podium, none compact) are square `img`s per Global Constraints; map (uppercase `row.slug`) shows only when `showMap`; hero sub-line appends `· {N} kills` when `killsThisLife > 0` and `sort !== "kills"`.

- [ ] **Step 1: Rewrite the tests.** Replace the test cases in `survivor-row.test.tsx` (keep the `base` fixture; vitest imports explicit):

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { SurvivorRow } from "./survivor-row";

const base = {
  gamertag: "Chad",
  map: "chernarusplus",
  slug: "chernarus",
  timeAliveSeconds: 24180,
  killsThisLife: 11,
  longestKillMeters: 341,
  character: { name: "Boris", head: "m_boris", gender: "male" as const },
};

describe("SurvivorRow", () => {
  test("hero row (rank 1) shows portrait, stat label, and kills sub-line under time sort", () => {
    render(<SurvivorRow rank={1} showMap sort="time" row={base} />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "/characters/boris.webp");
    expect(img).toHaveAttribute("width", "76");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(screen.getByText("Time alive")).toBeInTheDocument();
    expect(screen.getByText("6h 43m")).toBeInTheDocument();
    expect(screen.getByText("chernarus · 11 kills")).toBeInTheDocument();
  });

  test("hero row omits the kills suffix when sorting by kills", () => {
    render(<SurvivorRow rank={1} showMap sort="kills" row={base} />);
    expect(screen.getByText("chernarus")).toBeInTheDocument();
    expect(screen.queryByText(/11 kills/)).not.toBeInTheDocument();
    expect(screen.getByText("11")).toBeInTheDocument(); // the stat itself
  });

  test("podium row (rank 2) has a 60px portrait and no stat label", () => {
    render(<SurvivorRow rank={2} showMap={false} sort="time" row={base} />);
    expect(screen.getByRole("img")).toHaveAttribute("width", "60");
    expect(screen.queryByText("Time alive")).not.toBeInTheDocument();
    expect(screen.getByText("6h 43m")).toBeInTheDocument();
  });

  test("compact row (rank 4) has no portrait and inline map", () => {
    render(<SurvivorRow rank={4} showMap sort="longest" row={base} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("chernarus")).toBeInTheDocument();
    expect(screen.getByText("341m")).toBeInTheDocument();
  });

  test("null longest kill renders an em dash", () => {
    render(<SurvivorRow rank={5} showMap={false} sort="longest" row={{ ...base, longestKillMeters: null }} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  test("unknown character renders no img (silhouette fallback is decorative)", () => {
    render(<SurvivorRow rank={1} showMap={false} sort="time" row={{ ...base, character: null }} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  test("gamertag links to the player page", () => {
    render(<SurvivorRow rank={3} showMap={false} sort="time" row={base} />);
    expect(screen.getByRole("link", { name: "Chad" })).toHaveAttribute("href", "/players/chad");
  });
});
```

- [ ] **Step 2: Run to verify failure.** Run: `cd apps/web && pnpm test -- src/components/survivors/survivor-row.test.tsx`
Expected: FAIL (old markup).

- [ ] **Step 3: Implement.** Replace `survivor-row.tsx` with:

```tsx
import type { SurvivorRow as SurvivorRowData, SurvivorSort } from "@/lib/types";
import { avatarSrc, formatTimeAlive, tierFor } from "./format";
import { GamertagLink } from "@/components/gamertag-link";

/** The single stat shown for a given sort. */
function statFor(sort: SurvivorSort, row: SurvivorRowData): { label: string; value: string } {
  switch (sort) {
    case "kills":
      return { label: "Kills", value: String(row.killsThisLife) };
    case "longest":
      return { label: "Longest kill", value: row.longestKillMeters === null ? "—" : `${row.longestKillMeters}m` };
    case "time":
    default:
      return { label: "Time alive", value: formatTimeAlive(row.timeAliveSeconds) };
  }
}

function Portrait({ row, size }: { row: SurvivorRowData; size: number }) {
  const src = avatarSrc(row.character);
  const box = { width: size, height: size };
  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        style={box}
        className="border border-hairline object-cover"
      />
    );
  }
  return (
    <span aria-hidden="true" style={box} className="flex items-center justify-center border border-hairline bg-tint text-ink-muted">
      <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="currentColor" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      </svg>
    </span>
  );
}

/** Mono sub-line under the gamertag: map (combined board) and, on the hero row, a kills flourish. */
function subLine(row: SurvivorRowData, sort: SurvivorSort, showMap: boolean, hero: boolean): string | null {
  const parts: string[] = [];
  if (showMap) parts.push(row.slug);
  if (hero && sort !== "kills" && row.killsThisLife > 0) parts.push(`${row.killsThisLife} kills`);
  return parts.length ? parts.join(" · ") : null;
}

export function SurvivorRow({
  row,
  rank,
  showMap,
  sort,
}: {
  row: SurvivorRowData;
  rank: number;
  showMap: boolean;
  sort: SurvivorSort;
}) {
  const tier = tierFor(rank);
  const stat = statFor(sort, row);

  if (tier === "hero") {
    const sub = subLine(row, sort, showMap, true);
    return (
      <div className="grid grid-cols-[40px_76px_1fr_auto] items-center gap-x-3 border-b border-hairline bg-tint px-2 py-4 sm:grid-cols-[56px_76px_1fr_auto] sm:gap-x-4">
        <span aria-hidden className="text-center font-display text-[40px] font-bold leading-none text-red">{rank}</span>
        <Portrait row={row} size={76} />
        <div className="min-w-0">
          <GamertagLink gamertag={row.gamertag} className="font-display text-xl font-bold uppercase leading-none text-ink sm:text-[26px]" />
          {sub && <div className="mt-1 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">{sub}</div>}
        </div>
        <div className="text-right">
          <div className="font-display text-2xl font-bold leading-none text-ink sm:text-[28px]">{stat.value}</div>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[.06em] text-ink-muted">{stat.label}</div>
        </div>
      </div>
    );
  }

  if (tier === "podium") {
    const sub = subLine(row, sort, showMap, false);
    return (
      <div className="grid grid-cols-[40px_60px_1fr_auto] items-center gap-x-3 border-b border-hairline px-2 py-3 sm:grid-cols-[56px_60px_1fr_auto] sm:gap-x-4">
        <span aria-hidden className="text-center font-display text-[28px] font-bold leading-none text-red">{rank}</span>
        <Portrait row={row} size={60} />
        <div className="min-w-0">
          <GamertagLink gamertag={row.gamertag} className="font-display text-lg font-bold uppercase leading-none text-ink sm:text-[21px]" />
          {sub && <div className="mt-0.5 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">{sub}</div>}
        </div>
        <div className="text-right font-display text-lg font-bold leading-none text-ink sm:text-[21px]">{stat.value}</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[40px_1fr_auto] items-center gap-x-3 border-b border-hairline-2 px-2 py-2.5 sm:grid-cols-[56px_1fr_auto] sm:gap-x-4">
      <span aria-hidden className="text-center font-display text-xl font-bold leading-none text-ink">{rank}</span>
      <div className="min-w-0">
        <GamertagLink gamertag={row.gamertag} className="font-display text-[17px] font-semibold uppercase text-ink" />
        {showMap && <span className="ml-2 font-mono text-[11px] uppercase text-ink-muted">{row.slug}</span>}
      </div>
      <div className="text-right font-mono text-[15px] font-bold text-ink">{stat.value}</div>
    </div>
  );
}
```

- [ ] **Step 4: Delete MapBadge.** `git rm apps/web/src/components/survivors/map-badge.tsx` — SurvivorRow was its only consumer (verify with a grep for `MapBadge` / `row-map-badge`; remove any lingering test assertions).

- [ ] **Step 5: Run to verify pass.** Run: `cd apps/web && pnpm test -- src/components/survivors/survivor-row.test.tsx`
Expected: PASS. Then `pnpm test` — fix any board test still referencing `row-map-badge`.

- [ ] **Step 6: Commit.**

```bash
git add -A apps/web/src/components/survivors
git commit -m "feat(web): tiered tabloid survivor rows (hero/podium/compact); drop MapBadge"
```

---

### Task 5: Pagination restyle (showing line, mono boxes, non-focusable edges)

**Files:**
- Modify: `apps/web/src/components/survivors/pagination.tsx`
- Test: `apps/web/src/components/survivors/pagination.test.tsx`

**Interfaces:**
- Consumes: `showingLine` from `./format`; `boardHref` (unchanged).
- Produces: same props `{ slug, sort, page, total, pageSize }`; returns `null` when `total === 0` (the board renders its empty state instead).

- [ ] **Step 1: Rewrite the tests.** Replace the assertions in `pagination.test.tsx` (keep render helpers; explicit vitest imports):

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Pagination } from "./pagination";

describe("Pagination", () => {
  test("shows the range line and page boxes; current page is not a link", () => {
    render(<Pagination slug={null} sort="time" page={2} total={56} pageSize={25} />);
    expect(screen.getByText("Showing 26–50 of 56 still breathing")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "2" })).not.toBeInTheDocument();
    expect(screen.getByText("2")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "1" })).toHaveAttribute("href", "/survivors");
    expect(screen.getByRole("link", { name: "3" })).toHaveAttribute("href", "/survivors?page=3");
  });

  test("prev/next are links mid-range", () => {
    render(<Pagination slug="sakhal" sort="kills" page={2} total={56} pageSize={25} />);
    expect(screen.getByRole("link", { name: /Prev/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Next/ })).toBeInTheDocument();
  });

  test("disabled edges are non-focusable spans, not links", () => {
    render(<Pagination slug={null} sort="time" page={1} total={30} pageSize={25} />);
    expect(screen.queryByRole("link", { name: /Prev/ })).not.toBeInTheDocument();
  });

  test("renders nothing when the board is empty", () => {
    const { container } = render(<Pagination slug={null} sort="time" page={1} total={0} pageSize={25} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run to verify failure.** Run: `cd apps/web && pnpm test -- src/components/survivors/pagination.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement.** Replace `pagination.tsx` with:

```tsx
import Link from "next/link";
import type { SurvivorSort } from "@/lib/types";
import { cn } from "@/lib/utils";
import { boardHref } from "./links";
import { showingLine } from "./format";

const WINDOW = 2;

function pageWindow(page: number, totalPages: number): number[] {
  const start = Math.max(1, page - WINDOW);
  const end = Math.min(totalPages, page + WINDOW);
  const pages: number[] = [];
  for (let n = start; n <= end; n++) pages.push(n);
  return pages;
}

const box = "flex min-h-[44px] min-w-[44px] items-center justify-center px-3 font-mono text-[12.5px] uppercase";
const boxLink = "border border-dash text-ink hover:border-ink";
const boxOff = "select-none border border-hairline-2 text-ink-muted opacity-60";

export function Pagination({
  slug,
  sort,
  page,
  total,
  pageSize,
}: {
  slug: string | null;
  sort: SurvivorSort;
  page: number;
  total: number;
  pageSize: number;
}) {
  if (total === 0) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const showPrev = page > 1;
  const showNext = page * pageSize < total;

  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 border-t-[3px] border-ink pt-3">
      <span className="font-mono text-[11.5px] uppercase tracking-[.05em] text-ink-muted">
        {showingLine(page, pageSize, total)}
      </span>
      <div className="flex flex-wrap gap-2">
        {showPrev ? (
          <Link href={boardHref(slug, sort, page - 1)} className={cn(box, boxLink)}>
            <span aria-hidden>← </span>Prev
          </Link>
        ) : (
          <span aria-hidden className={cn(box, boxOff)}>← Prev</span>
        )}

        {pageWindow(page, totalPages).map((n) => {
          const active = n === page;
          if (active) {
            return (
              <span key={n} aria-current="page" className={cn(box, "bg-ink text-paper")}>
                {n}
              </span>
            );
          }
          return (
            <Link key={n} href={boardHref(slug, sort, n)} className={cn(box, boxLink)}>
              {n}
            </Link>
          );
        })}

        {showNext ? (
          <Link href={boardHref(slug, sort, page + 1)} className={cn(box, boxLink)}>
            Next<span aria-hidden> →</span>
          </Link>
        ) : (
          <span aria-hidden className={cn(box, boxOff)}>Next →</span>
        )}
      </div>
    </nav>
  );
}
```

- [ ] **Step 4: Run to verify pass.** Run: `cd apps/web && pnpm test -- src/components/survivors/pagination.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/components/survivors/pagination.tsx apps/web/src/components/survivors/pagination.test.tsx
git commit -m "feat(web): tabloid board pagination — showing line, mono boxes, non-focusable edges"
```

---

### Task 6: SurvivorsBoard shell (header, dek, empty state, container)

**Files:**
- Modify: `apps/web/src/components/survivors/survivors-board.tsx`
- Test: `apps/web/src/components/survivors/survivors-board.test.tsx`

**Interfaces:**
- Consumes: `dekLine` from `./format`; restyled `SurvivorControls`/`SurvivorRow`/`Pagination`.
- Produces: same props `{ page, slug, tabs }`. **h1 changes** to `Survivors` (combined) / `{Map} survivors` (map board); `itemListLd` and all metadata behavior unchanged.

- [ ] **Step 1: Update the tests.** In `survivors-board.test.tsx`, change heading assertions to the new h1 texts and dek, and the empty-state copy:

```tsx
  test("combined board h1 and dek", () => {
    render(<SurvivorsBoard page={pageFixture} slug={null} tabs={tabs} />);
    expect(screen.getByRole("heading", { level: 1, name: "Survivors" })).toBeInTheDocument();
    expect(screen.getByText(/still drawing breath\. Every name is one bad decision from Obituaries\./)).toBeInTheDocument();
  });

  test("map board h1 includes the map", () => {
    render(<SurvivorsBoard page={pageFixture} slug="sakhal" tabs={tabs} />);
    expect(screen.getByRole("heading", { level: 1, name: "Sakhal survivors" })).toBeInTheDocument();
  });

  test("empty board shows the quiet-coast line", () => {
    render(<SurvivorsBoard page={{ ...pageFixture, rows: [], total: 0 }} slug={null} tabs={tabs} />);
    expect(screen.getByText(/The coast is quiet\. No qualified survivors on record\./i)).toBeInTheDocument();
  });
```

(Keep the existing JSON-LD and rank-offset tests as they are — that behavior is unchanged.)

- [ ] **Step 2: Run to verify failure.** Run: `cd apps/web && pnpm test -- src/components/survivors/survivors-board.test.tsx`
Expected: FAIL on headings.

- [ ] **Step 3: Implement.** In `survivors-board.tsx`: keep `SCOPE_LABEL`, `mapLabel`, and `itemListLd` exactly as they are; delete `SORT_PHRASE`; add `dekLine` to the `./format` import; replace the component:

```tsx
export function SurvivorsBoard({
  page,
  slug,
  tabs,
}: {
  page: SurvivorsPage;
  slug: string | null;
  tabs: { slug: string | null; label: string }[];
}) {
  const heading = slug ? `${mapLabel(slug)} survivors` : "Survivors";

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListLd(page, slug)) }}
      />

      <header className="border-b-[3px] border-ink pb-4">
        <h1 className="font-display text-4xl font-bold uppercase leading-[.94] text-ink sm:text-5xl">{heading}</h1>
        <p className="mt-2 font-mono text-xs uppercase tracking-[.06em] text-ink-muted">{dekLine(page.total)}</p>
      </header>

      <div className="mt-4">
        <SurvivorControls slug={slug} sort={page.sort} tabs={tabs} />
      </div>

      {page.rows.length === 0 ? (
        <p className="mt-6 bg-tint px-6 py-8 text-center font-mono text-sm uppercase tracking-[.05em] text-ink-muted">
          The coast is quiet. No qualified survivors on record.
        </p>
      ) : (
        <ol>
          {page.rows.map((row, i) => (
            <li key={`${row.gamertag}:${row.slug}`}>
              <SurvivorRow
                row={row}
                rank={(page.page - 1) * page.pageSize + i + 1}
                showMap={slug === null}
                sort={page.sort}
              />
            </li>
          ))}
        </ol>
      )}

      <div className="mt-5">
        <Pagination slug={slug} sort={page.sort} page={page.page} total={page.total} pageSize={page.pageSize} />
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Run the whole survivors suite.** Run: `cd apps/web && pnpm test -- src/components/survivors`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/components/survivors/survivors-board.tsx apps/web/src/components/survivors/survivors-board.test.tsx
git commit -m "feat(web): tabloid survivors board shell — Oswald h1, mono dek, quiet-coast empty state"
```

---

### Task 7: Player format helpers (red Deaths, aliveMaps)

**Files:**
- Modify: `apps/web/src/components/player/format.ts`
- Test: `apps/web/src/components/player/format.test.ts`

**Interfaces:**
- Consumes: existing `mapLabel`, `formatDuration`.
- Produces: `heroStats` — same signature/order (Kills-when->0 · Lives · Deaths · Longest life) but `hot: true` moves to **Deaths** (Longest life becomes `hot: false`). New `aliveMaps(page: Pick<PlayerPage, "standing">): string[]` — `mapLabel`s of servers where `state === "alive"`. `heroStatusLine` is **removed** (PlayerHero was its only consumer; Task 8 uses `aliveMaps`). The OG image (`opengraph-image.tsx`) needs **no change** — it already paints `st.hot` in `#FF1E12`.

- [ ] **Step 1: Update the tests.** In `format.test.ts`, update the `heroStats` `hot` expectations and add `aliveMaps`:

```ts
  test("heroStats highlights Deaths, not Longest life", () => {
    const stats = heroStats({ kills: 2, lives: 4, deaths: 2, longestLifeSeconds: 82440 });
    expect(stats.map((s) => s.label)).toEqual(["Kills", "Lives", "Deaths", "Longest life"]);
    expect(stats.find((s) => s.label === "Deaths")?.hot).toBe(true);
    expect(stats.find((s) => s.label === "Longest life")?.hot).toBe(false);
  });

  test("heroStats omits Kills at zero", () => {
    const stats = heroStats({ kills: 0, lives: 1, deaths: 0, longestLifeSeconds: 60 });
    expect(stats.map((s) => s.label)).toEqual(["Lives", "Deaths", "Longest life"]);
  });

  test("aliveMaps lists alive servers by label", () => {
    const standing = [
      { state: "alive", map: "sakhal" },
      { state: "banned", map: "chernarusplus" },
      { state: "alive", map: "enoch" },
    ] as never;
    expect(aliveMaps({ standing })).toEqual(["Sakhal", "Livonia"]);
  });
```

Remove any existing `heroStatusLine` tests.

- [ ] **Step 2: Run to verify failure.** Run: `cd apps/web && pnpm test -- src/components/player/format.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `format.ts`: replace `heroStatusLine` with `aliveMaps`, and flip the `hot` flags in `heroStats`:

```ts
export function aliveMaps(page: Pick<PlayerPage, "standing">): string[] {
  return page.standing.filter((s) => s.state === "alive").map((s) => mapLabel(s.map));
}
```

```ts
export function heroStats(totals: { kills: number; lives: number; deaths: number; longestLifeSeconds: number }): HeroStat[] {
  const out: HeroStat[] = [];
  if (totals.kills > 0) out.push({ label: "Kills", value: String(totals.kills), hot: false });
  out.push({ label: "Lives", value: String(totals.lives), hot: false });
  out.push({ label: "Deaths", value: String(totals.deaths), hot: true });
  out.push({ label: "Longest life", value: formatDuration(totals.longestLifeSeconds), hot: false });
  return out;
}
```

- [ ] **Step 4: Run to verify pass.** Run: `cd apps/web && pnpm test -- src/components/player/format.test.ts`
Expected: PASS. (`player-hero.tsx` still imports `heroStatusLine` and will fail typecheck until Task 8 — do Tasks 7+8 back-to-back; if a standalone typecheck matters mid-task, leave `heroStatusLine` in place until Task 8 removes it, then delete it there.)

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/components/player/format.ts apps/web/src/components/player/format.test.ts
git commit -m "feat(web): hero stats highlight Deaths in red; aliveMaps helper"
```

---

### Task 8: PlayerHero restyle (over-line, Alive ×N badge, verified stamp, stat band)

**Files:**
- Modify: `apps/web/src/components/player/player-hero.tsx`
- Test: `apps/web/src/components/player/player-hero.test.tsx`

**Interfaces:**
- Consumes: `heroStats`, `monthYear`, `aliveMaps` from `./format`.
- Produces: same props `{ page }`. Over-line `FIRST SEEN {Mon YYYY} · ALIVE ON {list}` (alive segment only when alive somewhere; whole line omitted when `firstSeenAt` is null). Badge `Alive` / `Alive ×{N}`. Rotated red `Verified` stamp when `page.verified`. Deaths stat renders `text-red`.

- [ ] **Step 1: Rewrite the tests.** Replace `player-hero.test.tsx` assertions (keep/extend the page fixture):

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { PlayerHero } from "./player-hero";
import type { PlayerPage } from "@/lib/types";

function page(overrides: Partial<PlayerPage> = {}): PlayerPage {
  return {
    gamertag: "YrJustBad",
    verified: true,
    firstSeenAt: "2026-07-01T00:00:00Z",
    aliveAnywhere: true,
    totals: { kills: 2, lives: 4, deaths: 2, longestLifeSeconds: 82440 },
    standing: [
      { serverId: 1, map: "chernarusplus", slug: "chernarus", state: "alive", character: null, alive: null, ban: null },
      { serverId: 2, map: "sakhal", slug: "sakhal", state: "alive", character: null, alive: null, ban: null },
    ],
    pastLives: [],
    pastLivesTotal: 0,
    pastLivesPage: 1,
    pastLivesPageSize: 10,
    ...overrides,
  };
}

describe("PlayerHero", () => {
  test("over-line, gamertag h1, alive badge, verified stamp", () => {
    render(<PlayerHero page={page()} />);
    expect(screen.getByText("First seen Jul 2026 · alive on Chernarus, Sakhal")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "YrJustBad" })).toBeInTheDocument();
    expect(screen.getByText("Alive ×2")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });

  test("single alive server gets a plain Alive badge", () => {
    const p = page();
    p.standing = [p.standing[0]];
    render(<PlayerHero page={p} />);
    expect(screen.getByText("Alive")).toBeInTheDocument();
    expect(screen.getByText("First seen Jul 2026 · alive on Chernarus")).toBeInTheDocument();
  });

  test("dead everywhere: no badge, no alive segment", () => {
    render(<PlayerHero page={page({ standing: [], aliveAnywhere: false })} />);
    expect(screen.queryByText(/Alive/)).not.toBeInTheDocument();
    expect(screen.getByText("First seen Jul 2026")).toBeInTheDocument();
  });

  test("no firstSeenAt: over-line omitted", () => {
    render(<PlayerHero page={page({ firstSeenAt: null })} />);
    expect(screen.queryByText(/First seen/)).not.toBeInTheDocument();
  });

  test("unverified: no stamp", () => {
    render(<PlayerHero page={page({ verified: false })} />);
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
  });

  test("Deaths is the red stat", () => {
    render(<PlayerHero page={page()} />);
    const deathsLabel = screen.getByText("Deaths");
    const value = deathsLabel.previousElementSibling as HTMLElement;
    expect(value.className).toContain("text-red");
  });
});
```

- [ ] **Step 2: Run to verify failure.** Run: `cd apps/web && pnpm test -- src/components/player/player-hero.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement.** Replace `player-hero.tsx` with:

```tsx
import type { PlayerPage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { heroStats, monthYear, aliveMaps } from "./format";

export function PlayerHero({ page }: { page: PlayerPage }) {
  const stats = heroStats(page.totals);
  const alive = aliveMaps(page);
  const overline = page.firstSeenAt
    ? `First seen ${monthYear(page.firstSeenAt)}${alive.length ? ` · alive on ${alive.join(", ")}` : ""}`
    : null;

  return (
    <header className="border-b-[3px] border-ink pb-6">
      {overline && (
        <p className="font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">{overline}</p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="font-display text-5xl font-bold uppercase leading-[.92] text-ink sm:text-6xl">{page.gamertag}</h1>
        {alive.length > 0 && (
          <span className="-skew-x-[5deg] bg-blue px-2.5 pb-0.5 pt-1 font-display text-xs font-bold uppercase tracking-[.1em] text-white">
            {alive.length > 1 ? `Alive ×${alive.length}` : "Alive"}
          </span>
        )}
        {page.verified && (
          <span className="-rotate-6 border-2 border-red px-2.5 pb-0.5 pt-1 font-display text-xs font-bold uppercase tracking-[.12em] text-red">
            Verified
          </span>
        )}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-y-4 sm:flex sm:gap-x-9">
        {stats.map((st) => (
          <div key={st.label}>
            <span className={cn("block font-display text-[32px] font-bold leading-none", st.hot ? "text-red" : "text-ink")}>
              {st.value}
            </span>
            <span className="mt-1 block font-mono text-[10px] uppercase tracking-[.08em] text-ink-muted">{st.label}</span>
          </div>
        ))}
      </div>
    </header>
  );
}
```

If Task 7 left `heroStatusLine` in `format.ts`, delete it (and its type usages) now.

- [ ] **Step 4: Run to verify pass.** Run: `cd apps/web && pnpm test -- src/components/player/player-hero.test.tsx && pnpm typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/components/player/player-hero.tsx apps/web/src/components/player/player-hero.test.tsx apps/web/src/components/player/format.ts
git commit -m "feat(web): tabloid dossier hero — over-line, Alive xN badge, verified stamp, red Deaths"
```

---

### Task 9: UnbanView restyle (SkewCta, red-deep, canvas copy)

**Files:**
- Modify: `apps/web/src/components/player/self-unban-button.tsx`
- Test: `apps/web/src/components/player/self-unban-button.test.tsx`

**Interfaces:**
- Consumes: `SkewCta` from `@/components/tabloid/skew-cta`; Tailwind `red-deep` (Task 1).
- Produces: `UnbanView({ state, balance, onRedeem })` — same props and `UnbanState` union; `SelfUnbanButton` logic (ownership gating, balance fetch, redeem) untouched.

- [ ] **Step 1: Update the tests.** In `self-unban-button.test.tsx`, keep the state-machine tests; update copy assertions:

```tsx
  test("ready state renders the canvas CTA and balance line", () => {
    render(<UnbanView state="ready" balance={3} onRedeem={() => {}} />);
    expect(screen.getByRole("button", { name: "Spend 1 token — skip the wait" })).toBeInTheDocument();
    expect(screen.getByText("You have 3 unban tokens")).toBeInTheDocument();
  });

  test("no-tokens state renders the red-deep notice, no button", () => {
    render(<UnbanView state="no-tokens" balance={0} onRedeem={() => {}} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("No unban tokens").className).toContain("text-red-deep");
    expect(screen.getByText("Earn tokens monthly, by referral, or on verification")).toBeInTheDocument();
  });

  test("pending state renders the mono notice", () => {
    render(<UnbanView state="pending" balance={0} onRedeem={() => {}} />);
    expect(screen.getByText("Unban pending — lifting shortly…")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify failure.** Run: `cd apps/web && pnpm test -- src/components/player/self-unban-button.test.tsx`
Expected: FAIL on copy/classes.

- [ ] **Step 3: Implement.** Replace only the `UnbanView` function (imports gain `SkewCta`; the `cn` import may drop if unused):

```tsx
import { SkewCta } from "@/components/tabloid/skew-cta";

export function UnbanView({
  state,
  balance,
  onRedeem,
}: {
  state: UnbanState;
  balance: number;
  onRedeem: () => void;
}) {
  if (state === "hidden") return null;
  if (state === "pending") {
    return (
      <p className="mt-3 bg-tint px-3 py-2 text-center font-mono text-xs uppercase tracking-[.05em] text-ink-soft">
        Unban pending — lifting shortly…
      </p>
    );
  }
  const ready = state === "ready";
  return (
    <div className="mt-3 text-center">
      {ready ? (
        <SkewCta onClick={onRedeem}>Spend 1 token — skip the wait</SkewCta>
      ) : (
        <p className="border border-dashed border-dash px-3 py-2 font-mono text-xs uppercase tracking-[.05em] text-red-deep">
          No unban tokens
        </p>
      )}
      <p className="mt-2 font-mono text-[11px] text-ink-muted">
        {ready
          ? `You have ${balance} unban token${balance === 1 ? "" : "s"}`
          : "Earn tokens monthly, by referral, or on verification"}
      </p>
    </div>
  );
}
```

(`SelfUnbanButton` below it is unchanged.)

- [ ] **Step 4: Run to verify pass.** Run: `cd apps/web && pnpm test -- src/components/player/self-unban-button.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/components/player/self-unban-button.tsx apps/web/src/components/player/self-unban-button.test.tsx
git commit -m "feat(web): self-unban restyle — red SkewCta, red-deep no-tokens notice"
```

---

### Task 10: PlayerAvatar square + KillList + StandingCard restyle

**Files:**
- Modify: `apps/web/src/components/player/player-avatar.tsx`
- Modify: `apps/web/src/components/player/kill-list.tsx`
- Modify: `apps/web/src/components/player/standing-card.tsx`
- Test: `apps/web/src/components/player/kill-list.test.tsx`, `apps/web/src/components/player/standing-card.test.tsx`

**Interfaces:**
- Consumes: restyled `GamertagLink` (Task 2), `SelfUnbanButton` (Task 9), existing `formatDuration`/`banCountdown`/`mapLabel`.
- Produces: `PlayerAvatar` — same props, now square with image hygiene. `KillList` — same props; the section label moves OUT of it (StandingCard owns the red `Kills this life` label); empty copy becomes `None yet. The pacifist era.` `StandingCard` — same props; alive/banned/idle chips `Alive`/`Banned`/`No life`.

- [ ] **Step 1: Update KillList tests.** In `kill-list.test.tsx`:

```tsx
  test("renders victim links with weapon and distance", () => {
    render(<KillList kills={[{ victimGamertag: "Tomahawked11", weapon: "VSS", distanceMeters: 5 }]} />);
    expect(screen.getByRole("link", { name: "Tomahawked11" })).toHaveAttribute("href", "/players/tomahawked11");
    expect(screen.getByText("VSS · 5m")).toBeInTheDocument();
  });

  test("empty list renders the pacifist line", () => {
    render(<KillList kills={[]} />);
    expect(screen.getByText("None yet. The pacifist era.")).toBeInTheDocument();
  });

  test("limit collapses the tail", () => {
    const kills = Array.from({ length: 12 }, (_, i) => ({ victimGamertag: `V${i}`, weapon: null, distanceMeters: null }));
    render(<KillList kills={kills} limit={10} />);
    expect(screen.getByText("+ 2 more")).toBeInTheDocument();
  });
```

Remove any assertion on the old "Kills this life" label inside KillList (it moves to StandingCard).

- [ ] **Step 2: Update StandingCard tests.** In `standing-card.test.tsx`, keep the fixtures; update presentation assertions:

```tsx
  test("alive card: blue chip, 3-stat row, red kills label", () => {
    render(<StandingCard standing={aliveStanding} now={now} pageGamertag="YrJustBad" />);
    expect(screen.getByText("Alive").className).toContain("bg-blue");
    expect(screen.getByText("Time alive")).toBeInTheDocument();
    expect(screen.getByText("Kills this life").className).toContain("text-red");
  });

  test("banned card: red chip, red left border, ban box, countdown", () => {
    const { container } = render(<StandingCard standing={bannedStanding} now={now} pageGamertag="YrJustBad" />);
    expect(screen.getByText("Banned").className).toContain("bg-red");
    expect((container.firstChild as HTMLElement).className).toContain("border-l-red");
    expect(screen.getByText("Ban lifts in")).toBeInTheDocument();
    expect(screen.getByText("Died — awaiting respawn")).toBeInTheDocument();
  });

  test("null longest kill renders a muted dash", () => {
    render(<StandingCard standing={{ ...aliveStanding, alive: { ...aliveStanding.alive!, longestKillMeters: null } }} now={now} pageGamertag="x" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
```

- [ ] **Step 3: Run to verify failure.** Run: `cd apps/web && pnpm test -- src/components/player/kill-list.test.tsx src/components/player/standing-card.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement PlayerAvatar.** Replace `player-avatar.tsx` with:

```tsx
import type { PlayerCharacter } from "@/lib/types";
import { avatarSrc } from "./format";
import { cn } from "@/lib/utils";

export function PlayerAvatar({
  character,
  size = 44,
  dim = false,
}: {
  character: PlayerCharacter | null;
  size?: number;
  dim?: boolean;
}) {
  const src = avatarSrc(character);
  const box = { width: size, height: size };
  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        style={box}
        className={cn("border border-hairline object-cover", dim && "opacity-60 grayscale")}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={box}
      className={cn("flex items-center justify-center border border-hairline bg-tint text-ink-muted", dim && "opacity-60")}
    >
      <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="currentColor" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      </svg>
    </span>
  );
}
```

- [ ] **Step 5: Implement KillList.** Replace `kill-list.tsx` with:

```tsx
import type { PlayerKill } from "@/lib/types";
import { GamertagLink } from "@/components/gamertag-link";

export function KillList({ kills, limit }: { kills: PlayerKill[]; limit?: number }) {
  if (kills.length === 0) {
    return <p className="mt-1.5 font-mono text-xs uppercase tracking-[.04em] text-ink-muted">None yet. The pacifist era.</p>;
  }
  const shown = limit ? kills.slice(0, limit) : kills;
  return (
    <ul className="mt-1.5 space-y-1.5">
      {shown.map((k, i) => (
        <li key={i} className="flex justify-between gap-3 font-mono text-xs text-ink-soft">
          <span>
            <span aria-hidden>✝ </span>
            <GamertagLink gamertag={k.victimGamertag} className="font-bold text-ink" />
          </span>
          <span className="uppercase text-ink-muted">
            {k.weapon ?? "—"}
            {k.distanceMeters != null ? ` · ${Math.round(k.distanceMeters)}m` : ""}
          </span>
        </li>
      ))}
      {limit && kills.length > limit && <li className="font-mono text-xs text-ink-muted">+ {kills.length - limit} more</li>}
    </ul>
  );
}
```

- [ ] **Step 6: Implement StandingCard.** Replace `standing-card.tsx` with:

```tsx
import type { ServerStanding } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PlayerAvatar } from "./player-avatar";
import { KillList } from "./kill-list";
import { SelfUnbanButton } from "./self-unban-button";
import { formatDuration, banCountdown, mapLabel } from "./format";

function Stat({ value, label, muted = false }: { value: string; label: string; muted?: boolean }) {
  return (
    <div>
      <span className={cn("block font-display text-[21px] font-bold leading-none", muted ? "text-dash" : "text-ink")}>{value}</span>
      <span className="mt-0.5 block font-mono text-[9.5px] uppercase tracking-[.07em] text-ink-muted">{label}</span>
    </div>
  );
}

export function StandingCard({ standing, now, pageGamertag }: { standing: ServerStanding; now: Date; pageGamertag: string }) {
  const alive = standing.state === "alive";
  const banned = standing.state === "banned";
  const sub =
    alive && standing.alive ? `Alive ${formatDuration(standing.alive.timeAliveSeconds)}`
    : banned ? "Died — awaiting respawn"
    : "No open life";

  return (
    <section className={cn("border border-hairline bg-white p-5", banned && "border-l-4 border-l-red")}>
      <div className="flex items-center gap-3">
        <PlayerAvatar character={standing.character} size={48} dim={!alive} />
        <div className="min-w-0 flex-1">
          <p className="font-display text-[19px] font-bold uppercase leading-none text-ink">{mapLabel(standing.map)}</p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[.05em] text-ink-muted">{sub}</p>
        </div>
        <span
          className={cn(
            "px-2 pb-0.5 pt-1 font-display text-[11px] font-bold uppercase tracking-[.1em]",
            alive ? "bg-blue text-white" : banned ? "bg-red text-white" : "border border-dashed border-dash text-ink-muted"
          )}
        >
          {alive ? "Alive" : banned ? "Banned" : "No life"}
        </span>
      </div>

      {alive && standing.alive && (
        <>
          <div className="mt-4 grid grid-cols-3 gap-x-3 border-t border-hairline-2 pt-3">
            <Stat value={formatDuration(standing.alive.timeAliveSeconds)} label="Time alive" />
            <Stat value={String(standing.alive.kills)} label="Kills" />
            <Stat
              value={standing.alive.longestKillMeters == null ? "—" : `${Math.round(standing.alive.longestKillMeters)}m`}
              label="Longest kill"
              muted={standing.alive.longestKillMeters == null}
            />
          </div>
          <div className="mt-3 border-t border-hairline-2 pt-2.5">
            <p className="font-display text-xs font-bold uppercase tracking-[.12em] text-red">Kills this life</p>
            <KillList kills={standing.alive.killList} limit={10} />
          </div>
        </>
      )}

      {banned && standing.ban && (
        <div className="mt-4">
          {banCountdown(standing.ban.expiresAt, now) && (
            <div className="flex items-center justify-between border border-hairline-2 bg-paper px-3 py-2">
              <span className="font-mono text-[10px] uppercase tracking-[.06em] text-ink-muted">Ban lifts in</span>
              <span className="font-display text-lg font-bold text-ink">{banCountdown(standing.ban.expiresAt, now)}</span>
            </div>
          )}
          <SelfUnbanButton banId={standing.ban.banId} pageGamertag={pageGamertag} liftPending={standing.ban.liftPending} />
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 7: Run to verify pass.** Run: `cd apps/web && pnpm test -- src/components/player`
Expected: kill-list + standing-card PASS (past-life-card may still pass on old markup — it changes next task).

- [ ] **Step 8: Commit.**

```bash
git add apps/web/src/components/player/player-avatar.tsx apps/web/src/components/player/kill-list.tsx apps/web/src/components/player/standing-card.tsx apps/web/src/components/player/kill-list.test.tsx apps/web/src/components/player/standing-card.test.tsx
git commit -m "feat(web): tabloid standing cards — state chips, red left border on ban, square avatars"
```

---

### Task 11: PastLifeCard funeral cards + PlayerPagination restyle

**Files:**
- Modify: `apps/web/src/components/player/past-life-card.tsx`
- Modify: `apps/web/src/components/player/player-pagination.tsx`
- Test: `apps/web/src/components/player/past-life-card.test.tsx`, `apps/web/src/components/player/player-pagination.test.tsx`

**Interfaces:**
- Consumes: `GamertagLink`, `formatDuration`, `mapLabel`, `relativeDate`.
- Produces: `PastLifeCard({ life, now })` — compact funeral card: **no kill list, no vitals, no portrait**; counts strip `{N} kills · {—|Nm} longest kill · {N} session(s)`. `PlayerPagination` — same props/URLs; disabled edges become real `<span>`s (not pointer-events-none links).

- [ ] **Step 1: Rewrite PastLifeCard tests.** Replace assertions in `past-life-card.test.tsx` (keep/extend fixtures):

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { PastLifeCard } from "./past-life-card";
import type { PastLife } from "@/lib/types";

const now = new Date("2026-07-16T12:00:00Z");

function life(overrides: Partial<PastLife> = {}): PastLife {
  return {
    lifeId: 9, serverId: 1, map: "sakhal", slug: "sakhal", lifeNumber: 2,
    startedAt: "2026-07-14T04:00:00Z", endedAt: "2026-07-14T09:06:00Z",
    timeAliveSeconds: 18360, kills: 0, longestKillMeters: null, character: null,
    death: { cause: "pvp", byGamertag: "TidierCart8730", weapon: "VSD", distanceMeters: 126 },
    vitals: { energy: null, water: null, bleedSources: null },
    sessions: 9, killList: [],
    ...overrides,
  };
}

describe("PastLifeCard", () => {
  test("funeral card: map, dateline, pvp death line, counts strip", () => {
    render(<PastLifeCard life={life()} now={now} />);
    expect(screen.getByText("Sakhal")).toBeInTheDocument();
    expect(screen.getByText("2 days ago · lasted 5h 6m")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "TidierCart8730" })).toHaveAttribute("href", "/players/tidiercart8730");
    expect(screen.getByText(/VSD · 126m/)).toBeInTheDocument();
    expect(screen.getByText("0 kills")).toBeInTheDocument();
    expect(screen.getByText("— longest kill")).toBeInTheDocument();
    expect(screen.getByText("9 sessions")).toBeInTheDocument();
  });

  test("environment death line has no link", () => {
    render(<PastLifeCard life={life({ death: { cause: "environment", byGamertag: null, weapon: null, distanceMeters: null } })} now={now} />);
    expect(screen.getByText(/Died — environment/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  test("no kill list or vitals render", () => {
    render(<PastLifeCard life={life({ killList: [{ victimGamertag: "X", weapon: null, distanceMeters: null }], vitals: { energy: 100, water: 50, bleedSources: 1 } })} now={now} />);
    expect(screen.queryByText(/Kills this life/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/At death/i)).not.toBeInTheDocument();
  });

  test("singular session", () => {
    render(<PastLifeCard life={life({ sessions: 1 })} now={now} />);
    expect(screen.getByText("1 session")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Update PlayerPagination tests.** In `player-pagination.test.tsx`:

```tsx
  test("edges: first page has no Newer link, a real Older link", () => {
    render(<PlayerPagination slug="yrjustbad" page={1} total={25} pageSize={10} />);
    expect(screen.queryByRole("link", { name: /Newer/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Older/ })).toHaveAttribute("href", "/players/yrjustbad?page=2");
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
  });

  test("hidden with a single page", () => {
    const { container } = render(<PlayerPagination slug="x" page={1} total={5} pageSize={10} />);
    expect(container).toBeEmptyDOMElement();
  });
```

- [ ] **Step 3: Run to verify failure.** Run: `cd apps/web && pnpm test -- src/components/player/past-life-card.test.tsx src/components/player/player-pagination.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement PastLifeCard.** Replace `past-life-card.tsx` with:

```tsx
import type { PastLife } from "@/lib/types";
import { GamertagLink } from "@/components/gamertag-link";
import { formatDuration, mapLabel, relativeDate } from "./format";

export function PastLifeCard({ life, now }: { life: PastLife; now: Date }) {
  const death = life.death;
  return (
    <section className="border border-hairline border-t-4 border-t-ink bg-archive px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="font-display text-[17px] font-bold uppercase text-ink">{mapLabel(life.map)}</span>
        <span className="font-mono text-[10px] uppercase tracking-[.04em] text-ink-muted">
          {relativeDate(life.endedAt, now)} · lasted {formatDuration(life.timeAliveSeconds)}
        </span>
      </div>

      {death?.cause && (
        <p className="mt-2 font-mono text-xs font-bold uppercase tracking-[.04em] text-red">
          <span aria-hidden>✝ </span>
          {death.cause === "pvp" ? (
            <>Killed by {death.byGamertag ? <GamertagLink gamertag={death.byGamertag} className="text-red underline" /> : "unknown"}</>
          ) : (
            <>Died — {death.cause}</>
          )}
          {death.weapon ? ` · ${death.weapon}` : ""}
          {death.distanceMeters != null ? ` · ${Math.round(death.distanceMeters)}m` : ""}
        </p>
      )}

      <p className="mt-2.5 flex flex-wrap gap-x-5 border-t border-hairline-2 pt-2 font-mono text-[11px] uppercase text-ink-soft">
        <span>{life.kills} kills</span>
        <span>{life.longestKillMeters == null ? "—" : `${Math.round(life.longestKillMeters)}m`} longest kill</span>
        <span>{life.sessions} session{life.sessions === 1 ? "" : "s"}</span>
      </p>
    </section>
  );
}
```

- [ ] **Step 5: Implement PlayerPagination.** Replace `player-pagination.tsx` with:

```tsx
import Link from "next/link";
import { cn } from "@/lib/utils";

const href = (slug: string, page: number) => (page <= 1 ? `/players/${slug}` : `/players/${slug}?page=${page}`);

const box = "flex min-h-[44px] items-center justify-center px-4 font-mono text-[12.5px] uppercase";
const boxLink = "border border-dash text-ink hover:border-ink";
const boxOff = "select-none border border-hairline-2 text-ink-muted opacity-60";

export function PlayerPagination({ slug, page, total, pageSize }: { slug: string; page: number; total: number; pageSize: number }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Past lives pagination" className="flex flex-wrap items-center justify-center gap-3 border-t-[3px] border-ink pt-3">
      {page > 1 ? (
        <Link href={href(slug, page - 1)} className={cn(box, boxLink)}>
          <span aria-hidden>‹ </span>Newer
        </Link>
      ) : (
        <span aria-hidden className={cn(box, boxOff)}>‹ Newer</span>
      )}
      <span className="font-mono text-[11.5px] uppercase tracking-[.05em] text-ink-muted">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={href(slug, page + 1)} className={cn(box, boxLink)}>
          Older<span aria-hidden> ›</span>
        </Link>
      ) : (
        <span aria-hidden className={cn(box, boxOff)}>Older ›</span>
      )}
    </nav>
  );
}
```

- [ ] **Step 6: Run to verify pass.** Run: `cd apps/web && pnpm test -- src/components/player`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add apps/web/src/components/player/past-life-card.tsx apps/web/src/components/player/player-pagination.tsx apps/web/src/components/player/past-life-card.test.tsx apps/web/src/components/player/player-pagination.test.tsx
git commit -m "feat(web): compact funeral cards for past lives; tabloid past-lives pagination"
```

---

### Task 12: PlayerProfile shell (wide column, back link, section h2s, 2-col grids)

**Files:**
- Modify: `apps/web/src/components/player/player-profile.tsx`

**Interfaces:**
- Consumes: everything from Tasks 8–11; `profileLd`/`playerSlug` unchanged.
- Produces: same props `{ page, now }`; JSON-LD unchanged.

- [ ] **Step 1: Implement.** Replace `player-profile.tsx` with:

```tsx
import Link from "next/link";
import type { PlayerPage } from "@/lib/types";
import { absoluteUrl, profileLd } from "@/lib/seo";
import { playerSlug } from "@/lib/slug";
import { PlayerHero } from "./player-hero";
import { StandingCard } from "./standing-card";
import { PastLifeCard } from "./past-life-card";
import { PlayerPagination } from "./player-pagination";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-xl font-bold uppercase tracking-[.1em] text-ink">{children}</h2>;
}

export function PlayerProfile({ page, now }: { page: PlayerPage; now: Date }) {
  const slug = playerSlug(page.gamertag);
  const aliveOrBanned = page.standing.filter((s) => s.state !== "idle");
  const ld = profileLd(page, absoluteUrl(`/players/${slug}`));
  const funerals = `${page.pastLivesTotal} funeral${page.pastLivesTotal === 1 ? "" : "s"} on file`;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />

      <Link href="/survivors" className="font-mono text-[11px] uppercase tracking-[.06em] text-ink-muted hover:text-red">
        <span aria-hidden>← </span>Survivors
      </Link>

      <div className="mt-3">
        <PlayerHero page={page} />
      </div>

      {aliveOrBanned.length > 0 && (
        <section className="mt-7">
          <SectionHeading>Current standing</SectionHeading>
          <div className="mt-3 grid gap-5 md:grid-cols-2">
            {aliveOrBanned.map((s) => (
              <StandingCard key={s.serverId} standing={s} now={now} pageGamertag={page.gamertag} />
            ))}
          </div>
        </section>
      )}

      {page.pastLivesTotal > 0 && (
        <section className="mt-8">
          <SectionHeading>
            Past lives <span className="font-mono text-xs font-normal tracking-[.06em] text-ink-muted">· {funerals}</span>
          </SectionHeading>
          <div className="mt-3 grid gap-5 md:grid-cols-2">
            {page.pastLives.map((l) => (
              <PastLifeCard key={`${l.serverId}:${l.lifeId}`} life={l} now={now} />
            ))}
          </div>
          <div className="mt-5">
            <PlayerPagination slug={slug} page={page.pastLivesPage} total={page.pastLivesTotal} pageSize={page.pastLivesPageSize} />
          </div>
        </section>
      )}
    </main>
  );
}
```

(The `uppercase` on the h2 makes the mono suffix read `· 2 FUNERALS ON FILE` — the string stays lowercase per the voice rule.)

- [ ] **Step 2: Verify.** Run: `cd apps/web && pnpm test && pnpm typecheck`
Expected: full web suite + typecheck PASS (this file has no dedicated test, per repo convention for thin composition).

- [ ] **Step 3: Commit.**

```bash
git add apps/web/src/components/player/player-profile.tsx
git commit -m "feat(web): tabloid dossier shell — wide column, back link, 2-col standing/funeral grids"
```

---

### Task 13: Skeletons + loading routes

**Files:**
- Create: `apps/web/src/components/skeletons.tsx`
- Create: `apps/web/src/app/survivors/loading.tsx`
- Create: `apps/web/src/app/survivors/[map]/loading.tsx`
- Create: `apps/web/src/app/survivors/[map]/[sort]/loading.tsx`
- Create: `apps/web/src/app/players/[slug]/loading.tsx`
- Test: `apps/web/src/components/skeletons.test.tsx`

**Interfaces:**
- Produces: `BoardSkeleton()` and `DossierSkeleton()` from `@/components/skeletons` — static, no props, `aria-busy` mains matching the real layouts' container metrics.

- [ ] **Step 1: Write the failing tests.** Create `apps/web/src/components/skeletons.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { BoardSkeleton, DossierSkeleton } from "./skeletons";

describe("skeletons", () => {
  test("BoardSkeleton renders a busy main with pulsing blocks", () => {
    const { container } = render(<BoardSkeleton />);
    const main = container.querySelector("main");
    expect(main).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(5);
  });

  test("DossierSkeleton renders a busy main with pulsing blocks", () => {
    const { container } = render(<DossierSkeleton />);
    expect(container.querySelector("main")).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(5);
  });
});
```

- [ ] **Step 2: Run to verify failure.** Run: `cd apps/web && pnpm test -- src/components/skeletons.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.** Create `apps/web/src/components/skeletons.tsx`:

```tsx
import { cn } from "@/lib/utils";

function Bar({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse bg-tint", className)} />;
}

/** Route-level loading state for the survivors board — mirrors the board's container metrics. */
export function BoardSkeleton() {
  return (
    <main aria-busy="true" className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10">
      <div className="border-b-[3px] border-ink pb-4">
        <Bar className="h-10 w-64 max-w-full" />
        <Bar className="mt-3 h-3 w-96 max-w-full" />
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-b border-ink pb-3.5">
        <Bar className="h-7 w-24" />
        <Bar className="h-7 w-24" />
        <Bar className="h-7 w-24" />
      </div>
      <div className="border-b border-hairline py-4">
        <Bar className="h-[76px]" />
      </div>
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} className="border-b border-hairline-2 py-3">
          <Bar className="h-6" />
        </div>
      ))}
    </main>
  );
}

/** Route-level loading state for the player dossier. */
export function DossierSkeleton() {
  return (
    <main aria-busy="true" className="mx-auto w-full max-w-5xl px-6 py-10 md:px-10">
      <Bar className="h-3 w-24" />
      <div className="mt-3 border-b-[3px] border-ink pb-6">
        <Bar className="h-3 w-72 max-w-full" />
        <Bar className="mt-2 h-14 w-80 max-w-full" />
        <div className="mt-5 flex gap-9">
          <Bar className="h-12 w-16" />
          <Bar className="h-12 w-16" />
          <Bar className="h-12 w-16" />
          <Bar className="h-12 w-24" />
        </div>
      </div>
      <div className="mt-7 grid gap-5 md:grid-cols-2">
        <Bar className="h-48" />
        <Bar className="h-48" />
        <Bar className="h-36" />
        <Bar className="h-36" />
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Wire the routes.** Create the four `loading.tsx` files. `apps/web/src/app/survivors/loading.tsx`, `apps/web/src/app/survivors/[map]/loading.tsx`, and `apps/web/src/app/survivors/[map]/[sort]/loading.tsx` are identical:

```tsx
import { BoardSkeleton } from "@/components/skeletons";

export default function Loading() {
  return <BoardSkeleton />;
}
```

`apps/web/src/app/players/[slug]/loading.tsx`:

```tsx
import { DossierSkeleton } from "@/components/skeletons";

export default function Loading() {
  return <DossierSkeleton />;
}
```

- [ ] **Step 5: Run to verify pass.** Run: `cd apps/web && pnpm test -- src/components/skeletons.test.tsx && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/src/components/skeletons.tsx apps/web/src/components/skeletons.test.tsx apps/web/src/app/survivors/loading.tsx "apps/web/src/app/survivors/[map]/loading.tsx" "apps/web/src/app/survivors/[map]/[sort]/loading.tsx" "apps/web/src/app/players/[slug]/loading.tsx"
git commit -m "feat(web): board and dossier loading skeletons"
```

---

### Task 14: Full suite + visual verification

**Files:** none (verification only; fix regressions where found).

- [ ] **Step 1: Full monorepo suite.** From the repo root:

```bash
TEST_DATABASE_URL=postgres://onelife:onelife@localhost:5434/onelife_test pnpm turbo run test --concurrency=1
pnpm turbo run typecheck
```

Expected: all packages green. (Docker Postgres maps to host **5434** on this machine.)

- [ ] **Step 2: Visual sweep.** With the dev servers running (web on :3000; API on :3001 pointed at `onelife_visual`), check at **1440px and 390px**:
  - `/survivors` — hero/podium/compact tiers, skewed map tabs, mono sorts, pagination bar
  - `/survivors?page=2` — all-compact rows, rank offset continues
  - `/survivors/sakhal` and `/survivors/kills` — map h1, sort active states, no map sub-lines on single-map board
  - A player page with alive + banned standing and past lives — hero over-line/badge/stamp, state-colored cards, ban box + unban CTA (owner), funeral cards, pagination
  - Skeleton flash on slow navigation (throttle or hard-reload)
  - `/players/{slug}/opengraph-image` — Deaths stat renders red, layout intact
  - Keyboard pass: skip link appears on first Tab; focus ring visible on paper and on the dark masthead; disabled pagination edges are not focusable
Expected: no illegible text, no horizontal overflow at 390px, no console errors.

- [ ] **Step 3: Fix anything found, re-run, commit fixes** with `fix(web): …` messages.

---

## Not in this plan (handled by finishing-a-feature)

CHANGELOG.md entry and CLAUDE.md update happen as the final pre-PR step via the `finishing-a-feature` skill, per the repo workflow.
