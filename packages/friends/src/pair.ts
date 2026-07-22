export const FRIEND_REQUEST_COOLDOWN_DAYS = 7;
export const FRIEND_REQUEST_DAILY_LIMIT = 20;

const DAY_MS = 86_400_000;

export type FriendshipRow = {
  id: number;
  userA: string;
  userB: string;
  status: string;
  requestedBy: string;
  requestSeq: number;
  createdAt: Date;
  respondedAt: Date | null;
  aSharesLocation: boolean;
  bSharesLocation: boolean;
  aSharesPresence: boolean;
  bSharesPresence: boolean;
};

/** What the viewer sees, never what column the data sits in. */
export type FriendStatus = "none" | "outgoing" | "incoming" | "friends" | "cooldown";

export type FriendView = {
  id: number;
  friendUserId: string;
  status: FriendStatus;
  createdAt: Date;
  respondedAt: Date | null;
  /** Set only when status is "cooldown". */
  cooldownUntil: Date | null;
  iShareLocation: boolean;
  theyShareLocation: boolean;
  iSharePresence: boolean;
  theySharePresence: boolean;
};

/**
 * Canonical ordering. The database CHECK enforces user_a < user_b, so every write must
 * come through here. `viewerIsA` tells the caller which side of the row it is, which is
 * the only place in the system that should ever need to know.
 */
export function orderPair(x: string, y: string): { userA: string; userB: string; viewerIsA: boolean } {
  const viewerIsA = x < y;
  return viewerIsA ? { userA: x, userB: y, viewerIsA } : { userA: y, userB: x, viewerIsA };
}

/** When a declined request may be re-sent. Null when the row is not a decline. */
export function cooldownEnd(row: Pick<FriendshipRow, "status" | "respondedAt">): Date | null {
  if (row.status !== "declined" || !row.respondedAt) return null;
  return new Date(row.respondedAt.getTime() + FRIEND_REQUEST_COOLDOWN_DAYS * DAY_MS);
}

/** Project a stored row into the viewer's perspective. Pure. */
export function viewOf(row: FriendshipRow, viewerId: string, now: Date): FriendView {
  const isA = row.userA === viewerId;
  const cd = cooldownEnd(row);
  let status: FriendStatus;
  if (row.status === "accepted") status = "friends";
  else if (row.status === "pending") status = row.requestedBy === viewerId ? "outgoing" : "incoming";
  else status = cd && cd > now ? "cooldown" : "none";

  return {
    id: row.id,
    friendUserId: isA ? row.userB : row.userA,
    status,
    createdAt: row.createdAt,
    respondedAt: row.respondedAt,
    cooldownUntil: status === "cooldown" ? cd : null,
    iShareLocation: isA ? row.aSharesLocation : row.bSharesLocation,
    theyShareLocation: isA ? row.bSharesLocation : row.aSharesLocation,
    iSharePresence: isA ? row.aSharesPresence : row.bSharesPresence,
    theySharePresence: isA ? row.bSharesPresence : row.aSharesPresence,
  };
}
