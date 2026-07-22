import type { Database } from "@onelife/db";
import { friendships, gamertagLinks, userPreferences } from "@onelife/db";
import { and, eq, inArray, or, sql as dsql } from "drizzle-orm";
import { orderPair, viewOf, type FriendStatus, type FriendshipRow } from "./pair.js";
import { playerSlug } from "./notify.js";
import { getSharePresence } from "./presence.js";
import { getShareLocation, shouldShareLocation } from "./location.js";

export const FRIENDS_PAGE_SIZE = 25;

export type FriendEntry = {
  id: number;
  gamertag: string;
  slug: string;
  status: FriendStatus;
  since: Date;
  sharesPresence: boolean;
  notifyPresence: boolean;
  /** The viewer's own per-pair flag. */
  sharesLocation: boolean;
  /**
   * Whether the OTHER party's location is effectively visible to the viewer — their master
   * switch AND their per-pair flag, collapsed to one boolean.
   *
   * ⚠️ DELIBERATELY UNDIFFERENTIATED. It must never distinguish "their master switch is off"
   * from "they have hidden from you specifically". Differentiating would have the app tell one
   * player that a named friend singled them out, which makes the per-friend hide switch a
   * visible act and therefore unusable. This is also the ONE place this codebase reports
   * anything about another user's settings — presence deliberately reports none. Do not
   * generalise it.
   */
  theyShareLocation: boolean;
};

/** The share_location master switch for a set of users. Absent row ⇒ false. */
async function shareLocationFor(db: Database, userIds: string[]): Promise<Map<string, boolean>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ userId: userPreferences.userId, shareLocation: userPreferences.shareLocation })
    .from(userPreferences)
    .where(inArray(userPreferences.userId, userIds));
  return new Map(rows.map((r) => [r.userId, r.shareLocation]));
}

/** The verified gamertag for each of a set of user ids. */
async function gamertagsFor(db: Database, userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ userId: gamertagLinks.userId, gamertag: gamertagLinks.gamertag })
    .from(gamertagLinks)
    .where(and(
      eq(gamertagLinks.status, "verified"),
      inArray(gamertagLinks.userId, userIds),
    ));
  return new Map(rows.map((r) => [r.userId, r.gamertag]));
}

/**
 * The viewer's roster, split three ways. Declined rows appear in none of the buckets —
 * they exist only to hold the cooldown clock.
 *
 * Only `friends` is paginated: incoming and outgoing are bounded in practice (a pending
 * request is transient, and outgoing is capped at 20/day by the rate limit).
 */
export async function listFriends(
  db: Database,
  a: { userId: string; now?: Date; page?: number; pageSize?: number },
): Promise<{
  friends: FriendEntry[]; incoming: FriendEntry[]; outgoing: FriendEntry[];
  total: number; page: number; pageSize: number; sharePresence: boolean; shareLocation: boolean;
}> {
  const now = a.now ?? new Date();
  const page = Math.max(1, a.page ?? 1);
  const pageSize = a.pageSize ?? FRIENDS_PAGE_SIZE;
  const sharePresence = await getSharePresence(db, a.userId);
  const shareLocation = await getShareLocation(db, a.userId);

  const rows = (await db
    .select()
    .from(friendships)
    .where(and(
      or(eq(friendships.userA, a.userId), eq(friendships.userB, a.userId)),
      dsql`${friendships.status} in ('pending','accepted')`,
    ))
    .orderBy(dsql`${friendships.createdAt} desc`, dsql`${friendships.id} desc`)) as FriendshipRow[];

  const views = rows.map((r) => ({ row: r, view: viewOf(r, a.userId, now) }));
  const tags = await gamertagsFor(db, views.map((v) => v.view.friendUserId));
  const masters = await shareLocationFor(db, views.map((v) => v.view.friendUserId));

  const entry = (v: (typeof views)[number]): FriendEntry | null => {
    const gamertag = tags.get(v.view.friendUserId);
    // A friend whose link was released by an admin has no verified gamertag left; they are
    // unreachable and unnameable, so they drop out of the roster rather than render blank.
    //
    // ⚠️ PREREQUISITE for the location-sharing sub-project: the underlying friendships row
    // (and its four a/b_shares_location/presence columns) is NOT deleted here — it merely
    // becomes unreachable, since no surface can reach it (hidden from the roster, the
    // dossier control is gated on the target being verified, and the user does not know the
    // friendship id). If that user later re-verifies, the friendship silently reappears with
    // its sharing flags intact. Inert today because F1 writes nothing into those columns, but
    // once location sharing ships this is a live consent leak, contradicting the design's
    // "after remove, no consent survives" claim (spec §3) for a case remove() was never
    // asked about. Before location sharing ships, resolve this one of two ways: (a) make a
    // drop-out row removable/severable so it can't silently return sharing flags intact, or
    // (b) clear the sharing flags when a gamertag link is released. Needs a product decision,
    // not a default — not attempted in this pass.
    if (!gamertag) return null;
    return {
      id: v.view.id, gamertag, slug: playerSlug(gamertag),
      status: v.view.status, since: v.view.createdAt,
      sharesPresence: v.view.iSharePresence,
      notifyPresence: v.view.iNotifyPresence,
      sharesLocation: v.view.iShareLocation,
      theyShareLocation: shouldShareLocation({
        status: v.row.status,
        masterShare: masters.get(v.view.friendUserId) ?? false,
        pairShare: v.view.theyShareLocation,
      }),
    };
  };
  const bucket = (s: FriendStatus) =>
    views.filter((v) => v.view.status === s).map(entry).filter((e): e is FriendEntry => e !== null);

  const friends = bucket("friends");
  return {
    friends: friends.slice((page - 1) * pageSize, page * pageSize),
    incoming: bucket("incoming"),
    outgoing: bucket("outgoing"),
    total: friends.length,
    page,
    pageSize,
    sharePresence,
    shareLocation,
  };
}

/**
 * The viewer's relationship with one gamertag — what FriendButton renders from.
 *
 * A gamertag nobody has verified is "none", not an error: the control simply does not
 * render, and an unclaimed profile is a perfectly ordinary page to be looking at.
 */
export async function statusFor(
  db: Database,
  a: { userId: string; otherGamertag: string; now?: Date },
): Promise<{ status: FriendStatus; friendshipId: number | null; cooldownUntil: Date | null }> {
  const now = a.now ?? new Date();
  const none = { status: "none" as const, friendshipId: null, cooldownUntil: null };

  const [owner] = await db
    .select({ userId: gamertagLinks.userId })
    .from(gamertagLinks)
    .where(and(
      eq(gamertagLinks.status, "verified"),
      dsql`lower(${gamertagLinks.gamertag}) = lower(${a.otherGamertag})`,
    ))
    .limit(1);
  if (!owner || owner.userId === a.userId) return none;

  const { userA, userB } = orderPair(a.userId, owner.userId);
  const [row] = (await db
    .select()
    .from(friendships)
    .where(and(eq(friendships.userA, userA), eq(friendships.userB, userB)))
    .limit(1)) as FriendshipRow[];
  if (!row) return none;

  const v = viewOf(row, a.userId, now);
  if (v.status === "none") return none;
  return { status: v.status, friendshipId: v.id, cooldownUntil: v.cooldownUntil };
}
