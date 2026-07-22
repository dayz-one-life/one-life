import type { Database } from "@onelife/db";
import { friendships, gamertagLinks, players, sessions } from "@onelife/db";
import { and, eq, gte, isNull, or } from "drizzle-orm";
import type { FriendPosition } from "./friend-positions.js";

/**
 * How recently a player must have been seen to count as online.
 *
 * ⚠️ An open session is NOT evidence that someone is playing. `sessions.disconnected_at` stays
 * NULL for a crashed client until the next even-hour reboot closes it (apps/rebooter restarts
 * every active server every 2h), so a bare `disconnected_at IS NULL` list shows players who
 * left up to two hours ago — stale state presented as current. Same bound as the map's markers
 * and the presence generator.
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
      gte(players.lastSeenAt, freshest),
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
