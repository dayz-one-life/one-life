import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import { getSiteStats } from "@onelife/read-models";

/** Public site-wide ledger numbers for the cold home's hero. No params, no session — nothing
 *  in the payload is player-scoped. */
export function registerStatsRoutes(app: FastifyInstance, db: Database): void {
  app.get("/stats", async () => getSiteStats(db, new Date()));
}
