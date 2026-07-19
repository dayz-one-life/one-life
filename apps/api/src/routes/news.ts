import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import { z } from "zod";
import { getPublishedNews, getNewsArticleBySlug } from "@onelife/read-models";

const query = z.object({ page: z.coerce.number().int().positive().catch(1) });
const params = z.object({ slug: z.string().min(1) });

/** Structural twin of registerObituariesRoutes. "/news" is declared above "/news/:slug" for
 *  readability, NOT for correctness: the two have different segment counts and could never
 *  collide, and find-my-way prioritises a static segment over a parametric one regardless of
 *  registration order. (The only wildcard in the whole API is "/api/auth/*", which cannot reach
 *  either.) Do not read a registration-order rule out of this comment — there isn't one. */
export function registerNewsRoutes(app: FastifyInstance, db: Database): void {
  app.get("/news", async (req) => {
    const { page } = query.parse(req.query);
    return getPublishedNews(db, { page });
  });

  app.get("/news/:slug", async (req, reply) => {
    const p = params.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "bad_request" });
    // A RETRACTED article resolves here on purpose and arrives carrying `retracted: true`. The
    // feed drops it and the interior noindexes it; the URL keeps working so a reader who followed
    // a shared link gets the correction instead of a 404.
    const article = await getNewsArticleBySlug(db, p.data.slug);
    if (!article) return reply.code(404).send({ error: "not_found" });
    return article;
  });
}
