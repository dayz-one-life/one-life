import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import { z } from "zod";
import { getPlayerProfile, getPlayerLives, getLifeDetail, searchClaimableGamertags, searchVerifiedGamertags } from "@onelife/read-models";

const gamertagParams = z.object({ serverId: z.coerce.number().int().positive(), gamertag: z.string().min(1) });
const lifeParams = z.object({ serverId: z.coerce.number().int().positive(), lifeId: z.coerce.number().int().positive() });

export function registerPlayerRoutes(app: FastifyInstance, db: Database): void {
  app.get("/players/search", async (req) => {
    const q = z.object({ q: z.string() }).safeParse(req.query);
    const prefix = q.success ? q.data.q.trim() : "";
    if (prefix.length < 2) return [];
    return searchClaimableGamertags(db, prefix, 10);
  });

  app.get("/players/search/verified", async (req) => {
    const q = z.object({ q: z.string() }).safeParse(req.query);
    const prefix = q.success ? q.data.q.trim() : "";
    if (prefix.length < 2) return [];
    return searchVerifiedGamertags(db, prefix, 10);
  });

  app.get("/servers/:serverId/players/:gamertag", async (req, reply) => {
    const p = gamertagParams.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "bad_request" });
    const profile = await getPlayerProfile(db, p.data.serverId, p.data.gamertag, new Date());
    if (!profile) return reply.code(404).send({ error: "not_found" });
    return profile;
  });

  app.get("/servers/:serverId/players/:gamertag/lives", async (req, reply) => {
    const p = gamertagParams.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "bad_request" });
    const rows = await getPlayerLives(db, p.data.serverId, p.data.gamertag);
    if (rows === null) return reply.code(404).send({ error: "not_found" });
    return rows;
  });

  app.get("/servers/:serverId/lives/:lifeId", async (req, reply) => {
    const p = lifeParams.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "bad_request" });
    const detail = await getLifeDetail(db, p.data.serverId, p.data.lifeId);
    if (!detail) return reply.code(404).send({ error: "not_found" });
    return detail;
  });
}
