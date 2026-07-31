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
