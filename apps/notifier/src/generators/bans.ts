import { bans, gamertagLinks, servers } from "@onelife/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Generator, NotificationDraft } from "../types.js";
import { windowStart } from "../types.js";
import { playerSlug } from "./account.js";

/** Bans are keyed by gamertag; an inbox is keyed by user. The only bridge is a verified
 *  gamertag_links row, matched case-insensitively because ban rows carry whatever casing
 *  the ADM log used. */
const verifiedOwner = and(
  eq(gamertagLinks.status, "verified"),
  sql`lower(${gamertagLinks.gamertag}) = lower(${bans.gamertag})`,
);

export const banAppliedGenerator: Generator = async (deps) => {
  const from = windowStart(deps);
  const rows = await deps.db
    .select({
      id: bans.id, userId: gamertagLinks.userId, gamertag: gamertagLinks.gamertag,
      serverName: servers.name, expiresAt: bans.expiresAt,
    })
    .from(bans)
    .innerJoin(gamertagLinks, verifiedOwner)
    .innerJoin(servers, eq(servers.id, bans.serverId))
    // Window on created_at — the moment the ban row was written — NOT banned_at, which is the
    // DEATH time. If ingest/projector fall behind by more than the lookback, banned_at is already
    // outside the window when the ban lands and the player is never told they were banned.
    // No status filter: under ENFORCER_DRY_RUN (the production default) markApplied() is never
    // called, so rows sit at 'pending' forever and applied_at stays NULL — filtering on either
    // would be a clause that is always false in the configuration we actually run.
    .where(gte(bans.createdAt, from));

  return rows.map((r): NotificationDraft => ({
    userId: r.userId,
    kind: "ban_applied",
    naturalKey: `ban_applied:${r.id}`,
    title: "You died on a qualified life",
    body: `${r.serverName}: banned for 24 hours. Spend an unban token to come back early.`,
    href: `/players/${playerSlug(r.gamertag)}`,
  }));
};

export const banLiftedGenerator: Generator = async (deps) => {
  const from = windowStart(deps);
  const rows = await deps.db
    .select({
      id: bans.id, userId: gamertagLinks.userId, gamertag: gamertagLinks.gamertag,
      serverName: servers.name, status: bans.status,
    })
    .from(bans)
    .innerJoin(gamertagLinks, verifiedOwner)
    .innerJoin(servers, eq(servers.id, bans.serverId))
    // Window on lifted_at — the instant the player actually came back in — NOT expires_at, which
    // is only banned_at + BAN_DURATION_HOURS. expires_at both emits a spurious "You're back in"
    // for bans resolved before go-live and silently drops a ban the enforcer marked expired late.
    // lifted_at is non-null once status is expired|lifted (markExpired/markLifted, and redeem's
    // straight-to-lifted path), and both enforcer paths stamp it under dry-run too.
    .where(and(inArray(bans.status, ["expired", "lifted"]), gte(bans.liftedAt, from)));

  return rows.map((r): NotificationDraft => ({
    userId: r.userId,
    kind: "ban_lifted",
    naturalKey: `ban_lifted:${r.id}`,
    title: "You're back in",
    body: r.status === "lifted"
      ? `${r.serverName}: your token was spent and the ban is lifted.`
      : `${r.serverName}: your ban has expired. Go start a new life.`,
    href: `/players/${playerSlug(r.gamertag)}`,
  }));
};
