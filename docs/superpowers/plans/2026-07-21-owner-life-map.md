# Owner-Only Life Location Map — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the verified owner of a gamertag a map of where they went during one life — a per-session route trail plus approximate kill/death markers — on `/players/[slug]/[map]/lives/[n]`, including lives that are still open.

**Architecture:** A new read model is the first ever consumer of the long-populated `positions` projection table. A new API route under `/me/*` serves it; that route takes **no player identifier**, deriving the subject entirely from the session cookie, so serving another player's coordinates is unexpressible rather than merely guarded. The web page stays a public server component with no coordinates in its HTML; the owner's browser fetches the track client-side and renders it with plain Leaflet over self-hosted DayZ tiles.

**Tech Stack:** TypeScript/ESM, Fastify, Drizzle + Postgres, Next.js 15 (App Router, React 19), TanStack Query v5, Vitest, Leaflet 1.9 (imperative — **not** react-leaflet, whose v4 does not support React 19).

**Spec:** `docs/superpowers/specs/2026-07-21-owner-life-map-design.md`. Read it before starting. Where this plan and the spec disagree, the spec wins and the plan is wrong.

## Global Constraints

- **The coordinates endpoint accepts no player identifier.** `GET /me/lives/:mapSlug/:n/track`. The subject gamertag comes only from `getSession` → a `status = 'verified'` `gamertag_links` row. Never accept a gamertag, slug, or user id from the caller. (Spec §3.1)
- **A `pending` gamertag link is never sufficient.** `verified` only. (Spec §3.1)
- **Ownership is a WHERE-clause predicate, never a post-filter.** (Spec §3.2)
- **The response sets `Cache-Control: no-store, private`.** (Spec §3.3)
- **No coordinates in server-rendered HTML, and none in the public `/players/...` API.** (Spec §3.4, §3.6)
- **No coordinates in any log line or error message.** (Spec §3.5)
- **Every marker is approximate.** No `approximate?: boolean` flag; `sampleAgeSeconds` is non-optional. (Spec §4.3)
- **Marker staleness cutoff: 900 seconds.** Past that, render no marker. (Spec §4.4)
- **Thinning: drop samples within 15 m of the last kept sample; hard cap 1500 points.** (Spec §4.2)
- **Presence cap is `lastSeenAt ?? connectedAt`, with NO `Math.min(now, …)` clamp.** (Spec §4.5, CLAUDE.md live-data-honesty invariant 2)
- **Trail polylines are per-session, never one continuous line.** (Spec §4.1)
- **Loading, empty, and failed are three distinct rendered states.** (Spec §4.6)
- **The Leaflet container carries `isolate`.** Leaflet's controls sit at `z-index: 1000` and would paint over the `z-40` masthead and `z-50` sheet. (Spec §5.2)
- **No migration, and no new table.** This feature reads the existing `positions` projection. Nothing is added to `packages/test-support/src/global-setup.ts`'s `APP_TABLES`, and the release deploys with a plain `./deploy/deploy.sh` — **no `--rebuild`**.
- Run tests with `pnpm turbo run test --concurrency=1`; DB suites need `TEST_DATABASE_URL`. Typecheck with `pnpm turbo run typecheck`.
- Commit after every task. Never commit on `develop`/`main`.

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/read-models/src/life-track-shape.ts` (new) | Pure shaping: thinning, session segmentation, nearest-preceding-sample matching. No DB, no I/O. |
| `packages/read-models/test/life-track-shape.test.ts` (new) | Pure unit tests for the above. |
| `packages/read-models/src/life-track.ts` (new) | `getLifeTrack` — queries `positions`/`sessions`/`kills`/`lives`, delegates all shaping to `life-track-shape.ts`. |
| `packages/read-models/test/life-track.test.ts` (new) | DB test against the Postgres harness. |
| `packages/read-models/src/index.ts` (modify) | Barrel export. |
| `apps/api/src/routes/life-track.ts` (new) | The owner-gated route. |
| `apps/api/src/app.ts` (modify) | Register it inside the `if (opts)` auth block. |
| `apps/api/test/life-track-routes.test.ts` (new) | Security tests first. |
| `apps/web/src/lib/dayz-projection.ts` (new) | Pure world→pixel projection + per-map world sizes. |
| `apps/web/src/lib/dayz-projection.test.ts` (new) | Pure unit tests. |
| `apps/web/src/lib/types.ts` (modify) | `LifeTrack` DTO. |
| `apps/web/src/lib/api.ts` (modify) | `getLifeTrack` client fn. |
| `apps/web/src/lib/use-life-track.ts` (new) | TanStack Query hook, owner-gated + 60s poll on open lives. |
| `apps/web/src/components/life/track-map.tsx` (new) | Imperative Leaflet client component. |
| `apps/web/src/components/life/track-marker-list.tsx` (new) | The accessible text equivalent (`role="list"`). |
| `apps/web/src/components/life/location-panel.tsx` (new) | Owns the owner/withheld/loading/empty/error decision. |
| `apps/web/src/components/life/timeline.tsx` (modify) | Accept an optional slot in place of `WithheldBar`. |
| `apps/web/src/app/players/[slug]/[map]/lives/[n]/page.tsx` (modify) | Mount the panel. |
| `deploy/mirror-tiles.sh` (new) | One-time DZMap tile mirror. |
| `deploy/README.md` (modify) | Tile prerequisite + nginx block. |

---

### Task 1: Pure world→pixel projection

**Files:**
- Create: `apps/web/src/lib/dayz-projection.ts`
- Test: `apps/web/src/lib/dayz-projection.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `MAP_WORLD_SIZE: Record<string, number>`, `worldSize(mapCodename: string): number | null`, `worldToPixel(x: number, y: number, size: number, canvasPx: number): [number, number]`.

Background: Leaflet's `CRS.Simple` is fed pixel coordinates at the tile pyramid's max zoom, which the component converts with `map.unproject(point, MAX_ZOOM)`. DayZ's origin is bottom-left with `y` as northing; Leaflet's pixel origin is top-left with `y` growing downward, so `y` is flipped. `canvasPx` is an explicit parameter rather than a derived constant because the exact pixel extent of the DZMap pyramid is verified against real tiles in Task 8 — keeping it a parameter means correcting it later touches one call site, not this function.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/dayz-projection.test.ts
import { describe, it, expect } from "vitest";
import { MAP_WORLD_SIZE, worldSize, worldToPixel } from "./dayz-projection";

describe("worldSize", () => {
  it("knows the three maps we run", () => {
    expect(MAP_WORLD_SIZE.chernarusplus).toBe(15360);
    expect(MAP_WORLD_SIZE.sakhal).toBe(15360);
    expect(MAP_WORLD_SIZE.enoch).toBe(12800);
  });

  it("returns null for an unknown codename rather than guessing a size", () => {
    expect(worldSize("banov")).toBeNull();
  });
});

describe("worldToPixel", () => {
  it("puts the world origin at the BOTTOM-left of the canvas", () => {
    expect(worldToPixel(0, 0, 15360, 16384)).toEqual([0, 16384]);
  });

  it("puts the world's north-east corner at the top-right", () => {
    expect(worldToPixel(15360, 15360, 15360, 16384)).toEqual([16384, 0]);
  });

  it("scales the centre to the canvas centre", () => {
    expect(worldToPixel(7680, 7680, 15360, 16384)).toEqual([8192, 8192]);
  });

  it("flips y — a northern position maps to a SMALLER pixel y than a southern one", () => {
    const [, north] = worldToPixel(0, 12000, 15360, 16384);
    const [, south] = worldToPixel(0, 3000, 15360, 16384);
    expect(north).toBeLessThan(south);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/web exec vitest run src/lib/dayz-projection.test.ts`
Expected: FAIL — "Failed to resolve import ./dayz-projection".

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/web/src/lib/dayz-projection.ts

/** DayZ world extents in metres, keyed by `servers.map` (the mission codename).
 *  `enoch` is Livonia. A codename absent here yields null — we never guess a size,
 *  because a wrong size silently misplaces every point on the map. */
export const MAP_WORLD_SIZE: Record<string, number> = {
  chernarusplus: 15360,
  sakhal: 15360,
  enoch: 12800,
};

export function worldSize(mapCodename: string): number | null {
  return MAP_WORLD_SIZE[mapCodename] ?? null;
}

/**
 * World metres → tile-pyramid pixels at max zoom.
 *
 * DayZ's origin is bottom-left with y as northing; Leaflet's pixel origin is top-left
 * with y growing downward, so y is flipped. `canvasPx` is the pixel extent of the tile
 * pyramid at max zoom and is passed in rather than derived — see the comment in
 * track-map.tsx for how it is established against the real tiles.
 */
export function worldToPixel(
  x: number, y: number, size: number, canvasPx: number,
): [number, number] {
  const k = canvasPx / size;
  return [x * k, (size - y) * k];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/web exec vitest run src/lib/dayz-projection.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/dayz-projection.ts apps/web/src/lib/dayz-projection.test.ts
git commit -m "feat(web): pure DayZ world-to-pixel projection for the life map"
```

---

### Task 2: Pure track shaping

**Files:**
- Create: `packages/read-models/src/life-track-shape.ts`
- Test: `packages/read-models/test/life-track-shape.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `TrackPoint = { x: number; y: number; at: Date }`
  - `TrackSegment = { sessionId: number; points: TrackPoint[] }`
  - `TrackMarkerKind = "kill" | "death" | "now"`
  - `TrackMarker = { kind: TrackMarkerKind; at: Date; x: number; y: number; sampleAt: Date; sampleAgeSeconds: number; label: string | null }`
  - `THIN_MIN_METERS = 15`, `TRACK_POINT_CAP = 1500`, `MARKER_MAX_AGE_SECONDS = 900`
  - `thinTrack(points: TrackPoint[]): TrackPoint[]`
  - `segmentBySession(points: TrackPoint[], sessions: { id: number; connectedAt: Date; endedAt: Date }[]): TrackSegment[]`
  - `markerAt(points: TrackPoint[], kind: TrackMarkerKind, at: Date, label: string | null): TrackMarker | null`

- [ ] **Step 1: Write the failing test**

```ts
// packages/read-models/test/life-track-shape.test.ts
import { describe, it, expect } from "vitest";
import {
  thinTrack, segmentBySession, markerAt,
  THIN_MIN_METERS, TRACK_POINT_CAP, MARKER_MAX_AGE_SECONDS,
  type TrackPoint,
} from "../src/life-track-shape.js";

const t0 = new Date("2026-07-14T00:00:00Z");
const at = (s: number) => new Date(t0.getTime() + s * 1000);
const p = (x: number, y: number, s: number): TrackPoint => ({ x, y, at: at(s) });

describe("thinTrack", () => {
  it("keeps the first point always", () => {
    expect(thinTrack([p(100, 100, 0)])).toHaveLength(1);
  });

  it("drops a sample within 15m of the last KEPT point", () => {
    // An idle player parked in a base — this is the bulk of real volume, not travel.
    const out = thinTrack([p(0, 0, 0), p(5, 0, 10), p(9, 0, 20), p(14, 0, 30)]);
    expect(out).toHaveLength(1);
  });

  it("keeps a sample beyond 15m", () => {
    const out = thinTrack([p(0, 0, 0), p(20, 0, 10)]);
    expect(out).toHaveLength(2);
  });

  it("measures from the last KEPT point, not the previous raw one", () => {
    // Three 10m steps: cumulative 30m. Measuring pairwise would drop all three.
    const out = thinTrack([p(0, 0, 0), p(10, 0, 1), p(20, 0, 2), p(30, 0, 3)]);
    expect(out.map((q) => q.x)).toEqual([0, 20, 30]);
  });

  it("always keeps the FINAL point even if it is within the threshold", () => {
    // The last fix is the whole point of an open life — it must never be thinned away.
    const out = thinTrack([p(0, 0, 0), p(100, 0, 10), p(102, 0, 20)]);
    expect(out.at(-1)!.x).toBe(102);
  });

  it("caps at TRACK_POINT_CAP, keeping the earliest points and the final one", () => {
    const many = Array.from({ length: 5000 }, (_, i) => p(i * 100, 0, i));
    const out = thinTrack(many);
    expect(out).toHaveLength(TRACK_POINT_CAP);
    expect(out.at(-1)!.x).toBe(4999 * 100);
  });

  it("returns an empty array for no input", () => {
    expect(thinTrack([])).toEqual([]);
  });
});

describe("segmentBySession", () => {
  const sessions = [
    { id: 1, connectedAt: at(0), endedAt: at(100) },
    { id: 2, connectedAt: at(500), endedAt: at(600) },
  ];

  it("splits points into one segment per session", () => {
    const out = segmentBySession([p(0, 0, 10), p(1, 1, 50), p(2, 2, 550)], sessions);
    expect(out.map((s) => s.sessionId)).toEqual([1, 2]);
    expect(out[0]!.points).toHaveLength(2);
    expect(out[1]!.points).toHaveLength(1);
  });

  it("never joins across a session gap — the logout-teleport line must not exist", () => {
    const out = segmentBySession([p(0, 0, 10), p(9999, 9999, 550)], sessions);
    expect(out).toHaveLength(2);
  });

  it("drops points falling in no session", () => {
    expect(segmentBySession([p(0, 0, 300)], sessions)).toEqual([]);
  });

  it("omits a session with no points rather than emitting an empty segment", () => {
    const out = segmentBySession([p(0, 0, 10)], sessions);
    expect(out).toHaveLength(1);
  });

  it("includes points exactly on both session boundaries", () => {
    const out = segmentBySession([p(0, 0, 0), p(1, 1, 100)], sessions);
    expect(out[0]!.points).toHaveLength(2);
  });
});

describe("markerAt", () => {
  const pts = [p(10, 10, 0), p(20, 20, 60), p(30, 30, 120)];

  it("uses the last sample AT OR BEFORE the event", () => {
    const m = markerAt(pts, "kill", at(90), "Victim1");
    expect(m).not.toBeNull();
    expect(m!.x).toBe(20);
    expect(m!.sampleAgeSeconds).toBe(30);
  });

  it("never selects a sample AFTER the event", () => {
    // The fix at t=120 is nearer in absolute time to t=110 than the one at t=60,
    // but it is in the future relative to the event and must not be used.
    const m = markerAt(pts, "kill", at(110), null);
    expect(m!.x).toBe(20);
  });

  it("accepts a sample exactly at the event time with age 0", () => {
    const m = markerAt(pts, "death", at(60), null);
    expect(m!.sampleAgeSeconds).toBe(0);
  });

  it("returns null past the 900s staleness cutoff", () => {
    const m = markerAt(pts, "death", at(120 + MARKER_MAX_AGE_SECONDS + 1), null);
    expect(m).toBeNull();
  });

  it("returns a marker exactly at the cutoff", () => {
    const m = markerAt(pts, "death", at(120 + MARKER_MAX_AGE_SECONDS), null);
    expect(m).not.toBeNull();
  });

  it("returns null when no sample precedes the event", () => {
    expect(markerAt(pts, "kill", at(-10), null)).toBeNull();
  });

  it("returns null for an empty track", () => {
    expect(markerAt([], "death", at(0), null)).toBeNull();
  });

  it("carries the label through", () => {
    expect(markerAt(pts, "kill", at(60), "Victim1")!.label).toBe("Victim1");
  });
});

describe("constants match the spec", () => {
  it("pins the three tuning numbers", () => {
    expect(THIN_MIN_METERS).toBe(15);
    expect(TRACK_POINT_CAP).toBe(1500);
    expect(MARKER_MAX_AGE_SECONDS).toBe(900);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/read-models exec vitest run test/life-track-shape.test.ts`
Expected: FAIL — cannot resolve `../src/life-track-shape.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/read-models/src/life-track-shape.ts

/** Pure shaping for the owner-only life map. No DB, no I/O — every rule here is a
 *  product decision from the spec and must stay inspectable in isolation. */

export interface TrackPoint { x: number; y: number; at: Date }
export interface TrackSegment { sessionId: number; points: TrackPoint[] }
export type TrackMarkerKind = "kill" | "death" | "now";

/**
 * Deaths and kills carry NO recorded coordinates (adm-parser's death.ts never parses
 * `pos=`, and `kills` has no x/y). Every marker is therefore the last position sample
 * before the event — approximate by construction. There is deliberately no
 * `approximate?: boolean` flag: a flag can be forgotten at a render site, whereas a
 * non-optional `sampleAgeSeconds` must be actively discarded to be ignored.
 */
export interface TrackMarker {
  kind: TrackMarkerKind;
  at: Date;
  x: number;
  y: number;
  sampleAt: Date;
  sampleAgeSeconds: number;
  label: string | null;
}

export const THIN_MIN_METERS = 15;
export const TRACK_POINT_CAP = 1500;
/** Past 15 minutes a survivor covers kilometres; a confidently-placed wrong pin is worse
 *  than no pin at all. */
export const MARKER_MAX_AGE_SECONDS = 900;

function far(a: TrackPoint, b: TrackPoint): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) >= THIN_MIN_METERS;
}

/** Distance-threshold thinning, measured against the last KEPT point so a slow walk
 *  accumulates instead of being dropped pairwise. The final point is always kept — on an
 *  open life it is the whole answer. */
export function thinTrack(points: TrackPoint[]): TrackPoint[] {
  if (points.length === 0) return [];
  const kept: TrackPoint[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const q = points[i]!;
    if (far(kept[kept.length - 1]!, q)) kept.push(q);
  }
  const last = points[points.length - 1]!;
  if (kept[kept.length - 1] !== last) kept.push(last);
  if (kept.length <= TRACK_POINT_CAP) return kept;
  // Keep the earliest points and the true final fix; the caller reports the honest
  // pre-thinning `sampleCount` so the UI can say the trail is truncated.
  return [...kept.slice(0, TRACK_POINT_CAP - 1), last];
}

/** One polyline per session. Joining across a session gap would draw a straight line
 *  across a logout/login the player never walked. */
export function segmentBySession(
  points: TrackPoint[],
  sessions: { id: number; connectedAt: Date; endedAt: Date }[],
): TrackSegment[] {
  const out: TrackSegment[] = [];
  for (const s of sessions) {
    const from = s.connectedAt.getTime();
    const to = s.endedAt.getTime();
    const inside = points.filter((p) => {
      const t = p.at.getTime();
      return t >= from && t <= to;
    });
    if (inside.length > 0) out.push({ sessionId: s.id, points: inside });
  }
  return out;
}

/** The last sample at or before `at`. Never a later one: a fix from after the event is
 *  where the player went next, not where the event happened. */
export function markerAt(
  points: TrackPoint[], kind: TrackMarkerKind, at: Date, label: string | null,
): TrackMarker | null {
  let best: TrackPoint | null = null;
  for (const p of points) {
    if (p.at.getTime() <= at.getTime() && (!best || p.at.getTime() > best.at.getTime())) best = p;
  }
  if (!best) return null;
  const sampleAgeSeconds = Math.round((at.getTime() - best.at.getTime()) / 1000);
  if (sampleAgeSeconds > MARKER_MAX_AGE_SECONDS) return null;
  return { kind, at, x: best.x, y: best.y, sampleAt: best.at, sampleAgeSeconds, label };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/read-models exec vitest run test/life-track-shape.test.ts`
Expected: PASS, 24 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/read-models/src/life-track-shape.ts packages/read-models/test/life-track-shape.test.ts
git commit -m "feat(read-models): pure shaping for life position tracks"
```

---

### Task 3: The `getLifeTrack` read model

**Files:**
- Create: `packages/read-models/src/life-track.ts`
- Modify: `packages/read-models/src/index.ts`
- Test: `packages/read-models/test/life-track.test.ts`

**Interfaces:**
- Consumes: everything Task 2 produces.
- Produces: `LifeTrack` and
  `getLifeTrack(db: Database, serverId: number, gamertag: string, lifeNumber: number): Promise<LifeTrack | null>`

```ts
export interface LifeTrack {
  mapCodename: string;
  segments: TrackSegment[];
  markers: TrackMarker[];
  sampleCount: number;   // pre-thinning, so the UI can say a trail was truncated
  truncated: boolean;
  alive: boolean;
}
```

Note the signature takes **`lifeNumber`**, not `lifeId` — the route only ever has a life number from the URL, and resolving it here keeps the gamertag in the same WHERE clause that finds the life (Global Constraint: ownership is a predicate, not a post-filter).

- [ ] **Step 1: Write the failing test**

```ts
// packages/read-models/test/life-track.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, kills, positions } from "@onelife/db";
import { getLifeTrack } from "../src/life-track.js";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 52e7;
const start = new Date("2026-07-14T00:00:00Z");
const mins = (m: number) => new Date(start.getTime() + m * 60_000);
const tag = `TrkHero-${svc}`;
const other = `TrkOther-${svc}`;

let serverId: number;
let pid: number;
let otherPid: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({
    nitradoServiceId: svc, name: "trk", map: "enoch", slug: `trk-${svc}`, active: true,
  }).returning();
  serverId = s!.id;

  const [p] = await db.insert(players).values({ gamertag: tag, lastSeenAt: mins(200) }).returning();
  pid = p!.id;
  const [o] = await db.insert(players).values({ gamertag: other, lastSeenAt: mins(200) }).returning();
  otherPid = o!.id;

  // Life 1: closed, two sessions with a gap between them.
  const [l1] = await db.insert(lives).values({
    serverId, playerId: pid, lifeNumber: 1, startedAt: start, endedAt: mins(120),
    deathCause: "pvp", deathByGamertag: "Killer", playtimeSeconds: 7200,
  }).returning();
  await db.insert(sessions).values([
    { serverId, playerId: pid, lifeId: l1!.id, connectedAt: start, disconnectedAt: mins(30), durationSeconds: 1800, closeReason: "disconnect" },
    { serverId, playerId: pid, lifeId: l1!.id, connectedAt: mins(60), disconnectedAt: mins(120), durationSeconds: 3600, closeReason: "death" },
  ]);
  await db.insert(kills).values({
    serverId, killerGamertag: tag, victimGamertag: "Victim1", weapon: "KAS-74U", distance: 25, occurredAt: mins(70),
  });
  // Fixes: two in session 1 (far apart so neither is thinned), two in session 2.
  await db.insert(positions).values([
    { serverId, playerId: pid, gamertag: tag, x: 1000, y: 1000, recordedAt: mins(5) },
    { serverId, playerId: pid, gamertag: tag, x: 2000, y: 2000, recordedAt: mins(25) },
    { serverId, playerId: pid, gamertag: tag, x: 5000, y: 5000, recordedAt: mins(65) },
    { serverId, playerId: pid, gamertag: tag, x: 6000, y: 6000, recordedAt: mins(119) },
  ]);

  // Life 2: open.
  const [l2] = await db.insert(lives).values({
    serverId, playerId: pid, lifeNumber: 2, startedAt: mins(150), endedAt: null, playtimeSeconds: 0,
  }).returning();
  await db.insert(sessions).values({
    serverId, playerId: pid, lifeId: l2!.id, connectedAt: mins(150), disconnectedAt: null, durationSeconds: null, closeReason: null,
  });
  await db.insert(positions).values({
    serverId, playerId: pid, gamertag: tag, x: 7000, y: 7000, recordedAt: mins(199),
  });

  // Another player's life 1 on the same server, with its own fixes.
  const [ol] = await db.insert(lives).values({
    serverId, playerId: otherPid, lifeNumber: 1, startedAt: start, endedAt: mins(60), playtimeSeconds: 3600,
  }).returning();
  await db.insert(sessions).values({
    serverId, playerId: otherPid, lifeId: ol!.id, connectedAt: start, disconnectedAt: mins(60), durationSeconds: 3600, closeReason: "death",
  });
  await db.insert(positions).values({
    serverId, playerId: otherPid, gamertag: other, x: 9999, y: 9999, recordedAt: mins(10),
  });
});

afterAll(async () => { await sql.end(); });

describe("getLifeTrack", () => {
  it("returns the map codename so the client can pick the right projection", async () => {
    const t = await getLifeTrack(db, serverId, tag, 1);
    expect(t!.mapCodename).toBe("enoch");
  });

  it("segments per session and never joins across the gap", async () => {
    const t = await getLifeTrack(db, serverId, tag, 1);
    expect(t!.segments).toHaveLength(2);
    expect(t!.segments[0]!.points).toHaveLength(2);
    expect(t!.segments[1]!.points).toHaveLength(2);
  });

  it("emits an approximate kill marker from the preceding fix", async () => {
    const t = await getLifeTrack(db, serverId, tag, 1);
    const k = t!.markers.find((m) => m.kind === "kill");
    expect(k!.x).toBe(5000);
    expect(k!.label).toBe("Victim1");
    expect(k!.sampleAgeSeconds).toBe(300); // 65m fix, 70m kill
  });

  it("emits a death marker for a closed life and no `now` marker", async () => {
    const t = await getLifeTrack(db, serverId, tag, 1);
    expect(t!.markers.some((m) => m.kind === "death")).toBe(true);
    expect(t!.markers.some((m) => m.kind === "now")).toBe(false);
    expect(t!.alive).toBe(false);
  });

  it("emits a `now` marker for an open life and no death marker", async () => {
    const t = await getLifeTrack(db, serverId, tag, 2);
    expect(t!.markers.some((m) => m.kind === "now")).toBe(true);
    expect(t!.markers.some((m) => m.kind === "death")).toBe(false);
    expect(t!.alive).toBe(true);
  });

  it("reports the honest pre-thinning sample count", async () => {
    const t = await getLifeTrack(db, serverId, tag, 1);
    expect(t!.sampleCount).toBe(4);
    expect(t!.truncated).toBe(false);
  });

  it("NEVER returns another player's fixes, even on the same server and life number", async () => {
    const t = await getLifeTrack(db, serverId, tag, 1);
    const xs = t!.segments.flatMap((s) => s.points.map((p) => p.x));
    expect(xs).not.toContain(9999);
  });

  it("returns null for a life number that gamertag does not have", async () => {
    expect(await getLifeTrack(db, serverId, tag, 99)).toBeNull();
  });

  it("returns null for a gamertag with no lives at all", async () => {
    expect(await getLifeTrack(db, serverId, `Ghost-${svc}`, 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/read-models exec vitest run test/life-track.test.ts`
Expected: FAIL — cannot resolve `../src/life-track.js`. (Needs `TEST_DATABASE_URL`.)

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/read-models/src/life-track.ts
import type { Database } from "@onelife/db";
import { servers, players, lives, sessions, kills, positions } from "@onelife/db";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import {
  thinTrack, segmentBySession, markerAt, TRACK_POINT_CAP,
  type TrackPoint, type TrackSegment, type TrackMarker,
} from "./life-track-shape.js";

export interface LifeTrack {
  mapCodename: string;
  segments: TrackSegment[];
  markers: TrackMarker[];
  /** Pre-thinning count, so the UI can honestly say a trail was truncated. */
  sampleCount: number;
  truncated: boolean;
  alive: boolean;
}

/**
 * The owner-only position track for one life.
 *
 * `gamertag` is a WHERE-clause predicate on every query, never a post-filter — a life
 * belonging to another player produces no rows and a null return, so there is no
 * intermediate state holding someone else's coordinates that a later bug could leak.
 * The caller (the /me route) derives that gamertag from the session cookie alone.
 */
export async function getLifeTrack(
  db: Database, serverId: number, gamertag: string, lifeNumber: number,
): Promise<LifeTrack | null> {
  const [row] = await db
    .select({
      lifeId: lives.id,
      startedAt: lives.startedAt,
      endedAt: lives.endedAt,
      map: servers.map,
      lastSeenAt: players.lastSeenAt,
    })
    .from(lives)
    .innerJoin(players, eq(players.id, lives.playerId))
    .innerJoin(servers, eq(servers.id, lives.serverId))
    .where(and(
      eq(lives.serverId, serverId),
      eq(lives.lifeNumber, lifeNumber),
      sql`lower(${players.gamertag}) = lower(${gamertag})`,
    ));
  if (!row) return null;

  // An open life's window ends at the presence cap — `lastSeenAt ?? connectedAt`, with NO
  // Math.min(now, …) clamp. `servers.clockOffsetMs` means a real lastSeenAt can land a few
  // seconds ahead of request-time now, and clamping would diverge from survivors.ts's
  // livePlaytime cap and the dossier's cap in queries.ts.
  const sessionRows = await db
    .select({ id: sessions.id, connectedAt: sessions.connectedAt, disconnectedAt: sessions.disconnectedAt })
    .from(sessions)
    .where(and(eq(sessions.serverId, serverId), eq(sessions.lifeId, row.lifeId)))
    .orderBy(asc(sessions.connectedAt));

  const cap = row.endedAt ?? row.lastSeenAt ?? row.startedAt;
  const windows = sessionRows.map((s) => ({
    id: s.id,
    connectedAt: s.connectedAt,
    endedAt: s.disconnectedAt ?? (cap > s.connectedAt ? cap : s.connectedAt),
  }));

  const windowEnd = row.endedAt ?? cap;
  const posRows = await db
    .select({ x: positions.x, y: positions.y, recordedAt: positions.recordedAt })
    .from(positions)
    .where(and(
      eq(positions.serverId, serverId),
      sql`lower(${positions.gamertag}) = lower(${gamertag})`,
      gte(positions.recordedAt, row.startedAt),
      lte(positions.recordedAt, windowEnd),
    ))
    .orderBy(asc(positions.recordedAt));

  const raw: TrackPoint[] = posRows.map((p) => ({ x: p.x, y: p.y, at: p.recordedAt }));
  const thinned = thinTrack(raw);
  const segments = segmentBySession(thinned, windows);

  const killRows = await db
    .select({ victimGamertag: kills.victimGamertag, occurredAt: kills.occurredAt })
    .from(kills)
    .where(and(
      eq(kills.serverId, serverId),
      sql`lower(${kills.killerGamertag}) = lower(${gamertag})`,
      gte(kills.occurredAt, row.startedAt),
      lte(kills.occurredAt, windowEnd),
    ))
    .orderBy(asc(kills.occurredAt));

  const markers: TrackMarker[] = [];
  for (const k of killRows) {
    const m = markerAt(thinned, "kill", k.occurredAt, k.victimGamertag);
    if (m) markers.push(m);
  }
  const terminal = row.endedAt
    ? markerAt(thinned, "death", row.endedAt, null)
    : thinned.length > 0
      ? markerAt(thinned, "now", thinned[thinned.length - 1]!.at, null)
      : null;
  if (terminal) markers.push(terminal);

  return {
    mapCodename: row.map,
    segments,
    markers,
    sampleCount: raw.length,
    truncated: thinned.length >= TRACK_POINT_CAP,
    alive: row.endedAt === null,
  };
}
```

- [ ] **Step 4: Export from the barrel**

Append to `packages/read-models/src/index.ts`:

```ts
export * from "./life-track-shape.js";
export * from "./life-track.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @onelife/read-models exec vitest run test/life-track.test.ts`
Expected: PASS, 9 tests.

Then: `pnpm --filter @onelife/read-models run typecheck`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/read-models/src/life-track.ts packages/read-models/src/life-track-shape.ts \
        packages/read-models/src/index.ts packages/read-models/test/life-track.test.ts
git commit -m "feat(read-models): getLifeTrack — first consumer of the positions table"
```

---

### Task 4: The owner-gated API route

**Files:**
- Create: `apps/api/src/routes/life-track.ts`
- Modify: `apps/api/src/app.ts:45` (register inside the `if (opts)` block)
- Test: `apps/api/test/life-track-routes.test.ts`

**Interfaces:**
- Consumes: `getLifeTrack` from Task 3; `getSession` from `apps/api/src/auth-plugin.js`; `resolveServerBySlug` from `apps/api/src/lib/` (used by `player-aggregate.ts` — reuse it, do not reimplement).
- Produces: `registerLifeTrackRoutes(app: FastifyInstance, db: Database, auth: Auth): void`

**This task's tests are security tests. Write them first and see them fail.**

- [ ] **Step 1: Write the failing security tests**

```ts
// apps/api/test/life-track-routes.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, servers, players, lives, sessions, positions, gamertagLinks } from "@onelife/db";
import { eq } from "drizzle-orm";
import { createAuth, type Mailer } from "@onelife/auth";
import { buildApp } from "../src/app.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 61e7;
const email = `trk${svc}@example.com`;
const mine = `TrkMine-${svc}`;
const theirs = `TrkTheirs-${svc}`;

let lastLink = "";
const captureMailer: Mailer = { async send(msg) { lastLink = msg.url; } };
const auth = createAuth(db, {
  secret: "s".repeat(32), baseURL: "http://localhost", trustedOrigins: ["http://localhost"],
  providers: {}, mailer: captureMailer,
});
const app = buildApp(db, { auth, corsOrigins: ["http://localhost"] });

function cookieHeader(setCookie: string | string[] | undefined): string {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr.map((c) => c.split(";")[0]).join("; ");
}

let cookie = "";
let userId = "";
let slug = "";
const start = new Date("2026-07-14T00:00:00Z");
const mins = (m: number) => new Date(start.getTime() + m * 60_000);

async function signIn(): Promise<void> {
  await app.inject({
    method: "POST", url: "/api/auth/sign-in/magic-link",
    headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost" },
    payload: { email },
  });
  const verifyPath = lastLink.replace(/^https?:\/\/[^/]+/, "");
  const verify = await app.inject({ method: "GET", url: verifyPath, headers: { host: "localhost" } });
  cookie = cookieHeader(verify.headers["set-cookie"] as string | string[] | undefined);
}

beforeAll(async () => {
  await app.ready();
  await signIn();
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  userId = u!.id;

  slug = `trk-${svc}`;
  const [s] = await db.insert(servers).values({
    nitradoServiceId: svc, name: "trk", map: "chernarusplus", slug, active: true,
  }).returning();

  for (const [tag, x] of [[mine, 1000], [theirs, 9999]] as const) {
    const [p] = await db.insert(players).values({ gamertag: tag, lastSeenAt: mins(200) }).returning();
    const [l] = await db.insert(lives).values({
      serverId: s!.id, playerId: p!.id, lifeNumber: 1, startedAt: start, endedAt: mins(120),
      playtimeSeconds: 7200,
    }).returning();
    await db.insert(sessions).values({
      serverId: s!.id, playerId: p!.id, lifeId: l!.id, connectedAt: start,
      disconnectedAt: mins(120), durationSeconds: 7200, closeReason: "death",
    });
    await db.insert(positions).values({
      serverId: s!.id, playerId: p!.id, gamertag: tag, x, y: x, recordedAt: mins(10),
    });
  }
});

afterAll(async () => { await sql.end(); });

const url = (n = 1) => `/api/me/lives/${slug}/${n}/track`;

describe("GET /me/lives/:mapSlug/:n/track — access control", () => {
  it("401s with no session", async () => {
    const r = await app.inject({ method: "GET", url: url() });
    expect(r.statusCode).toBe(401);
    expect(r.json().error).toBe("unauthorized");
  });

  it("403s for a signed-in user with NO gamertag link", async () => {
    const r = await app.inject({ method: "GET", url: url(), headers: { cookie } });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe("not_verified");
  });

  it("403s for a PENDING link — a claim is not proof", async () => {
    await db.insert(gamertagLinks).values({ userId, gamertag: mine, status: "pending" });
    const r = await app.inject({ method: "GET", url: url(), headers: { cookie } });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe("not_verified");
    await db.delete(gamertagLinks).where(eq(gamertagLinks.userId, userId));
  });

  it("200s once the link is verified, and returns only the caller's own fixes", async () => {
    await db.insert(gamertagLinks).values({ userId, gamertag: mine, status: "verified" });
    const r = await app.inject({ method: "GET", url: url(), headers: { cookie } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    const xs = body.segments.flatMap((s: { points: { x: number }[] }) => s.points.map((p) => p.x));
    expect(xs).toContain(1000);
    expect(xs).not.toContain(9999);
  });

  it("sets Cache-Control: no-store so no proxy or CDN can hand this to the next visitor", async () => {
    const r = await app.inject({ method: "GET", url: url(), headers: { cookie } });
    expect(r.headers["cache-control"]).toContain("no-store");
  });

  it("404s for a life number the caller's gamertag does not have", async () => {
    const r = await app.inject({ method: "GET", url: url(99), headers: { cookie } });
    expect(r.statusCode).toBe(404);
  });

  it("404s for an unknown server slug", async () => {
    const r = await app.inject({ method: "GET", url: `/api/me/lives/nope-${svc}/1/track`, headers: { cookie } });
    expect(r.statusCode).toBe(404);
  });

  it("exposes NO parameter that could name another player", async () => {
    // The route path is /me/lives/:mapSlug/:n/track — there is nowhere to put a gamertag.
    // Query params are ignored entirely; the subject comes from the session.
    const r = await app.inject({
      method: "GET", url: `${url()}?gamertag=${encodeURIComponent(theirs)}`, headers: { cookie },
    });
    expect(r.statusCode).toBe(200);
    const xs = r.json().segments.flatMap((s: { points: { x: number }[] }) => s.points.map((p) => p.x));
    expect(xs).not.toContain(9999);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @onelife/api exec vitest run test/life-track-routes.test.ts`
Expected: FAIL — every case 404s, because the route does not exist yet.

- [ ] **Step 3: Confirm the helper name before implementing**

Run: `grep -rn "resolveServerBySlug" apps/api/src`
Expected: a definition plus its use in `routes/player-aggregate.ts`. Import from wherever that definition lives — do not write a second copy.

- [ ] **Step 4: Write minimal implementation**

```ts
// apps/api/src/routes/life-track.ts
import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import type { Auth } from "@onelife/auth";
import { gamertagLinks } from "@onelife/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getSession } from "../auth-plugin.js";
import { getLifeTrack } from "@onelife/read-models";
import { resolveServerBySlug } from "./player-aggregate.js"; // adjust to the real location

const params = z.object({
  mapSlug: z.string().min(1),
  n: z.coerce.number().int().positive(),
});

/**
 * The owner-only position track for one life.
 *
 * SECURITY: this route takes NO player identifier. The subject gamertag is derived
 * solely from the session cookie via a `verified` gamertag_links row, so requesting
 * another player's coordinates is unexpressible rather than merely rejected. Do not
 * add a gamertag/slug/userId parameter here for any reason — the public life route
 * (/players/:gamertag/:map/lives/:n) is the place for identified, coordinate-free data.
 *
 * A `pending` link is deliberately insufficient: anyone can type any gamertag into the
 * claim box, so only a link that survived emote verification unlocks coordinates.
 */
export function registerLifeTrackRoutes(app: FastifyInstance, db: Database, auth: Auth): void {
  app.get("/me/lives/:mapSlug/:n/track", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });

    const [link] = await db
      .select({ gamertag: gamertagLinks.gamertag })
      .from(gamertagLinks)
      .where(and(
        eq(gamertagLinks.userId, session.user.id),
        eq(gamertagLinks.status, "verified"),
      ));
    if (!link) return reply.code(403).send({ error: "not_verified" });

    const { mapSlug, n } = params.parse(req.params);
    const server = await resolveServerBySlug(db, mapSlug);
    if (!server) return reply.code(404).send({ error: "not_found" });

    const track = await getLifeTrack(db, server.id, link.gamertag, n);
    if (!track) return reply.code(404).send({ error: "not_found" });

    // A shared proxy or CDN caching this would hand one owner's position to the next
    // visitor — the classic way a correct auth check still leaks.
    reply.header("cache-control", "no-store, private");
    return track;
  });
}
```

- [ ] **Step 5: Register the route**

In `apps/api/src/app.ts`, add the import beside the other route imports:

```ts
import { registerLifeTrackRoutes } from "./routes/life-track.js";
```

and the registration **inside the `if (opts)` block**, immediately after `registerNotificationRoutes(...)`:

```ts
    registerLifeTrackRoutes(app, db, opts.auth);
```

It must be inside `if (opts)` — the route needs `opts.auth`, and a coordinates route that registers without auth configured is exactly the failure this whole design exists to prevent.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @onelife/api exec vitest run test/life-track-routes.test.ts`
Expected: PASS, 8 tests.

Then confirm nothing else broke: `pnpm --filter @onelife/api exec vitest run`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/life-track.ts apps/api/src/app.ts apps/api/test/life-track-routes.test.ts
git commit -m "feat(api): owner-gated life position track route"
```

---

### Task 5: Web DTO, API client, and query hook

**Files:**
- Modify: `apps/web/src/lib/types.ts`
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/lib/use-life-track.ts`

**Interfaces:**
- Consumes: the Task 4 route.
- Produces:
  - `LifeTrack`, `TrackSegmentDto`, `TrackMarkerDto` in `types.ts` (dates are **ISO strings** over the wire, matching every other DTO in this file)
  - `getLifeTrack(mapSlug: string, n: number): Promise<LifeTrack | null>` in `api.ts`
  - `useLifeTrack(mapSlug: string, n: number, enabled: boolean, alive: boolean)` in `use-life-track.ts`

- [ ] **Step 1: Add the DTO types**

Append to `apps/web/src/lib/types.ts`:

```ts
export interface TrackPointDto { x: number; y: number; at: string }
export interface TrackSegmentDto { sessionId: number; points: TrackPointDto[] }

/** Every marker is approximate — deaths and kills carry no recorded coordinates, so this
 *  is the last position fix before the event. `sampleAgeSeconds` is non-optional so a
 *  render site must actively discard it to omit the staleness. */
export interface TrackMarkerDto {
  kind: "kill" | "death" | "now";
  at: string;
  x: number;
  y: number;
  sampleAt: string;
  sampleAgeSeconds: number;
  label: string | null;
}

export interface LifeTrack {
  mapCodename: string;
  segments: TrackSegmentDto[];
  markers: TrackMarkerDto[];
  sampleCount: number;
  truncated: boolean;
  alive: boolean;
}
```

Add `LifeTrack` to the type import list at the top of `apps/web/src/lib/api.ts`.

- [ ] **Step 2: Add the client function**

Append near `getPlayerLife` in `apps/web/src/lib/api.ts`:

```ts
/** Owner-only. Returns null when the caller is not the verified owner, or the life does
 *  not exist — the UI must not distinguish those two for a stranger. */
export const getLifeTrack = (mapSlug: string, n: number) =>
  getOrNull<LifeTrack>(`/api/me/lives/${encodeURIComponent(mapSlug)}/${n}/track`);
```

- [ ] **Step 3: Note why the hook catches 403 locally**

`getOrNull` in `api.ts` maps **only 404** to null and rethrows everything else. A 403 would therefore surface as an error banner to a signed-in non-owner — wrong, because a non-owner is not an error state. Do **not** widen the shared `getOrNull`; every other caller relies on a 403 throwing. Catch it locally in `useLifeTrack`, as Step 4 does.

- [ ] **Step 4: Write the hook**

```ts
// apps/web/src/lib/use-life-track.ts
"use client";
import { useQuery } from "@tanstack/react-query";
import { getLifeTrack, ApiError } from "./api";

/**
 * `enabled` is the client-side owner guess and is a UX optimisation ONLY — it decides
 * whether to make a request that would otherwise 403. The real gate is the API route,
 * which derives the subject from the session cookie. Never treat this flag as security.
 *
 * The 60s poll matches useNotifications, not the 5s verification poll: nobody is sitting
 * and waiting on a position fix, and the underlying data only advances when the game
 * server writes a new ADM line.
 */
export function useLifeTrack(mapSlug: string, n: number, enabled: boolean, alive: boolean) {
  return useQuery({
    queryKey: ["life-track", mapSlug, n],
    queryFn: async () => {
      try {
        return await getLifeTrack(mapSlug, n);
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) return null;
        throw e;
      }
    },
    enabled,
    refetchInterval: alive ? 60_000 : false,
  });
}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @onelife/web run typecheck`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/types.ts apps/web/src/lib/api.ts apps/web/src/lib/use-life-track.ts
git commit -m "feat(web): life track DTO, client, and owner-gated query hook"
```

---

### Task 6: The Leaflet map component

**Files:**
- Create: `apps/web/src/components/life/track-map.tsx`
- Test: `apps/web/src/components/life/track-map.test.tsx`
- Modify: `apps/web/package.json` (add `leaflet`, `@types/leaflet`)

**Interfaces:**
- Consumes: `worldToPixel`/`worldSize` (Task 1), `LifeTrack` DTO (Task 5).
- Produces: `TrackMap({ track }: { track: LifeTrack })` — default-exported so it can be `dynamic(..., { ssr: false })`'d.

**Do not use `react-leaflet`.** Its v4 line does not support React 19, which this app is on. Plain `leaflet` driven from a `useEffect` has no such constraint and no wrapper to keep in sync.

- [ ] **Step 1: Add the dependency**

```bash
pnpm --filter @onelife/web add leaflet@^1.9.4
pnpm --filter @onelife/web add -D @types/leaflet@^1.9.12
```

- [ ] **Step 2: Write the failing test**

```tsx
// apps/web/src/components/life/track-map.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import TrackMap from "./track-map";
import type { LifeTrack } from "@/lib/types";

// jsdom has no layout, so Leaflet itself cannot initialise meaningfully. We assert the
// container contract, which is what actually regresses — not Leaflet's own behaviour.
vi.mock("leaflet", () => ({ default: { map: () => ({ setView: () => {}, remove: () => {} }) } }));

const track: LifeTrack = {
  mapCodename: "chernarusplus",
  segments: [{ sessionId: 1, points: [{ x: 1000, y: 1000, at: "2026-07-14T00:05:00Z" }] }],
  markers: [],
  sampleCount: 1,
  truncated: false,
  alive: false,
};

describe("TrackMap", () => {
  it("cages Leaflet in its own stacking context", () => {
    // Leaflet puts its controls at z-index 1000, which would paint over the z-40 masthead
    // and the z-50 controls sheet. `isolate` confines every Leaflet z-index to this box.
    // jsdom cannot observe paint order, so this pins the mechanism instead.
    const { container } = render(<TrackMap track={track} />);
    expect(container.querySelector(".isolate")).not.toBeNull();
  });

  it("renders an explicit notice for a map codename we have no world size for", () => {
    render(<TrackMap track={{ ...track, mapCodename: "banov" }} />);
    expect(screen.getByText(/unmapped terrain/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @onelife/web exec vitest run src/components/life/track-map.test.tsx`
Expected: FAIL — cannot resolve `./track-map`.

- [ ] **Step 4: Write the implementation**

```tsx
// apps/web/src/components/life/track-map.tsx
"use client";
import { useEffect, useRef } from "react";
import { worldSize, worldToPixel } from "@/lib/dayz-projection";
import type { LifeTrack } from "@/lib/types";

/** DZMap's vanilla pyramid tops out at zoom 6. The pixel extent of the pyramid at that
 *  zoom is 256 * 2**6 = 16384. If the mirrored tiles turn out to use a different max
 *  zoom, change these two together — worldToPixel takes canvasPx as a parameter
 *  precisely so this stays a one-line correction. */
const MAX_ZOOM = 6;
const CANVAS_PX = 256 * 2 ** MAX_ZOOM;

const MARKER_COLOR: Record<LifeTrack["markers"][number]["kind"], string> = {
  kill: "#c8102e",
  death: "#1b1b1b",
  now: "#2563eb",
};

export default function TrackMap({ track }: { track: LifeTrack }) {
  const ref = useRef<HTMLDivElement>(null);
  const size = worldSize(track.mapCodename);

  useEffect(() => {
    if (!ref.current || size === null) return;
    let cancelled = false;
    let map: { remove: () => void } | null = null;

    // Dynamically imported so Leaflet never enters the server bundle and never runs
    // during SSR — the page must stay coordinate-free on the server.
    void import("leaflet").then((mod) => {
      if (cancelled || !ref.current) return;
      const L = mod.default;
      const m = L.map(ref.current, {
        crs: L.CRS.Simple, minZoom: 0, maxZoom: MAX_ZOOM, attributionControl: false,
      });
      map = m;
      const pt = (x: number, y: number) => m.unproject(worldToPixel(x, y, size, CANVAS_PX), MAX_ZOOM);

      // errorTileUrl blank + a dark backdrop on the container: when tiles are absent
      // (dev, or before the mirror has run) the trail still reads, instead of showing a
      // broken-tile checkerboard that looks like a broken feature.
      L.tileLayer(`/tiles/${track.mapCodename}/terrain/{z}/{x}/{y}.webp`, {
        minZoom: 0, maxZoom: MAX_ZOOM, noWrap: true,
        errorTileUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
      }).addTo(m);

      const all: ReturnType<typeof pt>[] = [];
      for (const seg of track.segments) {
        const latlngs = seg.points.map((p) => pt(p.x, p.y));
        all.push(...latlngs);
        if (latlngs.length > 1) L.polyline(latlngs, { color: "#c8102e", weight: 2 }).addTo(m);
      }
      for (const mk of track.markers) {
        const c = L.circleMarker(pt(mk.x, mk.y), {
          radius: 6, color: MARKER_COLOR[mk.kind], weight: 2, fill: false,
          dashArray: "3 3", // dashed = approximate, always
        }).addTo(m);
        all.push(pt(mk.x, mk.y));
        c.bindPopup(`${mk.kind}${mk.label ? ` — ${mk.label}` : ""} · fix ${mk.sampleAgeSeconds}s earlier`);
      }
      if (all.length > 0) m.fitBounds(L.latLngBounds(all), { padding: [24, 24] });
      else m.setView(pt(size / 2, size / 2), 1);
    });

    return () => { cancelled = true; map?.remove(); };
  }, [track, size]);

  if (size === null) {
    return (
      <p className="border border-hairline bg-bone px-4 py-3 font-mono text-[11px] text-ink-soft">
        Unmapped terrain — the desk has no chart for this server.
      </p>
    );
  }

  // `isolate` is load-bearing, not cosmetic. See the LAYER LEGEND at the <header> in
  // header.tsx: the app has exactly three z-altitudes (content, z-40 masthead, z-50
  // overlays). Leaflet assigns its panes 200-700 and its controls 1000, absolutely
  // positioned — without a stacking context here it paints straight over the masthead,
  // the notification popover and the ControlsSheet.
  return <div ref={ref} className="isolate h-[420px] w-full border border-ink bg-dark-well" />;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @onelife/web exec vitest run src/components/life/track-map.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/life/track-map.tsx apps/web/src/components/life/track-map.test.tsx \
        apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): Leaflet track map, caged in its own stacking context"
```

---

### Task 7: Accessible marker list, the location panel, and placement

**Files:**
- Create: `apps/web/src/components/life/track-marker-list.tsx`
- Create: `apps/web/src/components/life/track-marker-list.test.tsx`
- Create: `apps/web/src/components/life/location-panel.tsx`
- Create: `apps/web/src/components/life/location-panel.test.tsx`
- Modify: `apps/web/src/components/life/timeline.tsx`
- Modify: `apps/web/src/app/players/[slug]/[map]/lives/[n]/page.tsx`

**Interfaces:**
- Consumes: `useLifeTrack` (Task 5), `TrackMap` (Task 6), `useSession`/`useGamertagLinks`/`activeLink` (existing), `LifeTrack` DTO.
- Produces:
  - `TrackMarkerList({ markers }: { markers: TrackMarkerDto[] })`
  - `LocationPanel({ mapSlug, lifeNumber, pageGamertag, alive }: {...})`
  - `Timeline` gains an optional `locationSlot?: React.ReactNode` prop.

- [ ] **Step 1: Write the failing marker-list test**

```tsx
// apps/web/src/components/life/track-marker-list.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TrackMarkerList } from "./track-marker-list";
import type { TrackMarkerDto } from "@/lib/types";

const markers: TrackMarkerDto[] = [
  { kind: "kill", at: "2026-07-14T01:10:00Z", x: 5000, y: 5000, sampleAt: "2026-07-14T01:05:00Z", sampleAgeSeconds: 300, label: "Victim1" },
  { kind: "death", at: "2026-07-14T02:00:00Z", x: 6000, y: 6000, sampleAt: "2026-07-14T01:59:00Z", sampleAgeSeconds: 60, label: null },
];

describe("TrackMarkerList", () => {
  it("is a real list — a map is unusable to a screen reader", () => {
    render(<TrackMarkerList markers={markers} />);
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(2);
  });

  it("states the fix age on every entry, so nothing reads as an exact position", () => {
    render(<TrackMarkerList markers={markers} />);
    expect(screen.getByText(/5m before/i)).toBeInTheDocument();
    expect(screen.getByText(/1m before/i)).toBeInTheDocument();
  });

  it("names the victim on a kill", () => {
    render(<TrackMarkerList markers={markers} />);
    expect(screen.getByText(/Victim1/)).toBeInTheDocument();
  });

  it("renders nothing rather than an empty list when there are no markers", () => {
    const { container } = render(<TrackMarkerList markers={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm --filter @onelife/web exec vitest run src/components/life/track-marker-list.test.tsx`
Expected: FAIL — cannot resolve `./track-marker-list`.

- [ ] **Step 3: Implement the marker list**

```tsx
// apps/web/src/components/life/track-marker-list.tsx
import type { TrackMarkerDto } from "@/lib/types";

const KIND_LABEL: Record<TrackMarkerDto["kind"], string> = {
  kill: "Kill",
  death: "Death",
  now: "Last known position",
};

function ago(seconds: number): string {
  if (seconds < 60) return `${seconds}s before`;
  return `${Math.round(seconds / 60)}m before`;
}

/** The text equivalent of the map. A map is unusable to a screen reader, so the same
 *  information exists here as real DOM — not as alt text on an image. */
export function TrackMarkerList({ markers }: { markers: TrackMarkerDto[] }) {
  if (markers.length === 0) return null;
  return (
    <ul role="list" className="mt-3 space-y-1">
      {markers.map((m, i) => (
        <li key={`${m.kind}-${m.at}-${i}`} className="font-mono text-[11px] leading-relaxed text-ink-soft">
          <span className="font-bold text-ink">{KIND_LABEL[m.kind]}</span>
          {m.label ? ` — ${m.label}` : ""}
          {" · approximate, from a fix "}
          {ago(m.sampleAgeSeconds)}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `pnpm --filter @onelife/web exec vitest run src/components/life/track-marker-list.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing location-panel test**

```tsx
// apps/web/src/components/life/location-panel.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { LocationPanel, isOwnerOf } from "./location-panel";

const useSession = vi.fn();
const useGamertagLinks = vi.fn();
const useLifeTrack = vi.fn();

vi.mock("@/lib/auth-client", () => ({ useSession: () => useSession() }));
vi.mock("@/lib/use-gamertag-links", () => ({ useGamertagLinks: () => useGamertagLinks() }));
vi.mock("@/lib/use-life-track", () => ({ useLifeTrack: () => useLifeTrack() }));
vi.mock("./track-map", () => ({ default: () => <div data-testid="map" /> }));

const props = { mapSlug: "sakhal", lifeNumber: 1, pageGamertag: "Hero", alive: true };

beforeEach(() => {
  useSession.mockReturnValue({ data: null });
  useGamertagLinks.mockReturnValue({ data: [] });
  useLifeTrack.mockReturnValue({ data: null, isPending: false, isError: false });
});

// The repo convention (see unbanStateOf in self-unban-button.tsx) is to lift the state
// derivation out of the connected component so most assertions need no providers.
describe("isOwnerOf", () => {
  it("is false when signed out, whatever the links say", () => {
    expect(isOwnerOf(false, [{ gamertag: "Hero", status: "verified" }], "Hero")).toBe(false);
  });
  it("is false for a pending link", () => {
    expect(isOwnerOf(true, [{ gamertag: "Hero", status: "pending" }], "Hero")).toBe(false);
  });
  it("is false for a different gamertag", () => {
    expect(isOwnerOf(true, [{ gamertag: "Other", status: "verified" }], "Hero")).toBe(false);
  });
  it("matches case-insensitively", () => {
    expect(isOwnerOf(true, [{ gamertag: "hERo", status: "verified" }], "Hero")).toBe(true);
  });
  it("is false while links are still undefined", () => {
    expect(isOwnerOf(true, undefined, "Hero")).toBe(false);
  });
});

describe("LocationPanel", () => {
  it("shows the withheld bar to a signed-out visitor on an alive life", () => {
    render(<LocationPanel {...props} />);
    expect(screen.getByText("Positions withheld")).toBeInTheDocument();
    expect(screen.queryByTestId("map")).toBeNull();
  });

  it("shows the withheld bar to a signed-in NON-owner", () => {
    useSession.mockReturnValue({ data: { user: { id: "u1" } } });
    useGamertagLinks.mockReturnValue({ data: [{ gamertag: "SomeoneElse", status: "verified" }] });
    render(<LocationPanel {...props} />);
    expect(screen.getByText("Positions withheld")).toBeInTheDocument();
  });

  it("shows the withheld bar to the owner while their link is only PENDING", () => {
    useSession.mockReturnValue({ data: { user: { id: "u1" } } });
    useGamertagLinks.mockReturnValue({ data: [{ gamertag: "Hero", status: "pending" }] });
    render(<LocationPanel {...props} />);
    expect(screen.getByText("Positions withheld")).toBeInTheDocument();
    expect(screen.queryByTestId("map")).toBeNull();
  });

  it("shows the map to the verified owner", () => {
    useSession.mockReturnValue({ data: { user: { id: "u1" } } });
    useGamertagLinks.mockReturnValue({ data: [{ gamertag: "Hero", status: "verified" }] });
    useLifeTrack.mockReturnValue({
      data: { mapCodename: "sakhal", segments: [], markers: [], sampleCount: 3, truncated: false, alive: true },
      isPending: false, isError: false,
    });
    render(<LocationPanel {...props} />);
    expect(screen.getByTestId("map")).toBeInTheDocument();
    expect(screen.queryByText("Positions withheld")).toBeNull();
  });

  it("distinguishes a resolved-empty track from a failed fetch", () => {
    useSession.mockReturnValue({ data: { user: { id: "u1" } } });
    useGamertagLinks.mockReturnValue({ data: [{ gamertag: "Hero", status: "verified" }] });
    useLifeTrack.mockReturnValue({
      data: { mapCodename: "sakhal", segments: [], markers: [], sampleCount: 0, truncated: false, alive: true },
      isPending: false, isError: false,
    });
    render(<LocationPanel {...props} />);
    expect(screen.getByText(/no fixes recorded/i)).toBeInTheDocument();
  });

  it("renders an explicit error line on a failed fetch, never an empty map", () => {
    useSession.mockReturnValue({ data: { user: { id: "u1" } } });
    useGamertagLinks.mockReturnValue({ data: [{ gamertag: "Hero", status: "verified" }] });
    useLifeTrack.mockReturnValue({ data: undefined, isPending: false, isError: true });
    render(<LocationPanel {...props} />);
    expect(screen.getByRole("status")).toHaveTextContent(/couldn't load/i);
    expect(screen.queryByText(/no fixes recorded/i)).toBeNull();
  });
});
```

- [ ] **Step 6: Run it and see it fail**

Run: `pnpm --filter @onelife/web exec vitest run src/components/life/location-panel.test.tsx`
Expected: FAIL — cannot resolve `./location-panel`.

- [ ] **Step 7: Implement the panel**

```tsx
// apps/web/src/components/life/location-panel.tsx
"use client";
import dynamic from "next/dynamic";
import { useSession } from "@/lib/auth-client";
import { useGamertagLinks } from "@/lib/use-gamertag-links";
import { useLifeTrack } from "@/lib/use-life-track";
import { WithheldBar } from "./timeline";
import { TrackMarkerList } from "./track-marker-list";

const TrackMap = dynamic(() => import("./track-map"), { ssr: false });

interface Props {
  mapSlug: string;
  lifeNumber: number;
  pageGamertag: string;
  alive: boolean;
}

/**
 * Owns the whole owner/withheld/loading/empty/error decision for the location surface.
 *
 * The `isOwner` check here decides only whether to ASK the API. It is bypassable from
 * devtools and is not the gate — the /me route derives the subject from the session
 * cookie. See the spec §3.7.
 */
export function isOwnerOf(
  signedIn: boolean,
  links: { gamertag: string; status: string }[] | undefined,
  pageGamertag: string,
): boolean {
  return signedIn && (links ?? []).some(
    (l) => l.status === "verified" && l.gamertag.toLowerCase() === pageGamertag.toLowerCase(),
  );
}

export function LocationPanel({ mapSlug, lifeNumber, pageGamertag, alive }: Props) {
  const { data: session } = useSession();
  const { data: links } = useGamertagLinks(!!session?.user);
  const isOwner = isOwnerOf(!!session?.user, links, pageGamertag);

  const { data: track, isPending, isError } = useLifeTrack(mapSlug, lifeNumber, isOwner, alive);

  // Non-owners get exactly today's DOM: the bar on an alive life, nothing on a dead one.
  if (!isOwner) return alive ? <WithheldBar /> : null;

  if (isPending) {
    return (
      <p className="mt-5 border border-hairline bg-bone px-4 py-3 font-mono text-[11px] text-ink-soft">
        Pulling your fixes…
      </p>
    );
  }

  // A failed fetch and an empty desk are different statements and must never collapse
  // into one another (the live-data-honesty settleFeed rule).
  if (isError || !track) {
    return (
      <p role="status" className="mt-5 border border-hairline bg-bone px-4 py-3 font-mono text-[11px] text-red-deep">
        Couldn&apos;t load your position record. This is a fault at the desk, not an empty file.
      </p>
    );
  }

  return (
    <section className="mt-5 border border-ink">
      <h2 className="border-b border-ink bg-bone px-4 py-2 font-display text-xs font-bold uppercase tracking-[.1em] text-ink">
        Desk copy — for your eyes only
      </h2>
      <div className="p-4">
        {track.sampleCount === 0 ? (
          <p className="font-mono text-[11px] text-ink-soft">
            No fixes recorded for this life.
          </p>
        ) : (
          <>
            <TrackMap track={track} />
            <TrackMarkerList markers={track.markers} />
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[.08em] text-ink-muted">
              {track.sampleCount} fixes{track.truncated ? " · trail truncated" : ""} · every marker approximate
            </p>
          </>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 8: Export `WithheldBar` from `timeline.tsx` and add the slot**

In `apps/web/src/components/life/timeline.tsx`:

1. Change `function WithheldBar()` to `export function WithheldBar()`.
2. Add an optional prop to the `Timeline` component's props: `locationSlot?: React.ReactNode`.
3. At the render site currently reading `{view.alive && <WithheldBar />}` (around line 76), replace it with:

```tsx
{locationSlot ?? (view.alive ? <WithheldBar /> : null)}
```

This keeps the existing behaviour byte-identical when no slot is passed, which is what the existing `timeline.test.tsx` cases assert.

- [ ] **Step 9: Run the existing timeline tests unchanged**

Run: `pnpm --filter @onelife/web exec vitest run src/components/life/timeline.test.tsx`
Expected: PASS with no edits to that file. If it fails, the slot changed default behaviour — fix the component, not the test.

- [ ] **Step 10: Mount it on the page**

In `apps/web/src/app/players/[slug]/[map]/lives/[n]/page.tsx`, import the panel and pass it as the slot:

```tsx
import { LocationPanel } from "@/components/life/location-panel";
```

and in the returned JSX, on the `<Timeline …>` element add:

```tsx
locationSlot={
  <LocationPanel
    mapSlug={map}
    lifeNumber={num}
    pageGamertag={data.gamertag}
    alive={data.life.endedAt === null}
  />
}
```

The page stays a server component and gains no coordinate data — `LocationPanel` is a client component that fetches on its own after mount.

- [ ] **Step 11: Run the whole web suite**

Run: `pnpm --filter @onelife/web exec vitest run`
Expected: all green, including the untouched `timeline.test.tsx`.

Then: `pnpm --filter @onelife/web run typecheck`
Expected: no output, exit 0.

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/components/life apps/web/src/app/players
git commit -m "feat(web): owner-only location panel on the life timeline"
```

---

### Task 8: Tile mirroring and deployment

**Files:**
- Create: `deploy/mirror-tiles.sh`
- Modify: `deploy/README.md`

**Interfaces:**
- Consumes: nothing in code.
- Produces: tiles on the host at `/var/www/tiles/{map}/{layer}/{z}/{x}/{y}.webp`, served at `/tiles/...`.

This task has no unit test — it is host configuration. Its verification is a manual check that the URL the component requests actually returns bytes.

- [ ] **Step 1: Write the mirror script**

```bash
# deploy/mirror-tiles.sh
#!/usr/bin/env bash
# One-time (and after a DayZ terrain update) mirror of DayZ map tiles for the
# owner-only life map. Run on the host; NOT part of deploy.sh — tiles change with
# game releases, not with our releases.
#
# Tiles are deliberately NOT in git (hundreds of MB) and NOT in Postgres (they would
# bloat every pg_dump for data that is fully reproducible by re-running this script).
set -euo pipefail

DEST="${TILE_DIR:-/var/www/tiles}"
MAPS=(chernarusplus sakhal enoch)

command -v dzmap-loader >/dev/null 2>&1 || {
  echo "dzmap-loader not found. Install from https://github.com/WoozyMasta/dzmap" >&2
  exit 1
}

mkdir -p "$DEST"
for m in "${MAPS[@]}"; do
  echo "==> mirroring $m"
  dzmap-loader -c "$(dirname "$0")/dzmap.yaml" --limit "$m"
done

echo "==> done. Verify one tile is readable:"
echo "    curl -sI https://<host>/tiles/chernarusplus/terrain/3/4/4.webp | head -1"
```

Then: `chmod +x deploy/mirror-tiles.sh`

- [ ] **Step 2: Add the nginx location block to `deploy/README.md`**

Add a section documenting the prerequisite and this server block:

```nginx
# Owner-only life map tiles. Static, immutable, and regenerated only by
# deploy/mirror-tiles.sh — never by a release.
location /tiles/ {
    alias /var/www/tiles/;
    add_header Cache-Control "public, max-age=31536000, immutable";
    access_log off;
    try_files $uri =404;
}
```

Document in prose: tiles are a **one-time host prerequisite**, are not captured by the `pg_dump` backup, and are reproducible by re-running the script. Note that if tiles are absent the feature degrades to a trail on a dark background rather than breaking — so a missed mirror is not a release blocker.

- [ ] **Step 3: Verify the projection against real tiles**

This is the step that validates Task 1's `CANVAS_PX` assumption. Run the mirror for one map, open a life map in the browser as the owner, and check that a known landmark coordinate lands where it should. If the trail is uniformly offset or scaled, `CANVAS_PX` in `track-map.tsx` is wrong for the mirrored pyramid — correct that one constant. Do **not** adjust `worldToPixel`, which is unit-tested and correct by construction.

Record the verified value in a comment beside `CANVAS_PX`.

- [ ] **Step 4: Commit**

```bash
git add deploy/mirror-tiles.sh deploy/README.md
git commit -m "chore(deploy): DayZ tile mirroring for the owner-only life map"
```

---

### Task 9: Documentation and PR

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run the full suite**

Run: `pnpm turbo run test --concurrency=1`
Expected: all packages green.

Run: `pnpm turbo run typecheck`
Expected: all packages clean.

Do not proceed until both are actually green. Report real output — a failure here is a finding, not an obstacle to route around.

- [ ] **Step 2: Update `CHANGELOG.md`**

Add an entry under the unreleased heading describing: the owner-only life location map; that it is gated to the verified owner via a `/me` route taking no player identifier; that markers are approximate; and the new host prerequisite (`deploy/mirror-tiles.sh`).

- [ ] **Step 3: Correct `CLAUDE.md`**

Two edits, both required:

1. In the **R4** entry, the sentence "**Location is voice-only:** … no coordinates are stored or shown anywhere (kills/deaths carry no coords)" is now wrong on both halves and must be rewritten. Coordinates **are** stored (the `positions` table, since SP1) and **are** shown — to the verified owner alone. Keep the true part: kills and deaths genuinely carry no coordinates, which is why every marker is approximate.
2. Add a sub-project entry for the feature, recording the invariants a future change would silently break:
   - the coordinates endpoint takes **no player identifier** — do not add one
   - `verified` links only; `pending` is not proof
   - `Cache-Control: no-store` is load-bearing, not decoration
   - every marker is approximate; there is deliberately no `approximate` boolean
   - the Leaflet container's `isolate` is what keeps Leaflet's `z-index: 1000` controls off the masthead
   - tiles are a host prerequisite, absent from `pg_dump`, and their absence degrades rather than breaks

CLAUDE.md is the **last** edit before the PR, per the project workflow.

- [ ] **Step 4: Open the PR**

Use the `finishing-a-feature` skill, which sequences the remaining pre-PR steps and opens the PR into `develop`.

---

## Self-Review

**Spec coverage:** §2.1 (no death/kill coords) → Task 2 `markerAt` + Task 9 doc fix. §3.1–3.2 → Task 4 route + tests. §3.3 → Task 4 test. §3.4 → Task 7 Step 10. §3.5 → route logs nothing (no logger call added). §3.6 → nothing in this plan touches the public route. §3.7 → Task 7 comment + test. §4.1 → Task 2 `segmentBySession` + Task 3. §4.2 → Task 2 `thinTrack`. §4.3–4.4 → Task 2 `markerAt`. §4.5 → Task 3 cap comment. §4.6 → Task 7 panel states. §5.1 → Task 1. §5.2 → Task 6. §5.3–5.4 → Tasks 6 and 8. §6 → Task 7. §7 → Task 5. §8 → Task 7 marker list. §9 → tests throughout. §10 → nothing in this plan implements an out-of-scope item.

**Known open item, deliberately left as a task step rather than guessed:** the exact pixel extent of the DZMap pyramid (`CANVAS_PX`) cannot be verified without real tiles, so Task 1 takes it as a parameter and Task 8 Step 3 verifies and records it. This is a genuine unknown, not a placeholder — the code is complete and correct for any value.

**Type consistency:** `TrackPoint`/`TrackSegment`/`TrackMarker` are defined once in Task 2 and re-exported through Task 3; the web DTOs in Task 5 mirror them with `Date` → ISO `string`, which is the existing convention in `types.ts`. `getLifeTrack` takes `lifeNumber` in both the read model (Task 3) and the route (Task 4). `WithheldBar` is exported in Task 7 Step 8 before it is imported in Step 7 — the implementer must do Step 8 before the panel test passes; this is called out in Step 8 itself.
