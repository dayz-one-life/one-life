# Identity Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `players.dayz_id` the durable identity, so a gamertag rename resolves to one player instead of minting a second, and a recycled gamertag resolves to a different person.

**Architecture:** The fold resolves a connect by account hash first and gamertag second, recording every name in a new `player_gamertags` projection table. No migration merges anything — `rebuildAll` truncates `players … CASCADE` and re-folds from event 0, so the duplicates collapse as a consequence of the new resolution rule. Player-scoped stats stop matching gamertag text and match the `killer_player_id`/`victim_player_id` foreign keys the fold already populates.

**Tech Stack:** TypeScript/ESM, pnpm + turbo monorepo, Postgres 16, drizzle-orm 0.36.4, vitest, Next.js 15, Fastify.

**Spec:** `docs/superpowers/specs/2026-07-22-identity-merge-design.md`

## Global Constraints

- **Migration `0025` is hand-written SQL with a hand-appended `meta/_journal.json` entry.** The drizzle snapshot chain is broken (`meta/` stops at `0014_snapshot.json`), so `drizzle-kit generate` diffs a stale snapshot and emits wrong SQL. Follow `0018`–`0024`. Use `when: 1785500000000` — verify it is unique and greater than `0024`'s `1785400000000` before trusting it. **A duplicate `when` makes drizzle-kit silently no-op the migration while reporting success.** `meta/_journal.json` has no trailing newline; keep it byte-clean.
- **`players.dayz_id` must NOT become unique in this release.** The duplicates still exist when the migrate phase runs — `deploy.sh` migrates before it rebuilds. A plain index only; the unique promotion is migration `0026` in the following release.
- **`players.gamertag` now tracks a rename** (most recently seen name). This is a deliberate, narrow reversal of `0024`'s rule, which governed **casing** only. Do not "restore" the frozen-casing behaviour for renames, and do not extend this to casing.
- **`player_gamertags` gets NO global unique on `gamertag`.** Recycling is 0 today but real on Xbox; a global unique would crash the ingest the day it happens. Uniqueness is per player: `(player_id, lower(gamertag))`.
- **`player_gamertags` is a projection.** It MUST be added to the truncate list in `apps/projector/src/rebuild.ts`, or a rebuild leaves it stale forever.
- **Do NOT change** `packages/read-models/src/player-articles.ts`, `leaderboards.ts`, or `obituaries.ts` — deferred to a later sub-project (spec §9).
- Every test proven **red before** its fix. Commit after each task.

## Prerequisites

```bash
docker compose up -d postgres
docker ps --format '{{.Names}} {{.Ports}}'     # this clone maps 5433; 5432 is a DIFFERENT project
export TEST_DATABASE_URL="postgres://onelife:onelife@localhost:5433/onelife_test"
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate
```

`drizzle-kit` reads `DATABASE_URL` and nothing else — **not** `TEST_DATABASE_URL`. Export it explicitly or you will silently migrate the wrong database and report success.

Use `--force` on any full `turbo run test`: a stale cache has previously reported green in this repo without executing anything.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/db/drizzle/0025_player_identity.sql` | `player_gamertags`, `players.dayz_id` index, two FK indexes | 1 |
| `packages/db/drizzle/meta/_journal.json` | Hand-appended entry | 1 |
| `packages/db/src/schema.ts` | `playerGamertags` table + new indexes | 1 |
| `apps/projector/src/rebuild.ts` | `player_gamertags` joins the truncate list | 1 |
| `packages/projections/src/store.ts` | `ProjectionStore` gains two methods | 2 |
| `packages/projections/src/fold.ts` | Hash-first resolution + alias recording | 2 |
| `packages/projections/src/memory-store.ts` | In-memory implementations | 2 |
| `apps/projector/src/pg-store.ts` | Postgres implementations | 2 |
| `packages/read-models/src/player-aggregate.ts` | `resolveSlugMatch` + alias-aware `resolveGamertagBySlug` | 3 |
| `apps/web/src/app/players/[slug]/page.tsx` | 308 redirect from an alias slug | 4 |
| `packages/read-models/src/{queries,player-aggregate,player-page,player-kills,player-priors,life-dossier,life-track,survivors,qualified-lives}.ts` | Stats key on the FK | 5 |
| `packages/tokens/src/redeem.ts`, `packages/read-models/src/player-page.ts`, `apps/api/src/routes/life-track.ts` | Ownership via identity | 6 |
| `CHANGELOG.md`, `CLAUDE.md` | Release + architecture notes | 7 |

---

### Task 1: Migration 0025, schema, and the rebuild truncate list

**Files:**
- Create: `packages/db/drizzle/0025_player_identity.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/db/src/schema.ts`
- Modify: `apps/projector/src/rebuild.ts:8-11`
- Test: `packages/read-models/test/player-identity.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: table `player_gamertags(id bigserial pk, player_id bigint not null → players.id, gamertag text not null, first_seen_at timestamptz not null, last_seen_at timestamptz not null)`; drizzle export `playerGamertags` with columns `id, playerId, gamertag, firstSeenAt, lastSeenAt`.

- [ ] **Step 1: Write the migration**

Create `packages/db/drizzle/0025_player_identity.sql`:

```sql
CREATE TABLE IF NOT EXISTS "player_gamertags" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "player_id" bigint NOT NULL REFERENCES "players"("id") ON DELETE CASCADE,
  "gamertag" text NOT NULL,
  "first_seen_at" timestamp with time zone NOT NULL,
  "last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "player_gamertags_player_name_uniq" ON "player_gamertags" USING btree ("player_id", lower("gamertag"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_gamertags_name_idx" ON "player_gamertags" USING btree (lower("gamertag"), "last_seen_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "players_dayz_id_idx" ON "players" USING btree ("dayz_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kills_killer_player_idx" ON "kills" USING btree ("server_id", "killer_player_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hit_events_victim_player_idx" ON "hit_events" USING btree ("server_id", "victim_player_id");
```

There is deliberately **no unique index on `players.dayz_id`** — the duplicates still exist at migrate time. That promotion is `0026`, next release.

Append to the `entries` array in `packages/db/drizzle/meta/_journal.json`, after `0024`:

```json
    {
      "idx": 25,
      "version": "7",
      "when": 1785500000000,
      "tag": "0025_player_identity",
      "breakpoints": true
    }
```

- [ ] **Step 2: Add the table to the drizzle schema**

In `packages/db/src/schema.ts`, after the `players` table declaration:

```ts
export const playerGamertags = pgTable("player_gamertags", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  playerId: bigint("player_id", { mode: "number" }).notNull().references(() => players.id, { onDelete: "cascade" }),
  gamertag: text("gamertag").notNull(),          // exactly as the ADM reported it
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
}, (t) => ({
  // Per PLAYER, never global: a recycled gamertag legitimately belongs to two identities
  // over time, and a global unique would crash the ingest the day that happens.
  uniqPerPlayer: uniqueIndex("player_gamertags_player_name_uniq").on(t.playerId, sql`lower(${t.gamertag})`),
  byName: index("player_gamertags_name_idx").on(sql`lower(${t.gamertag})`, t.lastSeenAt.desc()),
}));
```

Add the two new stat indexes to the existing `kills` and `hitEvents` index blocks:

```ts
  byKillerPlayer: index("kills_killer_player_idx").on(t.serverId, t.killerPlayerId),
```

```ts
  byVictimPlayer: index("hit_events_victim_player_idx").on(t.serverId, t.victimPlayerId),
```

And to the `players` index block:

```ts
  byDayzId: index("players_dayz_id_idx").on(t.dayzId),
```

- [ ] **Step 3: Add the table to the rebuild truncate list**

`apps/projector/src/rebuild.ts`, in `rebuildAll`:

```ts
  await db.execute(sql`TRUNCATE TABLE
    positions, build_events, hit_events, kills, sessions, lives, player_gamertags, players
    RESTART IDENTITY CASCADE`);
```

`player_gamertags` is a projection, not durable data. Omitting it here leaves it stale through every future rebuild.

- [ ] **Step 4: Write the failing test**

Create `packages/read-models/test/player-identity.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { players, playerGamertags } from "@onelife/db";
import { inArray, eq } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const tag = `Ident${Math.floor(Math.random() * 1e8)}`;

afterAll(async () => {
  await db.delete(players).where(inArray(players.gamertag, [tag, `${tag}Renamed`]));
  await sql.end();
});

describe("player_gamertags", () => {
  it("records more than one name for one player", async () => {
    const [p] = await db.insert(players)
      .values({ gamertag: tag, dayzId: `H=${tag}`, firstSeenAt: new Date(), lastSeenAt: new Date() })
      .returning();
    await db.insert(playerGamertags).values([
      { playerId: p!.id, gamertag: tag, firstSeenAt: new Date("2026-07-01T00:00:00Z"), lastSeenAt: new Date("2026-07-02T00:00:00Z") },
      { playerId: p!.id, gamertag: `${tag}Renamed`, firstSeenAt: new Date("2026-07-03T00:00:00Z"), lastSeenAt: new Date("2026-07-04T00:00:00Z") },
    ]);
    const rows = await db.select().from(playerGamertags).where(eq(playerGamertags.playerId, p!.id));
    expect(rows).toHaveLength(2);
  });

  it("rejects the same name twice for ONE player, case-insensitively", async () => {
    const [p] = await db.select().from(players).where(eq(players.gamertag, tag));
    await expect(
      db.insert(playerGamertags).values({
        playerId: p!.id, gamertag: tag.toLowerCase(),
        firstSeenAt: new Date(), lastSeenAt: new Date(),
      }),
    ).rejects.toThrow(/player_gamertags_player_name_uniq/);
  });

  it("ALLOWS the same name under two different players (gamertag recycling)", async () => {
    // Not hypothetical: Xbox releases and reissues gamertags. A global unique here would
    // crash the ingest the first time it happened.
    const [other] = await db.insert(players)
      .values({ gamertag: `${tag}Other`, dayzId: `H2=${tag}`, firstSeenAt: new Date(), lastSeenAt: new Date() })
      .returning();
    await db.insert(playerGamertags).values({
      playerId: other!.id, gamertag: tag, firstSeenAt: new Date(), lastSeenAt: new Date(),
    });
    const rows = await db.select().from(playerGamertags).where(eq(playerGamertags.gamertag, tag));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    await db.delete(players).where(eq(players.id, other!.id));
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

```bash
pnpm --filter @onelife/read-models run test -- -t "player_gamertags"
```

Expected: FAIL — `relation "player_gamertags" does not exist`.

- [ ] **Step 6: Apply the migration and re-run**

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate
pnpm --filter @onelife/read-models run test -- -t "player_gamertags"
```

Expected: `0025_player_identity` applies, then PASS.

- [ ] **Step 7: Pin that a rebuild truncates the new table**

A projection that is not in the truncate list goes stale silently, forever. Add to
`apps/projector/test/rebuild.test.ts`, following that file's existing setup:

```ts
  it("truncates player_gamertags — it is a projection, not durable data", async () => {
    const [p] = await db.insert(players)
      .values({ gamertag: `RB${Date.now()}`, dayzId: `RB=${Date.now()}`, firstSeenAt: new Date(), lastSeenAt: new Date() })
      .returning();
    await db.insert(playerGamertags).values({
      playerId: p!.id, gamertag: p!.gamertag, firstSeenAt: new Date(), lastSeenAt: new Date(),
    });
    await rebuildAll(db, `rb-test-${p!.id}`);
    const rows = await db.select().from(playerGamertags);
    expect(rows).toHaveLength(0);
  });
```

Run it, and confirm it **fails** against a truncate list without `player_gamertags` before
keeping the Step 3 edit — revert that line temporarily to observe the red if you have already
applied it.

- [ ] **Step 8: Commit**

```bash
git add packages/db/drizzle/0025_player_identity.sql packages/db/drizzle/meta/_journal.json packages/db/src/schema.ts apps/projector/src/rebuild.ts packages/read-models/test/player-identity.test.ts apps/projector/test/rebuild.test.ts
git commit -m "feat(db): player_gamertags alias table + identity indexes (0025)

No unique on players.dayz_id yet — the duplicates still exist at migrate time,
because deploy.sh migrates before it rebuilds. That lands in 0026."
```

---

### Task 2: The fold resolves by account hash

**Files:**
- Modify: `packages/projections/src/store.ts`
- Modify: `packages/projections/src/fold.ts:28-36`
- Modify: `packages/projections/src/memory-store.ts`
- Modify: `apps/projector/src/pg-store.ts`
- Test: `packages/projections/test/fold-identity.test.ts` (create)

**Interfaces:**
- Consumes: `playerGamertags` from Task 1.
- Produces: two `ProjectionStore` methods —
  `getPlayerByDayzId(dayzId: string): Promise<PlayerRow | null>` and
  `recordGamertag(playerId: number, gamertag: string, seenAt: Date): Promise<void>`.
  `recordGamertag` upserts the alias row (extending `last_seen_at`) **and** sets
  `players.gamertag` to that name.

- [ ] **Step 1: Write the failing test**

Create `packages/projections/test/fold-identity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { MemoryStore } from "../src/index.js";

describe("identity resolution", () => {
  it("a rename resolves to ONE player and records both names", async () => {
    const s = new MemoryStore();
    const first = await s.createPlayer("OldName", "HASH-A", new Date("2026-07-01T00:00:00Z"));
    await s.recordGamertag(first.id, "OldName", new Date("2026-07-01T00:00:00Z"));

    const found = await s.getPlayerByDayzId("HASH-A");
    expect(found).not.toBeNull();
    expect(found!.id).toBe(first.id);

    await s.recordGamertag(first.id, "NewName", new Date("2026-07-05T00:00:00Z"));
    const after = await s.getPlayerById(first.id);
    expect(after!.gamertag).toBe("NewName");           // current name follows the rename
    expect(await s.gamertagsFor(first.id)).toEqual(["OldName", "NewName"]);
  });

  it("a RECYCLED gamertag resolves to a DIFFERENT player", async () => {
    // The inverse of the rename case, and the one a gamertag-keyed fold gets wrong.
    const s = new MemoryStore();
    const a = await s.createPlayer("Shared", "HASH-A", new Date("2026-07-01T00:00:00Z"));
    const b = await s.createPlayer("Shared2", "HASH-B", new Date("2026-07-02T00:00:00Z"));
    expect(await s.getPlayerByDayzId("HASH-A")).toMatchObject({ id: a.id });
    expect(await s.getPlayerByDayzId("HASH-B")).toMatchObject({ id: b.id });
    expect(a.id).not.toBe(b.id);
  });

  it("returns null for an unknown hash rather than guessing", async () => {
    const s = new MemoryStore();
    expect(await s.getPlayerByDayzId("NOPE")).toBeNull();
  });

  it("a repeat connect under the same name extends last_seen_at, it does not duplicate", async () => {
    const s = new MemoryStore();
    const p = await s.createPlayer("Steady", "HASH-C", new Date("2026-07-01T00:00:00Z"));
    await s.recordGamertag(p.id, "Steady", new Date("2026-07-01T00:00:00Z"));
    await s.recordGamertag(p.id, "Steady", new Date("2026-07-09T00:00:00Z"));
    expect(await s.gamertagsFor(p.id)).toEqual(["Steady"]);
    const row = s.aliases.find((a) => a.playerId === p.id)!;
    expect(row.firstSeenAt.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(row.lastSeenAt.toISOString()).toBe("2026-07-09T00:00:00.000Z");
  });

  it("an out-of-order replay does not rewind last_seen_at", async () => {
    const s = new MemoryStore();
    const p = await s.createPlayer("Steady", "HASH-D", new Date("2026-07-01T00:00:00Z"));
    await s.recordGamertag(p.id, "Steady", new Date("2026-07-09T00:00:00Z"));
    await s.recordGamertag(p.id, "Steady", new Date("2026-07-02T00:00:00Z"));
    expect(s.aliases.find((a) => a.playerId === p.id)!.lastSeenAt.toISOString())
      .toBe("2026-07-09T00:00:00.000Z");
  });
});
```

The last two matter because the Postgres implementation uses `GREATEST(...)` for exactly this
reason; without them the memory store could drift from it and the fold tests would not notice.

`gamertagsFor(playerId): Promise<string[]>` is a MemoryStore-only test helper returning names in first-seen order — add it to `MemoryStore`, not to the `ProjectionStore` interface.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @onelife/projections run test -- -t "identity resolution"
```

Expected: FAIL — `s.recordGamertag is not a function`.

- [ ] **Step 3: Extend the store interface**

In `packages/projections/src/store.ts`, add to `ProjectionStore`:

```ts
  /** Resolve a player by their stable DayZ account hash. The identity lookup. */
  getPlayerByDayzId(dayzId: string): Promise<PlayerRow | null>;
  /**
   * Record that `playerId` was seen under `gamertag`, and make it their current name.
   * Idempotent: a repeat connect under the same name only extends last_seen_at.
   */
  recordGamertag(playerId: number, gamertag: string, seenAt: Date): Promise<void>;
```

- [ ] **Step 4: Implement in MemoryStore**

In `packages/projections/src/memory-store.ts`:

```ts
  aliases: { playerId: number; gamertag: string; firstSeenAt: Date; lastSeenAt: Date }[] = [];

  async getPlayerByDayzId(dayzId: string): Promise<PlayerRow | null> {
    return this.players.find((p) => (p as { dayzId?: string | null }).dayzId === dayzId) ?? null;
  }

  async recordGamertag(playerId: number, gamertag: string, seenAt: Date): Promise<void> {
    const want = gamertag.toLowerCase();
    const row = this.aliases.find((a) => a.playerId === playerId && a.gamertag.toLowerCase() === want);
    if (row) { if (seenAt > row.lastSeenAt) row.lastSeenAt = seenAt; }
    else this.aliases.push({ playerId, gamertag, firstSeenAt: seenAt, lastSeenAt: seenAt });
    const p = this.players.find((x) => x.id === playerId);
    if (p) p.gamertag = gamertag;
  }

  /** Test helper — names in first-seen order. Not part of ProjectionStore. */
  async gamertagsFor(playerId: number): Promise<string[]> {
    return this.aliases.filter((a) => a.playerId === playerId)
      .sort((x, y) => x.firstSeenAt.getTime() - y.firstSeenAt.getTime())
      .map((a) => a.gamertag);
  }
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @onelife/projections run test -- -t "identity resolution"
```

Expected: PASS.

- [ ] **Step 6: Implement in the Postgres store**

In `apps/projector/src/pg-store.ts`, importing `playerGamertags` from `@onelife/db`:

```ts
  async getPlayerByDayzId(dayzId: string): Promise<PlayerRow | null> {
    const r = await this.tx.select().from(players).where(eq(players.dayzId, dayzId)).limit(1);
    return r[0] ? { id: r[0].id, gamertag: r[0].gamertag, lastSeenAt: r[0].lastSeenAt } : null;
  }

  async recordGamertag(playerId: number, gamertag: string, seenAt: Date): Promise<void> {
    // Raw SQL for the same reason as createPlayer: drizzle 0.36.4 types IndexColumn = PgColumn,
    // so an expression conflict target (lower(gamertag)) cannot be expressed through the
    // query builder, and a column target fails at RUNTIME rather than compile time.
    const at = seenAt.toISOString();
    await this.tx.execute(sql`
      INSERT INTO player_gamertags (player_id, gamertag, first_seen_at, last_seen_at)
      VALUES (${playerId}, ${gamertag}, ${at}, ${at})
      ON CONFLICT (player_id, lower(gamertag))
      DO UPDATE SET last_seen_at = GREATEST(player_gamertags.last_seen_at, ${at})
    `);
    await this.tx.update(players).set({ gamertag }).where(eq(players.id, playerId));
  }
```

- [ ] **Step 7: Wire the fold to resolve by hash first**

In `packages/projections/src/fold.ts`, replace the resolution in `onConnected` (currently lines 31-36):

```ts
  // Identity is the account hash, not the name. A rename must resolve to the existing row;
  // a RECYCLED gamertag must resolve to a different person. The gamertag fallback remains
  // because hit/build events carry no hash (and never create players).
  let player = dayzId ? await store.getPlayerByDayzId(dayzId) : null;
  if (!player) player = await store.getPlayer(gamertag);
  const lastSeenBefore = player?.lastSeenAt ?? null;
  if (!player) player = await store.createPlayer(gamertag, dayzId, e.occurredAt);
  else await store.touchPlayer(player.id, e.occurredAt);
  await store.recordGamertag(player.id, gamertag, e.occurredAt);
```

Keep the existing comment about capturing `lastSeenBefore` before `touchPlayer` — that ordering is load-bearing and unrelated to this change.

- [ ] **Step 8: Run both suites**

```bash
pnpm --filter @onelife/projections run test && pnpm --filter @onelife/projector run test
```

Expected: PASS for both. If a pre-existing fold test now fails because a player is resolved by hash where it previously created a second row, that is the feature working — verify the new expectation is genuinely correct before updating any assertion, and say so in your report.

- [ ] **Step 9: Commit**

```bash
git add packages/projections/src apps/projector/src/pg-store.ts packages/projections/test/fold-identity.test.ts
git commit -m "feat(projections): resolve player identity by dayz_id, record every name

A rename now resolves to the existing player; a recycled gamertag resolves to a
different one. The merge itself needs no script — rebuildAll re-folds from event 0."
```

---

### Task 3: Alias-aware slug resolution

**Files:**
- Modify: `packages/read-models/src/player-aggregate.ts:14-31`
- Test: `packages/read-models/test/player-identity.test.ts` (extend)

**Interfaces:**
- Consumes: `playerGamertags` from Task 1.
- Produces: `export type SlugMatch = { gamertag: string; viaAlias: boolean }` and
  `resolveSlugMatch(db: Database, input: string): Promise<SlugMatch | null>`.
  `resolveGamertagBySlug(db, input): Promise<string | null>` keeps its exact signature and
  becomes a thin wrapper, so its five existing call sites are unchanged and become alias-aware
  for free.

- [ ] **Step 1: Write the failing test**

Append to `packages/read-models/test/player-identity.test.ts`:

```ts
describe("resolveSlugMatch", () => {
  it("resolves a CURRENT name directly, not via an alias", async () => {
    const [p] = await db.select().from(players).where(eq(players.gamertag, tag));
    const m = await resolveSlugMatch(db, tag.toLowerCase());
    expect(m).toEqual({ gamertag: p!.gamertag, viaAlias: false });
  });

  it("resolves an OLD name to the current one, flagged as an alias", async () => {
    const [p] = await db.select().from(players).where(eq(players.gamertag, tag));
    await db.insert(playerGamertags).values({
      playerId: p!.id, gamertag: `${tag}Former`,
      firstSeenAt: new Date("2026-06-01T00:00:00Z"), lastSeenAt: new Date("2026-06-02T00:00:00Z"),
    });
    const m = await resolveSlugMatch(db, `${tag}Former`.toLowerCase());
    expect(m).toEqual({ gamertag: p!.gamertag, viaAlias: true });
  });

  it("returns null for a name nobody has ever used", async () => {
    expect(await resolveSlugMatch(db, "nobodyhaseverbeencalledthis")).toBeNull();
  });
});
```

Add `resolveSlugMatch` to the file's imports from `../src/player-aggregate.js`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @onelife/read-models run test -- -t "resolveSlugMatch"
```

Expected: FAIL — `resolveSlugMatch is not a function`.

- [ ] **Step 3: Implement**

In `packages/read-models/src/player-aggregate.ts`, replace `resolveGamertagBySlug` with:

```ts
export type SlugMatch = { gamertag: string; viaAlias: boolean };

const SLUG_SQL = (col: unknown) =>
  sql`trim(both '-' from regexp_replace(lower(${col}), '[^a-z0-9]+', '-', 'g'))`;

/**
 * Resolve a player-page slug (or a raw gamertag) to the player's CURRENT gamertag.
 * Current names win outright; an old name resolves through `player_gamertags` to whoever
 * holds it most recently — recycling is rare but real, so "most recent holder" is the rule.
 */
export async function resolveSlugMatch(db: Database, input: string): Promise<SlugMatch | null> {
  const target = slugNorm(input);
  if (!target) return null;

  const direct = await db
    .select({ gamertag: players.gamertag })
    .from(players)
    .where(sql`${SLUG_SQL(players.gamertag)} = ${target}`)
    .limit(1);
  if (direct[0]) return { gamertag: direct[0].gamertag, viaAlias: false };

  const alias = await db
    .select({ gamertag: players.gamertag })
    .from(playerGamertags)
    .innerJoin(players, eq(players.id, playerGamertags.playerId))
    .where(sql`${SLUG_SQL(playerGamertags.gamertag)} = ${target}`)
    .orderBy(desc(playerGamertags.lastSeenAt))
    .limit(1);
  return alias[0] ? { gamertag: alias[0].gamertag, viaAlias: true } : null;
}

export async function resolveGamertagBySlug(db: Database, input: string): Promise<string | null> {
  return (await resolveSlugMatch(db, input))?.gamertag ?? null;
}
```

Keep the existing `slugNorm` and its comment about hand-syncing with `apps/web/src/lib/slug.ts`. Add `playerGamertags` and `desc` to the imports.

- [ ] **Step 4: Run the read-models suite**

```bash
pnpm --filter @onelife/read-models run test
```

Expected: PASS, including every pre-existing `resolveGamertagBySlug` test.

- [ ] **Step 5: Commit**

```bash
git add packages/read-models/src/player-aggregate.ts packages/read-models/test/player-identity.test.ts
git commit -m "feat(read-models): resolve a player slug through former gamertags"
```

---

### Task 4: The player page redirects an old slug

**Files:**
- Modify: `apps/web/src/app/players/[slug]/page.tsx`
- Test: `apps/web/src/app/players/__tests__/` — match the directory the repo already uses for page tests; if none exists for this route, create `apps/web/src/lib/player-slug-redirect.test.ts` for the pure helper below.

**Interfaces:**
- Consumes: `getPlayerPage`, which already returns the player's real `gamertag`.
- Produces: `shouldRedirectSlug(currentSlug: string, canonicalGamertag: string): boolean` in `apps/web/src/lib/player-page-href.ts`.

No API change is needed: the page already holds both the slug from the URL and the real gamertag from the response.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/player-slug-redirect.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldRedirectSlug } from "./player-page-href";

describe("shouldRedirectSlug", () => {
  it("does not redirect when the slug already names the current gamertag", () => {
    expect(shouldRedirectSlug("tds-maverick12", "tds maverick12")).toBe(false);
  });

  it("redirects when the slug came from a former gamertag", () => {
    expect(shouldRedirectSlug("daddyishome", "tds maverick12")).toBe(true);
  });

  it("does not redirect on a mere casing difference in the URL", () => {
    expect(shouldRedirectSlug("TDS-Maverick12", "tds maverick12")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @onelife/web run test -- player-slug-redirect
```

Expected: FAIL — `shouldRedirectSlug is not exported`.

- [ ] **Step 3: Implement the helper**

Append to `apps/web/src/lib/player-page-href.ts` (import `playerSlug` from `./slug` if it is not already imported):

```ts
/**
 * True when the URL's slug does not name the player's CURRENT gamertag — i.e. it came from a
 * former name and the page should permanently redirect. Casing is not a difference: playerSlug
 * lower-cases, so /players/TDS-Maverick12 is already canonical.
 */
export function shouldRedirectSlug(currentSlug: string, canonicalGamertag: string): boolean {
  return playerSlug(currentSlug) !== playerSlug(canonicalGamertag);
}
```

- [ ] **Step 4: Wire it into the page**

In `apps/web/src/app/players/[slug]/page.tsx`, immediately after the player data is fetched and the not-found branch has been handled, add:

```tsx
  if (shouldRedirectSlug(slug, data.gamertag)) {
    // 308, not 307: a rename is permanent, and shared links / crawlers should consolidate
    // onto the current dossier. Preserve the query string so ?page= and ?ap= survive.
    permanentRedirect(`${playerPageHref(playerSlug(data.gamertag), {})}${qs ? `?${qs}` : ""}`);
  }
```

Import `permanentRedirect` from `next/navigation` and `shouldRedirectSlug` from `@/lib/player-page-href`. Read the file first: use the variable names it already has for the slug param, the fetched data, and the query string, and build the target with the existing `playerPageHref` helper rather than string-concatenating a path.

- [ ] **Step 5: Run the web suite**

```bash
pnpm --filter @onelife/web run test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/player-page-href.ts apps/web/src/lib/player-slug-redirect.test.ts apps/web/src/app/players/\[slug\]/page.tsx
git commit -m "feat(web): 308 an old gamertag slug to the current dossier"
```

---

### Task 5: Player-scoped stats key on the FK, not on names

**Files (all in `packages/read-models/src/`):** `queries.ts:24-27`, `player-aggregate.ts:33-35`, `player-page.ts:86`, `player-kills.ts:29-33`, `player-priors.ts:83`, `life-dossier.ts:65`, `life-track.ts:104-110`, `survivors.ts:105`, `qualified-lives.ts:25`
- Test: `packages/read-models/test/player-identity.test.ts` (extend)

**Interfaces:**
- Consumes: identity-correct `killer_player_id` / `victim_player_id`, populated by the fold (`fold.ts:85-90` and `:106`) and made correct by Task 2.
- Produces: no new exports. Each listed query changes its predicate only.

**The pattern.** Each site currently matches a gamertag text column. Replace the predicate with the corresponding FK, resolving the player id once from the gamertag the caller already has:

```ts
// before
.where(and(eq(kills.serverId, serverId), eq(kills.killerGamertag, gamertag)))
// after
.where(and(eq(kills.serverId, serverId), eq(kills.killerPlayerId, playerId)))
```

Several of these functions already load the `players` row (`queries.ts:35`, `queries.ts:69`) and can pass `p.id` straight down. Where a function only receives a gamertag, resolve the id once at the top with a single `select({ id: players.id }).from(players).where(eq(players.gamertag, gamertag)).limit(1)` and return the function's existing empty value if it misses.

**`killer_player_id` is NULLABLE.** `eq(col, playerId)` never matches NULL, which is the behaviour we want — but do not write a predicate that treats NULL as a wildcard, and do not add `or(isNull(...))` anywhere.

**Do NOT touch** `player-articles.ts`, `leaderboards.ts`, or `obituaries.ts` — deferred (spec §9).

- [ ] **Step 1: Write the failing test**

Append to `packages/read-models/test/player-identity.test.ts`. This proves the whole point of the feature — a kill scored under a former name still counts:

```ts
describe("stats follow the identity across a rename", () => {
  it("counts a kill recorded under a FORMER gamertag", async () => {
    const [p] = await db.select().from(players).where(eq(players.gamertag, tag));
    const [srv] = await db.insert(servers)
      .values({ nitradoServiceId: 990000 + (p!.id % 1000), name: "ident", map: "sakhal", slug: `ident-${p!.id}` })
      .returning();
    await db.insert(kills).values({
      serverId: srv!.id,
      killerGamertag: `${tag}Former`,      // the name at the time
      killerPlayerId: p!.id,               // the identity, resolved by the fold
      victimGamertag: "SomeoneElse",
      occurredAt: new Date("2026-06-01T12:00:00Z"),
    });

    const rows = await db.select().from(kills)
      .where(and(eq(kills.serverId, srv!.id), eq(kills.killerPlayerId, p!.id)));
    expect(rows).toHaveLength(1);

    // The name-keyed predicate this task removes would have missed it.
    const byName = await db.select().from(kills)
      .where(and(eq(kills.serverId, srv!.id), eq(kills.killerGamertag, p!.gamertag)));
    expect(byName).toHaveLength(0);

    await db.delete(kills).where(eq(kills.serverId, srv!.id));
    await db.delete(servers).where(eq(servers.id, srv!.id));
  });

  it("does NOT count a kill whose killer_player_id is null", async () => {
    // killer_player_id is nullable — the fold leaves it null when the killer had no players
    // row at the time. eq() never matches NULL, which is the behaviour we want; a predicate
    // that treated NULL as a wildcard would credit one player with everyone's orphan kills.
    const [p] = await db.select().from(players).where(eq(players.gamertag, tag));
    const [srv] = await db.insert(servers)
      .values({ nitradoServiceId: 991000 + (p!.id % 1000), name: "ident2", map: "sakhal", slug: `ident2-${p!.id}` })
      .returning();
    await db.insert(kills).values({
      serverId: srv!.id, killerGamertag: "GhostKiller", killerPlayerId: null,
      victimGamertag: "SomeoneElse", occurredAt: new Date("2026-06-02T12:00:00Z"),
    });
    const rows = await db.select().from(kills)
      .where(and(eq(kills.serverId, srv!.id), eq(kills.killerPlayerId, p!.id)));
    expect(rows).toHaveLength(0);

    await db.delete(kills).where(eq(kills.serverId, srv!.id));
    await db.delete(servers).where(eq(servers.id, srv!.id));
  });
});
```

Add `kills`, `servers`, and `and` to the file's imports.

- [ ] **Step 2: Run it and confirm the premise**

```bash
pnpm --filter @onelife/read-models run test -- -t "FORMER gamertag"
```

Expected: PASS immediately — this test pins the *data* premise (the FK is the identity, the name is not), not the code change. It is the regression guard for every edit below. Record that it passed for the right reason.

- [ ] **Step 3: Switch each call site**

Work through them one at a time, running the read-models suite after each so a break is attributable:

1. `queries.ts:24` — `killTimes(db, serverId, gamertag)` → `killTimes(db, serverId, playerId)`; both callers (`getPlayerProfile:44`, `getPlayerLives:73`) already hold `p.id`.
2. `player-aggregate.ts:33` — `killCount(db, serverId, gamertag)` → take `playerId`.
3. `player-page.ts:86` — the cross-server count; `getPlayerPage` already loads `p`, so use `p.id`.
4. `player-kills.ts:29` — `getLifeKills(...)` receives `killerGamertag`; resolve the id once at the top and match `killerPlayerId`.
5. `player-priors.ts:83` — same shape.
6. `life-dossier.ts:65` — `hitEvents.victimGamertag` → `hitEvents.victimPlayerId`.
7. `life-track.ts:108` — `lower(kills.killerGamertag) = lower(gamertag)` → `eq(kills.killerPlayerId, playerId)`. Read the comment above it: it explains the `lower()` was chosen because a kills table never reaches positions-table volume. That reasoning is now obsolete — replace the comment, do not leave it contradicting the code.
8. `survivors.ts:105` — the board's per-life kill aggregation.
9. `qualified-lives.ts:25` — the join `eq(kills.killerGamertag, players.gamertag)` → `eq(kills.killerPlayerId, players.id)`.

- [ ] **Step 4: Run the full suite**

```bash
pnpm turbo run typecheck --force && pnpm turbo run test --force --concurrency=1
```

Expected: 23/23 both. `@onelife/read-models` and `@onelife/api` carry the most coverage here.

- [ ] **Step 5: Commit**

```bash
git add packages/read-models/src packages/read-models/test/player-identity.test.ts
git commit -m "refactor(read-models): key player stats on the player FK, not the gamertag

The fold already stores killer_player_id / victim_player_id, so these become
identity-correct across a rename for free — and stop depending on name text."
```

---

### Task 6: Ownership checks compare identity

**Files:**
- Modify: `packages/tokens/src/redeem.ts:24-27`
- Modify: `packages/read-models/src/player-page.ts:69`
- Modify: `apps/api/src/routes/life-track.ts`
- Test: `packages/tokens/test/redeem.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveSlugMatch` from Task 3; identity-correct `players` rows from Task 2.
- Produces: no new exports.

**Why this exists.** A verified user's `gamertag_links` row names the callsign they claimed. After a rename, `players.gamertag` moves and `bans.gamertag` is written from it — so `redeem`'s `links.some((l) => l.gamertag === b.gamertag)` stops matching and the player **silently cannot spend a token on their own ban**. That is the same failure fixed for casing in `0024`. Nobody is affected today (0 of 8 links belong to a merged identity), so these are latent, not live.

- [ ] **Step 1: Write the failing test**

Append to `packages/tokens/test/redeem.test.ts`, matching that file's existing fixture helpers:

```ts
  it("lets a RENAMED verified player redeem against a ban under their new name", async () => {
    // The link still names the callsign they claimed; the ban names who they are now.
    // Matching those as raw strings silently denies them their own unban.
    const { userId, playerId } = await seedVerifiedPlayer("FormerName");
    await db.update(players).set({ gamertag: "CurrentName" }).where(eq(players.id, playerId));
    await db.insert(playerGamertags).values([
      { playerId, gamertag: "FormerName", firstSeenAt: new Date("2026-06-01T00:00:00Z"), lastSeenAt: new Date("2026-06-02T00:00:00Z") },
      { playerId, gamertag: "CurrentName", firstSeenAt: new Date("2026-07-01T00:00:00Z"), lastSeenAt: new Date("2026-07-02T00:00:00Z") },
    ]);
    await seedBan({ gamertag: "CurrentName", status: "applied", dryRun: false });

    await expect(redeem(db, { userId })).resolves.toMatchObject({ ok: true });
  });
```

Adapt `seedVerifiedPlayer` / `seedBan` / the `redeem` result shape to whatever that suite already uses — read it first and follow its idioms rather than introducing new helpers.

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @onelife/tokens run test -- -t "RENAMED"
```

Expected: FAIL — `no_active_ban`, because the link's `FormerName` never equals the ban's `CurrentName`.

- [ ] **Step 3: Resolve links to identity in `redeem`**

`packages/tokens/src/redeem.ts` currently filters:

```ts
const owned = candidates.filter((b) => links.some((l) => l.gamertag === b.gamertag));
```

Add this helper to `packages/tokens/src/redeem.ts` (or a sibling module if that file is already
large — check before adding):

```ts
/**
 * Map a gamertag to the player identity that holds it: the current name first, then any
 * former name, most recent holder winning. Returns null for a name nobody has used.
 * A rename moves players.gamertag, so comparing raw strings here silently denies a renamed
 * player their own unban.
 */
async function playerIdForGamertag(tx: Executor, gamertag: string): Promise<number | null> {
  const direct = await tx.select({ id: players.id }).from(players)
    .where(sql`lower(${players.gamertag}) = lower(${gamertag})`).limit(1);
  if (direct[0]) return direct[0].id;
  const alias = await tx.select({ id: playerGamertags.playerId }).from(playerGamertags)
    .where(sql`lower(${playerGamertags.gamertag}) = lower(${gamertag})`)
    .orderBy(desc(playerGamertags.lastSeenAt)).limit(1);
  return alias[0]?.id ?? null;
}
```

Then replace the filter:

```ts
// before
const owned = candidates.filter((b) => links.some((l) => l.gamertag === b.gamertag));

// after — compare identities, not name strings
const linkIds = new Set(
  (await Promise.all(links.map((l) => playerIdForGamertag(tx, l.gamertag))))
    .filter((id): id is number => id !== null),
);
const banIds = new Map<string, number | null>();
for (const b of candidates) {
  if (!banIds.has(b.gamertag)) banIds.set(b.gamertag, await playerIdForGamertag(tx, b.gamertag));
}
const owned = candidates.filter((b) => {
  const id = banIds.get(b.gamertag);
  return id !== null && id !== undefined && linkIds.has(id);
});
```

`Executor` is the widened transaction-handle type this package already uses (see
`packages/tokens/src/internal.ts`); match whatever the surrounding functions take rather than
introducing a new type. Import `players`, `playerGamertags`, `sql` and `desc` as needed.

**Keep the existing `dry_run = false` and status filters on `candidates` exactly as they are** —
`CLAUDE.md` records both as load-bearing invariants from the live-data-honesty work. A dry-run ban
must never be spendable.

- [ ] **Step 4: Apply the same treatment to the other two checks**

- `packages/read-models/src/player-page.ts:69` — the verified-stamp lookup matches `gamertagLinks.gamertag` against the page's gamertag. Resolve both sides to a player id.
- `apps/api/src/routes/life-track.ts` — the owner-only coordinate route. **Its security property must not weaken:** the subject still comes solely from the session cookie, the route still takes no player identifier, and only a `verified` link qualifies. You are changing how the link is matched to the life's player, not who may ask.

- [ ] **Step 5: Run the full suite**

```bash
pnpm turbo run typecheck --force && pnpm turbo run test --force --concurrency=1
```

Expected: 23/23 both.

- [ ] **Step 6: Commit**

```bash
git add packages/tokens/src/redeem.ts packages/read-models/src/player-page.ts apps/api/src/routes/life-track.ts packages/tokens/test/redeem.test.ts
git commit -m "fix: ownership checks follow a player across a rename

A renamed verified player kept their link under the old callsign while bans were
written under the new one, silently denying them their own unban."
```

---

### Task 7: Changelog and CLAUDE.md

**Files:** `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: Changelog**

Under `## [Unreleased]` → `### Fixed`, in the file's user-facing voice (no identifiers, no paths, no migration numbers):

```markdown
- Changing your gamertag no longer splits you into two players. Your lives, kills and record
  now follow you across a name change, and an old name still leads to your page. A name that
  someone else takes over later belongs to them, not to you.
```

- [ ] **Step 2: CLAUDE.md**

Add an entry describing the identity model. It must record, as rails:

- `players.dayz_id` is the identity; `players.gamertag` is the **current** name and moves on a rename. This narrowly reverses `0024`'s frozen-casing rule **for renames only** — casing stays frozen.
- `player_gamertags` is a **projection**: it is in `rebuildAll`'s truncate list, and it has **no global unique on gamertag** because a recycled gamertag legitimately belongs to two identities over time.
- Player-scoped stats key on `killer_player_id` / `victim_player_id`, never the gamertag text. The FKs are populated by the fold, so they are identity-correct after a rebuild.
- **The merge needs no migration script** — `rebuildAll` re-folds from event 0.
- `players.dayz_id` is **not yet unique**: `deploy.sh` migrates before it rebuilds, so the duplicates still exist at migrate time. Migration `0026`, next release, promotes it.
- Deferred: articles, notifications, friends and the token ledger still key on gamertag text.

Verify every claim against the shipped code before committing.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: changelog + CLAUDE.md for the identity merge"
```

---

## Done

Hand off to `finishing-a-feature`.

**PR body must carry:** deploy is `./deploy/deploy.sh --rebuild` — the rebuild **is** the merge, and without it nothing collapses. After deploying, confirm the collapse before the next release promotes the constraint:

```sql
SELECT dayz_id, count(*) FROM players GROUP BY 1 HAVING count(*) > 1;   -- expect zero rows
```

Expected outcome on production data: 5 player rows become 2 identities (`tds maverick12` with alias `daddyishome`; `sombadyhalp` with aliases `TidierCart8730` and `helpmeplz`), and those two players' lives renumber per server.
