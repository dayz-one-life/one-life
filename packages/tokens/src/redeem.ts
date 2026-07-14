import { and, eq, inArray, desc } from "drizzle-orm";
import { type Database, bans, gamertagLinks, tokenTransactions } from "@onelife/db";
import { TokenError, balanceOf } from "./internal.js";

/**
 * Spend one token to lift the user's active 24h death-ban. Sets the ban to 'lift_pending'
 * (the enforcer removes it from Nitrado) — or straight to 'lifted' if it was never applied
 * (dry-run). Never calls Nitrado. Throws TokenError('no_active_ban'|'not_owner'|'insufficient_tokens').
 */
export async function redeem(db: Database, a: { userId: string; banId?: number }): Promise<{ banId: number; gamertag: string }> {
  return db.transaction(async (tx) => {
    const links = await tx
      .select({ serverId: gamertagLinks.serverId, gamertag: gamertagLinks.gamertag })
      .from(gamertagLinks)
      .where(and(eq(gamertagLinks.userId, a.userId), eq(gamertagLinks.status, "verified")));
    if (links.length === 0) throw new TokenError("no_active_ban");

    const candidates = await tx
      .select()
      .from(bans)
      .where(inArray(bans.status, ["pending", "applied"]))
      .orderBy(desc(bans.bannedAt));
    const owned = candidates.filter((b) => links.some((l) => l.serverId === b.serverId && l.gamertag === b.gamertag));

    let ban;
    if (a.banId != null) {
      ban = owned.find((b) => b.id === a.banId);
      if (!ban) throw new TokenError("not_owner");
    } else {
      ban = owned[0];
      if (!ban) throw new TokenError("no_active_ban");
    }

    if ((await balanceOf(tx, a.userId)) < 1) throw new TokenError("insufficient_tokens");

    await tx.insert(tokenTransactions).values({
      userId: a.userId,
      delta: -1,
      kind: "redeem",
      idempotencyKey: `redeem:${ban.id}`,
      relatedBanId: ban.id,
    });

    const lifted = ban.status !== "applied"; // 'pending' was never on Nitrado
    await tx
      .update(bans)
      .set({ status: lifted ? "lifted" : "lift_pending", liftedAt: lifted ? new Date() : null })
      .where(eq(bans.id, ban.id));

    return { banId: ban.id, gamertag: ban.gamertag };
  });
}
