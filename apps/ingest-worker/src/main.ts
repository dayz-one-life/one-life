import pino from "pino";
import { getDb } from "@onelife/db";
import { NitradoClient } from "@onelife/nitrado";
import { loadConfig } from "./config.js";
import { ingestSweep } from "./sweep.js";

const cfg = loadConfig(process.env);
const log = pino({ level: cfg.logLevel });
const { db } = getDb(cfg.databaseUrl);

async function loop(): Promise<void> {
  // One shared Nitrado token (single tenant); one cached client per service id.
  const clients = new Map<number, NitradoClient>();
  const clientFor = (serviceId: number): NitradoClient => {
    let c = clients.get(serviceId);
    if (!c) {
      c = new NitradoClient(cfg.nitradoToken, serviceId);
      clients.set(serviceId, c);
    }
    return c;
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const started = Date.now();
    try {
      const r = await ingestSweep(db, {
        clientFor,
        backfillBudget: cfg.backfillBudget,
        charStaleHours: cfg.charStaleHours,
        onServerError: (serverId, err) => log.error({ serverId, err }, "server ingest failed"),
      });
      log.info({ servers: r.servers, sightings: r.sightings, ms: Date.now() - started }, "ingest sweep complete");
    } catch (err) {
      log.error({ err }, "ingest sweep failed");
    }
    await new Promise((res) => setTimeout(res, cfg.intervalSeconds * 1000));
  }
}

loop().catch((err) => { log.fatal({ err }, "worker crashed"); process.exit(1); });
