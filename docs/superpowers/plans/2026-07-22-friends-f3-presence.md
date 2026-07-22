# Friends F3 — Presence Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify a player when a friend comes online, gated by an opt-in per-user master switch, a per-friend share flag, and a per-friend mute.

**Architecture:** Migration `0020` adds two `*_notify_presence` columns to `friendships` and a new durable `user_preferences` table holding the master switch. `packages/friends` gains a pure eligibility predicate and the flag-writing operations; a new generator in the `notifier` worker turns qualifying session connects into notifications, deduped by a rebuild-stable natural key and throttled by a 4-hour cooldown queried off the durable notification rows. The web surface is two toggles per row on `/friends` plus a master switch.

**Tech Stack:** TypeScript ESM, pnpm workspaces + turbo, Postgres + Drizzle, Fastify, Next.js App Router, TanStack Query, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-22-friends-f3-presence-design.md`

## Global Constraints

- **Migration `0020` is hand-written SQL with a hand-appended `meta/_journal.json` entry.** Do NOT run `drizzle-kit generate` — the snapshot chain stops at `0014_snapshot.json`, so it diffs against a stale snapshot and emits wrong SQL.
- **`user_preferences` is durable:** add to `APP_TABLES` in `packages/test-support/src/global-setup.ts`; do NOT add to `apps/projector/src/rebuild.ts`'s truncate list.
- **`FRIEND_ONLINE_COOLDOWN_HOURS = 4`**, **`FRIEND_ONLINE_MAX_AGE_MINUTES = 15`**.
- **The natural key is `friend_online:<observerUserId>:<subjectGamertag>:<connectedAt ISO>`** — never `sessions.id` (rebuild reassigns session ids; `notifications` is never truncated). The timestamp comes from `toISOString()` in TypeScript, never a SQL `to_char()`.
- **The cooldown query reuses `notifications_natural_key_pattern_idx`** via `LIKE <escaped prefix> || '%'`. Use the existing `escapeLikePattern`; never `starts_with()` (not index-usable).
- **`notifications.natural_key` is a PLAIN unique index** — `onConflictDoNothing` takes NO `targetWhere`.
- **Every generator floors its query at `windowStart(deps)`.**
- **Defaults:** `user_preferences.share_presence` `false`; `friendships.*_shares_presence` and `*_notify_presence` `true`. Effective sharing = master AND per-pair.
- **Qualifying connect is NOT gated on life qualification** — deliberately unlike the survivors board / enforcer / newsdesk.
- `red-deep` is a light-surface-only token; the mobile sheet is `bg-dark`. No raw hex (grep-gated).
- Run tests with `pnpm turbo run test --concurrency=1` (DB suites need `TEST_DATABASE_URL`); typecheck with `pnpm turbo run typecheck`. Local Postgres may be on a non-default host port via a gitignored `docker-compose.override.yml`.
- Stage files explicitly (`git add <paths>`), never `git add -A`.

## File Structure

**Create:**
- `packages/db/drizzle/0020_presence_flags.sql`
- `packages/friends/src/presence.ts` — the pure predicate + flag/preference operations.
- `packages/friends/test/presence.test.ts`
- `apps/notifier/src/generators/presence.ts` + `apps/notifier/test/presence.test.ts`
- `apps/api/src/routes/preferences.ts`
- `apps/web/src/components/friends/presence-toggles.tsx` + `.test.tsx`

**Modify:**
- `packages/db/src/schema.ts`, `packages/db/drizzle/meta/_journal.json`, `packages/test-support/src/global-setup.ts`
- `packages/friends/src/pair.ts` (row + view types), `src/queries.ts` (expose flags), `src/mutations.ts` (export `escapeLikePattern`), `src/index.ts`
- `apps/notifier/src/main.ts`, `apps/notifier/package.json`
- `apps/api/src/routes/friends.ts`, `apps/api/src/app.ts`
- `apps/web/src/lib/{types.ts,api.ts,use-friends.ts}`, `apps/web/src/components/friends/roster.tsx` + `.test.tsx`

---

### Task 1: Migration and schema

**Files:**
- Create: `packages/db/drizzle/0020_presence_flags.sql`
- Modify: `packages/db/src/schema.ts`, `packages/db/drizzle/meta/_journal.json`, `packages/test-support/src/global-setup.ts`

**Interfaces:**
- Produces: `userPreferences` table export (`userId`, `sharePresence`, `updatedAt`); `friendships.aNotifyPresence` / `bNotifyPresence` columns.

- [ ] **Step 1: Write the migration**

Create `packages/db/drizzle/0020_presence_flags.sql`:

```sql
CREATE TABLE "user_preferences" (
  "user_id" text PRIMARY KEY NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "share_presence" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "friendships" ADD COLUMN "a_notify_presence" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "friendships" ADD COLUMN "b_notify_presence" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "friendships" ALTER COLUMN "a_shares_presence" SET DEFAULT true;
--> statement-breakpoint
ALTER TABLE "friendships" ALTER COLUMN "b_shares_presence" SET DEFAULT true;
--> statement-breakpoint
UPDATE "friendships" SET "a_shares_presence" = true, "b_shares_presence" = true;
```

The backfill is safe: no user has `share_presence = true` yet, and effective sharing is `master AND per-pair`, so nobody becomes visible.

- [ ] **Step 2: Append the journal entry**

In `packages/db/drizzle/meta/_journal.json`, after the `0019` object:

```json
    {
      "idx": 20,
      "version": "7",
      "when": 1784900000000,
      "tag": "0020_presence_flags",
      "breakpoints": true
    }
```

- [ ] **Step 3: Update the Drizzle schema**

In `packages/db/src/schema.ts`, add the two columns to the existing `friendships` table definition, immediately after `bSharesPresence`:

```ts
  aNotifyPresence: boolean("a_notify_presence").notNull().default(true),
  bNotifyPresence: boolean("b_notify_presence").notNull().default(true),
```

Change the two existing presence-share columns' defaults to `true`:

```ts
  aSharesPresence: boolean("a_shares_presence").notNull().default(true),
  bSharesPresence: boolean("b_shares_presence").notNull().default(true),
```

Leave `aSharesLocation` / `bSharesLocation` at `default(false)` — those belong to F2 and are untouched.

Append the new table at the end of the file:

```ts
// ── Per-user app preferences. Durable: NOT in apps/projector/src/rebuild.ts's truncate list.
//
// Deliberately a separate table rather than a column on `user`, which belongs to Better Auth.
// F2's global location-sharing switch lands here too rather than inventing a second mechanism.
//
// An ABSENT row means defaults — the row is created lazily on first write, so every read must
// treat "no row" as share_presence = false rather than an error. ──

export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  sharePresence: boolean("share_presence").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Register for test truncation**

In `packages/test-support/src/global-setup.ts`, add `"user_preferences",` to `APP_TABLES` after `"friendships"`.

- [ ] **Step 5: Apply and verify**

Run:

```bash
pnpm --filter @onelife/db run db:migrate
psql "$TEST_DATABASE_URL" -c "\d friendships" -c "\d user_preferences"
```

Expected: `friendships` shows `a_notify_presence`/`b_notify_presence` defaulting `true` and both `*_shares_presence` now defaulting `true`; `user_preferences` exists with `share_presence` defaulting `false`.

(If `db:migrate` is not the script name, check `packages/db/package.json` and use the real one.)

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm turbo run typecheck
git add packages/db/drizzle/0020_presence_flags.sql packages/db/drizzle/meta/_journal.json packages/db/src/schema.ts packages/test-support/src/global-setup.ts
git commit -m "feat(db): presence flags and user_preferences (migration 0020)"
```

---

### Task 2: Presence types and the pure predicate

**Files:**
- Create: `packages/friends/src/presence.ts`, `packages/friends/test/presence.test.ts`
- Modify: `packages/friends/src/pair.ts`, `packages/friends/src/mutations.ts`, `packages/friends/src/index.ts`

**Interfaces:**
- Consumes: `FriendshipRow`, `viewOf` (existing).
- Produces:
  - `FriendshipRow` gains `aNotifyPresence: boolean`, `bNotifyPresence: boolean`.
  - `FriendView` gains `iNotifyPresence: boolean`, `theyNotifyPresence: boolean` (it already carries `iSharePresence`/`theySharePresence`).
  - `shouldNotifyPresence(a: { status: string; masterShare: boolean; pairShare: boolean; pairNotify: boolean }): boolean`
  - `FRIEND_ONLINE_COOLDOWN_HOURS = 4`, `FRIEND_ONLINE_MAX_AGE_MINUTES = 15`
  - `escapeLikePattern(value: string): string` re-exported from the barrel.

- [ ] **Step 1: Write the failing test**

Create `packages/friends/test/presence.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldNotifyPresence, FRIEND_ONLINE_COOLDOWN_HOURS, FRIEND_ONLINE_MAX_AGE_MINUTES } from "../src/presence.js";

const base = { status: "accepted", masterShare: true, pairShare: true, pairNotify: true };

describe("shouldNotifyPresence", () => {
  it("notifies when the pair is accepted and all three flags are on", () => {
    expect(shouldNotifyPresence(base)).toBe(true);
  });

  // Exhaustive over the three booleans: the four-way AND must not drift.
  const flags = ["masterShare", "pairShare", "pairNotify"] as const;
  for (const off of flags) {
    it(`does not notify when ${off} is off`, () => {
      expect(shouldNotifyPresence({ ...base, [off]: false })).toBe(false);
    });
  }

  it("does not notify for a non-accepted pair", () => {
    for (const status of ["pending", "declined"]) {
      expect(shouldNotifyPresence({ ...base, status })).toBe(false);
    }
  });

  it("pins the tuning constants", () => {
    expect(FRIEND_ONLINE_COOLDOWN_HOURS).toBe(4);
    expect(FRIEND_ONLINE_MAX_AGE_MINUTES).toBe(15);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/friends run test presence`
Expected: FAIL — cannot resolve `../src/presence.js`.

- [ ] **Step 3: Extend the row and view types**

In `packages/friends/src/pair.ts`, add to `FriendshipRow` (after `bSharesPresence`):

```ts
  aNotifyPresence: boolean;
  bNotifyPresence: boolean;
```

Add to `FriendView` (after `theySharePresence`):

```ts
  iNotifyPresence: boolean;
  theyNotifyPresence: boolean;
```

And in `viewOf`'s returned object, after `theySharePresence`:

```ts
    iNotifyPresence: isA ? row.aNotifyPresence : row.bNotifyPresence,
    theyNotifyPresence: isA ? row.bNotifyPresence : row.aNotifyPresence,
```

- [ ] **Step 4: Create `presence.ts`**

```ts
export const FRIEND_ONLINE_COOLDOWN_HOURS = 4;

/** Skip a connect older than this even when it is inside the generator's window: a
 *  "came online" delivered hours late is worse than silence, so a worker that has been
 *  down drops the backlog rather than delivering archaeology. */
export const FRIEND_ONLINE_MAX_AGE_MINUTES = 15;

/**
 * Whether a connect by the subject should notify the observer. Pure, and the single place
 * the four-way AND is expressed.
 *
 * `masterShare` is the SUBJECT's per-user switch (user_preferences.share_presence, default
 * false); `pairShare` is the subject's per-friend flag (default true, i.e. "not individually
 * hidden"); `pairNotify` is the OBSERVER's per-friend flag (default true, i.e. not muted).
 * Effective sharing is master AND pair — which is what makes the default usable: one switch
 * makes you visible to everyone, with per-friend exceptions.
 */
export function shouldNotifyPresence(a: {
  status: string;
  masterShare: boolean;
  pairShare: boolean;
  pairNotify: boolean;
}): boolean {
  return a.status === "accepted" && a.masterShare && a.pairShare && a.pairNotify;
}
```

- [ ] **Step 5: Export `escapeLikePattern` and the new surface**

In `packages/friends/src/mutations.ts`, change `function escapeLikePattern` to `export function escapeLikePattern`, and extend its doc comment:

```ts
/** Escape LIKE metacharacters in a value used as a literal prefix. `_` is a single-character
 *  wildcard and `%` a multi-character one, so an unescaped generated user id containing either
 *  silently matches OTHER users' keys — which shipped once as a wrongly-refused rate limit.
 *  Exported because the presence generator builds the same kind of prefix. */
```

In `packages/friends/src/index.ts`, add:

```ts
export { shouldNotifyPresence, FRIEND_ONLINE_COOLDOWN_HOURS, FRIEND_ONLINE_MAX_AGE_MINUTES } from "./presence.js";
export { escapeLikePattern } from "./mutations.js";
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @onelife/friends run test`
Expected: PASS — the existing suite plus the new `presence.test.ts`.

If existing tests fail on the new required `FriendshipRow` fields, update their fixtures to include `aNotifyPresence: true, bNotifyPresence: true` — a fixture change only, never an assertion change.

- [ ] **Step 7: Commit**

```bash
git add packages/friends
git commit -m "feat(friends): presence eligibility predicate and flag projection"
```

---

### Task 3: Writing the flags

**Files:**
- Modify: `packages/friends/src/presence.ts`, `packages/friends/src/queries.ts`, `packages/friends/src/index.ts`
- Test: `packages/friends/test/presence.test.ts`

**Interfaces:**
- Consumes: `FriendError`, `orderPair` (existing).
- Produces:
  - `setPresenceFlags(db, a: { userId: string; friendshipId: number; share?: boolean; notify?: boolean }): Promise<void>` — throws `FriendError("not_found")` for a non-party.
  - `getSharePresence(db, userId: string): Promise<boolean>` — absent row ⇒ `false`.
  - `setSharePresence(db, a: { userId: string; sharePresence: boolean }): Promise<void>` — upsert.
  - `FriendEntry` gains `sharesPresence: boolean`, `notifyPresence: boolean`.
  - `listFriends`'s return gains `sharePresence: boolean` (the viewer's master switch).

- [ ] **Step 1: Write the failing tests**

Append to `packages/friends/test/presence.test.ts`:

```ts
import { beforeEach, afterAll } from "vitest";
import { user, gamertagLinks, friendships, userPreferences } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { eq } from "drizzle-orm";
import { request, accept } from "../src/mutations.js";
import { listFriends } from "../src/queries.js";
import { setPresenceFlags, getSharePresence, setSharePresence } from "../src/presence.js";

const { db, sql } = getTestDb();

async function seedPair() {
  await sql`truncate table user_preferences, friendships, notifications, gamertag_links, "user" restart identity cascade`;
  await db.insert(user).values([
    { id: "pa", name: "PA", email: "pa@x.com" },
    { id: "pb", name: "PB", email: "pb@x.com" },
    { id: "pc", name: "PC", email: "pc@x.com" },
  ]);
  await db.insert(gamertagLinks).values([
    { userId: "pa", gamertag: "PresenceAlpha", status: "verified", verifiedAt: new Date() },
    { userId: "pb", gamertag: "PresenceBravo", status: "verified", verifiedAt: new Date() },
    { userId: "pc", gamertag: "PresenceCharlie", status: "verified", verifiedAt: new Date() },
  ]);
  await request(db, { fromUserId: "pa", toUserId: "pb" });
  const [row] = await db.select().from(friendships);
  await accept(db, { userId: "pb", friendshipId: row!.id });
  return row!.id;
}

describe("presence flags", () => {
  beforeEach(seedPair);
  afterAll(async () => { await sql.end(); });

  it("defaults to sharing on per pair, notifying on, and the master switch off", async () => {
    const out = await listFriends(db, { userId: "pa" });
    expect(out.friends[0]!.sharesPresence).toBe(true);
    expect(out.friends[0]!.notifyPresence).toBe(true);
    expect(out.sharePresence).toBe(false);
  });

  it("writes each side's flags independently", async () => {
    const id = (await listFriends(db, { userId: "pa" })).friends[0]!.id;
    await setPresenceFlags(db, { userId: "pa", friendshipId: id, share: false });
    await setPresenceFlags(db, { userId: "pb", friendshipId: id, notify: false });

    const a = (await listFriends(db, { userId: "pa" })).friends[0]!;
    const b = (await listFriends(db, { userId: "pb" })).friends[0]!;
    expect(a.sharesPresence).toBe(false);
    expect(a.notifyPresence).toBe(true);
    expect(b.sharesPresence).toBe(true);
    expect(b.notifyPresence).toBe(false);
  });

  it("leaves an omitted flag untouched", async () => {
    const id = (await listFriends(db, { userId: "pa" })).friends[0]!.id;
    await setPresenceFlags(db, { userId: "pa", friendshipId: id, notify: false });
    const a = (await listFriends(db, { userId: "pa" })).friends[0]!;
    expect(a.sharesPresence).toBe(true);
    expect(a.notifyPresence).toBe(false);
  });

  it("rejects a caller who is not a party", async () => {
    const id = (await listFriends(db, { userId: "pa" })).friends[0]!.id;
    await expect(setPresenceFlags(db, { userId: "pc", friendshipId: id, share: false }))
      .rejects.toThrow(/not_found/);
  });

  it("treats an absent preferences row as sharing off", async () => {
    expect(await getSharePresence(db, "pa")).toBe(false);
  });

  it("upserts the master switch idempotently", async () => {
    await setSharePresence(db, { userId: "pa", sharePresence: true });
    expect(await getSharePresence(db, "pa")).toBe(true);
    await setSharePresence(db, { userId: "pa", sharePresence: false });
    expect(await getSharePresence(db, "pa")).toBe(false);
    const rows = await db.select().from(userPreferences).where(eq(userPreferences.userId, "pa"));
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @onelife/friends run test presence`
Expected: FAIL — `setPresenceFlags` / `getSharePresence` / `setSharePresence` are not exported.

- [ ] **Step 3: Implement the operations**

Append to `packages/friends/src/presence.ts`:

```ts
import type { Database } from "@onelife/db";
import { friendships, userPreferences } from "@onelife/db";
import { and, eq, or } from "drizzle-orm";
import { FriendError } from "./errors.js";

/**
 * Set this caller's own presence flags on one friendship. Which physical column each flag
 * lands in depends on which side of the canonically-ordered pair the caller is — the only
 * place outside orderPair/viewOf that needs to know.
 *
 * A non-party gets `not_found`, matching cancel/remove: they must not be able to distinguish
 * "not yours" from "does not exist".
 */
export async function setPresenceFlags(
  db: Database,
  a: { userId: string; friendshipId: number; share?: boolean; notify?: boolean },
): Promise<void> {
  if (a.share === undefined && a.notify === undefined) return;

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
  const patch: Record<string, boolean> = {};
  if (a.share !== undefined) patch[isA ? "aSharesPresence" : "bSharesPresence"] = a.share;
  if (a.notify !== undefined) patch[isA ? "aNotifyPresence" : "bNotifyPresence"] = a.notify;

  await db.update(friendships).set(patch).where(eq(friendships.id, row.id));
}

/** The master switch. An absent row means defaults, so "no row" is false, never an error. */
export async function getSharePresence(db: Database, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ sharePresence: userPreferences.sharePresence })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  return row?.sharePresence ?? false;
}

export async function setSharePresence(
  db: Database,
  a: { userId: string; sharePresence: boolean },
): Promise<void> {
  await db
    .insert(userPreferences)
    .values({ userId: a.userId, sharePresence: a.sharePresence, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { sharePresence: a.sharePresence, updatedAt: new Date() },
    });
}
```

- [ ] **Step 4: Expose the flags on the roster**

In `packages/friends/src/queries.ts`, add to the `FriendEntry` type:

```ts
  sharesPresence: boolean;
  notifyPresence: boolean;
```

In `listFriends`'s `entry()` builder, add to the returned object:

```ts
      sharesPresence: v.view.iSharePresence,
      notifyPresence: v.view.iNotifyPresence,
```

Widen `listFriends`'s return type with `sharePresence: boolean`, import `getSharePresence` from `./presence.js`, and resolve it alongside the existing work:

```ts
  const sharePresence = await getSharePresence(db, a.userId);
```

returning it in the result object.

- [ ] **Step 5: Export from the barrel**

In `packages/friends/src/index.ts`:

```ts
export { setPresenceFlags, getSharePresence, setSharePresence } from "./presence.js";
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @onelife/friends run test`
Expected: PASS — the whole package suite.

- [ ] **Step 7: Commit**

```bash
pnpm --filter @onelife/friends run typecheck
git add packages/friends
git commit -m "feat(friends): presence flag writes and the master switch"
```

---

### Task 4: API routes

**Files:**
- Create: `apps/api/src/routes/preferences.ts`
- Modify: `apps/api/src/routes/friends.ts`, `apps/api/src/app.ts`
- Test: `apps/api/test/friends-routes.test.ts`

**Interfaces:**
- Consumes: `setPresenceFlags`, `setSharePresence`, `getSharePresence`, `FriendError` from `@onelife/friends`.
- Produces:
  - `PATCH /me/friends/:id/presence` — `{ share?: boolean, notify?: boolean }` → `{ ok: true }`
  - `PATCH /me/preferences` — `{ sharePresence?: boolean }` → `{ sharePresence: boolean }`
  - `GET /me/preferences` → `{ sharePresence: boolean }`
  - `registerPreferenceRoutes(app, db, auth): void`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("friend routes", …)` in `apps/api/test/friends-routes.test.ts` (it already defines `get`, `post`, `del`, `cookieA`, `cookieB`, `tagA`, `tagB` — reuse them; add a `patch` helper beside the others):

```ts
  it("401s the presence routes when signed out", async () => {
    expect((await app.inject({ method: "PATCH", url: "/me/friends/1/presence" })).statusCode).toBe(401);
    expect((await app.inject({ method: "PATCH", url: "/me/preferences" })).statusCode).toBe(401);
  });

  it("patches each side's presence flags independently", async () => {
    // The pair from the earlier cases has been torn down; make a fresh accepted friendship.
    await post(cookieA, "/me/friends/requests", { toGamertag: tagB });
    const id = (await get(cookieB, "/me/friends")).json().incoming[0].id;
    await post(cookieB, `/me/friends/${id}/accept`);

    expect((await patch(cookieA, `/me/friends/${id}/presence`, { share: false })).statusCode).toBe(200);
    expect((await patch(cookieB, `/me/friends/${id}/presence`, { notify: false })).statusCode).toBe(200);

    const a = (await get(cookieA, "/me/friends")).json().friends[0];
    const b = (await get(cookieB, "/me/friends")).json().friends[0];
    expect(a.sharesPresence).toBe(false);
    expect(a.notifyPresence).toBe(true);
    expect(b.sharesPresence).toBe(true);
    expect(b.notifyPresence).toBe(false);
  });

  it("404s a presence patch on a friendship the caller is not party to", async () => {
    expect((await patch(cookieA, "/me/friends/99999999/presence", { share: true })).statusCode).toBe(404);
  });

  it("serves and updates the master switch, defaulting off", async () => {
    expect((await get(cookieA, "/me/preferences")).json().sharePresence).toBe(false);
    expect((await patch(cookieA, "/me/preferences", { sharePresence: true })).json().sharePresence).toBe(true);
    expect((await get(cookieA, "/me/preferences")).json().sharePresence).toBe(true);
    expect((await get(cookieA, "/me/friends")).json().sharePresence).toBe(true);
  });
```

Add the helper beside the existing `post`:

```ts
const patch = (cookie: string, url: string, payload: unknown) =>
  app.inject({
    method: "PATCH", url,
    headers: { cookie, "content-type": "application/json" },
    payload: payload as never,
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @onelife/api run test friends`
Expected: FAIL — the PATCH routes 404.

- [ ] **Step 3: Add the friendship presence route**

In `apps/api/src/routes/friends.ts`, extend the import from `@onelife/friends` with `setPresenceFlags`, add the body schema beside the others:

```ts
const presenceBody = z.object({
  share: z.boolean().optional(),
  notify: z.boolean().optional(),
});
```

and register the route after the `DELETE /me/friends/:id` handler:

```ts
  app.patch("/me/friends/:id/presence", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const { id } = idParam.parse(req.params);
    const body = presenceBody.parse(req.body ?? {});
    try {
      await setPresenceFlags(db, { userId: session.user.id, friendshipId: id, ...body });
      return { ok: true };
    } catch (e) {
      return onFriendError(e, reply);
    }
  });
```

- [ ] **Step 4: Add the preferences routes**

Create `apps/api/src/routes/preferences.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import type { Auth } from "@onelife/auth";
import { z } from "zod";
import { getSharePresence, setSharePresence } from "@onelife/friends";
import { getSession } from "../auth-plugin.js";

const prefsBody = z.object({ sharePresence: z.boolean().optional() });

export function registerPreferenceRoutes(app: FastifyInstance, db: Database, auth: Auth): void {
  app.get("/me/preferences", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    return { sharePresence: await getSharePresence(db, session.user.id) };
  });

  app.patch("/me/preferences", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const body = prefsBody.parse(req.body ?? {});
    if (body.sharePresence !== undefined) {
      await setSharePresence(db, { userId: session.user.id, sharePresence: body.sharePresence });
    }
    return { sharePresence: await getSharePresence(db, session.user.id) };
  });
}
```

In `apps/api/src/app.ts`, import and register it in the authenticated block immediately after `registerFriendRoutes`:

```ts
import { registerPreferenceRoutes } from "./routes/preferences.js";
```
```ts
    registerPreferenceRoutes(app, db, opts.auth);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @onelife/api run test`
Expected: PASS — the whole API suite, including the pre-existing friend route cases.

- [ ] **Step 6: Commit**

```bash
pnpm turbo run typecheck
git add apps/api
git commit -m "feat(api): presence flag and preference routes"
```

---

### Task 5: The presence generator

**Files:**
- Create: `apps/notifier/src/generators/presence.ts`, `apps/notifier/test/presence.test.ts`
- Modify: `apps/notifier/src/main.ts`, `apps/notifier/package.json`

**Interfaces:**
- Consumes: `Generator`, `NotificationDraft`, `windowStart` from `../types.js`; `playerSlug` from `./account.js`; `shouldNotifyPresence`, `escapeLikePattern`, `FRIEND_ONLINE_COOLDOWN_HOURS`, `FRIEND_ONLINE_MAX_AGE_MINUTES` from `@onelife/friends`.
- Produces: `presenceGenerator: Generator`, and `presenceNaturalKey(observerUserId, subjectGamertag, connectedAt): string`.

- [ ] **Step 1: Write the failing test**

Create `apps/notifier/test/presence.test.ts`. Read a neighbouring notifier test first (e.g. `apps/notifier/test/lives.test.ts`) and match how it seeds servers, players, lives and sessions — reuse its idiom rather than inventing one.

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  user, gamertagLinks, servers, players, lives, sessions, friendships, userPreferences, notifications,
} from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { presenceGenerator, presenceNaturalKey } from "../src/generators/presence.js";

const { db, sql } = getTestDb();
const NOW = new Date("2026-07-22T12:00:00Z");
const deps = (over: Partial<Parameters<typeof presenceGenerator>[0]> = {}) => ({
  db, now: NOW, since: new Date("2026-07-01T00:00:00Z"),
  lookbackHours: 48, siteUrl: "http://localhost", ...over,
});

/** Subject SA (verified, sharing) and observer SB (verified, notifying), accepted friends. */
async function seed(o: {
  connectedAt?: Date; masterShare?: boolean; pairShare?: boolean;
  pairNotify?: boolean; status?: string;
} = {}) {
  await sql`truncate table user_preferences, friendships, notifications, sessions, lives, players, servers, gamertag_links, "user" restart identity cascade`;
  await db.insert(user).values([
    { id: "sa", name: "SA", email: "sa@x.com" },
    { id: "sb", name: "SB", email: "sb@x.com" },
  ]);
  await db.insert(gamertagLinks).values([
    { userId: "sa", gamertag: "SubjectAlpha", status: "verified", verifiedAt: NOW },
    { userId: "sb", gamertag: "ObserverBravo", status: "verified", verifiedAt: NOW },
  ]);
  const [srv] = await db.insert(servers)
    .values({ nitradoServiceId: 990001, name: "Sakhal Server", map: "sakhal", slug: "sakhal" })
    .returning();
  const [p] = await db.insert(players).values({ gamertag: "SubjectAlpha", lastSeenAt: NOW }).returning();
  const [life] = await db.insert(lives)
    .values({ serverId: srv!.id, playerId: p!.id, lifeNumber: 1, startedAt: new Date("2026-07-22T10:00:00Z") })
    .returning();
  await db.insert(sessions).values({
    serverId: srv!.id, playerId: p!.id, lifeId: life!.id,
    connectedAt: o.connectedAt ?? new Date("2026-07-22T11:55:00Z"),
  });
  // sa < sb, so sa is side A: a_* are the subject's flags, b_* the observer's.
  await db.insert(friendships).values({
    userA: "sa", userB: "sb", status: o.status ?? "accepted", requestedBy: "sa",
    aSharesPresence: o.pairShare ?? true, bNotifyPresence: o.pairNotify ?? true,
  });
  await db.insert(userPreferences).values({ userId: "sa", sharePresence: o.masterShare ?? true });
}

beforeEach(() => seed());
afterAll(async () => { await sql.end(); });

describe("presenceGenerator", () => {
  it("notifies the observer, naming the subject and the map", async () => {
    const drafts = await presenceGenerator(deps());
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.userId).toBe("sb");
    expect(drafts[0]!.kind).toBe("friend_online");
    expect(drafts[0]!.body).toBe("SubjectAlpha is on Sakhal.");
    expect(drafts[0]!.href).toBe("/players/subjectalpha");
  });

  // ⚠️ Regression guard. rebuild.ts truncates `sessions` WITH RESTART IDENTITY while
  // `notifications` is never truncated, so a sessions.id-keyed notification collides with a
  // stale key after a rebuild and the recipient is silently never told. Prove this fails
  // against a key built from the session id.
  it("keys on the rebuild-stable (observer, gamertag, connectedAt) tuple", async () => {
    const drafts = await presenceGenerator(deps());
    expect(drafts[0]!.naturalKey).toBe(
      presenceNaturalKey("sb", "SubjectAlpha", new Date("2026-07-22T11:55:00Z")),
    );
    expect(drafts[0]!.naturalKey).toBe("friend_online:sb:SubjectAlpha:2026-07-22T11:55:00.000Z");
  });

  it("suppresses a second notification inside the 4h cooldown and permits one after", async () => {
    await db.insert(notifications).values({
      userId: "sb", kind: "friend_online",
      naturalKey: presenceNaturalKey("sb", "SubjectAlpha", new Date("2026-07-22T09:00:00Z")),
      title: "Friend online", body: "earlier", href: "/",
      createdAt: new Date("2026-07-22T09:30:00Z"), // 2.5h ago — inside the window
    });
    expect(await presenceGenerator(deps())).toHaveLength(0);

    await db.update(notifications).set({ createdAt: new Date("2026-07-22T04:00:00Z") }); // 8h ago
    expect(await presenceGenerator(deps())).toHaveLength(1);
  });

  it("skips a connect older than FRIEND_ONLINE_MAX_AGE_MINUTES", async () => {
    await seed({ connectedAt: new Date("2026-07-22T11:00:00Z") }); // 60 min old
    expect(await presenceGenerator(deps())).toHaveLength(0);
  });

  it("floors the query at windowStart", async () => {
    await seed({ connectedAt: new Date("2026-07-22T11:55:00Z") });
    const drafts = await presenceGenerator(deps({ since: new Date("2026-07-22T11:58:00Z") }));
    expect(drafts).toHaveLength(0);
  });

  it("stays silent when the master switch is off", async () => {
    await seed({ masterShare: false });
    expect(await presenceGenerator(deps())).toHaveLength(0);
  });

  it("stays silent when the subject has hidden from this friend", async () => {
    await seed({ pairShare: false });
    expect(await presenceGenerator(deps())).toHaveLength(0);
  });

  it("stays silent when the observer has muted this friend", async () => {
    await seed({ pairNotify: false });
    expect(await presenceGenerator(deps())).toHaveLength(0);
  });

  it("stays silent for a non-accepted pair", async () => {
    await seed({ status: "pending" });
    expect(await presenceGenerator(deps())).toHaveLength(0);
  });

  it("is unaffected by a LIKE wildcard in a user id", async () => {
    // A `_` in an observer id must not let another observer's rows satisfy the cooldown.
    await db.insert(user).values({ id: "s_b", name: "SUB", email: "sub@x.com" });
    await db.insert(notifications).values({
      userId: "s_b", kind: "friend_online",
      naturalKey: "friend_online:s_b:SubjectAlpha:2026-07-22T09:00:00.000Z",
      title: "t", body: "b", href: "/", createdAt: new Date("2026-07-22T11:59:00Z"),
    });
    // "sb" must still be notified — "s_b" is a different observer.
    expect(await presenceGenerator(deps())).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/notifier run test presence`
Expected: FAIL — cannot resolve `../src/generators/presence.js`.

- [ ] **Step 3: Add the workspace dependency**

In `apps/notifier/package.json`, add `"@onelife/friends": "workspace:*"` to `dependencies`, then run `pnpm install` from the repo root.

- [ ] **Step 4: Implement the generator**

Create `apps/notifier/src/generators/presence.ts`:

```ts
import { friendships, gamertagLinks, notifications, players, servers, sessions, userPreferences } from "@onelife/db";
import {
  escapeLikePattern, shouldNotifyPresence,
  FRIEND_ONLINE_COOLDOWN_HOURS, FRIEND_ONLINE_MAX_AGE_MINUTES,
} from "@onelife/friends";
import { and, eq, gte, isNotNull, or, sql } from "drizzle-orm";
import type { Generator, NotificationDraft } from "../types.js";
import { windowStart } from "../types.js";
import { playerSlug } from "./account.js";

/**
 * Rebuild-stable. Deliberately NOT keyed on sessions.id: apps/projector/src/rebuild.ts
 * truncates `sessions` WITH RESTART IDENTITY while `notifications` is never truncated, so
 * session ids are reassigned across a rebuild and a legitimate connect would collide with a
 * stale key and silently notify nobody — the hazard already flagged in a comment at the
 * notifications table for keys embedding lives.id.
 *
 * The timestamp comes from toISOString() in TypeScript, never a SQL to_char(): a format that
 * drifted from JS would make the dedupe a silent no-op and re-notify forever.
 */
export function presenceNaturalKey(
  observerUserId: string, subjectGamertag: string, connectedAt: Date,
): string {
  return `friend_online:${observerUserId}:${subjectGamertag}:${connectedAt.toISOString()}`;
}

/** Codename → display label, mirroring apps/web's mapLabel. Unknown codenames title-case. */
const MAP_LABELS: Record<string, string> = {
  chernarusplus: "Chernarus",
  sakhal: "Sakhal",
  enoch: "Livonia",
};
function mapLabel(map: string): string {
  return MAP_LABELS[map] ?? (map.charAt(0).toUpperCase() + map.slice(1));
}

type Candidate = {
  observerUserId: string;
  subjectGamertag: string;
  connectedAt: Date;
  map: string;
  status: string;
  masterShare: boolean;
  pairShare: boolean;
  pairNotify: boolean;
};

/**
 * Every recent connect by a verified player on an active slugged server, paired with each
 * friend who might hear about it and the three flags that decide whether they do.
 *
 * The join carries BOTH sides' flags because which physical column belongs to the subject
 * depends on which side of the canonically-ordered pair they are.
 *
 * Not gated on life qualification — unlike the survivors board, the enforcer and the
 * newsdesk. "My friend is playing" is true whether or not their life has earned a
 * leaderboard place, and gating would silently skip fresh spawns, which is exactly when
 * people want to group up.
 */
async function candidates(deps: Parameters<Generator>[0]): Promise<Candidate[]> {
  const from = windowStart(deps);
  const freshest = new Date(deps.now.getTime() - FRIEND_ONLINE_MAX_AGE_MINUTES * 60_000);
  const lower = from > freshest ? from : freshest;

  const rows = await deps.db
    .select({
      connectedAt: sessions.connectedAt,
      map: servers.map,
      subjectGamertag: gamertagLinks.gamertag,
      subjectUserId: gamertagLinks.userId,
      userA: friendships.userA,
      userB: friendships.userB,
      status: friendships.status,
      aShares: friendships.aSharesPresence,
      bShares: friendships.bSharesPresence,
      aNotify: friendships.aNotifyPresence,
      bNotify: friendships.bNotifyPresence,
      masterShare: userPreferences.sharePresence,
    })
    .from(sessions)
    .innerJoin(servers, eq(servers.id, sessions.serverId))
    .innerJoin(players, eq(players.id, sessions.playerId))
    .innerJoin(gamertagLinks, and(
      eq(gamertagLinks.status, "verified"),
      sql`lower(${gamertagLinks.gamertag}) = lower(${players.gamertag})`,
    ))
    .innerJoin(friendships, or(
      eq(friendships.userA, gamertagLinks.userId),
      eq(friendships.userB, gamertagLinks.userId),
    ))
    .leftJoin(userPreferences, eq(userPreferences.userId, gamertagLinks.userId))
    .where(and(
      gte(sessions.connectedAt, lower),
      eq(servers.active, true),
      isNotNull(servers.slug),
    ));

  return rows.map((r) => {
    const subjectIsA = r.userA === r.subjectUserId;
    return {
      observerUserId: subjectIsA ? r.userB : r.userA,
      subjectGamertag: r.subjectGamertag,
      connectedAt: r.connectedAt,
      map: r.map,
      status: r.status,
      // A missing preferences row means defaults, and the default is OFF.
      masterShare: r.masterShare ?? false,
      pairShare: subjectIsA ? r.aShares : r.bShares,
      pairNotify: subjectIsA ? r.bNotify : r.aNotify,
    };
  });
}

/**
 * True when this observer was already told about this subject inside the cooldown.
 *
 * The cooldown lives in the durable notification rows, not a counter column — a column can
 * desynchronise from reality, which is how the sibling rate limit shipped broken once.
 *
 * The prefix is escaped and matched with LIKE so it uses notifications_natural_key_pattern_idx
 * (text_pattern_ops). Do NOT "simplify" to starts_with(): it is not index-usable and will
 * seq-scan a table growing across every other notification kind.
 */
async function recentlyNotified(
  deps: Parameters<Generator>[0], observerUserId: string, subjectGamertag: string,
): Promise<boolean> {
  const since = new Date(deps.now.getTime() - FRIEND_ONLINE_COOLDOWN_HOURS * 3600_000);
  const prefix = escapeLikePattern(`friend_online:${observerUserId}:${subjectGamertag}:`);
  const [row] = await deps.db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(
      sql`${notifications.naturalKey} LIKE ${prefix} || '%'`,
      gte(notifications.createdAt, since),
    ))
    .limit(1);
  return !!row;
}

export const presenceGenerator: Generator = async (deps) => {
  const rows = await candidates(deps);
  const drafts: NotificationDraft[] = [];
  const seen = new Set<string>();

  for (const c of rows) {
    if (!shouldNotifyPresence(c)) continue;
    const key = presenceNaturalKey(c.observerUserId, c.subjectGamertag, c.connectedAt);
    // Intra-tick dedupe: two connects by one subject inside the window would otherwise both
    // pass the cooldown check, which reads only committed rows.
    const pairKey = `${c.observerUserId}:${c.subjectGamertag}`;
    if (seen.has(pairKey)) continue;
    if (await recentlyNotified(deps, c.observerUserId, c.subjectGamertag)) continue;
    seen.add(pairKey);
    drafts.push({
      userId: c.observerUserId,
      kind: "friend_online",
      naturalKey: key,
      title: "Friend online",
      body: `${c.subjectGamertag} is on ${mapLabel(c.map)}.`,
      href: `/players/${playerSlug(c.subjectGamertag)}`,
    });
  }
  return drafts;
};
```

- [ ] **Step 5: Register the generator**

In `apps/notifier/src/main.ts`, add the import and append to the `generators` array:

```ts
import { presenceGenerator } from "./generators/presence.js";
```
```ts
  presenceGenerator,
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @onelife/notifier run test`
Expected: PASS — the whole notifier suite.

- [ ] **Step 7: Prove the natural-key regression test is real**

Temporarily change `presenceNaturalKey` to take and embed a session id instead of the tuple, and re-run.

Expected: **"keys on the rebuild-stable (observer, gamertag, connectedAt) tuple" FAILS.** Revert and confirm it passes. A test that cannot fail protects nothing.

- [ ] **Step 8: Commit**

```bash
pnpm turbo run typecheck
git add apps/notifier pnpm-lock.yaml
git commit -m "feat(notifier): friend-online presence generator"
```

---

### Task 6: Web client and hooks

**Files:**
- Modify: `apps/web/src/lib/types.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/use-friends.ts`

**Interfaces:**
- Produces:
  - `FriendEntryDto` gains `sharesPresence: boolean`, `notifyPresence: boolean`.
  - `FriendsFeed` gains `sharePresence: boolean`.
  - `patchFriendPresence(id: number, body: { share?: boolean; notify?: boolean }): Promise<{ ok: true }>`
  - `patchPreferences(body: { sharePresence?: boolean }): Promise<{ sharePresence: boolean }>`
  - `useFriendActions()` gains `setPresence(id, body)` and `setSharePresence(value)`.

- [ ] **Step 1: Extend the DTOs**

In `apps/web/src/lib/types.ts`, add to `FriendEntryDto`:

```ts
  sharesPresence: boolean;
  notifyPresence: boolean;
```

and to `FriendsFeed`:

```ts
  /** The viewer's master switch — gates every per-friend share flag. */
  sharePresence: boolean;
```

- [ ] **Step 2: Add the client calls**

`apiSend` only accepts `"POST" | "DELETE"` today. Widen its `method` parameter to include `"PATCH"` in `apps/web/src/lib/api.ts` (a type-only change; the body/header logic is unchanged — and note it must keep attaching `content-type` only when a body is present).

Then append:

```ts
export const patchFriendPresence = (id: number, body: { share?: boolean; notify?: boolean }) =>
  apiSend<{ ok: true }>("PATCH", `/api/me/friends/${id}/presence`, body);
export const patchPreferences = (body: { sharePresence?: boolean }) =>
  apiSend<{ sharePresence: boolean }>("PATCH", "/api/me/preferences", body);
```

- [ ] **Step 3: Extend the actions hook**

In `apps/web/src/lib/use-friends.ts`. The existing hook tracks a `FriendAction` union so `errorCode` describes only the most recently invoked action, and every action takes an optional `onSettled` that fires from the mutation's own callbacks — never at call time. Extend both, leaving the four existing actions byte-identical.

Widen the union:

```ts
type FriendAction = "send" | "accept" | "decline" | "remove" | "presence" | "master";
```

Add the two mutations after `del`, and include them in `all`:

```ts
  const pres = useMutation({
    mutationFn: (v: { id: number; share?: boolean; notify?: boolean }) =>
      patchFriendPresence(v.id, { share: v.share, notify: v.notify }),
    ...opts,
  });
  const master = useMutation({
    mutationFn: (sharePresence: boolean) => patchPreferences({ sharePresence }),
    ...opts,
  });
  const all = [send, acc, dec, del, pres, master];
```

Extend the `lastMutation` ternary chain with the two new arms, before the trailing `: null`:

```ts
    : lastAction === "presence" ? pres
    : lastAction === "master" ? master
```

Add the two returned actions, mirroring the existing four exactly:

```ts
    setPresence: (
      id: number, body: { share?: boolean; notify?: boolean }, onSettled?: Settled,
    ) => {
      setLastAction("presence");
      pres.mutate({ id, ...body }, {
        onSuccess: () => onSettled?.(true, null),
        onError: (err) => onSettled?.(false, codeOf(err)),
      });
    },
    setSharePresence: (value: boolean, onSettled?: Settled) => {
      setLastAction("master");
      master.mutate(value, {
        onSuccess: () => onSettled?.(true, null),
        onError: (err) => onSettled?.(false, codeOf(err)),
      });
    },
```

Add `patchFriendPresence` and `patchPreferences` to the existing `@/lib/api` import at the top of the file.

- [ ] **Step 4: Typecheck and commit**

```bash
pnpm --filter @onelife/web run typecheck
pnpm --filter @onelife/web run test
git add apps/web/src/lib
git commit -m "feat(web): presence flag client calls and mutations"
```

Expected: typecheck clean, existing web suite unchanged and green.

---

### Task 7: Roster toggles and the master switch

**Files:**
- Create: `apps/web/src/components/friends/presence-toggles.tsx`, `apps/web/src/components/friends/presence-toggles.test.tsx`
- Modify: `apps/web/src/components/friends/roster.tsx`, `apps/web/src/components/friends/roster.test.tsx`

**Interfaces:**
- Consumes: `useFriends`, `useFriendActions` (Task 6).
- Produces: `<PresenceToggles entry share notify masterOn disabled onChange />` and `<MasterShareSwitch on disabled onChange />`, both presentational and props-only.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/friends/presence-toggles.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PresenceToggles, MasterShareSwitch } from "./presence-toggles";

describe("MasterShareSwitch", () => {
  it("reflects its state and reports a change", async () => {
    const onChange = vi.fn();
    render(<MasterShareSwitch on={false} onChange={onChange} />);
    const box = screen.getByRole("checkbox", { name: /share my status with friends/i });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("PresenceToggles", () => {
  const noop = () => {};

  it("renders both switches reflecting their flags", () => {
    render(<PresenceToggles share={true} notify={false} masterOn onChange={noop} />);
    expect(screen.getByRole("checkbox", { name: /share my status/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /notify me/i })).not.toBeChecked();
  });

  it("reports which flag changed", async () => {
    const onChange = vi.fn();
    render(<PresenceToggles share notify masterOn onChange={onChange} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /notify me/i }));
    expect(onChange).toHaveBeenCalledWith({ notify: false });
  });

  // The two levels must be visible, not mysterious: with the master switch off, the
  // per-friend share control is disabled AND says why.
  it("disables the share switch and explains when the master switch is off", () => {
    render(<PresenceToggles share notify masterOn={false} onChange={noop} />);
    expect(screen.getByRole("checkbox", { name: /share my status/i })).toBeDisabled();
    expect(screen.getByText(/sharing is off/i)).toBeInTheDocument();
  });

  it("leaves the notify switch usable when the master switch is off", () => {
    render(<PresenceToggles share notify masterOn={false} onChange={noop} />);
    expect(screen.getByRole("checkbox", { name: /notify me/i })).toBeEnabled();
  });

  it("disables both while a write is in flight", () => {
    render(<PresenceToggles share notify masterOn disabled onChange={noop} />);
    expect(screen.getByRole("checkbox", { name: /share my status/i })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /notify me/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/web run test presence-toggles`
Expected: FAIL — cannot resolve `./presence-toggles`.

- [ ] **Step 3: Implement the components**

Create `apps/web/src/components/friends/presence-toggles.tsx`:

```tsx
"use client";

const LABEL = "font-mono text-[11px] uppercase tracking-[.05em] text-ink flex items-center gap-1.5";
const NOTE = "font-mono text-[10px] uppercase tracking-[.05em] text-ink-muted";

/** The per-user master switch. Off by default — nobody is visible until they opt in. */
export function MasterShareSwitch(p: {
  on: boolean; disabled?: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className={`${LABEL} border-b border-hairline pb-2.5`}>
      <input
        type="checkbox"
        checked={p.on}
        disabled={p.disabled}
        onChange={(e) => p.onChange(e.target.checked)}
      />
      Share my status with friends
    </label>
  );
}

/**
 * Per-friend presence controls.
 *
 * `share` is gated by the master switch: with the master off, the control is DISABLED and
 * annotated rather than hidden, so the two levels are visible instead of mysterious.
 * `notify` is independent of it — muting a friend is meaningful whether or not you are
 * visible yourself.
 */
export function PresenceToggles(p: {
  share: boolean;
  notify: boolean;
  masterOn: boolean;
  disabled?: boolean;
  onChange: (patch: { share?: boolean; notify?: boolean }) => void;
}) {
  return (
    <div className="flex flex-col gap-1 py-1">
      <label className={LABEL}>
        <input
          type="checkbox"
          checked={p.share}
          disabled={p.disabled || !p.masterOn}
          onChange={(e) => p.onChange({ share: e.target.checked })}
        />
        Share my status
      </label>
      {p.masterOn ? null : <span className={NOTE}>Sharing is off for everyone</span>}
      <label className={LABEL}>
        <input
          type="checkbox"
          checked={p.notify}
          disabled={p.disabled}
          onChange={(e) => p.onChange({ notify: e.target.checked })}
        />
        Notify me
      </label>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @onelife/web run test presence-toggles`
Expected: PASS — 6 tests.

- [ ] **Step 5: Wire them into the Roster**

In `apps/web/src/components/friends/roster.tsx`.

`Row` currently renders a `<li>` with a `GamertagLink` and its action buttons. Give it an optional slot, and `Section` a way to supply one — the toggles belong under the row, not squeezed into the button strip:

```tsx
function Row({ entry, actions, extra }: {
  entry: FriendEntryDto; actions: RowAction[]; extra?: ReactNode;
}) {
  return (
    <li className="border-b border-hairline py-2.5">
      <div className="flex items-center justify-between">
        <GamertagLink gamertag={entry.gamertag} />
        <div className="flex gap-2">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={a.onClick}
              disabled={a.disabled}
              className={a.danger ? BTN_DANGER : BTN}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
      {extra}
    </li>
  );
}
```

Import `type ReactNode` from `react`, and thread the slot through `Section`:

```tsx
function Section({ title, id, entries, action, extra }: {
  title: string; id: string; entries: FriendEntryDto[];
  action: (e: FriendEntryDto) => RowAction[];
  extra?: (e: FriendEntryDto) => ReactNode;
}) {
  if (entries.length === 0) return null;
  return (
    <section className="mt-8 first:mt-0">
      <h2 id={id} className="font-mono text-[11px] uppercase tracking-[.08em] text-ink-muted">{title}</h2>
      <ul role="list" aria-labelledby={id} className="mt-2">
        {entries.map((e) => (
          <Row key={e.id} entry={e} actions={action(e)} extra={extra?.(e)} />
        ))}
      </ul>
    </section>
  );
}
```

Add three props to `RosterViewProps`:

```ts
  onPresenceChange: (id: number, patch: { share?: boolean; notify?: boolean }) => void;
  onSharePresenceChange: (value: boolean) => void;
```

Render the master switch immediately above the first `<Section>` (only when there is at least one friend — it is meaningless with an empty roster):

```tsx
      {d.friends.length > 0 ? (
        <MasterShareSwitch
          on={d.sharePresence}
          disabled={p.pending}
          onChange={p.onSharePresenceChange}
        />
      ) : null}
```

Give the **Friends** `<Section>` the `extra` slot — and only that one, since presence is meaningless before a friendship exists:

```tsx
        extra={(e) => (
          <PresenceToggles
            share={e.sharesPresence}
            notify={e.notifyPresence}
            masterOn={d.sharePresence}
            disabled={p.pending}
            onChange={(patch) => p.onPresenceChange(e.id, patch)}
          />
        )}
```

In the `Roster` container, wire both through the existing `settle()` helper so the announcement fires on settlement and never at click time:

```tsx
      onPresenceChange={(id, patch) =>
        a.setPresence(id, patch, settle("Presence updated"))}
      onSharePresenceChange={(value) =>
        a.setSharePresence(value, settle(value ? "Sharing your status" : "No longer sharing your status"))}
```

Import `MasterShareSwitch` and `PresenceToggles` from `./presence-toggles`.

- [ ] **Step 6: Add Roster tests**

In `apps/web/src/components/friends/roster.test.tsx`, add cases asserting: the master switch renders from `data.sharePresence`; presence toggles appear on friend rows but NOT on incoming/outgoing rows; and a failed presence write surfaces the error rather than silently appearing to succeed.

Follow the existing container-test idiom in that file (which mounts `Roster` with mocked hooks) rather than inventing a new one.

- [ ] **Step 7: Run the full web suite and commit**

Run: `pnpm --filter @onelife/web run test && pnpm --filter @onelife/web run typecheck`
Expected: PASS, no regressions.

```bash
git add apps/web/src/components/friends
git commit -m "feat(web): presence toggles and the master switch on the Roster"
```

---

### Task 8: Full verification

**Files:** none created; this task runs and fixes only.

- [ ] **Step 1: Run the whole suite**

Run: `pnpm turbo run test --concurrency=1`
Expected: PASS. If a DB suite errors on connection, confirm `TEST_DATABASE_URL` is set and Postgres is running.

- [ ] **Step 2: Typecheck everything**

Run: `pnpm turbo run typecheck`
Expected: no errors.

- [ ] **Step 3: Confirm the durability and convention invariants**

Run:

```bash
grep -rn "user_preferences" apps/projector/src/rebuild.ts packages/test-support/src/global-setup.ts
ls packages/db/drizzle/meta/
grep -c '"idx": 20' packages/db/drizzle/meta/_journal.json
```

Expected: a hit in `global-setup.ts`, **no** hit in `rebuild.ts`, no `0020_snapshot.json`, exactly one idx-20 entry.

- [ ] **Step 4: Confirm the notification kind count**

Run: `grep -rn "friend_online" apps/notifier/src apps/web/src | head`

Expected: the generator emits it, and — if `apps/web/src/components/notifications/row.tsx` maps kinds to accents — either an entry exists for `friend_online` or the unknown-kind fallback covers it. Check that file; an unstyled-but-correct render is acceptable, a crash is not.

- [ ] **Step 5: Commit any fixes**

```bash
git add -p
git commit -m "test: fix up friends F3 suite"
```

(Skip if nothing changed.)

---

## Handoff

Do **not** hand-write the changelog, CLAUDE.md update or the PR. After Task 8 passes, invoke the **`finishing-a-feature`** skill.

The changelog entry must state that **F3 ships dark behind two gates**: the notifier's generate pass is off in production (`NOTIFIER_SINCE` unset), and turning it on un-dormants the other nine notification kinds at the same time; and separately, no user is visible until they turn on the master switch.
