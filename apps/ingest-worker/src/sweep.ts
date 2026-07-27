import type { Database } from "@onelife/db";
import { servers } from "@onelife/db";
import { eq } from "drizzle-orm";
import { ingestTick, type NitradoLike } from "./tick.js";

/** A client that can serve the ADM pass for one server. */
export type IngestClient = NitradoLike;
/** Builds (or returns a cached) client for a given Nitrado service id. */
export type ClientFactory = (nitradoServiceId: number) => IngestClient;

export type SweepDeps = {
  clientFor: ClientFactory;
  backfillBudget: number;
  now?: Date;
  /** Called when a single server's pass throws; the sweep continues with the rest. */
  onServerError?: (serverId: number, err: unknown) => void;
};

/** One ingest sweep across every active server (DB is the source of truth for which). */
export async function ingestSweep(db: Database, deps: SweepDeps): Promise<{ servers: number }> {
  const active = await db.select().from(servers).where(eq(servers.active, true));
  for (const s of active) {
    // Per-server isolation: one server's Nitrado failure must not abort the whole sweep.
    try {
      const client = deps.clientFor(s.nitradoServiceId);
      await ingestTick(db, { serverId: s.id, client, backfillBudget: deps.backfillBudget });
    } catch (err) {
      deps.onServerError?.(s.id, err);
    }
  }
  return { servers: active.length };
}
