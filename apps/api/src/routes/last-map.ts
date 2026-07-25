import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import type { Auth } from "@onelife/auth";
import { getLastPlayedMapSlug } from "@onelife/read-models";
import { getSession } from "../auth-plugin.js";

/**
 * Tier 2 of the map-resolution rule (D spec §3.1): the map this viewer last played on.
 *
 * ⚠️ Takes NO player identifier — the subject is the session cookie and nothing else, so serving
 * another player's map history is unexpressible rather than merely rejected. Do not add a
 * gamertag/slug/userId parameter.
 *
 * ⚠️ A signed-out viewer gets `{ slug: null }` with a 200, NOT a 401. This is a resolution HINT,
 * not a protected resource: the caller (`/maps` and `/survivors`, both public) would have to treat
 * a 401 as "no memory" anyway, and a 401 here would force every public page fetching it to
 * special-case an error that is really just "we don't know."
 */
export function registerLastMapRoute(app: FastifyInstance, db: Database, auth: Auth): void {
  app.get("/me/last-map", async (req, reply) => {
    // Per-viewer and never worth a shared cache entry.
    reply.header("cache-control", "no-store, private");
    const session = await getSession(auth, req);
    if (!session) return { slug: null };
    return { slug: await getLastPlayedMapSlug(db, session.user.id) };
  });
}
