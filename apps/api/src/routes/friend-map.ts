import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import type { Auth } from "@onelife/auth";
import { gamertagLinks, players, servers } from "@onelife/db";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getFriendPositions, getOnlinePlayers } from "@onelife/read-models";
import {
  activeGrantees, grantLocation, revokeAllLocation, revokeLocation,
  locationSharedNotification, writeNotification,
} from "@onelife/location-sharing";
import { getSession } from "../auth-plugin.js";
import { resolveServerBySlug } from "../lib/resolve-server.js";

const params = z.object({ mapSlug: z.string().min(1) });
const shareBody = z.object({ gamertag: z.string().min(1) });

/** The viewer's own resolved `players` row for a gamertag, most-recently-seen first.
 *  Mirrors the rule in getPlayer/resolveSlugMatch/friend-positions: a gamertag is a current
 *  LABEL since migration 0025, so a recycled name can match two rows and the newest wins. */
async function resolvePlayerId(db: Database, gamertag: string): Promise<number | null> {
  const [row] = await db
    .select({ id: players.id })
    .from(players)
    .where(sql`lower(${players.gamertag}) = lower(${gamertag})`)
    .orderBy(sql`${players.lastSeenAt} desc nulls last`, players.id)
    .limit(1);
  return row?.id ?? null;
}

/** The verified user behind a gamertag, or null. Grants are only expressible between verified
 *  identities — the same boundary every other coordinate surface enforces. */
async function verifiedUserFor(db: Database, gamertag: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: gamertagLinks.userId })
    .from(gamertagLinks)
    .where(and(
      sql`lower(${gamertagLinks.gamertag}) = lower(${gamertag})`,
      eq(gamertagLinks.status, "verified"),
    ))
    .limit(1);
  return row?.userId ?? null;
}

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
    const viewerTag = await verifiedGamertag(db, session.user.id);
    if (!viewerTag) return reply.code(403).send({ error: "not_verified" });

    const parsed = params.safeParse(req.params);
    if (!parsed.success) return reply.code(404).send({ error: "not_found" });
    const server = await resolveServerBySlug(db, parsed.data.mapSlug);
    if (!server) return reply.code(404).send({ error: "not_found" });

    const now = new Date();
    const positions = await getFriendPositions(db, {
      viewerUserId: session.user.id, serverId: server.id, now,
    });
    // Composed from the SAME positions the payload returns, so `sharing` and the dots are one
    // fact rather than two lookups that can disagree.
    const online = await getOnlinePlayers(db, {
      viewerUserId: session.user.id, serverId: server.id, now, positions,
    });

    // Who the VIEWER is currently sharing with — the outbound direction, which nothing else on
    // this payload reports. Effective grants only: a stale row from a previous session must not
    // appear in the chip, or it claims people can see you who cannot.
    const myPlayerId = await resolvePlayerId(db, viewerTag);
    const grantees = myPlayerId === null ? [] : await activeGrantees(db, {
      granterUserId: session.user.id, granterPlayerId: myPlayerId, serverId: server.id,
    });
    const granteeTags = await gamertagsForUsers(db, grantees);

    // A shared proxy or CDN caching this would hand one player's squad positions to the next
    // visitor — the classic way a correct auth check still leaks.
    reply.header("cache-control", "no-store, private");
    return {
      mapCodename: server.map,
      positions,
      online: online.map((o) => ({ ...o, sharedWithThem: granteeTags.has(o.gamertag.toLowerCase()) })),
      sharingWith: [...granteeTags.values()],
    };
  });

  /**
   * ⚠️ THIS ROUTE TAKES A GAMERTAG, AND THAT DOES NOT BREAK THE NO-SUBJECT RULE.
   *
   * The rule governs coordinate EGRESS: `GET /me/maps/:slug` must not let a caller name whose
   * position to read. This is the opposite direction — it names who may see the CALLER'S OWN
   * position, and it discloses nothing at all in its response. A reviewer seeing a gamertag on a
   * `/me/maps` route should find this comment.
   *
   * The grant is anchored to the caller's CURRENT session (409 when they are not online), which
   * is what makes it self-expiring.
   */
  app.post("/me/maps/:mapSlug/shares", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const viewerTag = await verifiedGamertag(db, session.user.id);
    if (!viewerTag) return reply.code(403).send({ error: "not_verified" });

    const p = params.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: "not_found" });
    const server = await resolveServerBySlug(db, p.data.mapSlug);
    if (!server) return reply.code(404).send({ error: "not_found" });

    const body = shareBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "bad_request" });

    const granteeUserId = await verifiedUserFor(db, body.data.gamertag);
    if (!granteeUserId) return reply.code(400).send({ error: "not_verified" });
    // Sharing with yourself is meaningless — your own dot is always on your own map.
    if (granteeUserId === session.user.id) return reply.code(400).send({ error: "self_share" });

    const myPlayerId = await resolvePlayerId(db, viewerTag);
    if (myPlayerId === null) return reply.code(409).send({ error: "not_online" });

    // One transaction: the grant and its notification land together or not at all.
    const connectedAt = await db.transaction(async (tx) => {
      const at = await grantLocation(tx as unknown as Database, {
        granterUserId: session.user.id, granterPlayerId: myPlayerId,
        granteeUserId, serverId: server.id,
      });
      if (!at) return null;
      await writeNotification(tx, locationSharedNotification({
        granteeUserId, granterGamertag: viewerTag, sessionConnectedAt: at,
        mapSlug: p.data.mapSlug, mapName: server.name,
      }));
      return at;
    });

    // A grant is always made DURING a session — that is what anchors its expiry — so being
    // offline is a real conflict, not a silent no-op.
    if (!connectedAt) return reply.code(409).send({ error: "not_online" });
    return { ok: true };
  });

  /** Stop sharing with everyone on this server. Backs the map's "N can see you · Stop" chip. */
  app.delete("/me/maps/:mapSlug/shares", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    if (!(await verifiedGamertag(db, session.user.id))) {
      return reply.code(403).send({ error: "not_verified" });
    }
    const p = params.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: "not_found" });
    const server = await resolveServerBySlug(db, p.data.mapSlug);
    if (!server) return reply.code(404).send({ error: "not_found" });

    await revokeAllLocation(db, { granterUserId: session.user.id, serverId: server.id });
    return { ok: true };
  });

  /** Stop sharing with one person. Same direction, and the same non-disclosure, as POST. */
  app.delete("/me/maps/:mapSlug/shares/:gamertag", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    if (!(await verifiedGamertag(db, session.user.id))) {
      return reply.code(403).send({ error: "not_verified" });
    }
    const p = z.object({ mapSlug: z.string().min(1), gamertag: z.string().min(1) })
      .safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: "not_found" });
    const server = await resolveServerBySlug(db, p.data.mapSlug);
    if (!server) return reply.code(404).send({ error: "not_found" });

    const granteeUserId = await verifiedUserFor(db, p.data.gamertag);
    // Revoking a grant that cannot exist is a no-op, not an error — the caller ends up in the
    // state they asked for either way, and a 404 here would confirm whether a gamertag is
    // verified to anyone who can call it.
    if (granteeUserId) {
      await revokeLocation(db, {
        granterUserId: session.user.id, granteeUserId, serverId: server.id,
      });
    }
    return { ok: true };
  });
}

/** Verified gamertags for a set of user ids, keyed by LOWERCASE gamertag for case-safe lookup. */
async function gamertagsForUsers(db: Database, userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ userId: gamertagLinks.userId, gamertag: gamertagLinks.gamertag })
    .from(gamertagLinks)
    .where(and(eq(gamertagLinks.status, "verified"), inArray(gamertagLinks.userId, userIds)));
  return new Map(rows.map((r) => [r.gamertag.toLowerCase(), r.gamertag]));
}
