import { sql, and, eq } from "drizzle-orm";
import { tokenTransactions, gamertagLinks } from "@onelife/db";

/** Typed error whose `code` maps to an HTTP response in the API layer. */
export class TokenError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = "TokenError";
  }
}

// Helpers accept a drizzle db OR transaction executor — both expose the same query builder.
// Typed loosely because Database and PgTransaction are distinct TS types.
type Executor = { select: (...a: unknown[]) => any };

export async function balanceOf(tx: Executor, userId: string): Promise<number> {
  const [r] = await tx
    .select({ bal: sql<number>`coalesce(sum(${tokenTransactions.delta}), 0)::int` })
    .from(tokenTransactions)
    .where(eq(tokenTransactions.userId, userId));
  return r?.bal ?? 0;
}

export async function verifiedOf(tx: Executor, userId: string): Promise<boolean> {
  const [r] = await tx
    .select({ id: gamertagLinks.id })
    .from(gamertagLinks)
    .where(and(eq(gamertagLinks.userId, userId), eq(gamertagLinks.status, "verified")))
    .limit(1);
  return !!r;
}
