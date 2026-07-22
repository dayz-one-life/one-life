# Map Online List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the map's ☰ panel from "friends sharing a position here" into "who is online on this map" — friends first, position-sharers highlighted.

**Architecture:** One new read-model (`getOnlinePlayers`) composed into the existing `GET /me/maps/:mapSlug` payload beside `getFriendPositions`, so the list and the dots come from one fetch and cannot disagree. The web panel renders the list; the F3 presence copy is reworded in the same release because those switches stop governing visibility.

**Tech Stack:** Postgres + Drizzle, Fastify, Next.js App Router, vitest (+ real Postgres for read-model and route suites).

**Spec:** `docs/superpowers/specs/2026-07-22-map-online-list-design.md`

## Global Constraints

- **No migration, no new route, no new env var, no worker.** `GET /me/maps/:mapSlug` gains fields; nothing else moves. Deploys with a plain `./deploy/deploy.sh`.
- **`GET /me/maps[/:mapSlug]` must never gain a subject parameter.** The subject set comes from the session alone — serving a *named* player's data stays unexpressible, not merely rejected. Both routes keep `cache-control: no-store, private`.
- **Online = an open session AND `players.last_seen_at` within `ONLINE_MAX_AGE_SECONDS` (900).** An open session alone is not evidence of presence: `apps/rebooter` restarts each server every 2h, so a crashed client's session stays open until then. Dropping the staleness bound is the difference between this list and a misleading one.
- **`sharing` is derived by intersecting with the payload's own `positions`** — never by a second consent evaluation. One source of truth for who is on the map.
- **Location sharing is untouched.** `shouldShareLocation`, the verified-link inner join, and `MARKER_MAX_AGE_SECONDS` all stay exactly as they are. This feature publishes *that* someone is online, never *where* they are.
- **Ordering is computed in the read-model, not the component:** self → friends sharing → friends → sharing → everyone else, then gamertag ascending.
- Tests: `pnpm turbo run test --concurrency=1` (DB suites need `TEST_DATABASE_URL`). Typecheck: `pnpm turbo run typecheck`.

---

### Task 1: `getOnlinePlayers` read-model

**Files:**
- Create: `packages/read-models/src/online-players.ts`
- Modify: `packages/read-models/src/index.ts` (barrel export)
- Create: `packages/read-models/test/online-players.test.ts`

**Interfaces:**
- Consumes: `friendships`, `gamertagLinks`, `players`, `sessions` from `@onelife/db`; `FriendPosition` from `./friend-positions.js`.
- Produces:

```ts
export const ONLINE_MAX_AGE_SECONDS = 900;

export interface OnlinePlayer {
  gamertag: string;
  friend: boolean;
  sharing: boolean;
  self: boolean;
}

export async function getOnlinePlayers(
  db: Database,
  a: {
    viewerUserId: string;
    serverId: number;
    now: Date;
    /** The positions already computed for this payload. `sharing` is derived from these. */
    positions: FriendPosition[];
  },
): Promise<OnlinePlayer[]>;
```

- [ ] **Step 1: Write the failing tests**

Create `packages/read-models/test/online-players.test.ts`. Follow the existing harness in
`packages/read-models/test/friend-positions.test.ts` for `withDb`/seed helpers — read that file
first and reuse its fixtures rather than inventing new ones.

```ts
import { describe, it, expect } from "vitest";
import { getOnlinePlayers, ONLINE_MAX_AGE_SECONDS } from "../src/online-players.js";

// Seed shape per test: a server, four players with open/closed sessions and varying
// last_seen_at, an accepted friendship between the viewer and one of them.

describe("getOnlinePlayers", () => {
  it("lists a player with an open session seen just now", async () => {
    // expect: one row, gamertag matches, self=false, friend=false, sharing=false
  });

  it("EXCLUDES an open session whose player has not been seen for 15 minutes", async () => {
    // A crashed client keeps its session open until the next even-hour reboot, so an open
    // session alone would list players who left up to two hours ago. Seed last_seen_at at
    // now - (ONLINE_MAX_AGE_SECONDS + 60) and expect the row to be absent entirely.
  });

  it("excludes a closed session even when last_seen_at is recent", async () => {
    // disconnected_at set; the player logged off a minute ago and is not online.
  });

  it("orders self, then friends sharing, then friends, then sharers, then the rest", async () => {
    // Seed one of each and assert the exact gamertag order.
  });

  it("marks `sharing` from the positions passed in, not from a fresh consent lookup", async () => {
    // Pass a positions array naming exactly one online player; expect sharing=true on that
    // row and false on the others, with no dependence on their sharing flags in the DB.
  });

  it("marks the viewer's own row `self`", async () => {
    // The viewer is in the list (they are online) and must be distinguishable.
  });
});
```

Every assertion above needs real seeded rows — write them out fully following the neighbouring
test file's helpers.

- [ ] **Step 2: Run them and watch them fail**

Run: `TEST_DATABASE_URL=... pnpm --filter @onelife/read-models run test -- test/online-players.test.ts`
Expected: FAIL — cannot resolve `../src/online-players.js`.

- [ ] **Step 3: Implement the read-model**

Create `packages/read-models/src/online-players.ts`:

```ts
import type { Database } from "@onelife/db";
import { friendships, gamertagLinks, players, sessions } from "@onelife/db";
import { and, eq, gte, isNull, or, sql } from "drizzle-orm";
import type { FriendPosition } from "./friend-positions.js";

/**
 * How recently a player must have been seen to count as online.
 *
 * ⚠️ An open session is NOT evidence that someone is playing. `sessions.disconnected_at` stays
 * NULL for a crashed client until the next even-hour reboot closes it (apps/rebooter restarts
 * every active server every 2h), so a bare `disconnected_at IS NULL` list shows players who
 * left up to two hours ago — stale state presented as current. Same bound as the map's markers
 * and the presence generator.
 */
export const ONLINE_MAX_AGE_SECONDS = 900;

export interface OnlinePlayer {
  gamertag: string;
  friend: boolean;
  sharing: boolean;
  self: boolean;
}

/**
 * Everyone currently on one server, as the viewer sees them.
 *
 * ⚠️ This publishes WHO IS ONLINE regardless of the F3 presence switches — a deliberate policy
 * decision (spec §2): DayZ's own in-game menu already lists everyone connected, so gating this
 * protects nothing while making the list look broken. Those switches now govern notifications
 * only, and their copy says so. WHERE someone is stays consent-gated and is not computed here.
 *
 * Like every /me map read-model, the subject set comes from the session; there is no player
 * identifier to pass.
 */
export async function getOnlinePlayers(
  db: Database,
  a: { viewerUserId: string; serverId: number; now: Date; positions: FriendPosition[] },
): Promise<OnlinePlayer[]> {
  const freshest = new Date(a.now.getTime() - ONLINE_MAX_AGE_SECONDS * 1000);

  const rows = await db
    .selectDistinct({ gamertag: players.gamertag })
    .from(sessions)
    .innerJoin(players, eq(players.id, sessions.playerId))
    .where(and(
      eq(sessions.serverId, a.serverId),
      isNull(sessions.disconnectedAt),
      gte(players.lastSeenAt, freshest),
    ));

  // The viewer's own verified gamertag, and their accepted friends' — both compared with
  // lower(), matching every other gamertag comparison in this package.
  const [viewer] = await db
    .select({ gamertag: gamertagLinks.gamertag })
    .from(gamertagLinks)
    .where(and(
      eq(gamertagLinks.userId, a.viewerUserId),
      eq(gamertagLinks.status, "verified"),
    ))
    .limit(1);

  const friendRows = await db
    .select({ gamertag: gamertagLinks.gamertag })
    .from(friendships)
    .innerJoin(gamertagLinks, and(
      eq(gamertagLinks.status, "verified"),
      or(
        and(eq(friendships.userA, a.viewerUserId), eq(gamertagLinks.userId, friendships.userB)),
        and(eq(friendships.userB, a.viewerUserId), eq(gamertagLinks.userId, friendships.userA)),
      ),
    ))
    .where(and(
      eq(friendships.status, "accepted"),
      or(eq(friendships.userA, a.viewerUserId), eq(friendships.userB, a.viewerUserId)),
    ));

  const lower = (s: string) => s.toLowerCase();
  const selfTag = viewer ? lower(viewer.gamertag) : null;
  const friends = new Set(friendRows.map((r) => lower(r.gamertag)));
  // Derived from the payload's own positions — never a second consent evaluation, so the list
  // and the dots can never contradict each other.
  const sharing = new Set(a.positions.map((p) => lower(p.gamertag)));

  const out: OnlinePlayer[] = rows.map((r) => ({
    gamertag: r.gamertag,
    self: selfTag !== null && lower(r.gamertag) === selfTag,
    friend: friends.has(lower(r.gamertag)),
    sharing: sharing.has(lower(r.gamertag)),
  }));

  // Ordering lives HERE, not in the component: the accessible legend and any future surface
  // want the same order, and a rule split across renderers drifts.
  const rank = (p: OnlinePlayer) =>
    p.self ? 0 : p.friend && p.sharing ? 1 : p.friend ? 2 : p.sharing ? 3 : 4;
  return out.sort((x, y) =>
    rank(x) - rank(y) || x.gamertag.localeCompare(y.gamertag),
  );
}
```

- [ ] **Step 4: Export it from the barrel**

In `packages/read-models/src/index.ts`, add alongside the other exports:

```ts
export * from "./online-players.js";
```

- [ ] **Step 5: Run the tests**

Run: `TEST_DATABASE_URL=... pnpm --filter @onelife/read-models run test -- test/online-players.test.ts`
Expected: PASS.

- [ ] **Step 6: Prove the staleness bound is load-bearing**

Delete the `gte(players.lastSeenAt, freshest)` clause, re-run, and confirm the
"EXCLUDES an open session…" test fails. Restore it. A bound no test defends is a bound the next
refactor removes.

- [ ] **Step 7: Commit**

```bash
git add packages/read-models
git commit -m "feat(maps): getOnlinePlayers read-model

Online means an open session AND last_seen_at within 15 minutes: a crashed
client's session stays open until the next even-hour reboot, so an open
session alone lists players who left up to two hours ago."
```

---

### Task 2: Serve it from the map route

**Files:**
- Modify: `apps/api/src/routes/friend-map.ts`
- Modify: `apps/api/test/friend-map-routes.test.ts`

**Interfaces:**
- Consumes: `getOnlinePlayers`, `OnlinePlayer` (Task 1).
- Produces: `GET /me/maps/:mapSlug` returns `{ mapCodename, positions, online }` where `online` is `OnlinePlayer[]`.

- [ ] **Step 1: Write the failing route test**

Append to `apps/api/test/friend-map-routes.test.ts`, following the seeding helpers already in
that file:

```ts
  it("serves the online list alongside the positions", async () => {
    // Seed: viewer verified + online, a stranger online, both with fresh last_seen_at.
    const res = await app.inject({ method: "GET", url: "/me/maps/chernarus", headers: authed });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.online.map((o: { gamertag: string }) => o.gamertag)).toContain("Stranger");
    expect(body.online[0].self).toBe(true); // the viewer sorts first
  });

  it("still refuses a caller with no verified link", async () => {
    // Unchanged behaviour, re-asserted because this route now returns more data.
    const res = await app.inject({ method: "GET", url: "/me/maps/chernarus", headers: unverified });
    expect(res.statusCode).toBe(403);
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `TEST_DATABASE_URL=... pnpm --filter @onelife/api run test -- test/friend-map-routes.test.ts`
Expected: FAIL — `body.online` is undefined.

- [ ] **Step 3: Compose it into the route**

In `apps/api/src/routes/friend-map.ts`, import `getOnlinePlayers` from `@onelife/read-models`
and extend the `/me/maps/:mapSlug` handler:

```ts
    const now = new Date();
    const positions = await getFriendPositions(db, {
      viewerUserId: session.user.id, serverId: server.id, now,
    });
    // Composed from the SAME positions the payload returns, so `sharing` and the dots are one
    // fact rather than two lookups that can disagree.
    const online = await getOnlinePlayers(db, {
      viewerUserId: session.user.id, serverId: server.id, now, positions,
    });

    reply.header("cache-control", "no-store, private");
    return { mapCodename: server.map, positions, online };
```

Note the existing handler builds its own `new Date()` inline for `getFriendPositions`; hoist it
to `now` as shown so both reads share one instant.

- [ ] **Step 4: Run it and watch it pass**

Run: `TEST_DATABASE_URL=... pnpm --filter @onelife/api run test -- test/friend-map-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(maps): serve the online list from GET /me/maps/:mapSlug

Composed from the same positions the payload returns, so `sharing` and the
dots are one fact rather than two lookups that can disagree. The route still
takes no subject parameter."
```

---

### Task 3: The panel becomes the online list

**Files:**
- Modify: `apps/web/src/lib/types.ts`
- Rename + rewrite: `apps/web/src/components/map/friends-map.tsx`'s `FriendsMapLegend` → `OnlineList` in a new `apps/web/src/components/map/shell/online-list.tsx`
- Modify: `apps/web/src/components/map/friends-map.test.tsx` (legend tests move)
- Create: `apps/web/src/components/map/shell/online-list.test.tsx`
- Modify: `apps/web/src/components/map/shell/friends-panel.tsx`, `friends-panel.test.tsx`
- Modify: `apps/web/src/components/map/map-page.tsx`

**Interfaces:**
- Consumes: the `online` field from Task 2.
- Produces:

```ts
export type OnlinePlayerDto = {
  gamertag: string; friend: boolean; sharing: boolean; self: boolean;
};
export type FriendMap = {
  mapCodename: string; positions: FriendPositionDto[]; online: OnlinePlayerDto[];
};

export function OnlineList(p: { players: OnlinePlayerDto[] }): JSX.Element;
```

- [ ] **Step 1: Add the DTO**

In `apps/web/src/lib/types.ts`, beside `FriendPositionDto`:

```ts
export type OnlinePlayerDto = {
  gamertag: string;
  /** An accepted friendship with the viewer. */
  friend: boolean;
  /** Has a dot on this map — derived server-side from the same positions. */
  sharing: boolean;
  self: boolean;
};
```

and add `online: OnlinePlayerDto[]` to `FriendMap`.

- [ ] **Step 2: Write the failing list test**

Create `apps/web/src/components/map/shell/online-list.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OnlineList } from "./online-list";

const players = [
  { gamertag: "You", friend: false, sharing: true, self: true },
  { gamertag: "Mate", friend: true, sharing: true, self: false },
  { gamertag: "Stranger", friend: false, sharing: false, self: false },
];

describe("OnlineList", () => {
  it("lists everyone online, in the order the server sent", () => {
    render(<OnlineList players={players} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(/you/i);
    expect(items[2]).toHaveTextContent(/stranger/i);
  });

  it("marks a sharer with more than colour", () => {
    // Colour alone fails WCAG 1.4.1 — the same rule the in-prose gamertag links follow.
    render(<OnlineList players={players} />);
    expect(screen.getByText(/on the map/i)).toBeInTheDocument();
  });

  it("says plainly when nobody is online", () => {
    render(<OnlineList players={[]} />);
    expect(screen.getByText(/nobody is on this server/i)).toBeInTheDocument();
  });

  it("is written in dark-surface tokens", () => {
    render(<OnlineList players={players} />);
    for (const li of screen.getAllByRole("listitem")) {
      expect(li.className).not.toMatch(/\btext-ink/);
      expect(li.className).toMatch(/\btext-cream|\btext-paper/);
    }
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @onelife/web run test -- src/components/map/shell/online-list.test.tsx`
Expected: FAIL — cannot resolve `./online-list`.

- [ ] **Step 4: Implement it**

Create `apps/web/src/components/map/shell/online-list.tsx`:

```tsx
import type { OnlinePlayerDto } from "@/lib/types";

/** Who is on this server. Replaces FriendsMapLegend: it is still the screen-reader companion
 *  to a canvas with no text, so it stays a real list reached by a real button.
 *
 *  ⚠️ DARK SURFACE — cream/paper tokens only.
 *  Order comes from the server (self → friends sharing → friends → sharing → rest); do not
 *  re-sort here, or the rule lives in two places. */
export function OnlineList({ players }: { players: OnlinePlayerDto[] }) {
  if (players.length === 0) {
    return (
      <p className="font-mono text-[15px] uppercase tracking-[.05em] text-cream-muted md:text-[11px]">
        Nobody is on this server right now.
      </p>
    );
  }
  return (
    <ul role="list" className="flex flex-col">
      {players.map((p) => (
        <li
          key={p.gamertag}
          className={`flex min-h-[52px] items-center justify-between gap-3 font-mono text-[15px] uppercase tracking-[.05em] md:min-h-0 md:text-[11px] ${
            p.friend || p.self ? "text-paper" : "text-cream-dim"
          }`}
        >
          <span className={p.friend || p.self ? "font-bold" : undefined}>
            {p.gamertag}{p.self ? " (you)" : ""}
          </span>
          {/* Not colour alone — WCAG 1.4.1. The words carry it. */}
          {p.sharing && <span className="shrink-0 text-red">On the map</span>}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 5: Point the panel at it**

In `apps/web/src/components/map/shell/friends-panel.tsx`: replace the `FriendsMapLegend` import
and usage with `OnlineList`, change the prop from `positions` to `players: OnlinePlayerDto[]`,
and change the count from "friends sharing" to **players online, excluding the viewer**:

```tsx
  const count = loading || !players ? null : players.filter((p) => !p.self).length;
```

Keep the loading and error branches exactly as they are — three distinct renders.

Update `friends-panel.test.tsx`'s fixtures to `OnlinePlayerDto` shape and its count assertion
to the new meaning.

- [ ] **Step 6: Delete the old legend and pass the data down**

Remove `FriendsMapLegend` and `positionAge`'s legend usage from
`apps/web/src/components/map/friends-map.tsx` (the popup still uses `positionAge` — keep the
function), and move its remaining tests out of `friends-map.test.tsx`.

In `apps/web/src/components/map/map-page.tsx`, pass `players={q.data?.online}` to
`FriendsPanel` in both bars.

- [ ] **Step 7: Run the whole web suite**

Run: `pnpm --filter @onelife/web run test`
Expected: PASS, with no unhandled errors. **Check the "Errors" line, not just the pass count** —
vitest reports unhandled errors separately, and a component that crashed inside a promise leaves
every assertion green.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(maps): the map panel lists who is online

Friends first, sharers marked with words rather than colour alone. The ☰
count changes meaning from friends-sharing to players-online."
```

---

### Task 4: Reword the presence switches

**Files:**
- Modify: `apps/web/src/components/friends/presence-toggles.tsx`
- Modify: `apps/web/src/components/friends/presence-toggles.test.tsx`
- Modify: `apps/web/src/components/friends/roster.test.tsx` (any copy assertions)

**Interfaces:** none — copy only.

> **Why this is in the same release, not a follow-up.** Once the map lists everyone online, these
> switches govern *notifications* only. A player who reads "Share my status with friends" as
> "hide me" while the map prints their name has been misled by us.

- [ ] **Step 1: Write the failing copy test**

In `apps/web/src/components/friends/presence-toggles.test.tsx`:

```tsx
  it("describes what the switch actually does — alerts, not visibility", () => {
    // The map lists everyone online regardless of these switches (the game's own player menu
    // does too). Copy that implies hiding would be a lie about a privacy control.
    render(<MasterShareSwitch on={false} onChange={() => {}} />);
    expect(screen.getByText(/tell friends when i come online/i)).toBeInTheDocument();
    expect(screen.queryByText(/share my status/i)).toBeNull();
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @onelife/web run test -- src/components/friends/presence-toggles.test.tsx`
Expected: FAIL — the old copy is still there.

- [ ] **Step 3: Change the three strings**

In `apps/web/src/components/friends/presence-toggles.tsx`:

- `Share my status with friends` → `Tell friends when I come online`
- `Share my status` (per-friend) → `Tell them when I come online`
- `Sharing is off for everyone` → `Alerts are off for everyone`

Update the `MasterShareSwitch` doc comment: it is no longer "nobody is visible until they opt
in" but "nobody is alerted until they opt in".

- [ ] **Step 4: Run the friends suite**

Run: `pnpm --filter @onelife/web run test -- src/components/friends`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/friends
git commit -m "fix(friends): presence switches describe alerts, not visibility

The map now lists everyone online, as the game's own player menu does, so
these switches govern notifications only. Copy implying they hide you would
be a lie about a privacy control."
```

---

### Task 5: Docs and release

**Files:**
- Modify: `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: Changelog**

Under `Unreleased`:

```markdown
### Changed

- The map's friends panel is now an online list: everyone currently on that server, with your
  friends at the top and anyone sharing their position marked. The count on the button changes
  meaning to match — it was friends sharing a position, it is now players online.
- The "share my status" switches are now labelled for what they do: they control whether friends
  are told when you come online. Being listed as online on a map is not something they hide —
  the game's own player menu already shows it. Where you are is still yours alone to share.
```

- [ ] **Step 2: CLAUDE.md**

Add to the map sub-project entry, in the same ⚠️ style as its neighbours: online = open session
AND `last_seen_at` within `ONLINE_MAX_AGE_SECONDS`, and why an open session alone is not
evidence; `sharing` derived from the payload's positions, never a second consent lookup;
ordering owned by the read-model; and the policy note that presence visibility is deliberately
ungated while *location* stays consent-gated.

- [ ] **Step 3: Full verification**

Run: `pnpm turbo run test --concurrency=1` then `pnpm turbo run typecheck` then
`cd apps/web && npx next build`
Expected: all green.

- [ ] **Step 4: PR and release**

Use `finishing-a-feature`, then `drafting-a-release` / `cutting-a-release`. The version is a
**minor** bump (behaviour change to an existing surface plus new payload fields).

**⚠️ Check the version is not already in flight** — a parallel session cut v0.40.1 during the
v0.40.0 release and both landed on `main` claiming the same number.

---

## Self-Review

**Spec coverage:** §2 policy + switch relabel → Task 4. §3 staleness definition → Task 1
(steps 1, 3, 6). §4 payload shape and ordering → Tasks 1–2. §5 surface → Task 3. §7 testing →
each task's own steps. §8 browser verification → carried in the PR body, per the standing rule
for this feature. §6 out-of-scope (cross-server presence) → nothing in this plan touches it.

**Placeholder scan:** the read-model, route, component and copy changes are all written out.
Task 1's test bodies are described rather than fully written — deliberately, because they must
follow `friend-positions.test.ts`'s existing seed helpers, which the implementer has in front of
them; every assertion is named exactly.

**Type consistency:** `OnlinePlayer` (read-model) and `OnlinePlayerDto` (web) carry the same four
fields; `getOnlinePlayers` takes `positions: FriendPosition[]` and the route passes exactly the
array it returns to the client; `OnlineList` takes `players`, and `FriendsPanel`'s prop is
renamed to match in the same task.
