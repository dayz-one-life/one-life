import { describe, it, expect, vi, beforeEach } from "vitest";
import Stripe from "stripe";

// Mock the stripe module to control what retrieve() returns
vi.mock("stripe");

import { createStripeGateway } from "../src/lib/stripe-gateway.js";

describe("stripe gateway retrieveSession error handling", () => {
  let MockedStripe: any;
  let mockRetrieve: any;

  beforeEach(() => {
    MockedStripe = Stripe as any;
    MockedStripe.mockClear();

    // Mock the retrieve method that we'll control per-test
    mockRetrieve = vi.fn();

    // Set up the mock Stripe class to return an instance with mocked checkout.sessions.retrieve
    MockedStripe.mockImplementation(() => ({
      checkout: {
        sessions: {
          retrieve: mockRetrieve,
        },
      },
      webhooks: {
        constructEvent: vi.fn(),
      },
    }));
  });

  it("returns null when retrieve rejects with resource_missing (404)", async () => {
    const resourceMissingError = Object.assign(new Error("No such checkout session"), {
      code: "resource_missing",
      statusCode: 404,
    });
    mockRetrieve.mockRejectedValue(resourceMissingError);

    const gw = createStripeGateway({ secretKey: "sk_test_dummy", webhookSecret: "whsec_dummy", priceId: "price_x" });
    const result = await gw.retrieveSession("cs_bogus");

    expect(result).toBeNull();
  });

  it("rethrows when retrieve rejects with network error (not resource_missing)", async () => {
    const networkError = new Error("Network connection failed");
    mockRetrieve.mockRejectedValue(networkError);

    const gw = createStripeGateway({ secretKey: "sk_test_dummy", webhookSecret: "whsec_dummy", priceId: "price_x" });

    await expect(gw.retrieveSession("cs_test")).rejects.toThrow("Network connection failed");
  });

  it("rethrows when retrieve rejects with rate limit or other transient error", async () => {
    const rateLimitError = Object.assign(new Error("Too many requests"), {
      code: "rate_limit",
      statusCode: 429,
    });
    mockRetrieve.mockRejectedValue(rateLimitError);

    const gw = createStripeGateway({ secretKey: "sk_test_dummy", webhookSecret: "whsec_dummy", priceId: "price_x" });

    await expect(gw.retrieveSession("cs_test")).rejects.toThrow("Too many requests");
  });

  it("returns session state when retrieve succeeds", async () => {
    const mockSession = {
      id: "cs_test_123",
      payment_status: "paid",
      client_reference_id: "user_456",
      line_items: {
        data: [{ quantity: 5 }],
      },
    };
    mockRetrieve.mockResolvedValue(mockSession);

    const gw = createStripeGateway({ secretKey: "sk_test_dummy", webhookSecret: "whsec_dummy", priceId: "price_x" });
    const result = await gw.retrieveSession("cs_test_123");

    expect(result).toEqual({
      paid: true,
      clientReferenceId: "user_456",
      quantity: 5,
    });
  });
});
