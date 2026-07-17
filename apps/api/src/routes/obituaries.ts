import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import { z } from "zod";
import { getPublishedObituaries, getObituaryBySlug } from "@onelife/read-models";

const query = z.object({ page: z.coerce.number().int().positive().catch(1) });
const params = z.object({ slug: z.string().min(1) });

export function registerObituariesRoutes(app: FastifyInstance, db: Database): void {
  app.get("/obituaries", async (req) => {
    const { page } = query.parse(req.query);
    return getPublishedObituaries(db, { page });
  });

  app.get("/obituaries/:slug", async (req, reply) => {
    const p = params.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "bad_request" });
    const article = await getObituaryBySlug(db, p.data.slug);
    if (!article) return reply.code(404).send({ error: "not_found" });
    return article;
  });
}
