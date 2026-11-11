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
  // ⚠️ The first sweep pass after start-up makes every backing-off life due: a deploy is how a
  // classifier fix arrives, and a held life must not wait out its backoff (up to 6 h) after it.
  let firstSweep = true;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await runLoopOnce({
      db, cfg, log,
      tick: () => projectorTick(db, {
        batchSize: cfg.batchSize,
        onSkip: (id, err) => log.warn({ eventId: id, err }, "projection.skipped"),
      }),
      sweep: async () => {
        const r = await sweepVerdicts(db, { log, trapKillsWrite: cfg.trapKillsWrite, resetBackoff: firstSweep });
        firstSweep = false;
        return r;
      },
    });
    await new Promise((r) => setTimeout(r, cfg.intervalSeconds * 1000));
  }
}

loop().catch((err) => { log.fatal({ err }, "projector crashed"); process.exit(1); });
