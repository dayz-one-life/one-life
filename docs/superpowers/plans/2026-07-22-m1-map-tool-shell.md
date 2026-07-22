# M1 — Map Tool Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/maps/[map]` from a page with a map on it into a full-viewport map application with one bar of chrome, place search, and a live grid-reference readout.

**Architecture:** A route-group split moves the site chrome (masthead, controls rail, footer) out of the root layout into `app/(site)/`, leaving `app/maps/` free to render its own shell. All new capability is client-side over payloads and vendored data that already exist. Leaflet stays sealed inside `MapCanvas` — consumers drive it declaratively through two new props rather than reaching for the map instance.

**Tech Stack:** Next.js App Router (server + client components), React 19, Tailwind, Leaflet (plain, dynamically imported), vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-22-m1-map-tool-shell-design.md`

## Global Constraints

- **No migration, no new API route, no new env var, no worker.** Presentation only, over `GET /me/maps`, `GET /me/maps/:mapSlug` and `apps/web/src/lib/map-places.json`.
- **No URL changes.** Route groups are not path segments; every existing path must resolve exactly as before.
- **Three z-altitudes only.** The LAYER LEGEND at the `<header>` in `apps/web/src/components/header.tsx` is the source of truth: content → z-40 → z-50. On `/maps` the top bar is the z-40 occupant (there is no masthead) and the friends sheet is z-50. Do not introduce a fourth.
- **The Leaflet lifecycle lives in ONE place** — `apps/web/src/components/map/map-canvas.tsx`. Do not create a second Leaflet-owning component and do not export the map instance.
- **Loading is never an authoritative zero or empty.** A count that is still fetching renders a loading state, not `0`.
- **A dark surface needs dark tokens.** Any component mounted on the dark top bar or the dark sheet must swap its text/border/background tokens, and the swap must be pinned by a test — RTL asserts the DOM, not contrast.
- **`100dvh`, never `100vh`,** for the shell height; iOS safe-area insets on the bar and any bottom-anchored control.
- Run tests with `pnpm --filter @onelife/web run test`; typecheck with `pnpm --filter @onelife/web run typecheck`. Both from the repo root.

---

### Task 1: Split the site chrome out of the root layout

**Files:**
- Create: `apps/web/src/app/(site)/layout.tsx`
- Create: `apps/web/src/app/(site)/layout.test.tsx` (moved from `apps/web/src/app/layout.test.tsx`)
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/not-found.tsx`
- Modify: `apps/web/src/app/error.tsx`
- Create: `apps/web/src/app/not-found.test.tsx`
- Move (git mv, contents untouched): `about/`, `fresh-spawns/`, `friends/`, `login/`, `news/`, `notifications/`, `obituaries/`, `players/`, `survivors/`, `welcome/`, `page.tsx`, `page.test.tsx` → `apps/web/src/app/(site)/`

**Interfaces:**
- Consumes: nothing.
- Produces: `app/maps/` is no longer wrapped in site chrome, which every later task depends on. `(site)/layout.tsx` renders `#main-content` and owns the `xl:grid-cols-[minmax(0,1fr)_380px]` shell.

- [ ] **Step 1: Move the routes into the group**

```bash
cd apps/web/src/app
mkdir -p "(site)"
git mv about fresh-spawns friends login news notifications obituaries players survivors welcome "(site)/"
git mv page.tsx page.test.tsx "(site)/"
git mv layout.test.tsx "(site)/"
```

`maps/`, `layout.tsx`, `error.tsx`, `not-found.tsx`, `sitemap.ts`, `robots.ts`, `fonts.ts`, `globals.css` and the icon assets stay where they are.

- [ ] **Step 2: Create the site layout with the chrome moved into it**

Create `apps/web/src/app/(site)/layout.tsx`:

```tsx
import type { ReactNode } from "react";
import { Masthead } from "@/components/header";
import { Footer } from "@/components/footer";
import { ControlsRail } from "@/components/controls/rail";

/** Every surface EXCEPT the map application. `/maps` deliberately sits outside this group so
 *  it can render its own full-viewport shell — see app/maps/layout.tsx. Route groups are not
 *  path segments, so nothing in here changed URL when it moved. */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Masthead />
      <div className="mx-auto w-full max-w-[1440px] flex-1 xl:grid xl:grid-cols-[minmax(0,1fr)_380px] xl:px-10">
        <div id="main-content" tabIndex={-1} className="min-w-0 xl:border-r xl:border-ink xl:pr-8">
          {children}
        </div>
        <ControlsRail />
      </div>
      <Footer />
    </>
  );
}
```

- [ ] **Step 3: Strip the chrome from the root layout**

Replace the body contents of `apps/web/src/app/layout.tsx` (keep the imports of `./globals.css`, `fonts`, `SITE_URL`, `QueryProvider`, and the exported `metadata` exactly as they are):

```tsx
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="flex min-h-screen flex-col font-sans antialiased">
        {/* `focus:z-50` must stay ABOVE the z-40 chrome layer (LAYER LEGEND in
            `components/header.tsx`). This renders before any header, so at an equal z-index
            the header wins on DOM order and the chip is invisible to the keyboard users it
            exists for. On /maps the z-40 occupant is the map's top bar, not the masthead. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-yellow focus:px-3 focus:py-2 focus:font-display focus:text-sm focus:font-bold focus:uppercase focus:text-ink"
        >
          Skip to content
        </a>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
```

Delete the now-unused `Masthead`, `Footer` and `ControlsRail` imports from this file.

- [ ] **Step 4: Point the moved layout test at the site layout**

In `apps/web/src/app/(site)/layout.test.tsx`, change the import and the render call — `SiteLayout` is a plain component, not the `<html>` root, so it no longer needs the `document.body` container:

```tsx
import SiteLayout from "./layout";
// ...delete the "./fonts" and "@/components/query-provider" mocks; SiteLayout uses neither.

describe("SiteLayout", () => {
  test("the content column no longer reserves the pb-24 bottom gutter the retired floating pill needed", () => {
    render(<SiteLayout><div data-testid="child" /></SiteLayout>);
    const main = document.getElementById("main-content");
    expect(main).not.toBeNull();
    expect(main!.className).not.toMatch(/\bpb-24\b/);
  });

  test("renders the masthead, rail and footer that /maps deliberately opts out of", () => {
    render(<SiteLayout><div data-testid="child" /></SiteLayout>);
    expect(screen.getByTestId("masthead")).toBeInTheDocument();
    expect(screen.getByTestId("rail")).toBeInTheDocument();
    expect(screen.getByTestId("footer")).toBeInTheDocument();
  });
});
```

Add `screen` to the `@testing-library/react` import.

- [ ] **Step 5: Write the failing test for the bare 404**

Create `apps/web/src/app/not-found.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import NotFound from "./not-found";

// not-found.tsx renders against the ROOT layout, which no longer carries the site chrome.
// Without an explicit masthead and footer here, a 404 is a dead end with no navigation.
vi.mock("@/components/header", () => ({ Masthead: () => <div data-testid="masthead" /> }));
vi.mock("@/components/footer", () => ({ Footer: () => <div data-testid="footer" /> }));

describe("NotFound", () => {
  test("keeps site navigation, which the root layout no longer provides", () => {
    render(<NotFound />);
    expect(screen.getByTestId("masthead")).toBeInTheDocument();
    expect(screen.getByTestId("footer")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /not found/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `pnpm --filter @onelife/web run test -- src/app/not-found.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="masthead"]`.

- [ ] **Step 7: Add the chrome to the 404 and error pages**

In `apps/web/src/app/not-found.tsx`, wrap the existing `<main>` (unchanged) and add the imports:

```tsx
import { Masthead } from "@/components/header";
import { Footer } from "@/components/footer";
import { SkewCta } from "@/components/tabloid/skew-cta";

export default function NotFound() {
  return (
    <>
      <Masthead />
      <main className="mx-auto max-w-2xl flex-1 px-6 py-16 text-center">
        {/* ...existing contents, unchanged... */}
      </main>
      <Footer />
    </>
  );
}
```

Apply the identical wrapping to `apps/web/src/app/error.tsx` (it keeps `"use client"` at the top and its existing `reset` prop).

- [ ] **Step 8: Run the full web suite**

Run: `pnpm --filter @onelife/web run test`
Expected: PASS, all files. Then `pnpm --filter @onelife/web run typecheck` — expected: no output.

- [ ] **Step 9: Verify no URL moved**

Run: `pnpm --filter @onelife/web run build`
Expected: the route table lists `/`, `/about`, `/friends`, `/players/[slug]`, `/survivors`, `/maps/[map]` and the rest exactly as before — no `/(site)` segment appears anywhere.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/app
git commit -m "refactor(web): move site chrome into a (site) route group

/maps needs a full-viewport shell with no masthead, rail or footer, and a
route cannot opt out of the root layout. The chrome moves into (site)/, which
is not a path segment, so no URL changes. not-found and error render against
the root layout and now carry the masthead and footer explicitly."
```

---

### Task 2: `pixelToWorld` and the grid reference

**Files:**
- Modify: `apps/web/src/lib/dayz-projection.ts`
- Modify: `apps/web/src/lib/dayz-projection.test.ts`
- Create: `apps/web/src/lib/map-grid.ts`
- Create: `apps/web/src/lib/map-grid.test.ts`

**Interfaces:**
- Consumes: `worldToPixel(x, y, size, canvasPx): [number, number]` (existing).
- Produces: `pixelToWorld(px: number, py: number, size: number, canvasPx: number): [number, number]` and `gridRef(x: number, y: number): string`.

- [ ] **Step 1: Write the failing round-trip test**

Append to `apps/web/src/lib/dayz-projection.test.ts`:

```ts
import { pixelToWorld, worldToPixel } from "./dayz-projection";

describe("pixelToWorld", () => {
  it("is the exact inverse of worldToPixel", () => {
    // A round trip, not a hand-computed constant: this is the property that matters, and it
    // cannot drift out of agreement with worldToPixel the way a copied literal can.
    for (const [x, y] of [[0, 0], [15360, 15360], [6780, 2320], [1, 15359]] as const) {
      const [px, py] = worldToPixel(x, y, 15360, 16384);
      const [bx, by] = pixelToWorld(px, py, 15360, 16384);
      expect(bx).toBeCloseTo(x, 6);
      expect(by).toBeCloseTo(y, 6);
    }
  });

  it("flips northing back: the top of the canvas is the top of the map", () => {
    const [, y] = pixelToWorld(0, 0, 15360, 16384);
    expect(y).toBe(15360);
  });

  it("works on a map with a different world size", () => {
    const [px, py] = worldToPixel(4000, 9000, 12800, 16384);
    const [x, y] = pixelToWorld(px, py, 12800, 16384);
    expect(x).toBeCloseTo(4000, 6);
    expect(y).toBeCloseTo(9000, 6);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @onelife/web run test -- src/lib/dayz-projection.test.ts`
Expected: FAIL — `pixelToWorld is not a function`.

- [ ] **Step 3: Implement it**

Append to `apps/web/src/lib/dayz-projection.ts`:

```ts
/**
 * Tile-pyramid pixels at max zoom → world metres. The exact inverse of `worldToPixel`,
 * including the northing flip (DayZ's origin is bottom-left; Leaflet's is top-left).
 *
 * Used by the map's coordinate readout. Keep it here, beside its inverse, so the projection
 * rules live in one module and `canvasPx` stays a single parameter.
 */
export function pixelToWorld(
  px: number, py: number, size: number, canvasPx: number,
): [number, number] {
  const k = canvasPx / size;
  return [px / k, size - py / k];
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @onelife/web run test -- src/lib/dayz-projection.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing grid test**

Create `apps/web/src/lib/map-grid.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { gridRef } from "./map-grid";

describe("gridRef", () => {
  it("reads metres as a 3-digit easting/northing pair", () => {
    expect(gridRef(6780, 2320)).toBe("067 023");
  });

  it("zero-pads, so a coordinate never changes width as you pan", () => {
    expect(gridRef(0, 0)).toBe("000 000");
    expect(gridRef(950, 120)).toBe("009 001");
  });

  it("truncates rather than rounds — a square is the square you are standing in", () => {
    expect(gridRef(6799, 2399)).toBe("067 023");
  });

  it("keeps three digits at the far edge of the biggest map", () => {
    expect(gridRef(15360, 15360)).toBe("153 153");
  });

  it("clamps a negative coordinate to zero instead of printing a minus sign", () => {
    // Panning past the map edge is normal; the readout must stay a grid reference.
    expect(gridRef(-40, -1)).toBe("000 000");
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `pnpm --filter @onelife/web run test -- src/lib/map-grid.test.ts`
Expected: FAIL — cannot resolve `./map-grid`.

- [ ] **Step 7: Implement it**

Create `apps/web/src/lib/map-grid.ts`:

```ts
/**
 * World metres → the 3-digit grid pair players say out loud ("zero six seven, zero two three").
 *
 * Metres ÷ 100, truncated (the square you are IN, not the nearest one) and zero-padded so the
 * readout never changes width while panning. Negative values — panning past the map edge —
 * clamp to zero rather than printing a minus sign that is not a grid reference.
 */
export function gridRef(x: number, y: number): string {
  const cell = (v: number) => String(Math.max(0, Math.floor(v / 100))).padStart(3, "0");
  return `${cell(x)} ${cell(y)}`;
}
```

- [ ] **Step 8: Run it and watch it pass**

Run: `pnpm --filter @onelife/web run test -- src/lib/map-grid.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/dayz-projection.ts apps/web/src/lib/dayz-projection.test.ts apps/web/src/lib/map-grid.ts apps/web/src/lib/map-grid.test.ts
git commit -m "feat(maps): pixelToWorld and grid-reference formatting"
```

---

### Task 3: Place search over the vendored data

**Files:**
- Modify: `apps/web/src/lib/map-places.ts`
- Modify: `apps/web/src/lib/map-places.test.ts`

**Interfaces:**
- Consumes: `MapPlace`, `placesFor`, `placeWeight` (existing).
- Produces: `searchPlaces(mapCodename: string, query: string, limit?: number): MapPlace[]` — default `limit` 8.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/lib/map-places.test.ts`:

```ts
import { searchPlaces } from "./map-places";

describe("searchPlaces", () => {
  it("matches case-insensitively on any part of the name", () => {
    const names = searchPlaces("chernarusplus", "sobor").map((p) => p.name);
    expect(names).toContain("Stary Sobor");
    expect(names).toContain("Novy Sobor");
  });

  it("ranks a prefix match above an interior one", () => {
    // Typing "nov" should offer Novy Sobor before Chernaya Polyana-style interior hits.
    const first = searchPlaces("chernarusplus", "nov")[0]!;
    expect(first.name.toLowerCase().startsWith("nov")).toBe(true);
  });

  it("ranks bigger places first within the same match kind", () => {
    const results = searchPlaces("chernarusplus", "a");
    const weights = results.map((p) => placeWeight(p.kind));
    // Never a faint landmark ahead of a city in the same result set.
    expect(weights.indexOf("major")).toBeLessThanOrEqual(
      weights.lastIndexOf("faint") === -1 ? weights.length : weights.lastIndexOf("faint"),
    );
  });

  it("searches every tier, not just what is drawn at the current zoom", () => {
    // A landmark is `faint` (min zoom 4) but must still be findable by name from zoom 0.
    expect(searchPlaces("chernarusplus", "green mountain").length).toBeGreaterThan(0);
  });

  it("caps the result list", () => {
    expect(searchPlaces("chernarusplus", "a").length).toBeLessThanOrEqual(8);
    expect(searchPlaces("chernarusplus", "a", 3).length).toBeLessThanOrEqual(3);
  });

  it("returns nothing for a blank query or an unknown map, rather than everything", () => {
    expect(searchPlaces("chernarusplus", "   ")).toEqual([]);
    expect(searchPlaces("banov", "sobor")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @onelife/web run test -- src/lib/map-places.test.ts`
Expected: FAIL — `searchPlaces is not a function`.

- [ ] **Step 3: Implement it**

Append to `apps/web/src/lib/map-places.ts`:

```ts
const WEIGHT_ORDER: Record<string, number> = { major: 0, minor: 1, faint: 2 };

/**
 * Name search across EVERY place on a map, regardless of the zoom tier that would draw it —
 * a landmark you cannot see yet is exactly the thing you search for by name. Flying to a
 * result zooms in far enough to render its tier.
 *
 * Ranking: prefix matches, then interior matches; within each, bigger places first, then
 * alphabetically. Purely local over the vendored data — there is no search endpoint.
 */
export function searchPlaces(mapCodename: string, query: string, limit = 8): MapPlace[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  const all = PLACES[mapCodename];
  if (!all) return [];

  return all
    .filter((p) => p.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const aPrefix = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bPrefix = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      if (aPrefix !== bPrefix) return aPrefix - bPrefix;
      const aw = WEIGHT_ORDER[placeWeight(a.kind)]!;
      const bw = WEIGHT_ORDER[placeWeight(b.kind)]!;
      if (aw !== bw) return aw - bw;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @onelife/web run test -- src/lib/map-places.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/map-places.ts apps/web/src/lib/map-places.test.ts
git commit -m "feat(maps): client-side place search over the vendored place data"
```

---

### Task 4: Teach `MapCanvas` to fly and to report its centre

**Files:**
- Modify: `apps/web/src/components/map/map-canvas.tsx`
- Modify: `apps/web/src/components/map/friends-map-draw.test.tsx`
- Modify: `apps/web/src/components/life/track-map.test.tsx` (double must gain the new Leaflet methods)

**Interfaces:**
- Consumes: `pixelToWorld` (Task 2).
- Produces, on `MapCanvas`'s props:
  - `focus?: MapFocus | null` where `export type MapFocus = { lat: number; lng: number; zoom: number; nonce: number }`
  - `onCenterChange?: (world: { x: number; y: number }) => void`

  Leaflet stays sealed in this file: consumers never receive the map instance. `nonce` exists so flying to the *same* place twice still moves the map.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe("FriendsMap drawing")` block's file (top-level, a new `describe`) in `apps/web/src/components/map/friends-map-draw.test.tsx`. Add `flyTo`, `getCenter` and `project` to the existing `mapObj` double first:

```tsx
const flyTo = vi.fn();
const project = vi.fn((_latlng: unknown, _zoom: number) => ({ x: 8192, y: 8192 }));
const getCenter = vi.fn(() => ({ lat: -128, lng: 128 }));
// ...add to mapObj: flyTo, project, getCenter
```

Then, in a new file `apps/web/src/components/map/map-canvas-view.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import MapCanvas from "./map-canvas";

const addTo = vi.fn();
const flyTo = vi.fn();
const setView = vi.fn();
const fitBounds = vi.fn();
const project = vi.fn((_l: unknown, _z: number) => ({ x: 8192, y: 4096 }));
const getCenter = vi.fn(() => ({ lat: -64, lng: 128 }));
const handlers: Record<string, Array<() => void>> = {};
const mapObj = {
  unproject: (p: [number, number]) => ({ lat: p[1], lng: p[0] }),
  fitBounds, setView, flyTo, project, getCenter,
  getZoom: () => 3,
  remove: vi.fn(),
  on: (evt: string, fn: () => void) => { (handlers[evt] ??= []).push(fn); },
  createPane: vi.fn(() => document.createElement("div")),
};
vi.mock("leaflet", () => ({
  default: {
    CRS: { Simple: "SIMPLE" },
    map: () => mapObj,
    tileLayer: () => ({ addTo }),
    polyline: () => ({ addTo }),
    circleMarker: () => ({ addTo, bindPopup: vi.fn(), bindTooltip: vi.fn() }),
    marker: () => ({ addTo }),
    divIcon: (o: unknown) => o,
    latLng: (lat: number, lng: number) => ({ lat, lng }),
    layerGroup: () => { const g = { addTo: () => g, clearLayers: vi.fn() }; return g; },
    latLngBounds: (v: unknown) => v,
  },
}));

const draw = () => [];
beforeEach(() => { vi.clearAllMocks(); for (const k of Object.keys(handlers)) delete handlers[k]; });

describe("MapCanvas focus", () => {
  it("flies to a focus target", async () => {
    render(<MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1}
      focus={{ lat: -100, lng: 50, zoom: 5, nonce: 1 }} />);
    await waitFor(() => expect(flyTo).toHaveBeenCalledTimes(1));
    expect(flyTo.mock.calls[0]![1]).toBe(5);
  });

  it("flies again when the same place is chosen twice — the nonce is what moves it", async () => {
    const target = { lat: -100, lng: 50, zoom: 5 };
    const { rerender } = render(<MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1}
      focus={{ ...target, nonce: 1 }} />);
    await waitFor(() => expect(flyTo).toHaveBeenCalledTimes(1));
    rerender(<MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1}
      focus={{ ...target, nonce: 2 }} />);
    await waitFor(() => expect(flyTo).toHaveBeenCalledTimes(2));
  });

  it("does not fly on an unrelated re-render", async () => {
    const focus = { lat: -100, lng: 50, zoom: 5, nonce: 1 };
    const { rerender } = render(<MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1} focus={focus} />);
    await waitFor(() => expect(flyTo).toHaveBeenCalledTimes(1));
    rerender(<MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={2} focus={focus} />);
    expect(flyTo).toHaveBeenCalledTimes(1);
  });
});

describe("MapCanvas onCenterChange", () => {
  it("reports the centre in world metres, not pixels or latlng", async () => {
    const onCenterChange = vi.fn();
    render(<MapCanvas mapCodename="chernarusplus" draw={draw} drawKey={1} onCenterChange={onCenterChange} />);
    await waitFor(() => expect(handlers.move?.length).toBe(1));
    handlers.move![0]!();
    await waitFor(() => expect(onCenterChange).toHaveBeenCalled());
    // project() returns pixel (8192, 4096) on a 16384 canvas over a 15360m map:
    // x = 8192/16384*15360 = 7680; y = 15360 - 4096/16384*15360 = 11520.
    expect(onCenterChange).toHaveBeenLastCalledWith({ x: 7680, y: 11520 });
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @onelife/web run test -- src/components/map/map-canvas-view.test.tsx`
Expected: FAIL — `flyTo` never called (the prop does not exist yet).

- [ ] **Step 3: Extend the Leaflet structural types**

In `apps/web/src/components/map/map-canvas.tsx`, add to `interface LeafletMap`:

```ts
  flyTo: (latlng: unknown, zoom: number) => void;
  project: (latlng: unknown, zoom: number) => { x: number; y: number };
  getCenter: () => unknown;
```

- [ ] **Step 4: Implement the two props**

Add the exported type above the component:

```ts
/** A place to fly to. `nonce` must change on every request — choosing the same search result
 *  twice is a real interaction, and comparing lat/lng alone would silently ignore the second. */
export type MapFocus = { lat: number; lng: number; zoom: number; nonce: number };
```

Add `focus` and `onCenterChange` to the props, then inside the component:

```tsx
  // Fly on a NEW focus request only. Keyed on the nonce, never on the object identity — a
  // parent re-render must not yank the view out from under someone mid-pan.
  const flownRef = useRef<number | null>(null);
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !focus || flownRef.current === focus.nonce) return;
    flownRef.current = focus.nonce;
    m.flyTo(leafletRef.current!.latLng(focus.lat, focus.lng), focus.zoom);
  }, [focus]);

  // Centre reporting, rAF-throttled: Leaflet's `move` fires many times per drag frame, and the
  // consumer re-renders a text chip on every call.
  const centerCbRef = useRef(onCenterChange);
  centerCbRef.current = onCenterChange;
  const rafRef = useRef<number | null>(null);
  function reportCenter() {
    const m = mapRef.current;
    const cb = centerCbRef.current;
    if (!m || !cb || size === null || rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const px = m.project(m.getCenter(), MAX_ZOOM);
      const [x, y] = pixelToWorld(px.x, px.y, size, CANVAS_PX);
      cb({ x, y });
    });
  }
```

Call `m.on("move", reportCenter)` and `reportCenter()` immediately after `runPlaces()` in the creation effect, and cancel any pending frame in the cleanup:

```tsx
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
```

Import `pixelToWorld` from `@/lib/dayz-projection`.

- [ ] **Step 5: Run the map and track suites**

Run: `pnpm --filter @onelife/web run test -- src/components/map src/components/life/track-map.test.tsx`
Expected: PASS. If `track-map.test.tsx` fails with `m.project is not a function`, add `flyTo`, `project` and `getCenter` to its `mapObj` double — a partial double makes the component render its error state and the failure looks unrelated.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/map apps/web/src/components/life/track-map.test.tsx
git commit -m "feat(maps): declarative focus and centre reporting on MapCanvas

Leaflet stays sealed in map-canvas; consumers pass a focus target and receive
world-metre centre updates instead of touching the map instance."
```

---

### Task 5: The shell and the top bar

**Files:**
- Create: `apps/web/src/app/maps/layout.tsx`
- Create: `apps/web/src/components/map/shell/top-bar.tsx`
- Create: `apps/web/src/components/map/shell/top-bar.test.tsx`
- Create: `apps/web/src/components/map/shell/map-switcher.tsx`
- Create: `apps/web/src/components/map/shell/map-switcher.test.tsx`
- Modify: `apps/web/src/app/maps/[map]/page.tsx`
- Modify: `apps/web/src/app/maps/[map]/loading.tsx`
- Modify: `apps/web/src/components/map/map-page.tsx`
- Modify: `apps/web/src/components/map/map-page.test.tsx`

**Interfaces:**
- Consumes: `MapServerDto` (`{ slug, name, map, friendCount }`), `getMapServers()` (both existing in `@/lib/api` / `@/lib/types`).
- Produces:
  - `TopBar(props: { slug: string; servers?: MapServerDto[]; serversLoading: boolean; children?: ReactNode })` — `children` is the right-hand control cluster later tasks fill.
  - `MapSwitcher(props: { slug: string; servers?: MapServerDto[]; loading: boolean })`.

- [ ] **Step 1: Write the failing switcher test**

Create `apps/web/src/components/map/shell/map-switcher.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MapSwitcher } from "./map-switcher";

const servers = [
  { slug: "chernarus", name: "Chernarus", map: "chernarusplus", friendCount: 2 },
  { slug: "livonia", name: "Livonia", map: "enoch", friendCount: 0 },
];

describe("MapSwitcher", () => {
  it("names the current map and links to the others", () => {
    render(<MapSwitcher slug="chernarus" servers={servers} loading={false} />);
    expect(screen.getByRole("button", { name: /chernarus/i })).toBeInTheDocument();
  });

  it("shows a friend count per map once loaded", () => {
    render(<MapSwitcher slug="chernarus" servers={servers} loading={false} />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows a loading state rather than a fabricated zero while fetching", () => {
    render(<MapSwitcher slug="chernarus" servers={undefined} loading />);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /loading|chernarus/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @onelife/web run test -- src/components/map/shell/map-switcher.test.tsx`
Expected: FAIL — cannot resolve `./map-switcher`.

- [ ] **Step 3: Implement the switcher**

Create `apps/web/src/components/map/shell/map-switcher.tsx`:

```tsx
"use client";
import Link from "next/link";
import { useState } from "react";
import { useModalBehavior } from "@/lib/use-modal-behavior";
import type { MapServerDto } from "@/lib/types";

/** Current map plus a menu of the others, with each map's friend count. On the DARK bar:
 *  paper text, dark-edge borders — never the light rail's ink tokens. */
export function MapSwitcher({ slug, servers, loading }: {
  slug: string; servers?: MapServerDto[]; loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useModalBehavior(open, () => setOpen(false));
  const current = servers?.find((s) => s.slug === slug);
  const label = current?.name ?? slug;

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 border border-dark-edge px-3 py-1.5 font-display text-sm font-bold uppercase tracking-[.06em] text-paper"
      >
        {label}
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div ref={panelRef} role="menu" className="absolute left-0 top-full z-50 mt-1 min-w-[200px] border border-dark-edge bg-dark-well">
          {(servers ?? []).map((s) => (
            <Link
              key={s.slug}
              role="menuitem"
              href={`/maps/${s.slug}`}
              onClick={() => setOpen(false)}
              className="flex items-center justify-between gap-4 px-3 py-2 font-mono text-[11px] uppercase tracking-[.05em] text-cream-dim hover:text-paper"
            >
              {s.name}
              {/* Loading is not zero: while `loading`, no count renders at all. */}
              {!loading && <span className="text-paper">{s.friendCount}</span>}
            </Link>
          ))}
          {loading && (
            <p className="px-3 py-2 font-mono text-[11px] uppercase tracking-[.05em] text-cream-muted">Loading…</p>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @onelife/web run test -- src/components/map/shell/map-switcher.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing top-bar test**

Create `apps/web/src/components/map/shell/top-bar.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TopBar } from "./top-bar";

const servers = [{ slug: "chernarus", name: "Chernarus", map: "chernarusplus", friendCount: 1 }];

describe("TopBar", () => {
  it("always offers a way off the map — the shell has no other exit", () => {
    render(<TopBar slug="chernarus" servers={servers} serversLoading={false} />);
    expect(screen.getByRole("link", { name: /back|one life/i })).toHaveAttribute("href", "/");
  });

  it("renders its control cluster", () => {
    render(
      <TopBar slug="chernarus" servers={servers} serversLoading={false}>
        <button type="button">Locate</button>
      </TopBar>,
    );
    expect(screen.getByRole("button", { name: "Locate" })).toBeInTheDocument();
  });

  it("is the z-40 layer on this route, where there is no masthead", () => {
    // LAYER LEGEND (components/header.tsx): content -> z-40 chrome -> z-50 overlays.
    // jsdom cannot observe paint order, so pin the altitude numerically.
    const { container } = render(<TopBar slug="chernarus" servers={servers} serversLoading={false} />);
    const bar = container.querySelector("header")!;
    expect(bar.className).toMatch(/\bz-40\b/);
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `pnpm --filter @onelife/web run test -- src/components/map/shell/top-bar.test.tsx`
Expected: FAIL — cannot resolve `./top-bar`.

- [ ] **Step 7: Implement the bar**

Create `apps/web/src/components/map/shell/top-bar.tsx`:

```tsx
"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import type { MapServerDto } from "@/lib/types";
import { MapSwitcher } from "./map-switcher";

/** The map application's only chrome.
 *
 *  ⚠️ LAYER LEGEND (see components/header.tsx): this route renders no masthead, so THIS is the
 *  z-40 occupant. The friends sheet is the z-50 overlay. Do not add a fourth altitude. */
export function TopBar({ slug, servers, serversLoading, children }: {
  slug: string;
  servers?: MapServerDto[];
  serversLoading: boolean;
  children?: ReactNode;
}) {
  return (
    <header className="relative z-40 flex h-12 shrink-0 items-center gap-2 border-b border-dark-edge bg-dark px-2 pt-[env(safe-area-inset-top)] md:px-4">
      <Link href="/" aria-label="Back to One Life" className="flex items-center gap-2 px-1 font-display text-sm font-bold uppercase text-paper">
        <span aria-hidden>←</span>
        <span className="hidden md:inline">One Life</span>
      </Link>
      <MapSwitcher slug={slug} servers={servers} loading={serversLoading} />
      <div className="ml-auto flex items-center gap-1">{children}</div>
    </header>
  );
}
```

- [ ] **Step 8: Create the shell layout**

Create `apps/web/src/app/maps/layout.tsx`:

```tsx
import type { ReactNode } from "react";

/** The map application shell. `/maps` sits outside the (site) route group precisely so it
 *  renders none of the site chrome — see app/(site)/layout.tsx.
 *
 *  `dvh`, not `vh`: collapsing mobile browser chrome must not push the map under the address
 *  bar. `overflow-hidden` because the map pans; the page itself never scrolls. */
export default function MapLayout({ children }: { children: ReactNode }) {
  return <div className="flex h-[100dvh] w-full flex-col overflow-hidden">{children}</div>;
}
```

- [ ] **Step 9: Rewrite the map route to fill the shell**

Replace the body of `apps/web/src/app/maps/[map]/page.tsx` (keep the `metadata` export exactly as it is):

```tsx
export default async function MapRoute({ params }: { params: Promise<{ map: string }> }) {
  const { map } = await params;
  return <MapPage slug={map} />;
}
```

`MapPage` now owns the bar and the map. In `apps/web/src/components/map/map-page.tsx`, wrap the existing view:

```tsx
export function MapPage({ slug }: { slug: string }) {
  const account = useAccountStatus();
  const verified = account.kind === "verified";
  const servers = useQuery({ queryKey: ["map-servers"], queryFn: getMapServers, enabled: verified });
  const q = useQuery({
    queryKey: ["friend-map", slug],
    queryFn: () => getFriendMap(slug),
    enabled: verified,
    refetchInterval: 30_000,
  });

  return (
    <>
      <TopBar slug={slug} servers={servers.data?.servers} serversLoading={servers.isPending} />
      {/* The five states render OVER this region with the bar still present, so the route is
          always escapable and a blank map never stands in for "nobody is here". */}
      <div className="relative min-h-0 flex-1">
        <MapPageView
          signedOut={account.kind === "signedOut"}
          unverified={account.kind === "unlinked" || account.kind === "pending"}
          loading={account.kind === "loading" || (verified && q.isPending)}
          error={q.isError && !q.data}
          data={q.data}
          now={new Date()}
        />
      </div>
    </>
  );
}
```

In `MapPageView`, wrap each non-loaded state in a centred card so it sits over the shell:

```tsx
const CARD = "absolute inset-0 z-10 flex items-center justify-center bg-dark/80 p-6 text-center";
```

Apply `CARD` to the signed-out, unverified, error and loading branches (the loading branch keeps `aria-busy` and its pulse). The loaded branch renders `<FriendsMap …/>` filling the region.

- [ ] **Step 10: Simplify the route loading skeleton**

Replace `apps/web/src/app/maps/[map]/loading.tsx` with a shell-shaped skeleton:

```tsx
export default function Loading() {
  return (
    <div aria-busy="true" className="flex h-full flex-col">
      <div aria-hidden className="h-12 shrink-0 border-b border-dark-edge bg-dark" />
      <div aria-hidden className="min-h-0 flex-1 motion-safe:animate-pulse bg-dark-well" />
    </div>
  );
}
```

- [ ] **Step 11: Update the map-page tests for the new structure**

In `apps/web/src/components/map/map-page.test.tsx`, add:

```tsx
  it("keeps the bar visible in every state, so the map is always escapable", () => {
    render(<MapPageView signedOut now={new Date()} />, { wrapper: undefined });
    // The bar lives in MapPage, not MapPageView; assert the state renders as an overlay card
    // rather than replacing the region.
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
```

- [ ] **Step 12: Run the whole web suite and typecheck**

Run: `pnpm --filter @onelife/web run test` then `pnpm --filter @onelife/web run typecheck`
Expected: PASS / no output.

- [ ] **Step 13: Commit**

```bash
git add apps/web/src/app/maps apps/web/src/components/map
git commit -m "feat(maps): full-viewport map shell with a top bar"
```

---

### Task 6: Place search in the bar

**Files:**
- Modify: `apps/web/src/components/controls/gamertag-autocomplete.tsx` (add `onDark`)
- Modify: `apps/web/src/components/controls/gamertag-autocomplete.test.tsx`
- Create: `apps/web/src/components/map/shell/place-search.tsx`
- Create: `apps/web/src/components/map/shell/place-search.test.tsx`
- Modify: `apps/web/src/components/map/map-page.tsx`

**Interfaces:**
- Consumes: `searchPlaces` (Task 3), `MapFocus` (Task 4), `GamertagAutocomplete` (existing).
- Produces: `PlaceSearch(props: { mapCodename: string; onPick: (focus: MapFocus) => void })`.

- [ ] **Step 1: Write the failing dark-token test**

Append to `apps/web/src/components/controls/gamertag-autocomplete.test.tsx`:

```tsx
  it("swaps its tokens on a dark surface", () => {
    // ⚠️ The notifications panel shipped invisible on mobile exactly this way: correct DOM,
    // fully functional, ink-on-dark. RTL asserts the DOM, not contrast, so the swap itself
    // is what must be pinned.
    const { container, rerender } = render(
      <GamertagAutocomplete value="" onChange={() => {}} fetchSuggestions={async () => []} aria-label="q" />,
    );
    const light = container.querySelector("input")!;
    expect(light).toHaveClass("text-ink");

    rerender(
      <GamertagAutocomplete onDark value="" onChange={() => {}} fetchSuggestions={async () => []} aria-label="q" />,
    );
    const dark = container.querySelector("input")!;
    expect(dark).toHaveClass("text-paper");
    expect(dark).not.toHaveClass("text-ink");
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @onelife/web run test -- src/components/controls/gamertag-autocomplete.test.tsx`
Expected: FAIL — the input keeps `text-ink`.

- [ ] **Step 3: Add the `onDark` variant**

In `apps/web/src/components/controls/gamertag-autocomplete.tsx`, add `onDark?: boolean` to the props and derive the class sets. Every token that names a light surface needs a dark counterpart — input text, placeholder, border, dropdown background, option text, and the hover/highlight state:

```tsx
  const tone = onDark
    ? { input: "bg-dark-well text-paper border-dark-edge placeholder:text-cream-muted",
        list: "bg-dark-well border-dark-edge",
        option: "text-cream-dim",
        optionActive: "bg-dark-line text-paper" }
    : { input: "bg-paper text-ink border-ink placeholder:text-ink-muted",
        list: "bg-paper border-ink",
        option: "text-ink",
        optionActive: "bg-bone text-ink" };
```

Apply `tone.*` where the hardcoded light classes are today, keeping `inputClassName` appended last so callers can still override.

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @onelife/web run test -- src/components/controls/gamertag-autocomplete.test.tsx`
Expected: PASS, including the existing combobox/ARIA tests.

- [ ] **Step 5: Write the failing place-search test**

Create `apps/web/src/components/map/shell/place-search.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlaceSearch } from "./place-search";

describe("PlaceSearch", () => {
  it("offers matching places and focuses the one picked", async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<PlaceSearch mapCodename="chernarusplus" onPick={onPick} />);

    await user.type(screen.getByRole("combobox"), "stary sobor");
    const option = await screen.findByRole("option", { name: /stary sobor/i });
    await user.click(option);

    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    const focus = onPick.mock.calls[0]![0];
    expect(focus.lat).toBeLessThan(0);   // CRS.Simple latitude is negative on this pyramid
    expect(focus.lng).toBeGreaterThan(0);
    expect(focus.zoom).toBeGreaterThanOrEqual(4); // close enough that its own tier renders
    expect(typeof focus.nonce).toBe("number");
  });

  it("gives a new nonce each time, so picking the same place twice still flies", async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<PlaceSearch mapCodename="chernarusplus" onPick={onPick} />);
    for (let i = 0; i < 2; i++) {
      await user.clear(screen.getByRole("combobox"));
      await user.type(screen.getByRole("combobox"), "vybor");
      await user.click(await screen.findByRole("option", { name: /^vybor$/i }));
    }
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(2));
    expect(onPick.mock.calls[0]![0].nonce).not.toBe(onPick.mock.calls[1]![0].nonce);
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `pnpm --filter @onelife/web run test -- src/components/map/shell/place-search.test.tsx`
Expected: FAIL — cannot resolve `./place-search`.

- [ ] **Step 7: Implement it**

Create `apps/web/src/components/map/shell/place-search.tsx`:

```tsx
"use client";
import { useCallback, useRef, useState } from "react";
import { GamertagAutocomplete } from "@/components/controls/gamertag-autocomplete";
import { searchPlaces } from "@/lib/map-places";
import type { MapFocus } from "@/components/map/map-canvas";

/** Zoom a search result flies to: past the `village` tier threshold, so the place you asked
 *  for is actually labelled when you arrive. */
const RESULT_ZOOM = 4;

/** Place search. Reuses the combobox from the controls rail rather than growing a second one —
 *  it already carries the WAI-ARIA 1.2 listbox semantics and the announced result count. Its
 *  `fetchSuggestions` is injected and may resolve synchronously; the reference must be STABLE
 *  (see that component's contract), hence useCallback. */
export function PlaceSearch({ mapCodename, onPick }: {
  mapCodename: string;
  onPick: (focus: MapFocus) => void;
}) {
  const [value, setValue] = useState("");
  const nonce = useRef(0);

  const fetchSuggestions = useCallback(
    async (q: string) => searchPlaces(mapCodename, q).map((p) => p.name),
    [mapCodename],
  );

  function handleChange(next: string) {
    setValue(next);
    const hit = searchPlaces(mapCodename, next, 1)[0];
    // The combobox reports a pick by setting the value to the exact option text.
    if (hit && hit.name.toLowerCase() === next.trim().toLowerCase()) {
      nonce.current += 1;
      onPick({ lat: hit.lat, lng: hit.lng, zoom: RESULT_ZOOM, nonce: nonce.current });
    }
  }

  return (
    <GamertagAutocomplete
      onDark
      value={value}
      onChange={handleChange}
      fetchSuggestions={fetchSuggestions}
      placeholder="Find a place…"
      aria-label="Search places on this map"
      className="w-40 md:w-56"
    />
  );
}
```

- [ ] **Step 8: Run it and watch it pass**

Run: `pnpm --filter @onelife/web run test -- src/components/map/shell/place-search.test.tsx`
Expected: PASS.

- [ ] **Step 9: Wire it into the page**

In `apps/web/src/components/map/map-page.tsx`, hold the focus state and pass it down:

```tsx
  const [focus, setFocus] = useState<MapFocus | null>(null);
  // …
  <TopBar slug={slug} servers={servers.data?.servers} serversLoading={servers.isPending}>
    <PlaceSearch mapCodename={q.data?.mapCodename ?? ""} onPick={setFocus} />
  </TopBar>
```

Thread `focus` through `MapPageView` → `FriendsMap` → `MapCanvas`'s `focus` prop. Add `focus?: MapFocus | null` to both components' props.

- [ ] **Step 10: Run the suite, typecheck, commit**

Run: `pnpm --filter @onelife/web run test && pnpm --filter @onelife/web run typecheck`

```bash
git add apps/web/src/components
git commit -m "feat(maps): place search in the map bar

Reuses the rail's combobox (ARIA semantics, announced counts) with a new
onDark variant, pinned by a test — the notifications panel shipped invisible
on the dark sheet for exactly this reason."
```

---

### Task 7: Crosshair and the coordinate chip

**Files:**
- Create: `apps/web/src/components/map/shell/coord-chip.tsx`
- Create: `apps/web/src/components/map/shell/coord-chip.test.tsx`
- Modify: `apps/web/src/components/map/friends-map.tsx`
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**
- Consumes: `gridRef` (Task 2), `onCenterChange` (Task 4).
- Produces: `CoordChip(props: { world: { x: number; y: number } | null })`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/map/shell/coord-chip.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CoordChip } from "./coord-chip";

describe("CoordChip", () => {
  it("reads out the grid square under the crosshair", () => {
    render(<CoordChip world={{ x: 6780, y: 2320 }} />);
    expect(screen.getByText("067 023")).toBeInTheDocument();
  });

  it("renders nothing until the map has reported a centre", () => {
    const { container } = render(<CoordChip world={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is not a live region — announcing every frame of a pan is unusable", () => {
    render(<CoordChip world={{ x: 100, y: 100 }} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("copies the pair, and says so in the button's accessible name", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const user = userEvent.setup();
    render(<CoordChip world={{ x: 6780, y: 2320 }} />);
    const button = screen.getByRole("button", { name: /copy .*067 023/i });
    await user.click(button);
    expect(writeText).toHaveBeenCalledWith("067 023");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @onelife/web run test -- src/components/map/shell/coord-chip.test.tsx`
Expected: FAIL — cannot resolve `./coord-chip`.

- [ ] **Step 3: Implement it**

Create `apps/web/src/components/map/shell/coord-chip.tsx`:

```tsx
"use client";
import { useState } from "react";
import { gridRef } from "@/lib/map-grid";

/** The grid reference under the centre crosshair.
 *
 *  Deliberately NOT a live region: this updates on every animation frame of a pan, and a
 *  polite live region would read a new coordinate continuously. The value is available on
 *  demand through the copy button's accessible name — which is also the point of a readout,
 *  since you read a coordinate in order to send it to someone. */
export function CoordChip({ world }: { world: { x: number; y: number } | null }) {
  const [copied, setCopied] = useState(false);
  if (!world) return null;
  const ref = gridRef(world.x, world.y);

  async function copy() {
    try {
      await navigator.clipboard.writeText(ref);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // A denied clipboard permission must not break the readout; the value stays on screen.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy grid reference ${ref}`}
      className="pointer-events-auto absolute bottom-3 left-3 z-10 border border-dark-edge bg-dark px-2 py-1 font-mono text-[11px] uppercase tracking-[.08em] text-paper tabular-nums"
    >
      {copied ? "Copied" : ref}
    </button>
  );
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @onelife/web run test -- src/components/map/shell/coord-chip.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the crosshair and wire the chip**

In `apps/web/src/components/map/friends-map.tsx`, hold the centre and render both over the canvas:

```tsx
  const [world, setWorld] = useState<{ x: number; y: number } | null>(null);
  // …
  <div className="relative h-full w-full">
    <MapCanvas mapCodename={data.mapCodename} draw={draw} drawKey={data}
      className="h-full w-full" focus={focus} onCenterChange={setWorld} />
    {/* Decorative: the chip below carries the same information as text. */}
    <span aria-hidden className="map-crosshair" />
    <CoordChip world={world} />
  </div>
```

Add to `apps/web/src/app/globals.css`:

```css
/* Centre crosshair for the map's coordinate readout. Pointer-events off — it must never
   intercept a drag. Two hairlines rather than a glyph, so it stays legible on any tile. */
.map-crosshair {
  height: 18px;
  left: 50%;
  pointer-events: none;
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 18px;
  z-index: 10;
}
.map-crosshair::before,
.map-crosshair::after {
  background: rgb(var(--paper));
  box-shadow: 0 0 0 1px rgb(var(--dark) / 0.7);
  content: "";
  position: absolute;
}
.map-crosshair::before { height: 100%; left: 50%; transform: translateX(-50%); width: 1px; }
.map-crosshair::after { height: 1px; top: 50%; transform: translateY(-50%); width: 100%; }
```

- [ ] **Step 6: Run the suite, typecheck, commit**

Run: `pnpm --filter @onelife/web run test && pnpm --filter @onelife/web run typecheck`

```bash
git add apps/web/src/components/map apps/web/src/app/globals.css
git commit -m "feat(maps): centre crosshair with a copyable grid reference"
```

---

### Task 8: Locate, and the friends panel

**Files:**
- Create: `apps/web/src/components/map/shell/locate-button.tsx`
- Create: `apps/web/src/components/map/shell/locate-button.test.tsx`
- Create: `apps/web/src/components/map/shell/friends-panel.tsx`
- Create: `apps/web/src/components/map/shell/friends-panel.test.tsx`
- Modify: `apps/web/src/components/map/map-page.tsx`
- Modify: `apps/web/src/components/map/friends-map.tsx` (drop the under-map legend; it moves into the panel)

**Interfaces:**
- Consumes: `FriendPositionDto`, `FriendsMapLegend`, `positionAge` (existing), `MapFocus` (Task 4).
- Produces:
  - `LocateButton(props: { self: FriendPositionDto | undefined; loading: boolean; onLocate: (focus: MapFocus) => void })`
  - `FriendsPanel(props: { positions: FriendPositionDto[] | undefined; loading: boolean; now: Date })`

- [ ] **Step 1: Write the failing test for `worldToLatLng`**

`LocateButton` has to name a point in the same space `MapCanvas` draws in, without touching
Leaflet (the lifecycle stays sealed in that file). That conversion belongs beside the other
projection rules.

Append to `apps/web/src/lib/dayz-projection.test.ts`:

```ts
import { worldToLatLng } from "./dayz-projection";

describe("worldToLatLng", () => {
  it("agrees with the vendored place data — the independent check on this projection", () => {
    // map-places.json stores Chernogorsk at lat -217.3037679, lng 112.9769857, produced by
    // DZMap rather than by us. If our metres -> CRS.Simple conversion disagrees with that,
    // every flown-to target lands somewhere the labels are not.
    const { lat, lng } = worldToLatLng(6780, 2320, 15360, 16384, 6);
    expect(lat).toBeCloseTo(-217.3, 1);
    expect(lng).toBeCloseTo(112.98, 1);
  });

  it("scales with zoom, not with the map size alone", () => {
    const a = worldToLatLng(6780, 2320, 15360, 16384, 6);
    const b = worldToLatLng(6780, 2320, 15360, 16384, 5);
    expect(b.lng).toBeCloseTo(a.lng * 2, 6);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @onelife/web run test -- src/lib/dayz-projection.test.ts`
Expected: FAIL — `worldToLatLng is not a function`.

- [ ] **Step 3: Implement `worldToLatLng`**

Append to `apps/web/src/lib/dayz-projection.ts`:

```ts
/**
 * World metres → the Leaflet `CRS.Simple` latLng that `MapCanvas` draws in.
 *
 * For consumers that need to NAME a point ("fly to my dot") without holding a map instance —
 * the Leaflet lifecycle stays sealed in map-canvas.tsx. CRS.Simple divides the pixel plane by
 * 2**zoom and flips y, which is why this is not just `worldToPixel`.
 */
export function worldToLatLng(
  x: number, y: number, size: number, canvasPx: number, maxZoom: number,
): { lat: number; lng: number } {
  const [px, py] = worldToPixel(x, y, size, canvasPx);
  const scale = 2 ** maxZoom;
  return { lat: -py / scale, lng: px / scale };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @onelife/web run test -- src/lib/dayz-projection.test.ts`
Expected: PASS. Both assertions matter: the first proves our projection agrees with the data
DZMap produced, the second that the zoom term is real.

- [ ] **Step 5: Export the pyramid constants**

In `apps/web/src/components/map/map-canvas.tsx`, change `const MAX_ZOOM` and `const CANVAS_PX`
to `export const MAX_ZOOM` and `export const CANVAS_PX`. They are already the single source of
truth for the pyramid; `LocateButton` must read them rather than restate them.

- [ ] **Step 6: Write the failing locate test**

Create `apps/web/src/components/map/shell/locate-button.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocateButton } from "./locate-button";

const self = { gamertag: "You", x: 6780, y: 2320, recordedAt: "2026-07-22T12:00:00Z", self: true };

describe("LocateButton", () => {
  it("flies to your own dot", async () => {
    const onLocate = vi.fn();
    await userEvent.setup().click(
      render(<LocateButton self={self} loading={false} onLocate={onLocate} />)
        .getByRole?.("button") ?? screen.getByRole("button"),
    );
    expect(onLocate).toHaveBeenCalledTimes(1);
    expect(onLocate.mock.calls[0]![0].zoom).toBeGreaterThanOrEqual(4);
  });

  it("is disabled WITH A REASON when you have no live position", () => {
    render(<LocateButton self={undefined} loading={false} onLocate={() => {}} />);
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    // Never a control that silently does nothing.
    expect(button).toHaveAccessibleDescription(/offline|not seen|no position/i);
  });

  it("does not claim you are offline while the position is still loading", () => {
    render(<LocateButton self={undefined} loading onLocate={() => {}} />);
    expect(screen.getByRole("button")).toHaveAccessibleDescription(/loading/i);
  });
});
```

- [ ] **Step 7: Run it and watch it fail**

Run: `pnpm --filter @onelife/web run test -- src/components/map/shell/locate-button.test.tsx`
Expected: FAIL — cannot resolve `./locate-button`.

- [ ] **Step 8: Implement it**

Create `apps/web/src/components/map/shell/locate-button.tsx`:

```tsx
"use client";
import { useId, useRef } from "react";
import { worldSize, worldToLatLng } from "@/lib/dayz-projection";
import { CANVAS_PX, MAX_ZOOM, type MapFocus } from "@/components/map/map-canvas";
import type { FriendPositionDto } from "@/lib/types";

const LOCATE_ZOOM = 5;

/** Recentre on your own dot.
 *
 *  Three distinct states, never collapsed: ready, loading, and genuinely-no-position. A
 *  disabled control with no stated reason is indistinguishable from a broken one, and
 *  "loading" must not render as "you are offline" (live-data honesty). */
export function LocateButton({ self, loading, onLocate, mapCodename }: {
  self: FriendPositionDto | undefined;
  loading: boolean;
  onLocate: (focus: MapFocus) => void;
  mapCodename: string;
}) {
  const nonce = useRef(0);
  const hintId = useId();
  const size = worldSize(mapCodename);
  const ready = !loading && self !== undefined && size !== null;
  const hint = loading
    ? "Loading your position…"
    : "No live position — you appear offline, or have not been seen in game yet.";

  return (
    <>
      <button
        type="button"
        disabled={!ready}
        aria-describedby={ready ? undefined : hintId}
        onClick={() => {
          if (!self || size === null) return;
          nonce.current += 1;
          // The SAME projection MapCanvas draws in, via the shared helper and the canvas's own
          // pyramid constants — never restated arithmetic, which would drift silently.
          const { lat, lng } = worldToLatLng(self.x, self.y, size, CANVAS_PX, MAX_ZOOM);
          onLocate({ lat, lng, zoom: LOCATE_ZOOM, nonce: nonce.current });
        }}
        className="border border-dark-edge px-2 py-1.5 font-mono text-[11px] uppercase tracking-[.05em] text-paper disabled:text-cream-muted"
      >
        <span aria-hidden>◎</span>
        <span className="ml-1 hidden md:inline">Locate</span>
      </button>
      {!ready && <span id={hintId} className="sr-only">{hint}</span>}
    </>
  );
}
```

- [ ] **Step 9: Run it and watch it pass**

Run: `pnpm --filter @onelife/web run test -- src/components/map/shell/locate-button.test.tsx`
Expected: PASS.

- [ ] **Step 10: Write the failing friends-panel test**

Create `apps/web/src/components/map/shell/friends-panel.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FriendsPanel } from "./friends-panel";

const NOW = new Date("2026-07-22T12:00:00Z");
const positions = [
  { gamertag: "You", x: 1, y: 2, recordedAt: "2026-07-22T11:59:00Z", self: true },
  { gamertag: "Mate", x: 3, y: 4, recordedAt: "2026-07-22T11:50:00Z", self: false },
];

describe("FriendsPanel", () => {
  it("opens a list of who is sharing, with each dot's own age", async () => {
    render(<FriendsPanel positions={positions} loading={false} now={NOW} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /friends/i }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/10m ago/)).toBeInTheDocument();
  });

  it("counts only friends, not your own dot", () => {
    render(<FriendsPanel positions={positions} loading={false} now={NOW} />);
    expect(screen.getByRole("button", { name: /friends 1/i })).toBeInTheDocument();
  });

  it("shows a loading state instead of a fabricated zero", () => {
    render(<FriendsPanel positions={undefined} loading now={NOW} />);
    expect(screen.getByRole("button", { name: /friends/i })).not.toHaveAccessibleName(/friends 0/i);
  });

  it("says plainly when nobody is sharing", async () => {
    render(<FriendsPanel positions={[]} loading={false} now={NOW} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /friends/i }));
    expect(screen.getByText(/nobody is sharing/i)).toBeInTheDocument();
  });

  it("uses dark tokens — it is mounted on the dark bar, not the light rail", () => {
    const { container } = render(<FriendsPanel positions={positions} loading={false} now={NOW} />);
    expect(container.querySelector("button")!.className).toMatch(/text-paper/);
  });
});
```

- [ ] **Step 11: Run it and watch it fail**

Run: `pnpm --filter @onelife/web run test -- src/components/map/shell/friends-panel.test.tsx`
Expected: FAIL — cannot resolve `./friends-panel`.

- [ ] **Step 12: Implement it**

Create `apps/web/src/components/map/shell/friends-panel.tsx`. It wraps the existing `FriendsMapLegend` — which stays the screen-reader companion to a canvas with no text, and therefore must be reached by a real button in the tab order:

```tsx
"use client";
import { useState } from "react";
import { useModalBehavior } from "@/lib/use-modal-behavior";
import { FriendsMapLegend } from "@/components/map/friends-map";
import type { FriendPositionDto } from "@/lib/types";

export function FriendsPanel({ positions, loading, now }: {
  positions: FriendPositionDto[] | undefined;
  loading: boolean;
  now: Date;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useModalBehavior(open, () => setOpen(false));
  // Loading is not zero. Until the payload lands, the button carries no count at all.
  const count = loading || !positions ? null : positions.filter((p) => !p.self).length;

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 border border-dark-edge px-2 py-1.5 font-mono text-[11px] uppercase tracking-[.05em] text-paper"
      >
        <span aria-hidden>☰</span>
        <span className="hidden md:inline">Friends</span>
        {count !== null && <span>{count}</span>}
      </button>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Friends sharing on this map"
          className="fixed inset-x-0 bottom-0 z-50 max-h-[60dvh] overflow-y-auto border-t border-dark-edge bg-dark-well p-4 pb-[env(safe-area-inset-bottom)] md:absolute md:inset-x-auto md:right-0 md:top-full md:bottom-auto md:mt-1 md:w-72 md:border"
        >
          <FriendsMapLegend positions={positions ?? []} now={now} onDark />
        </div>
      )}
    </div>
  );
}
```

Add an `onDark?: boolean` prop to `FriendsMapLegend` in `friends-map.tsx` swapping `text-ink`/`text-ink-muted` for `text-paper`/`text-cream-muted`, and stop rendering the legend under the map — the panel is now its only home.

- [ ] **Step 13: Wire both into the bar**

In `apps/web/src/components/map/map-page.tsx`:

```tsx
  <TopBar slug={slug} servers={servers.data?.servers} serversLoading={servers.isPending}>
    <PlaceSearch mapCodename={q.data?.mapCodename ?? ""} onPick={setFocus} />
    <LocateButton
      self={q.data?.positions.find((p) => p.self)}
      loading={q.isPending}
      mapCodename={q.data?.mapCodename ?? ""}
      onLocate={setFocus}
    />
    <FriendsPanel positions={q.data?.positions} loading={q.isPending} now={new Date()} />
  </TopBar>
```

- [ ] **Step 14: Run the suite, typecheck, commit**

Run: `pnpm --filter @onelife/web run test && pnpm --filter @onelife/web run typecheck`

```bash
git add apps/web/src/components apps/web/src/lib
git commit -m "feat(maps): locate control and the friends panel"
```

---

### Task 9: The browser verification pass (mandatory)

**Files:** none — this task changes no code unless it finds a defect.

**Interfaces:**
- Consumes: everything above, deployed or running locally against real tiles.

> **Why this task exists.** Two releases shipped today with green suites and broken rendering: v0.38.1's "solid background" painted an 8×2px dash because Leaflet writes an inline `width: 0` that beat the class rule, and both v0.38.0 and v0.38.1 were styled for dark tiles when the tiles are pale. jsdom cannot observe layout, paint, or stacking. **A green suite is not evidence that this feature works.** Do not mark the plan complete without this pass.

- [ ] **Step 1: Get a real map on screen**

Either deploy, or run the web app locally against an environment whose `/tiles/` are mirrored. A local run with no tiles is **not** sufficient — it renders every label and chip over a plain dark background, which is exactly the case that has already hidden two defects.

- [ ] **Step 2: Crosshair accuracy**

Pan so the crosshair sits on the centre of a town whose position is independently known (Chernogorsk, ~6780 / 2320 → `067 023`). The chip must read that pair. A uniform offset means `CANVAS_PX` or the `pixelToWorld` inverse is wrong, not the chip.

- [ ] **Step 3: Legibility**

Check the chip, the place labels, and the bar over pale farmland, dark forest, and water. Anything that disappears against one of the three is a defect in this pass, not a follow-up.

- [ ] **Step 4: The 360px viewport**

At 360px wide: the bar does not wrap or overflow; the expanded search field is usable and its dropdown is readable (dark tokens, not ink-on-dark); the map switcher menu does not run off-screen.

- [ ] **Step 5: The friends sheet**

Open it on a narrow viewport. It must sit over the map, trap focus, close on Escape, and return focus to the ☰ button. Confirm it is not painted behind the map or the bar.

- [ ] **Step 6: Search**

Search a place with a near-duplicate name (`Novaya Petrovka` vs `Novy Sobor`) and confirm the map lands on the right one and that its label is rendered when you arrive.

- [ ] **Step 7: Record the result**

If everything passes, note it in the PR description as browser-verified, listing what was checked. If anything fails, fix it and repeat this task — do not defer a rendering defect found here to a later release.

---

## Self-Review

**Spec coverage:** §3.1 routing → Task 1. §3.2 viewport/layers → Tasks 1, 5. §4 bar → Tasks 5, 6, 8. §5 search → Tasks 3, 6. §6 coordinates → Tasks 2, 7. §7 legend and honest states → Tasks 5, 8. §8 testing → every task, plus Task 9. §9 out-of-scope → nothing in this plan touches pins, measuring, offline tiles, or server payloads.

**Type consistency:** `MapFocus` is defined in Task 4 and consumed with the same four fields (`lat`, `lng`, `zoom`, `nonce`) in Tasks 6, 7 and 8. `onCenterChange` reports `{ x, y }` world metres in Task 4 and is consumed as `{ x, y }` by `CoordChip` in Task 7. `MapServerDto` is used with the field names the existing API already returns.

**Placeholder scan:** one was found and fixed. Task 8's `LocateButton` originally showed inline lat/lng arithmetic with a note telling the implementer to replace it — a plan failure by the skill's own rule. `worldToLatLng` is now built first, in its own TDD cycle (Task 8 steps 1-5), tested against the coordinates DZMap itself produced for Chernogorsk, and the click handler calls it using `MapCanvas`'s exported pyramid constants. No step now describes work without showing it.
