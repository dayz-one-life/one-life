# Account Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in user permanently delete their account from within the product, satisfying App Store guideline 5.1.1(v).

**Architecture:** A `deleteAccount(db, userId)` function in `packages/auth` does all the work in one transaction — deleting the three FK rows that do not cascade, then the `user` row, letting eight cascading FKs fire. A thin `DELETE /me` route wraps it. The web app gets a `/settings` page whose Danger-zone dialog calls it. Player history (`players`, `lives`, obituaries) is untouched, because it is keyed by gamertag and server, not by user.

**Tech Stack:** TypeScript (ESM), Fastify 5, Drizzle ORM, Postgres, Better Auth, Next.js 15 App Router, React 19, Tailwind, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-17-account-deletion-design.md`

## Global Constraints

- **⚠️ Import specifier style differs by package — get this right or the build breaks.**
  - `packages/auth`, `packages/tokens`, `apps/api` are node/tsx-consumed: internal relative imports carry a **`.js` extension** (`from "./mailer.js"`). Match the file you are editing.
  - `packages/api-client` and `packages/client-logic` are bundler-consumed: internal relative imports are **extensionless**. Webpack cannot resolve `.js` against `.ts` sources; it broke `next build` once already.
- **A `/me` route takes no subject parameter.** The session is the only input, so acting on another user's account is unexpressible rather than merely rejected. (Repo house rule.)
- **Ownership and access are WHERE-clause predicates, never post-filters.** (Repo house rule.)
- **Loading, failed, empty and zero are four different renders.** Never let an in-flight or failed fetch fall through to an authoritative `0`. This is the repo's most-repeated bug class and it is load-bearing in Task 4. (Repo house rule.)
- **A ⚠️ comment in this codebase is load-bearing** — nearly every one documents a shipped bug. Do not remove or reword one you encounter.
- `confirm` is validated as an **exact, case-sensitive match on the literal string `DELETE`**. Not a boolean, not case-insensitive.
- DB-backed suites need `TEST_DATABASE_URL` and will not run in a bare git worktree (no `.env`, no Postgres). Start Postgres with `docker compose up -d postgres`; note `docker-compose.override.yml` may remap the host port — check `docker ps`.
- To migrate the test database: `DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate`. **`drizzle-kit` reads `DATABASE_URL` and nothing else.**
- Player history must survive deletion. Any change that makes `players`, `lives` or obituary rows disappear is a defect, not a simplification.

---

### Task 1: `deleteAccount` in `packages/auth`

The transaction. This is the load-bearing task — the two product decisions in the spec are expressed here as tests.

**Files:**
- Create: `packages/auth/src/delete-account.ts`
- Modify: `packages/auth/src/index.ts`
- Modify: `packages/auth/package.json` (add `@onelife/tokens` dependency)
- Test: `packages/auth/test/delete-account.test.ts`

**Interfaces:**
- Consumes: `getBalance(db, userId): Promise<number>` from `@onelife/tokens`; the `user`, `gamertagLinks`, `referrals`, `tokenTransactions` tables and the `Database` type from `@onelife/db`.
- Produces: `deleteAccount(db: Database, userId: string): Promise<DeletionSummary>` where `type DeletionSummary = { tokensForfeited: number; gamertagLinksRemoved: number }`.

- [ ] **Step 1: Add the tokens dependency**

`packages/auth` needs `getBalance` to report what the user forfeits. `@onelife/tokens` depends only on `@onelife/db` and `drizzle-orm`, so this introduces no cycle.

In `packages/auth/package.json`, add to `"dependencies"` (keeping alphabetical order — it sorts after `@onelife/db`):

```json
"@onelife/tokens": "workspace:*",
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing test**

Create `packages/auth/test/delete-account.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  user, gamertagLinks, referrals, tokenTransactions,
  servers, players, lives, avatars, notifications, pushSubscriptions,
} from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { deleteAccount } from "../src/delete-account.js";

const { db, sql } = getTestDb();

// Alice is the account being deleted. Bob stays behind and must be left intact —
// he holds a token Alice transferred him, and Alice referred him.
let serverId: number;
let playerId: number;

beforeAll(async () => {
  await db.insert(user).values([
    { id: "da-alice", name: "Alice", email: "da-alice@x.com" },
    { id: "da-bob", name: "Bob", email: "da-bob@x.com" },
  ]);

  const [srv] = await db
    .insert(servers)
    .values({ nitradoServiceId: 991001, name: "DA Test", map: "chernarusplus", slug: "da-test" })
    .returning({ id: servers.id });
  serverId = srv!.id;

  const [p] = await db
    .insert(players)
    .values({ gamertag: "DaAlice", firstSeenAt: new Date("2026-01-01T00:00:00Z") })
    .returning({ id: players.id });
  playerId = p!.id;

  await db.insert(lives).values({
    serverId, playerId, lifeNumber: 1,
    startedAt: new Date("2026-01-01T00:00:00Z"),
    endedAt: new Date("2026-01-02T00:00:00Z"),
    deathCause: "shot",
  });

  await db.insert(gamertagLinks).values({ userId: "da-alice", gamertag: "DaAlice", status: "verified" });
  await db.insert(avatars).values({ userId: "da-alice", image: null, hash: null, source: null, updatedAt: new Date() });
  // `naturalKey` is NOT NULL and uniquely indexed — omitting it is a 23502, not a default.
  await db.insert(notifications).values({
    userId: "da-alice", kind: "test", naturalKey: "da-alice:test:1", title: "t", body: "b", href: "/",
  });
  await db.insert(pushSubscriptions).values({
    userId: "da-alice", endpoint: "https://push.example/da-alice", p256dh: "k", auth: "a",
  });

  // Alice referred Bob: the row lives on BOB's id, pointing at Alice as referrer.
  await db.insert(referrals).values({ userId: "da-bob", referrerUserId: "da-alice" });

  // Alice transferred a token to Bob: ledger rows naming each other as counterparty.
  // `idempotencyKey` is NOT NULL and uniquely indexed — every row needs a distinct one.
  // Alice nets 2 - 1 = 1, which is the `tokensForfeited` the first assertion expects.
  await db.insert(tokenTransactions).values([
    { userId: "da-alice", delta: 2, kind: "grant", idempotencyKey: "da:grant:alice" },
    { userId: "da-alice", delta: -1, kind: "transfer_out", counterpartyUserId: "da-bob", idempotencyKey: "da:out:alice" },
    { userId: "da-bob", delta: 1, kind: "transfer_in", counterpartyUserId: "da-alice", idempotencyKey: "da:in:bob" },
  ]);
});

afterAll(async () => { await sql.end(); });

describe("deleteAccount", () => {
  it("reports what it destroyed", async () => {
    const summary = await deleteAccount(db, "da-alice");
    expect(summary).toEqual({ tokensForfeited: 1, gamertagLinksRemoved: 1 });
  });

  // ⚠️ THE RETENTION DECISION, AS AN ASSERTION. Player history is keyed by gamertag and
  // server, never by user — deleting an account must not touch it. If someone later "tidies
  // up" by adding a cascade from players/lives to user, this test is what catches it.
  it("leaves player history standing", async () => {
    const p = await db.select().from(players).where(eq(players.id, playerId));
    const l = await db.select().from(lives).where(eq(lives.playerId, playerId));
    expect(p).toHaveLength(1);
    expect(l).toHaveLength(1);
    expect(l[0]?.deathCause).toBe("shot");
  });

  // ⚠️ Bob's ledger is HIS balance history. Deleting Alice must drop the attribution, never
  // the row — losing it would silently change Bob's balance.
  it("keeps the other user's ledger row and nulls only the attribution", async () => {
    const rows = await db.select().from(tokenTransactions).where(eq(tokenTransactions.userId, "da-bob"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.delta).toBe(1);
    expect(rows[0]?.counterpartyUserId).toBeNull();
  });

  it("deletes the referral row that credited the departing referrer", async () => {
    const rows = await db.select().from(referrals).where(eq(referrals.userId, "da-bob"));
    expect(rows).toHaveLength(0);
  });

  it("removes the user and every cascading row", async () => {
    expect(await db.select().from(user).where(eq(user.id, "da-alice"))).toHaveLength(0);
    expect(await db.select().from(gamertagLinks).where(eq(gamertagLinks.userId, "da-alice"))).toHaveLength(0);
    expect(await db.select().from(avatars).where(eq(avatars.userId, "da-alice"))).toHaveLength(0);
    expect(await db.select().from(notifications).where(eq(notifications.userId, "da-alice"))).toHaveLength(0);
    expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, "da-alice"))).toHaveLength(0);
    expect(await db.select().from(tokenTransactions).where(eq(tokenTransactions.userId, "da-alice"))).toHaveLength(0);
  });

  it("leaves the surviving user alone", async () => {
    expect(await db.select().from(user).where(eq(user.id, "da-bob"))).toHaveLength(1);
  });

  it("is a no-op for a user that does not exist", async () => {
    const summary = await deleteAccount(db, "da-nobody");
    expect(summary).toEqual({ tokensForfeited: 0, gamertagLinksRemoved: 0 });
    expect(await db.select().from(user).where(eq(user.id, "da-bob"))).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @onelife/auth test -- test/delete-account.test.ts`
Expected: FAIL — cannot resolve `../src/delete-account.js`.

If instead it fails on a database connection, Postgres is not up or `TEST_DATABASE_URL` is unset — fix that before continuing; a connection error is not the failure you are looking for.

- [ ] **Step 4: Write the implementation**

Create `packages/auth/src/delete-account.ts`:

```ts
import { eq } from "drizzle-orm";
import { type Database, user, gamertagLinks, referrals, tokenTransactions } from "@onelife/db";
import { getBalance } from "@onelife/tokens";

export type DeletionSummary = {
  /** Unspent tokens destroyed with the account. Reported so the caller can say so out loud. */
  tokensForfeited: number;
  gamertagLinksRemoved: number;
};

/**
 * Permanently delete a user account. Player history SURVIVES: `players` and `lives` carry no
 * `userId` — history is keyed by gamertag and server — so the dossier keeps its lives, deaths
 * and obituaries and loses only its verified badge and avatar.
 *
 * ⚠️ Everything happens in ONE transaction. Three FKs to `user.id` do NOT cascade, and steps
 * 1-3 below must run before the user row is deleted or Postgres rejects it. If any step fails
 * the whole thing rolls back and the account survives intact — a partial delete would strip
 * someone's gamertag link and referral credits while leaving them signed in.
 *
 * This is also why we do NOT use Better Auth's `deleteUser` + `beforeDelete` hook: that hook
 * runs before the user deletion with no shared transaction, so a failure there leaves exactly
 * the partial state this design exists to prevent.
 */
export async function deleteAccount(db: Database, userId: string): Promise<DeletionSummary> {
  return db.transaction(async (tx) => {
    const tokensForfeited = await getBalance(tx, userId);

    // 1. The departing user's own links. Deleted EXPLICITLY rather than by adding a cascade to
    //    the schema, so the behaviour stays visible in code.
    const removedLinks = await tx
      .delete(gamertagLinks)
      .where(eq(gamertagLinks.userId, userId))
      .returning({ id: gamertagLinks.id });

    // 2. Referral rows crediting this user AS THE REFERRER. These live on the referee's id and
    //    do not cascade (`referrerUserId` is NOT NULL). `grantReferral` pays the referrer, once
    //    ever — the referee never earned from the row, so deleting it costs them nothing.
    await tx.delete(referrals).where(eq(referrals.referrerUserId, userId));

    // 3. Other users' ledger rows naming this user as the transfer counterparty. NULL the
    //    attribution, never delete the row: it is the OTHER user's balance history.
    await tx
      .update(tokenTransactions)
      .set({ counterpartyUserId: null })
      .where(eq(tokenTransactions.counterpartyUserId, userId));

    // 4. The user. Cascades take session, account, avatars, notifications, push_subscriptions,
    //    location_shares (both granter and grantee), token_transactions.userId and
    //    referrals.userId. Deleting the session rows is what signs every device out.
    await tx.delete(user).where(eq(user.id, userId));

    return { tokensForfeited, gamertagLinksRemoved: removedLinks.length };
  });
}
```

- [ ] **Step 5: Export it**

In `packages/auth/src/index.ts`, append:

```ts
export { deleteAccount } from "./delete-account.js";
export type { DeletionSummary } from "./delete-account.js";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @onelife/auth test -- test/delete-account.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 7: Add the atomicity test**

Without this, the entire argument for choosing this approach over Better Auth's hook is untested. Append to `packages/auth/test/delete-account.test.ts`:

```ts
describe("deleteAccount atomicity", () => {
  it("rolls back completely when a step inside the transaction fails", async () => {
    await db.insert(user).values({ id: "da-carol", name: "Carol", email: "da-carol@x.com" });
    await db.insert(gamertagLinks).values({ userId: "da-carol", gamertag: "DaCarol", status: "verified" });

    // Force a failure AFTER the non-cascading deletes have run, by handing deleteAccount a
    // transaction whose final user-delete throws. Wrapping the call in an outer transaction
    // that we then roll back proves the same property with no production seam:
    await expect(
      db.transaction(async (tx) => {
        await deleteAccount(tx, "da-carol");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // The account and its link must both still be here.
    expect(await db.select().from(user).where(eq(user.id, "da-carol"))).toHaveLength(1);
    expect(await db.select().from(gamertagLinks).where(eq(gamertagLinks.userId, "da-carol"))).toHaveLength(1);
  });
});
```

Note: this relies on Drizzle nesting `deleteAccount`'s `db.transaction` inside the outer one as a savepoint, so the outer rollback undoes everything. If your Drizzle version does not nest, the test will fail loudly rather than silently pass — report that rather than deleting the test.

- [ ] **Step 8: Run the full auth suite**

Run: `pnpm --filter @onelife/auth test`
Expected: PASS — the new file plus the pre-existing `auth.test.ts`, `config.test.ts`, `mailer.test.ts`.

- [ ] **Step 9: Typecheck and commit**

Run: `pnpm --filter @onelife/auth typecheck`

```bash
git add packages/auth pnpm-lock.yaml
git commit -m "feat(auth): add deleteAccount, preserving player history"
```

---

### Task 2: `DELETE /me` route

**Files:**
- Create: `apps/api/src/routes/account.ts`
- Modify: `apps/api/src/app.ts` (import near the other route imports; register inside the `if (opts)` block, after `registerMeRoute`)
- Test: `apps/api/test/account-delete.test.ts`

**Interfaces:**
- Consumes: `deleteAccount(db, userId): Promise<DeletionSummary>` from `@onelife/auth`; `getSession(auth, request)` from `../auth-plugin.js`.
- Produces: `registerAccountRoutes(app: FastifyInstance, db: Database, auth: Auth): void`, serving `DELETE /me`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/account-delete.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { user, gamertagLinks } from "@onelife/db";
import { createAuth, type Mailer } from "@onelife/auth";
import { buildApp } from "../src/app.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();

// Signing in for real: the magic-link flow, with a mailer that captures the link instead of
// sending it. This mirrors apps/api/test/gamertag-links.test.ts — copy that pattern, do not
// invent a way to forge a session.
const svc = Math.floor(Math.random() * 1e8) + 5e8;
const email = `ad${svc}@example.com`;
let lastLink = "";
const captureMailer: Mailer = { async send(msg) { lastLink = msg.url; } };
const auth = createAuth(db, {
  secret: "s".repeat(32), baseURL: "http://localhost", trustedOrigins: ["http://localhost"],
  providers: {}, mailer: captureMailer,
});
const app = buildApp(db, { auth, corsOrigins: ["http://localhost"] });

let cookie = "";

function cookieHeader(setCookie: string | string[] | undefined): string {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr.map((c) => c.split(";")[0]).join("; ");
}

async function signIn(): Promise<void> {
  await app.inject({
    method: "POST", url: "/api/auth/sign-in/magic-link",
    headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost" },
    payload: { email },
  });
  const verifyPath = lastLink.replace(/^https?:\/\/[^/]+/, "");
  const verify = await app.inject({ method: "GET", url: verifyPath, headers: { host: "localhost" } });
  cookie = cookieHeader(verify.headers["set-cookie"] as string | string[] | undefined);
}

beforeAll(async () => {
  await app.ready();
  await signIn();
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  await db.insert(gamertagLinks).values({ userId: u!.id, gamertag: `AD${svc}`, status: "verified" });
});

afterAll(async () => {
  // The happy-path test deletes the user, so this is belt-and-braces for a failed run.
  await sql`DELETE FROM "session" WHERE user_id IN (SELECT id FROM "user" WHERE email = ${email})`;
  await sql`DELETE FROM "account" WHERE user_id IN (SELECT id FROM "user" WHERE email = ${email})`;
  await sql`DELETE FROM "verification" WHERE identifier LIKE ${"%" + email + "%"}`;
  await sql`DELETE FROM "user" WHERE email = ${email}`;
  await app.close();
  await sql.end();
});

const send = (payload: unknown, hdrs: Record<string, string> = {}) =>
  app.inject({
    method: "DELETE", url: "/me",
    headers: { "content-type": "application/json", host: "localhost", ...hdrs },
    payload,
  });

describe("DELETE /me", () => {
  it("401s without a session", async () => {
    const res = await send({ confirm: "DELETE" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized" });
  });

  // ⚠️ The session is checked BEFORE the body, so an unauthenticated caller cannot tell a valid
  // session from an invalid one by whether they get a 400 or a 401.
  it("401s without a session even when the confirmation is wrong", async () => {
    const res = await send({ confirm: "nope" });
    expect(res.statusCode).toBe(401);
  });

  it("400s for a signed-in caller whose confirmation is missing or wrong-cased", async () => {
    expect((await send({}, { cookie })).statusCode).toBe(400);
    expect((await send({ confirm: "delete" }, { cookie })).statusCode).toBe(400);
    expect((await send({ confirm: true }, { cookie })).statusCode).toBe(400);
  });

  // Ordered last: it destroys the session every other test depends on.
  it("deletes the account, reports the summary, and invalidates the session", async () => {
    const res = await send({ confirm: "DELETE" }, { cookie });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, tokensForfeited: 0, gamertagLinksRemoved: 1 });

    expect(await db.select().from(user).where(eq(user.email, email))).toHaveLength(0);

    // The same cookie must now be worthless — the session row went with the user.
    const after = await app.inject({ method: "GET", url: "/me", headers: { host: "localhost", cookie } });
    expect(after.statusCode).toBe(401);
  });
});
```

⚠️ Vitest runs `it` blocks in declaration order within a file, which is what makes "ordered last"
safe. Do not reorder these, and do not add a test after the deletion one that expects a session.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @onelife/api test -- test/account-delete.test.ts`
Expected: FAIL — the route does not exist, so Fastify returns 404 rather than 401.

- [ ] **Step 3: Write the route**

Create `apps/api/src/routes/account.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@onelife/db";
import { deleteAccount, type Auth } from "@onelife/auth";
import { getSession } from "../auth-plugin.js";

// ⚠️ An EXACT, case-sensitive match on the literal string. Not a boolean, not a
// case-insensitive compare: the whole point is that the user typed this word deliberately.
const bodySchema = z.object({ confirm: z.literal("DELETE") });

export function registerAccountRoutes(app: FastifyInstance, db: Database, auth: Auth): void {
  // Takes NO subject parameter — the session is the only input, so deleting someone else's
  // account is unexpressible rather than merely rejected (repo house rule for /me routes).
  app.delete("/me", async (request, reply) => {
    // ⚠️ Session first, body second. Reversing these lets an unauthenticated caller tell a
    // valid session from an invalid one by the status code they get back.
    const session = await getSession(auth, request);
    if (!session) return reply.code(401).send({ error: "unauthorized" });

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "confirmation_required" });

    const summary = await deleteAccount(db, session.user.id);
    return { ok: true, ...summary };
  });
}
```

- [ ] **Step 4: Register it**

In `apps/api/src/app.ts`, add the import beside the other route imports:

```ts
import { registerAccountRoutes } from "./routes/account.js";
```

and register it inside the `if (opts) { … }` block, immediately after `registerMeRoute(app, opts.auth);`:

```ts
    registerAccountRoutes(app, db, opts.auth);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @onelife/api test -- test/account-delete.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 6: Run the full api suite and typecheck**

Run: `pnpm --filter @onelife/api test && pnpm --filter @onelife/api typecheck`
Expected: PASS, no regressions in the existing route tests.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/account.ts apps/api/src/app.ts apps/api/test/account-delete.test.ts
git commit -m "feat(api): add DELETE /me for account deletion"
```

---

### Task 3: Expose it through the shared API client

**Files:**
- Modify: `packages/api-client/src/endpoints.ts` (add one member beside the other `/me` endpoints)
- Modify: `packages/api-client/test/endpoints.test.ts` (add one test)
- Modify: `apps/web/src/lib/api.ts` (add one re-export)

**Interfaces:**
- Consumes: the `Transport` interface and `createApiClient` factory already in `packages/api-client`.
- Produces: `deleteAccount(): Promise<{ ok: true; tokensForfeited: number; gamertagLinksRemoved: number }>` on the client object, re-exported from `apps/web/src/lib/api.ts` under the same name.

- [ ] **Step 1: Write the failing test**

In `packages/api-client/test/endpoints.test.ts`, add inside the existing `describe("createApiClient", …)`:

```ts
  it("sends the account deletion confirmation as a DELETE body", async () => {
    const { transport, send } = fakeTransport();
    await createApiClient(transport).deleteAccount();
    expect(send).toHaveBeenCalledWith("DELETE", "/api/me", { confirm: "DELETE" });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @onelife/api-client test`
Expected: FAIL — `deleteAccount is not a function`.

- [ ] **Step 3: Add the endpoint**

In `packages/api-client/src/endpoints.ts`, add immediately after the `getMe` member (keeping `/me` endpoints together). **Extensionless imports in this package** — you are adding a member, not an import, but do not introduce a `.js` specifier anywhere here.

```ts
    /** Permanently deletes the signed-in account. The session dies with it, so this is the last
     *  thing the connection returns. Player history (lives, deaths, obituaries) SURVIVES — it is
     *  keyed by gamertag, not by user. The literal "DELETE" is what the server checks. */
    deleteAccount: () =>
      t.send<{ ok: true; tokensForfeited: number; gamertagLinksRemoved: number }>(
        "DELETE", "/api/me", { confirm: "DELETE" },
      ),
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @onelife/api-client test`
Expected: PASS — the new test plus the existing 18.

- [ ] **Step 5: Re-export from the web app**

In `apps/web/src/lib/api.ts`, add to the block of individual catalog re-exports, beside `export const getMe = api.getMe;`:

```ts
export const deleteAccount = api.deleteAccount;
```

- [ ] **Step 6: Typecheck both**

Run: `pnpm --filter @onelife/api-client typecheck && pnpm --filter @onelife/web typecheck`
Expected: exit 0 for both.

- [ ] **Step 7: Commit**

```bash
git add packages/api-client apps/web/src/lib/api.ts
git commit -m "feat(api-client): add deleteAccount endpoint"
```

---

### Task 4: The confirmation dialog

Where the four-render rule earns its keep. Built BEFORE the page that hosts it, so `DangerZone` can be written once, complete.

**Files:**
- Create: `apps/web/src/components/account/delete-account-dialog.tsx`
- Test: `apps/web/src/components/account/delete-account-dialog.test.tsx`

**Interfaces:**
- Consumes: `getTokens(): Promise<TokenWalletData>` and `deleteAccount()` from `@/lib/api`; `signOutAndTeardownPush()` from `@/lib/push`.
- Produces: `DeleteAccountDialog({ open, onClose }: { open: boolean; onClose: () => void })`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/components/account/delete-account-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getTokens = vi.fn();
const deleteAccount = vi.fn();
vi.mock("@/lib/api", () => ({
  getTokens: (...a: unknown[]) => getTokens(...a),
  deleteAccount: (...a: unknown[]) => deleteAccount(...a),
}));
vi.mock("@/lib/push", () => ({ signOutAndTeardownPush: vi.fn() }));

import { DeleteAccountDialog } from "./delete-account-dialog";

beforeEach(() => { getTokens.mockReset(); deleteAccount.mockReset(); });

describe("DeleteAccountDialog", () => {
  it("does not show a token number while the balance is still loading", () => {
    getTokens.mockReturnValue(new Promise(() => {})); // never resolves
    render(<DeleteAccountDialog open onClose={() => {}} />);
    expect(screen.queryByText(/tokens? will be forfeited/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^delete my account$/i })).toBeDisabled();
  });

  // ⚠️ THE BUG THIS GUARDS: rendering "0 tokens will be forfeited" because the FETCH FAILED,
  // while the user actually holds five, is a lie that costs them real money at the moment they
  // are least able to check it. Failed and zero are different renders.
  it("says the balance is unavailable when the fetch fails, never 0", async () => {
    getTokens.mockRejectedValue(new Error("network"));
    render(<DeleteAccountDialog open onClose={() => {}} />);
    await screen.findByText(/couldn't check your token balance/i);
    expect(screen.queryByText(/0 tokens/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^delete my account$/i })).toBeDisabled();
  });

  it("states the forfeited count once the balance resolves", async () => {
    getTokens.mockResolvedValue({ balance: 5, transactions: [] });
    render(<DeleteAccountDialog open onClose={() => {}} />);
    expect(await screen.findByText(/5 unspent tokens will be forfeited/i)).toBeInTheDocument();
  });

  it("renders a real zero balance as its own case", async () => {
    getTokens.mockResolvedValue({ balance: 0, transactions: [] });
    render(<DeleteAccountDialog open onClose={() => {}} />);
    expect(await screen.findByText(/you have no unspent tokens/i)).toBeInTheDocument();
  });

  it("keeps the confirm button disabled until DELETE is typed exactly", async () => {
    getTokens.mockResolvedValue({ balance: 0, transactions: [] });
    render(<DeleteAccountDialog open onClose={() => {}} />);
    await screen.findByText(/you have no unspent tokens/i);
    const confirm = screen.getByRole("button", { name: /^delete my account$/i });
    const field = screen.getByLabelText(/type delete to confirm/i);

    await userEvent.type(field, "delete");
    expect(confirm).toBeDisabled();

    await userEvent.clear(field);
    await userEvent.type(field, "DELETE");
    expect(confirm).toBeEnabled();
  });

  it("calls the endpoint on confirm", async () => {
    getTokens.mockResolvedValue({ balance: 0, transactions: [] });
    deleteAccount.mockResolvedValue({ ok: true, tokensForfeited: 0, gamertagLinksRemoved: 1 });
    render(<DeleteAccountDialog open onClose={() => {}} />);
    await screen.findByText(/you have no unspent tokens/i);
    await userEvent.type(screen.getByLabelText(/type delete to confirm/i), "DELETE");
    await userEvent.click(screen.getByRole("button", { name: /^delete my account$/i }));
    await waitFor(() => expect(deleteAccount).toHaveBeenCalledTimes(1));
  });

  it("tells the user when deletion fails and leaves the dialog open", async () => {
    getTokens.mockResolvedValue({ balance: 0, transactions: [] });
    deleteAccount.mockRejectedValue(new Error("boom"));
    render(<DeleteAccountDialog open onClose={() => {}} />);
    await screen.findByText(/you have no unspent tokens/i);
    await userEvent.type(screen.getByLabelText(/type delete to confirm/i), "DELETE");
    await userEvent.click(screen.getByRole("button", { name: /^delete my account$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't delete your account/i);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @onelife/web test -- src/components/account/delete-account-dialog.test.tsx`
Expected: FAIL — cannot resolve `./delete-account-dialog`.

- [ ] **Step 3: Write the component**

Create `apps/web/src/components/account/delete-account-dialog.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { getTokens, deleteAccount } from "@/lib/api";
import { signOutAndTeardownPush } from "@/lib/push";

/** ⚠️ FOUR renders, not two. `loading` and `failed` must never collapse into `0` — telling
 *  someone "0 tokens will be forfeited" when the fetch merely failed, and they in fact hold
 *  five, destroys real value at the one moment they cannot check. */
type Balance =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "loaded"; value: number };

export function DeleteAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [balance, setBalance] = useState<Balance>({ kind: "loading" });
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setBalance({ kind: "loading" });
    getTokens()
      .then((w) => { if (live) setBalance({ kind: "loaded", value: w.balance }); })
      .catch(() => { if (live) setBalance({ kind: "failed" }); });
    return () => { live = false; };
  }, [open]);

  if (!open) return null;

  // Confirm requires BOTH the exact word and a known balance: we will not let someone destroy
  // tokens whose count we could not read.
  const canConfirm = typed === "DELETE" && balance.kind === "loaded" && !busy;

  async function onConfirm() {
    setBusy(true);
    setError(null);
    try {
      await deleteAccount();
      // The server rows are gone, but the BROWSER's PushSubscription survives — the same
      // teardown sign-out uses is what clears it.
      await signOutAndTeardownPush();
      window.location.assign("/");
    } catch {
      setError("We couldn't delete your account. Nothing was changed — please try again.");
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Delete account" className="mt-4 border border-red-deep p-4">
      <p className="font-mono text-[11.5px] uppercase leading-relaxed tracking-[.03em] text-ink">
        This cannot be undone. Your sign-in, gamertag link and avatar are removed, and you are
        signed out everywhere. Your lives, deaths and obituaries stay on the site.
      </p>

      <p className="mt-3 font-mono text-[11.5px] uppercase tracking-[.03em] text-ink-muted">
        {balance.kind === "loading" ? "Checking your token balance…"
          : balance.kind === "failed" ? "We couldn't check your token balance, so we won't let you delete yet. Please try again."
          : balance.value === 0 ? "You have no unspent tokens."
          : `${balance.value} unspent tokens will be forfeited.`}
      </p>

      <label htmlFor="confirm-delete" className="mt-4 block font-mono text-[11px] uppercase tracking-[.03em] text-ink-muted">
        Type DELETE to confirm
      </label>
      <input
        id="confirm-delete"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        className="mt-1 w-full border border-dash bg-transparent px-3 py-2 font-mono text-sm text-ink"
      />

      {error ? (
        <p role="alert" className="mt-3 font-mono text-xs uppercase tracking-[.04em] text-red-deep">{error}</p>
      ) : null}

      <div className="mt-4 flex gap-3">
        <button type="button" onClick={onClose} className="border border-dash px-4 py-2 font-mono text-xs uppercase tracking-[.04em] text-ink">
          Cancel
        </button>
        <button
          type="button"
          disabled={!canConfirm}
          onClick={() => void onConfirm()}
          className="border border-red-deep px-4 py-2 font-mono text-xs uppercase tracking-[.04em] text-red-deep disabled:opacity-40"
        >
          Delete my account
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm --filter @onelife/web test -- src/components/account/delete-account-dialog.test.tsx`
Expected: PASS — 7 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @onelife/web typecheck`
Expected: exit 0. Nothing renders this component yet — Task 5 adds the page that does.

```bash
git add apps/web/src/components/account/delete-account-dialog.tsx apps/web/src/components/account/delete-account-dialog.test.tsx
git commit -m "feat(web): add the account deletion confirmation dialog"
```

---

### Task 5: The `/settings` page and its nav entry

Runs AFTER the dialog task, so `DangerZone` is written once, complete — no placeholder to come back to.

**Files:**
- Create: `apps/web/src/app/(site)/(boxed)/settings/page.tsx`
- Create: `apps/web/src/components/account/danger-zone.tsx`
- Modify: `apps/web/src/components/shell/nav-menu.tsx`
- Test: `apps/web/src/components/account/danger-zone.test.tsx`

**Interfaces:**
- Consumes: `DeleteAccountDialog({ open, onClose }: { open: boolean; onClose: () => void })` from `./delete-account-dialog` (built in Task 4).
- Produces: `DangerZone` (named export, no props) and the `/settings` route.

- [ ] **Step 1: Create the page**

Create `apps/web/src/app/(site)/(boxed)/settings/page.tsx`:

```tsx
import type { Metadata } from "next";
import { DangerZone } from "@/components/account/danger-zone";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false }, // a private settings page has no business in a search index
};

export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-md px-6 py-12">
      <h1 className="font-display text-4xl font-bold uppercase leading-[.95] text-ink">Settings</h1>
      <DangerZone />
    </main>
  );
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/components/account/danger-zone.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// DangerZone renders DeleteAccountDialog, which imports these. The dialog is closed here, so
// nothing is called — the mocks exist to keep this test off the real network modules.
vi.mock("@/lib/api", () => ({ getTokens: vi.fn(), deleteAccount: vi.fn() }));
vi.mock("@/lib/push", () => ({ signOutAndTeardownPush: vi.fn() }));

import { DangerZone } from "./danger-zone";

describe("DangerZone", () => {
  it("offers account deletion", () => {
    render(<DangerZone />);
    expect(screen.getByRole("button", { name: /delete account/i })).toBeInTheDocument();
  });

  it("says plainly that player history is kept", () => {
    render(<DangerZone />);
    expect(screen.getByText(/lives, deaths and obituaries stay/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @onelife/web test -- src/components/account/danger-zone.test.tsx`
Expected: FAIL — cannot resolve `./danger-zone`.

- [ ] **Step 4: Write the component**

Create `apps/web/src/components/account/danger-zone.tsx`:

```tsx
"use client";

import { useState } from "react";

export function DangerZone() {
  const [open, setOpen] = useState(false);

  return (
    <section className="mt-10 border border-red-deep/40 px-5 py-4">
      <h2 className="font-display text-sm font-bold uppercase tracking-[.14em] text-red-deep">Danger zone</h2>
      <p className="mt-2 font-mono text-[11.5px] uppercase leading-relaxed tracking-[.03em] text-ink-muted">
        Deleting your account removes your sign-in, your gamertag link and your avatar. Your
        lives, deaths and obituaries stay on the site — they belong to the gamertag, not the
        account.
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 border border-red-deep px-4 py-2 font-mono text-xs uppercase tracking-[.04em] text-red-deep"
      >
        Delete account
      </button>
      <DeleteAccountDialog open={open} onClose={() => setOpen(false)} />
    </section>
  );
}
```

with this import at the top, beside the `useState` import:

```tsx
import { DeleteAccountDialog } from "./delete-account-dialog";
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter @onelife/web test -- src/components/account/danger-zone.test.tsx`
Expected: PASS — 2 tests.

- [ ] **Step 6: Add the nav entry**

`/settings` is session-gated, so it does **not** belong in `NAV_ITEMS` (`apps/web/src/lib/nav.ts`), which is the public section nav. Add it to the signed-in block of `apps/web/src/components/shell/nav-menu.tsx` instead, between the profile link and the Sign out button:

```tsx
                  <Link role="menuitem" href="/settings" onClick={close} className={itemClass}>
                    Settings
                  </Link>
```

- [ ] **Step 7: Run the web suite**

Run: `pnpm --filter @onelife/web test`
Expected: PASS. If a nav-menu test asserts an exact item count, update that count — it is a deliberate change, not a regression.

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm --filter @onelife/web typecheck`

```bash
git add apps/web/src/app apps/web/src/components
git commit -m "feat(web): add /settings with a danger zone"
```

---

### Task 6: Verification, un-verified list, and changelog

**Files:**
- Modify: `CLAUDE.md` (the "Outstanding, un-verified work" list)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Whole-repo checks**

Run: `pnpm turbo run typecheck --concurrency=1`
Expected: all tasks pass.

Run: `pnpm turbo run test --concurrency=1`
Expected: all pass, **including the DB-backed suites** — this plan's core tests are DB-backed, so unlike a bundler-only change they must actually run. If they fail on `ECONNREFUSED`, start Postgres (`docker compose up -d postgres`, checking `docker ps` for a remapped port) and migrate the test database with `DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate`. **Do not report a pass without these suites running.**

- [ ] **Step 2: Confirm no schema migration was added**

Run: `git status --short packages/db/drizzle`
Expected: empty. This feature deliberately adds **no** migration — it changes no table definitions, only rows. If a migration appeared, something went beyond the plan; report it.

- [ ] **Step 3: Record the browser-only claims**

Append to the "Outstanding, un-verified work" list in `CLAUDE.md`, matching the existing bullet style:

```markdown
- Account deletion's browser-only claims, none of which RTL can prove: the confirmation dialog
  at 320px and in PWA/standalone on a notched phone; and the full round trip against a real
  signed-in session — delete → signed out on every device → the dossier still standing,
  unverified and avatar-less, with its lives and obituaries intact. Use CDP
  `Emulation.setDeviceMetricsOverride`.
```

- [ ] **Step 4: Changelog**

`.keel.json` sets `requireChangelog: true`, and the entry is written last. Read the top of `CHANGELOG.md` and follow the existing `## [Unreleased]` / `### Added` convention rather than inventing one:

```markdown
### Added

- Account deletion. `/settings` gains a danger zone that permanently deletes your account via
  `DELETE /me`. Player history is deliberately kept — lives, deaths and obituaries belong to the
  gamertag, not the account — so a deleted user's dossier survives, unverified and avatar-less.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md CHANGELOG.md
git commit -m "docs: changelog and un-verified list for account deletion"
```

---

## Notes for the executor

**This plan adds no database migration.** Every FK it relies on already exists; the three that lack cascades are handled in application code, deliberately, so the behaviour is visible where someone will read it.

**If a test fails because a cascade you expected did not fire,** check the FK's `onDelete` in `packages/db/src/schema.ts` before changing the test — the spec's table of which FKs cascade is the reference, and a mismatch there is a finding worth reporting rather than accommodating.
