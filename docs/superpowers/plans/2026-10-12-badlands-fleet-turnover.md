# Badlands Fleet Turnover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the fleet turn over on 2026-10-15 without lives crossing maps, old logs landing on new rows, or retired history vanishing.

**Architecture:**
- `servers` gains `retired_at`, `ingest_from`, and a partial unique index on the service id.
- Ingest honours `ingest_from`.
- Retirement is applied at read time by one pure helper called from the three readers that can see a retired server's lives.
- The dossier stops looping over active servers only.
- A tested `fleet-cutover` operator command applies a fleet change in one transaction.

**Tech Stack:** TypeScript/ESM, pnpm + turbo, Postgres + Drizzle, Vitest (DB suites need `TEST_DATABASE_URL`), Next.js App Router.

**Spec:** `docs/superpowers/specs/2026-10-09-badlands-fleet-turnover-design.md`

## Global Constraints

- Hard deadline: released and deployed before **2026-10-15**.
- Migration `0039`: journal `when` must exceed `1787158800000`. Verify the columns exist after migrating; never trust drizzle-kit's success line.
- To migrate the test DB: `DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate`.
- No `--rebuild` for this release (no projection table changes shape).
- Nothing writes retirement into `lives`/`sessions`; it is derived at read time.
- `ingest_from` unset means no cutoff (OFF), never an epoch default.
- The cutover command dry-runs unless `--apply`.
- Never hardcode a server count in copy or grid columns.
- No em dashes in docs, changelog, PR body or site copy.
- Never chain `git commit && gh pr create`.
- Run tests serially: `pnpm turbo run test --concurrency=1`.
- Do not `source .env` for the web suite.

## Review Focus

1. **Ghosted open session on a retired server.** A player whose open Sakhal session is weeks old, with `lastSeenAt` long before `retired_at`: playtime must cap at `lastSeenAt`, not run to `retired_at`. (Task 4 test.)
2. **Player who only played a retired server.** The dossier must render, not 404. (Task 5 test.)
3. **Refusal leaves no partial cutover.** A cutover whose third operation is invalid must leave the first two unapplied. (Task 3 test.)
4. **Brand-new row's first tick.** A row with `ingest_from` and offset 0 must derive the offset before comparing, so a +4h server clock does not admit or drop the wrong file. (Task 2 test.)
5. **Paused vs retired.** `active=false` with `retired_at` NULL must leave open lives open. (Task 4 test.)

---

### Task 1: Schema and migration

**Files:**
- Modify: `packages/db/src/schema.ts:9-21`
- Create: `packages/db/drizzle/0039_server_retirement.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Test: `packages/db/test/servers-index.test.ts` (create; if `packages/db` has no vitest config, put it in `apps/projector/test/servers-index.test.ts`, which already uses `getTestDb`)

**Interfaces:**
- Produces: `servers.retiredAt: Date | null`, `servers.ingestFrom: Date | null` on the Drizzle table.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterAll } from "vitest";
import { servers } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 13e8;
afterAll(async () => { await db.delete(servers).where(eq(servers.nitradoServiceId, svc)); await sql.end(); });

describe("servers service-id uniqueness", () => {
  it("allows a retired row and an active row on one service, refuses two active", async () => {
    await db.insert(servers).values({ nitradoServiceId: svc, name: "old", active: false, retiredAt: new Date("2026-10-15T00:00:00Z") });
    await db.insert(servers).values({ nitradoServiceId: svc, name: "new", ingestFrom: new Date("2026-10-15T00:00:00Z") });
    await expect(db.insert(servers).values({ nitradoServiceId: svc, name: "dup" })).rejects.toThrow();
    const rows = await db.select().from(servers).where(eq(servers.nitradoServiceId, svc));
    expect(rows).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (TypeScript: `retiredAt`/`ingestFrom` unknown).

- [ ] **Step 3: Schema.** In `schema.ts`:
  - add `retiredAt: timestamp("retired_at", { withTimezone: true })` and `ingestFrom: timestamp("ingest_from", { withTimezone: true })`;
  - replace the `uniqService` entry with:

```ts
uniqActiveService: uniqueIndex("servers_nitrado_service_id_active_uniq").on(t.nitradoServiceId).where(sql`${t.active}`),
```

- [ ] **Step 4: Migration SQL** `0039_server_retirement.sql`:

```sql
ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "ingest_from" timestamp with time zone;--> statement-breakpoint
DROP INDEX IF EXISTS "servers_nitrado_service_id_uniq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "servers_nitrado_service_id_active_uniq" ON "servers" USING btree ("nitrado_service_id") WHERE "servers"."active";
```

Append to `_journal.json`: `{"idx":39,"version":"7","when":1787245200000,"tag":"0039_server_retirement","breakpoints":true}`.

- [ ] **Step 5: Migrate the test DB and verify the columns exist**

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate
psql "$TEST_DATABASE_URL" -c "\d servers" | grep -E "retired_at|ingest_from|active_uniq"
```

Expected: all three lines present.

- [ ] **Step 6: Run the test, expect PASS.** Then `pnpm turbo run typecheck`.

- [ ] **Step 7: Commit:** `feat(db): servers.retired_at, ingest_from, one active row per service`

---

### Task 2: Ingest honours `ingest_from`

**Files:**
- Modify: `apps/ingest-worker/src/tick.ts`
- Test: `apps/ingest-worker/test/tick.test.ts`

**Interfaces:**
- Consumes: `servers.ingestFrom` (Task 1).
- Produces: the pure helper `export function beforeCutoff(file: AdmFileRef, offsetMs: number, ingestFrom: Date | null): boolean` in `tick.ts`.

- [ ] **Step 1: Failing tests** (append to `tick.test.ts`; the server clock is +4h, as in the existing fixtures):

```ts
import { beforeCutoff } from "../src/tick.js";

describe("ingest_from cutoff", () => {
  it("beforeCutoff compares offset-corrected start time; null cutoff admits all", () => {
    const f: AdmFileRef = { path: "/x", name: "x", localTimestampMs: Date.UTC(2026,9,15,10,0,0), modifiedAtMs: 1 };
    const off = 4 * 3600_000; // corrected start = 14:00Z
    expect(beforeCutoff(f, off, null)).toBe(false);
    expect(beforeCutoff(f, off, new Date(Date.UTC(2026,9,15,13,0,0)))).toBe(false);
    expect(beforeCutoff(f, off, new Date(Date.UTC(2026,9,15,15,0,0)))).toBe(true);
    expect(beforeCutoff({ ...f, localTimestampMs: null }, off, new Date(0))).toBe(true); // unreadable while a cutoff is set
    expect(beforeCutoff({ ...f, localTimestampMs: null }, off, null)).toBe(false);
  });

  it("a new row skips the service's pre-cutoff files and ingests only newer ones", async () => {
    // Files start 10:00 local on Jul 5 / Jul 6 = 14:00Z with the derived +4h offset.
    const [s] = await db.insert(servers).values({
      nitradoServiceId: 999013, name: "tick-cutoff",
      ingestFrom: new Date(Date.UTC(2026,6,6,0,0,0)), // between the two files, in UTC
    }).returning();
    await ingestTick(db, { serverId: s!.id, client, backfillBudget: 15 });
    const files = await db.select().from(admFiles).where(eq(admFiles.serverId, s!.id));
    expect(files.map((f) => f.path)).toEqual(["/s/new.ADM"]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`beforeCutoff` not exported).

- [ ] **Step 3: Implement.** In `tick.ts`:

```ts
/** ⚠️ Forward-only cutoff for a server row that inherits a Nitrado service with older logs on it
 *  (a map change keeps the service; the new row must not backfill the old map's files). Compared
 *  in offset-corrected time; a file with no readable timestamp is skipped while a cutoff is set. */
export function beforeCutoff(file: AdmFileRef, offsetMs: number, ingestFrom: Date | null): boolean {
  if (!ingestFrom) return false;
  if (file.localTimestampMs == null) return true;
  return file.localTimestampMs + offsetMs < ingestFrom.getTime();
}
```

After `offsetMs` is resolved, load the cutoff and filter (logging skipped unreadable files once per tick):

```ts
const [srvRow] = await db.select({ ingestFrom: servers.ingestFrom }).from(servers).where(eq(servers.id, serverId));
const ingestFrom = srvRow?.ingestFrom ?? null;
const eligible = files.filter((f) => !beforeCutoff(f, offsetMs, ingestFrom));
if (eligible.length === 0) return;
```

Then use `eligible` (not `files`) for `newestPath` and the loop. The clock-offset derivation stays on the full `files` list.

- [ ] **Step 4: Run** `pnpm --filter @onelife/ingest-worker test`, expect PASS (existing tests unchanged).

- [ ] **Step 5: Commit:** `feat(ingest): forward-only ingest_from cutoff per server row`

---

### Task 3: `fleet-cutover` command

**Files:**
- Create: `apps/projector/src/fleet-cutover.ts`
- Modify: `apps/projector/package.json` (script `"fleet-cutover": "tsx src/fleet-cutover.ts"`)
- Test: `apps/projector/test/fleet-cutover.test.ts`

**Interfaces:**
- Produces:
  - `parseCutoverArgs(argv: string[]): CutoverPlan`
  - `runCutover(db, plan, at: Date): Promise<{ before: ServerRow[]; after: ServerRow[] }>`

  The types:

```ts
export type RetireOp = { slug: string; newSlug: string | null };
export type AddOp = { slug: string; name: string; map: string; serviceId: number };
export type CutoverPlan = { retire: RetireOp[]; add: AddOp[]; retiredAt: Date | null; apply: boolean };
```

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { servers } from "@onelife/db";
import { inArray } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";
import { parseCutoverArgs, runCutover } from "../src/fleet-cutover.js";

const { db, sql } = getTestDb();
const base = Math.floor(Math.random() * 1e7) + 14e8;
const A = base, B = base + 1, C = base + 2;
const AT = new Date("2026-10-15T09:00:00Z");

async function reset() {
  await db.delete(servers).where(inArray(servers.nitradoServiceId, [A, B, C]));
  await db.insert(servers).values([
    { nitradoServiceId: A, name: "Chernarus", map: "chernarusplus", slug: "fc-chern" },
    { nitradoServiceId: B, name: "Livonia", map: "enoch", slug: "fc-liv" },
  ]);
}
const rows = () => db.select().from(servers).where(inArray(servers.nitradoServiceId, [A, B, C]));
beforeEach(reset);
afterAll(async () => { await db.delete(servers).where(inArray(servers.nitradoServiceId, [A, B, C])); await sql.end(); });

describe("fleet-cutover", () => {
  const argv = ["--retire", "fc-chern=fc-chern-1.29", "--retire", "fc-liv",
    "--add", `fc-chern:Chernarus:chernarusplus:${B}`, "--add", `fc-nas:Nasdara:nasdara:${C}`];

  it("parses args; dry run by default", () => {
    const plan = parseCutoverArgs(argv);
    expect(plan.apply).toBe(false);
    expect(plan.retire).toEqual([{ slug: "fc-chern", newSlug: "fc-chern-1.29" }, { slug: "fc-liv", newSlug: null }]);
    expect(plan.add[0]).toEqual({ slug: "fc-chern", name: "Chernarus", map: "chernarusplus", serviceId: B });
  });

  it("dry run changes nothing but reports the after-state", async () => {
    const r = await runCutover(db, parseCutoverArgs(argv), AT);
    expect(r.after.find((s) => s.slug === "fc-nas")).toBeTruthy();
    expect((await rows()).map((s) => s.slug).sort()).toEqual(["fc-chern", "fc-liv"]);
  });

  it("--apply retires, hands the slug over, and adds rows with ingest_from", async () => {
    await runCutover(db, parseCutoverArgs([...argv, "--apply"]), AT);
    const all = await rows();
    const old = all.find((s) => s.slug === "fc-chern-1.29")!;
    expect(old).toMatchObject({ active: false, nitradoServiceId: A });
    expect(old.retiredAt!.toISOString()).toBe(AT.toISOString());
    const nu = all.find((s) => s.slug === "fc-chern")!;
    expect(nu).toMatchObject({ active: true, nitradoServiceId: B, map: "chernarusplus" });
    expect(nu.ingestFrom!.toISOString()).toBe(AT.toISOString());
    expect(all.find((s) => s.slug === "fc-liv")).toMatchObject({ active: false });
  });

  it("refuses atomically when a later op is invalid", async () => {
    // The third op collides: fc-liv's slug is still held by its (now retired) row.
    const collide = [...argv, "--add", "fc-liv:X:enoch:" + C, "--apply"];
    await expect(runCutover(db, parseCutoverArgs(collide), AT)).rejects.toThrow(/slug/);
    expect((await rows()).map((s) => [s.slug, s.active])).toEqual(expect.arrayContaining([["fc-chern", true], ["fc-liv", true]]));
  });

  it("refuses an unknown slug and an already-retired target", async () => {
    await expect(runCutover(db, parseCutoverArgs(["--retire", "nope", "--apply"]), AT)).rejects.toThrow(/no server/);
    await runCutover(db, parseCutoverArgs(["--retire", "fc-liv", "--apply"]), AT);
    await expect(runCutover(db, parseCutoverArgs(["--retire", "fc-liv", "--apply"]), AT)).rejects.toThrow(/already retired/);
  });

  it("accepts a paused row and honours --retired-at", async () => {
    await db.update(servers).set({ active: false }).where(inArray(servers.nitradoServiceId, [B]));
    await runCutover(db, parseCutoverArgs(["--retire", "fc-liv", "--retired-at", "2026-10-09T18:07:00Z", "--apply"]), AT);
    const liv = (await rows()).find((s) => s.slug === "fc-liv")!;
    expect(liv.retiredAt!.toISOString()).toBe("2026-10-09T18:07:00.000Z");
  });

  it("refuses a second active row on one service", async () => {
    await expect(runCutover(db, parseCutoverArgs(["--add", `fc-nas:N:nasdara:${A}`, "--apply"]), AT)).rejects.toThrow(/active/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing).

- [ ] **Step 3: Implement** `fleet-cutover.ts`:

```ts
import { and, eq } from "drizzle-orm";
import type { Database } from "@onelife/db";
import { servers } from "@onelife/db";

export type RetireOp = { slug: string; newSlug: string | null };
export type AddOp = { slug: string; name: string; map: string; serviceId: number };
export type CutoverPlan = { retire: RetireOp[]; add: AddOp[]; retiredAt: Date | null; apply: boolean };
type ServerRow = typeof servers.$inferSelect;

export function parseCutoverArgs(argv: string[]): CutoverPlan {
  const plan: CutoverPlan = { retire: [], add: [], retiredAt: null, apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--apply") plan.apply = true;
    else if (a === "--retire") {
      const [slug, newSlug] = argv[++i]!.split("=");
      plan.retire.push({ slug: slug!, newSlug: newSlug ?? null });
    } else if (a === "--add") {
      const [slug, name, map, svc] = argv[++i]!.split(":");
      if (!slug || !name || !map || !svc || !Number.isFinite(Number(svc))) throw new Error(`fleet-cutover: bad --add ${argv[i]}`);
      plan.add.push({ slug, name, map, serviceId: Number(svc) });
    } else if (a === "--retired-at") {
      const d = new Date(argv[++i]!);
      if (Number.isNaN(d.getTime())) throw new Error(`fleet-cutover: bad --retired-at ${argv[i]}`);
      plan.retiredAt = d;
    } else if (a !== "--") throw new Error(`fleet-cutover: unknown argument ${a}`);
  }
  return plan;
}

class DryRun extends Error {}

/** ⚠️ One transaction, ordered: retirements, then slug renames, then inserts. The retiring row must
 *  release its slug before the new row can take it. Any refusal rolls back everything. */
export async function runCutover(db: Database, plan: CutoverPlan, at: Date) {
  const retiredAt = plan.retiredAt ?? at;
  let result!: { before: ServerRow[]; after: ServerRow[] };
  try {
    await db.transaction(async (tx) => {
      const before = await tx.select().from(servers).orderBy(servers.id);
      for (const r of plan.retire) {
        const [row] = await tx.select().from(servers).where(eq(servers.slug, r.slug));
        if (!row) throw new Error(`fleet-cutover: no server with slug ${r.slug}`);
        if (row.retiredAt) throw new Error(`fleet-cutover: ${r.slug} is already retired`);
        await tx.update(servers).set({ active: false, retiredAt }).where(eq(servers.id, row.id));
      }
      for (const r of plan.retire) {
        if (!r.newSlug) continue;
        const [taken] = await tx.select().from(servers).where(eq(servers.slug, r.newSlug));
        if (taken) throw new Error(`fleet-cutover: slug ${r.newSlug} is taken`);
        await tx.update(servers).set({ slug: r.newSlug }).where(eq(servers.slug, r.slug));
      }
      for (const a of plan.add) {
        const [taken] = await tx.select().from(servers).where(eq(servers.slug, a.slug));
        if (taken) throw new Error(`fleet-cutover: slug ${a.slug} is taken`);
        const [live] = await tx.select().from(servers).where(and(eq(servers.nitradoServiceId, a.serviceId), eq(servers.active, true)));
        if (live) throw new Error(`fleet-cutover: service ${a.serviceId} already has an active row (${live.slug})`);
        await tx.insert(servers).values({ nitradoServiceId: a.serviceId, name: a.name, map: a.map, slug: a.slug, active: true, ingestFrom: at });
      }
      const after = await tx.select().from(servers).orderBy(servers.id);
      result = { before, after };
      if (!plan.apply) throw new DryRun();
    });
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { getDb } = await import("@onelife/db");
  if (!process.env.DATABASE_URL) throw new Error("fleet-cutover: DATABASE_URL is required");
  const { db, sql: end } = getDb(process.env.DATABASE_URL);
  const plan = parseCutoverArgs(process.argv.slice(2));
  const { before, after } = await runCutover(db, plan, new Date());
  const show = (rs: ServerRow[]) => console.table(rs.map((s) => ({ id: s.id, slug: s.slug, name: s.name, map: s.map, service: s.nitradoServiceId, active: s.active, retired_at: s.retiredAt?.toISOString() ?? null, ingest_from: s.ingestFrom?.toISOString() ?? null })));
  console.log("BEFORE"); show(before);
  console.log(plan.apply ? "AFTER (applied)" : "AFTER (dry run, nothing changed; pass --apply)"); show(after);
  await end.end();
  process.exit(0);
}
```

The "unknown slug" check runs against the transaction's own view, so a retire listed after a rename sees the renamed state. Retire ops name the *current* slug.

- [ ] **Step 4: Run** `pnpm --filter @onelife/projector test -- fleet-cutover`, expect PASS.

- [ ] **Step 5: Commit:** `feat(projector): fleet-cutover operator command`

---

### Task 4: Read-time retirement

**Files:**
- Create: `packages/read-models/src/retirement.ts`, `packages/read-models/test/retirement.test.ts`
- Modify:
  - `packages/read-models/src/index.ts` (export)
  - `packages/read-models/src/queries.ts` (`getPlayerLives`, `getLifeDetail`)
  - `packages/read-models/src/life-track.ts`
  - `packages/api-client/src/types.ts` (`Life.endReason`)
- Test: `packages/read-models/test/queries.test.ts`, `packages/read-models/test/life-track.test.ts`

**Interfaces:**
- Produces:
  - `export type EndReason = "death" | "server_retired"`
  - `applyRetirement<L extends { endedAt: Date | null; playtimeSeconds: number }>(life: L, openSession: { connectedAt: Date } | null, retiredAt: Date | null, lastSeenAt: Date | null): L & { endReason: EndReason | null }`
  - `closeSessionsAt<S extends { disconnectedAt: Date | null }>(rows: S[], retiredAt: Date | null): S[]`
  - `getPlayerLives` and `getLifeDetail(...).life` rows now carry `endReason`
  - API `Life` gains `endReason: "death" | "server_retired" | null`

- [ ] **Step 1: Failing unit tests** `retirement.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applyRetirement, closeSessionsAt } from "../src/retirement.js";

const R = new Date("2026-10-09T18:07:00Z");
describe("applyRetirement", () => {
  it("ends an open life on a retired server at retired_at, adding the open session up to it", () => {
    const l = applyRetirement({ endedAt: null, playtimeSeconds: 600 }, { connectedAt: new Date("2026-10-09T18:00:00Z") }, R, new Date("2026-10-09T18:10:00Z"));
    expect(l).toMatchObject({ endedAt: R, endReason: "server_retired", playtimeSeconds: 600 + 420 });
  });
  it("caps a ghosted session at lastSeenAt when that is earlier", () => {
    const l = applyRetirement({ endedAt: null, playtimeSeconds: 0 }, { connectedAt: new Date("2026-09-01T00:00:00Z") }, R, new Date("2026-09-01T01:00:00Z"));
    expect(l.playtimeSeconds).toBe(3600);
  });
  it("leaves an open life open when the server is not retired (paused)", () => {
    expect(applyRetirement({ endedAt: null, playtimeSeconds: 5 }, null, null, null)).toMatchObject({ endedAt: null, endReason: null, playtimeSeconds: 5 });
  });
  it("marks a dead life as death, untouched", () => {
    const d = new Date("2026-10-01T00:00:00Z");
    expect(applyRetirement({ endedAt: d, playtimeSeconds: 9 }, null, R, null)).toMatchObject({ endedAt: d, endReason: "death", playtimeSeconds: 9 });
  });
  it("closeSessionsAt closes open sessions at retired_at only when retired", () => {
    expect(closeSessionsAt([{ disconnectedAt: null }], R)[0]!.disconnectedAt).toEqual(R);
    expect(closeSessionsAt([{ disconnectedAt: null }], null)[0]!.disconnectedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `retirement.ts`:

```ts
import { livePlaytime } from "./playtime.js";

export type EndReason = "death" | "server_retired";

/** ⚠️ Retirement is DERIVED, never written: an open life on a server with `retired_at` ended then,
 *  and not by death. Writing it into `lives` would be lost on `--rebuild` and would look like a
 *  death to the enforcer. Only readers that do not filter on `servers.active` need this. */
export function applyRetirement<L extends { endedAt: Date | null; playtimeSeconds: number }>(
  life: L, openSession: { connectedAt: Date } | null, retiredAt: Date | null, lastSeenAt: Date | null,
): L & { endReason: EndReason | null } {
  if (life.endedAt) return { ...life, endReason: "death" };
  if (!retiredAt) return { ...life, endReason: null };
  const cap = lastSeenAt && lastSeenAt < retiredAt ? lastSeenAt : retiredAt;
  return { ...life, endedAt: retiredAt, endReason: "server_retired", playtimeSeconds: livePlaytime(life.playtimeSeconds, openSession, cap) };
}

export function closeSessionsAt<S extends { disconnectedAt: Date | null }>(rows: S[], retiredAt: Date | null): S[] {
  if (!retiredAt) return rows;
  return rows.map((s) => (s.disconnectedAt ? s : { ...s, disconnectedAt: retiredAt }));
}
```

Export from `index.ts`: `export * from "./retirement.js";`.

- [ ] **Step 4: Failing DB test** (append to `queries.test.ts`):

```ts
import { getPlayerLives, getLifeDetail } from "../src/index.js";
it("a retired server's open life reads as ended by retirement", async () => {
  const R = new Date("2026-07-06T12:25:00Z");
  await db.update(servers).set({ active: false, retiredAt: R }).where(eq(servers.id, serverId));
  try {
    const [l] = (await getPlayerLives(db, serverId, "A"))!;
    expect(l).toMatchObject({ endReason: "server_retired", playtimeSeconds: 600 + 300 });
    expect(l!.endedAt).toEqual(R);
    const d = await getLifeDetail(db, serverId, l!.id);
    expect(d!.life.endReason).toBe("server_retired");
    expect(d!.sessions.every((s) => s.disconnectedAt !== null)).toBe(true);
  } finally {
    await db.update(servers).set({ active: true, retiredAt: null }).where(eq(servers.id, serverId));
  }
});
```

- [ ] **Step 5: Implement in `queries.ts`.**
  - `getPlayerLives`:
    - load `retiredAt` with `const [srv] = await db.select({ retiredAt: servers.retiredAt }).from(servers).where(eq(servers.id, serverId));`
    - map rows through `applyRetirement(l, openSession && openSession.lifeId === l.id ? openSession : null, srv?.retiredAt ?? null, p.lastSeenAt)` **before** the qualification filter;
    - the filter's `effectivePlaytimeSeconds`/`windowEnd` then read the applied `endedAt`/`playtimeSeconds` unchanged.
  - `getLifeDetail`:
    - load the server's `retiredAt` and the player's `lastSeenAt` (`players.id = life.playerId`);
    - find the open session among `sess`, and return `{ life: applyRetirement(life, open, retiredAt, lastSeenAt), sessions: closeSessionsAt(sess, retiredAt) }`.
  - Import `servers` and `applyRetirement`/`closeSessionsAt`.

- [ ] **Step 6: `life-track.ts`.**
  - Select `retiredAt: servers.retiredAt` in the row query and compute `const endedAt = row.endedAt ?? row.retiredAt;`.
  - Use `endedAt` where `row.endedAt` is read today (`cap`, `windowEnd`, `alive`).
  - The terminal marker stays `"death"` only when `row.endedAt` (a real death). A retired life gets no terminal marker.

  Add to `life-track.test.ts` a case: a retired server's open life returns `alive: false` and no `death` marker.

- [ ] **Step 7: API type.** In `packages/api-client/src/types.ts`, add `endReason: "death" | "server_retired" | null;` to `Life`, and `endReason: "death" | "server_retired";` to `PastLife`.

- [ ] **Step 8: Run** `pnpm --filter @onelife/read-models test` and `pnpm turbo run typecheck`, expect PASS. Fix any test fixtures that build a `Life` literal by adding `endReason`.

- [ ] **Step 9: Commit:** `feat(read-models): derive server retirement at read time`

---

### Task 5: Dossier includes retired servers

**Files:**
- Modify: `packages/read-models/src/player-page.ts:88,149-250`
- Test: `packages/read-models/test/player-page.test.ts`

**Interfaces:**
- Consumes: `getPlayerLives` rows with `endReason` (Task 4).
- Produces: `PastLife.endReason`; `totals.deaths` counts deaths only.

- [ ] **Step 1: Failing test** (append to `player-page.test.ts`; follow its existing fixture helpers for players, lives and sessions):

```ts
it("a player who only played a retired server still has a dossier, with that history and no ticket", async () => {
  const svc = Math.floor(Math.random() * 1e7) + 15e8;
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "Gone", map: "sakhal", slug: `gone-${svc}`, active: false, retiredAt: new Date("2026-10-09T18:07:00Z") }).returning();
  const [p] = await db.insert(players).values({ gamertag: `OnlyGone${svc}`, firstSeenAt: new Date("2026-10-01T00:00:00Z"), lastSeenAt: new Date("2026-10-09T18:00:00Z") }).returning();
  // dead life (qualifies by playtime) + open qualifying life
  await db.insert(lives).values([
    { serverId: s!.id, playerId: p!.id, lifeNumber: 1, startedAt: new Date("2026-10-01T00:00:00Z"), endedAt: new Date("2026-10-02T00:00:00Z"), deathCause: "infected", playtimeSeconds: 7200 },
    { serverId: s!.id, playerId: p!.id, lifeNumber: 2, startedAt: new Date("2026-10-03T00:00:00Z"), playtimeSeconds: 7200 },
  ]);
  const page = await getPlayerPage(db, `OnlyGone${svc}`, new Date("2026-10-12T00:00:00Z"), {});
  expect(page).not.toBeNull();
  expect(page!.standing.some((c) => c.serverId === s!.id)).toBe(false);
  expect(page!.totals).toMatchObject({ lives: 2, deaths: 1 });
  expect(page!.pastLives.map((l) => l.endReason).sort()).toEqual(["death", "server_retired"]);
});
```

Match `getPlayerPage`'s real signature and option names to the existing tests in that file; the assertions above are the requirement.

- [ ] **Step 2: Run, expect FAIL** (`page` is null).

- [ ] **Step 3: Implement.**
  - Replace `activeServers` with ``const allServers = await db.select().from(servers).where(sql`${servers.slug} is not null`);``.
  - Inside the loop, `const live = s.active;`.
  - **Retired (`!live`):**
    - skip the never-played branch, the ban lookup, `anyOpenLife`, `getPlayerProfile`, and the standing card;
    - still add to totals and push ended lives;
    - longest life uses `l.playtimeSeconds` for every row (all are ended after retirement applies).
  - `totals.deaths += livesRows.filter((l) => l.endReason === "death").length;`
  - `endedLives`: `livesRows.filter((r) => r.endedAt !== null)` stays as is (retired lives now have `endedAt`).
  - `pastLives`:
    - push `endReason: l.endReason ?? "death"`;
    - for `server_retired`, set `death: { cause: null, byGamertag: null, weapon: null, distanceMeters: null, verdict: null }`;
    - skip `dossierForLife` (a retirement is not a death to classify).
  - Leave the active-server path byte-for-byte as it is; it is full of ⚠️ ordering rules.

- [ ] **Step 4: Run** `pnpm --filter @onelife/read-models test`, expect PASS, including every existing `player-page` case.

- [ ] **Step 5: Commit:** `fix(read-models): dossier keeps a retired server's history`

---

### Task 6: Notifier skips retired servers

**Files:**
- Modify: `apps/notifier/src/generators/lives.ts:36`
- Test: `apps/notifier/test/generators-lives.test.ts`

- [ ] **Step 1: Failing test.** In that file's fixtures, add a second server `{ nitradoServiceId: 992002, name: "gonesrv", slug: "gonesrv", active: false, retiredAt: new Date("2026-07-18T00:00:00Z") }` with an open life for `LifeOne` that would otherwise trigger a milestone. Assert neither generator yields a notification whose payload names `gonesrv`.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement:** `.where(and(isNull(lives.endedAt), isNotNull(servers.slug), isNull(servers.retiredAt)))`.

- [ ] **Step 4: Run** `pnpm --filter @onelife/notifier test`, expect PASS.

- [ ] **Step 5: Commit:** `fix(notifier): no open-life notifications for retired servers`

---

### Task 7: Life page renders a retired life

**Files:**
- Modify:
  - `packages/client-logic/src/life-timeline.ts`
  - `apps/web/src/components/life/hero.tsx`
  - `apps/web/src/app/(site)/(boxed)/players/[slug]/[map]/lives/[n]/opengraph-image.tsx`
- Test: `packages/client-logic/src/life-timeline.test.ts`, `apps/web/src/components/life/hero.test.tsx`

**Interfaces:**
- Consumes: `Life.endReason` (Task 4).
- Produces: `TimelineEvent` variant `{ kind: "retired"; at: Date; marker: "gray"; timeLabel: string; title: string; line: string }`.

- [ ] **Step 1: Failing tests.**
  - `life-timeline.test.ts`: given fixture data with `life.endedAt` set and `life.endReason: "server_retired"`, `buildTimeline(...)` has `alive === false`, no `death` event, and a terminal event `{ kind: "retired", title: "Alive when the server closed" }`.
  - `hero.test.tsx`: the same data renders status `RETIRED`, not `DEAD`, and no cause line.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.**
  - `life-timeline.ts`: in the terminal branch, before the death push:

```ts
} else if (data.life.endReason === "server_retired") {
  events.push({ kind: "retired", at: endedAt!, marker: "gray", timeLabel: `${elapsedLabel(timeAlive)} in`, title: "Alive when the server closed", line: formatDuration(timeAlive) });
} else {
```

  - Add the variant to `TimelineEvent`. The timeline component renders title/line kinds through its generic branch; confirm `retired` falls into it.
  - `hero.tsx`: `const retired = data?.life.endReason === "server_retired";`. The status value is `alive ? "ALIVE" : retired ? "RETIRED" : "DEAD"` with `hot: !alive && !retired`, and the cause line is guarded with `!retired`.
  - Apply the same status rule in `opengraph-image.tsx` wherever it reads `endedAt`/cause.

- [ ] **Step 4: Run** `pnpm --filter @onelife/client-logic test` and `pnpm --filter @onelife/web test`, expect PASS.

- [ ] **Step 5: Commit:** `feat(web): a life cut off by a server retirement reads as retired`

---

### Task 8: Fleet copy, runbook, changelog

**Files:**
- Modify:
  - `apps/web/src/components/front-page/join-servers.tsx` (`HOSTS`) and its test
  - `apps/newsdesk/src/no-place.ts`
  - `apps/web/src/lib/servers.ts` (delete `MAP_SLUGS`/`MapSlug`)
  - `deploy/README.md`
  - `CHANGELOG.md`

- [ ] **Step 1: `HOSTS`** becomes, A to Z:

```ts
const HOSTS = [
  // Host A–Z, the real browser's default sort. Brand copy: a Nitrado rename must update this.
  { map: "Chernarus", players: "14/26" },
  { map: "Nasdara", players: "9/26" },
];
```

Update `join-servers.test.tsx` expectations to these hosts.

- [ ] **Step 2:** Add `"Nasdara", "nasdara"` to the `no-place.ts` name list. Delete `MAP_SLUGS`; `grep -rn MAP_SLUGS apps packages` must return nothing.

- [ ] **Step 3: `deploy/README.md`.**
  - Rewrite "Enabling ingest" so it points at `fleet-cutover --add …`, and note that `ON CONFLICT (nitrado_service_id)` no longer applies.
  - Add a "Fleet turnover" section with the exact 2026-10-15 sequence:
    1. dry run;
    2. `--apply`;
    3. switch maps on Nitrado (after, never before);
    4. watch `journalctl -u onelife-ingest` for `"servers":3` and new deaths on the new rows.
  - Include the post-deploy Sakhal step: `--retire sakhal --retired-at <last ingested Sakhal event>`, with the query that finds it (`SELECT max(occurred_at) FROM events WHERE server_id = 2`).
  - All `DATABASE_URL` passed explicitly.

- [ ] **Step 4: Full suite and typecheck**

```bash
pnpm turbo run typecheck
pnpm turbo run test --concurrency=1
```

Expected: all green. Report any failure verbatim; do not proceed past one.

- [ ] **Step 5: `CHANGELOG.md`** Unreleased entry (no em dashes): the dossier fix for retired-server history, the read-time retirement, `ingest_from`, `fleet-cutover`, and the replica hosts. Commit it last, separately, before opening the PR via `keel:finish-work`.
