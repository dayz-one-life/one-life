# UGC Report and Block — Server Half — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server half of avatar reporting, content-hash takedown, viewer-scoped user blocking, and a moderator review API.

**Architecture:** Three new tables. Reporting an avatar snapshots its content hash and immediately bans that hash, so the image stops serving for *every* user holding those bytes. Blocking is separate and viewer-scoped. Moderator authority comes from an env var, not a database role.

**Tech Stack:** Fastify 5, Drizzle ORM + Postgres, zod, vitest. DB-backed tests via `@onelife/test-support`.

**Spec:** [`docs/superpowers/specs/2026-08-17-ugc-report-block-design.md`](../specs/2026-08-17-ugc-report-block-design.md)

## Global Constraints

- **Every new FK to `user.id` MUST be `ON DELETE CASCADE`.** A non-cascading reference makes `deleteAccount` raise Postgres `23503` for anyone who has reported or blocked. This exact bug class shipped in 2a via `verification_challenges` and was caught only by running deletion against a real database.
- **`blocked_avatar_hashes` has NO foreign key to `user`.** A ban must survive the uploader deleting their account, or deletion becomes a way to un-ban your own image.
- **Blocking is viewer-scoped; banning is global.** A block must never 404 an avatar for third parties — that would hand every user a unilateral takedown button.
- **Only users with a `status = 'verified'` gamertag link may report.** Single-report auto-hide is only tolerable because of this gate.
- **`MODERATOR_USER_IDS` empty means nobody is a moderator** and every moderation route 403s. Never fail open.
- Report `reason` is validated as an exact enum: `sexual`, `violent`, `hate`, `illegal`, `impersonation`, `other`. Anything else is a 400.
- Report cap: **10 per reporter per rolling 24 hours**, counted from `avatar_reports.createdAt`; the 11th is a 429.
- Routes take the actor from the session and never a subject parameter for the *actor* — `/me/...` shape, matching `DELETE /me`.
- DB-backed tests need `TEST_DATABASE_URL` and a running Postgres. They do not run in a bare worktree.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/db/src/schema.ts` | Three new table definitions (modify) |
| `packages/db/drizzle/0034_ugc_moderation.sql` | Migration (create) |
| `apps/api/src/lib/avatar-store.ts` | `getAvatarByHash` respects bans; ban/unban/confirm helpers (modify) |
| `apps/api/src/lib/moderation.ts` | Report and block business logic (create) |
| `apps/api/src/routes/reports.ts` | `POST /me/reports/avatar` (create) |
| `apps/api/src/routes/blocks.ts` | `GET/POST/DELETE /me/blocks` (create) |
| `apps/api/src/routes/moderation.ts` | Moderator queue and actions (create) |
| `apps/api/src/auth-plugin.ts` | `requireModerator` (modify) |
| `apps/api/src/config.ts` | `MODERATOR_USER_IDS` (modify) |
| `apps/api/src/app.ts` | Route registration (modify) |

---

### Task 1: Schema and migration

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/drizzle/0034_ugc_moderation.sql`

**Interfaces:**
- Consumes: nothing
- Produces: `avatarReports`, `blockedAvatarHashes`, `userBlocks` exported from `@onelife/db`

- [ ] **Step 1: Add the three tables to `packages/db/src/schema.ts`**

Append after the `avatars` table definition (around line 360). Note `bigserial`, `text`, `timestamp`, `index`, `uniqueIndex` and `primaryKey` are already imported in this file; add `primaryKey` to the drizzle-orm/pg-core import if it is not present.

```ts
// ── UGC moderation (App Store guideline 1.2). Avatars are the only user-authored content:
// players/lives are projected from telemetry, obituaries are generated, and a gamertag is an
// Xbox identity proven by in-game emote verification. ──

/**
 * A report against another user's avatar.
 *
 * `subjectHash` is SNAPSHOTTED at report time: the subject can swap their avatar the instant
 * they are reported, and the report must still name what was actually seen.
 */
export const avatarReports = pgTable("avatar_reports", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  // ⚠️ Both FKs cascade. A non-cascading reference to user.id makes deleteAccount raise 23503
  // for anyone who has ever reported or been reported.
  reporterUserId: text("reporter_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  subjectUserId: text("subject_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  subjectHash: text("subject_hash").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqReporterSubject: uniqueIndex("avatar_reports_reporter_subject_uniq").on(t.reporterUserId, t.subjectUserId),
  byHash: index("avatar_reports_hash_idx").on(t.subjectHash),
  // Supports the rolling 24h cap count.
  byReporterCreated: index("avatar_reports_reporter_created_idx").on(t.reporterUserId, t.createdAt),
}));

/**
 * Banned avatar bytes, keyed by content hash.
 *
 * ⚠️ Keyed by HASH, not by user. `getAvatarByHash` matches on hash across ALL users, so
 * tombstoning one user's row does not stop the bytes serving if another user holds the same
 * image — which is exactly the coordinated-abuse case. One row here stops it for everyone.
 *
 * ⚠️ NO foreign key to `user`. A ban must survive the uploader deleting their account,
 * otherwise account deletion becomes a way to un-ban your own image.
 */
export const blockedAvatarHashes = pgTable("blocked_avatar_hashes", {
  hash: text("hash").primaryKey(),
  state: text("state").notNull().default("auto"),   // 'auto' (report-triggered) | 'confirmed' (moderator)
  blockedAt: timestamp("blocked_at", { withTimezone: true }).notNull().defaultNow(),
  // NULL means automatic. Deliberately NOT an FK: a moderator could later delete their account.
  blockedByUserId: text("blocked_by_user_id"),
});

/**
 * One user blocking another. VIEWER-SCOPED: this hides the blocked user's avatar from the
 * blocker only, and severs location shares both ways. It must NEVER 404 the avatar globally —
 * that would hand every user a unilateral takedown button.
 */
export const userBlocks = pgTable("user_blocks", {
  blockerUserId: text("blocker_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  blockedUserId: text("blocked_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.blockerUserId, t.blockedUserId] }),
}));
```

- [ ] **Step 2: Generate the migration**

```bash
cd packages/db && pnpm run db:generate
```

Rename the generated file to `0034_ugc_moderation.sql` if drizzle-kit picked a different name, and update `packages/db/drizzle/meta/_journal.json` to match. Read the generated SQL and confirm all four `REFERENCES ... ON DELETE CASCADE` clauses are present on `avatar_reports` (2) and `user_blocks` (2), and that `blocked_avatar_hashes` has **no** REFERENCES clause at all.

- [ ] **Step 3: Apply the migration**

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate
```

Expected: applies cleanly, no error.

- [ ] **Step 4: Verify typecheck passes**

```bash
pnpm --filter @onelife/db run typecheck
```

Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle
git commit -m "feat(db): add avatar_reports, blocked_avatar_hashes and user_blocks"
```

---

### Task 2: Hash bans in avatar serving

This is the load-bearing task. The test in Step 1 is the one that justifies the whole design.

**Files:**
- Modify: `apps/api/src/lib/avatar-store.ts`
- Test: `apps/api/test/avatar-hash-ban.test.ts` (create)

**Interfaces:**
- Consumes: `blockedAvatarHashes`, `avatars` from `@onelife/db`
- Produces:
  - `banAvatarHash(db: Database, hash: string, opts?: { state?: "auto" | "confirmed"; byUserId?: string }): Promise<void>`
  - `unbanAvatarHash(db: Database, hash: string): Promise<void>`
  - `confirmAvatarHashBan(db: Database, hash: string, byUserId: string): Promise<void>`
  - `isAvatarHashBanned(db: Database, hash: string): Promise<boolean>`
  - existing `getAvatarByHash(db, hash)` now returns `null` for banned hashes

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/avatar-hash-ban.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { avatars, blockedAvatarHashes, user } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getAvatarByHash, banAvatarHash, unbanAvatarHash, confirmAvatarHashBan } from "../src/lib/avatar-store.js";

const { db, sql } = getTestDb();

const HASH = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const BYTES = Buffer.from([0x52, 0x49, 0x46, 0x46]);

async function seedUser(id: string) {
  await db.insert(user).values({
    id, name: `user-${id}`, email: `${id}@example.test`, emailVerified: true,
    createdAt: new Date(), updatedAt: new Date(),
  });
}

async function seedAvatar(userId: string, hash: string) {
  await db.insert(avatars).values({
    userId, image: BYTES, hash, source: "upload", updatedAt: new Date(),
  });
}

beforeEach(async () => {
  await db.delete(blockedAvatarHashes);
  await db.delete(avatars);
  await db.delete(user);
});

afterAll(async () => { await sql.end(); });

describe("avatar hash bans", () => {
  // ⚠️ THE test. getAvatarByHash matches on hash across ALL users and returns the first row
  // with a non-null image, so a per-user "hidden" flag would leave these bytes serving at the
  // same URL via the other user's row. That is exactly the coordinated-abuse case: the same
  // image uploaded from two accounts. If this fails, takedown has a hole in it.
  it("stops serving bytes held by TWO users, not just the reported one", async () => {
    await seedUser("alice");
    await seedUser("bob");
    await seedAvatar("alice", HASH);
    await seedAvatar("bob", HASH);

    expect(await getAvatarByHash(db, HASH)).not.toBeNull();

    await banAvatarHash(db, HASH);

    expect(await getAvatarByHash(db, HASH)).toBeNull();
  });

  it("restores serving when the ban is lifted", async () => {
    await seedUser("alice");
    await seedAvatar("alice", HASH);
    await banAvatarHash(db, HASH);
    expect(await getAvatarByHash(db, HASH)).toBeNull();

    await unbanAvatarHash(db, HASH);

    expect(await getAvatarByHash(db, HASH)).not.toBeNull();
  });

  // Confirm is the destructive half: it NULLs the bytes for EVERY row holding the hash, using
  // the existing "removal tombstone" meaning of avatars.image.
  it("confirming destroys the bytes for every row sharing the hash", async () => {
    await seedUser("alice");
    await seedUser("bob");
    await seedAvatar("alice", HASH);
    await seedAvatar("bob", HASH);
    await banAvatarHash(db, HASH);

    await confirmAvatarHashBan(db, HASH, "moderator-1");

    const rows = await db.select({ image: avatars.image, hash: avatars.hash }).from(avatars);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.image).toBeNull();
      expect(r.hash).toBeNull();
    }
    const [ban] = await db.select().from(blockedAvatarHashes).where(eq(blockedAvatarHashes.hash, HASH));
    expect(ban?.state).toBe("confirmed");
    expect(ban?.blockedByUserId).toBe("moderator-1");
  });

  it("banning an already-banned hash is idempotent", async () => {
    await banAvatarHash(db, HASH);
    await banAvatarHash(db, HASH);
    const rows = await db.select().from(blockedAvatarHashes).where(eq(blockedAvatarHashes.hash, HASH));
    expect(rows).toHaveLength(1);
  });

  // A confirmed ban must not be silently downgraded to 'auto' by a later report.
  it("does not downgrade a confirmed ban back to auto", async () => {
    await banAvatarHash(db, HASH);
    await confirmAvatarHashBan(db, HASH, "moderator-1");
    await banAvatarHash(db, HASH);
    const [ban] = await db.select().from(blockedAvatarHashes).where(eq(blockedAvatarHashes.hash, HASH));
    expect(ban?.state).toBe("confirmed");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/api && TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run test/avatar-hash-ban.test.ts
```

Expected: FAIL — `banAvatarHash` is not exported from `avatar-store.ts`.

- [ ] **Step 3: Implement in `apps/api/src/lib/avatar-store.ts`**

Add `blockedAvatarHashes` to the `@onelife/db` import and `notExists`/`sql` to the drizzle-orm import, then modify `getAvatarByHash` (currently at line 51) and add the four helpers:

```ts
export async function getAvatarByHash(db: Database, hash: string): Promise<Buffer | null> {
  // ⚠️ The ban check is what makes takedown global. Because this function matches on hash
  // across all users, one banned-hash row stops the bytes serving for every user who holds
  // them — which is the point: two accounts uploading the same abusive image is the case a
  // per-user flag would leak.
  const [row] = await db
    .select({ image: avatars.image })
    .from(avatars)
    .where(and(
      eq(avatars.hash, hash),
      isNotNull(avatars.image),
      notExists(db.select({ one: sql`1` }).from(blockedAvatarHashes).where(eq(blockedAvatarHashes.hash, hash))),
    ));
  return row?.image ?? null;
}

/**
 * Ban avatar bytes by content hash. Idempotent, and NEVER downgrades a moderator-confirmed
 * ban back to 'auto' — a later automatic report must not weaken a human decision.
 */
export async function banAvatarHash(
  db: Database,
  hash: string,
  opts?: { state?: "auto" | "confirmed"; byUserId?: string },
): Promise<void> {
  await db
    .insert(blockedAvatarHashes)
    .values({ hash, state: opts?.state ?? "auto", blockedByUserId: opts?.byUserId ?? null })
    .onConflictDoNothing({ target: blockedAvatarHashes.hash });
}

/** Lift a ban. The bytes serve again; nothing was destroyed. */
export async function unbanAvatarHash(db: Database, hash: string): Promise<void> {
  await db.delete(blockedAvatarHashes).where(eq(blockedAvatarHashes.hash, hash));
}

/**
 * The destructive half of takedown, and the only step a human performs. Keeps the ban and
 * NULLs the bytes for EVERY row holding this hash, using the existing removal-tombstone
 * meaning of `avatars.image` (image, hash and source all NULL).
 */
export async function confirmAvatarHashBan(db: Database, hash: string, byUserId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(blockedAvatarHashes)
      .values({ hash, state: "confirmed", blockedByUserId: byUserId })
      .onConflictDoUpdate({
        target: blockedAvatarHashes.hash,
        set: { state: "confirmed", blockedByUserId: byUserId },
      });
    await tx
      .update(avatars)
      .set({ image: null, hash: null, source: null, updatedAt: new Date() })
      .where(eq(avatars.hash, hash));
  });
}

export async function isAvatarHashBanned(db: Database, hash: string): Promise<boolean> {
  const [row] = await db.select({ hash: blockedAvatarHashes.hash }).from(blockedAvatarHashes).where(eq(blockedAvatarHashes.hash, hash));
  return Boolean(row);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/api && TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run test/avatar-hash-ban.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Run the existing avatar tests to check nothing regressed**

```bash
cd apps/api && TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run test/avatar-store.test.ts test/avatar-routes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/avatar-store.ts apps/api/test/avatar-hash-ban.test.ts
git commit -m "feat(api): ban avatar bytes by content hash"
```

---

### Task 3: Report logic and route

**Files:**
- Create: `apps/api/src/lib/moderation.ts`
- Create: `apps/api/src/routes/reports.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/avatar-reports.test.ts` (create)

**Interfaces:**
- Consumes: `banAvatarHash` from `../lib/avatar-store.js`; `getSession` from `../auth-plugin.js`
- Produces:
  - `REPORT_REASONS` — readonly tuple `["sexual","violent","hate","illegal","impersonation","other"]`
  - `reportAvatar(db: Database, reporterUserId: string, subjectUserId: string, reason: string): Promise<{ ok: true } | { error: "not_verified" | "no_avatar" | "already_reported" | "rate_limited" | "self" }>`
  - `registerReportRoutes(app: FastifyInstance, db: Database, auth: Auth): void`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/avatar-reports.test.ts`:

```ts
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { avatars, avatarReports, blockedAvatarHashes, gamertagLinks, user } from "@onelife/db";
import { reportAvatar } from "../src/lib/moderation.js";
import { getAvatarByHash } from "../src/lib/avatar-store.js";

const { db, sql } = getTestDb();
const HASH = "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111";
const BYTES = Buffer.from([1, 2, 3, 4]);

async function seedUser(id: string) {
  await db.insert(user).values({
    id, name: `user-${id}`, email: `${id}@example.test`, emailVerified: true,
    createdAt: new Date(), updatedAt: new Date(),
  });
}
async function seedVerified(id: string, gamertag: string) {
  await db.insert(gamertagLinks).values({
    userId: id, gamertag, status: "verified", verifiedAt: new Date(), createdAt: new Date(),
  });
}
async function seedAvatar(userId: string, hash: string) {
  await db.insert(avatars).values({ userId, image: BYTES, hash, source: "upload", updatedAt: new Date() });
}

beforeEach(async () => {
  await db.delete(avatarReports);
  await db.delete(blockedAvatarHashes);
  await db.delete(avatars);
  await db.delete(gamertagLinks);
  await db.delete(user);
});
afterAll(async () => { await sql.end(); });

describe("reportAvatar", () => {
  it("bans the subject's hash immediately on the first report", async () => {
    await seedUser("reporter"); await seedVerified("reporter", "ReporterTag");
    await seedUser("subject"); await seedAvatar("subject", HASH);

    expect(await getAvatarByHash(db, HASH)).not.toBeNull();
    const res = await reportAvatar(db, "reporter", "subject", "hate");

    expect(res).toEqual({ ok: true });
    expect(await getAvatarByHash(db, HASH)).toBeNull();
  });

  // ⚠️ The abuse gate. Single-report auto-hide is only tolerable because reporting costs a
  // verified Xbox identity (proven by in-game emote), not a throwaway signup.
  it("rejects a reporter with no verified gamertag link", async () => {
    await seedUser("reporter");
    await seedUser("subject"); await seedAvatar("subject", HASH);

    expect(await reportAvatar(db, "reporter", "subject", "hate")).toEqual({ error: "not_verified" });
    expect(await getAvatarByHash(db, HASH)).not.toBeNull();
  });

  it("rejects a reporter whose link is only pending", async () => {
    await seedUser("reporter");
    await db.insert(gamertagLinks).values({
      userId: "reporter", gamertag: "Pending", status: "pending", createdAt: new Date(),
    });
    await seedUser("subject"); await seedAvatar("subject", HASH);

    expect(await reportAvatar(db, "reporter", "subject", "hate")).toEqual({ error: "not_verified" });
  });

  // Nothing to snapshot means a report that can never be reviewed.
  it("refuses to report a subject with no avatar", async () => {
    await seedUser("reporter"); await seedVerified("reporter", "ReporterTag");
    await seedUser("subject");

    expect(await reportAvatar(db, "reporter", "subject", "hate")).toEqual({ error: "no_avatar" });
  });

  it("refuses a second report from the same reporter against the same subject", async () => {
    await seedUser("reporter"); await seedVerified("reporter", "ReporterTag");
    await seedUser("subject"); await seedAvatar("subject", HASH);

    await reportAvatar(db, "reporter", "subject", "hate");
    expect(await reportAvatar(db, "reporter", "subject", "other")).toEqual({ error: "already_reported" });

    const rows = await db.select().from(avatarReports);
    expect(rows).toHaveLength(1);
  });

  it("refuses to report yourself", async () => {
    await seedUser("reporter"); await seedVerified("reporter", "ReporterTag");
    await seedAvatar("reporter", HASH);

    expect(await reportAvatar(db, "reporter", "reporter", "hate")).toEqual({ error: "self" });
  });

  // A second reporter on an already-banned hash records their report but must not create a
  // duplicate ban row — the moderator should see accumulated reports, not duplicate entries.
  it("is idempotent against an already-banned hash", async () => {
    await seedUser("r1"); await seedVerified("r1", "TagOne");
    await seedUser("r2"); await seedVerified("r2", "TagTwo");
    await seedUser("subject"); await seedAvatar("subject", HASH);

    await reportAvatar(db, "r1", "subject", "hate");
    expect(await reportAvatar(db, "r2", "subject", "sexual")).toEqual({ ok: true });

    expect(await db.select().from(avatarReports)).toHaveLength(2);
    expect(await db.select().from(blockedAvatarHashes)).toHaveLength(1);
  });

  it("caps a reporter at 10 reports per rolling 24 hours", async () => {
    await seedUser("reporter"); await seedVerified("reporter", "ReporterTag");
    for (let i = 0; i < 10; i++) {
      await seedUser(`s${i}`);
      await seedAvatar(`s${i}`, `hash-${i}`.padEnd(64, "0"));
      expect(await reportAvatar(db, "reporter", `s${i}`, "other")).toEqual({ ok: true });
    }
    await seedUser("s10");
    await seedAvatar("s10", "hash-10".padEnd(64, "0"));

    expect(await reportAvatar(db, "reporter", "s10", "other")).toEqual({ error: "rate_limited" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/api && TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run test/avatar-reports.test.ts
```

Expected: FAIL — cannot resolve `../src/lib/moderation.js`.

- [ ] **Step 3: Create `apps/api/src/lib/moderation.ts`**

```ts
import { and, eq, gte, sql } from "drizzle-orm";
import type { Database } from "@onelife/db";
import { avatars, avatarReports, gamertagLinks } from "@onelife/db";
import { banAvatarHash } from "./avatar-store.js";

/**
 * ⚠️ A FIXED list, deliberately not free text. A free-text reason field would itself be a UGC
 * surface — adding one to the moderation feature would be self-defeating.
 */
export const REPORT_REASONS = ["sexual", "violent", "hate", "illegal", "impersonation", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** A runaway-abuse backstop, not a usage limit. A good-faith reporter should never meet it. */
const REPORTS_PER_DAY = 10;

export type ReportOutcome =
  | { ok: true }
  | { error: "not_verified" | "no_avatar" | "already_reported" | "rate_limited" | "self" };

/**
 * Record a report and ban the reported bytes immediately.
 *
 * ⚠️ Auto-hide is what makes App Store guideline 1.2's "timely response" survivable for a solo
 * operator: the MACHINE meets the 24 hours, so review can lag without objectionable content
 * staying up. It is only safe because reporting requires a verified gamertag — an Xbox identity
 * proven by in-game emote — so a reporter cannot be a throwaway signup.
 */
export async function reportAvatar(
  db: Database,
  reporterUserId: string,
  subjectUserId: string,
  reason: string,
): Promise<ReportOutcome> {
  if (reporterUserId === subjectUserId) return { error: "self" };

  const [verified] = await db
    .select({ id: gamertagLinks.id })
    .from(gamertagLinks)
    .where(and(eq(gamertagLinks.userId, reporterUserId), eq(gamertagLinks.status, "verified")));
  if (!verified) return { error: "not_verified" };

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(avatarReports)
    .where(and(eq(avatarReports.reporterUserId, reporterUserId), gte(avatarReports.createdAt, since)));
  if (count >= REPORTS_PER_DAY) return { error: "rate_limited" };

  // Snapshot the hash NOW: the subject can swap their avatar the instant they are reported,
  // and the report must still name what was actually seen.
  const [subject] = await db
    .select({ hash: avatars.hash })
    .from(avatars)
    .where(eq(avatars.userId, subjectUserId));
  if (!subject?.hash) return { error: "no_avatar" };

  const inserted = await db
    .insert(avatarReports)
    .values({ reporterUserId, subjectUserId, subjectHash: subject.hash, reason })
    .onConflictDoNothing({ target: [avatarReports.reporterUserId, avatarReports.subjectUserId] })
    .returning({ id: avatarReports.id });
  if (inserted.length === 0) return { error: "already_reported" };

  // Idempotent: a second reporter on the same hash records their report without creating a
  // duplicate ban row, and never downgrades a moderator-confirmed ban.
  await banAvatarHash(db, subject.hash);
  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/api && TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run test/avatar-reports.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Create the route in `apps/api/src/routes/reports.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@onelife/db";
import type { Auth } from "@onelife/auth";
import { getSession } from "../auth-plugin.js";
import { REPORT_REASONS, reportAvatar } from "../lib/moderation.js";

const bodySchema = z.object({
  subjectUserId: z.string().min(1),
  reason: z.enum(REPORT_REASONS),
});

const STATUS: Record<string, number> = {
  not_verified: 403, no_avatar: 409, already_reported: 409, rate_limited: 429, self: 400,
};

export function registerReportRoutes(app: FastifyInstance, db: Database, auth: Auth): void {
  app.post("/me/reports/avatar", async (request, reply) => {
    // ⚠️ Session first, body second — reversed, an unauthenticated caller could tell a valid
    // session from an invalid one by the status code.
    const session = await getSession(auth, request);
    if (!session) return reply.code(401).send({ error: "unauthorized" });

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });

    const result = await reportAvatar(db, session.user.id, parsed.data.subjectUserId, parsed.data.reason);
    if ("error" in result) return reply.code(STATUS[result.error] ?? 400).send({ error: result.error });
    return reply.code(201).send({ ok: true });
  });
}
```

- [ ] **Step 6: Register the route in `apps/api/src/app.ts`**

Add the import beside the other route imports:

```ts
import { registerReportRoutes } from "./routes/reports.js";
```

And inside the `if (opts)` block, after `registerAvatarRoutes(...)`:

```ts
registerReportRoutes(app, db, opts.auth);
```

- [ ] **Step 7: Run the full api suite**

```bash
cd apps/api && TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/lib/moderation.ts apps/api/src/routes/reports.ts apps/api/src/app.ts apps/api/test/avatar-reports.test.ts
git commit -m "feat(api): report an avatar, auto-hiding it pending review"
```

---

### Task 4: User blocks

**Files:**
- Modify: `apps/api/src/lib/moderation.ts`
- Create: `apps/api/src/routes/blocks.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/user-blocks.test.ts` (create)

**Interfaces:**
- Consumes: `getSession` from `../auth-plugin.js`
- Produces:
  - `blockUser(db, blockerUserId, blockedUserId): Promise<{ ok: true } | { error: "self" }>`
  - `unblockUser(db, blockerUserId, blockedUserId): Promise<void>`
  - `listBlockedUserIds(db, blockerUserId): Promise<string[]>`
  - `isBlockedEitherWay(db, a: string, b: string): Promise<boolean>`
  - `registerBlockRoutes(app, db, auth): void`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/user-blocks.test.ts`:

```ts
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { avatars, blockedAvatarHashes, user, userBlocks } from "@onelife/db";
import { blockUser, unblockUser, listBlockedUserIds, isBlockedEitherWay } from "../src/lib/moderation.js";
import { getAvatarByHash } from "../src/lib/avatar-store.js";

const { db, sql } = getTestDb();
const HASH = "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222";

async function seedUser(id: string) {
  await db.insert(user).values({
    id, name: `user-${id}`, email: `${id}@example.test`, emailVerified: true,
    createdAt: new Date(), updatedAt: new Date(),
  });
}

beforeEach(async () => {
  await db.delete(userBlocks);
  await db.delete(blockedAvatarHashes);
  await db.delete(avatars);
  await db.delete(user);
});
afterAll(async () => { await sql.end(); });

describe("user blocks", () => {
  it("records a block and lists it", async () => {
    await seedUser("alice"); await seedUser("bob");
    expect(await blockUser(db, "alice", "bob")).toEqual({ ok: true });
    expect(await listBlockedUserIds(db, "alice")).toEqual(["bob"]);
  });

  it("is idempotent", async () => {
    await seedUser("alice"); await seedUser("bob");
    await blockUser(db, "alice", "bob");
    await blockUser(db, "alice", "bob");
    expect(await listBlockedUserIds(db, "alice")).toEqual(["bob"]);
  });

  it("refuses to block yourself", async () => {
    await seedUser("alice");
    expect(await blockUser(db, "alice", "alice")).toEqual({ error: "self" });
  });

  it("unblocks", async () => {
    await seedUser("alice"); await seedUser("bob");
    await blockUser(db, "alice", "bob");
    await unblockUser(db, "alice", "bob");
    expect(await listBlockedUserIds(db, "alice")).toEqual([]);
  });

  // Location shares are severed in BOTH directions from a one-way block.
  it("reports a block in either direction", async () => {
    await seedUser("alice"); await seedUser("bob");
    await blockUser(db, "alice", "bob");
    expect(await isBlockedEitherWay(db, "alice", "bob")).toBe(true);
    expect(await isBlockedEitherWay(db, "bob", "alice")).toBe(true);
  });

  it("does not report unrelated users as blocked", async () => {
    await seedUser("alice"); await seedUser("bob"); await seedUser("carol");
    await blockUser(db, "alice", "bob");
    expect(await isBlockedEitherWay(db, "alice", "carol")).toBe(false);
  });

  // ⚠️ THE dangerous confusion. Blocking is VIEWER-SCOPED; banning is global. If blocking ever
  // 404s an avatar for third parties, every user has a unilateral takedown button.
  it("blocking does NOT hide the blocked user's avatar from anyone else", async () => {
    await seedUser("alice"); await seedUser("bob");
    await db.insert(avatars).values({
      userId: "bob", image: Buffer.from([9, 9]), hash: HASH, source: "upload", updatedAt: new Date(),
    });

    await blockUser(db, "alice", "bob");

    // The bytes still serve globally — only alice's rendering filters them out, which is a
    // display-layer concern, not a serving-layer one.
    expect(await getAvatarByHash(db, HASH)).not.toBeNull();
    expect(await db.select().from(blockedAvatarHashes)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/api && TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run test/user-blocks.test.ts
```

Expected: FAIL — `blockUser` is not exported from `moderation.ts`.

- [ ] **Step 3: Append to `apps/api/src/lib/moderation.ts`**

Add `userBlocks` to the `@onelife/db` import and `or` to the drizzle-orm import, then:

```ts
/**
 * Block another user. ⚠️ VIEWER-SCOPED: this hides the blocked user's avatar from the blocker
 * and severs location shares both ways. It must NEVER stop those bytes serving globally —
 * that is what a hash ban is for, and confusing the two would hand every user a unilateral
 * takedown button.
 *
 * Not symmetric and not notified: a block that notifies is a block that invites retaliation.
 */
export async function blockUser(
  db: Database,
  blockerUserId: string,
  blockedUserId: string,
): Promise<{ ok: true } | { error: "self" }> {
  if (blockerUserId === blockedUserId) return { error: "self" };
  await db
    .insert(userBlocks)
    .values({ blockerUserId, blockedUserId })
    .onConflictDoNothing({ target: [userBlocks.blockerUserId, userBlocks.blockedUserId] });
  return { ok: true };
}

export async function unblockUser(db: Database, blockerUserId: string, blockedUserId: string): Promise<void> {
  await db
    .delete(userBlocks)
    .where(and(eq(userBlocks.blockerUserId, blockerUserId), eq(userBlocks.blockedUserId, blockedUserId)));
}

export async function listBlockedUserIds(db: Database, blockerUserId: string): Promise<string[]> {
  const rows = await db
    .select({ id: userBlocks.blockedUserId })
    .from(userBlocks)
    .where(eq(userBlocks.blockerUserId, blockerUserId));
  return rows.map((r) => r.id);
}

/**
 * Does a block exist in EITHER direction? Location sharing uses this: a one-way block severs
 * the connection both ways, so blocking someone also stops you seeing them.
 */
export async function isBlockedEitherWay(db: Database, a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ blocker: userBlocks.blockerUserId })
    .from(userBlocks)
    .where(or(
      and(eq(userBlocks.blockerUserId, a), eq(userBlocks.blockedUserId, b)),
      and(eq(userBlocks.blockerUserId, b), eq(userBlocks.blockedUserId, a)),
    ));
  return Boolean(row);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/api && TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run test/user-blocks.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Create `apps/api/src/routes/blocks.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@onelife/db";
import type { Auth } from "@onelife/auth";
import { getSession } from "../auth-plugin.js";
import { blockUser, unblockUser, listBlockedUserIds } from "../lib/moderation.js";

const bodySchema = z.object({ userId: z.string().min(1) });

export function registerBlockRoutes(app: FastifyInstance, db: Database, auth: Auth): void {
  app.get("/me/blocks", async (request, reply) => {
    const session = await getSession(auth, request);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    return { blockedUserIds: await listBlockedUserIds(db, session.user.id) };
  });

  app.post("/me/blocks", async (request, reply) => {
    const session = await getSession(auth, request);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    const result = await blockUser(db, session.user.id, parsed.data.userId);
    if ("error" in result) return reply.code(400).send({ error: result.error });
    return reply.code(201).send({ ok: true });
  });

  app.delete("/me/blocks/:userId", async (request, reply) => {
    const session = await getSession(auth, request);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const { userId } = request.params as { userId: string };
    await unblockUser(db, session.user.id, userId);
    return { ok: true };
  });
}
```

- [ ] **Step 6: Register in `apps/api/src/app.ts`**

Import beside the other route imports:

```ts
import { registerBlockRoutes } from "./routes/blocks.js";
```

And inside the `if (opts)` block, after `registerReportRoutes(...)`:

```ts
registerBlockRoutes(app, db, opts.auth);
```

- [ ] **Step 7: Run the full api suite**

```bash
cd apps/api && TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/lib/moderation.ts apps/api/src/routes/blocks.ts apps/api/src/app.ts apps/api/test/user-blocks.test.ts
git commit -m "feat(api): viewer-scoped user blocking"
```

---

### Task 5: Location-share filtering

**Files:**
- Modify: `apps/api/src/routes/map-share.ts:137` (the `POST /me/maps/:mapSlug/shares` grant handler)
- Test: `apps/api/test/map-share-blocks.test.ts` (create)

**Interfaces:**
- Consumes: `isBlockedEitherWay` from `../lib/moderation.js`
- Produces: grant rejected with 403 `{ error: "blocked" }` when a block exists in either direction

- [ ] **Step 1: Read the existing grant handler**

```bash
sed -n '137,180p' apps/api/src/routes/map-share.ts
```

Note how it resolves the grantee (by gamertag) to a user id, and where the insert happens. The block check goes immediately after the grantee user id is known and before the insert.

- [ ] **Step 2: Write the failing test**

Create `apps/api/test/map-share-blocks.test.ts`. Model the setup on the existing `apps/api/test/map-share-routes.test.ts` — read it first and reuse its seeding helpers and auth fixture verbatim rather than inventing new ones. The assertions to add:

```ts
it("refuses a location share to someone the granter has blocked", async () => {
  // granter blocks grantee, then tries to share
  await blockUser(db, granterUserId, granteeUserId);
  const res = await app.inject({
    method: "POST", url: `/me/maps/${mapSlug}/shares`,
    headers: authHeaders(granterUserId), payload: { gamertag: granteeGamertag },
  });
  expect(res.statusCode).toBe(403);
  expect(res.json()).toEqual({ error: "blocked" });
});

// A one-way block severs the connection both ways: being blocked also stops you sharing.
it("refuses a location share to someone who has blocked the granter", async () => {
  await blockUser(db, granteeUserId, granterUserId);
  const res = await app.inject({
    method: "POST", url: `/me/maps/${mapSlug}/shares`,
    headers: authHeaders(granterUserId), payload: { gamertag: granteeGamertag },
  });
  expect(res.statusCode).toBe(403);
});

it("still allows a share between users with no block", async () => {
  const res = await app.inject({
    method: "POST", url: `/me/maps/${mapSlug}/shares`,
    headers: authHeaders(granterUserId), payload: { gamertag: granteeGamertag },
  });
  expect(res.statusCode).toBeLessThan(300);
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd apps/api && TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run test/map-share-blocks.test.ts
```

Expected: FAIL — the first two return a success status rather than 403.

- [ ] **Step 4: Add the check in `apps/api/src/routes/map-share.ts`**

Import at the top:

```ts
import { isBlockedEitherWay } from "../lib/moderation.js";
```

In the grant handler, immediately after the grantee's user id is resolved and before the insert:

```ts
// A block severs location sharing in BOTH directions — blocking someone also stops them
// sharing with you. Checked here at grant time rather than filtered at read time so the
// granter gets told, rather than silently creating a share that never resolves.
if (await isBlockedEitherWay(db, session.user.id, granteeUserId)) {
  return reply.code(403).send({ error: "blocked" });
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd apps/api && TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run test/map-share-blocks.test.ts test/map-share-routes.test.ts
```

Expected: PASS, both files.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/map-share.ts apps/api/test/map-share-blocks.test.ts
git commit -m "feat(api): refuse location shares between blocked users"
```

---

### Task 6: Moderator config, authorization and review routes

**Files:**
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/auth-plugin.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/routes/me.ts`
- Modify: `.env.example`
- Create: `apps/api/src/routes/moderation.ts`
- Test: `apps/api/test/moderation-routes.test.ts` (create), `apps/api/test/config.test.ts` (modify)

**Interfaces:**
- Consumes: `banAvatarHash`, `unbanAvatarHash`, `confirmAvatarHashBan` from `../lib/avatar-store.js`
- Produces:
  - `Config.moderatorUserIds: string[]`
  - `requireModerator(auth, request, moderatorUserIds): Promise<{ ok: true; userId: string } | { ok: false; status: 401 | 403; error: string }>`
  - `registerModerationRoutes(app, db, auth, moderatorUserIds): void`
  - `GET /me` gains `isModerator: boolean`

- [ ] **Step 1: Write the failing config test**

Append to `apps/api/test/config.test.ts`:

```ts
describe("moderator user ids", () => {
  // ⚠️ Empty means NOBODY is a moderator and every moderation route 403s. Never fail open:
  // the failure mode of a typo must be "moderation is unavailable", never "a stranger can
  // delete avatars".
  it("defaults to an empty list", () => {
    expect(loadConfig(base).moderatorUserIds).toEqual([]);
  });

  it("splits and trims a comma-separated list", () => {
    expect(loadConfig({ ...base, MODERATOR_USER_IDS: "abc, def ,ghi" }).moderatorUserIds)
      .toEqual(["abc", "def", "ghi"]);
  });

  it("drops blank entries rather than admitting an empty id", () => {
    expect(loadConfig({ ...base, MODERATOR_USER_IDS: "abc,,  ,def" }).moderatorUserIds)
      .toEqual(["abc", "def"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/api && TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run test/config.test.ts
```

Expected: FAIL — `moderatorUserIds` is undefined.

- [ ] **Step 3: Implement in `apps/api/src/config.ts`**

Add to the zod schema:

```ts
  // Comma-separated user ids allowed to review reported avatars. UNSET MEANS NOBODY, and every
  // moderation route 403s — never fail open. Blank entries are dropped so a trailing comma
  // cannot admit an empty id, which would match a caller with no session id.
  MODERATOR_USER_IDS: z.string().default(""),
```

Add to the `Config` type:

```ts
  moderatorUserIds: string[];
```

Add to the returned object:

```ts
    moderatorUserIds: p.MODERATOR_USER_IDS.split(",").map((s) => s.trim()).filter(Boolean),
```

- [ ] **Step 4: Run it to verify it passes**

```bash
cd apps/api && TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run test/config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add `requireModerator` to `apps/api/src/auth-plugin.ts`**

Beside the existing `getSession` (line 33):

```ts
/**
 * Resolve the caller only if they are a configured moderator.
 *
 * ⚠️ An empty `moderatorUserIds` denies everyone. Authority comes from an env var rather than a
 * database role deliberately: there is no one to grant roles to and no UI to grant them with, so
 * a role column would be a migration plus hand-written SQL for the same result — with a
 * privilege-escalation path an env var does not have.
 *
 * ⚠️ 401 for signed-out, 403 for signed-in-but-not-a-moderator. Distinguishing them is
 * deliberate: a signed-in user needs to know they are signed in and simply not permitted, and
 * moderator membership is not a secret worth hiding behind a 404.
 *
 * Returns a discriminated result rather than writing to the reply, so each handler stays a
 * plain `return reply.code(...).send(...)` — Fastify's contract is that a handler returns its
 * payload, and a helper that half-writes the reply makes that ambiguous.
 */
export async function requireModerator(
  auth: Auth,
  request: FastifyRequest,
  moderatorUserIds: string[],
): Promise<{ ok: true; userId: string } | { ok: false; status: 401 | 403; error: string }> {
  const session = await getSession(auth, request);
  if (!session) return { ok: false, status: 401, error: "unauthorized" };
  if (!moderatorUserIds.includes(session.user.id)) return { ok: false, status: 403, error: "forbidden" };
  return { ok: true, userId: session.user.id };
}
```

- [ ] **Step 6: Write the failing route test**

Create `apps/api/test/moderation-routes.test.ts`. Model the auth fixture on `apps/api/test/account-delete.test.ts` — read it first and reuse its session-creation helper verbatim. The assertions:

```ts
// ⚠️ The fail-safe direction. An unset env var must lock moderation, not open it.
it("403s for everyone when no moderators are configured", async () => {
  const bare = buildApp(db, { auth, corsOrigins: ["http://localhost"], moderatorUserIds: [] });
  await bare.ready();
  const res = await bare.inject({ method: "GET", url: "/moderation/queue", headers: authHeaders(signedInUserId) });
  expect(res.statusCode).toBe(403);
  await bare.close();
});

it("401s when signed out", async () => {
  const res = await app.inject({ method: "GET", url: "/moderation/queue" });
  expect(res.statusCode).toBe(401);
});

it("403s for a signed-in non-moderator", async () => {
  const res = await app.inject({ method: "GET", url: "/moderation/queue", headers: authHeaders(ordinaryUserId) });
  expect(res.statusCode).toBe(403);
});

it("returns the queue for a moderator, newest first, with report context", async () => {
  const res = await app.inject({ method: "GET", url: "/moderation/queue", headers: authHeaders(moderatorUserId) });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.entries[0]).toMatchObject({ hash: HASH, state: "auto", reportCount: 1 });
  expect(body.entries[0].reasons).toEqual(["hate"]);
});

it("restores a banned hash", async () => {
  const res = await app.inject({
    method: "POST", url: `/moderation/hashes/${HASH}/restore`, headers: authHeaders(moderatorUserId),
  });
  expect(res.statusCode).toBe(200);
  expect(await getAvatarByHash(db, HASH)).not.toBeNull();
});

it("confirms a ban, destroying the bytes", async () => {
  const res = await app.inject({
    method: "POST", url: `/moderation/hashes/${HASH}/confirm`, headers: authHeaders(moderatorUserId),
  });
  expect(res.statusCode).toBe(200);
  const [row] = await db.select({ image: avatars.image }).from(avatars).where(eq(avatars.userId, subjectUserId));
  expect(row?.image).toBeNull();
});

it("403s a non-moderator attempting to restore", async () => {
  const res = await app.inject({
    method: "POST", url: `/moderation/hashes/${HASH}/restore`, headers: authHeaders(ordinaryUserId),
  });
  expect(res.statusCode).toBe(403);
  expect(await getAvatarByHash(db, HASH)).toBeNull();
});
```

- [ ] **Step 7: Run it to verify it fails**

```bash
cd apps/api && TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run test/moderation-routes.test.ts
```

Expected: FAIL — route not found (404).

- [ ] **Step 8: Create `apps/api/src/routes/moderation.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { desc, inArray } from "drizzle-orm";
import type { Database } from "@onelife/db";
import { avatarReports, blockedAvatarHashes } from "@onelife/db";
import type { Auth } from "@onelife/auth";
import { requireModerator } from "../auth-plugin.js";
import { unbanAvatarHash, confirmAvatarHashBan } from "../lib/avatar-store.js";

export function registerModerationRoutes(
  app: FastifyInstance,
  db: Database,
  auth: Auth,
  moderatorUserIds: string[],
): void {
  app.get("/moderation/queue", async (request, reply) => {
    const mod = await requireModerator(auth, request, moderatorUserIds);
    if (!mod.ok) return reply.code(mod.status).send({ error: mod.error });

    const bans = await db
      .select({ hash: blockedAvatarHashes.hash, state: blockedAvatarHashes.state, blockedAt: blockedAvatarHashes.blockedAt })
      .from(blockedAvatarHashes)
      .orderBy(desc(blockedAvatarHashes.blockedAt));
    if (bans.length === 0) return { entries: [] };

    const reports = await db
      .select({ hash: avatarReports.subjectHash, reason: avatarReports.reason })
      .from(avatarReports)
      .where(inArray(avatarReports.subjectHash, bans.map((b) => b.hash)));

    const byHash = new Map<string, string[]>();
    for (const r of reports) {
      const list = byHash.get(r.hash) ?? [];
      list.push(r.reason);
      byHash.set(r.hash, list);
    }

    return {
      entries: bans.map((b) => ({
        hash: b.hash,
        state: b.state,
        blockedAt: b.blockedAt.toISOString(),
        reportCount: byHash.get(b.hash)?.length ?? 0,
        reasons: Array.from(new Set(byHash.get(b.hash) ?? [])),
      })),
    };
  });

  app.post("/moderation/hashes/:hash/restore", async (request, reply) => {
    const mod = await requireModerator(auth, request, moderatorUserIds);
    if (!mod.ok) return reply.code(mod.status).send({ error: mod.error });
    const { hash } = request.params as { hash: string };
    await unbanAvatarHash(db, hash);
    return { ok: true };
  });

  app.post("/moderation/hashes/:hash/confirm", async (request, reply) => {
    const mod = await requireModerator(auth, request, moderatorUserIds);
    if (!mod.ok) return reply.code(mod.status).send({ error: mod.error });
    const { hash } = request.params as { hash: string };
    await confirmAvatarHashBan(db, hash, mod.userId);
    return { ok: true };
  });
}
```

- [ ] **Step 9: Wire it up**

In `apps/api/src/app.ts`, add to `AuthOptions`:

```ts
  moderatorUserIds?: string[];
```

Add the import:

```ts
import { registerModerationRoutes } from "./routes/moderation.js";
```

And inside the `if (opts)` block, after `registerBlockRoutes(...)`:

```ts
registerModerationRoutes(app, db, opts.auth, opts.moderatorUserIds ?? []);
```

In `apps/api/src/main.ts`, add to the `buildApp` options object:

```ts
  moderatorUserIds: cfg.moderatorUserIds,
```

- [ ] **Step 10: Add `isModerator` to `GET /me`**

In `apps/api/src/routes/me.ts`, `registerMeRoute` currently takes `(app, auth)`. Change it to `(app, auth, moderatorUserIds: string[] = [])` and add `isModerator: moderatorUserIds.includes(session.user.id)` to the response body. Update the call in `app.ts` to `registerMeRoute(app, opts.auth, opts.moderatorUserIds ?? [])`.

This is display-only — it tells the web shell whether to render the link. Every moderation route re-checks server-side.

- [ ] **Step 11: Document the env var in `.env.example`**

```bash
cat >> .env.example <<'EOF'

# --- UGC moderation (API) ---------------------------------------------------------------
# Comma-separated user ids allowed to review reported avatars at /moderation.
#
# ⚠️ UNSET MEANS NOBODY. Reports still auto-hide avatars, but nothing can be restored or
# confirmed until this is set — so set it before launch, or a bad-faith report hides an
# innocent avatar with no way back. Find your id with:
#   psql "$DATABASE_URL" -c "select id, email from \"user\";"
MODERATOR_USER_IDS=
EOF
```

- [ ] **Step 12: Run the full api suite**

```bash
cd apps/api && TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run
```

Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add apps/api/src/config.ts apps/api/src/auth-plugin.ts apps/api/src/routes/moderation.ts apps/api/src/routes/me.ts apps/api/src/app.ts apps/api/src/main.ts apps/api/test/moderation-routes.test.ts apps/api/test/config.test.ts .env.example
git commit -m "feat(api): moderator review routes behind MODERATOR_USER_IDS"
```

---

### Task 7: Account-deletion interaction and changelog

The whole point of this task is to prove the Global Constraint about cascades holds. 2a shipped a version where deletion could never succeed for a verified user because a NOT NULL / NO ACTION FK was missed; this test is the guard against repeating it.

**Files:**
- Test: `packages/auth/test/delete-account.test.ts` (modify)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `deleteAccount` from `@onelife/auth`; the three new tables from `@onelife/db`

- [ ] **Step 1: Write the failing test**

Append to `packages/auth/test/delete-account.test.ts`, reusing that file's existing seeding helpers:

```ts
it("deletes an account that has reported, been reported, blocked and been blocked", async () => {
  // ⚠️ This is the guard for the Global Constraint. Every new FK to user.id must cascade; a
  // NOT NULL / NO ACTION reference makes this raise Postgres 23503. 2a shipped exactly that
  // bug via verification_challenges, and it was found only by running deletion for real.
  const leaver = await seedUser("leaver");
  const other = await seedUser("other");
  await seedAvatar(leaver, "hash-leaver".padEnd(64, "0"));
  await seedAvatar(other, "hash-other".padEnd(64, "0"));

  await db.insert(avatarReports).values([
    { reporterUserId: leaver, subjectUserId: other, subjectHash: "hash-other".padEnd(64, "0"), reason: "hate" },
    { reporterUserId: other, subjectUserId: leaver, subjectHash: "hash-leaver".padEnd(64, "0"), reason: "other" },
  ]);
  await db.insert(userBlocks).values([
    { blockerUserId: leaver, blockedUserId: other },
    { blockerUserId: other, blockedUserId: leaver },
  ]);
  await db.insert(blockedAvatarHashes).values({ hash: "hash-leaver".padEnd(64, "0") });

  await expect(deleteAccount(db, leaver)).resolves.toMatchObject({ tokensForfeited: 0 });

  // Their reports and blocks go, in both directions.
  expect(await db.select().from(avatarReports)).toHaveLength(0);
  expect(await db.select().from(userBlocks)).toHaveLength(0);

  // ⚠️ But the BAN survives. Otherwise deleting your account is a way to un-ban your own image.
  expect(await db.select().from(blockedAvatarHashes)).toHaveLength(1);
});
```

- [ ] **Step 2: Run it**

```bash
cd packages/auth && TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run test/delete-account.test.ts
```

Expected: PASS with correctly-cascading FKs. **If it fails with error code `23503`, the migration in Task 1 is missing an `ON DELETE CASCADE`** — fix the migration rather than adding an explicit delete to `deleteAccount`.

- [ ] **Step 3: Add the changelog entry**

In `CHANGELOG.md`, under `## [Unreleased]` → `### Added`, above the existing entries:

```markdown
- Report an objectionable avatar, and block another user. A reported avatar is hidden
  immediately pending review, and blocking someone hides their avatar from you and stops
  location sharing between you both ways. Reporting requires a verified gamertag.
```

- [ ] **Step 4: Add the un-provable claims to `CLAUDE.md`**

Append to the outstanding-verification list, beside the entries 2a added:

```markdown
- UGC moderation's browser-only claims: the report and block dialogs at 320px, the moderation
  queue's click-to-reveal at 320px, and the full round trip against real data — report an
  avatar, confirm it vanishes site-wide, restore it, confirm it returns.
```

- [ ] **Step 5: Run the whole repo**

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npx turbo run typecheck test --concurrency=1
```

Expected: all tasks pass.

- [ ] **Step 6: Commit**

```bash
git add packages/auth/test/delete-account.test.ts CHANGELOG.md CLAUDE.md
git commit -m "test: account deletion survives reports and blocks"
```

---

## Self-Review Notes

**Spec coverage.** Every spec section maps to a task: data model → 1; hash-ban semantics and the cached-copies caveat → 2; auto-hide, verified gate, reason enum, rate cap, 409/idempotency → 3; viewer-scoped blocking → 4; location shares → 5; moderator env var, `requireModerator`, queue/restore/confirm, `isModerator` → 6; cascade interaction, changelog, un-provable claims → 7.

**Deliberately out of scope** (the client-half plan): the report/block dialogs, `/settings` blocked-users list, the `/moderation` page and its click-to-reveal, the four-render rule, and `@onelife/api-client` endpoint additions. The server half is independently shippable and carries all the risk.

**Not implemented, by spec decision:** the proactive image filter for guideline 1.2. The spec records this as a knowing acceptance with a defined response if a rejection cites it.

**Avatar display filtering for blocks** is a client concern — the server exposes `GET /me/blocks` and the web filters at render. Task 4's last test pins that the server does *not* filter globally.
