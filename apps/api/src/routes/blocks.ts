import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@onelife/db";
import type { Auth } from "@onelife/auth";
import { getSession } from "../auth-plugin.js";
import { blockByGamertag, unblockByGamertag, listBlocks } from "../lib/moderation.js";

const bodySchema = z.object({ gamertag: z.string().min(1) });

export function registerBlockRoutes(app: FastifyInstance, db: Database, auth: Auth): void {
  app.get("/me/blocks", async (request, reply) => {
    const session = await getSession(auth, request);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    return { blocks: await listBlocks(db, session.user.id) };
  });

  app.post("/me/blocks", async (request, reply) => {
    const session = await getSession(auth, request);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    const result = await blockByGamertag(db, session.user.id, parsed.data.gamertag);
    if ("error" in result) return reply.code(result.error === "unknown_gamertag" ? 404 : 400).send({ error: result.error });
    return reply.code(201).send({ ok: true });
  });

  app.delete("/me/blocks/:gamertag", async (request, reply) => {
    const session = await getSession(auth, request);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const { gamertag } = request.params as { gamertag: string };
    await unblockByGamertag(db, session.user.id, gamertag);
    return { ok: true };
  });
}
