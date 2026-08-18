# UGC Report and Block — Client Half — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give users a way to report an objectionable avatar and block another player, and give the operator a page to review what was reported.

**Architecture:** The server half shipped keyed on internal `userId`, which the public dossier deliberately does not expose — so no client can call it. Tasks 1-2 re-key the client-facing API onto the product's *public* identifiers (content hash, gamertag), and Tasks 3-6 build the surfaces on top.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind 3, Fastify 5, Drizzle ORM + Postgres, vitest + Testing Library.

**Spec:** [`docs/superpowers/specs/2026-08-17-ugc-report-block-design.md`](../specs/2026-08-17-ugc-report-block-design.md)

## Global Constraints

- **The client-facing moderation API speaks PUBLIC identifiers only.** Reports key on the content hash; blocks key on gamertag. Internal `user.id` values must never appear in a request or response reachable by an ordinary user — publishing them makes accounts enumerable and gives a stable handle for correlating them.
- **Blocking is viewer-scoped; banning is global.** A block must never stop an avatar serving for third parties.
- **Only users with a `status = 'verified'` gamertag link may report.** Auto-hide on a single report depends entirely on this gate.
- **Reporting hides the avatar immediately, and the confirmation copy must say so.** Not "thanks, we'll look into it" — that is the standard lie of report flows, and here it is actually false.
- **Reason is a fixed six-value enum** (`sexual`, `violent`, `hate`, `illegal`, `impersonation`, `other`) — never free text, which would itself be a UGC surface.
- **The four-render rule applies to every list and every fetched count**: loading, failed, empty and populated are four distinct renders. "No reports" and "the queue failed to load" must never look alike, or a broken queue reads as a clean one and nothing gets reviewed for days.
- **Moderation images are click-to-reveal**, never rendered inline. The queue is by construction a list of things someone reported as objectionable.
- Dialogs use `useModalBehavior` (`apps/web/src/lib/use-modal-behavior.ts`) — real focus trap, Escape, scroll lock. A bare `aria-modal` with no trap is a lie to screen readers.
- DB-backed tests need `TEST_DATABASE_URL` and a running Postgres. `apps/api` tests share ONE database with `fileParallelism: false` — clean up in `afterAll` as well as `beforeEach`, in FK-safe order.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/db/src/schema.ts` | `avatarReports` re-keyed (modify) |
| `packages/db/drizzle/0035_reports_by_hash.sql` | Migration (create) |
| `apps/api/src/lib/moderation.ts` | `reportAvatar` by hash; block/unblock by gamertag (modify) |
| `apps/api/src/routes/reports.ts` | Body becomes `{ subjectHash, reason }` (modify) |
| `apps/api/src/routes/blocks.ts` | Gamertag-keyed (modify) |
| `packages/api-client/src/{endpoints,types}.ts` | Typed calls for all six operations (modify) |
| `apps/web/src/components/player/report-block-menu.tsx` | Dossier entry point (create) |
| `apps/web/src/components/moderation/report-dialog.tsx` | Report confirmation (create) |
| `apps/web/src/components/moderation/block-dialog.tsx` | Block confirmation (create) |
| `apps/web/src/components/account/blocked-users.tsx` | `/settings` list (create) |
| `apps/web/src/app/(site)/(boxed)/moderation/` | Moderator queue page (create) |

---

### Task 1: Re-key reporting to the content hash

**Files:**
- Modify: `packages/db/src/schema.ts` (the `avatarReports` table)
- Create: `packages/db/drizzle/0035_reports_by_hash.sql`
- Modify: `apps/api/src/lib/moderation.ts`, `apps/api/src/routes/reports.ts`
- Test: `apps/api/test/avatar-reports.test.ts` (modify), `apps/api/test/report-routes.test.ts` (modify)

**Interfaces:**
- Produces: `reportAvatar(db: Database, reporterUserId: string, subjectHash: string, reason: string): Promise<ReportOutcome>` where `ReportOutcome = { ok: true } | { error: "not_verified" | "unknown_hash" | "already_reported" | "rate_limited" | "self" }`

**Why:** what gets banned is the hash, and several accounts can hold the same bytes — so "the subject user" is ambiguous exactly when it matters. Keying on the hash also **deletes the `hash_mismatch` case entirely**: a reporter can only name bytes they actually saw, so there is no swap window to defend against.

- [ ] **Step 1: Change the schema**

In `packages/db/src/schema.ts`, `avatarReports`:
- `subjectUserId` becomes **nullable** (drop `.notNull()`) — it stays as resolved context for the queue, not as the key.
- Replace the unique index with one on `(reporterUserId, subjectHash)`:

```ts
  uniqReporterHash: uniqueIndex("avatar_reports_reporter_hash_uniq").on(t.reporterUserId, t.subjectHash),
```

Delete the old `uniqReporterSubject` index. Keep `byHash` and `byReporterCreated`.

- [ ] **Step 2: Generate and apply the migration**

```bash
cd packages/db && pnpm run db:generate
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate
```

Rename to `0035_reports_by_hash.sql` and update the `tag` in `packages/db/drizzle/meta/_journal.json` if drizzle-kit chose another name. Read the SQL and confirm it drops the old unique index and creates the new one.

- [ ] **Step 3: Rewrite `reportAvatar`**

In `apps/api/src/lib/moderation.ts`:

```ts
export type ReportOutcome =
  | { ok: true }
  | { error: "not_verified" | "unknown_hash" | "already_reported" | "rate_limited" | "self" };

/**
 * Record a report against IMAGE BYTES and ban them immediately.
 *
 * ⚠️ Keyed on the hash, not the owner. Several accounts can hold the same bytes, so there is no
 * single "subject" — and because the reporter names the bytes they saw, a reported user cannot
 * swap avatars to redirect the ban onto someone else's image.
 */
export async function reportAvatar(
  db: Database,
  reporterUserId: string,
  subjectHash: string,
  reason: string,
): Promise<ReportOutcome> {
  const [verified] = await db
    .select({ id: gamertagLinks.id })
    .from(gamertagLinks)
    .where(and(eq(gamertagLinks.userId, reporterUserId), eq(gamertagLinks.status, "verified")));
  if (!verified) return { error: "not_verified" };

  // Resolve holders of these bytes. Also proves the hash is real — without this, anyone could
  // ban arbitrary strings and fill the queue with hashes no avatar ever had.
  const holders = await db
    .select({ userId: avatars.userId })
    .from(avatars)
    .where(and(eq(avatars.hash, subjectHash), isNotNull(avatars.image)));
  if (holders.length === 0) return { error: "unknown_hash" };
  if (holders.some((h) => h.userId === reporterUserId)) return { error: "self" };

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(avatarReports)
    .where(and(eq(avatarReports.reporterUserId, reporterUserId), gte(avatarReports.createdAt, since)));
  const count = rows[0]?.count ?? 0;
  if (count >= REPORTS_PER_DAY) return { error: "rate_limited" };

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(avatarReports)
      // subjectUserId is CONTEXT for the moderator, not the key. With several holders we record
      // the first; the ban covers all of them regardless.
      .values({ reporterUserId, subjectUserId: holders[0]?.userId ?? null, subjectHash, reason })
      .onConflictDoNothing({ target: [avatarReports.reporterUserId, avatarReports.subjectHash] })
      .returning({ id: avatarReports.id });
    if (inserted.length === 0) return { error: "already_reported" as const };
    await banAvatarHash(tx, subjectHash);
    return { ok: true as const };
  });
}
```

Add `isNotNull` to the drizzle-orm import if absent.

- [ ] **Step 4: Update the route**

In `apps/api/src/routes/reports.ts`, body becomes:

```ts
const bodySchema = z.object({
  // ⚠️ The bytes the caller actually saw. No owner id: the dossier does not publish user ids,
  // and the ban is on the image regardless of who holds it.
  subjectHash: z.string().min(1),
  reason: z.enum(REPORT_REASONS),
});

const STATUS: Record<string, number> = {
  not_verified: 403, unknown_hash: 404, already_reported: 409, rate_limited: 429, self: 400,
};
```

Delete `hash_mismatch` and the `subjectUserId` field. Pass `parsed.data.subjectHash` to `reportAvatar`.

- [ ] **Step 5: Update the existing tests**

`apps/api/test/avatar-reports.test.ts` and `report-routes.test.ts` call `reportAvatar`/the route with `subjectUserId`. Update every call. Delete the `hash_mismatch` test — the case no longer exists — and replace it with:

```ts
it("refuses a hash no live avatar holds, so the queue cannot be filled with invented hashes", async () => {
  await seedUser("reporter"); await seedVerified("reporter", "ReporterTag");
  expect(await reportAvatar(db, "reporter", "nosuchhash".padEnd(64, "0"), "hate")).toEqual({ error: "unknown_hash" });
});

it("refuses to report bytes you hold yourself", async () => {
  await seedUser("reporter"); await seedVerified("reporter", "ReporterTag");
  await seedAvatar("reporter", HASH);
  expect(await reportAvatar(db, "reporter", HASH, "hate")).toEqual({ error: "self" });
});

// The point of hash-keying: two holders, one report, both hidden.
it("hides the bytes for every holder from a single report", async () => {
  await seedUser("reporter"); await seedVerified("reporter", "ReporterTag");
  await seedUser("a"); await seedAvatar("a", HASH);
  await seedUser("b"); await seedAvatar("b", HASH);
  expect(await reportAvatar(db, "reporter", HASH, "hate")).toEqual({ ok: true });
  expect(await getAvatarByHash(db, HASH)).toBeNull();
});
```

- [ ] **Step 6: Run and commit**

```bash
cd apps/api && TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run
git add packages/db apps/api/src/lib/moderation.ts apps/api/src/routes/reports.ts apps/api/test
git commit -m "feat(api): key avatar reports on the content hash"
```

---

### Task 2: Block and unblock by gamertag

**Files:**
- Modify: `packages/db/src/schema.ts` (`userBlocks` gains `blockedGamertag`)
- Create: `packages/db/drizzle/0036_user_blocks_gamertag.sql`
- Modify: `apps/api/src/lib/moderation.ts`, `apps/api/src/routes/blocks.ts`
- Test: `apps/api/test/user-blocks.test.ts` (modify)

**Interfaces:**
- Produces:
  - `blockByGamertag(db, blockerUserId, gamertag): Promise<{ ok: true } | { error: "self" | "unknown_gamertag" }>`
  - `unblockByGamertag(db, blockerUserId, gamertag): Promise<void>`
  - `listBlocks(db, blockerUserId): Promise<{ gamertag: string; createdAt: string }[]>`

**Why:** the dossier identifies a player by gamertag and publishes no user id. `GET /me/blocks` returning raw ids would be both unrenderable and a leak.

**⚠️ Why the gamertag is SNAPSHOTTED on the row.** The obvious design — resolve gamertag → user id on the way in, and join back to `gamertag_links` on the way out — breaks when the blocked account unlinks: the join returns null, so the row cannot be labelled *and* cannot be addressed to remove it. The block becomes permanent and invisible. Storing the gamertag as it was at block time makes the list always renderable and always reversible, and `unblockByGamertag` then needs no resolution at all.

- [ ] **Step 1: Add the column**

In `packages/db/src/schema.ts`, `userBlocks`:

```ts
  // Snapshot of the blocked player's gamertag AT BLOCK TIME. Not a join to gamertag_links: if
  // they later unlink, a join yields null and the row becomes both unlabelable and unremovable.
  blockedGamertag: text("blocked_gamertag").notNull(),
```

- [ ] **Step 2: Generate the migration, then make it safe for existing rows**

```bash
cd packages/db && pnpm run db:generate
```

drizzle-kit will emit a bare `ADD COLUMN ... NOT NULL`, which fails if any row exists. Edit the generated SQL to add-then-backfill-then-constrain, and rename it `0036_user_blocks_gamertag.sql` (updating the `tag` in `packages/db/drizzle/meta/_journal.json`):

```sql
ALTER TABLE "user_blocks" ADD COLUMN "blocked_gamertag" text;
UPDATE "user_blocks" ub SET "blocked_gamertag" = COALESCE(
  (SELECT gl.gamertag FROM "gamertag_links" gl
    WHERE gl.user_id = ub.blocked_user_id AND gl.status = 'verified' LIMIT 1),
  '(unknown)');
ALTER TABLE "user_blocks" ALTER COLUMN "blocked_gamertag" SET NOT NULL;
```

Then apply it:

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate
```

- [ ] **Step 3: Write the failing tests**

Add to `apps/api/test/user-blocks.test.ts`:

```ts
describe("blocking by gamertag", () => {
  it("resolves a verified gamertag to its owner and blocks them", async () => {
    await seedUser("alice");
    await seedUser("bob"); await seedVerified("bob", "BobTag");
    expect(await blockByGamertag(db, "alice", "BobTag")).toEqual({ ok: true });
    expect(await listBlockedUserIds(db, "alice")).toEqual(["bob"]);
  });

  it("matches case-insensitively, like every other gamertag lookup here", async () => {
    await seedUser("alice");
    await seedUser("bob"); await seedVerified("bob", "BobTag");
    expect(await blockByGamertag(db, "alice", "bobtag")).toEqual({ ok: true });
  });

  it("refuses a gamertag nobody has verified", async () => {
    await seedUser("alice");
    expect(await blockByGamertag(db, "alice", "Ghost")).toEqual({ error: "unknown_gamertag" });
  });

  it("refuses your own gamertag", async () => {
    await seedUser("alice"); await seedVerified("alice", "AliceTag");
    expect(await blockByGamertag(db, "alice", "AliceTag")).toEqual({ error: "self" });
  });

  // ⚠️ The list must render, and must not leak internal ids.
  it("lists blocks by gamertag, never by user id", async () => {
    await seedUser("alice");
    await seedUser("bob"); await seedVerified("bob", "BobTag");
    await blockByGamertag(db, "alice", "BobTag");
    const list = await listBlocks(db, "alice");
    expect(list).toEqual([{ gamertag: "BobTag", createdAt: expect.any(String) }]);
    expect(JSON.stringify(list)).not.toContain("bob");
  });

  // ⚠️ The case the snapshot exists for: without it this row would render as null and could
  // never be removed, because unblock had nothing to address it by.
  it("still labels and removes a block whose owner later unlinked", async () => {
    await seedUser("alice");
    await seedUser("bob"); await seedVerified("bob", "BobTag");
    await blockByGamertag(db, "alice", "BobTag");
    await db.delete(gamertagLinks).where(eq(gamertagLinks.userId, "bob"));

    expect(await listBlocks(db, "alice")).toEqual([{ gamertag: "BobTag", createdAt: expect.any(String) }]);
    await unblockByGamertag(db, "alice", "BobTag");
    expect(await listBlocks(db, "alice")).toEqual([]);
  });
});
```

- [ ] **Step 4: Run to verify failure**

```bash
cd apps/api && TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run test/user-blocks.test.ts
```

Expected: FAIL — `blockByGamertag` not exported.

- [ ] **Step 5: Implement**

In `apps/api/src/lib/moderation.ts`, import `verifiedUserIdByGamertag` from `../routes/verified-gamertag.js`, add `desc` and `sql` to the drizzle-orm import, then:

```ts
/**
 * Block the verified owner of a gamertag. The client never sees user ids — the dossier
 * publishes gamertags, so that is what a block names.
 */
export async function blockByGamertag(
  db: Database,
  blockerUserId: string,
  gamertag: string,
): Promise<{ ok: true } | { error: "self" | "unknown_gamertag" }> {
  const target = await verifiedUserIdByGamertag(db, gamertag);
  if (!target) return { error: "unknown_gamertag" };
  if (target === blockerUserId) return { error: "self" };
  await blockUser(db, blockerUserId, target, gamertag);
  return { ok: true };
}

/**
 * Remove a block by the gamertag it was recorded under. Deliberately does NOT re-resolve the
 * gamertag to a user id: the blocked account may have unlinked since, and an unremovable block
 * is worse than none.
 */
export async function unblockByGamertag(db: Database, blockerUserId: string, gamertag: string): Promise<void> {
  await db.delete(userBlocks).where(and(
    eq(userBlocks.blockerUserId, blockerUserId),
    sql`lower(${userBlocks.blockedGamertag}) = lower(${gamertag})`,
  ));
}

export async function listBlocks(
  db: Database,
  blockerUserId: string,
): Promise<{ gamertag: string; createdAt: string }[]> {
  const rows = await db
    .select({ gamertag: userBlocks.blockedGamertag, createdAt: userBlocks.createdAt })
    .from(userBlocks)
    .where(eq(userBlocks.blockerUserId, blockerUserId))
    .orderBy(desc(userBlocks.createdAt));
  return rows.map((r) => ({ gamertag: r.gamertag, createdAt: r.createdAt.toISOString() }));
}
```

`blockUser` gains a fourth parameter for the snapshot; update its signature and its insert:

```ts
export async function blockUser(
  db: Database,
  blockerUserId: string,
  blockedUserId: string,
  blockedGamertag: string,
): Promise<{ ok: true } | { error: "self" }> {
```

and add `blockedGamertag` to the `.values({...})`. Update its existing callers and tests to pass a gamertag.

- [ ] **Step 6: Update the routes**

`apps/api/src/routes/blocks.ts`:

```ts
const bodySchema = z.object({ gamertag: z.string().min(1) });

app.get("/me/blocks", async (request, reply) => {
  const session = await getSession(auth, request);
  if (!session) return reply.code(401).send({ error: "unauthorized" });
  return { blocks: await listBlocks(db, session.user.id) };
});

app.post("/me/blocks", async (request, reply) => {
  const session = await getSession(auth, request);
  if (!session) return reply.code(401).send({ error: "unauthorized" });
  const parsed = bodySchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
  const result = await blockByGamertag(db, session.user.id, parsed.data.gamertag);
  if ("error" in result) return reply.code(result.error === "unknown_gamertag" ? 404 : 400).send({ error: result.error });
  return reply.code(201).send({ ok: true });
});

app.delete("/me/blocks/:gamertag", async (request, reply) => {
  const session = await getSession(auth, request);
  if (!session) return reply.code(401).send({ error: "unauthorized" });
  const { gamertag } = request.params as { gamertag: string };
  await unblockByGamertag(db, session.user.id, gamertag);
  return { ok: true };
});
```

- [ ] **Step 7: Run and commit**

```bash
cd apps/api && TEST_DATABASE_URL="$TEST_DATABASE_URL" npx vitest run
git add packages/db apps/api/src/lib/moderation.ts apps/api/src/routes/blocks.ts apps/api/test
git commit -m "feat(api): block and unblock by gamertag"
```

---

### Task 3: Typed client calls

**Files:**
- Modify: `packages/api-client/src/types.ts`, `packages/api-client/src/endpoints.ts`
- Modify: `apps/web/src/lib/api.ts`
- Test: `packages/api-client/test/endpoints.test.ts`

**Interfaces:**
- Produces on the api client: `reportAvatar`, `getBlocks`, `blockPlayer`, `unblockPlayer`, `getModerationQueue`, `restoreAvatarHash`, `confirmAvatarHash`, and `moderationImageSrc`

- [ ] **Step 1: Add the types**

First, a gap the server half left behind: `GET /me` now returns `isModerator`, but the `Me` type
in `packages/api-client/src/types.ts:106` was never updated, so Task 6 cannot read it. Add the
field:

```ts
export type Me = {
  user: { id: string; name: string; email: string; image: string | null };
  accounts: Array<{ providerId: string; accountId: string }>;
  // Display only — it decides whether the shell renders a link to /moderation. Every moderation
  // route re-checks server-side, so trusting this client-side grants nothing.
  isModerator: boolean;
};
```

Then append to `packages/api-client/src/types.ts`:

```ts
export const REPORT_REASONS = ["sexual", "violent", "hate", "illegal", "impersonation", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Snapshotted at block time, so it survives the blocked account unlinking. */
export type BlockedPlayer = { gamertag: string; createdAt: string };

export type ModerationEntry = {
  hash: string;
  state: string;
  blockedAt: string;
  reportCount: number;
  reasons: string[];
};
```

- [ ] **Step 2: Add the endpoints**

In `packages/api-client/src/endpoints.ts`, add `BlockedPlayer`, `ModerationEntry`, `ReportReason` to the type import, then inside `createApiClient`:

```ts
    reportAvatar: (subjectHash: string, reason: ReportReason) =>
      t.send<{ ok: true }>("POST", "/api/me/reports/avatar", { subjectHash, reason }),
    getBlocks: () => t.get<{ blocks: BlockedPlayer[] }>("/api/me/blocks"),
    blockPlayer: (gamertag: string) => t.send<{ ok: true }>("POST", "/api/me/blocks", { gamertag }),
    unblockPlayer: (gamertag: string) =>
      t.send<{ ok: true }>("DELETE", `/api/me/blocks/${encodeURIComponent(gamertag)}`),
    getModerationQueue: () => t.get<{ entries: ModerationEntry[] }>("/api/moderation/queue"),
    restoreAvatarHash: (hash: string) =>
      t.send<{ ok: true }>("POST", `/api/moderation/hashes/${encodeURIComponent(hash)}/restore`),
    confirmAvatarHash: (hash: string) =>
      t.send<{ ok: true }>("POST", `/api/moderation/hashes/${encodeURIComponent(hash)}/confirm`),
```

- [ ] **Step 3: Add a test**

In `packages/api-client/test/endpoints.test.ts`:

```ts
it("reports an avatar by hash, never by user id", async () => {
  const { transport, send } = fakeTransport();
  await createApiClient(transport).reportAvatar("abc123", "hate");
  expect(send).toHaveBeenCalledWith("POST", "/api/me/reports/avatar", { subjectHash: "abc123", reason: "hate" });
});

it("encodes a gamertag with a space when unblocking", async () => {
  const { transport, send } = fakeTransport();
  await createApiClient(transport).unblockPlayer("Big Bill");
  expect(send).toHaveBeenCalledWith("DELETE", "/api/me/blocks/Big%20Bill");
});
```

- [ ] **Step 4: Re-export from the web shim**

`apps/web/src/lib/api.ts` binds the catalog and re-exports members individually so importers do not change. Add one `export const` line per new member, matching the existing style, plus:

```ts
/** Moderator-only avatar bytes. A plain URL, not a fetch — it is an <img> src. */
export const moderationImageSrc = (hash: string) =>
  `${API_ORIGIN}${toBackendPath(`/api/moderation/hashes/${encodeURIComponent(hash)}/image`)}`;
```

- [ ] **Step 5: Run and commit**

```bash
npx turbo run typecheck test --filter=@onelife/api-client --filter=@onelife/web
git add packages/api-client apps/web/src/lib/api.ts
git commit -m "feat(api-client): typed moderation endpoints"
```

---

### Task 4: Report and block from the dossier

**Files:**
- Create: `apps/web/src/components/player/report-block-menu.tsx`
- Create: `apps/web/src/components/moderation/report-dialog.tsx`
- Create: `apps/web/src/components/moderation/block-dialog.tsx`
- Modify: `apps/web/src/components/player/ticket-stage.tsx`
- Test: `apps/web/src/components/moderation/report-dialog.test.tsx`, `block-dialog.test.tsx`, `report-block-menu.test.tsx`

**Interfaces:**
- Consumes: `reportAvatar`, `blockPlayer` from `@/lib/api`; `useModalBehavior` from `@/lib/use-modal-behavior`; `useAccountStatus` from `@/lib/use-account-status`
- Produces: `<ReportBlockMenu gamertag={string} avatarHash={string | null} />`

**Placement:** `ticket-stage.tsx` is a **server component** and renders `<StageAvatar hash={page.avatarHash} editable={owner} />` around line 123. Add `<ReportBlockMenu>` (a client component) as a sibling, rendered only when `!owner`.

- [ ] **Step 1: Write the failing dialog tests**

`apps/web/src/components/moderation/report-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ReportDialog } from "./report-dialog";

vi.mock("@/lib/api", () => ({ reportAvatar: vi.fn(async () => ({ ok: true })) }));
import { reportAvatar } from "@/lib/api";

beforeEach(() => vi.clearAllMocks());

describe("ReportDialog", () => {
  // ⚠️ The copy must be TRUE. Auto-hide really happens, so "we'll look into it" would be a lie
  // in the one direction that matters — it would also hide from the reporter that a bad report
  // is reversible.
  it("says the avatar is hidden immediately, not that it will be reviewed later", () => {
    render(<ReportDialog open gamertag="Ripper" avatarHash="abc" onClose={() => {}} />);
    expect(screen.getByText(/hidden (straight away|immediately)/i)).toBeTruthy();
  });

  it("requires a reason before it will submit", () => {
    render(<ReportDialog open gamertag="Ripper" avatarHash="abc" onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /report/i })).toHaveProperty("disabled", true);
  });

  it("sends the hash and the chosen reason", async () => {
    render(<ReportDialog open gamertag="Ripper" avatarHash="abc" onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText(/hateful or harassing/i));
    fireEvent.click(screen.getByRole("button", { name: /report/i }));
    await waitFor(() => expect(reportAvatar).toHaveBeenCalledWith("abc", "hate"));
  });

  // Failure must not read as success — the avatar is still up.
  it("shows an error and does not claim success when the call fails", async () => {
    (reportAvatar as unknown as { mockRejectedValue: (e: Error) => void }).mockRejectedValue(new Error("nope"));
    render(<ReportDialog open gamertag="Ripper" avatarHash="abc" onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText(/hateful or harassing/i));
    fireEvent.click(screen.getByRole("button", { name: /report/i }));
    expect(await screen.findByText(/couldn't|could not/i)).toBeTruthy();
  });
});
```

`block-dialog.test.tsx` mirrors it, asserting the copy names **both** effects:

```tsx
it("names both effects: their avatar is hidden from you, and location sharing stops both ways", () => {
  render(<BlockDialog open gamertag="Ripper" onClose={() => {}} />);
  const text = document.body.textContent ?? "";
  expect(text).toMatch(/avatar/i);
  expect(text).toMatch(/location/i);
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd apps/web && npx vitest run src/components/moderation
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Build `report-dialog.tsx`**

```tsx
"use client";

import { useState } from "react";
import { reportAvatar } from "@/lib/api";
import { useModalBehavior } from "@/lib/use-modal-behavior";

/** ⚠️ A FIXED list. A free-text reason box would itself be a UGC surface — putting one inside
 *  the moderation feature would be self-defeating. */
const REASONS = [
  { value: "sexual", label: "Sexual or nudity" },
  { value: "violent", label: "Violent or graphic" },
  { value: "hate", label: "Hateful or harassing" },
  { value: "illegal", label: "Illegal content" },
  { value: "impersonation", label: "Impersonation" },
  { value: "other", label: "Something else" },
] as const;

export function ReportDialog({
  open, gamertag, avatarHash, onClose,
}: { open: boolean; gamertag: string; avatarHash: string; onClose: () => void }) {
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const panelRef = useModalBehavior(open, onClose);

  if (!open) return null;

  async function onSubmit() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await reportAvatar(avatarHash, reason as (typeof REASONS)[number]["value"]);
      setDone(true);
    } catch {
      // ⚠️ Never fall through to a success message. The avatar is still up, and telling the
      // reporter otherwise means nobody reports it again.
      setError("We couldn't submit that report. The avatar is unchanged — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark/80 p-4">
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={`Report ${gamertag}'s avatar`}
           className="w-full max-w-md border border-red-deep bg-paper p-5">
        {done ? (
          <>
            <h2 className="font-display text-sm font-bold uppercase tracking-[.14em]">Reported</h2>
            {/* ⚠️ True, not reassuring-sounding. The machine really did hide it — which is also
             *  what makes a mistaken report recoverable. */}
            <p className="mt-2 font-mono text-[11.5px] uppercase leading-relaxed tracking-[.03em] text-ink-muted">
              This avatar is hidden straight away while a moderator reviews it. If it turns out to
              be fine, it goes back up.
            </p>
            <button type="button" onClick={onClose} className="mt-4 border border-ink px-4 py-2 font-mono text-xs uppercase">Close</button>
          </>
        ) : (
          <>
            <h2 className="font-display text-sm font-bold uppercase tracking-[.14em]">Report this avatar</h2>
            <p className="mt-2 font-mono text-[11.5px] uppercase leading-relaxed tracking-[.03em] text-ink-muted">
              It is hidden immediately while a moderator reviews it.
            </p>
            <fieldset className="mt-4">
              <legend className="sr-only">Reason</legend>
              {REASONS.map((r) => (
                <label key={r.value} className="mt-2 flex items-center gap-2 font-mono text-[11.5px] uppercase">
                  <input type="radio" name="reason" value={r.value}
                         checked={reason === r.value} onChange={() => setReason(r.value)} />
                  {r.label}
                </label>
              ))}
            </fieldset>
            {error && <p role="alert" className="mt-3 font-mono text-[11.5px] uppercase text-red-deep">{error}</p>}
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={onSubmit} disabled={!reason || busy}
                      className="border border-red-deep px-4 py-2 font-mono text-xs uppercase text-red-deep disabled:opacity-40">
                Report avatar
              </button>
              <button type="button" onClick={onClose} className="border border-ink px-4 py-2 font-mono text-xs uppercase">Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Build `block-dialog.tsx`**

```tsx
"use client";

import { useState } from "react";
import { blockPlayer } from "@/lib/api";
import { useModalBehavior } from "@/lib/use-modal-behavior";

export function BlockDialog({
  open, gamertag, onClose,
}: { open: boolean; gamertag: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const panelRef = useModalBehavior(open, onClose);

  if (!open) return null;

  async function onSubmit() {
    setBusy(true);
    setError(null);
    try {
      await blockPlayer(gamertag);
      setDone(true);
    } catch {
      setError("We couldn't block that player. Nothing was changed \u2014 please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark/80 p-4">
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={`Block ${gamertag}`}
           className="w-full max-w-md border border-red-deep bg-paper p-5">
        <h2 className="font-display text-sm font-bold uppercase tracking-[.14em]">
          {done ? "Blocked" : `Block ${gamertag}?`}
        </h2>
        {/* \u26a0\ufe0f Both consequences, stated plainly. A block that only half-works is worse than
         *  none, because the person believes they are protected. The last sentence matters too:
         *  a block that notifies is a block that invites retaliation. */}
        <p className="mt-2 font-mono text-[11.5px] uppercase leading-relaxed tracking-[.03em] text-ink-muted">
          Blocking hides their avatar from you, and stops location sharing between you both ways.
          They are not told.
        </p>
        {error && <p role="alert" className="mt-3 font-mono text-[11.5px] uppercase text-red-deep">{error}</p>}
        <div className="mt-5 flex gap-3">
          {done ? (
            <button type="button" onClick={onClose} className="border border-ink px-4 py-2 font-mono text-xs uppercase">Close</button>
          ) : (
            <>
              <button type="button" onClick={onSubmit} disabled={busy}
                      className="border border-red-deep px-4 py-2 font-mono text-xs uppercase text-red-deep disabled:opacity-40">
                Block player
              </button>
              <button type="button" onClick={onClose} className="border border-ink px-4 py-2 font-mono text-xs uppercase">Cancel</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Build `report-block-menu.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useAccountStatus } from "@/lib/use-account-status";
import { useModalBehavior } from "@/lib/use-modal-behavior";
import { ReportDialog } from "@/components/moderation/report-dialog";
import { BlockDialog } from "@/components/moderation/block-dialog";

export function ReportBlockMenu({ gamertag, avatarHash }: { gamertag: string; avatarHash: string | null }) {
  const status = useAccountStatus();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<"report" | "block" | null>(null);
  const panelRef = useModalBehavior(open, () => setOpen(false));

  // \u26a0\ufe0f Signed-out visitors get nothing to click. Both actions 401, so offering them is a
  // dead end that teaches people the feature is broken. Called after the hooks above so hook
  // order stays stable across renders.
  if (status.kind !== "signedIn") return null;

  return (
    <>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}
              className="font-mono text-xs uppercase tracking-[.04em] text-cream-muted"
              aria-label={`Actions for ${gamertag}`}>
        &#8943;
      </button>
      {open && (
        <div ref={panelRef} role="menu" className="border border-ink bg-paper p-1">
          {/* Report names BYTES, so it only exists when there are bytes. Block names a person,
              who exists whether or not they uploaded anything. */}
          {avatarHash && (
            <button type="button" role="menuitem"
                    onClick={() => { setDialog("report"); setOpen(false); }}
                    className="block w-full px-3 py-2 text-left font-mono text-xs uppercase">
              Report avatar
            </button>
          )}
          <button type="button" role="menuitem"
                  onClick={() => { setDialog("block"); setOpen(false); }}
                  className="block w-full px-3 py-2 text-left font-mono text-xs uppercase">
            Block player
          </button>
        </div>
      )}
      {avatarHash && (
        <ReportDialog open={dialog === "report"} gamertag={gamertag} avatarHash={avatarHash}
                      onClose={() => setDialog(null)} />
      )}
      <BlockDialog open={dialog === "block"} gamertag={gamertag} onClose={() => setDialog(null)} />
    </>
  );
}
```

- [ ] **Step 6: Wire into the dossier**

In `apps/web/src/components/player/ticket-stage.tsx`, beside `<StageAvatar …/>`:

```tsx
{!owner && <ReportBlockMenu gamertag={page.gamertag} avatarHash={page.avatarHash} />}
```

- [ ] **Step 7: Run and commit**

```bash
cd apps/web && npx vitest run src/components/moderation src/components/player
git add apps/web/src/components
git commit -m "feat(web): report and block from the dossier"
```

---

### Task 5: Blocked players on /settings

**Files:**
- Create: `apps/web/src/components/account/blocked-users.tsx`
- Modify: `apps/web/src/app/(site)/(boxed)/settings/settings-body.tsx`
- Test: `apps/web/src/components/account/blocked-users.test.tsx`

**Interfaces:**
- Consumes: `getBlocks`, `unblockPlayer` from `@/lib/api`

- [ ] **Step 1: Write the failing test — the four-render rule is the point**

`apps/web/src/components/account/blocked-users.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BlockedUsers } from "./blocked-users";

vi.mock("@/lib/api", () => ({ getBlocks: vi.fn(), unblockPlayer: vi.fn(async () => ({ ok: true })) }));
import { getBlocks, unblockPlayer } from "@/lib/api";

const mockGet = getBlocks as unknown as { mockResolvedValue: (v: unknown) => void; mockRejectedValue: (e: Error) => void };

beforeEach(() => vi.clearAllMocks());

describe("BlockedUsers", () => {
  it("shows a loading affordance and no list while the fetch is in flight", () => {
    mockGet.mockResolvedValue(new Promise(() => {}));
    render(<BlockedUsers />);
    expect(screen.queryByRole("list")).toBeNull();
  });

  // ⚠️ THE test. If a failed fetch renders as "you haven't blocked anyone", someone believes
  // their blocks are gone — or that they are protected when the list never loaded.
  it("distinguishes an empty list from a failed fetch", async () => {
    mockGet.mockResolvedValue({ blocks: [] });
    const { unmount } = render(<BlockedUsers />);
    expect(await screen.findByText(/haven't blocked anyone/i)).toBeTruthy();
    unmount();

    mockGet.mockRejectedValue(new Error("nope"));
    render(<BlockedUsers />);
    expect(await screen.findByText(/couldn't load|could not load/i)).toBeTruthy();
    expect(screen.queryByText(/haven't blocked anyone/i)).toBeNull();
  });

  it("lists blocked gamertags and unblocks one", async () => {
    mockGet.mockResolvedValue({ blocks: [{ gamertag: "Ripper", createdAt: "2026-08-18T00:00:00.000Z" }] });
    render(<BlockedUsers />);
    expect(await screen.findByText("Ripper")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /unblock/i }));
    await waitFor(() => expect(unblockPlayer).toHaveBeenCalledWith("Ripper"));
  });

  // The gamertag is snapshotted server-side at block time (Task 2), so it is present even after
  // the blocked account unlinks — which is exactly what keeps the row removable.
  it("renders and can unblock a player who has since unlinked", async () => {
    mockGet.mockResolvedValue({ blocks: [{ gamertag: "GoneTag", createdAt: "2026-08-18T00:00:00.000Z" }] });
    render(<BlockedUsers />);
    expect(await screen.findByText("GoneTag")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /unblock/i }));
    await waitFor(() => expect(unblockPlayer).toHaveBeenCalledWith("GoneTag"));
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd apps/web && npx vitest run src/components/account/blocked-users.test.tsx
```

Expected: FAIL — `./blocked-users` does not exist.

- [ ] **Step 3: Implement with an explicit four-state machine**

```tsx
"use client";

import { useEffect, useState } from "react";
import { getBlocks, unblockPlayer } from "@/lib/api";
import type { BlockedPlayer } from "@onelife/api-client";

/** ⚠️ FOUR renders. `empty` and `failed` must never collapse together: "you haven't blocked
 *  anyone" shown because the fetch failed tells someone they are unprotected when they are not. */
type State =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "empty" }
  | { kind: "loaded"; blocks: BlockedPlayer[] };

export function BlockedUsers() {
  const [state, setState] = useState<State>({ kind: "loading" });

  async function load() {
    setState({ kind: "loading" });
    try {
      const { blocks } = await getBlocks();
      setState(blocks.length === 0 ? { kind: "empty" } : { kind: "loaded", blocks });
    } catch {
      setState({ kind: "failed" });
    }
  }

  useEffect(() => { void load(); }, []);

  async function onUnblock(gamertag: string) {
    await unblockPlayer(gamertag);
    await load();
  }

  return (
    <section className="mt-10 border border-ink/20 px-5 py-4">
      <h2 className="font-display text-sm font-bold uppercase tracking-[.14em]">Blocked players</h2>
      {state.kind === "loading" && (
        <p className="mt-2 font-mono text-[11.5px] uppercase text-ink-muted">Loading…</p>
      )}
      {state.kind === "failed" && (
        <p role="alert" className="mt-2 font-mono text-[11.5px] uppercase text-red-deep">
          We couldn&apos;t load your blocked players. Try again shortly.
        </p>
      )}
      {state.kind === "empty" && (
        <p className="mt-2 font-mono text-[11.5px] uppercase text-ink-muted">
          You haven&apos;t blocked anyone.
        </p>
      )}
      {state.kind === "loaded" && (
        <ul role="list" className="mt-3">
          {state.blocks.map((b) => (
            <li key={`${b.gamertag}-${b.createdAt}`} className="flex items-center justify-between border-t border-ink/10 py-2">
              {/* The gamertag is a server-side snapshot from block time, so it is always here —
                  even if that account has since unlinked. That is what keeps the row removable. */}
              <span className="font-mono text-[11.5px] uppercase">{b.gamertag}</span>
              <button type="button" onClick={() => void onUnblock(b.gamertag)}
                      className="border border-ink px-3 py-1 font-mono text-xs uppercase">
                Unblock
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Add to `/settings`**

In `settings-body.tsx`, render `<BlockedUsers />` above `<DangerZone />`, inside the existing signed-in branch (the route is public; the signed-out branch must not show it).

- [ ] **Step 5: Run and commit**

```bash
cd apps/web && npx vitest run src/components/account
git add apps/web/src
git commit -m "feat(web): blocked players list on /settings"
```

---

### Task 6: The moderation queue page

**Files:**
- Create: `apps/web/src/app/(site)/(boxed)/moderation/page.tsx`, `moderation-body.tsx`
- Test: `apps/web/src/app/(site)/(boxed)/moderation/moderation-body.test.tsx`

**Interfaces:**
- Consumes: `getModerationQueue`, `restoreAvatarHash`, `confirmAvatarHash`, `moderationImageSrc` from `@/lib/api`; `useMe` for `isModerator`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/app/(site)/(boxed)/moderation/moderation-body.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ModerationBody } from "./moderation-body";

vi.mock("@/lib/api", () => ({
  getModerationQueue: vi.fn(),
  restoreAvatarHash: vi.fn(async () => ({ ok: true })),
  confirmAvatarHash: vi.fn(async () => ({ ok: true })),
  moderationImageSrc: (h: string) => `/api/moderation/hashes/${h}/image`,
  getMe: vi.fn(async () => ({ isModerator: true })),
}));
import { getModerationQueue, restoreAvatarHash, confirmAvatarHash, getMe } from "@/lib/api";

const q = getModerationQueue as unknown as { mockResolvedValue: (v: unknown) => void; mockRejectedValue: (e: Error) => void };
const me = getMe as unknown as { mockResolvedValue: (v: unknown) => void };
const ENTRY = { hash: "abc123", state: "auto", blockedAt: "2026-08-18T00:00:00.000Z", reportCount: 2, reasons: ["hate", "sexual"] };

beforeEach(() => { vi.clearAllMocks(); me.mockResolvedValue({ isModerator: true }); });

describe("ModerationBody", () => {
  // ⚠️ Click-to-reveal. This page is BY CONSTRUCTION a list of things someone reported as
  // objectionable; opening it must not ambush the moderator with a wall of it.
  it("renders no image until one is revealed", async () => {
    q.mockResolvedValue({ entries: [ENTRY] });
    render(<ModerationBody />);
    expect(await screen.findByText(/abc123/)).toBeTruthy();
    expect(document.querySelectorAll("img")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /show image/i }));
    const imgs = document.querySelectorAll("img");
    expect(imgs).toHaveLength(1);
    expect(imgs[0]?.getAttribute("src")).toContain("abc123");
  });

  it("shows the report count and de-duplicated reasons", async () => {
    q.mockResolvedValue({ entries: [{ ...ENTRY, reasons: ["hate", "hate", "sexual"] }] });
    render(<ModerationBody />);
    expect(await screen.findByText(/2 reports/i)).toBeTruthy();
    expect(screen.getAllByText(/hate/i)).toHaveLength(1);
  });

  // ⚠️ Empty vs failed. A broken queue that reads as a clean one means nothing gets reviewed
  // for days — the one failure the auto-hide design cannot absorb.
  it("distinguishes an empty queue from a failed load", async () => {
    q.mockResolvedValue({ entries: [] });
    const { unmount } = render(<ModerationBody />);
    expect(await screen.findByText(/nothing waiting/i)).toBeTruthy();
    unmount();

    q.mockRejectedValue(new Error("nope"));
    render(<ModerationBody />);
    expect(await screen.findByText(/couldn't load|could not load/i)).toBeTruthy();
    expect(screen.queryByText(/nothing waiting/i)).toBeNull();
  });

  it("restores an entry and drops it from the list", async () => {
    q.mockResolvedValue({ entries: [ENTRY] });
    render(<ModerationBody />);
    await screen.findByText(/abc123/);
    q.mockResolvedValue({ entries: [] });
    fireEvent.click(screen.getByRole("button", { name: /restore/i }));
    await waitFor(() => expect(restoreAvatarHash).toHaveBeenCalledWith("abc123"));
    expect(await screen.findByText(/nothing waiting/i)).toBeTruthy();
  });

  // ⚠️ Confirm DESTROYS the bytes and cannot be undone. One stray click must not do that.
  it("requires a second click before confirming a takedown", async () => {
    q.mockResolvedValue({ entries: [ENTRY] });
    render(<ModerationBody />);
    await screen.findByText(/abc123/);

    fireEvent.click(screen.getByRole("button", { name: /^confirm removal$/i }));
    expect(confirmAvatarHash).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /permanently delete/i }));
    await waitFor(() => expect(confirmAvatarHash).toHaveBeenCalledWith("abc123"));
  });

  it("renders a plain refusal, not the queue, when the viewer is not a moderator", async () => {
    me.mockResolvedValue({ isModerator: false });
    q.mockResolvedValue({ entries: [ENTRY] });
    render(<ModerationBody />);
    expect(await screen.findByText(/don't have access|do not have access/i)).toBeTruthy();
    expect(screen.queryByText(/abc123/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd apps/web && npx vitest run "src/app/(site)/(boxed)/moderation"
```

Expected: FAIL — `./moderation-body` does not exist.

- [ ] **Step 3: Implement**

`page.tsx` is a thin server component:

```tsx
import { ModerationBody } from "./moderation-body";

export const metadata = { title: "Moderation", robots: { index: false, follow: false } };

export default function ModerationPage() {
  return <ModerationBody />;
}
```

`moderation-body.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { getModerationQueue, restoreAvatarHash, confirmAvatarHash, moderationImageSrc, getMe } from "@/lib/api";
import type { ModerationEntry } from "@onelife/api-client";

/** ⚠️ FOUR renders. `empty` and `failed` must never collapse: a queue that failed to load but
 *  reads as "nothing waiting" means reports sit unreviewed while the moderator believes the
 *  page is clean — the one failure auto-hide cannot absorb. */
type State =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "empty" }
  | { kind: "loaded"; entries: ModerationEntry[] };

export function ModerationBody() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [armed, setArmed] = useState<string | null>(null);

  async function load() {
    setState({ kind: "loading" });
    try {
      const { entries } = await getModerationQueue();
      setState(entries.length === 0 ? { kind: "empty" } : { kind: "loaded", entries });
    } catch {
      setState({ kind: "failed" });
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const me = await getMe();
        setAllowed(Boolean(me.isModerator));
        if (me.isModerator) await load();
      } catch {
        setAllowed(false);
      }
    })();
  }, []);

  if (allowed === null) return <p className="mt-6 font-mono text-[11.5px] uppercase text-ink-muted">Loading…</p>;

  // Display only. Every moderation route re-checks server-side, so this is courtesy — it keeps
  // a non-moderator from staring at a broken page, and grants nothing on its own.
  if (!allowed) {
    return <p className="mt-6 font-mono text-[11.5px] uppercase text-ink-muted">You don&apos;t have access to this page.</p>;
  }

  return (
    <section className="mt-6">
      <h1 className="font-display text-lg font-bold uppercase tracking-[.14em]">Moderation queue</h1>

      {state.kind === "loading" && <p className="mt-3 font-mono text-[11.5px] uppercase text-ink-muted">Loading…</p>}
      {state.kind === "failed" && (
        <p role="alert" className="mt-3 font-mono text-[11.5px] uppercase text-red-deep">
          We couldn&apos;t load the queue. Reports may be waiting — try again.
        </p>
      )}
      {state.kind === "empty" && (
        <p className="mt-3 font-mono text-[11.5px] uppercase text-ink-muted">Nothing waiting for review.</p>
      )}

      {state.kind === "loaded" && (
        <ul role="list" className="mt-4">
          {state.entries.map((e) => (
            <li key={e.hash} className="border-t border-ink/10 py-4">
              <p className="font-mono text-[11.5px] uppercase text-ink-muted">
                {e.hash.slice(0, 12)}… · {e.reportCount} reports · {Array.from(new Set(e.reasons)).join(", ")}
              </p>

              {/* ⚠️ Click-to-reveal, never inline. Every row here is something a person reported
                  as objectionable; a wall of them is a page the moderator learns to avoid. */}
              {revealed.has(e.hash) ? (
                <img src={moderationImageSrc(e.hash)} alt="Reported avatar" width={96} height={96}
                     className="mt-3 rounded-full border border-ink" />
              ) : (
                <button type="button" onClick={() => setRevealed((s) => new Set(s).add(e.hash))}
                        className="mt-3 border border-ink px-3 py-1 font-mono text-xs uppercase">
                  Show image
                </button>
              )}

              <div className="mt-3 flex gap-3">
                <button type="button" onClick={() => void restoreAvatarHash(e.hash).then(load)}
                        className="border border-ink px-3 py-1 font-mono text-xs uppercase">
                  Restore
                </button>
                {/* Two-step: confirm DESTROYS the bytes and cannot be undone. */}
                {armed === e.hash ? (
                  <button type="button" onClick={() => void confirmAvatarHash(e.hash).then(() => { setArmed(null); return load(); })}
                          className="border border-red-deep px-3 py-1 font-mono text-xs uppercase text-red-deep">
                    Permanently delete
                  </button>
                ) : (
                  <button type="button" onClick={() => setArmed(e.hash)}
                          className="border border-red-deep px-3 py-1 font-mono text-xs uppercase text-red-deep">
                    Confirm removal
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

`getMe` must exist on the api client — if it does not, add it in Task 3 alongside the others as `getMe: () => t.get<Me>("/api/me")`, reusing the existing `Me` type.

- [ ] **Step 4: Run and commit**

```bash
cd apps/web && npx vitest run src/app/\(site\)/\(boxed\)/moderation
git add apps/web/src/app
git commit -m "feat(web): moderation queue with click-to-reveal"
```

---

### Task 7: Changelog and outstanding verification

**Files:** `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: Changelog**

Under `## [Unreleased]` → `### Added`, above existing entries:

```markdown
- Report an objectionable avatar or block a player, from any dossier. A reported avatar is
  hidden straight away while it is reviewed; blocking hides someone's avatar from you and stops
  location sharing between you both ways, without telling them. `/settings` lists who you have
  blocked, and moderators get a review queue at `/moderation`.
```

- [ ] **Step 2: `CLAUDE.md` outstanding-verification list**

```markdown
- UGC moderation's browser-only claims: the report and block dialogs at 320px; the moderation
  queue's click-to-reveal at 320px and in PWA/standalone; and the full round trip against real
  data — report an avatar from a dossier, confirm it vanishes site-wide (dossier, survivors
  board, life timeline), restore it, confirm it returns.
```

- [ ] **Step 3: Whole repo green, then commit**

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" npx turbo run typecheck test --concurrency=1
cd apps/web && npx next build
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: changelog and un-verified list for UGC moderation client"
```

---

## Self-Review Notes

**Spec coverage.** Report entry point → Task 4; block → Task 4; blocked list on `/settings` → Task 5; `/moderation` with click-to-reveal → Task 6; four-render rule → Tasks 5 and 6; fixed reason enum → Tasks 1 and 4; un-provable claims → Task 7.

**Deviation from the spec, deliberate:** the spec's server design keys reports on `subjectUserId` and blocks on `userId`. Tasks 1-2 re-key both onto public identifiers, because the dossier does not publish user ids and exposing them would make accounts enumerable. This also **removes** the spec's `hash_mismatch` case — reporting the bytes you saw makes the swap window unreachable rather than merely detected. The spec should be amended when this lands.

**Not implemented, by spec decision:** the proactive image filter for guideline 1.2.

**Carried risk:** `GET /me/avatar` still returns the owner's own banned hash, so a reported user may see their own broken image. `Avatar` already accepts `onError`, so the fallback is available if it surfaces — not addressed here.
