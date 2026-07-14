import pino from "pino";
import { getDb, servers } from "@onelife/db";
import { eq } from "drizzle-orm";
import { NitradoClient } from "@onelife/nitrado";
import { loadConfig } from "./config.js";
import { ingestTick } from "./tick.js";
import { rptTick } from "./rpt-tick.js";

const cfg = loadConfig(process.env);
const log = pino({ level: cfg.logLevel });
const { db } = getDb(cfg.databaseUrl);

async function ensureServer(): Promise<number> {
  const existing = await db.select().from(servers).where(eq(servers.nitradoServiceId, cfg.nitradoServiceId));
  if (existing[0]) return existing[0].id;
  const [row] = await db.insert(servers).values({
    nitradoServiceId: cfg.nitradoServiceId, name: `server-${cfg.nitradoServiceId}`,
  }).returning();
  return row!.id;
}

async function loop(): Promise<void> {
  const serverId = await ensureServer();
  const client = new NitradoClient(cfg.nitradoToken, cfg.nitradoServiceId);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const started = Date.now();
    try {
      await ingestTick(db, { serverId, client, backfillBudget: cfg.backfillBudget });
      const rpt = await rptTick(db, { serverId, client, charStaleHours: cfg.charStaleHours });
      log.info({ serverId, ms: Date.now() - started, rptSightings: rpt.sightings }, "ingest tick complete");
    } catch (err) {
      log.error({ err }, "ingest tick failed");
    }
    await new Promise((r) => setTimeout(r, cfg.intervalSeconds * 1000));
  }
}

loop().catch((err) => { log.fatal({ err }, "worker crashed"); process.exit(1); });
