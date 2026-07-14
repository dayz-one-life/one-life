import pino from "pino";
import { getDb } from "@onelife/db";
import { loadConfig } from "./config.js";
import { verifierTick } from "./tick.js";

const cfg = loadConfig(process.env);
const log = pino({ level: cfg.logLevel });
const { db } = getDb(cfg.databaseUrl);

async function loop(): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const started = Date.now();
    try {
      const { scanned, verified } = await verifierTick(db, { batchSize: cfg.batchSize });
      if (scanned || verified) log.info({ scanned, verified, ms: Date.now() - started }, "verifier tick");
    } catch (err) {
      log.error({ err }, "verifier tick failed");
    }
    await new Promise((r) => setTimeout(r, cfg.intervalSeconds * 1000));
  }
}

loop().catch((err) => { log.fatal({ err }, "verifier crashed"); process.exit(1); });
