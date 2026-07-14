import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import type { Auth } from "@onelife/auth";
import { gamertagLinks, verificationChallenges, players } from "@onelife/db";
import { and, eq, gt, desc, isNull } from "drizzle-orm";
import { z } from "zod";
import { generateSequence } from "@onelife/verification";
import { tokenToLabel } from "@onelife/domain";
import { getSession } from "../auth-plugin.js";

const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;
const claimBody = z.object({ serverId: z.number().int().positive(), gamertag: z.string().min(1) });

type ChallengeRow = typeof verificationChallenges.$inferSelect;

function serializeChallenge(c: ChallengeRow, now: Date) {
  return {
    sequence: (c.sequence as string[]).map((t) => tokenToLabel(t) ?? t),
    progressIndex: c.progressIndex,
    expiresAt: c.expiresAt,
    expired: now.getTime() > c.expiresAt.getTime(),
  };
}

const idParam = z.object({ id: z.coerce.number().int().positive() });

async function loadLink(db: Database, userId: string, linkId: number, now: Date) {
  const rows = await db.select().from(gamertagLinks).where(eq(gamertagLinks.id, linkId));
  const link = rows[0];
  if (!link || link.userId !== userId) return null;
  const ch = await db.select().from(verificationChallenges)
    .where(eq(verificationChallenges.gamertagLinkId, link.id))
    .orderBy(desc(verificationChallenges.issuedAt)).limit(1);
  return {
    id: link.id, serverId: link.serverId, gamertag: link.gamertag,
    status: link.status, verifiedAt: link.verifiedAt,
    challenge: link.status === "pending" && ch[0] ? serializeChallenge(ch[0], now) : null,
  };
}

export function registerGamertagLinkRoutes(app: FastifyInstance, db: Database, auth: Auth): void {
  app.post("/me/gamertag-links", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });

    const parsed = claimBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    const { serverId, gamertag } = parsed.data;
    const userId = session.user.id;
    const now = new Date();

    // D6: the gamertag must be an observed player on this server.
    const player = await db.select({ id: players.id }).from(players)
      .where(and(eq(players.serverId, serverId), eq(players.gamertag, gamertag)));
    if (player.length === 0) return reply.code(422).send({ error: "gamertag_not_seen" });

    // D3: reject if this gamertag is already verified by anyone.
    const verified = await db.select({ id: gamertagLinks.id }).from(gamertagLinks)
      .where(and(eq(gamertagLinks.serverId, serverId), eq(gamertagLinks.gamertag, gamertag), eq(gamertagLinks.status, "verified")));
    if (verified.length > 0) return reply.code(409).send({ error: "already_verified" });

    const { linkId, challenge } = await db.transaction(async (tx) => {
      // Upsert the caller's link for (user, server, gamertag) to pending.
      const existing = await tx.select().from(gamertagLinks)
        .where(and(eq(gamertagLinks.userId, userId), eq(gamertagLinks.serverId, serverId), eq(gamertagLinks.gamertag, gamertag)));
      let id: number;
      if (existing[0]) {
        id = existing[0].id;
        if (existing[0].status !== "pending") {
          await tx.update(gamertagLinks).set({ status: "pending", verifiedAt: null }).where(eq(gamertagLinks.id, id));
        }
      } else {
        const [row] = await tx.insert(gamertagLinks).values({ userId, serverId, gamertag, status: "pending" }).returning();
        id = row!.id;
      }

      // D7: reuse a live (not completed, not expired) challenge; else issue a fresh one.
      const live = await tx.select().from(verificationChallenges)
        .where(and(eq(verificationChallenges.gamertagLinkId, id), isNull(verificationChallenges.completedAt), gt(verificationChallenges.expiresAt, now)))
        .orderBy(desc(verificationChallenges.issuedAt)).limit(1);
      let ch = live[0];
      if (!ch) {
        const [c] = await tx.insert(verificationChallenges).values({
          gamertagLinkId: id, sequence: generateSequence(Math.random),
          issuedAt: now, expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
        }).returning();
        ch = c!;
      }
      return { linkId: id, challenge: ch };
    });

    return reply.code(201).send({
      linkId, serverId, gamertag, status: "pending", challenge: serializeChallenge(challenge, now),
    });
  });

  app.get("/me/gamertag-links", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const now = new Date();
    const links = await db.select().from(gamertagLinks).where(eq(gamertagLinks.userId, session.user.id));
    const out = [];
    for (const link of links) {
      const full = await loadLink(db, session.user.id, link.id, now);
      if (full) out.push(full);
    }
    return out;
  });

  app.get("/me/gamertag-links/:id", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const parsed = idParam.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    const full = await loadLink(db, session.user.id, parsed.data.id, new Date());
    if (!full) return reply.code(404).send({ error: "not_found" });
    return full;
  });

  app.delete("/me/gamertag-links/:id", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const parsed = idParam.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    const rows = await db.select().from(gamertagLinks).where(eq(gamertagLinks.id, parsed.data.id));
    const link = rows[0];
    if (!link || link.userId !== session.user.id) return reply.code(404).send({ error: "not_found" });
    if (link.status !== "pending") return reply.code(409).send({ error: "not_pending" });
    await db.update(gamertagLinks).set({ status: "cancelled" }).where(eq(gamertagLinks.id, link.id));
    return { status: "cancelled" };
  });
}
