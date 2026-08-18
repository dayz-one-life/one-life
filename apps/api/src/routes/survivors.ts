import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import { z } from "zod";
import { getAliveSurvivors } from "@onelife/read-models";
import type { Auth } from "@onelife/auth";
import { getSession } from "../auth-plugin.js";
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

/**
 * ⚠️ `auth` is OPTIONAL, and this route reads a session only to answer "who is looking". The
 * board is PUBLIC: `buildApp` registers it outside the `if (opts)` auth block, and a signed-out
 * request must keep working exactly as it always has. No auth instance and no session are both
 * simply "no viewer" — never a 401.
 */
export function registerSurvivorsRoutes(app: FastifyInstance, db: Database, auth?: Auth): void {
  app.get("/survivors/:slug", async (req, reply) => {
    const p = params.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "bad_request" });
    const q = query.parse(req.query);
    const server = await resolveServerBySlug(db, p.data.slug);
    if (!server) return reply.code(404).send({ error: "not_found" });
    // Used for one thing: suppressing the avatar of a player this viewer has BLOCKED. Ranking
    // and membership are identical for everyone.
    // ⚠️ Viewer-specific from here on. `getSurvivors` in apps/web goes through the
    // cookie-forwarding, per-request `apiGet` transport — do NOT move it to a shared cache.
    const session = auth ? await getSession(auth, req) : null;
    return getAliveSurvivors(db, { slug: p.data.slug, page: q.page, viewerUserId: session?.user.id }, new Date());
  });
}
