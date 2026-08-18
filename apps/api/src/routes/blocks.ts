import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@onelife/db";
import type { Auth } from "@onelife/auth";
import { getSession } from "../auth-plugin.js";
import { blockUser, unblockUser, listBlockedUserIds } from "../lib/moderation.js";

const bodySchema = z.object({ userId: z.string().min(1) });

export function registerBlockRoutes(app: FastifyInstance, db: Database, auth: Auth): void {
  app.get("/me/blocks", async (request, reply) => {
    const session = await getSession(auth, request);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    return { blockedUserIds: await listBlockedUserIds(db, session.user.id) };
  });

  app.post("/me/blocks", async (request, reply) => {
    const session = await getSession(auth, request);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    const result = await blockUser(db, session.user.id, parsed.data.userId);
    if ("error" in result) return reply.code(400).send({ error: result.error });
    return reply.code(201).send({ ok: true });
  });

  app.delete("/me/blocks/:userId", async (request, reply) => {
    const session = await getSession(auth, request);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const { userId } = request.params as { userId: string };
    await unblockUser(db, session.user.id, userId);
    return { ok: true };
  });
}
