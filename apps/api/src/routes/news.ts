import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import { z } from "zod";
import { getPublishedNews, getNewsArticleBySlug } from "@onelife/read-models";

const query = z.object({ page: z.coerce.number().int().positive().catch(1) });
const params = z.object({ slug: z.string().min(1) });
const previewQuery = z.object({ preview: z.string().optional() });

/**
 * Constant-time compare. An empty configured token means preview is OFF — checked BEFORE the
 * comparison, because timingSafeEqual on two empty buffers returns true, which would serve every
 * draft to any request carrying `?preview=`.
 */
function previewAllowed(supplied: string | undefined, configured: string): boolean {
  if (!configured || !supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(configured);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Structural twin of registerObituariesRoutes. "/news" is declared above "/news/:slug" for
 *  readability, NOT for correctness: the two have different segment counts and could never
 *  collide, and find-my-way prioritises a static segment over a parametric one regardless of
 *  registration order. (The only wildcard in the whole API is "/api/auth/*", which cannot reach
 *  either.) Do not read a registration-order rule out of this comment — there isn't one. */
export function registerNewsRoutes(app: FastifyInstance, db: Database, previewToken = ""): void {
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
    // safeParse, matching `params` above: a repeated ?preview= arrives as an array and a throwing
    // parse would 500 a public URL. Malformed input means "no token" — it can only fail closed.
    const q = previewQuery.safeParse(req.query);
    const includeDraft = q.success ? previewAllowed(q.data.preview, previewToken) : false;
    const article = await getNewsArticleBySlug(db, p.data.slug, { includeDraft });
    if (!article) return reply.code(404).send({ error: "not_found" });
    return article;
  });
}
