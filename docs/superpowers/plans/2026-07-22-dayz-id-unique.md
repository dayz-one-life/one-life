# Promote `players.dayz_id` to Unique (0026) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the non-unique `players_dayz_id_idx` with a unique index, so the identity invariant (one player row per account hash) is enforced by the schema, not only upheld by the fold.

**Architecture:** Migration `0026` runs a precheck (aborts naming any duplicate hash), drops the non-unique index, and creates `players_dayz_id_uniq`. The schema declaration follows. `createPlayer` is untouched — the unique index is a backstop, not a conflict target.

**Tech Stack:** TypeScript/ESM, pnpm + turbo monorepo, Postgres 16, drizzle-orm 0.36.4, vitest.

**Spec:** `docs/superpowers/specs/2026-07-22-dayz-id-unique-design.md`

## Global Constraints

- **Release two of two.** This is only safe because release one (`0025`, shipped v0.42.2) re-folded production and collapsed the duplicate hashes — verified `SELECT dayz_id, count(*) FROM players GROUP BY 1 HAVING count(*) > 1` returns zero rows on the live database.
- **`players.dayz_id` stays NULLABLE.** Postgres unique indexes are nulls-distinct by default; the theoretical null rows the fold permits are allowed and do not collide. Do NOT add `NOT NULL` and do NOT use `NULLS NOT DISTINCT`.
- **`createPlayer` stays a plain `INSERT`.** Do NOT add `ON CONFLICT (dayz_id)` — that would reintroduce the silent-attribution hazard `0025` removed. The unique index is a loud-fail backstop only.
- **Migration is hand-written SQL with a hand-appended `meta/_journal.json` entry.** The drizzle snapshot chain is broken (`meta/` stops at `0014_snapshot.json`), so `drizzle-kit generate` emits wrong SQL — never run it. Follow `0018`–`0025`. Use `when: 1785600000000` (verified unique and greater than `0025`'s `1785500000000`). `meta/_journal.json` has no trailing newline — keep it byte-clean.
- **Plain `CREATE UNIQUE INDEX`, not `CONCURRENTLY`.** The table is ~120 rows and `deploy.sh` stops the fleet before migrate; `CONCURRENTLY` also cannot run in a transaction, forfeiting the precheck roll-back.
- Every test proven **red before** its fix. Commit after each task.

## Prerequisites

```bash
docker compose up -d postgres
docker ps --format '{{.Names}} {{.Ports}}'      # this clone maps 5433; 5432 is a DIFFERENT project
export TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5433/onelife_test"
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate
```

`drizzle-kit` reads `DATABASE_URL` and nothing else — **not** `TEST_DATABASE_URL`. Export it explicitly or you will silently migrate the wrong database and report success.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/db/drizzle/0026_dayz_id_unique.sql` | Precheck + drop non-unique + create unique | 1 |
| `packages/db/drizzle/meta/_journal.json` | Hand-appended entry | 1 |
| `packages/db/src/schema.ts` | `byDayzId` index → `uniqDayzId` unique index | 1 |
| `packages/read-models/test/player-identity.test.ts` | Unique-violation, nulls-allowed, lookup tests | 1 |
| `CHANGELOG.md`, `CLAUDE.md` | Release + architecture notes | 2 |

---

### Task 1: Migration 0026 + schema + tests

**Files:**
- Create: `packages/db/drizzle/0026_dayz_id_unique.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/db/src/schema.ts` (the `players` index block, `byDayzId` line)
- Test: `packages/read-models/test/player-identity.test.ts` (extend)

**Interfaces:**
- Consumes: the `players` table and `player_gamertags` from `0025`.
- Produces: unique index `players_dayz_id_uniq` on `players (dayz_id)`; the non-unique `players_dayz_id_idx` is gone.

- [ ] **Step 1: Write the migration**

Create `packages/db/drizzle/0026_dayz_id_unique.sql`:

```sql
DO $$
DECLARE dupes text;
BEGIN
  SELECT string_agg(dayz_id, ', ') INTO dupes
  FROM (SELECT dayz_id FROM players WHERE dayz_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1) x;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'players has duplicate dayz_id values, resolve by hand (or rebuild) first: %', dupes;
  END IF;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "players_dayz_id_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "players_dayz_id_uniq" ON "players" USING btree ("dayz_id");
```

The precheck excludes NULLs (`WHERE dayz_id IS NOT NULL`) — nulls are nulls-distinct under the unique index and never collide, so they are not "duplicates" to abort on.

Append to the `entries` array in `packages/db/drizzle/meta/_journal.json`, after the `0025` entry (mind the missing trailing newline):

```json
    {
      "idx": 26,
      "version": "7",
      "when": 1785600000000,
      "tag": "0026_dayz_id_unique",
      "breakpoints": true
    }
```

- [ ] **Step 2: Write the failing tests**

Append to `packages/read-models/test/player-identity.test.ts` a new describe block. It follows the file's existing idiom: a random `tag` suffix, direct inserts, and `afterAll` cleanup by gamertag. Add its own cleanup so it does not leak rows.

```ts
describe("players_dayz_id_uniq", () => {
  const dtag = `Dz${Math.floor(Math.random() * 1e8)}`;

  afterAll(async () => {
    await db.delete(players).where(inArray(players.gamertag, [`${dtag}A`, `${dtag}B`, `${dtag}N1`, `${dtag}N2`]));
  });

  it("rejects a second players row with the same dayz_id", async () => {
    await db.insert(players).values({ gamertag: `${dtag}A`, dayzId: `HASH-${dtag}`, firstSeenAt: new Date(), lastSeenAt: new Date() });
    await expect(
      db.insert(players).values({ gamertag: `${dtag}B`, dayzId: `HASH-${dtag}`, firstSeenAt: new Date(), lastSeenAt: new Date() }),
    ).rejects.toThrow(/players_dayz_id_uniq/);
  });

  it("still allows two rows with a NULL dayz_id (nulls-distinct)", async () => {
    await db.insert(players).values({ gamertag: `${dtag}N1`, dayzId: null, firstSeenAt: new Date(), lastSeenAt: new Date() });
    await db.insert(players).values({ gamertag: `${dtag}N2`, dayzId: null, firstSeenAt: new Date(), lastSeenAt: new Date() });
    const rows = await db.select().from(players).where(inArray(players.gamertag, [`${dtag}N1`, `${dtag}N2`]));
    expect(rows).toHaveLength(2);
  });
});
```

Confirm `afterAll`, `inArray`, and `players` are imported at the top of the file (they are used by the existing blocks — verify rather than assume; add any that are missing).

- [ ] **Step 3: Run the tests to verify they fail**

```bash
pnpm --filter @onelife/read-models run test -- -t "players_dayz_id_uniq"
```

Expected: the first test FAILS — the insert succeeds because the pre-`0026` index is non-unique, so `.rejects.toThrow` gets no rejection. The second passes (nulls are already allowed).

- [ ] **Step 4: Apply the migration to the test database**

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate
```

Expected: `0026_dayz_id_unique` applies with no exception. If the precheck raises, the test database holds a duplicate `dayz_id` that must be resolved by hand first — do not force past it.

- [ ] **Step 5: Update the drizzle schema to match**

In `packages/db/src/schema.ts`, in the `players` index block, replace the `byDayzId` line and its two-line comment:

```ts
  // No unique here — the duplicates still exist at migrate time (deploy.sh migrates
  // before it rebuilds). Promoting this to unique is migration 0026, next release.
  byDayzId: index("players_dayz_id_idx").on(t.dayzId),
```

with:

```ts
  // Identity is one players row per account hash — enforced here since 0026 (v0.42.x), after
  // the 0025 rebuild collapsed the historical duplicates. Nulls-distinct: a null dayz_id (never
  // observed) is allowed and does not collide. This also serves getPlayerByDayzId's eq() lookup.
  uniqDayzId: uniqueIndex("players_dayz_id_uniq").on(t.dayzId),
```

`uniqueIndex` is already imported in this file (used by other tables). Leave `byGamertag` and its comment unchanged.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm --filter @onelife/read-models run test -- -t "players_dayz_id_uniq"
```

Expected: both PASS.

- [ ] **Step 7: Confirm `getPlayerByDayzId` still resolves through the new index**

This is a behavioural check that the swap lost no lookup coverage — the projector suite exercises `getPlayerByDayzId` via the fold. Run it:

```bash
pnpm --filter @onelife/projector run test
```

Expected: PASS (the fold's identity-resolution tests still resolve a player by hash — the unique index serves `eq(players.dayzId, …)` exactly as the dropped non-unique one did).

- [ ] **Step 8: Run the full forced suite**

```bash
pnpm turbo run typecheck --force && pnpm turbo run test --force --concurrency=1
```

Expected: 23/23 both. Use `--force` — a stale turbo cache has reported green in this repo without executing anything.

- [ ] **Step 9: Commit**

```bash
git add packages/db/drizzle/0026_dayz_id_unique.sql packages/db/drizzle/meta/_journal.json packages/db/src/schema.ts packages/read-models/test/player-identity.test.ts
git commit -m "feat(db): promote players.dayz_id to unique (0026)

Enforces one players row per account hash at the schema level, now that the
0025 rebuild collapsed the historical duplicates in production. Swaps the
non-unique players_dayz_id_idx for players_dayz_id_uniq; nulls stay distinct
and createPlayer stays a plain INSERT (the index is a backstop, not a target)."
```

---

### Task 2: Changelog and CLAUDE.md

**Files:** `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: Changelog**

Under `## [Unreleased]` → `### Fixed`, in the file's user-facing voice (no identifiers, paths, or migration numbers):

```markdown
- The one-player-per-account guarantee behind the gamertag-identity change is now enforced by
  the database itself, closing the gap where it was only maintained while data was being
  processed.
```

- [ ] **Step 2: CLAUDE.md**

Find the identity-merge entry (search `player_gamertags` / `players.dayz_id is NOT YET UNIQUE`). It currently contains a `⚠️` line stating `players.dayz_id` is NOT yet unique and that `0026` next release promotes it. Update it to record the promotion as done:

- `players.dayz_id` is now **unique** (`players_dayz_id_uniq`, migration `0026`), nulls-distinct — one players row per known account hash, enforced by the schema. The non-unique `players_dayz_id_idx` was dropped; the unique index serves `getPlayerByDayzId`'s lookup.
- `createPlayer` remains a plain `INSERT`: the unique index is a **backstop** (a race the single-instance transactional hash-first fold cannot actually produce would fail loudly rather than duplicate), NOT an `ON CONFLICT` target — adding one would reintroduce the silent-attribution hazard `0025` removed.
- The two-release sequence is complete: `0025` (identity + rebuild, v0.42.x) then `0026` (unique).

Verify every claim against the shipped `0026` SQL and `schema.ts` before committing.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: changelog + CLAUDE.md for the dayz_id unique promotion"
```

---

## Done

Hand off to `finishing-a-feature`.

**PR body must carry:** deploy is a plain `./deploy/deploy.sh`, **no `--rebuild`** — `0026` adds only an index and changes no projection-table shape, so it carries none of the rebuild-before-migrate ordering hazard that broke v0.42.1. If the precheck raises, the transaction rolls back with nothing changed (not expected — production is confirmed clean). This completes the identity-merge sequence.
