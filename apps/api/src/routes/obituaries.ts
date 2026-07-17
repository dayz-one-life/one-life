import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import { z } from "zod";
import { getObituaries } from "@onelife/read-models";

const query = z.object({ page: z.coerce.number().int().positive().catch(1) });

export function registerObituariesRoutes(app: FastifyInstance, db: Database): void {
  app.get("/obituaries", async (req) => {
    const { page } = query.parse(req.query);
    return getObituaries(db, { page });
  });
}
