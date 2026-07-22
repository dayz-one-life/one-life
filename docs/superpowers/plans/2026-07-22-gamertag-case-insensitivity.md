# Gamertag Case-Insensitivity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make gamertag identity case-insensitive across the whole system, so `Sasha` and `sasha` can never become two players, two verified links, or a link that silently never verifies.

**Architecture:** Four boundaries enforce one invariant. Three are code fixes that are correct under either index (verifier matching, claim-route canonicalization, projector player resolution); the fourth is migration `0024`, which swaps two unique indexes to `lower(gamertag)`. The claim route resolves a submitted gamertag to the canonical `players.gamertag` casing before storing it, which is what keeps the 35 untouched bare-`eq()` comparisons elsewhere correct by construction.

**Tech Stack:** TypeScript/ESM, pnpm + turbo monorepo, Postgres 16, drizzle-orm 0.36.4, vitest, Fastify.

**Spec:** `docs/superpowers/specs/2026-07-22-gamertag-case-insensitivity-design.md`

## Global Constraints

- **Migration `0024` is hand-written SQL, and `meta/_journal.json` is hand-appended.** The drizzle snapshot chain is broken (`meta/` stops at `0014_snapshot.json`), so `drizzle-kit generate` diffs a stale snapshot and emits wrong SQL. Follow `0018`–`0023` as the pattern.
- **Do NOT use `CREATE INDEX CONCURRENTLY`.** `deploy.sh` stops the fleet before migrating so there are no concurrent writers, and `CONCURRENTLY` cannot run inside a transaction — which would forfeit the roll-back that makes the precheck safe.
- **Do NOT touch the 35 bare `eq(x.gamertag, …)` comparisons elsewhere in the codebase.** A `lower()` predicate defeats `positions_player_idx` past its `server_id` prefix and both partial expression indexes from migration `0017`. The 29 sites already using `lower()` are cross-table identity joins and stay as they are.
- **`players.gamertag` keeps its first-seen casing forever.** `getPlayer` finds the row for any casing; `touchPlayer` must NOT rewrite the stored value.
- **drizzle-orm 0.36.4 cannot express an expression conflict target.** `IndexColumn = PgColumn`, so `onConflictDoUpdate({ target: … })` accepts columns only. Any `ON CONFLICT (lower(gamertag))` must be raw SQL via `tx.execute(sql\`…\`)` — the same escape hatch the Long Form candidate query already uses.
- **Task order is a dependency, not a preference.** Task 4's `ON CONFLICT (lower(gamertag))` requires the index from Task 4's own migration, and that index requires Task 3 to already be in place or the projector crash-loops.
- Every test must be **proven red before the fix** and green after. Commit after each task.

## Prerequisites

Docker must be running and the **test** database migrated. `drizzle-kit` reads `DATABASE_URL` and nothing else — notably not `TEST_DATABASE_URL` — so name it explicitly or you will silently migrate the wrong database:

```bash
docker compose up -d postgres
docker ps --format '{{.Names}} {{.Ports}}'   # note the host port; a gitignored override may remap it
export TEST_DATABASE_URL="postgres://onelife:onelife@localhost:<port>/onelife_test"
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate
```

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `apps/verifier/src/pg-store.ts` | Emote matching, already-won check, competing-claim cancellation — all case-insensitive | 1 |
| `apps/verifier/test/tick.test.ts` | Cross-case emote verifies | 1 |
| `apps/api/src/routes/gamertag-links.ts` | Canonicalize claimed gamertag on write; case-insensitive prechecks | 2 |
| `apps/api/test/gamertag-links.test.ts` | Canonicalization + conflict behaviour | 2 |
| `apps/projector/src/pg-store.ts` | `getPlayer` case-insensitive (T3); `createPlayer` conflict target (T4) | 3, 4 |
| `packages/projections/src/memory-store.ts` | In-memory parity with Postgres | 3 |
| `packages/projections/test/memory-store.test.ts` | In-memory resolution across casings | 3 |
| `apps/projector/test/pg-store.test.ts` | Postgres resolution across casings | 3 |
| `packages/db/drizzle/0024_gamertag_case_insensitive.sql` | Precheck + two index swaps | 4 |
| `packages/db/drizzle/meta/_journal.json` | Hand-appended journal entry | 4 |
| `packages/db/src/schema.ts` | Both indexes declared as expression indexes | 4 |
| `packages/db/test/gamertag-case.test.ts` | Both unique indexes pinned directly | 4 |
| `CHANGELOG.md`, `CLAUDE.md` | Release + architecture notes | 5 |

---

### Task 1: Verifier matches emotes case-insensitively

Fixes a live user-facing bug independent of any index: claim `sasha`, emote as `Sasha`, and `findPendingChallenges` matches nothing — the user performs the emote correctly forever and verification never completes.

**Files:**
- Modify: `apps/verifier/src/pg-store.ts:30`, `:47`, `:84`
- Test: `apps/verifier/test/tick.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: no signature changes. `findPendingChallenges(gamertag: string, at: Date)`, `getVerifiedLinkId(gamertag: string)`, and `cancelOtherPendingLinks(gamertag: string, exceptLinkId: number)` keep their exact signatures; only their WHERE clauses change.

- [ ] **Step 1: Write the failing test**

Add to `apps/verifier/test/tick.test.ts`, inside the existing `describe("verifierTick", …)` block:

```ts
  it("verifies when the ADM casing differs from the claimed link casing", async () => {
    // The claim stored "sasha"; the game logs the emote as "Sasha". Same human.
    const { linkId } = await newChallenge("sasha", uid);
    await seedEmote("Sasha", "EmoteSalute", "2026-07-09T01:00:00Z");
    await seedEmote("Sasha", "EmoteDance", "2026-07-09T01:01:00Z");
    await seedEmote("Sasha", "EmoteShrug", "2026-07-09T01:02:00Z");

    const r = await verifierTick(db, { batchSize: 100, consumerName: consumer });
    expect(r.verified).toBe(1);
    expect(await status(linkId)).toBe("verified");
  });

  it("first-verify-wins across casings: the losing link is cancelled, not collided", async () => {
    const winner = await newChallenge("Casey", uid);
    const loser = await newChallenge("casey", uidB);
    await seedEmote("Casey", "EmoteSalute", "2026-07-09T02:00:00Z");
    await seedEmote("Casey", "EmoteDance", "2026-07-09T02:01:00Z");
    await seedEmote("Casey", "EmoteShrug", "2026-07-09T02:02:00Z");

    await verifierTick(db, { batchSize: 100, consumerName: consumer });
    expect(await status(winner.linkId)).toBe("verified");
    expect(await status(loser.linkId)).toBe("cancelled");
  });
```

Both tests use the file's existing `newChallenge`, `seedEmote`, `status` helpers and the `beforeEach` that clears `uid`/`uidB` links, so no new fixtures are needed.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @onelife/verifier run test -- -t "casing"
```

Expected: FAIL. The first test reports `expected 0 to be 1` for `r.verified` and status `pending` — `findPendingChallenges` never matched. The second reports the loser still `pending`.

- [ ] **Step 3: Make the three comparisons case-insensitive**

In `apps/verifier/src/pg-store.ts`, add `sql as dsql` to the drizzle import:

```ts
import { and, eq, gt, lt, ne, isNull, sql as dsql } from "drizzle-orm";
```

In `findPendingChallenges`, replace the first line of the `.where(and(…))`:

```ts
        dsql`lower(${gamertagLinks.gamertag}) = lower(${gamertag})`,
```

(replacing `eq(gamertagLinks.gamertag, gamertag),` — leave the other four conditions untouched).

In `getVerifiedLinkId`:

```ts
  async getVerifiedLinkId(gamertag: string): Promise<number | null> {
    const r = await this.tx.select({ id: gamertagLinks.id }).from(gamertagLinks)
      .where(and(
        dsql`lower(${gamertagLinks.gamertag}) = lower(${gamertag})`,
        eq(gamertagLinks.status, "verified"),
      ));
    return r[0]?.id ?? null;
  }
```

In `cancelOtherPendingLinks`:

```ts
  async cancelOtherPendingLinks(gamertag: string, exceptLinkId: number): Promise<void> {
    await this.tx.update(gamertagLinks).set({ status: "cancelled" })
      .where(and(
        dsql`lower(${gamertagLinks.gamertag}) = lower(${gamertag})`,
        eq(gamertagLinks.status, "pending"),
        ne(gamertagLinks.id, exceptLinkId),
      ));
  }
```

- [ ] **Step 4: Run the verifier suite to verify it passes**

```bash
pnpm --filter @onelife/verifier run test
```

Expected: PASS, all tests including the two new ones and every pre-existing one.

- [ ] **Step 5: Commit**

```bash
git add apps/verifier/src/pg-store.ts apps/verifier/test/tick.test.ts
git commit -m "fix(verifier): match emotes against the link gamertag case-insensitively

A claim stored as 'sasha' never matched an ADM emote logged as 'Sasha', so the
user performed the sequence correctly and verification silently never completed."
```

---

### Task 2: Claim route canonicalizes on write

**Files:**
- Modify: `apps/api/src/routes/gamertag-links.ts:56-76` and `:85`
- Test: `apps/api/test/gamertag-links.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: the invariant every later task and the untouched `eq()` sites rely on — **a `gamertag_links.gamertag` value always equals some `players.gamertag` byte for byte.**

- [ ] **Step 1: Write the failing test**

In `apps/api/test/gamertag-links.test.ts`, seed a mixed-case player in `beforeAll` (add after the existing `players` insert of `"Alice"`):

```ts
  await db.insert(players).values({ gamertag: "Sasha", dayzId: `S=${svc}` });
```

Add `"Sasha"` to both cleanup lists in `afterAll`:

```ts
  await db.delete(gamertagLinks).where(inArray(gamertagLinks.gamertag, ["Alice", "Verified", "Foreign", "Bob", "Sasha"]));
  await db.delete(players).where(inArray(players.gamertag, ["Alice", "Verified", "Bob", "Sasha"]));
```

Then add a new describe block at the end of the file:

```ts
describe("POST /me/gamertag-links — case-insensitivity", () => {
  beforeEach(async () => {
    // gamertag_links_user_active_uniq permits one active link per user; clear ours.
    await db.delete(verificationChallenges).where(
      sqlExpr`${verificationChallenges.gamertagLinkId} IN (SELECT id FROM gamertag_links WHERE gamertag ILIKE 'sasha')`);
    await db.delete(gamertagLinks).where(sqlExpr`gamertag ILIKE 'sasha'`);
  });

  it("stores the canonical players casing, not what the user typed", async () => {
    const res = await claim({ gamertag: "sasha" });
    expect(res.statusCode).toBe(201);
    const rows = await db.select({ g: gamertagLinks.gamertag }).from(gamertagLinks)
      .where(sqlExpr`gamertag ILIKE 'sasha'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.g).toBe("Sasha");
  });

  it("409 already_verified when another user holds the gamertag in different casing", async () => {
    await db.insert(gamertagLinks)
      .values({ userId: "someone-else", gamertag: "Sasha", status: "verified" });
    const res = await claim({ gamertag: "sasha" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("already_verified");
  });

  it("still 422 for a gamertag never seen, whatever the casing", async () => {
    const res = await claim({ gamertag: "nobodyhaseverbeencalledthis" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("gamertag_not_seen");
  });

  it("re-claiming your own pending link in different casing is idempotent", async () => {
    const first = await claim({ gamertag: "Sasha" });
    expect(first.statusCode).toBe(201);
    const second = await claim({ gamertag: "SASHA" });
    expect(second.statusCode).toBe(201);
    expect(second.json().linkId).toBe(first.json().linkId);
  });
});
```

Add `beforeEach` to the vitest import at the top of the file if it is not already there.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @onelife/api run test -- -t "case-insensitivity"
```

Expected: FAIL. Test 1 gets `422 gamertag_not_seen` (the `eq` lookup misses `Sasha`). Tests 2 and 4 also fail on the same lookup.

- [ ] **Step 3: Canonicalize and compare case-insensitively**

In `apps/api/src/routes/gamertag-links.ts`, ensure `sql as dsql` is imported from `drizzle-orm`, then replace the two prechecks (currently lines 56–65) with:

```ts
    // D6: the gamertag must be an observed player (players are global, not per-server).
    // Resolve case-insensitively and adopt the canonical casing for everything below — the
    // stored link must match players.gamertag byte for byte, or the verifier's emote match
    // and every downstream eq() join silently misses it.
    const player = await db.select({ gamertag: players.gamertag }).from(players)
      .where(dsql`lower(${players.gamertag}) = lower(${gamertag})`)
      .limit(1);
    if (player.length === 0) return reply.code(422).send({ error: "gamertag_not_seen" });
    const canonical = player[0]!.gamertag;

    // D3: reject if this gamertag is already verified by anyone.
    const verified = await db.select({ id: gamertagLinks.id }).from(gamertagLinks)
      .where(and(dsql`lower(${gamertagLinks.gamertag}) = lower(${canonical})`, eq(gamertagLinks.status, "verified")));
    if (verified.length > 0) return reply.code(409).send({ error: "already_verified" });
```

Change the active-link comparison just below it to be case-insensitive, so re-claiming your own link in another casing is not mistaken for a different gamertag:

```ts
    const other = active.find((l) => l.gamertag.toLowerCase() !== canonical.toLowerCase());
```

Inside the transaction, look the existing link up case-insensitively and insert the canonical casing:

```ts
        const existing = await tx.select().from(gamertagLinks)
          .where(and(eq(gamertagLinks.userId, userId), dsql`lower(${gamertagLinks.gamertag}) = lower(${canonical})`));
```

```ts
          const [row] = await tx.insert(gamertagLinks).values({ userId, gamertag: canonical, status: "pending" }).returning();
```

Leave every other line of the route unchanged.

- [ ] **Step 4: Run the api suite to verify it passes**

```bash
pnpm --filter @onelife/api run test
```

Expected: PASS, including all pre-existing gamertag-link tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/gamertag-links.ts apps/api/test/gamertag-links.test.ts
git commit -m "fix(api): store the canonical players casing when claiming a gamertag

The claim route inserted the raw request body, so a user who typed 'sasha' for
the player row 'Sasha' created a link no index rejects and no eq() join matches."
```

---

### Task 3: Projector resolves players case-insensitively

**This task must land before Task 4.** Once `players_gamertag_uniq` covers `lower(gamertag)`, a bare-`eq` `getPlayer` returns null for a re-cased name, `fold.ts:35` calls `createPlayer`, and the insert raises 23505 *inside the fold transaction*. Being an event-log fold, the projector then retries that same event forever and every projection stops advancing.

**Files:**
- Modify: `apps/projector/src/pg-store.ts:13-17`
- Modify: `packages/projections/src/memory-store.ts:30-32`
- Test: `packages/projections/test/memory-store.test.ts`
- Test: `apps/projector/test/pg-store.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1–2.
- Produces: `ProjectionStore.getPlayer(gamertag: string): Promise<PlayerRow | null>` — signature unchanged, now matching case-insensitively in both implementations. Task 4 modifies `createPlayer` in the same file.

- [ ] **Step 1: Write the failing test**

Two tests — one per store implementation, because a fix to only one is exactly the drift this pair exists to catch.

Add to `packages/projections/test/memory-store.test.ts` (it already imports `MemoryStore` from `../src/index.js`):

```ts
  it("resolves an existing player when the ADM re-cases their gamertag", async () => {
    const s = new MemoryStore();
    await s.createPlayer("Sasha", "HASH1", new Date("2026-07-01T00:00:00Z"));
    const found = await s.getPlayer("sasha");
    expect(found).not.toBeNull();
    expect(found!.gamertag).toBe("Sasha"); // canonical casing preserved, not rewritten
  });
```

Add to `apps/projector/test/pg-store.test.ts`, matching that file's existing `getTestDb` / `PgProjectionStore` setup and its cleanup block:

```ts
  it("resolves an existing player when the ADM re-cases their gamertag", async () => {
    const tag = `Recase${Math.floor(Math.random() * 1e8)}`;
    await db.insert(players).values({ gamertag: tag, dayzId: `D=${tag}` });
    const store = new PgProjectionStore(db);
    const found = await store.getPlayer(tag.toLowerCase());
    expect(found).not.toBeNull();
    expect(found!.gamertag).toBe(tag); // the stored casing is returned, not the queried one
    await db.delete(players).where(eq(players.gamertag, tag));
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @onelife/projections run test -- -t "re-cases"
pnpm --filter @onelife/projector run test -- -t "re-cases"
```

Expected: both FAIL with `expected null not to be null`.

- [ ] **Step 3: Make both stores resolve case-insensitively**

In `packages/projections/src/memory-store.ts`:

```ts
  async getPlayer(gamertag: string): Promise<PlayerRow | null> {
    const want = gamertag.toLowerCase();
    return this.players.find((p) => p.gamertag.toLowerCase() === want) ?? null;
  }
```

In `apps/projector/src/pg-store.ts` (the `sql` helper is already imported in that file):

```ts
  async getPlayer(gamertag: string): Promise<PlayerRow | null> {
    // Case-insensitive: Xbox reserves gamertags case-insensitively, so a re-cased name is
    // the same human. Under players_gamertag_uniq on lower(gamertag) a bare eq() here would
    // miss, fall through to createPlayer, and 23505 inside the fold transaction — which an
    // event-log fold retries forever.
    const r = await this.tx.select().from(players)
      .where(sql`lower(${players.gamertag}) = lower(${gamertag})`);
    return r[0] ? { id: r[0].id, gamertag: r[0].gamertag, lastSeenAt: r[0].lastSeenAt } : null;
  }
```

Do **not** change `touchPlayer` — the stored casing stays frozen at first sight.

- [ ] **Step 4: Run both suites to verify they pass**

```bash
pnpm --filter @onelife/projections run test && pnpm --filter @onelife/projector run test
```

Expected: PASS for both.

- [ ] **Step 5: Commit**

```bash
git add apps/projector/src/pg-store.ts packages/projections/src/memory-store.ts packages/projections/test/memory-store.test.ts apps/projector/test/pg-store.test.ts
git commit -m "fix(projector): resolve players case-insensitively

A re-cased gamertag minted a second players row. It must resolve to the existing
row before 0024 makes players_gamertag_uniq an expression index."
```

---

### Task 4: Migration 0024 + expression indexes + conflict target

Atomic by necessity: `ON CONFLICT (lower(gamertag))` is only valid once the matching index exists, and the index is only safe once Task 3 has landed.

**Files:**
- Create: `packages/db/drizzle/0024_gamertag_case_insensitive.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/db/src/schema.ts:74` and `:236`
- Modify: `apps/projector/src/pg-store.ts:22-28` (`createPlayer`)
- Test: `packages/db/test/gamertag-case.test.ts` (create)

**Interfaces:**
- Consumes: `getPlayer` from Task 3, case-insensitive.
- Produces: `createPlayer(gamertag: string, dayzId: string | null, seenAt: Date): Promise<PlayerRow>` — signature unchanged, implementation now raw SQL.

- [ ] **Step 1: Write the migration**

Create `packages/db/drizzle/0024_gamertag_case_insensitive.sql`:

```sql
DO $$
DECLARE dupes text;
BEGIN
  SELECT string_agg(g, ', ') INTO dupes
  FROM (SELECT lower(gamertag) AS g FROM players GROUP BY 1 HAVING count(*) > 1) x;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'players has case-colliding gamertags, resolve by hand first: %', dupes;
  END IF;

  SELECT string_agg(g, ', ') INTO dupes
  FROM (SELECT lower(gamertag) AS g FROM gamertag_links WHERE status = 'verified'
        GROUP BY 1 HAVING count(*) > 1) x;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'gamertag_links has case-colliding verified links, resolve by hand first: %', dupes;
  END IF;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "players_gamertag_uniq";
--> statement-breakpoint
CREATE UNIQUE INDEX "players_gamertag_uniq" ON "players" USING btree (lower("gamertag"));
--> statement-breakpoint
DROP INDEX IF EXISTS "gamertag_links_verified_uniq";
--> statement-breakpoint
CREATE UNIQUE INDEX "gamertag_links_verified_uniq" ON "gamertag_links" USING btree (lower("gamertag")) WHERE "gamertag_links"."status" = 'verified';
```

Append to the `entries` array in `packages/db/drizzle/meta/_journal.json`, after the `0023` entry (mind the missing trailing newline in that file — keep it byte-clean):

```json
    {
      "idx": 24,
      "version": "7",
      "when": 1785400000000,
      "tag": "0024_gamertag_case_insensitive",
      "breakpoints": true
    }
```

- [ ] **Step 2: Write the failing test**

Create `packages/db/test/gamertag-case.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { players, gamertagLinks, user } from "../src/schema.js";
import { inArray, eq } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const tag = `Case${Math.floor(Math.random() * 1e8)}`;
const uidA = `u-case-a-${tag}`;
const uidB = `u-case-b-${tag}`;

afterAll(async () => {
  await db.delete(gamertagLinks).where(inArray(gamertagLinks.userId, [uidA, uidB]));
  await db.delete(user).where(inArray(user.id, [uidA, uidB]));
  await db.delete(players).where(inArray(players.gamertag, [tag, tag.toLowerCase()]));
  await sql.end();
});

describe("gamertag uniqueness is case-insensitive", () => {
  it("players rejects a second row differing only in case", async () => {
    await db.insert(players).values({ gamertag: tag, dayzId: `D=${tag}` });
    await expect(
      db.insert(players).values({ gamertag: tag.toLowerCase(), dayzId: `D2=${tag}` }),
    ).rejects.toThrow(/players_gamertag_uniq/);
  });

  it("gamertag_links rejects a second VERIFIED link differing only in case", async () => {
    await db.insert(user).values({ id: uidA, name: "a", email: `${uidA}@x.com` });
    await db.insert(user).values({ id: uidB, name: "b", email: `${uidB}@x.com` });
    await db.insert(gamertagLinks).values({ userId: uidA, gamertag: tag, status: "verified" });
    await expect(
      db.insert(gamertagLinks).values({ userId: uidB, gamertag: tag.toLowerCase(), status: "verified" }),
    ).rejects.toThrow(/gamertag_links_verified_uniq/);
  });

  it("but two PENDING links differing only in case are still allowed", async () => {
    await db.delete(gamertagLinks).where(eq(gamertagLinks.userId, uidA));
    await db.insert(gamertagLinks).values({ userId: uidA, gamertag: tag, status: "pending" });
    await db.insert(gamertagLinks).values({ userId: uidB, gamertag: `x${tag}`, status: "pending" });
    const rows = await db.select().from(gamertagLinks).where(inArray(gamertagLinks.userId, [uidA, uidB]));
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm --filter @onelife/db run test -- -t "case-insensitive"
```

Expected: FAIL — both inserts succeed, because the indexes are still on the bare column.

- [ ] **Step 4: Apply the migration to the test database**

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate
```

Expected: `0024_gamertag_case_insensitive` applied with no exception raised. If the precheck raises, stop — the test database holds a collision that must be resolved by hand first.

- [ ] **Step 5: Update the drizzle schema to match reality**

In `packages/db/src/schema.ts`, line 74:

```ts
  uniq: uniqueIndex("players_gamertag_uniq").on(sql`lower(${t.gamertag})`),
```

Line 236:

```ts
  uniqVerified: uniqueIndex("gamertag_links_verified_uniq").on(sql`lower(${t.gamertag})`).where(sql`${t.status} = 'verified'`),
```

`sql` is already imported in this file, and `articles_subject_idx` in the same file is an existing precedent for the expression form.

- [ ] **Step 6: Rewrite `createPlayer`'s conflict target as raw SQL**

`onConflictDoUpdate({ target: [players.gamertag] })` no longer matches any unique constraint and would raise *"no unique or exclusion constraint matching the ON CONFLICT specification"*. drizzle 0.36.4 types `IndexColumn = PgColumn`, so the expression target cannot be expressed through the query builder. In `apps/projector/src/pg-store.ts`:

```ts
  async createPlayer(gamertag: string, dayzId: string | null, seenAt: Date): Promise<PlayerRow> {
    // Raw SQL because drizzle 0.36.4's onConflict target accepts columns only (IndexColumn =
    // PgColumn), and players_gamertag_uniq is now an expression index on lower(gamertag).
    // A column target here raises "no unique or exclusion constraint matching the ON CONFLICT
    // specification" on the first concurrent insert.
    const rows = await this.tx.execute(sql`
      INSERT INTO players (gamertag, dayz_id, first_seen_at, last_seen_at)
      VALUES (${gamertag}, ${dayzId}, ${seenAt}, ${seenAt})
      ON CONFLICT (lower(gamertag)) DO UPDATE SET last_seen_at = ${seenAt}
      RETURNING id, gamertag, last_seen_at
    `);
    const row = (rows as unknown as Array<{ id: number; gamertag: string; last_seen_at: Date }>)[0]!;
    return { id: row.id, gamertag: row.gamertag, lastSeenAt: row.last_seen_at };
  }
```

- [ ] **Step 7: Run the full suite**

```bash
pnpm turbo run typecheck && pnpm turbo run test --concurrency=1
```

Expected: all tasks successful. Pay particular attention to `@onelife/projector` — its ingest tests exercise `createPlayer` through the real fold.

- [ ] **Step 8: Commit**

```bash
git add packages/db/drizzle/0024_gamertag_case_insensitive.sql packages/db/drizzle/meta/_journal.json packages/db/src/schema.ts packages/db/test/gamertag-case.test.ts apps/projector/src/pg-store.ts
git commit -m "feat(db): make gamertag uniqueness case-insensitive (0024)

Both unique indexes move to lower(gamertag), with a precheck that names any
collision rather than failing mid-deploy. createPlayer's ON CONFLICT becomes raw
SQL because drizzle 0.36.4 cannot express an expression conflict target."
```

---

### Task 5: Changelog and CLAUDE.md

Required by the repo workflow before a PR can be opened.

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the changelog entry**

Under `## [Unreleased]` → `### Fixed`, in the user-facing voice the file uses (no internal identifiers):

```markdown
- Your gamertag is now recognised whatever its capitalisation. Claiming a name that the game
  logs with different capitals no longer leaves verification stuck forever, and the same name
  in different capitals can no longer become two separate players.
```

- [ ] **Step 2: Update CLAUDE.md**

In the Friends F2 entry, invariant 6 currently opens **"⚠️ OPEN BACKLOG ITEM — `gamertag_links_verified_uniq` is case-SENSITIVE."** Replace that whole invariant with the resolved version:

```markdown
  6. **Gamertag identity is case-insensitive (RESOLVED — was an open backlog item).** Migration
     `0024` moved `players_gamertag_uniq` and `gamertag_links_verified_uniq` onto
     `lower(gamertag)`, closing the hole where two users could verify `Sasha`/`sasha`, fold onto
     one `players` row, and have one receive the other's coordinates as their own dot. Three
     code paths had to change with it, and **each is load-bearing, not tidy-up**:
     the claim route resolves the submitted gamertag to the canonical `players.gamertag` casing
     and stores THAT (`apps/api/src/routes/gamertag-links.ts`) — which is what keeps the ~35
     bare `eq(x.gamertag, …)` comparisons elsewhere correct without touching them, and a
     `lower()` sweep of those would defeat `positions_player_idx` and both partial indexes from
     `0017`; the verifier compares `lower()` in all three of `findPendingChallenges` /
     `getVerifiedLinkId` / `cancelOtherPendingLinks` (a mis-cased claim previously matched no
     emote, so verification silently never completed); and the projector's `getPlayer` resolves
     `lower()` — **without which the new index turns a duplicate row into a 23505 inside the
     fold transaction, which an event-log fold retries forever, stalling every projection.**
     ⚠️ `createPlayer` must keep its **raw-SQL** `ON CONFLICT (lower(gamertag))`: drizzle 0.36.4
     types `IndexColumn = PgColumn`, so an expression conflict target is not expressible through
     the query builder, and a column target fails at RUNTIME ("no unique or exclusion constraint
     matching the ON CONFLICT specification"), not at compile time.
     ⚠️ `players.gamertag` casing is **frozen at first sight** — `getPlayer` finds the row for any
     casing but `touchPlayer` never rewrites it. Rewriting it would desynchronise every
     denormalised copy (`bans.gamertag`, `kills.killerGamertag`, `articles.gamertag`) that those
     bare `eq()` sites read.
     This does NOT merge renames: `players` is still keyed by gamertag, so a genuine rename still
     mints a second row (2 `dayz_id` values span 5 gamertags in production). That is the separate
     identity-merge sub-project, which needs `--rebuild`.
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: changelog + CLAUDE.md for gamertag case-insensitivity"
```

---

## Done

Hand off to the `finishing-a-feature` skill to open the PR into `develop`.

**Deploy note for the PR body:** plain `./deploy/deploy.sh`, **no `--rebuild`** — `0024` changes two indexes and no table shape, and the production audit found zero collisions to collapse. If the migration's precheck raises, the transaction rolls back with nothing changed; resolve the named collision by hand and re-run.
