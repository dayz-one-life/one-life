import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import type { Auth } from "@onelife/auth";
import { z } from "zod";
import { fulfillPurchase, getBalance, isVerifiedUser } from "@onelife/tokens";
import { getSession } from "../auth-plugin.js";
import type { StripeGateway } from "../lib/stripe-gateway.js";

const confirmBody = z.object({ sessionId: z.string().min(1) });

/** Postgres 23503 = foreign_key_violation. `token_transactions.user_id` FKs to `user`, and
 *  account deletion is now reachable (this branch), so a buyer who deletes their account while
 *  a checkout is in flight — or while Stripe is mid-retry — makes this insert fail this way. */
function isMissingUserForeignKeyViolation(err: unknown): boolean {
  const e = err as { code?: string };
  return e?.code === "23503";
}

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
          try {
            await fulfillPurchase(db, { userId: s.clientReferenceId, sessionId, quantity: s.quantity });
          } catch (err) {
            // The buyer deleted their account (this branch made that reachable) while this
            // checkout was in flight, or while Stripe was mid-retry on an earlier delivery of
            // this same event: `token_transactions.user_id` no longer resolves, and the insert
            // in `grant()` raises 23503. There is no user left to credit and nothing we can do
            // will change that on a retry, so respond 200 to make Stripe stop — a 500 here
            // would just buy three days of identical retries for a purchase that can never be
            // fulfilled. Logged loudly so an operator can reconcile by hand (e.g. refund) if
            // this ever needs a human. Anything else — a real DB outage, a bug — still 500s so
            // Stripe keeps retrying as designed.
            if (isMissingUserForeignKeyViolation(err)) {
              req.log.error(
                { sessionId, userId: s.clientReferenceId, quantity: s.quantity, err },
                "stripe webhook: buyer's account no longer exists, cannot fulfil purchase — acking to stop retries",
              );
              return { received: true };
            }
            throw err;
          }
        } else {
          // A checkout event resolved to a session we cannot fulfill — either it's genuinely
          // unpaid (delayed payment method still pending) or missing a clientReferenceId
          // (shouldn't happen; every checkout we create sets one). Previously this was a
          // silent no-op with no trace anywhere. Log so an operator can tell "waiting on the
          // buyer's bank" apart from "something is actually broken".
          req.log.warn({ sessionId, paid: s?.paid ?? null, clientReferenceId: s?.clientReferenceId ?? null },
            "stripe webhook: checkout session not fulfillable");
        }
      }
      return { received: true };
    });
  });
}
