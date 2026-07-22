import type { Database } from "@onelife/db";
import { friendships, gamertagLinks } from "@onelife/db";
import { and, eq, inArray, or, sql as dsql } from "drizzle-orm";
import { orderPair, viewOf, type FriendStatus, type FriendshipRow } from "./pair.js";
import { playerSlug } from "./notify.js";

export const FRIENDS_PAGE_SIZE = 25;

export type FriendEntry = {
  id: number;
  gamertag: string;
  slug: string;
  status: FriendStatus;
  since: Date;
};

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
  total: number; page: number; pageSize: number;
}> {
  const now = a.now ?? new Date();
  const page = Math.max(1, a.page ?? 1);
  const pageSize = a.pageSize ?? FRIENDS_PAGE_SIZE;

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

  const entry = (v: (typeof views)[number]): FriendEntry | null => {
    const gamertag = tags.get(v.view.friendUserId);
    // A friend whose link was released by an admin has no verified gamertag left; they are
    // unreachable and unnameable, so they drop out of the roster rather than render blank.
    if (!gamertag) return null;
    return {
      id: v.view.id, gamertag, slug: playerSlug(gamertag),
      status: v.view.status, since: v.view.createdAt,
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
