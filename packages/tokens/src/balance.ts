import { sql, eq } from "drizzle-orm";
import { type Database, tokenTransactions } from "@onelife/db";

/** A user's token balance = SUM of ledger deltas (0 if none). */
export async function getBalance(db: Database, userId: string): Promise<number> {
  const [r] = await db
    .select({ bal: sql<number>`coalesce(sum(${tokenTransactions.delta}), 0)::int` })
    .from(tokenTransactions)
    .where(eq(tokenTransactions.userId, userId));
  return r?.bal ?? 0;
}
