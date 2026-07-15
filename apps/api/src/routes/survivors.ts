import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import { z } from "zod";
import { getAliveSurvivors } from "@onelife/read-models";
import { resolveServerBySlug } from "../lib/resolve-server.js";

const query = z.object({
  sort: z.enum(["kills", "time", "longest"]).catch("kills"),
  page: z.coerce.number().int().positive().catch(1),
});

const params = z.object({ slug: z.string().min(1) });

export function registerSurvivorsRoutes(app: FastifyInstance, db: Database): void {
  app.get("/survivors", async (req) => {
    const q = query.parse(req.query);
    return getAliveSurvivors(db, { sort: q.sort, page: q.page }, new Date());
  });

  app.get("/survivors/:slug", async (req, reply) => {
    const p = params.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "bad_request" });
    const q = query.parse(req.query);
    const server = await resolveServerBySlug(db, p.data.slug);
    if (!server) return reply.code(404).send({ error: "not_found" });
    return getAliveSurvivors(db, { slug: p.data.slug, sort: q.sort, page: q.page }, new Date());
  });
}
