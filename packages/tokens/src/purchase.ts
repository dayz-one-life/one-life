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
