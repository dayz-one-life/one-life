# Verified Home + Profile Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the verified user's home with a life-tickets stage, a two-half controls slab and a filed-obituaries morgue, serve the same surface at `/players/{slug}`, and build the referral-link plumbing the new invite panel needs.

**Architecture:** The stage/tickets/morgue become server-rendered components fed by `getPlayerPage`, with client islands for the four interactive controls (avatar pencil, send-token field, share bar, spend button). Referral links are a cookie set by a Route Handler at `/i/{slug}` and consumed by a same-origin Route Handler that writes a `referrals` row; payout stays gated on the referee's verified link by the existing sweep.

**Tech Stack:** Next.js App Router (RSC + client islands), Fastify, Drizzle/Postgres, Vitest + React Testing Library, Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-30-verified-home-redesign-design.md` — read §2–§4 alongside the converged preview at `apps/web/src/app/(site)/(boxed)/design-preview/page.tsx`, which is the visual source of truth and carries a ⚠️ comment on every reversed decision.

## Global Constraints

- **Loading, failed, empty and zero are four different renders.** Never let an in-flight or failed fetch fall through to an authoritative `0`/`[]`. `PageHeader`'s `count` union is the pattern to copy.
- **Independent fetches degrade independently.** One shared try/catch around two feeds silently guts half the page.
- **Ownership and access are WHERE-clause predicates, never post-filters**, and the boundary is a **`verified`** `gamertag_links` row — never `pending`.
- **A `/me` route takes no subject parameter.** The session is the only input.
- **The controls two-column split is `lg`, never `md`** (spec §3). At `md` each half is ~336px and both the share row and the heading row wrap raggedly.
- **Named Tailwind font-size utilities only** next to a color in a `cn()` call — `cn("text-6xl", "text-ink")`, never `cn("text-[64px]", "text-ink")`. twMerge cannot tell an arbitrary `text-[...]` from a `text-<color>` and silently drops one.
- **Every ticket carries a Timeline link in both viewers**; a server with no life renders no link (spec §2.1).
- **The morgue lists filed obituaries only**, and zero is a real, common state needing its own render (spec §4).
- **`/players/{me}` redirects `307`, never 308** (spec §6).
- Test DB migrations: `DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate`. Any new env var a suite reads must be added to `turbo.json`'s `test` task `env` list.
- Run the full suite with `pnpm turbo run test --concurrency=1`; typecheck with `pnpm turbo run typecheck`.

---

### Task 1: `claimReferrer` — a referral claim that does not require a verified referee

**Files:**
- Create: `packages/tokens/src/claim-referrer.ts`
- Modify: `packages/tokens/src/index.ts`
- Test: `packages/tokens/test/claim-referrer.test.ts`

**Interfaces:**
- Consumes: `TokenError`, `verifiedOf` from `packages/tokens/src/internal.ts`; `referrals` from `@onelife/db`.
- Produces: `claimReferrer(db: Database, a: { userId: string; referrerUserId: string }): Promise<"claimed" | "noop">`, exported from `@onelife/tokens`.

**Why this is not `setReferrer`:** the existing `setReferrer` requires BOTH sides verified and throws `already_set`. A link claim happens at sign-in, when the referee has verified nothing yet, and may fire more than once — so it requires only the REFERRER to be verified and treats a repeat as a silent success. Payout is still gated on the referee verifying, by `grantReferral`'s inner join on `status = 'verified'`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/tokens/test/claim-referrer.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { user, referrals, gamertagLinks, servers } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { claimReferrer } from "../src/claim-referrer.js";
import { TokenError } from "../src/internal.js";

const { db, sql } = getTestDb();

beforeAll(async () => {
  const [srv] = await db.insert(servers).values({ name: "CR", map: "chernarus", slug: "chernarus" }).returning();
  await db.insert(user).values([
    { id: "cr-ref", name: "Referrer", email: "ref@x.com" },      // verified referrer
    { id: "cr-new", name: "Newcomer", email: "new@x.com" },      // unverified referee
    { id: "cr-new2", name: "Newcomer2", email: "new2@x.com" },
    { id: "cr-unv", name: "Unverified", email: "unv@x.com" },    // unverified would-be referrer
  ]);
  await db.insert(gamertagLinks).values({
    userId: "cr-ref", gamertag: "Referrer", status: "verified", serverId: srv.id, verifiedAt: new Date(),
  });
});
afterAll(async () => { await sql.end(); });

describe("claimReferrer", () => {
  it("claims for a referee who has verified NOTHING yet", async () => {
    expect(await claimReferrer(db, { userId: "cr-new", referrerUserId: "cr-ref" })).toBe("claimed");
    const rows = await db.select().from(referrals).where(eq(referrals.userId, "cr-new"));
    expect(rows[0]?.referrerUserId).toBe("cr-ref");
  });

  it("is a silent no-op on a repeat claim and NEVER overwrites the existing referrer", async () => {
    expect(await claimReferrer(db, { userId: "cr-new", referrerUserId: "cr-unv" })).toBe("noop");
    const rows = await db.select().from(referrals).where(eq(referrals.userId, "cr-new"));
    expect(rows[0]?.referrerUserId).toBe("cr-ref"); // unchanged
  });

  it("rejects self-referral", async () => {
    await expect(claimReferrer(db, { userId: "cr-ref", referrerUserId: "cr-ref" }))
      .rejects.toThrow(TokenError);
  });

  it("rejects an unverified referrer", async () => {
    await expect(claimReferrer(db, { userId: "cr-new2", referrerUserId: "cr-unv" }))
      .rejects.toThrow(TokenError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @onelife/db run db:migrate && pnpm --filter @onelife/tokens test claim-referrer`
Expected: FAIL — cannot resolve `../src/claim-referrer.js`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/tokens/src/claim-referrer.ts
import { type Database, referrals } from "@onelife/db";
import { TokenError, verifiedOf } from "./internal.js";

/**
 * Record a referral claim from an invite link. Distinct from `setReferrer`, deliberately:
 *
 * ⚠️ Only the REFERRER must be verified. The referee is claiming at sign-in, before they have
 * verified anything — and that is safe because `grantReferral` inner-joins `gamertag_links` on
 * `status = 'verified'`, so the row pays nothing until the referee verifies, and pays
 * automatically once they do.
 *
 * ⚠️ A repeat claim is a silent "noop", never a throw and never an overwrite: the claim island
 * may fire more than once, and a second invite link must not reassign an existing referrer.
 *
 * Throws TokenError('self_referral' | 'not_verified').
 */
export async function claimReferrer(
  db: Database,
  a: { userId: string; referrerUserId: string },
): Promise<"claimed" | "noop"> {
  if (a.userId === a.referrerUserId) throw new TokenError("self_referral");
  if (!(await verifiedOf(db, a.referrerUserId))) throw new TokenError("not_verified");
  const inserted = await db
    .insert(referrals)
    .values({ userId: a.userId, referrerUserId: a.referrerUserId })
    .onConflictDoNothing({ target: referrals.userId })
    .returning({ userId: referrals.userId });
  return inserted.length > 0 ? "claimed" : "noop";
}
```

Add to `packages/tokens/src/index.ts`, beside the existing `setReferrer` export:

```typescript
export { claimReferrer } from "./claim-referrer.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/tokens test claim-referrer`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/tokens/src/claim-referrer.ts packages/tokens/src/index.ts packages/tokens/test/claim-referrer.test.ts
git commit -m "feat(tokens): claimReferrer for invite-link claims by unverified referees"
```

---

### Task 2: Referral payout becomes a one-time bounty

**Files:**
- Modify: `packages/tokens/src/sweeps.ts:28-43`
- Test: `packages/tokens/test/sweeps.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `grantReferral(db, yyyymm)` keeps its signature — `yyyymm` stays a parameter so the caller is unchanged, but it no longer affects the idempotency key.

**Why:** the key is currently `referral:{referrer}:{referee}:{yyyymm}`, so a referrer earns one token per referee EVERY month, forever, against a 1/month base grant. Ten referees would mint 11 tokens a month and make a ban-lifting currency worthless.

- [ ] **Step 1: Write the failing test**

Add to `packages/tokens/test/sweeps.test.ts`, inside the existing `describe` for referral sweeps (reuse that file's existing fixture users; if it has no referral describe block, add one and create a verified referee + referrer with the same helpers the file already uses):

```typescript
it("pays a referrer ONCE per referee, not once per month", async () => {
  expect(await grantReferral(db, "2026-07")).toBe(1);
  // Same referee, a different month — must grant nothing.
  expect(await grantReferral(db, "2026-08")).toBe(0);
  expect(await grantReferral(db, "2026-09")).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/tokens test sweeps`
Expected: FAIL — the 2026-08 sweep returns 1, because the month is part of the key.

- [ ] **Step 3: Write the implementation**

In `packages/tokens/src/sweeps.ts`, change the doc comment and the key:

```typescript
/**
 * One token to a referrer per verified referee — ONCE, EVER (item 16).
 *
 * ⚠️ `yyyymm` is deliberately NOT in the idempotency key. It used to be, which made this an
 * annuity: a referrer earned a token per referee every month forever, against a 1/month base
 * grant. Ten referees minted 11 tokens a month. The parameter stays for caller compatibility.
 */
export async function grantReferral(db: Database, _yyyymm: string): Promise<number> {
```

and inside the loop:

```typescript
    if (await grant(db, { userId: r.referrer, kind: "referral", idempotencyKey: `referral:${r.referrer}:${r.referee}` })) n++;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/tokens test sweeps`
Expected: PASS. Existing sweep tests must still pass — if one asserted a second month granting again, that assertion encoded the bug and should be updated to expect 0.

- [ ] **Step 5: Commit**

```bash
git add packages/tokens/src/sweeps.ts packages/tokens/test/sweeps.test.ts
git commit -m "fix(tokens): referral pays once per referee, not monthly forever"
```

---

### Task 3: Join count read-model + `GET /me/referrals`

**Files:**
- Create: `packages/tokens/src/referral-count.ts`
- Modify: `packages/tokens/src/index.ts`, `apps/api/src/routes/tokens.ts`
- Test: `packages/tokens/test/referral-count.test.ts`

**Interfaces:**
- Consumes: `referrals`, `gamertagLinks` from `@onelife/db`.
- Produces: `countVerifiedReferees(db: Database, referrerUserId: string): Promise<number>` from `@onelife/tokens`; `GET /me/referrals` returning `{ joined: number }`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/tokens/test/referral-count.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, referrals, gamertagLinks, servers } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { countVerifiedReferees } from "../src/referral-count.js";

const { db, sql } = getTestDb();

beforeAll(async () => {
  const [srv] = await db.insert(servers).values({ name: "RC", map: "chernarus", slug: "chernarus" }).returning();
  await db.insert(user).values([
    { id: "rc-ref", name: "Ref", email: "rcref@x.com" },
    { id: "rc-a", name: "A", email: "rca@x.com" },   // verified referee
    { id: "rc-b", name: "B", email: "rcb@x.com" },   // pending referee — must NOT count
    { id: "rc-c", name: "C", email: "rcc@x.com" },   // no link at all — must NOT count
  ]);
  await db.insert(gamertagLinks).values([
    { userId: "rc-a", gamertag: "A", status: "verified", serverId: srv.id, verifiedAt: new Date() },
    { userId: "rc-b", gamertag: "B", status: "pending", serverId: srv.id },
  ]);
  await db.insert(referrals).values([
    { userId: "rc-a", referrerUserId: "rc-ref" },
    { userId: "rc-b", referrerUserId: "rc-ref" },
    { userId: "rc-c", referrerUserId: "rc-ref" },
  ]);
});
afterAll(async () => { await sql.end(); });

describe("countVerifiedReferees", () => {
  it("counts only referees holding a VERIFIED link", async () => {
    expect(await countVerifiedReferees(db, "rc-ref")).toBe(1);
  });

  it("returns 0 for a user who has referred nobody", async () => {
    expect(await countVerifiedReferees(db, "rc-a")).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/tokens test referral-count`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/tokens/src/referral-count.ts
import { and, eq, sql, countDistinct } from "drizzle-orm";
import { type Database, referrals, gamertagLinks } from "@onelife/db";

/**
 * How many people this user referred who went on to verify.
 *
 * ⚠️ `verified` is the boundary and it is a WHERE-clause predicate via the join, never a
 * post-filter — a `pending` link is not a joined survivor. countDistinct guards a referee who
 * somehow holds two verified links from counting twice.
 */
export async function countVerifiedReferees(db: Database, referrerUserId: string): Promise<number> {
  const [row] = await db
    .select({ n: countDistinct(referrals.userId) })
    .from(referrals)
    .innerJoin(
      gamertagLinks,
      and(eq(gamertagLinks.userId, referrals.userId), eq(gamertagLinks.status, "verified")),
    )
    .where(eq(referrals.referrerUserId, referrerUserId));
  return Number(row?.n ?? 0);
}
```

Export it from `packages/tokens/src/index.ts`:

```typescript
export { countVerifiedReferees } from "./referral-count.js";
```

Add the route in `apps/api/src/routes/tokens.ts`, inside `registerTokenRoutes`, importing `countVerifiedReferees` alongside the existing `@onelife/tokens` imports:

```typescript
  // ⚠️ No subject parameter — the session is the only input, so serving another player's
  // referral count is unexpressible rather than merely rejected.
  app.get("/me/referrals", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    return { joined: await countVerifiedReferees(db, session.user.id) };
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/tokens test referral-count && pnpm --filter @onelife/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tokens/src/referral-count.ts packages/tokens/src/index.ts packages/tokens/test/referral-count.test.ts apps/api/src/routes/tokens.ts
git commit -m "feat(api): GET /me/referrals join count, gated on verified referees"
```

---

### Task 4: `POST /me/referrer/claim` — resolve an invite slug and record the claim

**Files:**
- Modify: `apps/api/src/routes/tokens.ts`
- Test: `apps/api/test/tokens-claim.test.ts` (follow the existing API test file's harness — copy the app-construction boilerplate from the nearest existing `apps/api/test/*.test.ts`)

**Interfaces:**
- Consumes: `claimReferrer` (Task 1); `resolveGamertagBySlug` from `@onelife/read-models`; `verifiedUserIdByGamertag` from `./verified-gamertag.js`.
- Produces: `POST /me/referrer/claim` with body `{ referrerSlug: string }` → `{ ok: true, claimed: boolean }`. **Never 4xx for an unresolvable slug** — see below.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/test/tokens-claim.test.ts — signed-in as the referee for each case
describe("POST /me/referrer/claim", () => {
  it("claims from a slug for a referee who has verified nothing", async () => {
    const res = await app.inject({
      method: "POST", url: "/me/referrer/claim",
      payload: { referrerSlug: "referrer" }, cookies: sessionCookieFor("claim-new"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, claimed: true });
  });

  it("is a silent success for an unknown slug — the visitor did nothing wrong", async () => {
    const res = await app.inject({
      method: "POST", url: "/me/referrer/claim",
      payload: { referrerSlug: "nobody-at-all" }, cookies: sessionCookieFor("claim-new2"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, claimed: false });
  });

  it("is a silent success for self-referral", async () => {
    const res = await app.inject({
      method: "POST", url: "/me/referrer/claim",
      payload: { referrerSlug: "referrer" }, cookies: sessionCookieFor("claim-referrer-self"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, claimed: false });
  });

  it("401s when signed out", async () => {
    const res = await app.inject({ method: "POST", url: "/me/referrer/claim", payload: { referrerSlug: "referrer" } });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/api test tokens-claim`
Expected: FAIL — 404, route not registered.

- [ ] **Step 3: Write the implementation**

In `apps/api/src/routes/tokens.ts`, add `resolveGamertagBySlug` to the `@onelife/read-models` imports and `claimReferrer` to the `@onelife/tokens` imports, then:

```typescript
const claimBody = z.object({ referrerSlug: z.string().min(1) });

  /**
   * Record a referral claim captured from an invite link.
   *
   * ⚠️ EVERY failure mode here is a 200 with `claimed: false`, not a 4xx. An unknown slug, an
   * unverified referrer, a self-referral and an already-claimed referee are all things the
   * VISITOR cannot be blamed for and must not be told about — and the caller is a
   * fire-and-forget island whose only job is to stop retrying. The one real error is 401.
   */
  app.post("/me/referrer/claim", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const body = claimBody.parse(req.body);
    const gamertag = await resolveGamertagBySlug(db, body.referrerSlug);
    if (!gamertag) return { ok: true, claimed: false };
    const referrerUserId = await verifiedUserIdByGamertag(db, gamertag);
    if (!referrerUserId) return { ok: true, claimed: false };
    try {
      const outcome = await claimReferrer(db, { userId: session.user.id, referrerUserId });
      return { ok: true, claimed: outcome === "claimed" };
    } catch (e) {
      if (e instanceof TokenError) return { ok: true, claimed: false };
      throw e;
    }
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/api test tokens-claim`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/tokens.ts apps/api/test/tokens-claim.test.ts
git commit -m "feat(api): POST /me/referrer/claim resolves an invite slug"
```

---

### Task 5: `/i/{slug}` — the invite link

**Files:**
- Create: `apps/web/src/app/i/[slug]/route.ts`
- Create: `apps/web/src/lib/referral-cookie.ts`
- Test: `apps/web/src/app/i/[slug]/route.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `REFERRAL_COOKIE = "ol_ref"` and `REFERRAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 30` from `@/lib/referral-cookie`; a `GET` Route Handler that sets the cookie and 307s to `/`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/app/i/[slug]/route.test.ts
import { describe, it, expect } from "vitest";
import { GET } from "./route";
import { REFERRAL_COOKIE } from "@/lib/referral-cookie";

const call = (slug: string) =>
  GET(new Request(`https://dayzonelife.com/i/${slug}`), { params: Promise.resolve({ slug }) });

describe("GET /i/[slug]", () => {
  it("307s to / — never 308, the destination depends on the session", async () => {
    const res = await call("manicdote");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/");
  });

  it("sets an httpOnly, Lax, 30-day referral cookie naming the slug", async () => {
    const cookie = (await call("manicdote")).headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${REFERRAL_COOKIE}=manicdote`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(cookie).toContain("Max-Age=2592000");
  });

  it("does not reflect a slug it cannot store safely", async () => {
    const cookie = (await call("../../evil")).headers.get("set-cookie") ?? "";
    expect(cookie).not.toContain("evil");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/web test "i/\[slug\]"`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Write the implementation**

```typescript
// apps/web/src/lib/referral-cookie.ts
/** The invite-link referral cookie. Read by the claim Route Handler, written by /i/[slug]. */
export const REFERRAL_COOKIE = "ol_ref";
export const REFERRAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/** Player slugs are `[a-z0-9-]` by construction (see `playerSlug`). Anything else never reaches
 *  the cookie — the value is echoed into a Set-Cookie header and later into an API call. */
export function isStorableSlug(slug: string): boolean {
  return /^[a-z0-9-]{1,64}$/.test(slug);
}
```

```typescript
// apps/web/src/app/i/[slug]/route.ts
import { NextResponse } from "next/server";
import { REFERRAL_COOKIE, REFERRAL_COOKIE_MAX_AGE, isStorableSlug } from "@/lib/referral-cookie";

/**
 * The invite link. Sets a cookie naming the referrer and bounces to the home page.
 *
 * ⚠️ A Route Handler, not a page: only Route Handlers and server actions may set cookies.
 *
 * ⚠️ It creates NO `referrals` row — the visitor has no account yet. The claim is made after
 * sign-in by `app/api/referral/claim/route.ts`.
 *
 * ⚠️ 307, never 308: where an invite lands depends on whether the visitor has a session, and a
 * permanent redirect on a session-dependent decision gets cached against them.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const res = NextResponse.redirect(new URL("/", "https://dayzonelife.com"), 307);
  if (isStorableSlug(slug)) {
    res.cookies.set(REFERRAL_COOKIE, slug, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: REFERRAL_COOKIE_MAX_AGE,
    });
  }
  return res;
}
```

If the test harness reports the `location` header as absolute, assert with `expect(new URL(res.headers.get("location")!).pathname).toBe("/")` instead — keep the 307 assertion exact either way.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/web test "i/\[slug\]"`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/referral-cookie.ts "apps/web/src/app/i/[slug]/route.ts" "apps/web/src/app/i/[slug]/route.test.ts"
git commit -m "feat(web): /i/[slug] invite link sets a referral cookie"
```

---

### Task 6: The claim handler and its island

**Files:**
- Create: `apps/web/src/app/api/referral/claim/route.ts`
- Create: `apps/web/src/components/account/referral-claim.tsx`
- Test: `apps/web/src/app/api/referral/claim/route.test.ts`, `apps/web/src/components/account/referral-claim.test.tsx`

**Interfaces:**
- Consumes: `REFERRAL_COOKIE` (Task 5); `POST /me/referrer/claim` (Task 4); the app's existing authenticated API-POST helper in `apps/web/src/lib/api.ts` — use whatever that file already exports for cookie-forwarding POSTs rather than inventing one.
- Produces: `<ReferralClaim />`, a client island rendering `null`.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/web/src/app/api/referral/claim/route.test.ts
describe("POST /api/referral/claim", () => {
  it("clears the cookie even when the upstream claim fails", async () => {
    // upstream mocked to reject
    const res = await POST(requestWithCookie("manicdote"));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toContain("Max-Age=0");
  });

  it("does nothing and clears nothing when there is no cookie", async () => {
    const res = await POST(new Request("https://dayzonelife.com/api/referral/claim", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(upstreamSpy).not.toHaveBeenCalled();
  });

  it("forwards the slug upstream and clears the cookie on success", async () => {
    const res = await POST(requestWithCookie("manicdote"));
    expect(upstreamSpy).toHaveBeenCalledWith("manicdote");
    expect(res.headers.get("set-cookie") ?? "").toContain("Max-Age=0");
  });
});
```

```typescript
// apps/web/src/components/account/referral-claim.test.tsx
it("posts exactly once even under StrictMode double-invoke", async () => {
  const spy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}"));
  render(<StrictMode><ReferralClaim /></StrictMode>);
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
});

it("renders nothing", () => {
  const { container } = render(<ReferralClaim />);
  expect(container).toBeEmptyDOMElement();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @onelife/web test referral`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

```typescript
// apps/web/src/app/api/referral/claim/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { REFERRAL_COOKIE } from "@/lib/referral-cookie";
import { postReferrerClaim } from "@/lib/api";

/**
 * Consume the invite cookie: forward the slug to the API, then clear it.
 *
 * ⚠️ SAME-ORIGIN is the point. The cookie is httpOnly and scoped to the web origin, so only a
 * handler on that origin receives it — and only a Route Handler can clear it afterwards.
 *
 * ⚠️ The cookie is cleared WHATEVER happens. A cookie that survives a failed claim retries
 * forever, on every page load, for thirty days.
 */
export async function POST() {
  const jar = await cookies();
  const slug = jar.get(REFERRAL_COOKIE)?.value;
  const res = NextResponse.json({ ok: true });
  if (!slug) return res;
  try {
    await postReferrerClaim(slug);
  } catch {
    // Deliberately swallowed: a failed claim must never surface to a player who just signed in.
  }
  res.cookies.set(REFERRAL_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
```

```tsx
// apps/web/src/components/account/referral-claim.tsx
"use client";
import { useEffect, useRef } from "react";

/**
 * Fires the one-shot referral claim after sign-in. Renders nothing.
 *
 * Mounted on `/welcome` (the OAuth callback) and on signed-in `/`, because a player can arrive
 * either way and the cookie lives for 30 days. The handler is idempotent and `claimReferrer`
 * treats a repeat as a silent no-op, so a double mount is harmless — the ref guard is for
 * StrictMode's double-invoke, not for correctness.
 */
export function ReferralClaim() {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    void fetch("/api/referral/claim", { method: "POST" }).catch(() => {});
  }, []);
  return null;
}
```

Add the client helper to `apps/web/src/lib/api.ts`, matching that file's existing POST style:

```typescript
export const postReferrerClaim = (referrerSlug: string) =>
  apiPost<{ ok: true; claimed: boolean }>("/api/me/referrer/claim", { referrerSlug });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/web test referral`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/referral/claim apps/web/src/components/account/referral-claim.tsx apps/web/src/lib/api.ts
git commit -m "feat(web): consume the referral cookie after sign-in"
```

---

### Task 7: The share bar

**Files:**
- Create: `apps/web/src/components/account/share-bar.tsx`
- Test: `apps/web/src/components/account/share-bar.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `<ShareBar link={string} />`, a client component.

Transcribe the converged `ShareBar` from the preview (`design-preview/page.tsx`) — targets, SVG paths, hover classes, layout and every ⚠️ comment — replacing the module-level `REF_LINK` constant with the `link` prop.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/components/account/share-bar.test.tsx
const LINK = "https://dayzonelife.com/i/manicdote";

it("renders the link read-only and one target per platform", () => {
  render(<ShareBar link={LINK} />);
  expect(screen.getByLabelText("Your invite link")).toHaveValue(LINK);
  expect(screen.getByLabelText("Share on X")).toHaveAttribute("href", expect.stringContaining(encodeURIComponent(LINK)));
  expect(screen.getByLabelText("Share on Reddit")).toBeInTheDocument();
  expect(screen.getByLabelText("Share on WhatsApp")).toBeInTheDocument();
  expect(screen.getByLabelText("Share by email")).toBeInTheDocument();
});

it("makes Discord a COPY action, not a link — Discord has no web share intent", () => {
  render(<ShareBar link={LINK} />);
  const discord = screen.getByLabelText("Copy for Discord");
  expect(discord.tagName).toBe("BUTTON");
  expect(discord).not.toHaveAttribute("href");
});

it("announces the copy confirmation in a live region", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<ShareBar link={LINK} />);
  await userEvent.click(screen.getByRole("button", { name: /copy link/i }));
  expect(writeText).toHaveBeenCalledWith(LINK);
  expect(await screen.findByText(/link copied/i)).toBeInTheDocument();
});

it("omits the native-share button when navigator.share is absent", () => {
  // @ts-expect-error - deleting an optional platform capability
  delete navigator.share;
  render(<ShareBar link={LINK} />);
  expect(screen.queryByRole("button", { name: /more/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/web test share-bar`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Transcribe `ShareBar` and its `TARGETS` array from the preview verbatim, with `link` as a prop. Keep these comments — each records a real constraint:
- Discord has no web share intent; its target copies to the clipboard.
- `navigator.share` is checked in an effect after mount (SSR and first client render must agree) and is an EXTRA button, never the only path.
- The live region sits INSIDE the target row; as its own row it added ~20px and broke alignment with the tokens half.
- The `Share to` label is `sr-only` below `sm`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/web test share-bar`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/account/share-bar.tsx apps/web/src/components/account/share-bar.test.tsx
git commit -m "feat(web): share bar with per-platform invite targets"
```

---

### Task 8: The controls slab

**Files:**
- Create: `apps/web/src/components/account/controls-slab.tsx`
- Test: `apps/web/src/components/account/controls-slab.test.tsx`

**Interfaces:**
- Consumes: `<ShareBar />` (Task 7); the existing `useControls` / `useControlsActions` and `TokensPanel`'s transfer mutation wiring in `apps/web/src/components/account/`.
- Produces: `<ControlsSlab />`, a client component reading its own data from `useControls`.

Transcribe the converged `Controls`, `Half`, `Figure`, `EarnChips` and `SendField` from the preview, replacing mock constants with live data: balance from the existing tokens query, join count from `GET /me/referrals` (Task 3), invite link built as `${origin}/i/${ownSlug}`.

- [ ] **Step 1: Write the failing test**

```typescript
it("keeps the two-column split at lg, never md", () => {
  const { container } = render(<ControlsSlab />);
  const grid = container.querySelector(".grid");
  expect(grid?.className).toContain("lg:grid-cols-2");
  expect(grid?.className).not.toContain("md:grid-cols-2");
});

it("renders balance and join count as inline figures, not display numerals", () => {
  render(<ControlsSlab />); // balance 3, joined 2 from mocked hooks
  expect(screen.getByText("3")).toHaveClass("text-xl");
  expect(screen.getByText(/in hand/i)).toBeInTheDocument();
  expect(screen.getByText(/joined so far/i)).toBeInTheDocument();
});

it("shows loading, not a zero balance, while the query is in flight", () => {
  // useControls mocked to pending
  render(<ControlsSlab />);
  expect(screen.queryByText(/in hand/i)).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toBeInTheDocument();
});

it("builds the invite link from the viewer's own slug", () => {
  render(<ControlsSlab />);
  expect(screen.getByLabelText("Your invite link")).toHaveValue(expect.stringContaining("/i/manicdote"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/web test controls-slab`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Transcribe from the preview. Preserve verbatim:
- The one shared `Half` skeleton (`h2 + inline figure → sentence → mt-auto control → hint`) and its ⚠️ comment. Do not give either half its own rhythm.
- `lg:grid-cols-2` with the ⚠️ comment explaining why it is not `md`.
- `max-w-xl lg:max-w-none` on the control group.
- `lg:justify-between` on the heading row.
- The `Earn by` chips (`+1 on the 1st`, `+1 per invite`), `sr-only` label below `sm`.

**A pending or failed balance renders a status placeholder — never `0`.** Zero tokens and an unknown balance are different facts.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/web test controls-slab`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/account/controls-slab.tsx apps/web/src/components/account/controls-slab.test.tsx
git commit -m "feat(web): token + invite controls slab"
```

---

### Task 9: The life-tickets stage

**Files:**
- Create: `apps/web/src/components/player/ticket-stage.tsx`
- Test: `apps/web/src/components/player/ticket-stage.test.tsx`

**Interfaces:**
- Consumes: `ServerStanding` and `PlayerPage` from `@/lib/types`; `Avatar` from `@/components/shared/avatar`; `FitLine` from `@/components/front-page/fit-line`; `lifeHrefBySlug` from `@/lib/life-href`.
- Produces: `<TicketStage page={PlayerPage} viewer={"owner" | "public"} now={Date} onSpend?={(banId: number) => void} />`.

- [ ] **Step 1: Write the failing test**

```typescript
it("uses the gamertag as the h1 in BOTH viewers", () => {
  render(<TicketStage page={page} viewer="public" now={NOW} />);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Manicdote");
});

it("renders one ticket per server and a timeline link on each life", () => {
  render(<TicketStage page={page} viewer="public" now={NOW} />);
  expect(screen.getAllByRole("link", { name: /timeline/i })).toHaveLength(3);
});

it("renders NO timeline link for a server the player has never played", () => {
  render(<TicketStage page={pageWithNeverPlayedNamalsk} viewer="owner" now={NOW} />);
  const namalsk = screen.getByRole("listitem", { name: /namalsk/i });
  expect(within(namalsk).queryByRole("link", { name: /timeline/i })).not.toBeInTheDocument();
});

it("offers Spend only to the owner, and only on a banned ticket", () => {
  const { rerender } = render(<TicketStage page={page} viewer="public" now={NOW} />);
  expect(screen.queryByRole("button", { name: /spend 1 token/i })).not.toBeInTheDocument();
  rerender(<TicketStage page={page} viewer="owner" now={NOW} />);
  expect(screen.getAllByRole("button", { name: /spend 1 token/i })).toHaveLength(1); // the banned one
});

it("never renders an unqualified life as qualified", () => {
  render(<TicketStage page={pageWithGraceWindowLife} viewer="owner" now={NOW} />);
  expect(screen.getByText(/not yet qualified/i)).toBeInTheDocument();
});

it("shows no pencil to the public viewer", () => {
  render(<TicketStage page={page} viewer="public" now={NOW} />);
  expect(screen.queryByRole("button", { name: /update your photo/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/web test ticket-stage`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Transcribe `TicketStage` from the preview, mapping mock `Row`s onto real `ServerStanding`s:
- `state` maps directly; the figure is the formatted run length (alive), ban remaining (banned) or `null` (idle).
- `life` is `standing.alive?.lifeNumber ?? standing.lastLifeNumber` — **null means no link**.
- `provisional` is `alive && !alive.qualified`.
- `record` compares the run against `page.previousBestSeconds`.

Keep the ⚠️ comments on the timeline link (it reverses two earlier rules), on Spend being owner+banned only, and on the tally strip's `whitespace-nowrap`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/web test ticket-stage`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/player/ticket-stage.tsx apps/web/src/components/player/ticket-stage.test.tsx
git commit -m "feat(web): life-tickets stage serving both viewers"
```

---

### Task 10: The morgue

**Files:**
- Create: `apps/web/src/components/player/morgue.tsx`
- Modify: `packages/read-models/src/player-page.ts`, `apps/web/src/lib/types.ts`
- Test: `apps/web/src/components/player/morgue.test.tsx`, `packages/read-models/test/player-page.test.ts`

**Interfaces:**
- Consumes: `obituaryHref`, `dateline`, `rapSheetFacts` from `@/lib/obituary-format`; `lifeHrefBySlug` from `@/lib/life-href`.
- Produces: `<Morgue entries={ObituaryEntry[]} total={number} viewer={"owner" | "public"} state={"ready" | "loading" | "failed"} playerSlug={string} now={Date} />`, plus `PlayerPage.obituaries: ObituaryEntry[]` and `PlayerPage.obituariesTotal: number` where `ObituaryEntry = { slug: string; map: string; mapSlug: string; lifeNumber: number; headline: string; lede: string; deathAt: string; timeAliveSeconds: number; kills: number; longestKillMeters: number | null; cause: string | null }`.

The read-model change joins the player's ended lives to `articles` on the obituary key and returns **only rows with an article** — see spec §4. Follow the existing `obituarySlug` lookup in `packages/read-models/src/life-timeline.ts`, which already keys on `(server_id, gamertag, life_started_at)`; reuse that key, never `life_number`.

- [ ] **Step 1: Write the failing tests**

```typescript
// morgue.test.tsx
it("links each headline to its obituary and offers a timeline button", () => {
  render(<Morgue entries={TWO} total={2} viewer="owner" state="ready" playerSlug="manicdote" now={NOW} />);
  expect(screen.getByRole("link", { name: /undone in a treeline/i }))
    .toHaveAttribute("href", "/obituaries/manicdote-livonia-11");
  expect(screen.getAllByRole("link", { name: /timeline/i })).toHaveLength(2);
});

it("counts OBITUARIES, not lives", () => {
  render(<Morgue entries={TWO} total={2} viewer="owner" state="ready" playerSlug="manicdote" now={NOW} />);
  expect(screen.getByText(/obituaries filed/i)).toBeInTheDocument();
  expect(screen.queryByText(/lives filed/i)).not.toBeInTheDocument();
});

it("renders its own empty copy when nothing is filed — not a bare heading", () => {
  render(<Morgue entries={[]} total={0} viewer="owner" state="ready" playerSlug="manicdote" now={NOW} />);
  expect(screen.getByText(/no obituary has been filed for you yet/i)).toBeInTheDocument();
});

it("distinguishes loading and failed from empty", () => {
  const { rerender } = render(<Morgue entries={[]} total={0} viewer="owner" state="loading" playerSlug="m" now={NOW} />);
  expect(screen.queryByText(/no obituary has been filed/i)).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toBeInTheDocument();
  rerender(<Morgue entries={[]} total={0} viewer="owner" state="failed" playerSlug="m" now={NOW} />);
  expect(screen.queryByText(/no obituary has been filed/i)).not.toBeInTheDocument();
  expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument();
});

it("addresses the public viewer in the third person", () => {
  render(<Morgue entries={[]} total={0} viewer="public" state="ready" playerSlug="m" now={NOW} />);
  expect(screen.getByText(/this survivor/i)).toBeInTheDocument();
});
```

```typescript
// player-page.test.ts
it("returns only lives that HAVE a filed obituary", async () => {
  // fixture: three ended lives, one with an article row
  const page = await getPlayerPage(db, "Manicdote", NOW, { page: 1 });
  expect(page!.obituaries).toHaveLength(1);
  expect(page!.obituariesTotal).toBe(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @onelife/web test morgue && pnpm --filter @onelife/read-models test player-page`
Expected: FAIL — module not found; `obituaries` undefined.

- [ ] **Step 3: Write the implementation**

Transcribe `Morgue` from the preview and add the three non-ready states. The `state` prop is what keeps loading, failed and empty distinct — an `entries.length === 0` check alone cannot tell "nothing filed" from "the fetch died", and asserting "no obituary has been filed" over a failed fetch is a lie about the player's history.

In `player-page.ts`, add the article join and the two new fields; mirror the type into `apps/web/src/lib/types.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/web test morgue && pnpm --filter @onelife/read-models test player-page`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/player/morgue.tsx apps/web/src/components/player/morgue.test.tsx packages/read-models/src/player-page.ts packages/read-models/test/player-page.test.ts apps/web/src/lib/types.ts
git commit -m "feat(web): obituaries morgue replaces the past-lives grid"
```

---

### Task 11: Mount the new surface on the public dossier

**Files:**
- Modify: `apps/web/src/components/player/player-profile.tsx`
- Test: `apps/web/src/components/player/player-profile.test.tsx`

**Interfaces:**
- Consumes: `<TicketStage />` (Task 9), `<Morgue />` (Task 10).
- Produces: no new exports.

`PlayerProfile` renders `<TicketStage viewer="public">` then the existing totals strip and `FriendButton`, then `<Morgue viewer="public">`. Delete the `PastLifeCard` grid usage and the `PlayerHero`/`StandingCard` blocks the stage replaces. **Do not delete `PastLifeCard` itself in this task** — Task 13 does the sweep once nothing imports it.

- [ ] **Step 1: Write the failing test**

```typescript
it("leads with the ticket stage and ends with the morgue", () => {
  render(<PlayerProfile page={page} now={NOW} />);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Manicdote");
  expect(screen.getByText(/obituaries filed/i)).toBeInTheDocument();
});

it("shows no owner affordances to a stranger", () => {
  render(<PlayerProfile page={page} now={NOW} />);
  expect(screen.queryByRole("button", { name: /spend 1 token/i })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Your invite link")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /update your photo/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @onelife/web test player-profile`
Expected: FAIL — the h1 is still the old hero, no morgue.

- [ ] **Step 3: Write the implementation**

Rewrite `PlayerProfile`'s body as described. Keep the totals strip and `FriendButton`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @onelife/web test player-profile`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/player/player-profile.tsx apps/web/src/components/player/player-profile.test.tsx
git commit -m "feat(web): public dossier renders the ticket stage and morgue"
```

---

### Task 12: The verified home, and the `/players/{me}` redirect

**Files:**
- Modify: `apps/web/src/app/(site)/(boxed)/page.tsx`, `apps/web/src/app/(site)/(boxed)/players/[slug]/page.tsx`, `apps/web/src/components/account/account-panels.tsx`
- Create: `apps/web/src/lib/own-slug.ts`
- Test: `apps/web/src/app/(site)/(boxed)/players/[slug]/page.test.tsx`, `apps/web/src/components/account/three-modes.test.tsx`

**Interfaces:**
- Consumes: `<TicketStage />`, `<ControlsSlab />`, `<Morgue />`, `<ReferralClaim />`.
- Produces: `ownVerifiedSlug(): Promise<string | null>` from `@/lib/own-slug` — the signed-in viewer's own player slug, or null when signed out or unverified.

The verified branch of `AccountPanels` is replaced by the new surface; the unlinked and pending branches are untouched. Mount `<ReferralClaim />` on signed-in `/` and on `/welcome`.

- [ ] **Step 1: Write the failing test**

```typescript
// players/[slug]/page.test.tsx
it("307s the owner to / — temporary, because the decision depends on the session", async () => {
  mockOwnVerifiedSlug("manicdote");
  await expect(PlayerPageRoute({ params: p("manicdote"), searchParams: q() })).rejects.toMatchObject({
    digest: expect.stringContaining("307"),
  });
});

it("does NOT redirect a stranger's page", async () => {
  mockOwnVerifiedSlug("someone-else");
  const el = await PlayerPageRoute({ params: p("manicdote"), searchParams: q() });
  expect(el).toBeTruthy();
});

it("keeps the rename redirect permanent (308) — that one is not session-dependent", async () => {
  mockOwnVerifiedSlug(null);
  await expect(PlayerPageRoute({ params: p("old-name"), searchParams: q() })).rejects.toMatchObject({
    digest: expect.stringContaining("308"),
  });
});
```

```typescript
// three-modes.test.tsx — add to the verified case
it("gives a verified player the ticket stage and the controls slab", () => {
  renderVerified();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Manicdote");
  expect(screen.getByLabelText("Your invite link")).toBeInTheDocument();
});

it("still renders the morgue when the standing feed fails, and vice versa", () => {
  renderVerified({ standingFailed: true });
  expect(screen.getByText(/obituaries filed/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @onelife/web test "players/\[slug\]" && pnpm --filter @onelife/web test three-modes`
Expected: FAIL — no redirect, old panels.

- [ ] **Step 3: Write the implementation**

In `players/[slug]/page.tsx`, after the `notFound()` guard and **before** the rename `permanentRedirect`:

```typescript
  // ⚠️ 307, NEVER 308. Whether this URL redirects depends on WHO is asking, so a permanent
  // redirect would be cached by browsers and crawlers against a session-dependent decision and
  // would follow the user after sign-out. The rename redirect below is a different case: a
  // rename is permanent for everyone, so it stays 308.
  //
  // ⚠️ Cache-safe only because `getPlayerPage` awaits `cookies()` and sets `cache: "no-store"`,
  // which forces this route dynamic. Do not "optimize" either away.
  if (await ownVerifiedSlug() === playerSlug(page.gamertag)) redirect("/", RedirectType.replace);
```

Use `redirect` from `next/navigation` (307 by default), not `permanentRedirect`.

In `page.tsx` (home), replace the verified branch's `AccountPanels` with `<TicketStage viewer="owner">`, `<ControlsSlab />` and `<Morgue viewer="owner">`, each fed by its own `settleFeed` so they degrade independently. Add `<ReferralClaim />` to the signed-in branch and to `/welcome`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @onelife/web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app apps/web/src/components/account apps/web/src/lib/own-slug.ts
git commit -m "feat(web): verified home renders the ticket stage; /players/{me} 307s to /"
```

---

### Task 13: Sweep, changelog, and full verification

**Files:**
- Delete: `apps/web/src/app/(site)/(boxed)/design-preview/` (untracked — remove the directory)
- Delete: `apps/web/src/components/player/past-life-card.tsx` + test, `apps/web/src/components/account/owner-avatar.tsx` usage of the "Update photo ↓" disclosure
- Modify: `CHANGELOG.md`

**Interfaces:** none.

- [ ] **Step 1: Confirm nothing imports what you are deleting**

```bash
rg -n "past-life-card|PastLifeCard|OwnerAvatar" apps packages --glob '!*.test.*'
```

Expected: no hits outside the files being deleted. ⚠️ Delete the untracked `design-preview/` directory FIRST — untracked files still break `tsc`, and it imports components this task removes.

- [ ] **Step 2: Delete and retire**

Remove `PastLifeCard` and its test. Retire the dossier's `OwnerAvatar` "Update photo ↓" disclosure — the stage pencil is now the single edit path (spec §2).

- [ ] **Step 3: Write the changelog entry**

Add under `## [Unreleased]` in `CHANGELOG.md`:

```markdown
### Added
- Verified home is now a life-tickets stage: the gamertag as the headline, one ticket per server with its own timeline link, and the token and invite controls on the page. The same surface serves `/players/{slug}`; `/players/{me}` redirects home.
- Obituaries replace the past-lives grid on both the home page and the public dossier — each headline links to the full obituary, with a timeline button beside it.
- Invite links (`/i/{slug}`) with a share bar for Discord, X, Reddit, WhatsApp and email.

### Changed
- A referral now pays the referrer **once** per verified player they bring in, instead of once per month forever. ⚠️ The idempotency key changed, so the first sweep after this release grants one extra token to every existing referrer — a one-off, deliberately not backfilled.
```

- [ ] **Step 4: Full verification**

```bash
pnpm turbo run typecheck
pnpm turbo run test --concurrency=1
```

Expected: both green. Then verify the layout claims RTL cannot prove — the `lg` split, the 390px share row, the 320px floor — with CDP `Emulation.setDeviceMetricsOverride` against `pnpm dev`. **`resize_window` and `--window-size` do not work here**; `innerWidth` stayed 1504 through every attempt during the design.

- [ ] **Step 5: Commit**

```bash
git add -A CHANGELOG.md apps packages
git commit -m "chore: retire the past-lives grid and the duplicate avatar edit path"
```

---

## Self-review

**Spec coverage.** §2 stage → Task 9. §2.1 ticket affordances → Task 9. §3 controls slab → Tasks 7–8. §4 morgue → Task 10. §5.1–5.3 referral capture → Tasks 1, 4, 5, 6. §5.4 share bar → Task 7. §5.5 one-time payout → Task 2. §5.6 join count → Task 3. §6 rendering model and the 307 → Tasks 11–12. §7 test plan → the test steps throughout, with independent degradation in Task 12. §8 deploy → no migration, so nothing to do beyond the changelog note in Task 13.

**Type consistency.** `claimReferrer` returns `"claimed" | "noop"` (Task 1) and Task 4 branches on `=== "claimed"`. `countVerifiedReferees` (Task 3) is consumed by `GET /me/referrals`, read by Task 8. `REFERRAL_COOKIE` is defined in Task 5 and consumed in Task 6. `ObituaryEntry` is defined in Task 10 and consumed there only. `ownVerifiedSlug()` is defined and consumed in Task 12.

**Known soft spots for the implementer.** Task 4's and Task 6's test harnesses are sketched against the repo's existing patterns rather than transcribed — copy the surrounding files' setup rather than inventing one. Task 10's article join must reuse the `(server_id, gamertag, life_started_at)` key from `life-timeline.ts`; using `life_number` will break across renames.
