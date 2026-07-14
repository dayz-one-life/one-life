import { randomUUID } from "node:crypto";
import { type Database, tokenTransactions } from "@onelife/db";
import { TokenError, balanceOf, verifiedOf } from "./internal.js";

/**
 * Move one token between two verified users. Throws
 * TokenError('self_transfer'|'not_verified'|'insufficient_tokens').
 */
export async function transfer(db: Database, a: { fromUserId: string; toUserId: string }): Promise<void> {
  if (a.fromUserId === a.toUserId) throw new TokenError("self_transfer");
  await db.transaction(async (tx) => {
    if (!(await verifiedOf(tx, a.fromUserId)) || !(await verifiedOf(tx, a.toUserId))) {
      throw new TokenError("not_verified");
    }
    if ((await balanceOf(tx, a.fromUserId)) < 1) throw new TokenError("insufficient_tokens");
    const ref = randomUUID(); // transfers are not naturally idempotent — unique key per event
    await tx.insert(tokenTransactions).values([
      { userId: a.fromUserId, delta: -1, kind: "transfer_out", idempotencyKey: `transfer:${ref}:out`, counterpartyUserId: a.toUserId },
      { userId: a.toUserId, delta: 1, kind: "transfer_in", idempotencyKey: `transfer:${ref}:in`, counterpartyUserId: a.fromUserId },
    ]);
  });
}
