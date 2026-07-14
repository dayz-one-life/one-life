import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import { servers } from "@onelife/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getRoster } from "@onelife/read-models";

const serverIdParam = z.object({ serverId: z.coerce.number().int().positive() });

export function registerServerRoutes(app: FastifyInstance, db: Database): void {
  app.get("/servers", async () => {
    return db.select().from(servers).where(eq(servers.active, true));
  });

  app.get("/servers/:serverId/roster", async (req, reply) => {
    const parsed = serverIdParam.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    return getRoster(db, parsed.data.serverId, new Date());
  });
}
