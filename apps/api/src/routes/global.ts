import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import { z } from "zod";
import { getGlobalRoster, getGlobalBoard, LEADERBOARDS } from "@onelife/read-models";

const boardParam = z.object({ board: z.enum(LEADERBOARDS) });

export function registerGlobalRoutes(app: FastifyInstance, db: Database): void {
  app.get("/roster", async () => getGlobalRoster(db, new Date()));

  app.get("/leaderboards/:board", async (req, reply) => {
    const p = boardParam.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "bad_request" });
    return getGlobalBoard(db, p.data.board, new Date(), 25);
  });
}
