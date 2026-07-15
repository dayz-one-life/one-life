import { eq } from "drizzle-orm";
import { type Database, servers } from "@onelife/db";

/** Minimal Nitrado surface the rebooter needs — real client or a fake in tests. */
export interface RestartClient {
  restartServer(): Promise<void>;
}

export type RebooterDeps = {
  nitradoFor: (serviceId: number) => RestartClient;
  log: { info: (obj: unknown, msg?: string) => void; error?: (obj: unknown, msg?: string) => void };
};

export type RebooterResult = { restarted: number; failed: number };

/** Restart every active server, best-effort: a single failure is logged and skipped. */
export async function rebooterTick(db: Database, deps: RebooterDeps): Promise<RebooterResult> {
  const rows = await db
    .select({ name: servers.name, serviceId: servers.nitradoServiceId })
    .from(servers)
    .where(eq(servers.active, true));

  let restarted = 0;
  let failed = 0;
  for (const s of rows) {
    try {
      await deps.nitradoFor(s.serviceId).restartServer();
      deps.log.info({ name: s.name, serviceId: s.serviceId }, "restarting");
      restarted++;
    } catch (e) {
      failed++;
      deps.log.error?.({ err: e, name: s.name, serviceId: s.serviceId }, "restart failed");
    }
  }
  return { restarted, failed };
}
