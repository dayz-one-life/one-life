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
    // Mirrors the real gateway: both checkout.session.completed and the delayed-payment-method
    // confirmation event carry a fulfillable session id.
    return parsed.type === "checkout.session.completed" || parsed.type === "checkout.session.async_payment_succeeded"
      ? parsed.sessionId
      : null;
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

const post = (url: string, payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url, payload: payload as any, headers: { "content-type": "application/json", cookie, ...headers } });

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
  it("fulfills a paid session from checkout.session.async_payment_succeeded (delayed payment methods)", async () => {
    sessions.set("cs_async_hook", { paid: true, clientReferenceId: userId, quantity: 1 });
    const payload = JSON.stringify({ type: "checkout.session.async_payment_succeeded", sessionId: "cs_async_hook" });
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
