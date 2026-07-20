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

/**
 * A dry-run ban row is bookkeeping, not a punishment — and BOTH generators filter on it.
 *
 * ENFORCER_DRY_RUN defaults to `true` and that is how production runs. In that mode
 * apps/enforcer/src/tick.ts inserts the ban row and then `continue`s: nothing is ever
 * written to Nitrado and the player is not banned. Telling them "banned for 24 hours,
 * spend an unban token to come back early" announces a punishment that was never
 * inflicted — and the invitation is not idle, because packages/tokens/src/redeem.ts
 * selects on `status IN ('pending','applied')` with no dry_run predicate of its own. A
 * redeem against a dry-run row really does burn a token, on a ban that does not exist.
 *
 * ban_lifted carries the same filter for its own reason, not by copy-paste: a lift is
 * only news because the ban it ends was real. "You're back in" for a ban that never kept
 * anyone out is the same false claim as the apply case, just cheerful.
 *
 * CONSEQUENCE — and the reason this will look broken to a future reader: while the
 * enforcer runs in dry-run, ban notifications do not fire AT ALL. That is the intended
 * behaviour, not a regression: nobody is being banned, so nobody is told they were. Do
 * not delete this filter to "restore" the missing notifications. Set ENFORCER_DRY_RUN=false
 * and they start firing on their own, for bans that are actually being enforced.
 */
const realBan = eq(bans.dryRun, false);

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
    // No status/applied_at filter: status tracks DELIVERY to Nitrado, which is retried — a row
    // sits at 'pending' between insert and the apply loop, and returns to 'error' whenever a
    // Nitrado call fails. Gating on 'applied' would delay or drop the notification for a ban
    // the platform has already decided on and already started the 24h clock for. `realBan` is
    // the predicate that separates a ban we intend to enforce from one we never will.
    .where(and(realBan, gte(bans.createdAt, from)));

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
    // lifted_at is non-null once status is expired|lifted, stamped by markExpired, markLifted,
    // or redeem's straight-to-lifted path.
    //
    // Reachability, stated accurately: under ENFORCER_DRY_RUN the apply loop `continue`s before
    // markApplied, so no ban ever reaches status='applied', appliedBans() is always empty and
    // markExpired never runs. redeem sends a never-applied ban straight to 'lifted' itself, so
    // nothing reaches 'lift_pending' and markLifted never runs either. In production today
    // **only redeem's path stamps lifted_at** — neither enforcer path is reachable. (An earlier
    // version of this comment claimed both enforcer paths stamp it under dry-run; that is true
    // of the functions and false of the code that can actually call them.) With `realBan`
    // excluding dry-run rows above, this is now moot for THIS query — but it is why the
    // enforcer's expiry sweep looks dead in the logs, which is worth not rediscovering.
    .where(and(realBan, inArray(bans.status, ["expired", "lifted"]), gte(bans.liftedAt, from)));

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
