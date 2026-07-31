import pino from "pino";
import { getDb } from "@onelife/db";
import { loadConfig } from "./config.js";
import { crierTick } from "./tick.js";
import * as store from "./pg-store.js";

const cfg = loadConfig(process.env);
const log = pino({ level: cfg.logLevel });
const { db } = getDb(cfg.databaseUrl);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function loop(): Promise<void> {
  log.info({ interval: cfg.intervalSeconds, dryRun: cfg.dryRun, since: cfg.since?.toISOString() ?? null }, "crier starting");
  if (cfg.dryRun) log.warn("CRIER_DRY_RUN is true — nothing will be posted");
  if (!cfg.since) log.warn(process.env.CRIER_SINCE ? "CRIER_SINCE is set but unparseable — syndication is OFF" : "CRIER_SINCE is unset — syndication is OFF");
  if (!cfg.discordWebhookUrl && !cfg.fbPageId) log.warn("no channel credentials configured — nothing to post to");

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const r = await crierTick(db, { cfg, fetchFn: fetch, now: new Date(), log, store, sleep });
      if (r.posted || r.failed || r.skipped) log.info(r, "crier tick");
    } catch (err) {
      log.error({ err }, "crier tick failed");
    }
    await sleep(cfg.intervalSeconds * 1000);
  }
}

loop();
