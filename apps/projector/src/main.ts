import pino from "pino";
import { getDb } from "@onelife/db";
import { loadConfig } from "./config.js";
import { projectorTick } from "./tick.js";
import { runLoopOnce } from "./loop.js";
import { sweepVerdicts } from "./verdict-sweep.js";

const cfg = loadConfig(process.env);
const log = pino({ level: cfg.logLevel });
const { db } = getDb(cfg.databaseUrl);

async function loop(): Promise<void> {
  log.info({ trapKillsWrite: cfg.trapKillsWrite }, "projector starting");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await runLoopOnce({
      db, cfg, log,
      tick: () => projectorTick(db, {
        batchSize: cfg.batchSize,
        onSkip: (id, err) => log.warn({ eventId: id, err }, "projection.skipped"),
      }),
      sweep: () => sweepVerdicts(db, { log, trapKillsWrite: cfg.trapKillsWrite }),
    });
    await new Promise((r) => setTimeout(r, cfg.intervalSeconds * 1000));
  }
}

loop().catch((err) => { log.fatal({ err }, "projector crashed"); process.exit(1); });
