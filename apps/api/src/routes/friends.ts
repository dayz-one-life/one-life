import type { FastifyInstance, FastifyReply } from "fastify";
import type { Database } from "@onelife/db";
import type { Auth } from "@onelife/auth";
import { z } from "zod";
import {
  request, cancel, accept, decline, remove, setPresenceFlags, setLocationFlag,
  listFriends, statusFor, FriendError,
} from "@onelife/friends";
import { getSession } from "../auth-plugin.js";
import { verifiedUserIdByGamertag } from "./verified-gamertag.js";

const feedQuery = z.object({ page: z.coerce.number().int().positive().catch(1) });
const statusQuery = z.object({ gamertag: z.string().min(1) });
const requestBody = z.object({ toGamertag: z.string().min(1) });
const idParam = z.object({ id: z.coerce.number().int().positive() });
const presenceBody = z.object({
  share: z.boolean().optional(),
  notify: z.boolean().optional(),
  shareLocation: z.boolean().optional(),
});

const ERROR_STATUS: Record<string, number> = {
  self_request: 400,
  not_verified: 400,
  already_friends: 409,
  already_pending: 409,
  not_found: 404,
  not_recipient: 403,
  cooldown_active: 429,
  rate_limited: 429,
};

function onFriendError(e: unknown, reply: FastifyReply) {
  if (e instanceof FriendError) {
    return reply.code(ERROR_STATUS[e.code] ?? 400).send({ error: e.code, ...(e.detail ?? {}) });
  }
  throw e;
}

export function registerFriendRoutes(app: FastifyInstance, db: Database, auth: Auth): void {
  app.get("/me/friends", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const { page } = feedQuery.parse(req.query);
    return listFriends(db, { userId: session.user.id, page });
  });

  app.get("/me/friends/status", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const { gamertag } = statusQuery.parse(req.query);
    return statusFor(db, { userId: session.user.id, otherGamertag: gamertag });
  });

  app.post("/me/friends/requests", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const body = requestBody.parse(req.body);
    // The route resolves the gamertag to a user id — the domain's request() takes user ids
    // only — so the identity boundary and the notification body come from one row and cannot
    // disagree.
    const toUserId = await verifiedUserIdByGamertag(db, body.toGamertag);
    if (!toUserId) return reply.code(400).send({ error: "not_verified" });
    try {
      return await request(db, { fromUserId: session.user.id, toUserId });
    } catch (e) {
      return onFriendError(e, reply);
    }
  });

  for (const [verb, fn] of [["accept", accept], ["decline", decline]] as const) {
    app.post(`/me/friends/:id/${verb}`, async (req, reply) => {
      const session = await getSession(auth, req);
      if (!session) return reply.code(401).send({ error: "unauthorized" });
      const { id } = idParam.parse(req.params);
      try {
        await fn(db, { userId: session.user.id, friendshipId: id });
        return { ok: true };
      } catch (e) {
        return onFriendError(e, reply);
      }
    });
  }

  // One verb for both withdrawals: cancel a request you sent, remove a friend you have.
  // The domain decides which applies from the row's status.
  app.delete("/me/friends/:id", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const { id } = idParam.parse(req.params);
    const userId = session.user.id;
    try {
      try {
        await remove(db, { userId, friendshipId: id });
      } catch (e) {
        if (e instanceof FriendError && e.code === "not_found") {
          await cancel(db, { userId, friendshipId: id });
        } else throw e;
      }
      return { ok: true };
    } catch (e) {
      return onFriendError(e, reply);
    }
  });

  app.patch("/me/friends/:id/presence", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const { id } = idParam.parse(req.params);
    const body = presenceBody.parse(req.body ?? {});
    try {
      await setPresenceFlags(db, {
        userId: session.user.id, friendshipId: id, share: body.share, notify: body.notify,
      });
      if (body.shareLocation !== undefined) {
        await setLocationFlag(db, {
          userId: session.user.id, friendshipId: id, share: body.shareLocation,
        });
      }
      return { ok: true };
    } catch (e) {
      return onFriendError(e, reply);
    }
  });
}
