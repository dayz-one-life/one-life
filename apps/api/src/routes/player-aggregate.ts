import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import { z } from "zod";
import {
  getPlayerPage,
  getPlayerLives,
  resolveGamertagBySlug,
  getLifeTimeline,
  getPlayerArticles,
  PLAYER_ARTICLES_PAGE_SIZE,
} from "@onelife/read-models";
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
    const data = await getLifeTimeline(db, server.id, real, match.id);
    if (!data) return reply.code(404).send({ error: "not_found" });
    return { ...data, gamertag: real, map: server.map, slug: server.slug };
  });

  // An unknown gamertag is a normal state here (a player the paper has never written about),
  // not a 404 — unlike the routes above, which 404 on an unresolvable identity/life.
  app.get("/players/:gamertag/articles", async (req, reply) => {
    const p = gt.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "bad_request" });
    const { page } = pageQ.parse(req.query);
    const real = await resolveGamertagBySlug(db, p.data.gamertag);
    if (!real) return { rows: [], total: 0, page, pageSize: PLAYER_ARTICLES_PAGE_SIZE };
    return getPlayerArticles(db, real, { page });
  });
}
