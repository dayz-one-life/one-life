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
    .where(and(eq(bans.status, "applied"), gte(bans.bannedAt, from)));

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
    .where(and(inArray(bans.status, ["expired", "lifted"]), gte(bans.expiresAt, from)));

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
