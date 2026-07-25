import type { Database } from "@onelife/db";
import { locationShares, sessions } from "@onelife/db";
import { and, eq, isNull, desc } from "drizzle-orm";

/**
 * Sub-project E: session-scoped location sharing.
 *
 * ⚠️ This module REPLACED F2's `shouldShareLocation` and its two-switch consent model. There is
 * no master switch and no per-friendship flag any more; there is one concept, a grant to a named
 * person for the duration of one game session. Do not reintroduce a standing setting.
 */

/**
 * The granter's currently-open session on one server, or null.
 *
 * ⚠️ Scoped to ONE server. A player online on two servers has two open sessions, and a grant
 * belongs to exactly one of them — resolving "their current session" globally would let a grant
 * made on Chernarus keep working while they play Sakhal.
 *
 * `disconnectedAt IS NULL` alone is deliberately what "open" means HERE, without the 900s
 * freshness bound the online list applies. The bound belongs on the read path (a stale session
 * yields no fresh position anyway, so no dot renders); applying it at grant time would refuse a
 * grant from someone who is demonstrably at their keyboard but whose last position dump is a few
 * minutes old.
 */
export async function currentSessionStart(
  db: Database,
  a: { userPlayerId: number; serverId: number },
): Promise<Date | null> {
  const [row] = await db
    .select({ connectedAt: sessions.connectedAt })
    .from(sessions)
    .where(and(
      eq(sessions.playerId, a.userPlayerId),
      eq(sessions.serverId, a.serverId),
      isNull(sessions.disconnectedAt),
    ))
    // A crashed client can leave more than one session open until the next reboot closes it;
    // the newest is the one the player is actually in.
    .orderBy(desc(sessions.connectedAt))
    .limit(1);
  return row?.connectedAt ?? null;
}

/**
 * Hand one person your position for the rest of this session.
 *
 * Returns the session snapshot that was stored, or null when the granter is not currently online
 * on that server — a grant is always made DURING a session, which is what anchors its expiry.
 * The caller uses the returned value for the notification's natural key, so re-granting inside
 * one session is idempotent while a grant in the next session notifies again.
 *
 * ⚠️ `onConflictDoUpdate` on (granter, grantee, server) — re-granting UPDATES the snapshot rather
 * than accumulating rows, so a share can be renewed in a later session without a delete first.
 */
export async function grantLocation(
  db: Database,
  a: { granterUserId: string; granterPlayerId: number; granteeUserId: string; serverId: number },
): Promise<Date | null> {
  const connectedAt = await currentSessionStart(db, {
    userPlayerId: a.granterPlayerId,
    serverId: a.serverId,
  });
  if (!connectedAt) return null;

  await db
    .insert(locationShares)
    .values({
      granterUserId: a.granterUserId,
      granteeUserId: a.granteeUserId,
      serverId: a.serverId,
      granterSessionConnectedAt: connectedAt,
    })
    .onConflictDoUpdate({
      target: [locationShares.granterUserId, locationShares.granteeUserId, locationShares.serverId],
      set: { granterSessionConnectedAt: connectedAt },
    });

  return connectedAt;
}

/** Stop sharing with everyone on one server. Backs the map's "N can see you · Stop" chip. */
export async function revokeAllLocation(
  db: Database,
  a: { granterUserId: string; serverId: number },
): Promise<void> {
  await db.delete(locationShares).where(and(
    eq(locationShares.granterUserId, a.granterUserId),
    eq(locationShares.serverId, a.serverId),
  ));
}

/** Stop sharing with one person on one server. */
export async function revokeLocation(
  db: Database,
  a: { granterUserId: string; granteeUserId: string; serverId: number },
): Promise<void> {
  await db.delete(locationShares).where(and(
    eq(locationShares.granterUserId, a.granterUserId),
    eq(locationShares.granteeUserId, a.granteeUserId),
    eq(locationShares.serverId, a.serverId),
  ));
}

/**
 * Every row a re-verifying user has granted, deleted.
 *
 * ⚠️ Called by `verifyLink`, the only writer of `status='verified'`. A re-verified gamertag link
 * is a NEW claim on that identity and must not inherit outbound sharing — the same reason F2 had
 * `verifyLink` reset its master switch. One-directional: it clears what this user shares, never
 * what others share with them.
 */
export async function clearLocationSharesFor(db: Database, granterUserId: string): Promise<void> {
  await db.delete(locationShares).where(eq(locationShares.granterUserId, granterUserId));
}

/**
 * Is a stored grant still effective?
 *
 * ⚠️ THE PREDICATE. Equality against the granter's CURRENT open session, not a comparison of two
 * clocks: `granted_at >= connected_at` would put the API's wall clock on one side and an
 * ADM-derived timestamp (with `servers.clock_offset_ms` applied) on the other. Those differ by
 * seconds, so that form silently never matches for a grant made in the first seconds of a
 * session — a share the UI calls active that never works. Both sides here are the same value.
 *
 * A granter with no open session has no current session to match, so every grant of theirs is
 * dead. That is the disconnect case, and it needs no separate branch.
 */
export function isShareEffective(a: {
  storedSessionStart: Date;
  currentSessionStart: Date | null;
}): boolean {
  if (!a.currentSessionStart) return false;
  return a.storedSessionStart.getTime() === a.currentSessionStart.getTime();
}
