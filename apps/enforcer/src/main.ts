import pino from "pino";
import { getDb } from "@onelife/db";
import { NitradoClient } from "@onelife/nitrado";
import { loadConfig } from "./config.js";
import { enforcerTick } from "./tick.js";

const cfg = loadConfig(process.env);
const log = pino({ level: cfg.logLevel });
const { db } = getDb(cfg.databaseUrl);

async function loop(): Promise<void> {
  log.info({ dryRun: cfg.dryRun, banDurationHours: cfg.banDurationHours, interval: cfg.intervalSeconds }, "enforcer starting");
  if (cfg.dryRun) log.warn("ENFORCER_DRY_RUN is on — bans are logged, not applied. Set ENFORCER_DRY_RUN=false to enforce.");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const r = await enforcerTick(db, {
        nitradoFor: (sid) => new NitradoClient(cfg.nitradoToken, sid),
        dryRun: cfg.dryRun,
        banDurationHours: cfg.banDurationHours,
        now: new Date(),
        log,
      });
      log.info(r, "enforcer tick");
    } catch (err) {
      log.error({ err }, "enforcer tick failed");
    }
    await new Promise((r) => setTimeout(r, cfg.intervalSeconds * 1000));
  }
}

loop();
