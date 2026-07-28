import pino from "pino";
import { getDb } from "@onelife/db";
import { loadConfig } from "./config.js";
import { newsdeskTick } from "./tick.js";
import { openrouterClient } from "./openrouter.js";
import { OBITUARY_PROMPT_VERSION } from "./prompt.js";

const cfg = loadConfig(process.env);
const log = pino({ level: cfg.logLevel });
const { db } = getDb(cfg.databaseUrl);
const client = openrouterClient({ apiKey: cfg.openrouterApiKey, model: cfg.model, temperature: cfg.temperature });

async function loop(): Promise<void> {
  log.info(
    { dryRun: cfg.dryRun, model: cfg.model, interval: cfg.intervalSeconds, batchCap: cfg.batchCap, since: cfg.since?.toISOString() ?? null },
    "newsdesk starting",
  );
  if (cfg.dryRun) log.warn("NEWSDESK_DRY_RUN is on — obituaries are logged, not generated or stored. Set NEWSDESK_DRY_RUN=false to generate.");
  if (cfg.dryRun === false && cfg.openrouterApiKey === "") {
    log.warn(
      "NEWSDESK_DRY_RUN is false but OPENROUTER_API_KEY is unset — live mode has no API key, " +
        "every target will burn an attempt into a failure stub instead of publishing.",
    );
  }
  if (cfg.since === null) {
    log.warn("NEWSDESK_SINCE is unset — the obituary pass is OFF. Set it to an ISO-8601 go-live timestamp to begin coverage.");
  } else {
    log.info({ since: cfg.since.toISOString() }, "obituary pass is on (forward-only from this cutoff)");
  }
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const r = await newsdeskTick(db, {
        client,
        dryRun: cfg.dryRun,
        since: cfg.since,
        batchCap: cfg.batchCap,
        maxAttempts: cfg.maxAttempts,
        promptVersion: OBITUARY_PROMPT_VERSION,
        model: cfg.model,
        now: new Date(),
        log,
      });
      if (r.generated || r.failed) log.info(r, "newsdesk tick");
    } catch (err) {
      log.error({ err }, "newsdesk tick failed");
    }
    await new Promise((r) => setTimeout(r, cfg.intervalSeconds * 1000));
  }
}

loop();
