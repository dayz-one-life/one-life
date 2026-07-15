import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import { z } from "zod";
import { getPlayerPage, getLifeDetail, getPlayerLives, resolveGamertagBySlug, getLifeCharacter } from "@onelife/read-models";
import { resolveServerBySlug } from "../lib/resolve-server.js";

const gt = z.object({ gamertag: z.string().min(1) });
// `map` is a server slug, resolved via resolveServerBySlug (which 404s on an unknown
// slug). It is NOT constrained to a fixed map list here — new servers (e.g. Livonia)
// must work without editing this route.
const life = z.object({ gamertag: z.string().min(1), map: z.string().min(1), n: z.coerce.number().int().positive() });
const pageQ = z.object({ page: z.coerce.number().int().positive().catch(1) });

export function registerPlayerAggregateRoutes(app: FastifyInstance, db: Database): void {
  app.get("/players/:gamertag", async (req, reply) => {
    const p = gt.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "bad_request" });
    const { page } = pageQ.parse(req.query);
    const pg = await getPlayerPage(db, p.data.gamertag, new Date(), { page });
    if (!pg) return reply.code(404).send({ error: "not_found" });
    return pg;
  });

  app.get("/players/:gamertag/:map/lives/:n", async (req, reply) => {
    const p = life.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "bad_request" });
    const server = await resolveServerBySlug(db, p.data.map);
    if (!server) return reply.code(404).send({ error: "not_found" });
    const real = await resolveGamertagBySlug(db, p.data.gamertag);
    if (!real) return reply.code(404).send({ error: "not_found" });
    const rows = await getPlayerLives(db, server.id, real);
    const match = rows?.find((l) => l.lifeNumber === p.data.n);
    if (!match) return reply.code(404).send({ error: "not_found" });
    const detail = await getLifeDetail(db, server.id, match.id);
    if (!detail) return reply.code(404).send({ error: "not_found" });
    const character = await getLifeCharacter(db, server.id, real, detail.life.startedAt, detail.life.endedAt);
    return { ...detail, character };
  });
}
