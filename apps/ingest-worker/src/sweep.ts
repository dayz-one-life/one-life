import type { Database } from "@onelife/db";
import { servers } from "@onelife/db";
import { eq } from "drizzle-orm";
import { ingestTick, type NitradoLike } from "./tick.js";
import { rptTick, type RptNitradoLike } from "./rpt-tick.js";

/** A client that can serve both the ADM and RPT passes for one server. */
export type IngestClient = NitradoLike & RptNitradoLike;
/** Builds (or returns a cached) client for a given Nitrado service id. */
export type ClientFactory = (nitradoServiceId: number) => IngestClient;

export type SweepDeps = {
  clientFor: ClientFactory;
  backfillBudget: number;
  charStaleHours: number;
  now?: Date;
  /** Called when a single server's pass throws; the sweep continues with the rest. */
  onServerError?: (serverId: number, err: unknown) => void;
};

/** One ingest sweep across every active server (DB is the source of truth for which). */
export async function ingestSweep(db: Database, deps: SweepDeps): Promise<{ servers: number; sightings: number }> {
  const active = await db.select().from(servers).where(eq(servers.active, true));
  let sightings = 0;
  for (const s of active) {
    // Per-server isolation: one server's Nitrado failure must not abort the whole sweep.
    try {
      const client = deps.clientFor(s.nitradoServiceId);
      await ingestTick(db, { serverId: s.id, client, backfillBudget: deps.backfillBudget });
      const rpt = await rptTick(db, { serverId: s.id, client, charStaleHours: deps.charStaleHours, now: deps.now });
      sightings += rpt.sightings;
    } catch (err) {
      deps.onServerError?.(s.id, err);
    }
  }
  return { servers: active.length, sightings };
}
