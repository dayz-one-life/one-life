# Ban by Player ID Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The enforcer writes a banned player's stable DayZ player ID to the Nitrado ban list alongside their gamertag, so renaming no longer sheds the ban.

**Architecture:** `bans` gains a `dayz_id` column, frozen at ban-creation time from the joined `players` row (never resolved later). The Nitrado client gains batched `addBans`/`removeBans` that do one whole-field read-modify-write for a set of entries. The enforcer's apply/expire/lift arms pass `[dayzId, gamertag]` through those batched calls.

**Tech Stack:** TypeScript ESM, Postgres + Drizzle, Vitest, pnpm + turbo.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-22-ban-by-player-id-design.md`.
- **Migrations are hand-written SQL, and `meta/_journal.json` is hand-appended.** Do NOT run `drizzle-kit generate` — the snapshot chain is broken (`meta/` stops at `0014_snapshot.json`), so it diffs against a stale snapshot and emits wrong SQL.
- **The journal `when` value must be unique.** A duplicate makes drizzle-kit silently no-op the migration while reporting success. `0022` used `1785200000000`; use `1785300000000`.
- **`bans` is durable** — absent from `apps/projector/src/rebuild.ts`'s truncate list. This release deploys with a plain `./deploy/deploy.sh`, **no `--rebuild`**.
- **`dayz_id` is nullable everywhere.** A ban with no ID degrades to name-only — today's behaviour, not a regression. Never write `null`, `undefined` or `""` into a ban list.
- `drizzle-kit` reads `DATABASE_URL` and NOT `TEST_DATABASE_URL`. To migrate the test DB: `DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate`.
- Run tests with `TEST_DATABASE_URL` set. Use `--force` on turbo if you changed env, or the cache may replay a stale pass.
- Do not renumber or re-key bans. `bans_server_gamertag_life_uniq` is unchanged.

---

### Task 1: Migration `0023` — `bans.dayz_id` + backfill

**Files:**
- Create: `packages/db/drizzle/0023_bans_dayz_id.sql`
- Modify: `packages/db/drizzle/meta/_journal.json` (append one entry)
- Modify: `packages/db/src/schema.ts` (the `bans` table, ~line 258)
- Test: `packages/db/test/migrations.test.ts` (create if absent)

**Interfaces:**
- Produces: `bans.dayzId` — drizzle column `dayzId: text("dayz_id")`, TypeScript type `string | null`.

- [ ] **Step 1: Write the migration SQL**

Create `packages/db/drizzle/0023_bans_dayz_id.sql`:

```sql
ALTER TABLE "bans" ADD COLUMN "dayz_id" text;
--> statement-breakpoint
UPDATE "bans" b SET "dayz_id" = p."dayz_id"
FROM "players" p
WHERE lower(p."gamertag") = lower(b."gamertag") AND p."dayz_id" IS NOT NULL;
```

The backfill folds case because `players_gamertag_uniq` is case-sensitive and a historical ban may not match byte-for-byte. This is a one-shot backfill over ~60 rows, so index usage does not matter here.

- [ ] **Step 2: Append the journal entry**

In `packages/db/drizzle/meta/_journal.json`, append to `entries` (note `when` is unique — see Global Constraints):

```json
{
  "idx": 23,
  "version": "7",
  "when": 1785300000000,
  "tag": "0023_bans_dayz_id",
  "breakpoints": true
}
```

- [ ] **Step 3: Add the column to the schema**

In `packages/db/src/schema.ts`, in the `bans` table, add after the `gamertag` line:

```ts
  dayzId: text("dayz_id"),                   // stable account hash; null when unknown
```

- [ ] **Step 4: Apply the migration to the test database**

Run: `DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate`
Expected: `migrations applied successfully!`

- [ ] **Step 5: Verify the column exists**

Run:
```bash
psql "$TEST_DATABASE_URL" -c "\d bans" | grep dayz_id
```
Expected: a `dayz_id | text` row.

- [ ] **Step 6: Verify the backfill against real production data**

`packages/db` has no test suite (`vitest run --passWithNoTests`), and a migration runs once, so
the backfill is verified against the restored production dump rather than by a unit test. A
scratch database `onelife_audit` was restored from `onelife-pre-v0.37.2-full.sql` during the
design audit. If it is gone, restore it first:

```bash
docker run --rm --network host -e PGPASSWORD=onelife postgres:16-alpine \
  psql -h localhost -p 5433 -U onelife -d postgres -c "CREATE DATABASE onelife_audit;"
docker run --rm -i --network host -e PGPASSWORD=onelife \
  -v "$PWD/onelife-pre-v0.37.2-full.sql:/d.sql:ro" postgres:16-alpine \
  psql -q -h localhost -p 5433 -U onelife -d onelife_audit -f /d.sql
```

Then apply the migration and check the result:

```bash
DATABASE_URL="postgres://onelife:onelife@localhost:5433/onelife_audit" \
  pnpm --filter @onelife/db run db:migrate

docker run --rm --network host -e PGPASSWORD=onelife postgres:16-alpine psql \
  -h localhost -p 5433 -U onelife -d onelife_audit -c \
  "select count(*) total, count(dayz_id) with_id, count(*)-count(dayz_id) without_id from bans;"
```

Expected: `without_id = 0` — every historical ban's gamertag matches a player. If any row is
null, print them (`select gamertag from bans where dayz_id is null`) and confirm each is a
gamertag with no `players` row, which is legitimate; a null for a gamertag that *does* have a
player row means the case-folding join is wrong and must be fixed before shipping.

- [ ] **Step 7: Commit**

```bash
git add packages/db/drizzle/0023_bans_dayz_id.sql packages/db/drizzle/meta/_journal.json packages/db/src/schema.ts
git commit -m "feat(db): add bans.dayz_id with backfill"
```

---

### Task 2: Batched Nitrado ban-list writes

**Files:**
- Modify: `packages/nitrado/src/client.ts` (after `removeBan`)
- Test: `packages/nitrado/test/bans.test.ts`

**Interfaces:**
- Consumes: existing private `getBans(): Promise<string[]>` and `setBans(names: string[]): Promise<void>`.
- Produces: `addBans(names: string[]): Promise<void>` and `removeBans(names: string[]): Promise<void>` on the Nitrado client class.

**Why batched:** every mutation is a whole-field read-modify-write of one `\r\n`-joined string. Calling the existing single-entry `addBan` twice per ban is two full GET+POST round trips with a lost-update window between them.

- [ ] **Step 1: Write the failing tests**

Add to `packages/nitrado/test/bans.test.ts` (follow the existing file's fake-fetch setup; the assertions below are what matter):

```ts
it("addBans writes both entries in ONE read-modify-write", async () => {
  const { client, calls } = makeClient({ existing: ["Someone"] });
  await client.addBans(["ABC123", "Ronald"]);
  expect(calls.posts).toHaveLength(1);
  expect(calls.posts[0]).toEqual(["Someone", "ABC123", "Ronald"]);
});

it("addBans skips entries already present and does not duplicate", async () => {
  const { client, calls } = makeClient({ existing: ["ABC123"] });
  await client.addBans(["ABC123", "Ronald"]);
  expect(calls.posts).toHaveLength(1);
  expect(calls.posts[0]).toEqual(["ABC123", "Ronald"]);
});

it("addBans issues NO post when every entry is already present", async () => {
  const { client, calls } = makeClient({ existing: ["ABC123", "Ronald"] });
  await client.addBans(["ABC123", "Ronald"]);
  expect(calls.posts).toHaveLength(0);
});

it("removeBans removes both entries in ONE read-modify-write", async () => {
  const { client, calls } = makeClient({ existing: ["Someone", "ABC123", "Ronald"] });
  await client.removeBans(["ABC123", "Ronald"]);
  expect(calls.posts).toHaveLength(1);
  expect(calls.posts[0]).toEqual(["Someone"]);
});

// ⚠️ The natural implementation (filter, then always write) passes every contents-based
// assertion above while rewriting the live ban list on every enforcer tick forever.
it("removeBans issues NO post when nothing was present", async () => {
  const { client, calls } = makeClient({ existing: ["Someone"] });
  await client.removeBans(["ABC123", "Ronald"]);
  expect(calls.posts).toHaveLength(0);
});

it("both ignore empty and blank entries", async () => {
  const { client, calls } = makeClient({ existing: [] });
  await client.addBans(["", "  ", "ABC123"]);
  expect(calls.posts[0]).toEqual(["ABC123"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --root packages/nitrado test/bans.test.ts`
Expected: FAIL — `client.addBans is not a function`.

- [ ] **Step 3: Implement**

In `packages/nitrado/src/client.ts`, after `removeBan`:

```ts
  // ── Batched ban-list mutation. Every mutation is a whole-field read-modify-write of one
  // \r\n-joined string, so a caller needing N entries must NOT loop over addBan/removeBan:
  // that is N round trips with a lost-update window between each. Both methods below do
  // exactly one read and, when something actually changed, exactly one write.
  async addBans(names: string[]): Promise<void> {
    const wanted = names.map((n) => n.trim()).filter((n) => n !== "");
    if (wanted.length === 0) return;
    const bans = await this.getBans();
    const missing = wanted.filter((n) => !bans.includes(n));
    if (missing.length === 0) return;           // nothing to do — do not rewrite the field
    await this.setBans([...bans, ...missing]);
  }

  async removeBans(names: string[]): Promise<void> {
    const doomed = new Set(names.map((n) => n.trim()).filter((n) => n !== ""));
    if (doomed.size === 0) return;
    const bans = await this.getBans();
    const kept = bans.filter((b) => !doomed.has(b));
    if (kept.length === bans.length) return;    // nothing was present — do not rewrite
    await this.setBans(kept);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --root packages/nitrado test/bans.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/nitrado/src/client.ts packages/nitrado/test/bans.test.ts
git commit -m "feat(nitrado): batched addBans/removeBans with no-op write suppression"
```

---

### Task 3: `detect` carries `dayzId` onto the ban row

**Files:**
- Modify: `apps/enforcer/src/decide.ts` (`EndedLife`, `BanPlan`, `planBans`)
- Modify: `apps/enforcer/src/pg-store.ts` (`findEndedUnbannedLives`, `insertBan`)
- Test: `apps/enforcer/test/decide.test.ts`, `apps/enforcer/test/tick.test.ts`

**Interfaces:**
- Consumes: `bans.dayzId` from Task 1.
- Produces: `EndedLife.dayzId: string | null`, `BanPlan.dayzId: string | null`.

- [ ] **Step 1: Write the failing pure test**

Add to `apps/enforcer/test/decide.test.ts`:

```ts
it("carries dayzId from the life onto the plan", () => {
  const life = {
    serverId: 1, gamertag: "Ronald", dayzId: "ABC123",
    startedAt: new Date("2026-07-20T00:00:00Z"),
    endedAt: new Date("2026-07-20T02:00:00Z"),
    deathCause: "pvp", effectivePlaytimeSeconds: 7200, playerKills: [],
  };
  expect(planBans([life], 24)[0]!.dayzId).toBe("ABC123");
});

it("carries a null dayzId through rather than dropping the ban", () => {
  const life = {
    serverId: 1, gamertag: "Ronald", dayzId: null,
    startedAt: new Date("2026-07-20T00:00:00Z"),
    endedAt: new Date("2026-07-20T02:00:00Z"),
    deathCause: "pvp", effectivePlaytimeSeconds: 7200, playerKills: [],
  };
  const plans = planBans([life], 24);
  expect(plans).toHaveLength(1);
  expect(plans[0]!.dayzId).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --root apps/enforcer test/decide.test.ts`
Expected: FAIL — TypeScript error on the unknown `dayzId` property, or `undefined` returned.

- [ ] **Step 3: Add `dayzId` to the types and `planBans`**

In `apps/enforcer/src/decide.ts`, add to `EndedLife` after `gamertag`:

```ts
  dayzId: string | null;
```

add to `BanPlan` after `gamertag`:

```ts
  dayzId: string | null;
```

and in `planBans`'s `plans.push({ ... })`, after `gamertag: life.gamertag,`:

```ts
      dayzId: life.dayzId,
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --root apps/enforcer test/decide.test.ts`
Expected: PASS.

- [ ] **Step 5: Select and persist `dayzId` in the store**

In `apps/enforcer/src/pg-store.ts`, `findEndedUnbannedLives` already does
`.innerJoin(players, eq(players.id, lives.playerId))`. Add `dayzId: players.dayzId` to its
`.select({ ... })`, and in the `out.push({ ... })` add `dayzId: r.dayzId,` after `gamertag`.

In `insertBan`, add to `.values({ ... })` after `gamertag: plan.gamertag,`:

```ts
      dayzId: plan.dayzId,
```

- [ ] **Step 6: Give the existing test seed a `dayz_id`**

⚠️ `apps/enforcer/test/tick.test.ts` uses ONE `beforeAll` seed and its tests run **sequentially,
sharing state** (later tests assert on bans created by earlier ones). Do not add a second
`beforeAll` or truncate mid-file. Modify the existing seed in place.

In its `beforeAll`, change the first player insert to carry an id, and add a third player whose
id is null (used by Task 4's null case):

```ts
  const [p] = await db.insert(players)
    .values({ gamertag: "Steveo12491", dayzId: "ABC123" }).returning();
```

and after the existing `ShortLived` block, add:

```ts
  // A player the ADM never gave an id for — its ban must still be created, and must
  // enforce name-only rather than writing a blank entry to the ban list.
  const [p3] = await db.insert(players).values({ gamertag: "NoIdPlayer" }).returning();
  await db.insert(lives).values({
    serverId, playerId: p3!.id, lifeNumber: 1, startedAt: STARTED, endedAt: ENDED,
    deathCause: "infected", playtimeSeconds: 400, // qualified
  });
```

Adding a third qualified life changes the first test's `detected` count from 1 to 2 and its
`rows` length from 1 to 2. Update those two assertions, and make its `toMatchObject` check target
the right row (`rows.find((r) => r.gamertag === "Steveo12491")`) rather than `rows[0]`.

- [ ] **Step 7: Write the failing DB test**

Add to `apps/enforcer/test/tick.test.ts`, immediately after the first (dry-run) test so it reads
the bans that test created:

```ts
it("freezes dayz_id onto the ban row at detection, and tolerates a null", async () => {
  const rows = await db.select({ gamertag: bans.gamertag, dayzId: bans.dayzId }).from(bans);
  expect(rows.find((r) => r.gamertag === "Steveo12491")!.dayzId).toBe("ABC123");
  // A player with no id still gets a ban — it just enforces by name alone.
  expect(rows.find((r) => r.gamertag === "NoIdPlayer")!.dayzId).toBeNull();
});
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run --root apps/enforcer test/tick.test.ts`
Expected: PASS, including the two updated assertions in the first test.

- [ ] **Step 9: Commit**

```bash
git add apps/enforcer/src/decide.ts apps/enforcer/src/pg-store.ts apps/enforcer/test/
git commit -m "feat(enforcer): freeze dayz_id onto the ban row at detection"
```

---

### Task 4: Enforcer arms write both the ID and the gamertag

**Files:**
- Modify: `apps/enforcer/src/tick.ts` (`BanClient`, all three arms)
- Modify: `apps/enforcer/src/pg-store.ts` (`BanRow`, `pendingBans`, `appliedBans`, `liftPendingBans`)
- Test: `apps/enforcer/test/tick.test.ts`

**Interfaces:**
- Consumes: `addBans`/`removeBans` (Task 2), `bans.dayzId` (Tasks 1 and 3).
- Produces: `banNames(b: { dayzId: string | null; gamertag: string }): string[]` exported from `apps/enforcer/src/decide.ts`.

- [ ] **Step 1: Write the failing pure test**

Add to `apps/enforcer/test/decide.test.ts`:

```ts
it("banNames lists the id first, then the gamertag", () => {
  expect(banNames({ dayzId: "ABC123", gamertag: "Ronald" })).toEqual(["ABC123", "Ronald"]);
});

it("banNames omits a null id rather than emitting a blank entry", () => {
  expect(banNames({ dayzId: null, gamertag: "Ronald" })).toEqual(["Ronald"]);
});

it("banNames omits an empty-string id", () => {
  expect(banNames({ dayzId: "", gamertag: "Ronald" })).toEqual(["Ronald"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --root apps/enforcer test/decide.test.ts`
Expected: FAIL — `banNames is not defined`.

- [ ] **Step 3: Implement `banNames`**

Append to `apps/enforcer/src/decide.ts`:

```ts
/**
 * What goes on the Nitrado ban list for one ban. Pure.
 *
 * The ID is load-bearing — it is the only entry that survives a gamertag rename, which is
 * the whole point of this feature. The gamertag is belt-and-braces at the cost of one line
 * in a text field. A null/blank id degrades to name-only rather than writing an empty entry,
 * which would otherwise land as a stray blank line in the ban list.
 */
export function banNames(b: { dayzId: string | null; gamertag: string }): string[] {
  return [b.dayzId, b.gamertag].filter((n): n is string => typeof n === "string" && n.trim() !== "");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --root apps/enforcer test/decide.test.ts`
Expected: PASS.

- [ ] **Step 5: Carry `dayzId` on `BanRow`**

In `apps/enforcer/src/pg-store.ts`, change the `BanRow` type to:

```ts
export type BanRow = { id: number; serverId: number; gamertag: string; dayzId: string | null; expiresAt: Date | null };
```

and add `dayzId: bans.dayzId,` to the `.select({ ... })` in **all three** of `pendingBans`, `appliedBans` and `liftPendingBans`.

- [ ] **Step 6: Switch the client interface and the three arms**

In `apps/enforcer/src/tick.ts`, change `BanClient` to:

```ts
/** Minimal Nitrado surface the enforcer needs — real client or a fake in tests. */
export interface BanClient {
  addBans(names: string[]): Promise<void>;
  removeBans(names: string[]): Promise<void>;
}
```

Import `banNames`:

```ts
import { planBans, planExpiries, banNames } from "./decide.js";
```

Then in the **apply** arm replace `await deps.nitradoFor(sid).addBan(b.gamertag);` with:

```ts
      await deps.nitradoFor(sid).addBans(banNames(b));
```

and in **both** the **expire** and **lift** arms replace `await deps.nitradoFor(sid).removeBan(b.gamertag);` with:

```ts
      await deps.nitradoFor(sid).removeBans(banNames(b));
```

Leave every `log.info`/`log.error` call, the `markApplied`/`markExpired`/`markLifted`/`markError` calls, the dry-run branches and the counters exactly as they are.

- [ ] **Step 7: Write the failing arm tests**

First update the file's existing `fakeNitrado` helper to the batched interface. Note `calls.add`
and `calls.remove` become **arrays of arrays** — one entry per call — which is what makes the
"single call" assertions meaningful:

```ts
function fakeNitrado() {
  const calls = { add: [] as string[][], remove: [] as string[][] };
  const client: BanClient = {
    async addBans(names) { calls.add.push(names); },
    async removeBans(names) { calls.remove.push(names); },
  };
  return { calls, nitradoFor: (_sid: number) => client };
}
```

The existing dry-run test's `expect(fake.calls.add).toEqual([])` still holds unchanged.

Then extend the file's existing **"enforce mode: applies the pending ban to Nitrado"** test —
which already runs the apply arm over the seeded bans — replacing its `calls.add` assertion with:

```ts
    // One call per ban, each carrying the id first then the gamertag. NoIdPlayer has no id,
    // so it degrades to name-only rather than writing a blank line into the ban list.
    expect(fake.calls.add).toEqual([["ABC123", "Steveo12491"], ["NoIdPlayer"]]);
```

and add, after it:

```ts
it("expire removes the id and the gamertag in a single call per ban", async () => {
  const fake = fakeNitrado();
  // ENDED + 24h has passed, so the applied bans are due.
  await enforcerTick(db, {
    nitradoFor: fake.nitradoFor, dryRun: false, banDurationHours: 24,
    now: new Date("2026-07-13T12:00:00Z"), log,
  });
  expect(fake.calls.remove).toContainEqual(["ABC123", "Steveo12491"]);
  expect(fake.calls.remove).toContainEqual(["NoIdPlayer"]);
});

it("lift removes the id and the gamertag in a single call", async () => {
  const [p] = await db.insert(players)
    .values({ gamertag: "Redeemer", dayzId: "XYZ789" }).returning();
  await db.insert(bans).values({
    serverId, gamertag: "Redeemer", dayzId: "XYZ789",
    lifeStartedAt: STARTED, reason: "qualified_death", bannedAt: ENDED,
    expiresAt: new Date("2026-07-30T00:00:00Z"), status: "lift_pending", dryRun: false,
  });
  const fake = fakeNitrado();
  await enforcerTick(db, {
    nitradoFor: fake.nitradoFor, dryRun: false, banDurationHours: 24,
    now: new Date("2026-07-13T13:00:00Z"), log,
  });
  expect(fake.calls.remove).toContainEqual(["XYZ789", "Redeemer"]);
  void p;
});
```

⚠️ Use `toContainEqual`, not `toEqual`, on the expire/lift assertions: these tests run against
whatever bans earlier tests left behind, so asserting the exact full array couples them to test
ordering. The apply assertion above can use `toEqual` because it runs immediately after the
dry-run test, whose bans are the only ones pending at that point.

- [ ] **Step 8: Run to verify they pass**

Run: `npx vitest run --root apps/enforcer test/tick.test.ts`
Expected: PASS. Every pre-existing test in this file must also still pass — if one fails, its fake still uses `addBan`/`removeBan` and needs updating to the batched interface.

- [ ] **Step 9: Verify nothing else implements `BanClient`**

Run: `grep -rn "addBan\|removeBan" apps packages --include='*.ts' | grep -v node_modules`
Expected: only `packages/nitrado/src/client.ts` (which keeps the single-entry `addBan`/`removeBan` for other callers), the enforcer's batched calls, and tests. If any other production caller of the enforcer's `BanClient` appears, update it.

- [ ] **Step 10: Full gates**

Run:
```bash
npx turbo run typecheck --concurrency=1 --force
npx turbo run test --concurrency=1 --force
```
Expected: all tasks pass.

- [ ] **Step 11: Commit**

```bash
git add apps/enforcer/src/tick.ts apps/enforcer/src/pg-store.ts apps/enforcer/src/decide.ts apps/enforcer/test/
git commit -m "feat(enforcer): ban the player ID alongside the gamertag"
```

---

### Task 5: Changelog and CLAUDE.md

**Files:**
- Modify: `CHANGELOG.md` (the `Unreleased` → `Fixed` group)
- Modify: `CLAUDE.md` (the SP3 enforcer sub-project entry)

- [ ] **Step 1: Add the changelog entry**

Under `## [Unreleased]` → `### Fixed` in `CHANGELOG.md`:

```markdown
- Changing your gamertag no longer sheds a death ban. Bans are now placed against the
  player's stable account ID as well as their name, so a rename keeps the ban in force.
```

- [ ] **Step 2: Update CLAUDE.md**

In the **SP3 — Death-ban enforcement** entry, append:

```markdown
  **⚠️ Bans are placed against `bans.dayz_id` (the stable DayZ account hash) AND the gamertag,
  via the batched `addBans`/`removeBans` — never the single-entry `addBan`/`removeBan`, which
  would be one whole-field read-modify-write of the Nitrado ban list per entry, with a
  lost-update window between them.** The ID is what survives a gamertag rename: an audit of
  production found two accounts using five gamertags between them and 22 connections under a
  different name during an active ban window. `dayz_id` is frozen onto the ban row at creation
  (migration `0023`), never resolved through `players` later, because the deferred identity-merge
  work will make a historical gamertag stop resolving. A null `dayz_id` degrades to name-only.
  Nitrado's ban list accepting a player ID was **verified empirically** against a live server —
  public documentation says console servers are gamertag-only, and is wrong.
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: changelog + CLAUDE.md for ban-by-player-id"
```

---

## Deferred (do NOT build in this plan)

Recorded so an implementer does not "helpfully" add them — each was considered and declined in the spec:

- **A gamertag alias table, per-tick alias reconciliation, multi-alias ban writes.** Unnecessary once the ID is banned.
- **Extending a ban by 24h per rename detected during it.** Would only ever fire on innocent renames once evasion is impossible.
- **Merging the split player identities.** Real, but data-quality rather than security; separate release, needs `--rebuild`.
- **Gamertag case-sensitivity changes.** Audited: zero occurrences in production.
- **Reconciling already-`applied` bans.** In-flight bans stay name-only until they expire; accepted in spec §7.
