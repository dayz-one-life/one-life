import { eq } from "drizzle-orm";
import { type Database, user, gamertagLinks, referrals, tokenTransactions } from "@onelife/db";
import { getBalance } from "@onelife/tokens";

export type DeletionSummary = {
  /** Unspent tokens destroyed with the account. Reported so the caller can say so out loud. */
  tokensForfeited: number;
  gamertagLinksRemoved: number;
};

/**
 * Permanently delete a user account. Player history SURVIVES: `players` and `lives` carry no
 * `userId` — history is keyed by gamertag and server — so the dossier keeps its lives, deaths
 * and obituaries and loses only its verified badge and avatar.
 *
 * ⚠️ Everything happens in ONE transaction. Three FKs to `user.id` do NOT cascade, and steps
 * 1-3 below must run before the user row is deleted or Postgres rejects it. If any step fails
 * the whole thing rolls back and the account survives intact — a partial delete would strip
 * someone's gamertag link and referral credits while leaving them signed in.
 *
 * This is also why we do NOT use Better Auth's `deleteUser` + `beforeDelete` hook: that hook
 * runs before the user deletion with no shared transaction, so a failure there leaves exactly
 * the partial state this design exists to prevent.
 */
export async function deleteAccount(db: Database, userId: string): Promise<DeletionSummary> {
  return db.transaction(async (tx) => {
    const tokensForfeited = await getBalance(tx, userId);

    // 1. The departing user's own links. Deleted EXPLICITLY rather than by adding a cascade to
    //    the schema, so the behaviour stays visible in code.
    const removedLinks = await tx
      .delete(gamertagLinks)
      .where(eq(gamertagLinks.userId, userId))
      .returning({ id: gamertagLinks.id });

    // 2. Referral rows crediting this user AS THE REFERRER. These live on the referee's id and
    //    do not cascade (`referrerUserId` is NOT NULL). `grantReferral` pays the referrer, once
    //    ever — the referee never earned from the row, so deleting it costs them nothing.
    await tx.delete(referrals).where(eq(referrals.referrerUserId, userId));

    // 3. Other users' ledger rows naming this user as the transfer counterparty. NULL the
    //    attribution, never delete the row: it is the OTHER user's balance history.
    await tx
      .update(tokenTransactions)
      .set({ counterpartyUserId: null })
      .where(eq(tokenTransactions.counterpartyUserId, userId));

    // 4. The user. Cascades take session, account, avatars, notifications, push_subscriptions,
    //    location_shares (both granter and grantee), token_transactions.userId and
    //    referrals.userId. Deleting the session rows is what signs every device out.
    await tx.delete(user).where(eq(user.id, userId));

    return { tokensForfeited, gamertagLinksRemoved: removedLinks.length };
  });
}
