import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import type { Auth } from "@onelife/auth";
import { gamertagLinks } from "@onelife/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getSession } from "../auth-plugin.js";
import { getLifeTrack } from "@onelife/read-models";
import { resolveServerBySlug } from "../lib/resolve-server.js";

const params = z.object({
  mapSlug: z.string().min(1),
  n: z.coerce.number().int().positive(),
});

/**
 * The owner-only position track for one life.
 *
 * SECURITY: this route takes NO player identifier. The subject gamertag is derived
 * solely from the session cookie via a `verified` gamertag_links row, so requesting
 * another player's coordinates is unexpressible rather than merely rejected. Do not
 * add a gamertag/slug/userId parameter here for any reason — the public life route
 * (/players/:gamertag/:map/lives/:n) is the place for identified, coordinate-free data.
 *
 * A `pending` link is deliberately insufficient: anyone can type any gamertag into the
 * claim box, so only a link that survived emote verification unlocks coordinates.
 */
export function registerLifeTrackRoutes(app: FastifyInstance, db: Database, auth: Auth): void {
  app.get("/me/lives/:mapSlug/:n/track", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });

    const [link] = await db
      .select({ gamertag: gamertagLinks.gamertag })
      .from(gamertagLinks)
      .where(and(
        eq(gamertagLinks.userId, session.user.id),
        eq(gamertagLinks.status, "verified"),
      ));
    if (!link) return reply.code(403).send({ error: "not_verified" });

    const { mapSlug, n } = params.parse(req.params);
    const server = await resolveServerBySlug(db, mapSlug);
    if (!server) return reply.code(404).send({ error: "not_found" });

    const track = await getLifeTrack(db, server.id, link.gamertag, n);
    if (!track) return reply.code(404).send({ error: "not_found" });

    // A shared proxy or CDN caching this would hand one owner's position to the next
    // visitor — the classic way a correct auth check still leaks.
    reply.header("cache-control", "no-store, private");
    return track;
  });
}
