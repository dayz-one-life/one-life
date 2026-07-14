import pino from "pino";
import { getDb } from "@onelife/db";
import { loadConfig } from "./config.js";
import { granterTick } from "./tick.js";

const cfg = loadConfig(process.env);
const log = pino({ level: cfg.logLevel });
const { db } = getDb(cfg.databaseUrl);

async function loop(): Promise<void> {
  log.info({ interval: cfg.intervalSeconds }, "granter starting");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const r = await granterTick(db, { now: new Date() });
      if (r.verification || r.monthly || r.referral) log.info(r, "tokens granted");
    } catch (err) {
      log.error({ err }, "granter tick failed");
    }
    await new Promise((r) => setTimeout(r, cfg.intervalSeconds * 1000));
  }
}

loop();
