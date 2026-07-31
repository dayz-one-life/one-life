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
