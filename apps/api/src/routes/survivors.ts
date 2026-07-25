import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import { z } from "zod";
import { getAliveSurvivors } from "@onelife/read-models";
import { resolveServerBySlug } from "../lib/resolve-server.js";

/**
 * ⚠️ No `sort`. Sub-project D deleted the sort layer, and the parameter is DROPPED rather than
 * accepted-and-ignored: silently tolerating a parameter that no longer does anything is how a
 * caller comes to believe it still works.
 *
 * ⚠️ There is also no `GET /survivors` (no slug). A life is per-server, so a combined board ranks
 * lives that were never in the same race. One board per map.
 */
const query = z.object({
  page: z.coerce.number().int().positive().catch(1),
});

const params = z.object({ slug: z.string().min(1) });

export function registerSurvivorsRoutes(app: FastifyInstance, db: Database): void {
  app.get("/survivors/:slug", async (req, reply) => {
    const p = params.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "bad_request" });
    const q = query.parse(req.query);
    const server = await resolveServerBySlug(db, p.data.slug);
    if (!server) return reply.code(404).send({ error: "not_found" });
    return getAliveSurvivors(db, { slug: p.data.slug, page: q.page }, new Date());
  });
}
