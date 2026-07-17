import pino from "pino";
import { getDb } from "@onelife/db";
import { loadConfig } from "./config.js";
import { newsdeskTick } from "./tick.js";
import { openrouterClient } from "./openrouter.js";
import { OBITUARY_PROMPT_VERSION } from "./prompt.js";
import { notifyDiscord } from "./notify.js";
import { findUnpostedObituaries, markObituaryPosted } from "./pg-store.js";
import { postToDiscordWebhook } from "./discord.js";

const cfg = loadConfig(process.env);
const log = pino({ level: cfg.logLevel });
const { db } = getDb(cfg.databaseUrl);
const client = openrouterClient({ apiKey: cfg.openrouterApiKey, model: cfg.model, temperature: cfg.temperature });

async function loop(): Promise<void> {
  log.info({ dryRun: cfg.dryRun, model: cfg.model, interval: cfg.intervalSeconds, batchCap: cfg.batchCap }, "newsdesk starting");
  if (cfg.dryRun) log.warn("NEWSDESK_DRY_RUN is on — obituaries are logged, not generated or stored. Set NEWSDESK_DRY_RUN=false to generate.");
  if (!cfg.discordWebhookUrl) log.info("DISCORD_OBITUARY_WEBHOOK_URL is empty — Discord obituary notifier disabled.");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const r = await newsdeskTick(db, {
        client,
        dryRun: cfg.dryRun,
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
    try {
      const nd = await notifyDiscord(db, {
        webhookUrl: cfg.discordWebhookUrl,
        siteUrl: cfg.siteUrl,
        maxPerTick: cfg.discordMaxPerTick,
        dryRun: cfg.dryRun,
        now: new Date(),
        log,
        store: { findUnpostedObituaries, markObituaryPosted },
        post: (webhookUrl, content) => postToDiscordWebhook(webhookUrl, content, { fetch }),
      });
      if (nd.posted || nd.failed) log.info(nd, "discord notify tick");
    } catch (err) {
      log.error({ err }, "discord notify failed");
    }
    await new Promise((r) => setTimeout(r, cfg.intervalSeconds * 1000));
  }
}

loop();
