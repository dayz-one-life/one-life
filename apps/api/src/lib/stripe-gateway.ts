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
      } catch (err) {
        // Only return null for genuinely missing sessions (Stripe 404 resource_missing).
        // Network failures, auth errors, rate limits, etc. must propagate so the delivery is retried.
        const stripeErr = err as Stripe.errors.StripeError;
        if (stripeErr.code === "resource_missing" && stripeErr.statusCode === 404) {
          return null;
        }
        throw err;
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
