import type { FastifyInstance, FastifyReply } from "fastify";
import type { Database } from "@onelife/db";
import type { Auth } from "@onelife/auth";
import { tokenTransactions, gamertagLinks } from "@onelife/db";
import { and, eq, desc, sql as dsql } from "drizzle-orm";
import { z } from "zod";
import { getBalance, redeem, transfer, setReferrer, TokenError } from "@onelife/tokens";
import { getSession } from "../auth-plugin.js";

const redeemBody = z.object({ banId: z.number().int().positive().optional() });
const transferBody = z.object({ toGamertag: z.string().min(1) });
const referrerBody = z.object({ referrerGamertag: z.string().min(1) });

/** Resolve a gamertag to its verified owner's userId; null when nobody verified holds it. */
async function verifiedUserIdByGamertag(db: Database, gamertag: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: gamertagLinks.userId })
    .from(gamertagLinks)
    .where(and(eq(gamertagLinks.status, "verified"), dsql`lower(${gamertagLinks.gamertag}) = lower(${gamertag})`))
    .limit(1);
  return row?.userId ?? null;
}

const ERROR_STATUS: Record<string, number> = {
  no_active_ban: 400,
  insufficient_tokens: 400,
  not_owner: 403,
  not_verified: 400,
  self_transfer: 400,
  self_referral: 400,
  already_set: 409,
};

function onTokenError(e: unknown, reply: FastifyReply) {
  if (e instanceof TokenError) return reply.code(ERROR_STATUS[e.code] ?? 400).send({ error: e.code });
  throw e;
}

export function registerTokenRoutes(app: FastifyInstance, db: Database, auth: Auth): void {
  app.get("/me/tokens", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const userId = session.user.id;
    const [balance, transactions] = await Promise.all([
      getBalance(db, userId),
      db
        .select({ id: tokenTransactions.id, delta: tokenTransactions.delta, kind: tokenTransactions.kind, createdAt: tokenTransactions.createdAt })
        .from(tokenTransactions)
        .where(eq(tokenTransactions.userId, userId))
        .orderBy(desc(tokenTransactions.id))
        .limit(50),
    ]);
    return { balance, transactions };
  });

  app.post("/me/tokens/redeem", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const body = redeemBody.parse(req.body ?? {});
    try {
      const lifted = await redeem(db, { userId: session.user.id, banId: body.banId });
      return { lifted };
    } catch (e) {
      return onTokenError(e, reply);
    }
  });

  app.post("/me/tokens/transfer", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const body = transferBody.parse(req.body);
    const toUserId = await verifiedUserIdByGamertag(db, body.toGamertag);
    if (!toUserId) return reply.code(400).send({ error: "not_verified" });
    try {
      await transfer(db, { fromUserId: session.user.id, toUserId });
      return { ok: true };
    } catch (e) {
      return onTokenError(e, reply);
    }
  });

  app.post("/me/referrer", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const body = referrerBody.parse(req.body);
    const referrerUserId = await verifiedUserIdByGamertag(db, body.referrerGamertag);
    if (!referrerUserId) return reply.code(400).send({ error: "not_verified" });
    try {
      await setReferrer(db, { userId: session.user.id, referrerUserId });
      return { ok: true };
    } catch (e) {
      return onTokenError(e, reply);
    }
  });
}
