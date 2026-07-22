# Friends F2 — Location Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live map per server showing your own position plus every friend currently sharing their location with you.

**Architecture:** Migration `0022` adds a `share_location` master switch to `user_preferences` and flips the dormant per-pair `*_shares_location` defaults, mirroring F3's consent shape. A new read-model resolves who a viewer may see; one session-scoped endpoint (`GET /me/maps/:mapSlug`) serves it, taking a server slug and no player identifier. The existing `TrackMap` is refactored into a shared Leaflet shell plus two thin drawing consumers.

**Tech Stack:** TypeScript ESM, pnpm workspaces + turbo, Postgres + Drizzle, Fastify, Next.js App Router, TanStack Query, Leaflet, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-22-friends-f2-location-design.md`

## Global Constraints

- **Migration `0022` is hand-written SQL with a hand-appended `meta/_journal.json` entry.** Do NOT run `drizzle-kit generate` — the snapshot chain stops at `0014_snapshot.json`. **The journal `when` value must be unique and strictly greater than `0021`'s (`1785100000000`)** — a duplicate makes drizzle-kit silently no-op the migration while reporting success; that bug has already happened twice on this feature.
- **`GET /me/maps/:mapSlug` takes a server slug and NO player identifier.** The subject set is derived entirely from the session. Do not add a gamertag/slug/userId parameter to it, or to the existing `GET /me/lives/:mapSlug/:n/track`.
- **Every coordinate response carries `cache-control: no-store, private`.**
- **`{map}` in any URL is a `servers.slug`, never `servers.map`.** The mission codename is display-only via `mapLabel`.
- **Reuse `MARKER_MAX_AGE_SECONDS = 900`** from `packages/read-models/src/life-track-shape.ts` as the position staleness cap. Do NOT define a second 15-minute constant.
- **Effective sharing = `share_location AND the per-pair flag`.** Defaults: master `false`, per-pair `true`. An absent `user_preferences` row means `false`.
- **The viewer's own dot ignores conditions 3 and 4** (master + per-pair) — it is their own data.
- **The reciprocity line is undifferentiated** — it must not distinguish "master off" from "hidden from you specifically".
- `/maps` and `/maps/{map}` are signed-in + verified only, and `noindex`.
- `red-deep` is a light-surface-only token; no raw hex (grep-gated). Type floors are enforced by `apps/web/src/type-floor-guard.test.ts`.
- Run tests with `pnpm turbo run test --concurrency=1` (DB suites need `TEST_DATABASE_URL`); typecheck with `pnpm turbo run typecheck`.
- Stage files explicitly (`git add <paths>`), never `git add -A`.

## File Structure

**Create:**
- `packages/db/drizzle/0022_location_sharing.sql`
- `packages/friends/src/location.ts` + `packages/friends/test/location.test.ts` — the predicate and flag writes.
- `packages/read-models/src/friend-positions.ts` + test — the eligibility query.
- `apps/api/src/routes/friend-map.ts` + `apps/api/test/friend-map-routes.test.ts`
- `apps/web/src/components/map/map-canvas.tsx` + test — the extracted Leaflet shell.
- `apps/web/src/components/map/friends-map.tsx` + test
- `apps/web/src/app/maps/page.tsx`, `apps/web/src/app/maps/[map]/page.tsx`, `.../[map]/loading.tsx`
- `apps/web/src/components/friends/location-toggles.tsx` + test

**Modify:**
- `packages/db/src/schema.ts`, `packages/db/drizzle/meta/_journal.json`
- `packages/friends/src/{queries.ts,index.ts}`
- `packages/read-models/src/index.ts`
- `apps/verifier/src/pg-store.ts` — the consent reset
- `apps/api/src/app.ts`
- `apps/web/src/components/life/track-map.tsx` — becomes a `MapCanvas` consumer
- `apps/web/src/lib/{types.ts,api.ts,use-friends.ts}`
- `apps/web/src/components/friends/roster.tsx`
- `apps/web/src/components/controls/{rail.tsx,mobile-account.tsx}` — the `/maps` link

---

### Task 1: Migration and schema

**Files:**
- Create: `packages/db/drizzle/0022_location_sharing.sql`
- Modify: `packages/db/src/schema.ts`, `packages/db/drizzle/meta/_journal.json`

**Interfaces:**
- Produces: `userPreferences.shareLocation`; `friendships.aSharesLocation`/`bSharesLocation` defaulting `true`.

- [ ] **Step 1: Write the migration**

Create `packages/db/drizzle/0022_location_sharing.sql`:

```sql
ALTER TABLE "user_preferences" ADD COLUMN "share_location" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "friendships" ALTER COLUMN "a_shares_location" SET DEFAULT true;
--> statement-breakpoint
ALTER TABLE "friendships" ALTER COLUMN "b_shares_location" SET DEFAULT true;
--> statement-breakpoint
UPDATE "friendships" SET "a_shares_location" = true, "b_shares_location" = true;
```

The backfill is safe for the same reason `0020`'s was: no user has `share_location = true` (the column is brand new and defaults false), and effective sharing is `master AND per-pair`, so nobody becomes visible.

- [ ] **Step 2: Append the journal entry**

In `packages/db/drizzle/meta/_journal.json`, after the `0021` object:

```json
    {
      "idx": 22,
      "version": "7",
      "when": 1785200000000,
      "tag": "0022_location_sharing",
      "breakpoints": true
    }
```

**Verify this `when` is unique** before moving on — `grep -c '1785200000000' packages/db/drizzle/meta/_journal.json` must print `1`.

- [ ] **Step 3: Update the Drizzle schema**

In `packages/db/src/schema.ts`, add to the `userPreferences` table, after `sharePresence`:

```ts
  shareLocation: boolean("share_location").notNull().default(false),
```

and change the two location columns on `friendships` from `.default(false)` to `.default(true)`:

```ts
  aSharesLocation: boolean("a_shares_location").notNull().default(true),
  bSharesLocation: boolean("b_shares_location").notNull().default(true),
```

- [ ] **Step 4: Apply and verify**

Run:

```bash
pnpm --filter @onelife/db run db:migrate
psql "$TEST_DATABASE_URL" -c "\d user_preferences" -c "\d friendships"
```

Expected: `user_preferences` has `share_location` defaulting `false`; `friendships`' two `*_shares_location` columns now default `true`. Confirm the migration actually ran (a new row in `drizzle.__drizzle_migrations`), not just that the command exited 0.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm turbo run typecheck
git add packages/db/drizzle/0022_location_sharing.sql packages/db/drizzle/meta/_journal.json packages/db/src/schema.ts
git commit -m "feat(db): location sharing flags (migration 0022)"
```

---

### Task 2: The location predicate and flag writes

**Files:**
- Create: `packages/friends/src/location.ts`, `packages/friends/test/location.test.ts`
- Modify: `packages/friends/src/queries.ts`, `packages/friends/src/index.ts`

**Interfaces:**
- Consumes: `FriendshipRow`, `viewOf`, `FriendError` (existing).
- Produces:
  - `shouldShareLocation(a: { status: string; masterShare: boolean; pairShare: boolean }): boolean`
  - `setLocationFlag(db, a: { userId: string; friendshipId: number; share: boolean }): Promise<void>` — throws `FriendError("not_found")` for a non-party.
  - `getShareLocation(db, userId: string): Promise<boolean>` — absent row ⇒ `false`.
  - `setShareLocation(db, a: { userId: string; shareLocation: boolean }): Promise<void>` — upsert.
  - `FriendEntry` gains `sharesLocation: boolean` (the viewer's own flag) and `theyShareLocation: boolean` (the collapsed, undifferentiated reciprocity signal).
  - `listFriends`'s return gains `shareLocation: boolean`.

- [ ] **Step 1: Write the failing test**

Create `packages/friends/test/location.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { user, gamertagLinks, friendships, userPreferences } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { request, accept } from "../src/mutations.js";
import { listFriends } from "../src/queries.js";
import {
  shouldShareLocation, setLocationFlag, getShareLocation, setShareLocation,
} from "../src/location.js";

const { db, sql } = getTestDb();

const base = { status: "accepted", masterShare: true, pairShare: true };

describe("shouldShareLocation", () => {
  it("shares when accepted and both flags are on", () => {
    expect(shouldShareLocation(base)).toBe(true);
  });
  for (const off of ["masterShare", "pairShare"] as const) {
    it(`does not share when ${off} is off`, () => {
      expect(shouldShareLocation({ ...base, [off]: false })).toBe(false);
    });
  }
  it("does not share for a non-accepted pair", () => {
    for (const status of ["pending", "declined"]) {
      expect(shouldShareLocation({ ...base, status })).toBe(false);
    }
  });
});

async function seedPair() {
  await sql`truncate table user_preferences, friendships, notifications, gamertag_links, "user" restart identity cascade`;
  await db.insert(user).values([
    { id: "la", name: "LA", email: "la@x.com" },
    { id: "lb", name: "LB", email: "lb@x.com" },
    { id: "lc", name: "LC", email: "lc@x.com" },
  ]);
  await db.insert(gamertagLinks).values([
    { userId: "la", gamertag: "LocAlpha", status: "verified", verifiedAt: new Date() },
    { userId: "lb", gamertag: "LocBravo", status: "verified", verifiedAt: new Date() },
    { userId: "lc", gamertag: "LocCharlie", status: "verified", verifiedAt: new Date() },
  ]);
  await request(db, { fromUserId: "la", toUserId: "lb" });
  const [row] = await db.select().from(friendships);
  await accept(db, { userId: "lb", friendshipId: row!.id });
  return row!.id;
}

describe("location flags", () => {
  beforeEach(seedPair);
  afterAll(async () => { await sql.end(); });

  it("defaults to per-pair sharing on and the master switch off", async () => {
    const out = await listFriends(db, { userId: "la" });
    expect(out.friends[0]!.sharesLocation).toBe(true);
    expect(out.shareLocation).toBe(false);
  });

  it("reports reciprocity as effective sharing, undifferentiated", async () => {
    const id = (await listFriends(db, { userId: "la" })).friends[0]!.id;

    // Both master switches off => neither sees the other.
    expect((await listFriends(db, { userId: "la" })).friends[0]!.theyShareLocation).toBe(false);

    // lb turns their master on: la now sees lb sharing.
    await setShareLocation(db, { userId: "lb", shareLocation: true });
    expect((await listFriends(db, { userId: "la" })).friends[0]!.theyShareLocation).toBe(true);

    // lb hides from la specifically: same undifferentiated false as master-off.
    await setLocationFlag(db, { userId: "lb", friendshipId: id, share: false });
    expect((await listFriends(db, { userId: "la" })).friends[0]!.theyShareLocation).toBe(false);
  });

  it("writes each side's flag independently", async () => {
    const id = (await listFriends(db, { userId: "la" })).friends[0]!.id;
    await setLocationFlag(db, { userId: "la", friendshipId: id, share: false });
    expect((await listFriends(db, { userId: "la" })).friends[0]!.sharesLocation).toBe(false);
    expect((await listFriends(db, { userId: "lb" })).friends[0]!.sharesLocation).toBe(true);
  });

  it("rejects a caller who is not a party", async () => {
    const id = (await listFriends(db, { userId: "la" })).friends[0]!.id;
    await expect(setLocationFlag(db, { userId: "lc", friendshipId: id, share: false }))
      .rejects.toThrow(/not_found/);
  });

  it("treats an absent preferences row as sharing off, and upserts idempotently", async () => {
    expect(await getShareLocation(db, "la")).toBe(false);
    await setShareLocation(db, { userId: "la", shareLocation: true });
    expect(await getShareLocation(db, "la")).toBe(true);
    await setShareLocation(db, { userId: "la", shareLocation: false });
    expect(await getShareLocation(db, "la")).toBe(false);
    const rows = await db.select().from(userPreferences);
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/friends run test location`
Expected: FAIL — cannot resolve `../src/location.js`.

- [ ] **Step 3: Implement `location.ts`**

```ts
import type { Database } from "@onelife/db";
import { friendships, userPreferences } from "@onelife/db";
import { and, eq, or } from "drizzle-orm";
import { FriendError } from "./errors.js";

/**
 * Whether subject S's location is visible to observer O. Pure.
 *
 * Effective sharing is `master AND per-pair` — the master switch (default false) is the
 * deliberate opt-in, the per-pair flag (default true) means "not individually hidden".
 *
 * Unlike presence there is no observer-side flag: a location you can see is one you asked
 * to see by opening the map, not something pushed at you.
 */
export function shouldShareLocation(a: {
  status: string; masterShare: boolean; pairShare: boolean;
}): boolean {
  return a.status === "accepted" && a.masterShare && a.pairShare;
}

/** Set this caller's own location flag on one friendship. Which physical column that is
 *  depends on which side of the canonically-ordered pair the caller is. A non-party gets
 *  `not_found`, matching cancel/remove: they must not learn the row exists. */
export async function setLocationFlag(
  db: Database,
  a: { userId: string; friendshipId: number; share: boolean },
): Promise<void> {
  const [row] = await db
    .select({ id: friendships.id, userA: friendships.userA })
    .from(friendships)
    .where(and(
      eq(friendships.id, a.friendshipId),
      or(eq(friendships.userA, a.userId), eq(friendships.userB, a.userId)),
    ))
    .limit(1);
  if (!row) throw new FriendError("not_found");

  const isA = row.userA === a.userId;
  await db.update(friendships)
    .set(isA ? { aSharesLocation: a.share } : { bSharesLocation: a.share })
    .where(eq(friendships.id, row.id));
}

/** An absent row means defaults, so "no row" is false, never an error. */
export async function getShareLocation(db: Database, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ shareLocation: userPreferences.shareLocation })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  return row?.shareLocation ?? false;
}

export async function setShareLocation(
  db: Database,
  a: { userId: string; shareLocation: boolean },
): Promise<void> {
  await db
    .insert(userPreferences)
    .values({ userId: a.userId, shareLocation: a.shareLocation, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { shareLocation: a.shareLocation, updatedAt: new Date() },
    });
}
```

- [ ] **Step 4: Expose the flags and the reciprocity signal**

In `packages/friends/src/queries.ts`, add to `FriendEntry`:

```ts
  /** The viewer's own per-pair flag. */
  sharesLocation: boolean;
  /**
   * Whether the OTHER party's location is effectively visible to the viewer — their master
   * switch AND their per-pair flag, collapsed to one boolean.
   *
   * ⚠️ DELIBERATELY UNDIFFERENTIATED. It must never distinguish "their master switch is off"
   * from "they have hidden from you specifically". Differentiating would have the app tell one
   * player that a named friend singled them out, which makes the per-friend hide switch a
   * visible act and therefore unusable. This is also the ONE place this codebase reports
   * anything about another user's settings — presence deliberately reports none. Do not
   * generalise it.
   */
  theyShareLocation: boolean;
```

`viewOf` already projects `iShareLocation`/`theyShareLocation` per-pair. The master switch for the *other* party is not in that projection, so `listFriends` must resolve it. Add a helper beside `gamertagsFor`:

```ts
/** The share_location master switch for a set of users. Absent row ⇒ false. */
async function shareLocationFor(db: Database, userIds: string[]): Promise<Map<string, boolean>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ userId: userPreferences.userId, shareLocation: userPreferences.shareLocation })
    .from(userPreferences)
    .where(inArray(userPreferences.userId, userIds));
  return new Map(rows.map((r) => [r.userId, r.shareLocation]));
}
```

Import `userPreferences` from `@onelife/db` and `shouldShareLocation` from `./location.js`. In `listFriends`, resolve it alongside the gamertags:

```ts
  const masters = await shareLocationFor(db, views.map((v) => v.view.friendUserId));
```

and in the `entry()` builder add:

```ts
      sharesLocation: v.view.iShareLocation,
      theyShareLocation: shouldShareLocation({
        status: v.row.status,
        masterShare: masters.get(v.view.friendUserId) ?? false,
        pairShare: v.view.theyShareLocation,
      }),
```

Widen `listFriends`'s return with `shareLocation: boolean`, resolved via `getShareLocation(db, a.userId)`, alongside the existing `sharePresence`.

- [ ] **Step 5: Export from the barrel**

In `packages/friends/src/index.ts`:

```ts
export { shouldShareLocation, setLocationFlag, getShareLocation, setShareLocation } from "./location.js";
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @onelife/friends run test`
Expected: PASS — the whole package suite.

- [ ] **Step 7: Commit**

```bash
pnpm --filter @onelife/friends run typecheck
git add packages/friends
git commit -m "feat(friends): location sharing flags and the reciprocity signal"
```

---

### Task 3: Consent reset on verification

**Files:**
- Modify: `apps/verifier/src/pg-store.ts`
- Test: `apps/verifier/test/` (add to the existing suite covering `verifyLink`; if none covers it, create `apps/verifier/test/consent-reset.test.ts`)

**Interfaces:**
- Consumes: `userPreferences` from `@onelife/db`.
- Produces: no new exports — `verifyLink` gains a side effect.

- [ ] **Step 1: Write the failing test**

`verifyLink(linkId, verifiedAt)` in `apps/verifier/src/pg-store.ts` is the single write path that sets `status='verified'`. Read the file and its existing tests first, and match how they construct the store (it holds a `this.tx` transaction handle).

Create `apps/verifier/test/consent-reset.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { user, gamertagLinks, userPreferences } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { eq } from "drizzle-orm";
import { PgVerificationStore } from "../src/pg-store.js";

const { db, sql } = getTestDb();

beforeEach(async () => {
  await sql`truncate table user_preferences, gamertag_links, "user" restart identity cascade`;
  await db.insert(user).values({ id: "vr", name: "VR", email: "vr@x.com" });
});
afterAll(async () => { await sql.end(); });

describe("verifyLink consent reset", () => {
  it("resets both master switches when a link is verified", async () => {
    const [link] = await db.insert(gamertagLinks)
      .values({ userId: "vr", gamertag: "ResetMe", status: "pending" })
      .returning();
    await db.insert(userPreferences)
      .values({ userId: "vr", sharePresence: true, shareLocation: true });

    await db.transaction(async (tx) => {
      const store = new PgVerificationStore(tx);
      await store.verifyLink(link!.id, new Date());
    });

    const [prefs] = await db.select().from(userPreferences).where(eq(userPreferences.userId, "vr"));
    expect(prefs!.sharePresence).toBe(false);
    expect(prefs!.shareLocation).toBe(false);
  });

  it("is a no-op for a first-time verifier with no preferences row", async () => {
    const [link] = await db.insert(gamertagLinks)
      .values({ userId: "vr", gamertag: "FirstTime", status: "pending" })
      .returning();

    await db.transaction(async (tx) => {
      const store = new PgVerificationStore(tx);
      await store.verifyLink(link!.id, new Date());
    });

    // No row is created just to hold two falses — absent already means false.
    expect(await db.select().from(userPreferences)).toHaveLength(0);
    const [row] = await db.select().from(gamertagLinks).where(eq(gamertagLinks.id, link!.id));
    expect(row!.status).toBe("verified");
  });
});
```

If the store class is not named `PgVerificationStore` or is not constructed with a transaction handle, use whatever the real file exports — read it first and adjust these two tests to match, noting the difference in your report.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/verifier run test consent-reset`
Expected: FAIL — `sharePresence` and `shareLocation` are still `true`.

- [ ] **Step 3: Implement the reset**

In `apps/verifier/src/pg-store.ts`, extend `verifyLink`:

```ts
  /**
   * Marks a link verified AND resets that user's sharing master switches.
   *
   * Both happen in the same transaction, deliberately. A friendship's per-pair sharing flags
   * survive a link being released, so without this a user who releases a gamertag and later
   * verifies a DIFFERENT one silently resurrects consent their friends granted against the old
   * identity (F1's deferred prerequisite; see the F2 spec §4).
   *
   * This fires on EVERY verification, not only a re-verification. For a first-time verifier it
   * updates zero rows — an absent user_preferences row already means false — so there is no
   * "is this a re-verification?" branch to get wrong, and no row is created just to hold
   * defaults.
   */
  async verifyLink(linkId: number, verifiedAt: Date): Promise<void> {
    const [link] = await this.tx
      .update(gamertagLinks)
      .set({ status: "verified", verifiedAt })
      .where(eq(gamertagLinks.id, linkId))
      .returning({ userId: gamertagLinks.userId });
    if (!link) return;
    await this.tx
      .update(userPreferences)
      .set({ sharePresence: false, shareLocation: false, updatedAt: verifiedAt })
      .where(eq(userPreferences.userId, link.userId));
  }
```

Add `userPreferences` to the `@onelife/db` import at the top of the file.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @onelife/verifier run test`
Expected: PASS — the whole verifier suite, including any pre-existing `verifyLink` coverage.

- [ ] **Step 5: Commit**

```bash
pnpm turbo run typecheck
git add apps/verifier
git commit -m "feat(verifier): reset sharing consent when a gamertag link is verified"
```

---

### Task 4: The friend-positions read model

**Files:**
- Create: `packages/read-models/src/friend-positions.ts`, `packages/read-models/test/friend-positions.test.ts`
- Modify: `packages/read-models/src/index.ts`, `packages/read-models/package.json`

**Interfaces:**
- Consumes: `shouldShareLocation` from `@onelife/friends`; `MARKER_MAX_AGE_SECONDS` from `./life-track-shape.js`.
- Produces:
  - `type FriendPosition = { gamertag: string; x: number; y: number; recordedAt: Date; self: boolean }`
  - `getFriendPositions(db, a: { viewerUserId: string; serverId: number; now: Date }): Promise<FriendPosition[]>`

- [ ] **Step 1: Write the failing test**

Create `packages/read-models/test/friend-positions.test.ts`. Read a neighbouring read-model test first and match how it seeds servers/players/lives/sessions.

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  user, gamertagLinks, servers, players, lives, sessions, positions,
  friendships, userPreferences,
} from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { eq } from "drizzle-orm";
import { getFriendPositions } from "../src/friend-positions.js";

const { db, sql } = getTestDb();
const NOW = new Date("2026-07-22T12:00:00Z");

let serverId = 0;

/** Viewer "va" and friend "vb" (va < vb, so va is side A). */
async function seed(o: {
  masterShare?: boolean; pairShare?: boolean; status?: string;
  online?: boolean; positionAt?: Date; friendVerified?: boolean;
} = {}) {
  await sql`truncate table user_preferences, friendships, positions, sessions, lives, players, servers, gamertag_links, "user" restart identity cascade`;
  await db.insert(user).values([
    { id: "va", name: "VA", email: "va@x.com" },
    { id: "vb", name: "VB", email: "vb@x.com" },
  ]);
  await db.insert(gamertagLinks).values([
    { userId: "va", gamertag: "ViewerAlpha", status: "verified", verifiedAt: NOW },
    { userId: "vb", gamertag: "FriendBravo", status: o.friendVerified === false ? "pending" : "verified",
      verifiedAt: o.friendVerified === false ? null : NOW },
  ]);
  const [srv] = await db.insert(servers)
    .values({ nitradoServiceId: 995001, name: "Sakhal", map: "sakhal", slug: "sakhal" })
    .returning();
  serverId = srv!.id;

  for (const [gamertag, uid] of [["ViewerAlpha", "va"], ["FriendBravo", "vb"]] as const) {
    const [p] = await db.insert(players).values({ gamertag, lastSeenAt: NOW }).returning();
    const [life] = await db.insert(lives)
      .values({ serverId: srv!.id, playerId: p!.id, lifeNumber: 1, startedAt: new Date("2026-07-22T10:00:00Z") })
      .returning();
    const isFriend = uid === "vb";
    const open = isFriend ? (o.online ?? true) : true;
    await db.insert(sessions).values({
      serverId: srv!.id, playerId: p!.id, lifeId: life!.id,
      connectedAt: new Date("2026-07-22T11:00:00Z"),
      disconnectedAt: open ? null : new Date("2026-07-22T11:50:00Z"),
    });
    await db.insert(positions).values({
      serverId: srv!.id, playerId: p!.id, gamertag,
      x: isFriend ? 2000 : 1000, y: isFriend ? 2500 : 1500,
      recordedAt: isFriend ? (o.positionAt ?? new Date("2026-07-22T11:58:00Z")) : new Date("2026-07-22T11:58:00Z"),
    });
  }

  await db.insert(friendships).values({
    userA: "va", userB: "vb", status: o.status ?? "accepted", requestedBy: "va",
    bSharesLocation: o.pairShare ?? true,
  });
  await db.insert(userPreferences).values({ userId: "vb", shareLocation: o.masterShare ?? true });
}

const call = () => getFriendPositions(db, { viewerUserId: "va", serverId, now: NOW });

beforeEach(() => seed());
afterAll(async () => { await sql.end(); });

describe("getFriendPositions", () => {
  it("returns the viewer's own dot and a sharing friend's", async () => {
    const out = await call();
    expect(out.map((p) => p.gamertag).sort()).toEqual(["FriendBravo", "ViewerAlpha"]);
    expect(out.find((p) => p.gamertag === "ViewerAlpha")!.self).toBe(true);
    expect(out.find((p) => p.gamertag === "FriendBravo")!.self).toBe(false);
    expect(out.find((p) => p.gamertag === "FriendBravo")!.x).toBe(2000);
  });

  it("omits a friend whose master switch is off", async () => {
    await seed({ masterShare: false });
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  it("omits a friend who has hidden from the viewer specifically", async () => {
    await seed({ pairShare: false });
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  it("omits a non-accepted pair", async () => {
    await seed({ status: "pending" });
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  it("omits an offline friend", async () => {
    await seed({ online: false });
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  it("omits a friend whose last position is older than the staleness cap", async () => {
    await seed({ positionAt: new Date("2026-07-22T11:40:00Z") }); // 20 min old
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  // ⚠️ F1's deferred prerequisite. A released verified link leaves the friendship row and its
  // sharing flags intact; without the inner join on a VERIFIED link, coordinates keep flowing.
  it("omits a friend whose verified gamertag link was released, despite live flags", async () => {
    await seed({ friendVerified: false });
    expect((await call()).map((p) => p.gamertag)).toEqual(["ViewerAlpha"]);
  });

  it("returns the viewer's own dot regardless of their own sharing flags", async () => {
    await db.insert(userPreferences).values({ userId: "va", shareLocation: false })
      .onConflictDoUpdate({ target: userPreferences.userId, set: { shareLocation: false } });
    await db.update(friendships).set({ aSharesLocation: false }).where(eq(friendships.userA, "va"));
    expect((await call()).map((p) => p.gamertag)).toContain("ViewerAlpha");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/read-models run test friend-positions`
Expected: FAIL — cannot resolve `../src/friend-positions.js`.

- [ ] **Step 3: Implement the read model**

Add `"@onelife/friends": "workspace:*"` to `packages/read-models/package.json` dependencies, then `pnpm install` from the repo root.

Create `packages/read-models/src/friend-positions.ts`:

```ts
import type { Database } from "@onelife/db";
import {
  friendships, gamertagLinks, players, positions, sessions, userPreferences,
} from "@onelife/db";
import { shouldShareLocation } from "@onelife/friends";
import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { MARKER_MAX_AGE_SECONDS } from "./life-track-shape.js";

export interface FriendPosition {
  gamertag: string;
  x: number;
  y: number;
  recordedAt: Date;
  self: boolean;
}

/**
 * Everyone the viewer may see on one server: themselves, plus each friend sharing with them.
 *
 * ⚠️ The viewer is identified by SESSION-DERIVED user id only. This read model is reached from
 * a /me route that takes no player identifier, so a caller cannot name a subject — the subject
 * set is computed here from the viewer's own friendships. Do not add a "which player" parameter.
 *
 * The join to `gamertag_links` is INNER and requires `verified`: a released link means no
 * coordinates, unconditionally, even though the friendship row and its sharing flags survive.
 * That is the structural half of F1's deferred prerequisite (F2 spec §4).
 */
export async function getFriendPositions(
  db: Database,
  a: { viewerUserId: string; serverId: number; now: Date },
): Promise<FriendPosition[]> {
  const freshest = new Date(a.now.getTime() - MARKER_MAX_AGE_SECONDS * 1000);

  // The viewer's own gamertag. No verified link ⇒ no map at all (the route also checks, but
  // this keeps the read model safe on its own).
  const [viewer] = await db
    .select({ gamertag: gamertagLinks.gamertag })
    .from(gamertagLinks)
    .where(and(
      eq(gamertagLinks.userId, a.viewerUserId),
      eq(gamertagLinks.status, "verified"),
    ))
    .limit(1);
  if (!viewer) return [];

  // Candidate friends with both sides' flags plus the FRIEND's master switch. Eligibility is
  // decided in TypeScript by shouldShareLocation so the rule lives in exactly one place.
  const friendRows = await db
    .select({
      userA: friendships.userA,
      userB: friendships.userB,
      status: friendships.status,
      aShares: friendships.aSharesLocation,
      bShares: friendships.bSharesLocation,
      friendUserId: gamertagLinks.userId,
      gamertag: gamertagLinks.gamertag,
      masterShare: userPreferences.shareLocation,
    })
    .from(friendships)
    .innerJoin(gamertagLinks, and(
      eq(gamertagLinks.status, "verified"),
      or(
        and(eq(friendships.userA, a.viewerUserId), eq(gamertagLinks.userId, friendships.userB)),
        and(eq(friendships.userB, a.viewerUserId), eq(gamertagLinks.userId, friendships.userA)),
      ),
    ))
    .leftJoin(userPreferences, eq(userPreferences.userId, gamertagLinks.userId));

  const visible = friendRows.filter((r) =>
    shouldShareLocation({
      status: r.status,
      // Absent preferences row ⇒ false. Never permissive.
      masterShare: r.masterShare ?? false,
      // The FRIEND's own per-pair flag: theirs is the A column when they are side A.
      pairShare: r.userA === r.friendUserId ? r.aShares : r.bShares,
    }),
  );

  const gamertags = [viewer.gamertag, ...visible.map((r) => r.gamertag)];
  if (gamertags.length === 0) return [];

  // Latest fresh position per gamertag on this server, for players with an OPEN session there.
  // DISTINCT ON is the shape Drizzle cannot express, hence raw SQL.
  const rows = await db.execute<{
    gamertag: string; x: number; y: number; recorded_at: Date;
  }>(sql`
    SELECT DISTINCT ON (lower(p.gamertag))
           p.gamertag, p.x, p.y, p.recorded_at
    FROM ${positions} p
    JOIN ${players} pl ON pl.id = p.player_id
    JOIN ${sessions} s ON s.player_id = pl.id
                      AND s.server_id = ${a.serverId}
                      AND s.disconnected_at IS NULL
    WHERE p.server_id = ${a.serverId}
      AND p.recorded_at >= ${freshest}
      AND lower(p.gamertag) = ANY(${sql.raw(`ARRAY[${gamertags.map((g) => `'${g.toLowerCase().replace(/'/g, "''")}'`).join(",")}]`)})
    ORDER BY lower(p.gamertag), p.recorded_at DESC
  `);

  return rows.map((r) => ({
    gamertag: r.gamertag,
    x: Number(r.x),
    y: Number(r.y),
    recordedAt: new Date(r.recorded_at),
    self: r.gamertag.toLowerCase() === viewer.gamertag.toLowerCase(),
  }));
}
```

**If the raw-SQL array interpolation above does not work cleanly with this Drizzle version, replace it with a parameterised `inArray` over a lowercased column or a `sql.join` of placeholders — do NOT leave string interpolation of user-derived values in place.** Gamertags come from the database rather than the request here, but an interpolated identifier is a pattern that gets copied to somewhere it is not safe. Report whichever form you used.

Export from `packages/read-models/src/index.ts`:

```ts
export { getFriendPositions } from "./friend-positions.js";
export type { FriendPosition } from "./friend-positions.js";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @onelife/read-models run test friend-positions`
Expected: PASS — 8 tests.

- [ ] **Step 5: Prove the F1-prerequisite test is real**

Temporarily change the `gamertag_links` join in `friendRows` from `innerJoin` to `leftJoin` and drop the `status = 'verified'` condition, then re-run.

Expected: **"omits a friend whose verified gamertag link was released" FAILS.** Revert and confirm it passes. This is the hole that was filed rather than fixed twice; a test that cannot fail would let it be reintroduced.

- [ ] **Step 6: Commit**

```bash
pnpm turbo run typecheck
git add packages/read-models pnpm-lock.yaml
git commit -m "feat(read-models): friend positions for the shared map"
```

---

### Task 5: The map API route

**Files:**
- Create: `apps/api/src/routes/friend-map.ts`, `apps/api/test/friend-map-routes.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: `getFriendPositions` from `@onelife/read-models`; `resolveServerBySlug` from `../lib/resolve-server.js`.
- Produces:
  - `GET /me/maps/:mapSlug` → `{ mapCodename: string; positions: FriendPosition[] }`
  - `GET /me/maps` → `{ servers: { slug: string; name: string; map: string; friendCount: number }[] }`
  - `registerFriendMapRoutes(app, db, auth): void`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/friend-map-routes.test.ts`, following `apps/api/test/friends-routes.test.ts`'s harness exactly (each suite builds its own app and authenticates via a real magic-link sign-in; there is no shared harness).

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, gamertagLinks, servers } from "@onelife/db";
import { eq } from "drizzle-orm";
import { createAuth, type Mailer } from "@onelife/auth";
import { buildApp } from "../src/app.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 8e8;
const email = `map${svc}@example.com`;

let lastLink = "";
const captureMailer: Mailer = { async send(msg) { lastLink = msg.url; } };
const auth = createAuth(db, {
  secret: "s".repeat(32), baseURL: "http://localhost", trustedOrigins: ["http://localhost"],
  providers: {}, mailer: captureMailer,
});
const app = buildApp(db, { auth, corsOrigins: ["http://localhost"], vapidPublicKey: "TEST" });

function cookieHeader(setCookie: string | string[] | undefined): string {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr.map((c) => c.split(";")[0]).join("; ");
}
async function signIn(addr: string): Promise<string> {
  await app.inject({
    method: "POST", url: "/api/auth/sign-in/magic-link",
    headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost" },
    payload: { email: addr },
  });
  const verify = await app.inject({
    method: "GET", url: lastLink.replace(/^https?:\/\/[^/]+/, ""), headers: { host: "localhost" },
  });
  return cookieHeader(verify.headers["set-cookie"] as string | string[] | undefined);
}

let cookie = "";

beforeAll(async () => {
  await app.ready();
  cookie = await signIn(email);
  await db.insert(servers)
    .values({ nitradoServiceId: svc, name: "Sakhal", map: "sakhal", slug: `sakhal-${svc}` });
});
afterAll(async () => { await app.close(); await sql.end(); });

const get = (url: string, c?: string) =>
  app.inject({ method: "GET", url, headers: c ? { cookie: c } : {} });

describe("friend map routes", () => {
  it("401s when signed out", async () => {
    expect((await get(`/me/maps/sakhal-${svc}`)).statusCode).toBe(401);
    expect((await get("/me/maps")).statusCode).toBe(401);
  });

  it("403s not_verified for a signed-in user with no verified gamertag", async () => {
    const res = await get(`/me/maps/sakhal-${svc}`, cookie);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("not_verified");
  });

  it("serves the map once verified, with no-store", async () => {
    const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase()));
    await db.insert(gamertagLinks)
      .values({ userId: u!.id, gamertag: `Mapper${svc}`, status: "verified", verifiedAt: new Date() });

    const res = await get(`/me/maps/sakhal-${svc}`, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().mapCodename).toBe("sakhal");
    expect(Array.isArray(res.json().positions)).toBe(true);
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.headers["cache-control"]).toContain("private");
  });

  it("404s an unknown server slug", async () => {
    expect((await get("/me/maps/no-such-server", cookie)).statusCode).toBe(404);
  });

  it("lists servers with friend counts", async () => {
    const res = await get("/me/maps", cookie);
    expect(res.statusCode).toBe(200);
    const entry = res.json().servers.find((s: { slug: string }) => s.slug === `sakhal-${svc}`);
    expect(entry).toBeTruthy();
    expect(entry.friendCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/api run test friend-map`
Expected: FAIL — the routes 404.

- [ ] **Step 3: Implement the routes**

Create `apps/api/src/routes/friend-map.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import type { Auth } from "@onelife/auth";
import { gamertagLinks, servers } from "@onelife/db";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { getFriendPositions } from "@onelife/read-models";
import { getSession } from "../auth-plugin.js";
import { resolveServerBySlug } from "../lib/resolve-server.js";

const params = z.object({ mapSlug: z.string().min(1) });

/** The viewer's verified gamertag, or null. A pending link is deliberately insufficient:
 *  anyone can type any gamertag into the claim box, so only a link that survived emote
 *  verification unlocks coordinates — the same rule as the owner-only track route. */
async function verifiedGamertag(db: Database, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ gamertag: gamertagLinks.gamertag })
    .from(gamertagLinks)
    .where(and(eq(gamertagLinks.userId, userId), eq(gamertagLinks.status, "verified")))
    .limit(1);
  return row?.gamertag ?? null;
}

/**
 * SECURITY: neither route takes a player identifier. The subject set comes entirely from the
 * session, so requesting a NAMED player's coordinates is unexpressible rather than merely
 * rejected — the same property the owner-only track route holds. Do not add a
 * gamertag/slug/userId parameter to either of these for any reason.
 */
export function registerFriendMapRoutes(app: FastifyInstance, db: Database, auth: Auth): void {
  app.get("/me/maps", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    if (!(await verifiedGamertag(db, session.user.id))) {
      return reply.code(403).send({ error: "not_verified" });
    }

    const rows = await db
      .select({ slug: servers.slug, name: servers.name, map: servers.map, id: servers.id })
      .from(servers)
      .where(and(eq(servers.active, true), isNotNull(servers.slug)))
      .orderBy(asc(servers.name));

    const now = new Date();
    const out = [];
    for (const s of rows) {
      const positions = await getFriendPositions(db, {
        viewerUserId: session.user.id, serverId: s.id, now,
      });
      out.push({
        slug: s.slug as string, name: s.name, map: s.map,
        // The viewer's own dot is not a "friend on this server".
        friendCount: positions.filter((p) => !p.self).length,
      });
    }
    // Counts are derived from who is sharing with this viewer — as sensitive as the map itself.
    reply.header("cache-control", "no-store, private");
    return { servers: out };
  });

  app.get("/me/maps/:mapSlug", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    if (!(await verifiedGamertag(db, session.user.id))) {
      return reply.code(403).send({ error: "not_verified" });
    }

    const parsed = params.safeParse(req.params);
    if (!parsed.success) return reply.code(404).send({ error: "not_found" });
    const server = await resolveServerBySlug(db, parsed.data.mapSlug);
    if (!server) return reply.code(404).send({ error: "not_found" });

    const positions = await getFriendPositions(db, {
      viewerUserId: session.user.id, serverId: server.id, now: new Date(),
    });

    // A shared proxy or CDN caching this would hand one player's squad positions to the next
    // visitor — the classic way a correct auth check still leaks.
    reply.header("cache-control", "no-store, private");
    return { mapCodename: server.map, positions };
  });
}
```

In `apps/api/src/app.ts`, import and register it in the authenticated block, after `registerPreferenceRoutes`:

```ts
import { registerFriendMapRoutes } from "./routes/friend-map.js";
```
```ts
    registerFriendMapRoutes(app, db, opts.auth);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @onelife/api run test`
Expected: PASS — the whole API suite.

- [ ] **Step 5: Commit**

```bash
pnpm turbo run typecheck
git add apps/api
git commit -m "feat(api): friend map routes"
```

---

### Task 6: Extract the Leaflet shell

**Files:**
- Create: `apps/web/src/components/map/map-canvas.tsx`
- Modify: `apps/web/src/components/life/track-map.tsx`
- Test: `apps/web/src/components/life/track-map.test.tsx` must pass **unmodified**

**Interfaces:**
- Produces:
  - `type DrawContext = { L: LeafletModule; map: LeafletMap; group: LeafletLayer; pt: (x: number, y: number) => unknown }`
  - `type DrawFn = (ctx: DrawContext) => unknown[]` — returns the points to fit on first draw.
  - `MapCanvas({ mapCodename, draw, drawKey, emptyFallback })`
  - `LeafletModule`, `LeafletMap`, `LeafletLayer` interfaces re-exported for consumers.

This is a **pure refactor**: no behaviour changes, and `track-map.test.tsx` is the proof.

- [ ] **Step 1: Read the existing component first**

Read `apps/web/src/components/life/track-map.tsx` end to end before touching it. Nearly every comment in it documents a bug that was found and fixed: the two-effect split (map lifecycle keyed on `size`, layer redraw keyed on data), the `hasFitRef` latch that must only latch on a *real* first draw, the LayerGroup created-then-added rather than chained, the `isolate` stacking context, the dynamic import that keeps Leaflet out of SSR, and the `errorTileUrl` fallback. **All of that behaviour must survive the extraction unchanged.**

- [ ] **Step 2: Run the existing test to record the baseline**

Run: `pnpm --filter @onelife/web run test track-map`
Expected: PASS. Note the count; it must be identical at the end, with the file unmodified.

- [ ] **Step 3: Create the shell**

Create `apps/web/src/components/map/map-canvas.tsx`, moving the Leaflet lifecycle out of `TrackMap` verbatim. The shell owns: the dynamic import, map creation, the tile layer, the LayerGroup, the first-draw `fitBounds` latch, the error and unmapped-terrain states, and the container element. The consumer owns only what to draw.

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { worldSize, worldToPixel } from "@/lib/dayz-projection";
import "leaflet/dist/leaflet.css";

const MAX_ZOOM = 6;
const CANVAS_PX = 256 * 2 ** MAX_ZOOM;
const TILE_ATTRIBUTION = '<a href="https://dayz.xam.nu" target="_blank">Tiles © Xam.nu</a>';

export interface LeafletMap {
  unproject: (p: [number, number], zoom: number) => unknown;
  fitBounds: (bounds: unknown, opts?: unknown) => void;
  setView: (center: unknown, zoom: number) => void;
  remove: () => void;
}
export interface LeafletLayer {
  addTo: (target: unknown) => LeafletLayer;
  bindPopup?: (text: string) => void;
  clearLayers?: () => void;
}
export interface LeafletModule {
  CRS: { Simple: unknown };
  map: (el: HTMLElement, opts: Record<string, unknown>) => LeafletMap;
  tileLayer: (url: string, opts: Record<string, unknown>) => LeafletLayer;
  polyline: (latlngs: unknown[], opts: Record<string, unknown>) => LeafletLayer;
  circleMarker: (latlng: unknown, opts: Record<string, unknown>) => LeafletLayer;
  layerGroup: () => LeafletLayer;
  latLngBounds: (v: unknown[]) => unknown;
}

export interface DrawContext {
  L: LeafletModule;
  map: LeafletMap;
  group: LeafletLayer;
  /** World metres → a Leaflet latlng on this map's pyramid. */
  pt: (x: number, y: number) => unknown;
}

/** Draws into the supplied group and returns the points the shell should fit on first draw. */
export type DrawFn = (ctx: DrawContext) => unknown[];

/**
 * The Leaflet shell: lifecycle, tiles, projection, first-fit and failure states.
 *
 * Extracted from TrackMap so the life trail and the friends map cannot drift apart on tile
 * paths or projection details — that tile path was already corrected once, mid-spec. Consumers
 * supply only a `draw` function; everything subtle lives here.
 */
export default function MapCanvas({ mapCodename, draw, drawKey }: {
  mapCodename: string;
  draw: DrawFn;
  /** Changes whenever the data to draw changes; drives the redraw effect. */
  drawKey: unknown;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const size = worldSize(mapCodename);
  const [loadError, setLoadError] = useState(false);

  // Kept live so the async import callback (which closes over the draw fn current when the
  // creation effect FIRST ran) draws up-to-date layers once Leaflet resolves.
  const drawRef = useRef(draw);
  drawRef.current = draw;

  const leafletRef = useRef<LeafletModule | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerGroupRef = useRef<LeafletLayer | null>(null);
  const hasFitRef = useRef(false);

  function runDraw() {
    const L = leafletRef.current;
    const m = mapRef.current;
    if (!L || !m || size === null) return;

    // The SAME LayerGroup, cleared and rebuilt, rather than diffed — keeps what's on the map
    // in lockstep with the data, with no stale layer and no ever-growing layer count.
    if (layerGroupRef.current) {
      layerGroupRef.current.clearLayers?.();
    } else {
      // Created and added as two separate calls, NOT `L.layerGroup().addTo(m)`. Real Leaflet's
      // addTo() returns `this`, but relying on that return means a double whose addTo() returns
      // undefined creates a NEW LayerGroup every poll forever, since the ref stays null and the
      // clearLayers() branch is never taken — the unbounded-layer leak this split removed.
      const group = L.layerGroup();
      group.addTo(m);
      layerGroupRef.current = group;
    }

    const pt = (x: number, y: number) => m.unproject(worldToPixel(x, y, size, CANVAS_PX), MAX_ZOOM);
    const fitPoints = drawRef.current({ L, map: m, group: layerGroupRef.current, pt });

    // fitBounds only on the FIRST draw: a live poll must never snap the view out from under
    // someone who has zoomed in and opened a popup.
    if (!hasFitRef.current) {
      if (fitPoints.length > 0) {
        m.fitBounds(L.latLngBounds(fitPoints), { padding: [24, 24] });
        // Only latched on a REAL first draw. Latching on an empty draw would leave a map that
        // never fits once data arrives on a later poll.
        hasFitRef.current = true;
      } else {
        m.setView(pt(size / 2, size / 2), 1);
      }
    }
  }

  // Effect 1: create the map. Keyed ONLY on `size` — not on the data, whose identity changes
  // every poll. Re-running this per poll destroyed and rebuilt the map, snapping the view and
  // closing popups with no user input.
  useEffect(() => {
    setLoadError(false);
    if (!ref.current || size === null) return;
    let cancelled = false;
    hasFitRef.current = false;

    // Dynamically imported so Leaflet never enters the server bundle and never runs during
    // SSR — the page must stay coordinate-free on the server.
    void import("leaflet")
      .then((mod) => {
        if (cancelled || !ref.current) return;
        const L = mod.default as unknown as LeafletModule;
        leafletRef.current = L;
        const m = L.map(ref.current, {
          crs: L.CRS.Simple, minZoom: 0, maxZoom: MAX_ZOOM, attributionControl: true,
        });
        mapRef.current = m;
        L.tileLayer(`/tiles/${mapCodename}/topographic/{z}/{x}/{y}.webp`, {
          minZoom: 0, maxZoom: MAX_ZOOM, noWrap: true,
          errorTileUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
          attribution: TILE_ATTRIBUTION,
        }).addTo(m);
        runDraw();
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
      leafletRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, mapCodename]);

  // Effect 2: redraw when the data changes. A no-op until the creation effect has resolved.
  useEffect(() => {
    runDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawKey]);

  if (size === null) {
    return (
      <p className="border border-hairline bg-bone px-4 py-3 font-mono text-[11px] text-ink-soft">
        Unmapped terrain — the desk has no chart for this server.
      </p>
    );
  }
  if (loadError) {
    return (
      <p role="status" className="border border-hairline bg-bone px-4 py-3 font-mono text-[11px] text-red-deep">
        Couldn&apos;t load the map.
      </p>
    );
  }

  // `isolate` is load-bearing. Leaflet assigns panes 200-700 and controls 1000, absolutely
  // positioned — without a stacking context it paints over the masthead, the notification
  // popover and the ControlsSheet. See the LAYER LEGEND in header.tsx.
  return <div ref={ref} className="isolate h-[420px] w-full border border-ink bg-dark-well" />;
}
```

- [ ] **Step 4: Rewrite `TrackMap` as a consumer**

Replace the body of `apps/web/src/components/life/track-map.tsx` with a thin consumer that keeps its existing exported name, props and rendered output. The trail/marker drawing and the `MARKER_COLOR` map move into a `draw` function; everything else is gone.

```tsx
"use client";
import MapCanvas, { type DrawContext } from "@/components/map/map-canvas";
import type { LifeTrack } from "@/lib/types";
import { staleness } from "./track-marker-list";

const MARKER_COLOR: Record<LifeTrack["markers"][number]["kind"], string> = {
  kill: "#c8102e",
  death: "#1b1b1b",
  now: "#2563eb",
};

export default function TrackMap({ track }: { track: LifeTrack }) {
  function draw({ L, group, pt }: DrawContext): unknown[] {
    const all: unknown[] = [];
    for (const seg of track.segments) {
      const latlngs = seg.points.map((p) => pt(p.x, p.y));
      all.push(...latlngs);
      if (latlngs.length > 1) L.polyline(latlngs, { color: "#c8102e", weight: 2 }).addTo(group);
    }
    for (const mk of track.markers) {
      // Held as its own reference rather than chained off addTo() — real Leaflet returns
      // `this`, but relying on that broke against a double whose addTo() returns nothing.
      const c = L.circleMarker(pt(mk.x, mk.y), {
        radius: 6, color: MARKER_COLOR[mk.kind], weight: 2, fill: false,
        dashArray: "3 3", // dashed = approximate, always
      });
      c.addTo(group);
      all.push(pt(mk.x, mk.y));
      // Routed through the same `staleness` helper as the accessible marker list: for a `now`
      // marker sampleAgeSeconds is 0 by construction, so rendering it directly would tell a
      // living player their position is current when it may be many minutes old.
      c.bindPopup?.(`${mk.kind}${mk.label ? ` — ${mk.label}` : ""} · ${staleness(mk, Date.now())}`);
    }
    return all;
  }

  return <MapCanvas mapCodename={track.mapCodename} draw={draw} drawKey={track} />;
}
```

- [ ] **Step 5: Run the existing test — unmodified — to verify the refactor**

Run: `pnpm --filter @onelife/web run test track-map`
Expected: PASS, same count as Step 2, **with `track-map.test.tsx` unchanged.**

If a test fails, the extraction changed behaviour — fix the shell, do not edit the test. If a test genuinely cannot pass because it reaches into `TrackMap`'s internals rather than its behaviour, report that rather than quietly rewriting it.

- [ ] **Step 6: Run the whole web suite and commit**

Run: `pnpm --filter @onelife/web run test && pnpm --filter @onelife/web run typecheck`

```bash
git add apps/web/src/components/map apps/web/src/components/life/track-map.tsx
git commit -m "refactor(web): extract the Leaflet shell from TrackMap"
```

---

### Task 7: Web client and the friends map component

**Files:**
- Create: `apps/web/src/components/map/friends-map.tsx`, `apps/web/src/components/map/friends-map.test.tsx`
- Modify: `apps/web/src/lib/types.ts`, `apps/web/src/lib/api.ts`

**Interfaces:**
- Consumes: `MapCanvas`, `DrawContext` (Task 6).
- Produces:
  - `type FriendPositionDto = { gamertag: string; x: number; y: number; recordedAt: string; self: boolean }`
  - `type FriendMap = { mapCodename: string; positions: FriendPositionDto[] }`
  - `type MapServerDto = { slug: string; name: string; map: string; friendCount: number }`
  - `getFriendMap(slug: string): Promise<FriendMap>`, `getMapServers(): Promise<{ servers: MapServerDto[] }>`
  - `positionAge(recordedAt: string, now: Date): string` — pure, exported for test.
  - `<FriendsMap data={FriendMap} now={Date} />`

- [ ] **Step 1: Add the DTOs and client calls**

In `apps/web/src/lib/types.ts`:

```ts
export type FriendPositionDto = {
  gamertag: string;
  x: number;
  y: number;
  /** ISO-8601. */
  recordedAt: string;
  self: boolean;
};
export type FriendMap = { mapCodename: string; positions: FriendPositionDto[] };
export type MapServerDto = { slug: string; name: string; map: string; friendCount: number };
```

In `apps/web/src/lib/api.ts`, add the two types to the import block and append:

```ts
export const getFriendMap = (slug: string) =>
  apiGet<FriendMap>(`/api/me/maps/${encodeURIComponent(slug)}`);
export const getMapServers = () => apiGet<{ servers: MapServerDto[] }>("/api/me/maps");
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/components/map/friends-map.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FriendsMapLegend, positionAge } from "./friends-map";

vi.mock("./map-canvas", () => ({ default: () => <div data-testid="canvas" /> }));

const NOW = new Date("2026-07-22T12:00:00Z");

describe("positionAge", () => {
  it("reads as just now under a minute", () => {
    expect(positionAge("2026-07-22T11:59:30Z", NOW)).toBe("just now");
  });
  it("counts whole minutes", () => {
    expect(positionAge("2026-07-22T11:55:00Z", NOW)).toBe("5m ago");
    expect(positionAge("2026-07-22T11:59:00Z", NOW)).toBe("1m ago");
  });
});

describe("FriendsMapLegend", () => {
  const you = { gamertag: "You", x: 1, y: 2, recordedAt: "2026-07-22T11:59:00Z", self: true };
  const mate = { gamertag: "Mate", x: 3, y: 4, recordedAt: "2026-07-22T11:50:00Z", self: false };

  it("lists every dot with its own age", () => {
    render(<FriendsMapLegend positions={[you, mate]} now={NOW} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("You");
    expect(items[0]).toHaveTextContent("1m ago");
    expect(items[1]).toHaveTextContent("Mate");
    expect(items[1]).toHaveTextContent("10m ago");
  });

  it("marks which dot is you", () => {
    render(<FriendsMapLegend positions={[you, mate]} now={NOW} />);
    expect(screen.getByText(/you/i)).toBeInTheDocument();
  });

  it("says plainly when nobody is sharing right now", () => {
    render(<FriendsMapLegend positions={[]} now={NOW} />);
    expect(screen.getByText(/nobody is sharing/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @onelife/web run test friends-map`
Expected: FAIL — cannot resolve `./friends-map`.

- [ ] **Step 4: Implement the component**

Create `apps/web/src/components/map/friends-map.tsx`:

```tsx
"use client";
import MapCanvas, { type DrawContext } from "./map-canvas";
import type { FriendMap, FriendPositionDto } from "@/lib/types";

const SELF_COLOR = "#2563eb";
const FRIEND_COLOR = "#c8102e";

/** Age of one fix, per dot — the page never stamps a single time across all of them. */
export function positionAge(recordedAt: string, now: Date): string {
  const mins = Math.floor((now.getTime() - new Date(recordedAt).getTime()) / 60_000);
  return mins < 1 ? "just now" : `${mins}m ago`;
}

/** The accessible companion to the canvas: every dot as text, with its own age. A map alone
 *  is unreadable to a screen reader, and this is also the honest place to say nobody is here. */
export function FriendsMapLegend({ positions, now }: { positions: FriendPositionDto[]; now: Date }) {
  if (positions.length === 0) {
    return (
      <p className="mt-3 font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted">
        Nobody is sharing a position here right now.
      </p>
    );
  }
  return (
    <ul role="list" className="mt-3 flex flex-col gap-1">
      {positions.map((p) => (
        <li key={p.gamertag} className="font-mono text-[11px] uppercase tracking-[.05em] text-ink">
          {p.gamertag}{p.self ? " (you)" : ""} · {positionAge(p.recordedAt, now)}
        </li>
      ))}
    </ul>
  );
}

export default function FriendsMap({ data, now }: { data: FriendMap; now: Date }) {
  function draw({ L, group, pt }: DrawContext): unknown[] {
    const all: unknown[] = [];
    for (const p of data.positions) {
      const at = pt(p.x, p.y);
      const c = L.circleMarker(at, {
        radius: 7, color: p.self ? SELF_COLOR : FRIEND_COLOR, weight: 2, fill: false,
        dashArray: "3 3", // dashed = approximate, matching the life trail's markers
      });
      c.addTo(group);
      c.bindPopup?.(`${p.gamertag}${p.self ? " (you)" : ""} · ${positionAge(p.recordedAt, now)}`);
      all.push(at);
    }
    return all;
  }

  return (
    <>
      <MapCanvas mapCodename={data.mapCodename} draw={draw} drawKey={data} />
      <FriendsMapLegend positions={data.positions} now={now} />
    </>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @onelife/web run test friends-map`
Expected: PASS — 6 tests.

- [ ] **Step 6: Commit**

```bash
pnpm --filter @onelife/web run typecheck
git add apps/web/src/components/map apps/web/src/lib
git commit -m "feat(web): friends map component and client calls"
```

---

### Task 8: The `/maps` pages

**Files:**
- Create: `apps/web/src/app/maps/page.tsx`, `apps/web/src/app/maps/[map]/page.tsx`, `apps/web/src/app/maps/[map]/loading.tsx`, `apps/web/src/components/map/map-page.tsx` + `.test.tsx`
- Modify: `apps/web/src/components/controls/rail.tsx`, `apps/web/src/components/controls/mobile-account.tsx`

**Interfaces:**
- Consumes: `getFriendMap`, `getMapServers`, `FriendsMap` (Task 7).
- Produces: `<MapPageView />` (props-only, exported for test) and `<MapPage slug={string} />` (container).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/map/map-page.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MapPageView } from "./map-page";

vi.mock("./friends-map", () => ({ default: () => <div data-testid="friends-map" /> }));

const NOW = new Date("2026-07-22T12:00:00Z");
const data = { mapCodename: "sakhal", positions: [] };

describe("MapPageView", () => {
  it("prompts a signed-out visitor to sign in, never a blank canvas", () => {
    render(<MapPageView signedOut now={NOW} />);
    expect(screen.getByRole("status")).toHaveTextContent(/sign in/i);
    expect(screen.queryByTestId("friends-map")).toBeNull();
  });

  it("explains to a signed-in but unverified visitor", () => {
    render(<MapPageView unverified now={NOW} />);
    expect(screen.getByRole("status")).toHaveTextContent(/verify/i);
    expect(screen.queryByTestId("friends-map")).toBeNull();
  });

  it("shows a skeleton while loading, not an empty map", () => {
    const { container } = render(<MapPageView loading now={NOW} />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByTestId("friends-map")).toBeNull();
  });

  it("distinguishes a failed load from an empty map", () => {
    render(<MapPageView error now={NOW} />);
    expect(screen.getByRole("status")).toHaveTextContent(/couldn't load/i);
    expect(screen.queryByTestId("friends-map")).toBeNull();
  });

  it("renders the map once loaded", () => {
    render(<MapPageView data={data} now={NOW} />);
    expect(screen.getByTestId("friends-map")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/web run test map-page`
Expected: FAIL — cannot resolve `./map-page`.

- [ ] **Step 3: Implement the view and container**

Create `apps/web/src/components/map/map-page.tsx`:

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getFriendMap } from "@/lib/api";
import { useAccountStatus } from "@/lib/use-account-status";
import type { FriendMap } from "@/lib/types";
import FriendsMap from "./friends-map";

const NOTE = "font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted";

export type MapPageViewProps = {
  data?: FriendMap;
  loading?: boolean;
  error?: boolean;
  signedOut?: boolean;
  unverified?: boolean;
  now: Date;
};

/** Presentational. Five states, never collapsed: signed out, unverified, loading, failed,
 *  loaded. A blank canvas would read as "nobody is here", which is a different claim. */
export function MapPageView(p: MapPageViewProps) {
  if (p.signedOut) {
    return (
      <p role="status" className={NOTE}>
        <Link href="/login" className="font-bold text-red-deep underline">Sign in</Link>
        {" "}to see where your friends are.
      </p>
    );
  }
  if (p.unverified) {
    return <p role="status" className={NOTE}>Verify your gamertag to use the map.</p>;
  }
  if (p.loading) {
    return <div aria-busy="true" aria-hidden className="h-[420px] w-full motion-safe:animate-pulse bg-bone" />;
  }
  if (p.error) {
    return <p role="status" className={NOTE}>Couldn&apos;t load the map.</p>;
  }
  if (!p.data) return null;
  return <FriendsMap data={p.data} now={p.now} />;
}

export function MapPage({ slug }: { slug: string }) {
  const account = useAccountStatus();
  const verified = account.kind === "verified";
  const q = useQuery({
    queryKey: ["friend-map", slug],
    queryFn: () => getFriendMap(slug),
    enabled: verified,
    refetchInterval: 30_000,
  });

  return (
    <MapPageView
      signedOut={account.kind === "signedOut"}
      unverified={account.kind === "unlinked" || account.kind === "pending"}
      loading={account.kind === "loading" || (verified && q.isPending)}
      error={q.isError && !q.data}
      data={q.data}
      now={new Date()}
    />
  );
}
```

- [ ] **Step 4: Add the routes**

Create `apps/web/src/app/maps/[map]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { MapPage } from "@/components/map/map-page";

export const metadata: Metadata = {
  title: "Map",
  robots: { index: false }, // per-viewer coordinates have no business in a search index
};

export default async function MapRoute({ params }: { params: Promise<{ map: string }> }) {
  const { map } = await params;
  return (
    <div className="mx-auto max-w-[68ch] px-4 py-8">
      <h1 className="font-display text-3xl uppercase tracking-[.02em]">Map</h1>
      <div className="mt-6">
        <MapPage slug={map} />
      </div>
    </div>
  );
}
```

Create `apps/web/src/app/maps/[map]/loading.tsx`:

```tsx
export default function Loading() {
  return (
    <div aria-busy="true" className="mx-auto max-w-[68ch] px-4 py-8">
      <div aria-hidden className="h-9 w-32 motion-safe:animate-pulse bg-bone" />
      <div aria-hidden className="mt-6 h-[420px] motion-safe:animate-pulse bg-bone" />
    </div>
  );
}
```

Create the picker. Split it the same way as the map: a props-only view plus a thin container, so the five states are testable without mocking a query.

`apps/web/src/components/map/server-picker.tsx`:

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getMapServers } from "@/lib/api";
import { useAccountStatus } from "@/lib/use-account-status";
import type { MapServerDto } from "@/lib/types";

const NOTE = "font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted";

export type ServerPickerViewProps = {
  servers?: MapServerDto[];
  loading?: boolean;
  error?: boolean;
  signedOut?: boolean;
  unverified?: boolean;
};

/** Presentational. Five states, never collapsed — an empty list and a failed fetch are
 *  different statements, and neither is "no servers exist". */
export function ServerPickerView(p: ServerPickerViewProps) {
  if (p.signedOut) {
    return (
      <p role="status" className={NOTE}>
        <Link href="/login" className="font-bold text-red-deep underline">Sign in</Link>
        {" "}to see where your friends are.
      </p>
    );
  }
  if (p.unverified) {
    return <p role="status" className={NOTE}>Verify your gamertag to use the map.</p>;
  }
  if (p.loading) {
    return (
      <div aria-busy="true" className="flex flex-col gap-2">
        <div aria-hidden className="h-12 motion-safe:animate-pulse bg-bone" />
        <div aria-hidden className="h-12 motion-safe:animate-pulse bg-bone" />
      </div>
    );
  }
  if (p.error) {
    return <p role="status" className={NOTE}>Couldn&apos;t load the servers.</p>;
  }
  if (!p.servers) return null;
  if (p.servers.length === 0) {
    return <p className={NOTE}>No active servers.</p>;
  }
  return (
    <ul role="list" className="flex flex-col">
      {p.servers.map((s) => (
        <li key={s.slug} className="border-b border-hairline">
          <Link
            href={`/maps/${s.slug}`}
            className="flex min-h-[44px] items-center justify-between py-2.5 font-mono text-[11px] uppercase tracking-[.05em] text-ink hover:text-red-deep"
          >
            <span className="font-bold">{s.name}</span>
            <span className={NOTE}>
              {s.friendCount === 0
                ? "No friends sharing"
                : `${s.friendCount} sharing`}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ServerPicker() {
  const account = useAccountStatus();
  const verified = account.kind === "verified";
  const q = useQuery({
    queryKey: ["map-servers"],
    queryFn: getMapServers,
    enabled: verified,
    refetchInterval: 60_000,
  });

  return (
    <ServerPickerView
      signedOut={account.kind === "signedOut"}
      unverified={account.kind === "unlinked" || account.kind === "pending"}
      loading={account.kind === "loading" || (verified && q.isPending)}
      error={q.isError && !q.data}
      servers={q.data?.servers}
    />
  );
}
```

`apps/web/src/app/maps/page.tsx`:

```tsx
import type { Metadata } from "next";
import { ServerPicker } from "@/components/map/server-picker";

export const metadata: Metadata = {
  title: "Maps",
  robots: { index: false }, // per-viewer: the friend counts are themselves private
};

export default function MapsPage() {
  return (
    <div className="mx-auto max-w-[68ch] px-4 py-8">
      <h1 className="font-display text-3xl uppercase tracking-[.02em]">Maps</h1>
      <div className="mt-6">
        <ServerPicker />
      </div>
    </div>
  );
}
```

Add `apps/web/src/components/map/server-picker.test.tsx` covering all five states of `ServerPickerView`, following the shape of `map-page.test.tsx` in Step 1 — including that a resolved-empty list and a failed fetch render different text.

- [ ] **Step 5: Link it from the account surfaces**

`/maps` is signed-in-only, so it belongs in the account surfaces rather than the public masthead nav.

**The `/friends` link is not in `rail.tsx` or `mobile-account.tsx`** — it lives in `apps/web/src/components/controls/friends-panel.tsx`, which those two mount (unboxed in the light rail, `boxed` in the dark sheet). Add the `/maps` link there, so it inherits the panel's existing dual-surface token swap rather than needing a second one.

In `friends-panel.tsx`, inside the returned `<div>`, immediately after the existing `/friends` `<Link>`:

```tsx
      <Link
        href="/maps"
        className={`flex items-center font-mono text-[11px] uppercase tracking-[.05em] ${muted} ${minH}`}
      >
        Map →
      </Link>
```

`muted` and `minH` are the panel's existing locals — `muted` already resolves to the right token for each surface, and `minH` supplies the 44px touch target on the mobile sheet only. Do not introduce new colour literals here; the panel's whole point is that every token swaps on `boxed`.

Extend `friends-panel.test.tsx` with a case asserting the `/maps` link renders and that, like the rest of the panel, its classes swap between the boxed and unboxed surfaces.

- [ ] **Step 6: Run the tests and commit**

Run: `pnpm --filter @onelife/web run test && pnpm --filter @onelife/web run typecheck`
Expected: PASS, no regressions.

```bash
git add apps/web/src/app/maps apps/web/src/components/map apps/web/src/components/controls
git commit -m "feat(web): the /maps pages"
```

---

### Task 9: Roster location controls

**Files:**
- Create: `apps/web/src/components/friends/location-toggles.tsx`, `.../location-toggles.test.tsx`
- Modify: `apps/web/src/components/friends/roster.tsx` + `.test.tsx`, `apps/web/src/lib/use-friends.ts`, `apps/web/src/lib/api.ts`

**Interfaces:**
- Consumes: `useFriends`, `useFriendActions` (existing).
- Produces:
  - `patchFriendLocation(id, body: { share: boolean })`, `patchPreferences` extended with `shareLocation`.
  - `useFriendActions()` gains `setLocation(id, share, onSettled?)` and `setShareLocation(value, onSettled?)`.
  - `<LocationToggle share notify... />` — see Step 3.

- [ ] **Step 1: Extend the API surface**

The presence flags are written by `PATCH /me/friends/:id/presence` and `PATCH /me/preferences`. Location reuses both rather than adding new endpoints.

In `apps/api/src/routes/friends.ts`, extend `presenceBody` and the handler:

```ts
const presenceBody = z.object({
  share: z.boolean().optional(),
  notify: z.boolean().optional(),
  shareLocation: z.boolean().optional(),
});
```

and in the handler, after the existing `setPresenceFlags` call:

```ts
      if (body.shareLocation !== undefined) {
        await setLocationFlag(db, {
          userId: session.user.id, friendshipId: id, share: body.shareLocation,
        });
      }
```

importing `setLocationFlag` from `@onelife/friends`.

In `apps/api/src/routes/preferences.ts`, extend `prefsBody` with `shareLocation: z.boolean().optional()`, write it via `setShareLocation` when present, and return both switches:

```ts
    return {
      sharePresence: await getSharePresence(db, session.user.id),
      shareLocation: await getShareLocation(db, session.user.id),
    };
```

Add matching cases to `apps/api/test/friends-routes.test.ts`: patching `shareLocation` on a friendship the caller is a party to succeeds and is reflected in `GET /me/friends`; patching one they are not a party to 404s; and `PATCH /me/preferences { shareLocation: true }` round-trips.

- [ ] **Step 2: Write the failing web test**

Create `apps/web/src/components/friends/location-toggles.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocationToggle, MasterLocationSwitch, reciprocityLabel } from "./location-toggles";

describe("reciprocityLabel", () => {
  // ⚠️ Undifferentiated on purpose: "master off" and "hidden from you specifically" MUST
  // produce the same string. Differentiating tells one player a named friend singled them
  // out, which makes the per-friend hide switch a visible act and therefore unusable.
  it("says the same thing however their sharing is off", () => {
    expect(reciprocityLabel(false)).toBe("Not sharing with you");
    expect(reciprocityLabel(true)).toBe("Sharing with you");
  });
});

describe("LocationToggle", () => {
  it("reflects the flag and reports a change", async () => {
    const onChange = vi.fn();
    render(<LocationToggle friendshipId={1} share={false} masterOn theyShare={false} onChange={onChange} />);
    const box = screen.getByRole("checkbox", { name: /share my location/i });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("disables and explains when the master switch is off", () => {
    render(<LocationToggle friendshipId={1} share masterOn={false} theyShare={false} onChange={() => {}} />);
    expect(screen.getByRole("checkbox", { name: /share my location/i })).toBeDisabled();
    expect(screen.getByText(/location sharing is off/i)).toBeInTheDocument();
  });

  it("shows the reciprocity line", () => {
    render(<LocationToggle friendshipId={1} share masterOn theyShare={false} onChange={() => {}} />);
    expect(screen.getByText("Not sharing with you")).toBeInTheDocument();
  });

  // Two rows rendered together must not collide on one DOM id — the bug that broke the
  // presence note's aria association for every row after the first.
  it("gives each row its own note id", () => {
    render(
      <>
        <LocationToggle friendshipId={1} share masterOn={false} theyShare={false} onChange={() => {}} />
        <LocationToggle friendshipId={2} share masterOn={false} theyShare={false} onChange={() => {}} />
      </>,
    );
    const boxes = screen.getAllByRole("checkbox", { name: /share my location/i });
    const a = boxes[0]!.getAttribute("aria-describedby");
    const b = boxes[1]!.getAttribute("aria-describedby");
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
    expect(document.getElementById(a!)).not.toBeNull();
    expect(document.getElementById(b!)).not.toBeNull();
  });
});

describe("MasterLocationSwitch", () => {
  it("reflects its state and reports a change", async () => {
    const onChange = vi.fn();
    render(<MasterLocationSwitch on={false} onChange={onChange} />);
    const box = screen.getByRole("checkbox", { name: /share my location with friends/i });
    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 3: Run it, then implement**

Run: `pnpm --filter @onelife/web run test location-toggles`
Expected: FAIL — cannot resolve `./location-toggles`.

First, **extract the styled checkbox so it is not copied a third time.** `Box`, `LABEL`, `LABEL_DISABLED` and `NOTE` are currently module-private in `presence-toggles.tsx`. Move them verbatim into a new `apps/web/src/components/friends/checkbox.tsx`, exporting all four, and have `presence-toggles.tsx` import them instead. That file's tests must pass unmodified afterwards — it is a pure move.

```tsx
// apps/web/src/components/friends/checkbox.tsx
"use client";

export const LABEL = "font-mono text-[11px] uppercase tracking-[.05em] text-ink flex items-center gap-2";
export const LABEL_DISABLED = "text-ink-muted";
export const NOTE = "font-mono text-[11px] uppercase tracking-[.05em] text-ink-muted";

/**
 * A tabloid-styled checkbox. The native `<input type="checkbox">` stays in the DOM (sr-only,
 * not `display:none`) so it keeps its role, accessible name, focus order, keyboard operability
 * and `aria-describedby` — only its default browser chrome is hidden. A sibling box + checkmark
 * pair (`peer-*` variants track the real input's state) render the visible control, so state is
 * carried by fill AND a checkmark glyph, never by colour alone.
 */
export function Box(p: {
  checked: boolean;
  disabled?: boolean;
  ariaDescribedby?: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <span className="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      <input
        type="checkbox"
        checked={p.checked}
        disabled={p.disabled}
        aria-describedby={p.ariaDescribedby}
        onChange={(e) => p.onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="absolute inset-0 border border-ink bg-paper peer-checked:bg-ink
          peer-focus-visible:outline peer-focus-visible:outline-2
          peer-focus-visible:outline-offset-2 peer-focus-visible:outline-red
          peer-disabled:border-ink-muted peer-disabled:opacity-50"
      />
      <svg
        aria-hidden="true"
        viewBox="0 0 8 8"
        className="relative hidden h-2 w-2 text-paper peer-checked:block"
      >
        <path d="M1 4.2 L3.1 6.2 L7 1.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </span>
  );
}
```

Then create `apps/web/src/components/friends/location-toggles.tsx`:

```tsx
"use client";
import { Box, LABEL, LABEL_DISABLED, NOTE } from "./checkbox";

/**
 * ⚠️ DELIBERATELY UNDIFFERENTIATED. A friend's location being invisible to you has two causes —
 * their master switch is off, or they have hidden from you specifically — and this must never
 * distinguish them. Differentiating would tell one player that a named friend singled them out,
 * which makes the per-friend hide switch a visible act and therefore unusable. See F2 spec §5.3.
 *
 * The caller passes a single already-collapsed boolean (`theyShareLocation` from the API), so
 * the distinction is not merely unrendered — it never reaches the client.
 */
export function reciprocityLabel(theyShare: boolean): string {
  return theyShare ? "Sharing with you" : "Not sharing with you";
}

/** The per-user master switch for location. Separate from the presence one: "I'm online" is a
 *  social signal, "I'm at these coordinates" is tactical. */
export function MasterLocationSwitch(p: {
  on: boolean; disabled?: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={`${LABEL} border-b border-hairline pb-2.5 ${p.disabled ? LABEL_DISABLED : ""} ${p.disabled ? "" : "cursor-pointer"}`}
    >
      <Box checked={p.on} disabled={p.disabled} onChange={p.onChange} />
      Share my location with friends
    </label>
  );
}

/** Per-friend location control plus the reciprocity line. */
export function LocationToggle(p: {
  /** Used only to derive a unique id for the disabled note, so N rows never collide on one
   *  DOM id and every row's `aria-describedby` resolves to its own note. */
  friendshipId: number;
  share: boolean;
  masterOn: boolean;
  theyShare: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  const noteId = `location-disabled-${p.friendshipId}`;
  const shareDisabled = p.disabled || !p.masterOn;
  return (
    <div className="flex flex-col gap-1.5 py-1.5">
      <label className={`${LABEL} ${shareDisabled ? LABEL_DISABLED : "cursor-pointer"}`}>
        <Box
          checked={p.share}
          disabled={shareDisabled}
          ariaDescribedby={p.masterOn ? undefined : noteId}
          onChange={p.onChange}
        />
        Share my location
      </label>
      {p.masterOn ? null : (
        <span className={NOTE} id={noteId}>Location sharing is off for everyone</span>
      )}
      <span className={NOTE}>{reciprocityLabel(p.theyShare)}</span>
    </div>
  );
}
```

Note the test in Step 2 renders `LocationToggle` without a `friendshipId` in one case — add `friendshipId={1}` to those renders when you write them, since the prop is required here.

- [ ] **Step 4: Wire into the Roster**

In `apps/web/src/components/friends/roster.tsx`, render `<MasterLocationSwitch>` beside the presence master switch, and `<LocationToggle>` inside the Friends rows' existing `extra` slot alongside `<PresenceToggles>`. Thread `disabled={pending}`, and route changes through the existing `settle(...)` helper so announcements fire **on settlement, never at click time**.

Extend `useFriendActions()` in `apps/web/src/lib/use-friends.ts`, following its existing `FriendAction` union and `onSettled` contract exactly. Leave the six existing actions byte-identical.

Widen the union with two arms:

```ts
type FriendAction = "send" | "accept" | "decline" | "remove" | "presence" | "master"
  | "location" | "masterLocation";
```

Add the mutations beside `pres`/`master`, and include them in `all`:

```ts
  const loc = useMutation({
    mutationFn: (v: { id: number; share: boolean }) =>
      patchFriendPresence(v.id, { shareLocation: v.share }),
    ...opts,
  });
  const masterLoc = useMutation({
    mutationFn: (shareLocation: boolean) => patchPreferences({ shareLocation }),
    ...opts,
  });
  const all = [send, acc, dec, del, pres, master, loc, masterLoc];
```

Extend the `lastMutation` ternary chain with the two new arms before the trailing `: null`:

```ts
    : lastAction === "location" ? loc
    : lastAction === "masterLocation" ? masterLoc
```

And add the two returned actions, mirroring the existing ones exactly:

```ts
    setLocation: (id: number, share: boolean, onSettled?: Settled) => {
      setLastAction("location");
      loc.mutate({ id, share }, {
        onSuccess: () => onSettled?.(true, null),
        onError: (err) => onSettled?.(false, codeOf(err)),
      });
    },
    setShareLocation: (value: boolean, onSettled?: Settled) => {
      setLastAction("masterLocation");
      masterLoc.mutate(value, {
        onSuccess: () => onSettled?.(true, null),
        onError: (err) => onSettled?.(false, codeOf(err)),
      });
    },
```

Note `patchFriendPresence` and `patchPreferences` are reused rather than replaced — location rides the same two endpoints, which is why Step 1 widened their bodies instead of adding routes. Widen `patchFriendPresence`'s body type to `{ share?: boolean; notify?: boolean; shareLocation?: boolean }` and `patchPreferences`'s to `{ sharePresence?: boolean; shareLocation?: boolean }` in `apps/web/src/lib/api.ts`, and widen the latter's return type to `{ sharePresence: boolean; shareLocation: boolean }`.

Add Roster tests asserting the location controls appear on friend rows only, and that a failed location write surfaces the error.

- [ ] **Step 5: Run the full suite and commit**

Run: `pnpm turbo run test --concurrency=1 && pnpm turbo run typecheck`

```bash
git add apps/web/src/components/friends apps/web/src/lib apps/api
git commit -m "feat(web): location sharing controls on the Roster"
```

---

### Task 10: Full verification

**Files:** none created; this task runs and fixes only.

- [ ] **Step 1: Run the whole suite**

Run: `pnpm turbo run test --concurrency=1`
Expected: PASS across all packages.

- [ ] **Step 2: Typecheck everything**

Run: `pnpm turbo run typecheck`
Expected: no errors.

- [ ] **Step 3: Confirm the security and durability invariants**

Run:

```bash
grep -n "mapSlug\|gamertag\|userId" apps/api/src/routes/friend-map.ts
grep -rn "0022_snapshot" packages/db/drizzle/meta/ ; echo "exit=$?"
grep -c '"idx": 22' packages/db/drizzle/meta/_journal.json
grep -n "no-store" apps/api/src/routes/friend-map.ts
```

Expected: `friend-map.ts` takes `mapSlug` only — **no gamertag/userId/player parameter** anywhere in its route definitions (the `verifiedGamertag` helper reading the session is fine); no `0022_snapshot.json`; exactly one idx-22 journal entry; `no-store` present on **both** routes.

- [ ] **Step 4: Confirm coordinates never reach the server bundle**

Leaflet is dynamically imported so it never runs during SSR, and the map data is fetched client-side only. Confirm no server component fetches `/me/maps/*`:

Run: `grep -rn "getFriendMap\|getMapServers" apps/web/src/app/`

Expected: no hits in `page.tsx` server components — both are called only from `"use client"` components.

- [ ] **Step 5: Commit any fixes**

```bash
git add -p
git commit -m "test: fix up friends F2 suite"
```

(Skip if nothing changed.)

---

## Handoff

Do **not** hand-write the changelog, CLAUDE.md update or the PR. After Task 10 passes, invoke the **`finishing-a-feature`** skill.

The changelog must say that the feature is **live on deploy but inert** — no operator gate, because no worker is involved, but every master switch starts `false`, so the map shows the viewer's own dot and nobody else's until people opt in.
