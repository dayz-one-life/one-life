import { friendships, gamertagLinks, notifications, players, servers, sessions, userPreferences } from "@onelife/db";
import {
  escapeLikePattern, shouldNotifyPresence,
  FRIEND_ONLINE_COOLDOWN_HOURS, FRIEND_ONLINE_MAX_AGE_MINUTES,
} from "@onelife/friends";
import { and, eq, gte, isNotNull, or, sql } from "drizzle-orm";
import type { Generator, NotificationDraft } from "../types.js";
import { windowStart } from "../types.js";
import { playerSlug } from "./account.js";

/**
 * Rebuild-stable. Deliberately NOT keyed on sessions.id: apps/projector/src/rebuild.ts
 * truncates `sessions` WITH RESTART IDENTITY while `notifications` is never truncated, so
 * session ids are reassigned across a rebuild and a legitimate connect would collide with a
 * stale key and silently notify nobody — the hazard already flagged in a comment at the
 * notifications table for keys embedding lives.id.
 *
 * The timestamp comes from toISOString() in TypeScript, never a SQL to_char(): a format that
 * drifted from JS would make the dedupe a silent no-op and re-notify forever.
 */
export function presenceNaturalKey(
  observerUserId: string, subjectGamertag: string, connectedAt: Date,
): string {
  return `friend_online:${observerUserId}:${subjectGamertag}:${connectedAt.toISOString()}`;
}

/** Codename → display label, mirroring apps/web's mapLabel. Unknown codenames title-case. */
const MAP_LABELS: Record<string, string> = {
  chernarusplus: "Chernarus",
  sakhal: "Sakhal",
  enoch: "Livonia",
};
function mapLabel(map: string): string {
  return MAP_LABELS[map] ?? (map.charAt(0).toUpperCase() + map.slice(1));
}

type Candidate = {
  observerUserId: string;
  subjectGamertag: string;
  connectedAt: Date;
  map: string;
  status: string;
  masterShare: boolean;
  pairShare: boolean;
  pairNotify: boolean;
};

/**
 * Every recent connect by a verified player on an active slugged server, paired with each
 * friend who might hear about it and the three flags that decide whether they do.
 *
 * The join carries BOTH sides' flags because which physical column belongs to the subject
 * depends on which side of the canonically-ordered pair they are.
 *
 * Not gated on life qualification — unlike the survivors board, the enforcer and the
 * newsdesk. "My friend is playing" is true whether or not their life has earned a
 * leaderboard place, and gating would silently skip fresh spawns, which is exactly when
 * people want to group up.
 */
async function candidates(deps: Parameters<Generator>[0]): Promise<Candidate[]> {
  const from = windowStart(deps);
  const freshest = new Date(deps.now.getTime() - FRIEND_ONLINE_MAX_AGE_MINUTES * 60_000);
  const lower = from > freshest ? from : freshest;

  const rows = await deps.db
    .select({
      connectedAt: sessions.connectedAt,
      map: servers.map,
      subjectGamertag: gamertagLinks.gamertag,
      subjectUserId: gamertagLinks.userId,
      userA: friendships.userA,
      userB: friendships.userB,
      status: friendships.status,
      aShares: friendships.aSharesPresence,
      bShares: friendships.bSharesPresence,
      aNotify: friendships.aNotifyPresence,
      bNotify: friendships.bNotifyPresence,
      masterShare: userPreferences.sharePresence,
    })
    .from(sessions)
    .innerJoin(servers, eq(servers.id, sessions.serverId))
    .innerJoin(players, eq(players.id, sessions.playerId))
    .innerJoin(gamertagLinks, and(
      eq(gamertagLinks.status, "verified"),
      sql`lower(${gamertagLinks.gamertag}) = lower(${players.gamertag})`,
    ))
    .innerJoin(friendships, or(
      eq(friendships.userA, gamertagLinks.userId),
      eq(friendships.userB, gamertagLinks.userId),
    ))
    .leftJoin(userPreferences, eq(userPreferences.userId, gamertagLinks.userId))
    .where(and(
      gte(sessions.connectedAt, lower),
      eq(servers.active, true),
      isNotNull(servers.slug),
    ));

  return rows.map((r) => {
    const subjectIsA = r.userA === r.subjectUserId;
    return {
      observerUserId: subjectIsA ? r.userB : r.userA,
      subjectGamertag: r.subjectGamertag,
      connectedAt: r.connectedAt,
      map: r.map,
      status: r.status,
      // A missing preferences row means defaults, and the default is OFF.
      masterShare: r.masterShare ?? false,
      pairShare: subjectIsA ? r.aShares : r.bShares,
      pairNotify: subjectIsA ? r.bNotify : r.aNotify,
    };
  });
}

/**
 * True when this observer was already told about this subject inside the cooldown.
 *
 * The cooldown lives in the durable notification rows, not a counter column — a column can
 * desynchronise from reality, which is how the sibling rate limit shipped broken once.
 *
 * The prefix is escaped and matched with LIKE so it uses notifications_natural_key_pattern_idx
 * (text_pattern_ops). Do NOT "simplify" to starts_with(): it is not index-usable and will
 * seq-scan a table growing across every other notification kind.
 */
async function recentlyNotified(
  deps: Parameters<Generator>[0], observerUserId: string, subjectGamertag: string,
): Promise<boolean> {
  const since = new Date(deps.now.getTime() - FRIEND_ONLINE_COOLDOWN_HOURS * 3600_000);
  const prefix = escapeLikePattern(`friend_online:${observerUserId}:${subjectGamertag}:`);
  const [row] = await deps.db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(
      sql`${notifications.naturalKey} LIKE ${prefix} || '%'`,
      gte(notifications.createdAt, since),
    ))
    .limit(1);
  return !!row;
}

export const presenceGenerator: Generator = async (deps) => {
  const rows = await candidates(deps);
  const drafts: NotificationDraft[] = [];
  const seen = new Set<string>();

  for (const c of rows) {
    if (!shouldNotifyPresence(c)) continue;
    const key = presenceNaturalKey(c.observerUserId, c.subjectGamertag, c.connectedAt);
    // Intra-tick dedupe: two connects by one subject inside the window would otherwise both
    // pass the cooldown check, which reads only committed rows.
    const pairKey = `${c.observerUserId}:${c.subjectGamertag}`;
    if (seen.has(pairKey)) continue;
    if (await recentlyNotified(deps, c.observerUserId, c.subjectGamertag)) continue;
    seen.add(pairKey);
    drafts.push({
      userId: c.observerUserId,
      kind: "friend_online",
      naturalKey: key,
      title: "Friend online",
      body: `${c.subjectGamertag} is on ${mapLabel(c.map)}.`,
      href: `/players/${playerSlug(c.subjectGamertag)}`,
    });
  }
  return drafts;
};
