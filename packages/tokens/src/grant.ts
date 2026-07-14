import { type Database, tokenTransactions } from "@onelife/db";

/** Idempotent +1 grant. Returns true if a new ledger row was written, false if the key already existed. */
export async function grant(
  db: Database,
  a: { userId: string; kind: string; idempotencyKey: string; relatedBanId?: number; counterpartyUserId?: string },
): Promise<boolean> {
  const res = await db
    .insert(tokenTransactions)
    .values({
      userId: a.userId,
      delta: 1,
      kind: a.kind,
      idempotencyKey: a.idempotencyKey,
      relatedBanId: a.relatedBanId,
      counterpartyUserId: a.counterpartyUserId,
    })
    .onConflictDoNothing({ target: tokenTransactions.idempotencyKey })
    .returning({ id: tokenTransactions.id });
  return res.length > 0;
}
