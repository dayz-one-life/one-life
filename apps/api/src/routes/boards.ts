import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import { z } from "zod";
import { getLeaderboard, LEADERBOARDS, getKillFeed, getBuildFeed } from "@onelife/read-models";

const boardParams = z.object({
  serverId: z.coerce.number().int().positive(),
  board: z.enum(LEADERBOARDS),
});
const feedQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  gamertag: z.string().min(1).optional(),
});
const serverParam = z.object({ serverId: z.coerce.number().int().positive() });

export function registerBoardRoutes(app: FastifyInstance, db: Database): void {
  app.get("/servers/:serverId/leaderboards/:board", async (req, reply) => {
    const p = boardParams.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "bad_request", message: "unknown board" });
    const q = feedQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "bad_request" });
    return getLeaderboard(db, p.data.serverId, p.data.board, new Date(), q.data.limit);
  });

  app.get("/servers/:serverId/kills", async (req, reply) => {
    const p = serverParam.safeParse(req.params);
    const q = feedQuery.safeParse(req.query);
    if (!p.success || !q.success) return reply.code(400).send({ error: "bad_request" });
    return getKillFeed(db, p.data.serverId, q.data.limit, q.data.offset);
  });

  app.get("/servers/:serverId/builds", async (req, reply) => {
    const p = serverParam.safeParse(req.params);
    const q = feedQuery.safeParse(req.query);
    if (!p.success || !q.success) return reply.code(400).send({ error: "bad_request" });
    return getBuildFeed(db, p.data.serverId, { gamertag: q.data.gamertag, limit: q.data.limit, offset: q.data.offset });
  });
}
