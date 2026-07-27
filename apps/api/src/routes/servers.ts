import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import { servers } from "@onelife/db";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getRoster } from "@onelife/read-models";

const serverIdParam = z.object({ serverId: z.coerce.number().int().positive() });

export function registerServerRoutes(app: FastifyInstance, db: Database): void {
  app.get("/servers", async () => {
    // ⚠️ Ordered, because consumers render this list AS GIVEN — the masthead map switcher most
    // visibly, which reshuffled on every refetch while this had no ORDER BY. Alphabetical by
    // display name (`servers.name` is the label the dropdown shows), id as the tie-break.
    return db.select().from(servers).where(eq(servers.active, true))
      .orderBy(asc(sql`lower(${servers.name})`), asc(servers.id));
  });

  app.get("/servers/:serverId/roster", async (req, reply) => {
    const parsed = serverIdParam.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    return getRoster(db, parsed.data.serverId, new Date());
  });
}
