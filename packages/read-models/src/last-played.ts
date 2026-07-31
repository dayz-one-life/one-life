import type { Database } from "@onelife/db";
import { gamertagLinks, players, servers, sessions } from "@onelife/db";
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";

/**
 * The slug of the map this user most recently played on, or `null`.
 *
 * Tier 2 of the one map-resolution rule (D spec §3.1): session memory → **this** → alphabetical
 * by display label. It is what makes "where am I?" a question about the player rather than about
 * their browser.
 *
 * ⚠️ The subject is the SESSION-DERIVED user id and nothing else. There is no gamertag, slug or
 * player-id parameter, and none may be added — this is the same shape the coordinate routes hold,
 * for a weaker reason (a map slug is not a position), but the property is cheap to keep.
 *
 * ⚠️ The link must be `verified`, not merely `pending`. Anyone can type any gamertag into the
 * claim box, so a pending link would let an unverified user inherit a stranger's map history.
 *
 * ⚠️ The join to `servers` is INNER and filters `active` + slugged, so a session on a retired or
 * unslugged server produces NO ROW rather than a slug the router then has to reject. Returning a
 * slug the caller must re-validate is how a resolution rule grows a second, divergent copy of the
 * "is this server still real?" check.
 *
 * ⚠️ Ordered by `connected_at DESC` — never `disconnected_at` (null on an OPEN session, which is
 * precisely the player this is most likely to be asked about) and never `lives.started_at` (a
 * life spans many sessions across many days, so the newest life is not the newest session).
 *
 * ⚠️ No `(player_id, connected_at)` index exists and none is needed AT THIS FLEET SIZE: the join
 * to `servers` bounds the work to one lookup per active server against the existing
 * `sessions_open_idx (server_id, player_id, disconnected_at)`. Measured against a restored
 * production dump: 0.083 ms, a nested loop over 3 servers. **If the fleet grows to tens of
 * servers this degrades linearly and wants a real `(player_id, connected_at DESC)` index** — that
 * is a migration, and this comment is its trigger.
 */
export async function getLastPlayedMapSlug(db: Database, userId: string): Promise<string | null> {
  // Resolve the identity first, rather than joining sessions straight off the link. A gamertag is
  // a CURRENT LABEL since migration 0025, so a recycled name can match two `players` rows at
  // once; joining sessions across both would silently mix a departed holder's history into this
  // user's. Most-recently-seen wins, `id` ascending as the tie-break — the same rule
  // `getPlayer`, `resolveSlugMatch` and `shared-positions` all apply.
  const [viewer] = await db
    .select({ playerId: players.id })
    .from(gamertagLinks)
    .innerJoin(players, sql`lower(${players.gamertag}) = lower(${gamertagLinks.gamertag})`)
    .where(and(eq(gamertagLinks.userId, userId), eq(gamertagLinks.status, "verified")))
    .orderBy(desc(players.lastSeenAt), asc(players.id))
    .limit(1);

  if (!viewer) return null;

  const [row] = await db
    .select({ slug: servers.slug })
    .from(sessions)
    .innerJoin(
      servers,
      and(eq(servers.id, sessions.serverId), eq(servers.active, true), isNotNull(servers.slug)),
    )
    .where(eq(sessions.playerId, viewer.playerId))
    .orderBy(desc(sessions.connectedAt))
    .limit(1);

  return row?.slug ?? null;
}
