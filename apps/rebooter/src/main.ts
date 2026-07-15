import pino from "pino";
import { getDb } from "@onelife/db";
import { NitradoClient } from "@onelife/nitrado";
import { loadConfig } from "./config.js";
import { msUntilNextBoundary } from "./schedule.js";
import { rebooterTick } from "./tick.js";

const cfg = loadConfig(process.env);
const log = pino({ level: cfg.logLevel });
const { db } = getDb(cfg.databaseUrl);

async function loop(): Promise<void> {
  log.info({}, "rebooter starting — restarts every even UTC hour (00,02,…,22)");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const waitMs = msUntilNextBoundary(Date.now());
    log.info({ nextRebootInMinutes: Math.round(waitMs / 60000) }, "sleeping until next boundary");
    await new Promise((r) => setTimeout(r, waitMs));
    try {
      const r = await rebooterTick(db, {
        nitradoFor: (sid) => new NitradoClient(cfg.nitradoToken, sid),
        log,
      });
      log.info(r, "rebooter tick");
    } catch (err) {
      log.error({ err }, "rebooter tick failed");
    }
  }
}

loop();
