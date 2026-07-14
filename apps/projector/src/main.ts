import pino from "pino";
import { getDb } from "@onelife/db";
import { loadConfig } from "./config.js";
import { projectorTick } from "./tick.js";

const cfg = loadConfig(process.env);
const log = pino({ level: cfg.logLevel });
const { db } = getDb(cfg.databaseUrl);

async function loop(): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const started = Date.now();
    try {
      const { applied, skipped } = await projectorTick(db, {
        batchSize: cfg.batchSize,
        onSkip: (id, err) => log.warn({ eventId: id, err }, "projection.skipped"),
      });
      if (applied || skipped) log.info({ applied, skipped, ms: Date.now() - started }, "projector tick");
    } catch (err) {
      log.error({ err }, "projector tick failed");
    }
    await new Promise((r) => setTimeout(r, cfg.intervalSeconds * 1000));
  }
}

loop().catch((err) => { log.fatal({ err }, "projector crashed"); process.exit(1); });
