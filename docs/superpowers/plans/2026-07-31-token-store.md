# Token Store (Stripe Checkout) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let verified players buy unban tokens with real money via Stripe Checkout, fulfilled as idempotent rows in the existing `token_transactions` ledger.

**Architecture:** A new `fulfillPurchase` in `packages/tokens` inserts N `+1, kind: 'purchase'` ledger rows keyed `stripe:{sessionId}:{i}` — the ledger's UNIQUE idempotency key is the exactly-once mechanism, so the two fulfillment paths (Stripe webhook, return-trip confirm) can race harmlessly. The Stripe SDK lives only in `apps/api`, behind a `StripeGateway` interface so tests use a fake. Web adds buy buttons at two entry points and a checkout-return island.

**Tech Stack:** TS/ESM monorepo (pnpm + turbo), Drizzle/Postgres, Fastify, Next.js App Router, vitest (+ RTL on web), `stripe` npm SDK.

**Spec:** `docs/superpowers/specs/2026-07-31-token-store-design.md` — read it first.

## Global Constraints

- Purchases are uncapped; a single Checkout session's quantity is 1–20 (Stripe `adjustable_quantity`).
- Eligibility: buyer must hold a `verified` `gamertag_links` row at **checkout** time. Fulfillment never re-checks (money was taken).
- `kind` on `token_transactions` is plain `text` — adding `'purchase'` needs **no migration**.
- Purchases generate **no notification**. The notifier's `tokensGenerator` selects kinds with `inArray(kind, [monthly, referral, verification, transfer_in])`, so `'purchase'` is already ignored — do not touch the notifier.
- Unset-means-OFF: with Stripe env unset the API's checkout/confirm routes return 503 `store_unavailable`, the webhook route is not registered, and the web hides all buy UI (gated on `NEXT_PUBLIC_TOKEN_PRICE_LABEL`).
- Loading, failed, empty and zero are four different renders. A slow/failed confirm renders "payment processing", never an error and never a fabricated balance.
- Tests: `pnpm turbo run test --concurrency=1`; DB suites need `TEST_DATABASE_URL` exported. Run scoped suites during tasks with `pnpm --filter <pkg> test -- <file>`.
- Commit per task on branch `feature/token-store`. Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- CHANGELOG.md entry is written **last**, in the final task, before the PR.

---

### Task 1: `fulfillPurchase` in packages/tokens

**Files:**
- Create: `packages/tokens/src/purchase.ts`
- Modify: `packages/tokens/src/index.ts`
- Test: `packages/tokens/test/purchase.test.ts`

**Interfaces:**
- Consumes: `grant(db, {userId, kind, idempotencyKey})` from `packages/tokens/src/grant.ts` (returns `true` iff a new row was written); `TokenError` from `./internal.js`.
- Produces: `fulfillPurchase(db: Database, a: { userId: string; sessionId: string; quantity: number }): Promise<number>` — returns the count of **newly written** rows (0 on a full replay). Throws `TokenError("bad_quantity")` for non-integer / <1 / >100. Exported from `@onelife/tokens`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/tokens/test/purchase.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { fulfillPurchase } from "../src/purchase.js";
import { getBalance } from "../src/balance.js";

const { db, sql } = getTestDb();

beforeAll(async () => {
  await db.insert(user).values([
    { id: "pu1", name: "PU1", email: "pu1@x.com" },
    { id: "pu2", name: "PU2", email: "pu2@x.com" },
  ]);
});
afterAll(async () => { await sql.end(); });

describe("fulfillPurchase", () => {
  it("grants quantity tokens for a paid session", async () => {
    const granted = await fulfillPurchase(db, { userId: "pu1", sessionId: "cs_a", quantity: 3 });
    expect(granted).toBe(3);
    expect(await getBalance(db, "pu1")).toBe(3);
  });
  it("is idempotent — refulfilling the same session grants nothing", async () => {
    const granted = await fulfillPurchase(db, { userId: "pu1", sessionId: "cs_a", quantity: 3 });
    expect(granted).toBe(0);
    expect(await getBalance(db, "pu1")).toBe(3);
  });
  it("distinct sessions accumulate", async () => {
    await fulfillPurchase(db, { userId: "pu2", sessionId: "cs_b", quantity: 1 });
    await fulfillPurchase(db, { userId: "pu2", sessionId: "cs_c", quantity: 2 });
    expect(await getBalance(db, "pu2")).toBe(3);
  });
  it("rejects a bad quantity", async () => {
    await expect(fulfillPurchase(db, { userId: "pu1", sessionId: "cs_d", quantity: 0 })).rejects.toThrow(/bad_quantity/);
    await expect(fulfillPurchase(db, { userId: "pu1", sessionId: "cs_d", quantity: 2.5 })).rejects.toThrow(/bad_quantity/);
    await expect(fulfillPurchase(db, { userId: "pu1", sessionId: "cs_d", quantity: 101 })).rejects.toThrow(/bad_quantity/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/tokens && TEST_DATABASE_URL=<url> pnpm test -- purchase`
Expected: FAIL — cannot resolve `../src/purchase.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/tokens/src/purchase.ts
import type { Database } from "@onelife/db";
import { grant } from "./grant.js";
import { TokenError } from "./internal.js";

/**
 * Idempotently grant `quantity` purchased tokens for a paid Stripe Checkout session.
 * Keys are `stripe:{sessionId}:{i}` — a webhook retry, a webhook/confirm race, or a full
 * replay re-inserts nothing (grant() is conflict-ignoring on the idempotency key).
 * Returns the number of NEW rows written (0 on a full replay).
 *
 * The 100 ceiling is a sanity bound, not policy — Checkout's adjustable_quantity caps a
 * session at 20; anything above 100 here means corrupted input, not a big purchase.
 */
export async function fulfillPurchase(
  db: Database,
  a: { userId: string; sessionId: string; quantity: number },
): Promise<number> {
  if (!Number.isInteger(a.quantity) || a.quantity < 1 || a.quantity > 100) {
    throw new TokenError("bad_quantity");
  }
  let granted = 0;
  for (let i = 1; i <= a.quantity; i++) {
    const fresh = await grant(db, {
      userId: a.userId,
      kind: "purchase",
      idempotencyKey: `stripe:${a.sessionId}:${i}`,
    });
    if (fresh) granted++;
  }
  return granted;
}
```

Add to `packages/tokens/src/index.ts`:

```ts
export { fulfillPurchase } from "./purchase.js";
```

Also update the `kind` comment in `packages/db/src/schema.ts` on the `tokenTransactions.kind` column from `// verification|monthly|referral|redeem|transfer_in|transfer_out` to `// verification|monthly|referral|redeem|transfer_in|transfer_out|purchase` (comment only — no schema change).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/tokens && TEST_DATABASE_URL=<url> pnpm test -- purchase`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/tokens/src/purchase.ts packages/tokens/src/index.ts packages/tokens/test/purchase.test.ts packages/db/src/schema.ts
git commit -m "feat(tokens): idempotent fulfillPurchase for Stripe checkout sessions"
```

---

### Task 2: API config + Stripe gateway

**Files:**
- Modify: `apps/api/src/config.ts`
- Create: `apps/api/src/lib/stripe-gateway.ts`
- Modify: `apps/api/package.json` (add `"stripe": "^18.0.0"` to dependencies; run `pnpm install`)
- Test: `apps/api/test/config.test.ts` (extend), `apps/api/test/stripe-gateway.test.ts`

**Interfaces:**
- Produces (consumed by Task 3):

```ts
// config: Config gains
stripe: { secretKey: string; webhookSecret: string; priceId: string } | null;

// stripe-gateway.ts
export type SessionState = { paid: boolean; clientReferenceId: string | null; quantity: number };
export interface StripeGateway {
  /** Create a Checkout Session; returns the hosted-page URL to redirect the buyer to. */
  createCheckout(a: { userId: string; siteOrigin: string }): Promise<{ url: string }>;
  /** null when Stripe doesn't know the id (bogus/expired). */
  retrieveSession(sessionId: string): Promise<SessionState | null>;
  /** Signature-verifies a webhook payload. Returns the checkout session id for a
   *  checkout.session.completed event, null for any other valid event. THROWS on bad signature. */
  webhookSessionId(rawBody: Buffer, signature: string): string | null;
}
export function createStripeGateway(cfg: { secretKey: string; webhookSecret: string; priceId: string }): StripeGateway;
```

- [ ] **Step 1: Extend the config test (failing)**

Append to `apps/api/test/config.test.ts` (follow the file's existing style — it builds a base env object and asserts on `loadConfig`; reuse its base env):

```ts
describe("stripe config", () => {
  it("is null when unset", () => {
    expect(loadConfig(baseEnv).stripe).toBeNull();
  });
  it("is null when only partially set", () => {
    expect(loadConfig({ ...baseEnv, STRIPE_SECRET_KEY: "sk_test_x" }).stripe).toBeNull();
  });
  it("is populated when all three are set", () => {
    const cfg = loadConfig({
      ...baseEnv,
      STRIPE_SECRET_KEY: "sk_test_x",
      STRIPE_WEBHOOK_SECRET: "whsec_x",
      STRIPE_TOKEN_PRICE_ID: "price_x",
    });
    expect(cfg.stripe).toEqual({ secretKey: "sk_test_x", webhookSecret: "whsec_x", priceId: "price_x" });
  });
});
```

(If the existing test file names its base env differently, adapt the name — do not restructure the file.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && TEST_DATABASE_URL=<url> pnpm test -- config`
Expected: FAIL — `stripe` is `undefined`, not `null`.

- [ ] **Step 3: Implement config**

In `apps/api/src/config.ts`, add to the zod schema (all optional — unset-means-OFF):

```ts
  // Token store (Stripe). All-or-nothing: the store is ON only when all three are set;
  // a partial set is treated as OFF and warned about in main.ts. Unset-means-OFF, per
  // the workers' convention — there is no default key and no test fallback.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_TOKEN_PRICE_ID: z.string().optional(),
```

Add `stripe: { secretKey: string; webhookSecret: string; priceId: string } | null;` to the `Config` type, and in `loadConfig`'s return:

```ts
    stripe:
      p.STRIPE_SECRET_KEY && p.STRIPE_WEBHOOK_SECRET && p.STRIPE_TOKEN_PRICE_ID
        ? { secretKey: p.STRIPE_SECRET_KEY, webhookSecret: p.STRIPE_WEBHOOK_SECRET, priceId: p.STRIPE_TOKEN_PRICE_ID }
        : null,
```

- [ ] **Step 4: Write the gateway test (failing)**

The real gateway's `createCheckout`/`retrieveSession` are thin SDK passthroughs exercised only against Stripe test mode (browser-only checklist); what IS unit-testable is webhook signature handling, using the SDK's own test-header helper:

```ts
// apps/api/test/stripe-gateway.test.ts
import { describe, it, expect } from "vitest";
import Stripe from "stripe";
import { createStripeGateway } from "../src/lib/stripe-gateway.js";

const SECRET = "whsec_testsecret";
const gw = createStripeGateway({ secretKey: "sk_test_dummy", webhookSecret: SECRET, priceId: "price_x" });
const stripe = new Stripe("sk_test_dummy");

function signedPayload(payload: string, secret = SECRET): string {
  return stripe.webhooks.generateTestHeaderString({ payload, secret });
}

describe("stripe gateway webhook verification", () => {
  it("returns the session id for a signed checkout.session.completed", () => {
    const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_test_123" } } });
    expect(gw.webhookSessionId(Buffer.from(payload), signedPayload(payload))).toBe("cs_test_123");
  });
  it("returns null for other event types", () => {
    const payload = JSON.stringify({ id: "evt_2", type: "payment_intent.succeeded", data: { object: { id: "pi_1" } } });
    expect(gw.webhookSessionId(Buffer.from(payload), signedPayload(payload))).toBeNull();
  });
  it("throws on a bad signature", () => {
    const payload = JSON.stringify({ id: "evt_3", type: "checkout.session.completed", data: { object: { id: "cs_x" } } });
    expect(() => gw.webhookSessionId(Buffer.from(payload), signedPayload(payload, "whsec_wrong"))).toThrow();
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `cd apps/api && pnpm test -- stripe-gateway`
Expected: FAIL — module not found (and `stripe` not installed until this step's install).

- [ ] **Step 6: Add the dependency and implement the gateway**

```bash
pnpm --filter @onelife/api add stripe@^18.0.0
```

```ts
// apps/api/src/lib/stripe-gateway.ts
import Stripe from "stripe";

export type SessionState = { paid: boolean; clientReferenceId: string | null; quantity: number };

export interface StripeGateway {
  createCheckout(a: { userId: string; siteOrigin: string }): Promise<{ url: string }>;
  retrieveSession(sessionId: string): Promise<SessionState | null>;
  webhookSessionId(rawBody: Buffer, signature: string): string | null;
}

/**
 * The one place the Stripe SDK is touched. Routes and tests speak StripeGateway;
 * tests substitute a fake. Quantity is buyer-chosen ON the hosted page
 * (adjustable_quantity 1–20) — the API never takes a quantity input.
 */
export function createStripeGateway(cfg: { secretKey: string; webhookSecret: string; priceId: string }): StripeGateway {
  const stripe = new Stripe(cfg.secretKey);
  return {
    async createCheckout(a) {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [
          { price: cfg.priceId, quantity: 1, adjustable_quantity: { enabled: true, minimum: 1, maximum: 20 } },
        ],
        client_reference_id: a.userId,
        // {CHECKOUT_SESSION_ID} is a literal Stripe template token, substituted by Stripe.
        success_url: `${a.siteOrigin}/?checkout={CHECKOUT_SESSION_ID}`,
        cancel_url: `${a.siteOrigin}/`,
      });
      if (!session.url) throw new Error("stripe returned a session without a url");
      return { url: session.url };
    },
    async retrieveSession(sessionId) {
      let s: Stripe.Checkout.Session;
      try {
        s = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["line_items"] });
      } catch {
        return null; // bogus/expired id — Stripe throws resource_missing
      }
      return {
        paid: s.payment_status === "paid",
        clientReferenceId: s.client_reference_id,
        quantity: s.line_items?.data[0]?.quantity ?? 1,
      };
    },
    webhookSessionId(rawBody, signature) {
      const event = stripe.webhooks.constructEvent(rawBody, signature, cfg.webhookSecret); // throws on bad sig
      if (event.type !== "checkout.session.completed") return null;
      return (event.data.object as Stripe.Checkout.Session).id;
    },
  };
}
```

- [ ] **Step 7: Run both suites to verify they pass**

Run: `cd apps/api && TEST_DATABASE_URL=<url> pnpm test -- config stripe-gateway`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/config.ts apps/api/src/lib/stripe-gateway.ts apps/api/package.json pnpm-lock.yaml apps/api/test/config.test.ts apps/api/test/stripe-gateway.test.ts
git commit -m "feat(api): stripe config (unset-means-OFF) and gateway seam"
```

---

### Task 3: Store routes + wiring

**Files:**
- Create: `apps/api/src/routes/store.ts`
- Modify: `apps/api/src/app.ts` (AuthOptions + registration), `apps/api/src/main.ts` (construct gateway, warn on partial env)
- Test: `apps/api/test/store-routes.test.ts`

**Interfaces:**
- Consumes: `fulfillPurchase` and `getBalance` from `@onelife/tokens`; `verifiedOf` — NOT exported from the tokens index; use the exported `isVerifiedUser` from `@onelife/tokens` (`packages/tokens/src/verified.ts`) instead; `StripeGateway` type from `../lib/stripe-gateway.js`; `getSession` from `../auth-plugin.js`.
- Produces routes:
  - `POST /me/tokens/checkout` → 503 `{error:"store_unavailable"}` | 401 | 403 `{error:"not_verified"}` | 200 `{url}`
  - `POST /me/tokens/checkout/confirm` body `{sessionId}` → 503 | 401 | 403 `{error:"not_owner"}` | 200 `{granted, paid, balance}`
  - `POST /stripe/webhook` (only registered when a gateway exists) → 400 `{error:"bad_signature"}` | 200 `{received:true}`

- [ ] **Step 1: Write the failing route tests**

Follow the magic-link sign-in pattern from `apps/api/test/tokens-routes.test.ts` verbatim (captureMailer, `signIn()`, `cookieHeader`). Two users: one with a `verified` gamertag link, one with none.

```ts
// apps/api/test/store-routes.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, gamertagLinks } from "@onelife/db";
import { eq } from "drizzle-orm";
import { createAuth, type Mailer } from "@onelife/auth";
import { buildApp } from "../src/app.js";
import { getTestDb } from "@onelife/test-support";
import { getBalance } from "@onelife/tokens";
import type { StripeGateway, SessionState } from "../src/lib/stripe-gateway.js";

const { db, sql } = getTestDb();
const run = Math.floor(Math.random() * 1e8);
const email = `store${run}@example.com`;

// ── Fake gateway: an in-memory session book. ──
const sessions = new Map<string, SessionState>();
const fake: StripeGateway = {
  async createCheckout({ userId }) {
    const id = `cs_${sessions.size + 1}_${run}`;
    sessions.set(id, { paid: false, clientReferenceId: userId, quantity: 1 });
    return { url: `https://checkout.stripe.test/${id}` };
  },
  async retrieveSession(id) { return sessions.get(id) ?? null; },
  webhookSessionId(rawBody, signature) {
    if (signature !== "good") throw new Error("bad signature");
    const parsed = JSON.parse(rawBody.toString());
    return parsed.type === "checkout.session.completed" ? parsed.sessionId : null;
  },
};

let lastLink = "";
const captureMailer: Mailer = { async send(msg) { lastLink = msg.url; } };
const auth = createAuth(db, {
  secret: "s".repeat(32), baseURL: "http://localhost", trustedOrigins: ["http://localhost"],
  providers: {}, mailer: captureMailer,
});
const app = buildApp(db, { auth, corsOrigins: ["http://localhost"], stripe: fake });
const bare = buildApp(db, { auth, corsOrigins: ["http://localhost"] }); // no gateway

function cookieHeader(setCookie: string | string[] | undefined): string {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr.map((c) => c.split(";")[0]).join("; ");
}
let cookie = "";
let userId = "";

beforeAll(async () => {
  await app.ready();
  await bare.ready();
  await app.inject({
    method: "POST", url: "/api/auth/sign-in/magic-link",
    headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost" },
    payload: { email },
  });
  const verifyPath = lastLink.replace(/^https?:\/\/[^/]+/, "");
  const verify = await app.inject({ method: "GET", url: verifyPath, headers: { host: "localhost" } });
  cookie = cookieHeader(verify.headers["set-cookie"] as string | string[] | undefined);
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  userId = u!.id;
});
afterAll(async () => { await sql.end(); });

const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url, payload, headers: { "content-type": "application/json", cookie, ...headers } });

describe("POST /me/tokens/checkout", () => {
  it("401 when signed out", async () => {
    const r = await app.inject({ method: "POST", url: "/me/tokens/checkout", payload: {} });
    expect(r.statusCode).toBe(401);
  });
  it("403 not_verified before the gamertag link is verified", async () => {
    const r = await post("/me/tokens/checkout", {});
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ error: "not_verified" });
  });
  it("returns the hosted-checkout url for a verified user", async () => {
    await db.insert(gamertagLinks).values({ userId, gamertag: `StoreGT${run}`, status: "verified" });
    const r = await post("/me/tokens/checkout", {});
    expect(r.statusCode).toBe(200);
    expect(r.json().url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
  });
  it("503 when the store is not configured", async () => {
    const r = await bare.inject({
      method: "POST", url: "/me/tokens/checkout", payload: {},
      headers: { "content-type": "application/json", cookie },
    });
    expect(r.statusCode).toBe(503);
  });
});

describe("POST /me/tokens/checkout/confirm", () => {
  it("unknown session → granted 0, paid false, no error", async () => {
    const r = await post("/me/tokens/checkout/confirm", { sessionId: "cs_nope" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ granted: 0, paid: false });
  });
  it("unpaid session → granted 0, paid false", async () => {
    const create = await post("/me/tokens/checkout", {});
    const id = create.json().url.split("/").pop()!;
    const r = await post("/me/tokens/checkout/confirm", { sessionId: id });
    expect(r.json()).toMatchObject({ granted: 0, paid: false });
    expect(await getBalance(db, userId)).toBe(0);
  });
  it("paid session → grants quantity and returns the new balance", async () => {
    const create = await post("/me/tokens/checkout", {});
    const id = create.json().url.split("/").pop()!;
    sessions.set(id, { paid: true, clientReferenceId: userId, quantity: 2 });
    const r = await post("/me/tokens/checkout/confirm", { sessionId: id });
    expect(r.json()).toMatchObject({ granted: 2, paid: true, balance: 2 });
    // replay: webhook already-fulfilled shape — granted 0, balance unchanged
    const again = await post("/me/tokens/checkout/confirm", { sessionId: id });
    expect(again.json()).toMatchObject({ granted: 0, paid: true, balance: 2 });
  });
  it("403 when the session belongs to someone else", async () => {
    sessions.set("cs_other", { paid: true, clientReferenceId: "someone-else", quantity: 1 });
    const r = await post("/me/tokens/checkout/confirm", { sessionId: "cs_other" });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ error: "not_owner" });
  });
});

describe("POST /stripe/webhook", () => {
  it("400 on a bad signature, no grant", async () => {
    const r = await app.inject({
      method: "POST", url: "/stripe/webhook",
      payload: JSON.stringify({ type: "checkout.session.completed", sessionId: "cs_x" }),
      headers: { "content-type": "application/json", "stripe-signature": "evil" },
    });
    expect(r.statusCode).toBe(400);
  });
  it("fulfills a paid session exactly once across webhook retries", async () => {
    sessions.set("cs_hook", { paid: true, clientReferenceId: userId, quantity: 1 });
    const payload = JSON.stringify({ type: "checkout.session.completed", sessionId: "cs_hook" });
    const before = await getBalance(db, userId);
    for (let i = 0; i < 2; i++) {
      const r = await app.inject({
        method: "POST", url: "/stripe/webhook", payload,
        headers: { "content-type": "application/json", "stripe-signature": "good" },
      });
      expect(r.statusCode).toBe(200);
    }
    expect(await getBalance(db, userId)).toBe(before + 1);
  });
  it("ignores non-checkout events", async () => {
    const r = await app.inject({
      method: "POST", url: "/stripe/webhook",
      payload: JSON.stringify({ type: "payment_intent.succeeded" }),
      headers: { "content-type": "application/json", "stripe-signature": "good" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ received: true });
  });
  it("is absent when the store is not configured", async () => {
    const r = await bare.inject({ method: "POST", url: "/stripe/webhook", payload: "{}", headers: { "content-type": "application/json" } });
    expect(r.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && TEST_DATABASE_URL=<url> pnpm test -- store-routes`
Expected: FAIL — `stripe` is not a known AuthOptions property / routes 404.

- [ ] **Step 3: Implement the routes**

```ts
// apps/api/src/routes/store.ts
import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import type { Auth } from "@onelife/auth";
import { z } from "zod";
import { fulfillPurchase, getBalance, isVerifiedUser } from "@onelife/tokens";
import { getSession } from "../auth-plugin.js";
import type { StripeGateway } from "../lib/stripe-gateway.js";

const confirmBody = z.object({ sessionId: z.string().min(1) });

/**
 * Token store. Eligibility (verified link) is a CHECKOUT-TIME gate only — fulfillment never
 * re-checks, because by then Stripe has taken the money and the tokens are userId-scoped
 * anyway (spec: edge cases). With no gateway the buy routes 503 and the webhook is not
 * registered at all — unset-means-OFF.
 */
export function registerStoreRoutes(
  app: FastifyInstance,
  db: Database,
  auth: Auth,
  gateway: StripeGateway | undefined,
  siteOrigin: string,
): void {
  app.post("/me/tokens/checkout", async (req, reply) => {
    if (!gateway) return reply.code(503).send({ error: "store_unavailable" });
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    if (!(await isVerifiedUser(db, session.user.id))) return reply.code(403).send({ error: "not_verified" });
    const { url } = await gateway.createCheckout({ userId: session.user.id, siteOrigin });
    return { url };
  });

  app.post("/me/tokens/checkout/confirm", async (req, reply) => {
    if (!gateway) return reply.code(503).send({ error: "store_unavailable" });
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const body = confirmBody.parse(req.body);
    const s = await gateway.retrieveSession(body.sessionId);
    // Unknown/expired and unpaid both come back as a calm non-answer, not an error — the
    // web renders "processing" and the webhook remains the backstop (spec: edge cases).
    if (!s) return { granted: 0, paid: false, balance: await getBalance(db, session.user.id) };
    if (s.clientReferenceId !== session.user.id) return reply.code(403).send({ error: "not_owner" });
    if (!s.paid) return { granted: 0, paid: false, balance: await getBalance(db, session.user.id) };
    const granted = await fulfillPurchase(db, { userId: session.user.id, sessionId: body.sessionId, quantity: s.quantity });
    return { granted, paid: true, balance: await getBalance(db, session.user.id) };
  });

  if (!gateway) return;
  // Scoped register: the webhook needs the RAW body for signature verification, and only
  // this route may see a Buffer — the parser override is encapsulated by the plugin scope.
  app.register(async (scope) => {
    scope.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
    scope.post("/stripe/webhook", async (req, reply) => {
      const signature = req.headers["stripe-signature"];
      if (typeof signature !== "string") return reply.code(400).send({ error: "bad_signature" });
      let sessionId: string | null;
      try {
        sessionId = gateway.webhookSessionId(req.body as Buffer, signature);
      } catch {
        return reply.code(400).send({ error: "bad_signature" });
      }
      if (sessionId) {
        const s = await gateway.retrieveSession(sessionId);
        if (s?.paid && s.clientReferenceId) {
          await fulfillPurchase(db, { userId: s.clientReferenceId, sessionId, quantity: s.quantity });
        }
      }
      return { received: true };
    });
  });
}
```

In `apps/api/src/app.ts`: add to `AuthOptions`:

```ts
  stripe?: StripeGateway;
```

with `import type { StripeGateway } from "./lib/stripe-gateway.js";`, and inside the `if (opts)` block after `registerTokenRoutes`:

```ts
    registerStoreRoutes(app, db, opts.auth, opts.stripe, opts.corsOrigins[0] ?? "http://localhost:3000");
```

(`corsOrigins[0]` is the site origin — AUTH_TRUSTED_ORIGINS already leads with the web origin in every environment.)

In `apps/api/src/main.ts`, before `buildApp`:

```ts
const stripeEnvCount = [process.env.STRIPE_SECRET_KEY, process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_TOKEN_PRICE_ID].filter(Boolean).length;
if (cfg.stripe === null && stripeEnvCount > 0) {
  log.warn("Stripe env is partially set — the token store is OFF (needs STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_TOKEN_PRICE_ID)");
}
const stripe = cfg.stripe ? createStripeGateway(cfg.stripe) : undefined;
```

and pass `stripe` in the `buildApp` options object. Import `createStripeGateway` from `./lib/stripe-gateway.js`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && TEST_DATABASE_URL=<url> pnpm test -- store-routes`
Expected: PASS. Also run `pnpm --filter @onelife/api run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/store.ts apps/api/src/app.ts apps/api/src/main.ts apps/api/test/store-routes.test.ts
git commit -m "feat(api): token store checkout, confirm and stripe webhook routes"
```

---

### Task 4: Web — buy button, checkout return, controls slab

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/components/account/buy-tokens.tsx`
- Create: `apps/web/src/components/account/checkout-return.tsx`
- Modify: `apps/web/src/components/account/controls-slab.tsx`
- Test: `apps/web/src/components/account/buy-tokens.test.tsx`, `apps/web/src/components/account/checkout-return.test.tsx`

**Interfaces:**
- Consumes: routes from Task 3 via two new `api.ts` fetchers.
- Produces:

```ts
// api.ts
export const createCheckout = () => apiSend<{ url: string }>("POST", "/api/me/tokens/checkout", {});
export const confirmCheckout = (sessionId: string) =>
  apiSend<{ granted: number; paid: boolean; balance: number }>("POST", "/api/me/tokens/checkout/confirm", { sessionId });

// buy-tokens.tsx
export function tokenPriceLabel(): string; // reads process.env.NEXT_PUBLIC_TOKEN_PRICE_LABEL at call time (testable), "" when unset
export function BuyTokensButton(props: { className?: string }): JSX.Element | null; // null when label unset

// checkout-return.tsx
export function CheckoutReturn(): JSX.Element | null; // must be mounted inside <Suspense> (useSearchParams)
```

- [ ] **Step 1: Write the failing BuyTokensButton test**

Follow the mocking idiom of `self-unban-button.test.tsx` (vi.mock of `@/lib/api`, RTL render). The env var is read **at render time** via `tokenPriceLabel()` so `vi.stubEnv` works.

```tsx
// apps/web/src/components/account/buy-tokens.test.tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BuyTokensButton } from "./buy-tokens";

const createCheckout = vi.fn();
vi.mock("@/lib/api", () => ({ createCheckout: (...a: unknown[]) => createCheckout(...a) }));

afterEach(() => { vi.unstubAllEnvs(); createCheckout.mockReset(); });

describe("BuyTokensButton", () => {
  it("renders nothing when the price label is unset (store OFF)", () => {
    const { container } = render(<BuyTokensButton />);
    expect(container).toBeEmptyDOMElement();
  });
  it("shows the price and redirects to the hosted checkout", async () => {
    vi.stubEnv("NEXT_PUBLIC_TOKEN_PRICE_LABEL", "$3");
    createCheckout.mockResolvedValue({ url: "https://checkout.stripe.test/cs_1" });
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign }, writable: true });
    render(<BuyTokensButton />);
    const btn = screen.getByRole("button", { name: /buy tokens — \$3 each/i });
    await userEvent.click(btn);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/cs_1"));
  });
  it("re-enables and keeps its label when checkout creation fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_TOKEN_PRICE_LABEL", "$3");
    createCheckout.mockRejectedValue(new Error("503"));
    render(<BuyTokensButton />);
    await userEvent.click(screen.getByRole("button", { name: /buy tokens/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /buy tokens/i })).toBeEnabled());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && pnpm test -- buy-tokens`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement BuyTokensButton**

```tsx
// apps/web/src/components/account/buy-tokens.tsx
"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { createCheckout } from "@/lib/api";

/** Read at call time (not module scope) so tests can stub the env; Next inlines it either way. */
export function tokenPriceLabel(): string {
  return process.env.NEXT_PUBLIC_TOKEN_PRICE_LABEL ?? "";
}

/**
 * Starts a Stripe Checkout for unban tokens. Renders NOTHING when the price label is unset —
 * the label doubles as the store's web-side ON switch (unset-means-OFF, matching the API's
 * 503 when its Stripe env is unset). Quantity is chosen on Stripe's hosted page.
 */
export function BuyTokensButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const label = tokenPriceLabel();
  if (!label) return null;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { url } = await createCheckout();
          window.location.assign(url);
        } catch {
          setBusy(false); // API 503/network — the button simply re-arms; nothing was charged
        }
      }}
      className={cn(
        "min-h-[44px] border-2 border-ink bg-paper px-5 font-display text-sm font-bold uppercase tracking-[.08em] text-ink hover:bg-ink hover:text-paper disabled:opacity-40",
        className,
      )}
    >
      {busy ? "Opening checkout…" : `Buy tokens — ${label} each`}
    </button>
  );
}
```

Add the two fetchers to `apps/web/src/lib/api.ts` next to the existing token fetchers (exact code in the Interfaces block above).

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && pnpm test -- buy-tokens`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing CheckoutReturn test**

```tsx
// apps/web/src/components/account/checkout-return.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CheckoutReturn } from "./checkout-return";

const confirmCheckout = vi.fn();
vi.mock("@/lib/api", () => ({ confirmCheckout: (...a: unknown[]) => confirmCheckout(...a) }));

const replace = vi.fn();
let params = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => params,
  useRouter: () => ({ replace }),
  usePathname: () => "/",
}));

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CheckoutReturn />
    </QueryClientProvider>,
  );
}

beforeEach(() => { confirmCheckout.mockReset(); replace.mockReset(); });

describe("CheckoutReturn", () => {
  it("renders nothing without a checkout param", () => {
    params = new URLSearchParams();
    const { container } = mount();
    expect(container).toBeEmptyDOMElement();
    expect(confirmCheckout).not.toHaveBeenCalled();
  });
  it("confirms, announces the grant, and strips the param", async () => {
    params = new URLSearchParams("checkout=cs_1");
    confirmCheckout.mockResolvedValue({ granted: 2, paid: true, balance: 5 });
    mount();
    expect(await screen.findByText(/2 tokens added/i)).toBeInTheDocument();
    expect(confirmCheckout).toHaveBeenCalledWith("cs_1");
    expect(replace).toHaveBeenCalledWith("/", { scroll: false });
  });
  it("a paid replay (granted 0) still reads as settled, not as an error", async () => {
    params = new URLSearchParams("checkout=cs_1");
    confirmCheckout.mockResolvedValue({ granted: 0, paid: true, balance: 5 });
    mount();
    expect(await screen.findByText(/tokens already added/i)).toBeInTheDocument();
  });
  it("an unpaid/unknown session renders processing — never an error, never a zero", async () => {
    params = new URLSearchParams("checkout=cs_1");
    confirmCheckout.mockResolvedValue({ granted: 0, paid: false, balance: 3 });
    mount();
    expect(await screen.findByText(/payment processing/i)).toBeInTheDocument();
  });
  it("a failed confirm call renders processing too — the webhook is the backstop", async () => {
    params = new URLSearchParams("checkout=cs_1");
    confirmCheckout.mockRejectedValue(new Error("network"));
    mount();
    expect(await screen.findByText(/payment processing/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd apps/web && pnpm test -- checkout-return`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement CheckoutReturn**

```tsx
// apps/web/src/components/account/checkout-return.tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { confirmCheckout } from "@/lib/api";
import { SrStatus } from "@/components/shared/sr-status";

type Result = { kind: "idle" } | { kind: "added"; n: number } | { kind: "replay" } | { kind: "processing" };

/**
 * Handles the `/?checkout={sessionId}` return leg from Stripe's hosted page: confirm →
 * refresh the balance → say what happened. Mount inside <Suspense> (useSearchParams).
 *
 * ⚠️ There is no failure render. A confirm that errors, or a session Stripe reports
 * unpaid/unknown, both say "payment processing" — the webhook fulfills independently, and
 * telling a buyer whose card WAS charged that something failed would be a lie we can't
 * verify. Never fabricate an outcome from an unresolved confirm (live-data honesty §5).
 */
export function CheckoutReturn() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const sessionId = params.get("checkout");
  const [result, setResult] = useState<Result>({ kind: "idle" });

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await confirmCheckout(sessionId);
        if (cancelled) return;
        if (r.paid) setResult(r.granted > 0 ? { kind: "added", n: r.granted } : { kind: "replay" });
        else setResult({ kind: "processing" });
        void qc.invalidateQueries({ queryKey: ["tokens"] });
      } catch {
        if (!cancelled) setResult({ kind: "processing" });
      }
      router.replace("/", { scroll: false }); // strip the param; the note lives in state
    })();
    return () => { cancelled = true; };
  }, [sessionId, qc, router]);

  if (!sessionId || result.kind === "idle") return null;
  const text =
    result.kind === "added"
      ? `${result.n} token${result.n === 1 ? "" : "s"} added — thanks for keeping the servers up`
      : result.kind === "replay"
        ? "Tokens already added — thanks for keeping the servers up"
        : "Payment processing — your tokens land shortly";
  return (
    <>
      <SrStatus>{text}</SrStatus>
      <p className="bg-bone px-3 py-2 font-mono text-[11px] uppercase tracking-[.06em] text-ink-soft">{text}</p>
    </>
  );
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `cd apps/web && pnpm test -- checkout-return`
Expected: PASS (5 tests).

- [ ] **Step 9: Mount both in the controls slab**

In `apps/web/src/components/account/controls-slab.tsx`:
- Import `Suspense` from `react`, plus `BuyTokensButton` and `CheckoutReturn`.
- In the "Your tokens" `Half`, change the `control` prop from `<SendField own={gamertag} />` to a column that adds the buy row and the return note beneath the send field (the `Half` skeleton — h2 → sentence → `mt-auto` control → hint — is a ⚠️-guarded structure; extend the control's *contents*, do not restructure `Half`):

```tsx
control={
  <div className="flex flex-col gap-3">
    <SendField own={gamertag} />
    <Suspense fallback={null}>
      <CheckoutReturn />
    </Suspense>
    <BuyTokensButton className="self-start" />
  </div>
}
```

`BuyTokensButton` renders null when the store is OFF, so the slab is byte-identical in unconfigured environments. Run the existing slab tests to confirm nothing regressed: `cd apps/web && pnpm test -- controls-slab`.

- [ ] **Step 10: Full web suite + typecheck**

Run: `cd apps/web && pnpm test && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/components/account/buy-tokens.tsx apps/web/src/components/account/buy-tokens.test.tsx apps/web/src/components/account/checkout-return.tsx apps/web/src/components/account/checkout-return.test.tsx apps/web/src/components/account/controls-slab.tsx
git commit -m "feat(web): buy-tokens button and checkout return on the controls slab"
```

---

### Task 5: Web — buy affordance on the banned ticket

**Files:**
- Modify: `apps/web/src/components/player/ticket-spend.tsx`
- Test: `apps/web/src/components/player/ticket-spend.test.tsx` (create if absent; extend if present)

**Interfaces:**
- Consumes: `BuyTokensButton` is NOT reused here (its sizing/copy belongs to the slab); consumes `createCheckout` from `@/lib/api` and `tokenPriceLabel` from `@/components/account/buy-tokens` directly.
- Produces: no new exports — `TicketSpend` gains a secondary "Buy a token — {label}" button below "Spend 1 token".

Context: `TicketSpend` is the live banned-ticket affordance (`ticket-stage.tsx:224`), rendered owner-only and banned-only, and is deliberately mountable **without a query provider** — so the buy affordance must not introduce a `useQuery`. (`SelfUnbanButton`/`UnbanView` hold the old "no tokens" copy but are mounted nowhere; leave them alone.) TicketSpend does not know the balance, so the buy button shows whenever the store is ON — a player with tokens sees Spend first, Buy beneath, which is correct: both are true offers.

- [ ] **Step 1: Write the failing test**

If `ticket-spend.test.tsx` does not exist, create it with this content (mock idiom per `self-unban-button.test.tsx`; `next/navigation`'s `useRouter` must be mocked because `TicketSpend` calls it):

```tsx
// apps/web/src/components/player/ticket-spend.test.tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TicketSpend } from "./ticket-spend";

const redeemToken = vi.fn();
const createCheckout = vi.fn();
vi.mock("@/lib/api", () => ({
  redeemToken: (...a: unknown[]) => redeemToken(...a),
  createCheckout: (...a: unknown[]) => createCheckout(...a),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => { vi.unstubAllEnvs(); redeemToken.mockReset(); createCheckout.mockReset(); });

describe("TicketSpend buy affordance", () => {
  it("offers no buy button when the store is OFF", () => {
    render(<TicketSpend banId={1} liftPending={false} />);
    expect(screen.getByRole("button", { name: /spend 1 token/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /buy a token/i })).not.toBeInTheDocument();
  });
  it("offers a buy button when the store is ON and redirects to checkout", async () => {
    vi.stubEnv("NEXT_PUBLIC_TOKEN_PRICE_LABEL", "$3");
    createCheckout.mockResolvedValue({ url: "https://checkout.stripe.test/cs_9" });
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign }, writable: true });
    render(<TicketSpend banId={1} liftPending={false} />);
    await userEvent.click(screen.getByRole("button", { name: /buy a token — \$3/i }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/cs_9"));
  });
  it("hides the buy button while a lift is pending", () => {
    vi.stubEnv("NEXT_PUBLIC_TOKEN_PRICE_LABEL", "$3");
    render(<TicketSpend banId={1} liftPending={true} />);
    expect(screen.queryByRole("button", { name: /buy a token/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && pnpm test -- ticket-spend`
Expected: FAIL — no buy button rendered.

- [ ] **Step 3: Implement**

In `ticket-spend.tsx`, import `createCheckout` from `@/lib/api` and `tokenPriceLabel` from `@/components/account/buy-tokens`, add a `busy` state, and after the existing Spend `<button>` (inside the non-pending return, wrapping both in a fragment or flex column) add:

```tsx
{tokenPriceLabel() && (
  <button
    type="button"
    disabled={buying}
    onClick={async () => {
      setBuying(true);
      try {
        const { url } = await createCheckout();
        window.location.assign(url);
      } catch {
        setBuying(false);
      }
    }}
    className="mt-2 w-full border-2 border-ink bg-paper px-3 py-2.5 font-mono text-[10px] uppercase tracking-[.1em] text-ink hover:bg-ink hover:text-paper disabled:opacity-40"
  >
    {buying ? "Opening checkout…" : `Buy a token — ${tokenPriceLabel()}`}
  </button>
)}
```

(`const [buying, setBuying] = useState(false);` alongside the existing `pending` state. The pending branch returns early above, which is what keeps the buy button out of the lifting state.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && pnpm test -- ticket-spend`
Expected: PASS (3 tests). Also run any existing ticket-stage tests: `pnpm test -- ticket-stage`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/player/ticket-spend.tsx apps/web/src/components/player/ticket-spend.test.tsx
git commit -m "feat(web): buy-a-token affordance on the banned ticket"
```

---

### Task 6: Docs, changelog, full verification

**Files:**
- Modify: `docs/architecture/monorepo.md` (env-var table: the three `STRIPE_*` vars under the api app, `NEXT_PUBLIC_TOKEN_PRICE_LABEL` under web, each noted unset-means-OFF)
- Modify: `docs/superpowers/specs/2026-07-31-token-store-design.md` — no content change expected; only if implementation diverged, record the divergence
- Modify: `CHANGELOG.md`

**Interfaces:** none.

- [ ] **Step 1: Document the env vars**

In `docs/architecture/monorepo.md`, find the api and web app entries and add one line each for the new env vars, in the file's existing format. State: all four unset-means-OFF; the API additionally warns at boot when the Stripe trio is only partially set.

- [ ] **Step 2: Full monorepo verification**

Run from the repo root:

```bash
pnpm turbo run typecheck
TEST_DATABASE_URL=<url> pnpm turbo run test --concurrency=1
```

Expected: all green. Fix anything that isn't before proceeding.

- [ ] **Step 3: Changelog entry (last, per house rule)**

Add under `## [Unreleased]` in `CHANGELOG.md` (create the section if absent, matching the file's existing heading style):

```markdown
### Added
- Token store: verified players can buy unban tokens via Stripe Checkout — buy buttons on
  the home controls slab and the banned ticket, webhook + return-trip fulfillment into the
  token ledger, unset-means-OFF until the Stripe env and price label are configured.
```

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/monorepo.md CHANGELOG.md
git commit -m "docs: token store env vars and changelog entry"
```

- [ ] **Step 5: Hand off to keel:finish-work**

The branch is ready for `keel:finish-work` (checks, PR against main). Remaining browser-only work to carry into the PR description / outstanding list:
- Full live round trip against Stripe **test mode**: buy → hosted checkout → return → balance bump → webhook race.
- Both buy surfaces at 320px (CDP `Emulation.setDeviceMetricsOverride`).
- Prod rollout: create the Stripe Product/Price, set the three `STRIPE_*` vars + `NEXT_PUBLIC_TOKEN_PRICE_LABEL`, and register the webhook endpoint in the Stripe dashboard — the public URL that proxies to the API's `/stripe/webhook` (on this deployment shape, `https://<site>/api/stripe/webhook`).
