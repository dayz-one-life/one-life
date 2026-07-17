import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import { z } from "zod";
import { getFreshSpawns } from "@onelife/read-models";

const query = z.object({ page: z.coerce.number().int().positive().catch(1) });

export function registerFreshSpawnsRoutes(app: FastifyInstance, db: Database): void {
  app.get("/fresh-spawns", async (req) => {
    const { page } = query.parse(req.query);
    return getFreshSpawns(db, { page });
  });
}
