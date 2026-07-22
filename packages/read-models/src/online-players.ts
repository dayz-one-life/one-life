import type { Database } from "@onelife/db";
import { friendships, gamertagLinks, players, positions, sessions } from "@onelife/db";
import { and, eq, gte, isNull, or, sql } from "drizzle-orm";
import type { FriendPosition } from "./friend-positions.js";

/**
 * How recently a player must have been seen ON THIS SERVER to count as online here.
 *
 * ⚠️ An open session is NOT evidence that someone is playing. `sessions.disconnected_at` stays
 * NULL for a crashed client until the next even-hour reboot closes it (apps/rebooter restarts
 * every active server every 2h), so a bare `disconnected_at IS NULL` list shows players who
 * left up to two hours ago — stale state presented as current. Same bound as the map's markers
 * and the presence generator.
 *
 * ⚠️ The evidence must be PER SERVER, which is why this is not a `players.last_seen_at` test.
 * That column is GLOBAL — one row per player across every server (`packages/db/src/schema.ts`,
 * written by `touchPlayer` in `packages/projections/src/fold.ts`) — and `onConnected` only
 * closes a dangling session on the server being connected TO. So the exact case this bound
 * exists for defeats it: crash on Sakhal at 12:00 (Sakhal session stays open), hop to Chernarus
 * at 12:05 and play for an hour, and Chernarus activity keeps the GLOBAL heartbeat fresh — the
 * player is listed as online on Sakhal until Sakhal's next reboot. Server-hopping after a crash
 * is ordinary recovery behaviour, not a corner case.
 *
 * The per-server evidence is a fresh `positions` row on this server (the fold treats a position
 * dump as the presence heartbeat, so the ADM's periodic player-list block writes one for every
 * connected player — the same premise F2's markers already rely on), OR a session that
 * CONNECTED within the bound, which covers the gap before a freshly-joined player's first dump.
 * Both imply a fresh `players.last_seen_at`, since the same fold calls touch it, so the old
 * global check added nothing on top and was removed.
 */
export const ONLINE_MAX_AGE_SECONDS = 900;

export interface OnlinePlayer {
  gamertag: string;
  friend: boolean;
  sharing: boolean;
  self: boolean;
}

/**
 * Everyone currently on one server, as the viewer sees them.
 *
 * ⚠️ This publishes WHO IS ONLINE regardless of the F3 presence switches — a deliberate policy
 * decision (spec §2): DayZ's own in-game menu already lists everyone connected, so gating this
 * protects nothing while making our list look broken. Those switches now govern notifications
 * only. WHERE someone is stays consent-gated and is not computed here.
 *
 * Like every /me map read-model, the subject set comes from the session; there is no player
 * identifier to pass.
 */
export async function getOnlinePlayers(
  db: Database,
  a: { viewerUserId: string; serverId: number; now: Date; positions: FriendPosition[] },
): Promise<OnlinePlayer[]> {
  const freshest = new Date(a.now.getTime() - ONLINE_MAX_AGE_SECONDS * 1000);

  const rows = await db
    .selectDistinct({ gamertag: players.gamertag })
    .from(sessions)
    .innerJoin(players, eq(players.id, sessions.playerId))
    .where(and(
      eq(sessions.serverId, a.serverId),
      isNull(sessions.disconnectedAt),
      or(
        // Just joined — no position dump has landed for them yet.
        gte(sessions.connectedAt, freshest),
        // Seen on THIS server within the bound. Shaped as (server_id, player_id, recorded_at)
        // so it is served by `positions_player_idx` end-to-end (F2 invariant 7); the timestamp
        // goes in as `.toISOString()` because a raw SQL template bypasses drizzle's column
        // mapping and postgres-js's timestamptz encoder crashes on a bare Date there.
        sql`EXISTS (
          SELECT 1 FROM ${positions} pos
          WHERE pos.server_id = ${a.serverId}
            AND pos.player_id = ${players.id}
            AND pos.recorded_at >= ${freshest.toISOString()}
        )`,
      ),
    ));

  // The viewer's own verified gamertag, and their accepted friends' — both compared with
  // lower(), matching every other gamertag comparison in this package.
  const [viewer] = await db
    .select({ gamertag: gamertagLinks.gamertag })
    .from(gamertagLinks)
    .where(and(
      eq(gamertagLinks.userId, a.viewerUserId),
      eq(gamertagLinks.status, "verified"),
    ))
    .limit(1);

  const friendRows = await db
    .select({ gamertag: gamertagLinks.gamertag })
    .from(friendships)
    .innerJoin(gamertagLinks, and(
      eq(gamertagLinks.status, "verified"),
      or(
        and(eq(friendships.userA, a.viewerUserId), eq(gamertagLinks.userId, friendships.userB)),
        and(eq(friendships.userB, a.viewerUserId), eq(gamertagLinks.userId, friendships.userA)),
      ),
    ))
    .where(and(
      eq(friendships.status, "accepted"),
      or(eq(friendships.userA, a.viewerUserId), eq(friendships.userB, a.viewerUserId)),
    ));

  const lower = (s: string) => s.toLowerCase();
  const selfTag = viewer ? lower(viewer.gamertag) : null;
  const friends = new Set(friendRows.map((r) => lower(r.gamertag)));
  // Derived from the payload's own positions — never a second consent evaluation, so the list
  // and the dots can never contradict each other.
  const sharing = new Set(a.positions.map((p) => lower(p.gamertag)));

  const out: OnlinePlayer[] = rows.map((r) => ({
    gamertag: r.gamertag,
    self: selfTag !== null && lower(r.gamertag) === selfTag,
    friend: friends.has(lower(r.gamertag)),
    sharing: sharing.has(lower(r.gamertag)),
  }));

  // Ordering lives HERE, not in the component: the accessible legend and any future surface
  // want the same order, and a rule split across renderers drifts.
  const rank = (p: OnlinePlayer) =>
    p.self ? 0 : p.friend && p.sharing ? 1 : p.friend ? 2 : p.sharing ? 3 : 4;
  return out.sort((x, y) =>
    rank(x) - rank(y) || x.gamertag.localeCompare(y.gamertag),
  );
}
