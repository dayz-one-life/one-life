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

  /**
   * The kill feed: whole `kills` rows, newest first, including `basis` and `credit_source`.
   *
   * ⚠️ A row with `basis: "trap_placement"` is a TRAP KILL (death-verdict spec 2.4): the log names
   * no killer, and `killerGamertag` is the player credited from where the tripwire or land mine was
   * placed (`creditSource` is "classifier", or "override" for an operator grant). It counts like any
   * kill. `basis` is the only marker and the server cannot enforce wording, so a renderer must use
   * "VICTIM · killed by a tripwire · kill credited to PLACER" ("a land mine" for weapon "Land mine"),
   * never "PLACER killed VICTIM", "PLACER's tripwire" or "confirmed kill". The type in
   * `@onelife/api-client` (`Kill`) says the same.
   */
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
