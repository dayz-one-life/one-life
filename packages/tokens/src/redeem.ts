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
 * Spend one token to lift the user's active death-ban. Sets the ban to 'lift_pending'
 * (the enforcer removes it from Nitrado) — or straight to 'lifted' if it was still 'pending'
 * (queued but not yet applied to Nitrado). Every other active ban of the same player on the same
 * server is lifted with it, for the same token. Never calls Nitrado.
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
    // ⚠️ A ban's owner is the player with its dayz id, when it has one. Resolving the ban's NAME
    // to whoever holds that name now hands a recycled gamertag's old bans to the new holder: his
    // token would lift (and the enforcer would unban) another player. The name is the fallback
    // only for a ban with no dayz id, or one whose dayz id has no players row.
    const byName = new Map<string, number | null>();
    const byDayzId = new Map<string, number | null>();
    const ownerOf = new Map<number, number | null>();
    for (const b of candidates) {
      let id: number | null = null;
      if (b.dayzId != null) {
        if (!byDayzId.has(b.dayzId)) {
          const [p] = await tx.select({ id: players.id }).from(players).where(eq(players.dayzId, b.dayzId)).limit(1);
          byDayzId.set(b.dayzId, p?.id ?? null);
        }
        id = byDayzId.get(b.dayzId)!;
      }
      if (id === null) {
        if (!byName.has(b.gamertag)) byName.set(b.gamertag, await playerIdForGamertag(tx, b.gamertag));
        id = byName.get(b.gamertag)!;
      }
      ownerOf.set(b.id, id);
    }
    const owned = candidates.filter((b) => {
      const id = ownerOf.get(b.id);
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

    // ⚠️ One token lifts EVERY active ban of this player on this server, not only the one named.
    // The server's ban list holds names, shared by all of them: a late ban (a trap kill written
    // after the death it qualifies) can overlap a later one, and lifting only one would leave the
    // player locked out by the other while they have paid to come back.
    // Two bans that both carry a dayz id are the same player only if the ids are equal; the
    // resolved owner decides only when one of them has none.
    const chosen = ban;
    const chosenOwner = ownerOf.get(chosen.id);
    const siblings = owned.filter((b) => b.serverId === chosen.serverId && (b.id === chosen.id
      || (chosen.dayzId != null && b.dayzId != null ? b.dayzId === chosen.dayzId : ownerOf.get(b.id) === chosenOwner)));
    const at = new Date();
    for (const b of siblings) {
      const lifted = b.status !== "applied"; // 'pending' was never on Nitrado
      await tx
        .update(bans)
        .set({ status: lifted ? "lifted" : "lift_pending", liftedAt: lifted ? at : null, liftReason: "token" })
        .where(eq(bans.id, b.id));
    }

    return { banId: ban.id, gamertag: ban.gamertag };
  });
}
