import { gamertagLinks, tokenTransactions } from "@onelife/db";
import { and, eq, gte, inArray } from "drizzle-orm";
import type { Generator, NotificationDraft } from "../types.js";
import { windowStart } from "../types.js";

/** Mirror of apps/web/src/lib/slug.ts playerSlug — kept local so the worker does not
 *  depend on the web app. Both must stay in step or notification links 404. */
export function playerSlug(gamertag: string): string {
  return gamertag.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Unlike the ban/life/article generators, the `verified` predicate here is NOT the thing
 * holding the privacy boundary up — and no test can prove it is, which is why there isn't
 * one. A pending link has `verified_at IS NULL`, and `verified_at >= from` is NULL (never
 * true) for those rows, so the window clause alone already excludes them; deleting the
 * status check leaves the whole suite green because it changes no result. It is kept as a
 * statement of intent, and because it stops the query depending on the NULL semantics of a
 * column a future migration might backfill.
 *
 * The other generators are the opposite: there the predicate is load-bearing and its
 * removal is caught by a pending-link fixture in each of their test files.
 */
export const gamertagVerifiedGenerator: Generator = async (deps) => {
  const from = windowStart(deps);
  const rows = await deps.db
    .select({ id: gamertagLinks.id, userId: gamertagLinks.userId, gamertag: gamertagLinks.gamertag })
    .from(gamertagLinks)
    .where(and(eq(gamertagLinks.status, "verified"), gte(gamertagLinks.verifiedAt, from)));

  return rows.map((r): NotificationDraft => ({
    userId: r.userId,
    kind: "gamertag_verified",
    naturalKey: `gamertag_verified:${r.id}`,
    title: "Gamertag verified",
    body: `${r.gamertag} is yours. Your lives are now tracked.`,
    href: `/players/${playerSlug(r.gamertag)}`,
  }));
};

const GRANT_KINDS = ["monthly", "referral", "verification"] as const;

const GRANT_BODY: Record<string, string> = {
  monthly: "Your monthly unban token landed.",
  referral: "A referral paid out — one unban token.",
  verification: "Verification bonus — one unban token.",
};

export const tokensGenerator: Generator = async (deps) => {
  const from = windowStart(deps);
  const rows = await deps.db
    .select({ id: tokenTransactions.id, userId: tokenTransactions.userId, kind: tokenTransactions.kind })
    .from(tokenTransactions)
    .where(and(
      gte(tokenTransactions.createdAt, from),
      inArray(tokenTransactions.kind, [...GRANT_KINDS, "transfer_in"]),
    ));

  return rows.map((r): NotificationDraft => {
    const received = r.kind === "transfer_in";
    return {
      userId: r.userId,
      kind: received ? "tokens_received" : "tokens_granted",
      naturalKey: `tokens:${r.id}`,
      title: received ? "Token received" : "Token granted",
      body: received ? "Another survivor sent you an unban token." : (GRANT_BODY[r.kind] ?? "You received an unban token."),
      href: "/",
    };
  });
};
