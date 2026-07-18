import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import { articles, articleImages } from "@onelife/db";
import { and, eq, isNotNull } from "drizzle-orm";

// Exported for direct unit testing — a real traversal payload like "../../etc/passwd" never
// reaches this handler over HTTP (both Fastify's inject and a live socket normalize/reject
// multi-segment ".." paths before routing), so the regex itself is asserted directly too.
export const FILE_RE = /^[a-z0-9-]+\.(png|jpg|jpeg|webp)$/;

/** Generated article heroes, straight from Postgres. Images are generate-once → immutable cache.
 *  The filename allow-list doubles as the traversal guard (archived-platform pattern). */
export function registerMediaRoutes(app: FastifyInstance, db: Database): void {
  app.get<{ Params: { file: string } }>("/media/heroes/:file", async (req, reply) => {
    const { file } = req.params;
    if (!FILE_RE.test(file)) return reply.code(400).send({ error: "bad_filename" });
    const slug = file.replace(/\.[a-z]+$/, "");
    const rows = await db
      .select({ bytes: articleImages.bytes, contentType: articleImages.contentType })
      .from(articles)
      .innerJoin(articleImages, eq(articleImages.articleId, articles.id))
      .where(and(eq(articles.slug, slug), isNotNull(articles.imageUrl)))
      .limit(1);
    const r = rows[0];
    if (!r) return reply.code(404).send({ error: "not_found" });
    return reply
      .header("cache-control", "public, max-age=31536000, immutable")
      .type(r.contentType)
      .send(r.bytes);
  });
}
