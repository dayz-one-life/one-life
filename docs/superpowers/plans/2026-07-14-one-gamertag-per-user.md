# One Gamertag Per User Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict each user to owning at most one active gamertag link (one pending or verified claim at a time).

**Architecture:** Defense in depth across three layers. A partial unique DB index is the hard guarantee; a guard in `POST /me/gamertag-links` returns a friendly `409 active_link_exists`; the web UI hides the claim form and shows the existing link when one is active. A `cancelled` link frees the slot; a `verified` link is permanent (admin-only release via manual DB edit).

**Tech Stack:** TypeScript/ESM, Postgres + Drizzle ORM, Fastify (API), Next.js 15 + React Query (web), Vitest.

## Global Constraints

- **Active** = `status IN ('pending','verified')`. `cancelled` is terminal and frees the slot.
- A `verified` link cannot be self-released — admin-only via manual DB edit. No self-serve admin path in scope.
- Greenfield data: no reconciliation migration — the new index is added cleanly.
- New migration number is `0007`; migrations live in `packages/db/drizzle/` and are produced by `pnpm --filter @onelife/db db:generate` (which also writes the meta snapshot + `_journal.json`).
- API error contract for a blocked second claim: `409 { "error": "active_link_exists", "current": { "gamertag": string, "status": "pending"|"verified" } }`.
- Run all tests via `TEST_DATABASE_URL=... pnpm --filter <pkg> test`. DB-backed suites need `TEST_DATABASE_URL`; local Postgres is `docker compose up -d postgres` (host port may be remapped to 5434 by a gitignored `docker-compose.override.yml`).

---

## Task 1: DB — one-active-link partial unique index (schema + migration `0007`)

**Files:**
- Modify: `packages/db/src/schema.ts` (the `gamertagLinks` table index block, currently lines ~231-235)
- Create (generated): `packages/db/drizzle/0007_*.sql` + `packages/db/drizzle/meta/0007_snapshot.json` + updated `packages/db/drizzle/meta/_journal.json`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a unique index named `gamertag_links_user_active_uniq` on `gamertag_links (user_id) WHERE status IN ('pending','verified')`. Task 2's backstop test relies on this index existing (the test harness applies the migration in Vitest global setup).

- [ ] **Step 1: Add the partial unique index to the Drizzle schema**

In `packages/db/src/schema.ts`, the `gamertagLinks` index block currently reads:

```ts
}, (t) => ({
  uniqUserGamertag: uniqueIndex("gamertag_links_user_gamertag_uniq").on(t.userId, t.gamertag),
  uniqVerified: uniqueIndex("gamertag_links_verified_uniq").on(t.gamertag).where(sql`${t.status} = 'verified'`),
  byGamertag: index("gamertag_links_gamertag_idx").on(t.gamertag),
}));
```

Add the new index (keep the existing three unchanged):

```ts
}, (t) => ({
  uniqUserGamertag: uniqueIndex("gamertag_links_user_gamertag_uniq").on(t.userId, t.gamertag),
  uniqVerified: uniqueIndex("gamertag_links_verified_uniq").on(t.gamertag).where(sql`${t.status} = 'verified'`),
  uniqUserActive: uniqueIndex("gamertag_links_user_active_uniq").on(t.userId).where(sql`${t.status} IN ('pending','verified')`),
  byGamertag: index("gamertag_links_gamertag_idx").on(t.gamertag),
}));
```

`sql` and `uniqueIndex` are already imported at the top of the file — no new imports.

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @onelife/db db:generate`
Expected: a new file `packages/db/drizzle/0007_<random-name>.sql` is created, `meta/0007_snapshot.json` is written, and `meta/_journal.json` gains an `idx: 7` entry tagged `0007_<random-name>`.

- [ ] **Step 3: Verify the generated SQL**

Read `packages/db/drizzle/0007_*.sql`. Confirm it contains exactly one new statement — a partial unique index on `user_id` gated by the pending/verified status predicate, e.g.:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "gamertag_links_user_active_uniq" ON "gamertag_links" USING btree ("user_id") WHERE "gamertag_links"."status" IN ('pending','verified');
```

It must NOT drop or alter `gamertag_links_user_gamertag_uniq` or `gamertag_links_verified_uniq`. If it contains unrelated statements, the schema was edited beyond Step 1 — revert and redo Step 1.

- [ ] **Step 4: Typecheck the db package**

Run: `pnpm --filter @onelife/db typecheck`
Expected: PASS (no type errors).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/
git commit -m "feat(db): one-active-link partial unique index on gamertag_links (0007)"
```

---

## Task 2: API — active-link guard in `POST /me/gamertag-links`

**Files:**
- Modify: `apps/api/src/routes/gamertag-links.ts` (imports line 5; POST handler, insert guard after the already-verified check at line 60)
- Modify: `apps/api/test/gamertag-links.test.ts` (imports line 2-3; afterAll cleanup lines 55-67; append a new describe block at end of file)

**Interfaces:**
- Consumes: the `gamertag_links_user_active_uniq` index from Task 1 (backstop) and the existing `gamertagLinks` table.
- Produces: `POST /me/gamertag-links` returns `409 { error: "active_link_exists", current: { gamertag, status } }` when the caller already holds an active link for a *different* gamertag.

- [ ] **Step 1: Write the failing tests**

In `apps/api/test/gamertag-links.test.ts`:

First, extend the imports (line 2 currently imports drizzle helpers — add nothing new there; `eq` is already imported). Add `"Bob"` to the three cleanup lists in `afterAll` (lines ~55-67), so the block's challenge-subquery, links delete, and players delete all include `Bob`:

```ts
afterAll(async () => {
  await db.delete(verificationChallenges).where(
    sqlExpr`${verificationChallenges.gamertagLinkId} IN (SELECT id FROM gamertag_links WHERE gamertag IN ('Alice', 'Verified', 'Foreign', 'Bob'))`);
  await db.delete(gamertagLinks).where(inArray(gamertagLinks.gamertag, ["Alice", "Verified", "Foreign", "Bob"]));
  await db.delete(gamertagLinks).where(eq(gamertagLinks.userId, "someone-else"));
  await db.delete(players).where(inArray(players.gamertag, ["Alice", "Verified", "Bob"]));
  await sql`DELETE FROM "session" WHERE user_id IN (SELECT id FROM "user" WHERE email = ${email})`;
  await sql`DELETE FROM "account" WHERE user_id IN (SELECT id FROM "user" WHERE email = ${email})`;
  await sql`DELETE FROM "verification" WHERE identifier LIKE ${"%" + email + "%"}`;
  await sql`DELETE FROM "user" WHERE email = ${email}`;
  await db.delete(user).where(eq(user.id, "someone-else"));
  await db.delete(servers).where(eq(servers.id, serverId));
  await app.close();
  await sql.end();
});
```

Then append this describe block at the very end of the file (after the `GET/DELETE` describe):

```ts
describe("one active gamertag link per user", () => {
  beforeAll(async () => {
    await db.insert(players).values({ gamertag: "Bob", dayzId: "B=" });
  });

  it("409 active_link_exists when claiming a second gamertag while one is pending", async () => {
    await claim({ gamertag: "Alice" });            // caller now holds a pending Alice link
    const res = await claim({ gamertag: "Bob" });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe("active_link_exists");
    expect(body.current.gamertag).toBe("Alice");
    expect(body.current.status).toBe("pending");
  });

  it("allows a different gamertag after the pending one is cancelled", async () => {
    const alice = (await claim({ gamertag: "Alice" })).json();
    const del = await app.inject({ method: "DELETE", url: `/me/gamertag-links/${alice.linkId}`, headers: { host: "localhost", cookie } });
    expect(del.statusCode).toBe(200);
    const res = await claim({ gamertag: "Bob" });
    expect(res.statusCode).toBe(201);
    expect(res.json().gamertag).toBe("Bob");
    // free the slot again so later assertions start clean
    await app.inject({ method: "DELETE", url: `/me/gamertag-links/${res.json().linkId}`, headers: { host: "localhost", cookie } });
  });

  it("409 active_link_exists when the caller already has a verified gamertag", async () => {
    const alice = (await claim({ gamertag: "Alice" })).json();
    await db.update(gamertagLinks).set({ status: "verified", verifiedAt: new Date() }).where(eq(gamertagLinks.id, alice.linkId));
    const res = await claim({ gamertag: "Bob" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("active_link_exists");
    expect(res.json().current.status).toBe("verified");
    // revert so the shared Alice link doesn't leak a verified state into cleanup
    await db.update(gamertagLinks).set({ status: "cancelled", verifiedAt: null }).where(eq(gamertagLinks.id, alice.linkId));
  });

  it("DB backstop: a second active link for one user violates the unique index", async () => {
    await db.delete(gamertagLinks).where(eq(gamertagLinks.userId, "someone-else"));
    await db.insert(gamertagLinks).values({ userId: "someone-else", gamertag: "IdxA", status: "pending" });
    await expect(
      db.insert(gamertagLinks).values({ userId: "someone-else", gamertag: "IdxB", status: "pending" }),
    ).rejects.toThrow();
    await db.delete(gamertagLinks).where(eq(gamertagLinks.userId, "someone-else"));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `TEST_DATABASE_URL=$TEST_DATABASE_URL pnpm --filter @onelife/api test -- gamertag-links`
Expected: the four new tests FAIL — the first three because the second claim currently returns `201` (no guard), and the backstop because the index does not exist unless Task 1's migration is applied. (If the backstop fails to even connect, ensure the test DB was migrated — the Vitest global setup applies `0007`.)

- [ ] **Step 3: Add the `inArray` import to the route**

In `apps/api/src/routes/gamertag-links.ts`, line 5 currently reads:

```ts
import { and, eq, gt, desc, isNull } from "drizzle-orm";
```

Change it to add `inArray`:

```ts
import { and, eq, gt, desc, isNull, inArray } from "drizzle-orm";
```

- [ ] **Step 4: Implement the active-link guard**

In the same file, the POST handler currently has this already-verified check (lines ~57-60):

```ts
    // D3: reject if this gamertag is already verified by anyone.
    const verified = await db.select({ id: gamertagLinks.id }).from(gamertagLinks)
      .where(and(eq(gamertagLinks.gamertag, gamertag), eq(gamertagLinks.status, "verified")));
    if (verified.length > 0) return reply.code(409).send({ error: "already_verified" });
```

Immediately AFTER that block (and before `const { linkId, challenge } = await db.transaction(...)`), insert:

```ts
    // One active link per user: a user may hold at most one link with status pending|verified.
    // A different active gamertag blocks a new claim — a pending one can be cancelled to free the
    // slot; a verified one is permanent (admin-only release). Re-claiming the SAME pending gamertag
    // stays idempotent (it is not "other").
    const active = await db.select({ gamertag: gamertagLinks.gamertag, status: gamertagLinks.status })
      .from(gamertagLinks)
      .where(and(eq(gamertagLinks.userId, userId), inArray(gamertagLinks.status, ["pending", "verified"])));
    const other = active.find((l) => l.gamertag !== gamertag);
    if (other) {
      return reply.code(409).send({ error: "active_link_exists", current: { gamertag: other.gamertag, status: other.status } });
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `TEST_DATABASE_URL=$TEST_DATABASE_URL pnpm --filter @onelife/api test -- gamertag-links`
Expected: PASS — all four new tests plus the existing suite (the existing "409 when the gamertag is already verified by a different user" still returns 409 via the earlier `already_verified` branch).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/gamertag-links.ts apps/api/test/gamertag-links.test.ts
git commit -m "feat(api): reject a second active gamertag claim (409 active_link_exists)"
```

---

## Task 3: Web — activeLink helper, error mapping, and UI gating

**Files:**
- Create: `apps/web/src/lib/active-link.ts`
- Create: `apps/web/src/lib/active-link.test.ts`
- Create: `apps/web/src/lib/claim-error.ts`
- Create: `apps/web/src/lib/claim-error.test.ts`
- Modify: `apps/web/src/app/account/claim/page.tsx`
- Modify: `apps/web/src/app/account/page.tsx`

**Interfaces:**
- Consumes: the API `409 active_link_exists` contract from Task 2 (surfaced as `ApiError.code === "active_link_exists"`), and the `GamertagLink` type (`status: "pending" | "verified" | "cancelled"`).
- Produces: `activeLink(links)` → the single active link or null; `claimErrorMessage(e)` → user-facing string.

- [ ] **Step 1: Write the failing helper tests**

Create `apps/web/src/lib/active-link.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { activeLink } from "./active-link";
import type { GamertagLink } from "./types";

const link = (over: Partial<GamertagLink>): GamertagLink => ({
  id: 1, serverId: 0, gamertag: "GT", status: "cancelled", verifiedAt: null, challenge: null, ...over,
});

describe("activeLink", () => {
  it("returns null for undefined or empty input", () => {
    expect(activeLink(undefined)).toBeNull();
    expect(activeLink([])).toBeNull();
  });
  it("returns null when every link is cancelled", () => {
    expect(activeLink([link({ status: "cancelled" }), link({ id: 2, status: "cancelled" })])).toBeNull();
  });
  it("returns the pending link", () => {
    const l = link({ id: 3, status: "pending", gamertag: "Alice" });
    expect(activeLink([link({ status: "cancelled" }), l])).toBe(l);
  });
  it("returns the verified link", () => {
    const l = link({ id: 4, status: "verified", gamertag: "Bob" });
    expect(activeLink([l])).toBe(l);
  });
});
```

Create `apps/web/src/lib/claim-error.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ApiError } from "./api";
import { claimErrorMessage } from "./claim-error";

describe("claimErrorMessage", () => {
  it("maps active_link_exists to the one-gamertag message", () => {
    expect(claimErrorMessage(new ApiError(409, "active_link_exists"))).toMatch(/only claim one|already have/i);
  });
  it("maps 422 to a not-seen message", () => {
    expect(claimErrorMessage(new ApiError(422, "gamertag_not_seen"))).toMatch(/haven't seen/i);
  });
  it("maps a plain 409 to already-claimed", () => {
    expect(claimErrorMessage(new ApiError(409, "already_verified"))).toMatch(/already claimed/i);
  });
  it("falls back for unknown errors", () => {
    expect(claimErrorMessage(new Error("boom"))).toMatch(/something went wrong/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @onelife/web test -- active-link claim-error`
Expected: FAIL — `./active-link` and `./claim-error` modules do not exist yet.

- [ ] **Step 3: Implement the helpers**

Create `apps/web/src/lib/active-link.ts`:

```ts
import type { GamertagLink } from "./types";

/**
 * The user's single active gamertag link (status pending|verified), or null when none.
 * One-active-link is enforced by the API + DB; this returns the first active link found.
 */
export function activeLink(links: GamertagLink[] | undefined): GamertagLink | null {
  return links?.find((l) => l.status === "pending" || l.status === "verified") ?? null;
}
```

Create `apps/web/src/lib/claim-error.ts`:

```ts
import { ApiError } from "./api";

/** User-facing message for a failed gamertag claim. */
export function claimErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "active_link_exists") return "You already have a gamertag — you can only claim one.";
    if (e.status === 422) return "We haven't seen that gamertag on any server yet.";
    if (e.status === 409) return "That gamertag is already claimed by someone.";
  }
  return "Something went wrong. Please try again.";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @onelife/web test -- active-link claim-error`
Expected: PASS (all 8 assertions).

- [ ] **Step 5: Wire the claim page to the helpers**

Replace the full contents of `apps/web/src/app/account/claim/page.tsx` with:

```tsx
"use client";
import { useState } from "react";
import { useClaimGamertag, useLinkStatus, useCancelLink, useGamertagLinks } from "@/lib/use-gamertag-links";
import { activeLink } from "@/lib/active-link";
import { claimErrorMessage } from "@/lib/claim-error";
import { ClaimForm } from "@/components/claim-form";
import { ClaimStatus } from "@/components/claim-status";
import { Button } from "@/components/ui/button";

export default function ClaimPage() {
  const claim = useClaimGamertag();
  const cancel = useCancelLink();
  const links = useGamertagLinks();
  const [linkId, setLinkId] = useState<number | null>(null);

  const existing = activeLink(links.data);
  const shownId = linkId ?? existing?.id ?? null;

  const status = useLinkStatus(shownId ?? 0, shownId !== null);
  const link = status.data;

  if (shownId !== null && link) {
    return (
      <main className="mx-auto max-w-md space-y-4 p-8">
        <h1 className="font-display text-[28px] text-amber">Verify {link.gamertag}</h1>
        <ClaimStatus status={link.status} challenge={link.challenge} />
        {link.status === "pending" && (
          <Button className="border border-line bg-panel text-bone hover:border-amber" onClick={() => { cancel.mutate(link.id); setLinkId(null); }}>
            Cancel claim
          </Button>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md space-y-4 p-8">
      <h1 className="font-display text-[28px] text-amber">Claim a gamertag</h1>
      <ClaimForm
        pending={claim.isPending}
        error={claim.isError ? claimErrorMessage(claim.error) : null}
        onSubmit={(gamertag) =>
          claim.mutate({ gamertag }, { onSuccess: (res) => setLinkId(res.linkId) })
        }
      />
    </main>
  );
}
```

- [ ] **Step 6: Gate the "Claim a gamertag" link on the account page**

In `apps/web/src/app/account/page.tsx`, add the helper import near the existing `use-gamertag-links` import (line 5):

```tsx
import { useGamertagLinks, useCancelLink } from "@/lib/use-gamertag-links";
import { activeLink } from "@/lib/active-link";
```

Then, inside the component (after `const cancel = useCancelLink();`, ~line 16), derive:

```tsx
  const hasActiveLink = activeLink(links.data) !== null;
```

Finally, in the "Gamertag links" section header (lines ~48-52), only render the claim link when there is no active link:

```tsx
        <div className="mb-3 flex items-center justify-between">
          <h2 className="border-b-2 border-line pb-2 font-display text-[20px] text-bone">Gamertag links</h2>
          {!hasActiveLink && (
            <Link className="text-sm text-amber hover:underline" href="/account/claim">Claim a gamertag →</Link>
          )}
        </div>
```

- [ ] **Step 7: Typecheck and run the full web test suite**

Run: `pnpm --filter @onelife/web typecheck && pnpm --filter @onelife/web test`
Expected: PASS (typecheck clean; all web tests including the new helper tests green).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/active-link.ts apps/web/src/lib/active-link.test.ts \
        apps/web/src/lib/claim-error.ts apps/web/src/lib/claim-error.test.ts \
        apps/web/src/app/account/claim/page.tsx apps/web/src/app/account/page.tsx
git commit -m "feat(web): one-gamertag-per-user — gate claim UI and map active_link_exists"
```

---

## Task 4: Docs — CHANGELOG + CLAUDE.md

**Files:**
- Modify: `CHANGELOG.md` (the `## [Unreleased]` section)
- Modify: `CLAUDE.md` (the SP2 sub-project bullet)

**Interfaces:**
- Consumes: the behavior shipped in Tasks 1-3.
- Produces: release notes + project-doc description. (Required by the workflow: CHANGELOG on every PR; CLAUDE.md updated last, before opening the PR.)

- [ ] **Step 1: Update the changelog**

In `CHANGELOG.md`, under `## [Unreleased]` → `### Added`, add:

```markdown
### Added
- **One gamertag per user.** A user can now hold at most one *active* gamertag link (one `pending` or `verified` claim at a time). Enforced in depth: a partial unique index `gamertag_links_user_active_uniq` on `(user_id) WHERE status IN ('pending','verified')` (migration `0007`), an API guard in `POST /me/gamertag-links` that returns `409 { error: "active_link_exists", current: { gamertag, status } }`, and a web claim UI that hides the claim form / shows the existing link when one is active. Cancelling a `pending` link frees the slot; a `verified` link is permanent (admin-only release via manual DB edit).
```

- [ ] **Step 2: Update CLAUDE.md**

In `CLAUDE.md`, append a sentence to the **SP2** sub-project bullet noting the new invariant:

```markdown
  **One gamertag per user:** a user holds at most one active (`pending`|`verified`) `gamertag_links`
  row — enforced by partial unique index `gamertag_links_user_active_uniq` (migration `0007`) + a
  `409 active_link_exists` guard in `POST /me/gamertag-links`; a `verified` link is admin-release-only.
```

- [ ] **Step 3: Verify the docs reference the shipped names**

Confirm both docs name `gamertag_links_user_active_uniq`, migration `0007`, and `active_link_exists` — matching Tasks 1-2. No code to run.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: one gamertag per user — changelog + CLAUDE.md"
```

---

## Final verification (before opening the PR)

- [ ] Run the full suite: `pnpm turbo run test --concurrency=1` (with `TEST_DATABASE_URL` set) → all green.
- [ ] Run `pnpm turbo run typecheck` → clean.
- [ ] Use the `finishing-a-feature` skill to open the PR into `develop`.

## Deploy note

The `0007` index adds cleanly on greenfield data. If production ever contained a user with two active links, `CREATE UNIQUE INDEX` would fail; per the greenfield assumption that does not occur, but any future backfill must reconcile duplicates (keep the earliest active link, cancel the rest) before applying `0007`.
