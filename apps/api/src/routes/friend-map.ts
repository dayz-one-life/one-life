import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import type { Auth } from "@onelife/auth";
import { gamertagLinks, servers } from "@onelife/db";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { getFriendPositions } from "@onelife/read-models";
import { getSession } from "../auth-plugin.js";
import { resolveServerBySlug } from "../lib/resolve-server.js";

const params = z.object({ mapSlug: z.string().min(1) });

/** The viewer's verified gamertag, or null. A pending link is deliberately insufficient:
 *  anyone can type any gamertag into the claim box, so only a link that survived emote
 *  verification unlocks coordinates — the same rule as the owner-only track route. */
async function verifiedGamertag(db: Database, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ gamertag: gamertagLinks.gamertag })
    .from(gamertagLinks)
    .where(and(eq(gamertagLinks.userId, userId), eq(gamertagLinks.status, "verified")))
    .limit(1);
  return row?.gamertag ?? null;
}

/**
 * SECURITY: neither route takes a player identifier. The subject set comes entirely from the
 * session, so requesting a NAMED player's coordinates is unexpressible rather than merely
 * rejected — the same property the owner-only track route holds. Do not add a
 * gamertag/slug/userId parameter to either of these for any reason.
 */
export function registerFriendMapRoutes(app: FastifyInstance, db: Database, auth: Auth): void {
  app.get("/me/maps", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    if (!(await verifiedGamertag(db, session.user.id))) {
      return reply.code(403).send({ error: "not_verified" });
    }

    const rows = await db
      .select({ slug: servers.slug, name: servers.name, map: servers.map, id: servers.id })
      .from(servers)
      .where(and(eq(servers.active, true), isNotNull(servers.slug)))
      .orderBy(asc(servers.name));

    const now = new Date();
    const out = [];
    for (const s of rows) {
      const positions = await getFriendPositions(db, {
        viewerUserId: session.user.id, serverId: s.id, now,
      });
      out.push({
        slug: s.slug as string, name: s.name, map: s.map,
        // The viewer's own dot is not a "friend on this server".
        friendCount: positions.filter((p) => !p.self).length,
      });
    }
    // Counts are derived from who is sharing with this viewer — as sensitive as the map itself.
    reply.header("cache-control", "no-store, private");
    return { servers: out };
  });

  app.get("/me/maps/:mapSlug", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    if (!(await verifiedGamertag(db, session.user.id))) {
      return reply.code(403).send({ error: "not_verified" });
    }

    const parsed = params.safeParse(req.params);
    if (!parsed.success) return reply.code(404).send({ error: "not_found" });
    const server = await resolveServerBySlug(db, parsed.data.mapSlug);
    if (!server) return reply.code(404).send({ error: "not_found" });

    const positions = await getFriendPositions(db, {
      viewerUserId: session.user.id, serverId: server.id, now: new Date(),
    });

    // A shared proxy or CDN caching this would hand one player's squad positions to the next
    // visitor — the classic way a correct auth check still leaks.
    reply.header("cache-control", "no-store, private");
    return { mapCodename: server.map, positions };
  });
}
