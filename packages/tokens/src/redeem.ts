import { and, eq, inArray, desc, sql } from "drizzle-orm";
import { type Database, bans, gamertagLinks, tokenTransactions, players, playerGamertags } from "@onelife/db";
import { TokenError, balanceOf, type Executor } from "./internal.js";

/**
 * Map a gamertag to the player identity that holds it: the current name first, then any
 * former name, most recent holder winning. Returns null for a name nobody has used.
 * A rename moves players.gamertag, so comparing raw strings here silently denies a renamed
 * player their own unban.
 */
async function playerIdForGamertag(tx: Executor, gamertag: string): Promise<number | null> {
  // players.gamertag is a non-unique index now (players_gamertag_uniq was dropped once a
  // gamertag became a current label rather than an identity) — a recycled name can legitimately
  // match two players rows, so resolve to the most-recently-seen one, `id` as a stable
  // tie-break. Same ordering as resolveSlugMatch in packages/read-models/src/player-aggregate.ts.
  const direct = await tx.select({ id: players.id }).from(players)
    .where(sql`lower(${players.gamertag}) = lower(${gamertag})`)
    .orderBy(sql`${players.lastSeenAt} desc nulls last`, sql`${players.id} asc`)
    .limit(1);
  if (direct[0]) return direct[0].id;
  const alias = await tx.select({ id: playerGamertags.playerId }).from(playerGamertags)
    .where(sql`lower(${playerGamertags.gamertag}) = lower(${gamertag})`)
    .orderBy(desc(playerGamertags.lastSeenAt)).limit(1);
  return alias[0]?.id ?? null;
}

/**
 * Spend one token to lift the user's active 24h death-ban. Sets the ban to 'lift_pending'
 * (the enforcer removes it from Nitrado) — or straight to 'lifted' if it was still 'pending'
 * (queued but not yet applied to Nitrado). Never calls Nitrado.
 * A ban placed under ENFORCER_DRY_RUN (`bans.dryRun = true`) was never actually applied on the
 * game server — it is not a real ban, so it is excluded from the candidate set entirely and
 * cannot be redeemed (throws 'no_active_ban'/'not_owner' as appropriate; no token is spent).
 * Throws TokenError('no_active_ban'|'not_owner'|'insufficient_tokens').
 */
export async function redeem(db: Database, a: { userId: string; banId?: number }): Promise<{ banId: number; gamertag: string }> {
  return db.transaction(async (tx) => {
    const links = await tx
      .select({ gamertag: gamertagLinks.gamertag })
      .from(gamertagLinks)
      .where(and(eq(gamertagLinks.userId, a.userId), eq(gamertagLinks.status, "verified")));
    if (links.length === 0) throw new TokenError("no_active_ban");

    const candidates = await tx
      .select()
      .from(bans)
      .where(and(inArray(bans.status, ["pending", "applied"]), eq(bans.dryRun, false)))
      .orderBy(desc(bans.bannedAt));
    // Compare identities, not name strings: after a rename a verified link still names the
    // OLD callsign while bans are written under the NEW one, so raw-string matching would
    // silently deny a renamed player their own unban (the casing failure `0024` fixed).
    const linkIds = new Set(
      (await Promise.all(links.map((l) => playerIdForGamertag(tx, l.gamertag))))
        .filter((id): id is number => id !== null),
    );
    const banIds = new Map<string, number | null>();
    for (const b of candidates) {
      if (!banIds.has(b.gamertag)) banIds.set(b.gamertag, await playerIdForGamertag(tx, b.gamertag));
    }
    const owned = candidates.filter((b) => {
      const id = banIds.get(b.gamertag);
      return id !== null && id !== undefined && linkIds.has(id);
    });

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
