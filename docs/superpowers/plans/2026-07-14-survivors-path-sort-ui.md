# Survivors Path-Sort / SEO / UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the public survivors leaderboard — default sort to time-alive, move sort from query string into the URL path, SEO-friendly H1s, a bigger avatar, and one stat per row (the sorted one).

**Architecture:** All board URLs already flow through one pure `boardHref` builder, so the query→path migration is a rewrite of that builder plus a new pure route resolver (`resolveSurvivorsRoute`) that the three Next app-router page files delegate to. Presentational components (`SurvivorRow`, `SurvivorsBoard`) change their rendering; the read-model and projections are untouched.

**Tech Stack:** Next.js App Router (RSC), TypeScript/ESM, Vitest + @testing-library/react, Fastify (API), Zod.

## Global Constraints

- Sort keys are exactly `"kills" | "time" | "longest"` (`SurvivorSort` in `apps/web/src/lib/types.ts:133`).
- Default sort is **`time`** (was `kills`).
- The three sort words are **reserved** — a server slug can never equal one of them.
- Only **sort** moves into the path; **page** stays a `?page=` query param.
- Sort direction is always descending (read-model behavior, unchanged).
- Repo test convention: presentational components are unit-tested by props; thin hook/server wrappers are untested. Pure helpers (`boardHref`, `resolveSurvivorsRoute`) are unit-tested.
- Run web tests from repo root: `pnpm --filter @onelife/web test -- <path>` (Vitest). Run API tests: `pnpm --filter @onelife/api test`.

---

### Task 1: Path-based `boardHref` + shared sort constants

**Files:**
- Modify: `apps/web/src/lib/board-params.ts` (add `SORTS`, `DEFAULT_SORT`; keep `parsePage`/`buildTabs`; `parseSort` stays for now — removed in Task 3)
- Modify: `apps/web/src/components/survivors/links.ts:9-16` (`boardHref`)
- Test: `apps/web/src/components/survivors/links.test.ts`
- Test (update expectations only): `apps/web/src/components/survivors/survivor-controls.test.tsx`, `apps/web/src/components/survivors/pagination.test.tsx`

**Interfaces:**
- Produces: `export const SORTS: SurvivorSort[]`, `export const DEFAULT_SORT: SurvivorSort` (from `board-params.ts`); `boardHref(slug: string | null, sort: SurvivorSort, page: number): string` now emitting path-based sort.

- [ ] **Step 1: Update the failing `boardHref` test**

Replace the body of `apps/web/src/components/survivors/links.test.ts` with:

```ts
import { describe, expect, test } from "vitest";
import { boardHref } from "./links";

describe("boardHref", () => {
  test("emits sort as a path segment, omits default sort and page=1", () => {
    // default sort (time) => no sort segment
    expect(boardHref(null, "time", 1)).toBe("/survivors");
    expect(boardHref("chernarus", "time", 1)).toBe("/survivors/chernarus");
    // non-default sort => trailing path segment
    expect(boardHref(null, "kills", 1)).toBe("/survivors/kills");
    expect(boardHref("chernarus", "longest", 1)).toBe("/survivors/chernarus/longest");
    // page > 1 stays a query param, after the sort segment
    expect(boardHref("sakhal", "kills", 3)).toBe("/survivors/sakhal/kills?page=3");
    expect(boardHref(null, "time", 2)).toBe("/survivors?page=2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/web test -- src/components/survivors/links.test.ts`
Expected: FAIL (current `boardHref` emits `?sort=`).

- [ ] **Step 3: Add constants to `board-params.ts`**

At the top of `apps/web/src/lib/board-params.ts`, replace the existing `const SORTS` line with exported constants (leave `parseSort`, `parsePage`, `buildTabs` in place):

```ts
import type { Server, SurvivorSort } from "./types";

export const SORTS: SurvivorSort[] = ["kills", "time", "longest"];
export const DEFAULT_SORT: SurvivorSort = "time";

/** Coerce a raw `sort` query value to a valid `SurvivorSort` (default `time`). */
export function parseSort(raw: string | string[] | undefined): SurvivorSort {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return SORTS.includes(v as SurvivorSort) ? (v as SurvivorSort) : DEFAULT_SORT;
}
```

(The rest of the file — `parsePage`, `buildTabs` — is unchanged.)

- [ ] **Step 4: Rewrite `boardHref`**

Replace `apps/web/src/components/survivors/links.ts` lines 1-16 with:

```ts
import type { SurvivorSort } from "@/lib/types";
import { DEFAULT_SORT } from "@/lib/board-params";

/**
 * Pure href builder for the survivors board.
 * - slug null -> "/survivors", else "/survivors/<slug>"
 * - sort appended as a path segment only when not the default ("time")
 * - ?page included only when > 1
 */
export function boardHref(slug: string | null, sort: SurvivorSort, page: number): string {
  let base = slug === null ? "/survivors" : `/survivors/${slug}`;
  if (sort !== DEFAULT_SORT) base += `/${sort}`;
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}
```

(Leave the `MAP_TABS` export below it unchanged.)

- [ ] **Step 5: Run the `boardHref` test to verify it passes**

Run: `pnpm --filter @onelife/web test -- src/components/survivors/links.test.ts`
Expected: PASS.

- [ ] **Step 6: Update controls + pagination test expectations to path URLs**

In `apps/web/src/components/survivors/survivor-controls.test.tsx`:
- `"/survivors/chernarus?sort=longest"` → `"/survivors/chernarus/longest"`
- `"/survivors?sort=time"` → `"/survivors"` (time is now the default, so no segment)

In `apps/web/src/components/survivors/pagination.test.tsx`:
- `"/survivors/chernarus?sort=time&page=2"` → `"/survivors/chernarus?page=2"` (default sort drops the segment)

(All other expected hrefs in those two files — `"/survivors?page=2"`, `"/survivors"`, `"/survivors?page=3"` — are already correct under the new builder.)

- [ ] **Step 7: Run the full survivors component + lib suite**

Run: `pnpm --filter @onelife/web test -- src/components/survivors src/lib/board-params`
Expected: PASS (links, controls, pagination, row, board, format all green — row/board unaffected this task).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/board-params.ts apps/web/src/components/survivors/links.ts apps/web/src/components/survivors/links.test.ts apps/web/src/components/survivors/survivor-controls.test.tsx apps/web/src/components/survivors/pagination.test.tsx
git commit -m "feat(web): path-based survivor sort URLs via boardHref"
```

---

### Task 2: Pure route resolver `resolveSurvivorsRoute`

**Files:**
- Modify: `apps/web/src/lib/board-params.ts` (append resolver + `SurvivorsRoute` type)
- Test: `apps/web/src/lib/board-params.test.ts` (new file)

**Interfaces:**
- Consumes: `SORTS`, `DEFAULT_SORT` (Task 1).
- Produces:
  ```ts
  export type SurvivorsRoute =
    | { kind: "board"; slug: string | null; sort: SurvivorSort }
    | { kind: "redirect"; to: string }
    | { kind: "notFound" };
  export function resolveSurvivorsRoute(segments: string[], slugs: string[]): SurvivorsRoute;
  ```

- [ ] **Step 1: Write the failing resolver test**

Create `apps/web/src/lib/board-params.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { resolveSurvivorsRoute } from "./board-params";

const SLUGS = ["chernarus", "sakhal"];

describe("resolveSurvivorsRoute", () => {
  test("no segments -> combined board, default (time) sort", () => {
    expect(resolveSurvivorsRoute([], SLUGS)).toEqual({ kind: "board", slug: null, sort: "time" });
  });

  test("depth-1 sort word -> combined board sorted by it", () => {
    expect(resolveSurvivorsRoute(["kills"], SLUGS)).toEqual({ kind: "board", slug: null, sort: "kills" });
    expect(resolveSurvivorsRoute(["longest"], SLUGS)).toEqual({ kind: "board", slug: null, sort: "longest" });
  });

  test("depth-1 explicit default sort redirects to the bare combined board", () => {
    expect(resolveSurvivorsRoute(["time"], SLUGS)).toEqual({ kind: "redirect", to: "/survivors" });
  });

  test("depth-1 known map slug -> that map, default sort", () => {
    expect(resolveSurvivorsRoute(["sakhal"], SLUGS)).toEqual({ kind: "board", slug: "sakhal", sort: "time" });
  });

  test("depth-1 unknown segment -> notFound", () => {
    expect(resolveSurvivorsRoute(["atlantis"], SLUGS)).toEqual({ kind: "notFound" });
  });

  test("depth-2 map + sort -> that map sorted", () => {
    expect(resolveSurvivorsRoute(["sakhal", "kills"], SLUGS)).toEqual({ kind: "board", slug: "sakhal", sort: "kills" });
  });

  test("depth-2 explicit default sort redirects to bare map path", () => {
    expect(resolveSurvivorsRoute(["sakhal", "time"], SLUGS)).toEqual({ kind: "redirect", to: "/survivors/sakhal" });
  });

  test("depth-2 unknown map -> notFound", () => {
    expect(resolveSurvivorsRoute(["atlantis", "kills"], SLUGS)).toEqual({ kind: "notFound" });
  });

  test("depth-2 invalid sort -> notFound", () => {
    expect(resolveSurvivorsRoute(["sakhal", "bogus"], SLUGS)).toEqual({ kind: "notFound" });
  });

  test("more than two segments -> notFound", () => {
    expect(resolveSurvivorsRoute(["sakhal", "kills", "extra"], SLUGS)).toEqual({ kind: "notFound" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/web test -- src/lib/board-params.test.ts`
Expected: FAIL with "resolveSurvivorsRoute is not a function".

- [ ] **Step 3: Implement the resolver**

Append to `apps/web/src/lib/board-params.ts`:

```ts
export type SurvivorsRoute =
  | { kind: "board"; slug: string | null; sort: SurvivorSort }
  | { kind: "redirect"; to: string }
  | { kind: "notFound" };

function isSort(v: string): v is SurvivorSort {
  return (SORTS as string[]).includes(v);
}

/**
 * Resolve the dynamic path segments after `/survivors` (sort lives in the path,
 * page does not) against the set of active server slugs.
 * - []                 -> combined board, default sort
 * - [sortWord]         -> combined board sorted by it (explicit default -> redirect to /survivors)
 * - [slug]             -> that map, default sort
 * - [slug, sortWord]   -> that map sorted (explicit default -> redirect to /survivors/<slug>)
 * - anything else      -> notFound
 * The three sort words are reserved and win over an identically-named slug.
 */
export function resolveSurvivorsRoute(segments: string[], slugs: string[]): SurvivorsRoute {
  if (segments.length === 0) return { kind: "board", slug: null, sort: DEFAULT_SORT };
  if (segments.length === 1) {
    const seg = segments[0];
    if (isSort(seg)) {
      return seg === DEFAULT_SORT
        ? { kind: "redirect", to: "/survivors" }
        : { kind: "board", slug: null, sort: seg };
    }
    if (slugs.includes(seg)) return { kind: "board", slug: seg, sort: DEFAULT_SORT };
    return { kind: "notFound" };
  }
  if (segments.length === 2) {
    const [mapSeg, sortSeg] = segments;
    if (!slugs.includes(mapSeg)) return { kind: "notFound" };
    if (!isSort(sortSeg)) return { kind: "notFound" };
    if (sortSeg === DEFAULT_SORT) return { kind: "redirect", to: `/survivors/${mapSeg}` };
    return { kind: "board", slug: mapSeg, sort: sortSeg };
  }
  return { kind: "notFound" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/web test -- src/lib/board-params.test.ts`
Expected: PASS (all 10 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/board-params.ts apps/web/src/lib/board-params.test.ts
git commit -m "feat(web): pure resolver for path-based survivor routes"
```

---

### Task 3: Wire the three route files to the resolver

**Files:**
- Modify: `apps/web/src/app/survivors/page.tsx` (combined board; drop `?sort=`)
- Rewrite: `apps/web/src/app/survivors/[map]/page.tsx` (depth-1 resolver)
- Create: `apps/web/src/app/survivors/[map]/[sort]/page.tsx` (depth-2)
- Modify: `apps/web/src/lib/board-params.ts` (remove now-unused `parseSort`)

**Interfaces:**
- Consumes: `resolveSurvivorsRoute`, `parsePage`, `buildTabs`, `DEFAULT_SORT` (`@/lib/board-params`); `getServers`, `getSurvivors` (`@/lib/api`); `SurvivorsBoard`; `buildSurvivorMetadata`.
- Note: `getSurvivors` signature is `{ slug?: string; sort: SurvivorSort; page: number }` (`apps/web/src/lib/api.ts:122`). `SurvivorsBoard`'s `slug` prop is `string | null`.

- [ ] **Step 1: Rewrite the combined board page (drops sort query)**

Replace `apps/web/src/app/survivors/page.tsx` with:

```tsx
import type { Metadata } from "next";
import { getServers, getSurvivors } from "@/lib/api";
import type { Server } from "@/lib/types";
import { SurvivorsBoard } from "@/components/survivors/survivors-board";
import { buildSurvivorMetadata } from "@/lib/survivor-metadata";
import { parsePage, buildTabs, DEFAULT_SORT } from "@/lib/board-params";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const data = await getSurvivors({ sort: DEFAULT_SORT, page }).catch(() => null);
  return buildSurvivorMetadata({
    slug: null,
    sort: DEFAULT_SORT,
    page,
    total: data?.total ?? 0,
    pageSize: data?.pageSize ?? 25,
    leaderName: data?.rows[0]?.gamertag ?? null,
  });
}

export default async function SurvivorsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const page = parsePage(sp.page);

  const [servers, data] = await Promise.all([
    getServers().catch(() => [] as Server[]),
    getSurvivors({ sort: DEFAULT_SORT, page }),
  ]);

  return <SurvivorsBoard page={data} slug={null} tabs={buildTabs(servers)} />;
}
```

- [ ] **Step 2: Rewrite the depth-1 `[map]` page**

Replace `apps/web/src/app/survivors/[map]/page.tsx` with:

```tsx
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getServers, getSurvivors } from "@/lib/api";
import type { Server } from "@/lib/types";
import { SurvivorsBoard } from "@/components/survivors/survivors-board";
import { buildSurvivorMetadata } from "@/lib/survivor-metadata";
import { parsePage, buildTabs, resolveSurvivorsRoute } from "@/lib/board-params";

type Props = {
  params: Promise<{ map: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function resolve(map: string) {
  const servers = await getServers().catch(() => [] as Server[]);
  const slugs = servers.filter((s) => s.slug !== null).map((s) => s.slug as string);
  return { servers, route: resolveSurvivorsRoute([map], slugs) };
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { map } = await params;
  const { route } = await resolve(map);
  if (route.kind !== "board") return { title: "Survivors" };

  const sp = await searchParams;
  const page = parsePage(sp.page);
  const data = await getSurvivors({ slug: route.slug ?? undefined, sort: route.sort, page }).catch(() => null);
  return buildSurvivorMetadata({
    slug: route.slug,
    sort: route.sort,
    page,
    total: data?.total ?? 0,
    pageSize: data?.pageSize ?? 25,
    leaderName: data?.rows[0]?.gamertag ?? null,
  });
}

export default async function SurvivorsMapPage({ params, searchParams }: Props) {
  const { map } = await params;
  const { servers, route } = await resolve(map);
  if (route.kind === "redirect") redirect(route.to);
  if (route.kind === "notFound") notFound();

  const sp = await searchParams;
  const page = parsePage(sp.page);
  const data = await getSurvivors({ slug: route.slug ?? undefined, sort: route.sort, page });

  return <SurvivorsBoard page={data} slug={route.slug} tabs={buildTabs(servers)} />;
}
```

- [ ] **Step 3: Create the depth-2 `[map]/[sort]` page**

Create `apps/web/src/app/survivors/[map]/[sort]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getServers, getSurvivors } from "@/lib/api";
import type { Server } from "@/lib/types";
import { SurvivorsBoard } from "@/components/survivors/survivors-board";
import { buildSurvivorMetadata } from "@/lib/survivor-metadata";
import { parsePage, buildTabs, resolveSurvivorsRoute } from "@/lib/board-params";

type Props = {
  params: Promise<{ map: string; sort: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function resolve(map: string, sort: string) {
  const servers = await getServers().catch(() => [] as Server[]);
  const slugs = servers.filter((s) => s.slug !== null).map((s) => s.slug as string);
  return { servers, route: resolveSurvivorsRoute([map, sort], slugs) };
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { map, sort } = await params;
  const { route } = await resolve(map, sort);
  if (route.kind !== "board") return { title: "Survivors" };

  const sp = await searchParams;
  const page = parsePage(sp.page);
  const data = await getSurvivors({ slug: route.slug ?? undefined, sort: route.sort, page }).catch(() => null);
  return buildSurvivorMetadata({
    slug: route.slug,
    sort: route.sort,
    page,
    total: data?.total ?? 0,
    pageSize: data?.pageSize ?? 25,
    leaderName: data?.rows[0]?.gamertag ?? null,
  });
}

export default async function SurvivorsMapSortPage({ params, searchParams }: Props) {
  const { map, sort } = await params;
  const { servers, route } = await resolve(map, sort);
  if (route.kind === "redirect") redirect(route.to);
  if (route.kind === "notFound") notFound();

  const sp = await searchParams;
  const page = parsePage(sp.page);
  const data = await getSurvivors({ slug: route.slug ?? undefined, sort: route.sort, page });

  return <SurvivorsBoard page={data} slug={route.slug} tabs={buildTabs(servers)} />;
}
```

- [ ] **Step 4: Remove the now-unused `parseSort`**

In `apps/web/src/lib/board-params.ts`, delete the `parseSort` function (nothing imports it now — the pages resolve sort from the path). Keep `SORTS`, `DEFAULT_SORT`, `parsePage`, `buildTabs`, `resolveSurvivorsRoute`.

- [ ] **Step 5: Typecheck the web app**

Run: `pnpm --filter @onelife/web typecheck`
Expected: PASS (no dangling `parseSort` import, `route.slug` typed `string | null`).

- [ ] **Step 6: Manually verify routing in dev**

Run: `pnpm --filter @onelife/web dev` (or the repo's usual dev command), then confirm in a browser or with `curl -I`:
- `/survivors` → 200, default (time) board
- `/survivors/kills` → 200, combined by kills
- `/survivors/sakhal` → 200 (if `sakhal` is a live slug), default sort
- `/survivors/sakhal/kills` → 200
- `/survivors/time` → 307/308 redirect to `/survivors`
- `/survivors/sakhal/time` → redirect to `/survivors/sakhal`
- `/survivors/atlantis` → 404

Expected: as listed. Stop the dev server when done.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/survivors apps/web/src/lib/board-params.ts
git commit -m "feat(web): resolve survivor sort from the URL path, drop ?sort="
```

---

### Task 4: Single-stat rows, bigger avatar, "Longest kill"

**Files:**
- Modify: `apps/web/src/components/survivors/survivor-row.tsx`
- Modify: `apps/web/src/components/survivors/survivors-board.tsx:69-73` (pass `sort` prop to each row)
- Test: `apps/web/src/components/survivors/survivor-row.test.tsx`

**Interfaces:**
- Consumes: `SurvivorSort`, `formatTimeAlive`, `avatarSrc`.
- Produces: `SurvivorRow` now requires a `sort: SurvivorSort` prop and renders exactly one stat (the sorted one). `SurvivorsBoard` passes `sort={page.sort}`.

- [ ] **Step 1: Update the failing row tests**

Replace `apps/web/src/components/survivors/survivor-row.test.tsx` with:

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
  test("kills sort shows only the Kills stat, with gamertag, map badge, and avatar", () => {
    render(<SurvivorRow rank={1} showMap sort="kills" row={base} />);
    expect(screen.getByText("Chad")).toBeInTheDocument();
    expect(screen.getByText("Kills")).toBeInTheDocument();
    expect(screen.getByText("11")).toBeInTheDocument();
    // other stats hidden
    expect(screen.queryByText("Time alive")).not.toBeInTheDocument();
    expect(screen.queryByText("Longest kill")).not.toBeInTheDocument();
    expect(screen.getByText(/chernarus/i)).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("src", "/characters/boris.webp");
  });

  test("time sort shows only the Time alive stat", () => {
    render(<SurvivorRow rank={1} showMap={false} sort="time" row={base} />);
    expect(screen.getByText("Time alive")).toBeInTheDocument();
    expect(screen.getByText("6h 43m")).toBeInTheDocument();
    expect(screen.queryByText("Kills")).not.toBeInTheDocument();
  });

  test("longest sort shows the Longest kill stat and a dash for a null value", () => {
    render(
      <SurvivorRow
        rank={2}
        showMap={false}
        sort="longest"
        row={{ ...base, gamertag: "Pacifist", longestKillMeters: null, character: null }}
      />
    );
    expect(screen.getByText("Longest kill")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  test("renders an inline silhouette fallback (no broken img) when character is null", () => {
    render(
      <SurvivorRow
        rank={3}
        showMap={false}
        sort="time"
        row={{ ...base, character: null }}
      />
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/unknown survivor/i)).toBeInTheDocument();
  });

  test("hides the map badge when showMap is false", () => {
    render(<SurvivorRow rank={2} showMap={false} sort="kills" row={base} />);
    expect(screen.queryByText(/chernarus/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/web test -- src/components/survivors/survivor-row.test.tsx`
Expected: FAIL (`SurvivorRow` has no `sort` prop; still renders all three stats).

- [ ] **Step 3: Rewrite `survivor-row.tsx`**

Replace `apps/web/src/components/survivors/survivor-row.tsx` with:

```tsx
import type { SurvivorRow as SurvivorRowData, SurvivorSort } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MapBadge } from "./map-badge";
import { avatarSrc, formatTimeAlive } from "./format";

function Avatar({ row }: { row: SurvivorRowData }) {
  const src = avatarSrc(row.character);
  if (src) {
    return <img src={src} alt={row.character?.name ?? row.gamertag} className="h-20 w-20 rounded-full border border-line object-cover" />;
  }
  return (
    <span
      aria-label="Unknown survivor"
      className="flex h-20 w-20 items-center justify-center rounded-full border border-line bg-panel-2 text-muted"
    >
      <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      </svg>
    </span>
  );
}

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
  const stat = statFor(sort, row);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded border bg-panel p-3 sm:flex-row sm:items-center sm:gap-4",
        rank <= 3 ? "border-amber/40" : "border-line"
      )}
    >
      <div className="flex items-center gap-3 sm:flex-1">
        <span className="w-6 shrink-0 text-right font-mono text-sm text-muted">{rank}</span>
        <Avatar row={row} />
        <div className="flex flex-col">
          <span className="font-hand text-bone">{row.gamertag}</span>
          {showMap && <MapBadge slug={row.slug} />}
        </div>
      </div>

      <div className="text-center sm:text-right">
        <span className="block text-[10px] uppercase tracking-wide text-muted">{stat.label}</span>
        <span className="font-mono text-bone">{stat.value}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Pass `sort` from the board**

In `apps/web/src/components/survivors/survivors-board.tsx`, update the `<SurvivorRow ... />` usage (currently lines 69-73) to pass the sort:

```tsx
<SurvivorRow
  row={row}
  rank={(page.page - 1) * page.pageSize + i + 1}
  showMap={slug === null}
  sort={page.sort}
/>
```

- [ ] **Step 5: Run the row + board tests to verify they pass**

Run: `pnpm --filter @onelife/web test -- src/components/survivors/survivor-row.test.tsx src/components/survivors/survivors-board.test.tsx`
Expected: PASS (row shows a single stat; board still renders rows — its existing tests use `sort: "kills"`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/survivors/survivor-row.tsx apps/web/src/components/survivors/survivor-row.test.tsx apps/web/src/components/survivors/survivors-board.tsx
git commit -m "feat(web): one-stat survivor rows, bigger avatar, 'Longest kill' label"
```

---

### Task 5: SEO-friendly H1 on the board

**Files:**
- Modify: `apps/web/src/components/survivors/survivors-board.tsx:33-57` (heading)
- Test: `apps/web/src/components/survivors/survivors-board.test.tsx`

**Interfaces:**
- Consumes: `page.sort` (`SurvivorSort`), `slug`.
- Produces: `<h1>` text = `Top {Map} survivors by {sortLabel}` (combined drops the map name); lowercase sort labels `kills` / `time alive` / `longest kill`.

- [ ] **Step 1: Add the failing H1 tests**

Add these tests inside the `describe("SurvivorsBoard", ...)` block in `apps/web/src/components/survivors/survivors-board.test.tsx`:

```tsx
  test("renders an SEO H1 for a single map + sort", () => {
    const page: SurvivorsPage = { rows: [row], total: 1, page: 1, pageSize: 25, sort: "kills" };
    render(<SurvivorsBoard page={page} slug="sakhal" tabs={[]} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Top Sakhal survivors by kills");
  });

  test("combined board H1 drops the map name and uses time-alive by default", () => {
    const page: SurvivorsPage = { rows: [row], total: 1, page: 1, pageSize: 25, sort: "time" };
    render(<SurvivorsBoard page={page} slug={null} tabs={[]} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Top survivors by time alive");
  });

  test("longest sort H1 reads 'longest kill'", () => {
    const page: SurvivorsPage = { rows: [row], total: 1, page: 1, pageSize: 25, sort: "longest" };
    render(<SurvivorsBoard page={page} slug="chernarus" tabs={[]} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Top Chernarus survivors by longest kill");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/web test -- src/components/survivors/survivors-board.test.tsx`
Expected: FAIL (current H1 is `"Survivors"` / `"Sakhal survivors"`).

- [ ] **Step 3: Update the board heading**

In `apps/web/src/components/survivors/survivors-board.tsx`, add a lowercase sort-label map near the top (below the existing `SCOPE_LABEL`):

```tsx
const SORT_PHRASE: Record<string, string> = {
  kills: "kills",
  time: "time alive",
  longest: "longest kill",
};
```

Then replace the `const heading = ...` line (currently line 42) with:

```tsx
  const scope = slug ? `${mapLabel(slug)} survivors` : "survivors";
  const heading = `Top ${scope} by ${SORT_PHRASE[page.sort]}`;
```

(The `<h1>{heading}</h1>` element and the subtitle below it are unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/web test -- src/components/survivors/survivors-board.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/survivors/survivors-board.tsx apps/web/src/components/survivors/survivors-board.test.tsx
git commit -m "feat(web): SEO-friendly survivors H1 (Top {map} survivors by {sort})"
```

---

### Task 6: API default sort → time

**Files:**
- Modify: `apps/api/src/routes/survivors.ts:8` (`.catch("kills")` → `.catch("time")`)
- Test: `apps/api/test/survivors.test.ts`

**Interfaces:**
- Produces: `GET /survivors` with no `sort` param defaults to `sort: "time"`.

- [ ] **Step 1: Update the failing API test expectations**

In `apps/api/test/survivors.test.ts`:
- In `"GET /survivors returns a SurvivorsPage with defaults"`: change `sort: "kills"` to `sort: "time"`.
- In `"validates sort + page, coercing invalid to defaults (no 500)"`: change `expect(res.json().sort).toBe("kills")` to `.toBe("time")`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/api test -- survivors`
Expected: FAIL (route still defaults to `kills`). Requires `TEST_DATABASE_URL`; start Postgres first (`docker compose up -d postgres`).

- [ ] **Step 3: Change the route default**

In `apps/api/src/routes/survivors.ts` line 8, change:

```ts
  sort: z.enum(["kills", "time", "longest"]).catch("time"),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/api test -- survivors`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/survivors.ts apps/api/test/survivors.test.ts
git commit -m "feat(api): default survivors sort to time-alive"
```

---

## Final verification (after all tasks)

- [ ] `pnpm --filter @onelife/web typecheck` → PASS
- [ ] `pnpm --filter @onelife/web test` → PASS
- [ ] `pnpm --filter @onelife/api test -- survivors` → PASS (Postgres up)
- [ ] Manual smoke of the routing table from Task 3 Step 6, plus a visual check that rows show one stat, the avatar is larger, and the H1 reads correctly.

## Pre-PR steps (handled by the `finishing-a-feature` skill)

- Update `CHANGELOG.md` (every PR).
- Update `CLAUDE.md` survivors bullet to describe path-based sort URLs, the time-alive default, the SEO H1, and one-stat rows (last step before PR).
- Open a PR into `develop`.
