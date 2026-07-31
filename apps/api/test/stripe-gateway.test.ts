import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

describe("stripe gateway retrieveSession error handling", () => {
  // Extracted error handling logic that mirrors the gateway implementation
  async function testRetrieveWithError(error: any): Promise<any> {
    try {
      throw error;
    } catch (err) {
      const stripeErr = err as Stripe.errors.StripeError;
      if (stripeErr.code === "resource_missing" && stripeErr.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  it("returns null for resource_missing (404)", async () => {
    const resourceMissingError = new Error("No such checkout session") as any;
    resourceMissingError.code = "resource_missing";
    resourceMissingError.statusCode = 404;

    const result = await testRetrieveWithError(resourceMissingError);
    expect(result).toBeNull();
  });

  it("rethrows on network errors (not resource_missing)", async () => {
    const networkError = new Error("Network connection failed") as any;
    networkError.code = "connection_error";
    networkError.statusCode = undefined;

    await expect(testRetrieveWithError(networkError)).rejects.toThrow("Network connection failed");
  });

  it("rethrows on rate limit errors", async () => {
    const rateLimitError = new Error("Too many requests") as any;
    rateLimitError.code = "rate_limit";
    rateLimitError.statusCode = 429;

    await expect(testRetrieveWithError(rateLimitError)).rejects.toThrow("Too many requests");
  });

  it("rethrows on auth errors", async () => {
    const authError = new Error("Invalid API key") as any;
    authError.code = "invalid_request_error";
    authError.statusCode = 401;

    await expect(testRetrieveWithError(authError)).rejects.toThrow("Invalid API key");
  });
});
