import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import { getSitemapEntries } from "@onelife/read-models";

/** Everything the sitemap may advertise, in one call. Public and unauthenticated: it lists only
 *  URLs that are already public, and a crawler cannot hold a session. */
export function registerSitemapRoutes(app: FastifyInstance, db: Database): void {
  app.get("/sitemap", async () => getSitemapEntries(db));
}
