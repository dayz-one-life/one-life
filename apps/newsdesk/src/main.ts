import pino from "pino";
import { getDb } from "@onelife/db";
import { loadConfig } from "./config.js";
import { newsdeskTick } from "./tick.js";
import { birthNoticeTick } from "./birth-tick.js";
import { imageTick } from "./image-tick.js";
import { openrouterClient, openrouterImageClient } from "./openrouter.js";
import { OBITUARY_PROMPT_VERSION } from "./prompt.js";
import { BIRTH_PROMPT_VERSION } from "./birth-prompt.js";
import { notifyDiscord } from "./notify.js";
import { findUnpostedObituaries, markObituaryPosted } from "./pg-store.js";
import { postToDiscordWebhook } from "./discord.js";

const cfg = loadConfig(process.env);
const log = pino({ level: cfg.logLevel });
const { db } = getDb(cfg.databaseUrl);
const client = openrouterClient({ apiKey: cfg.openrouterApiKey, model: cfg.model, temperature: cfg.temperature });
const imageClient = openrouterImageClient({ apiKey: cfg.openrouterApiKey, quality: cfg.imageQuality });

async function loop(): Promise<void> {
  log.info(
    { dryRun: cfg.dryRun, model: cfg.model, interval: cfg.intervalSeconds, batchCap: cfg.batchCap, birthSince: cfg.birthSince?.toISOString() ?? null },
    "newsdesk starting",
  );
  if (cfg.dryRun) log.warn("NEWSDESK_DRY_RUN is on — obituaries and birth notices are logged, not generated or stored. Set NEWSDESK_DRY_RUN=false to generate.");
  if (!cfg.discordWebhookUrl) log.info("DISCORD_OBITUARY_WEBHOOK_URL is empty — Discord obituary notifier disabled.");
  if (cfg.birthSince === null) {
    log.warn("NEWSDESK_BIRTH_SINCE is unset — the birth-notice pass is OFF. Set it to an ISO-8601 go-live timestamp to begin coverage.");
  } else {
    log.info({ birthSince: cfg.birthSince.toISOString() }, "birth-notice pass is on (forward-only from this cutoff)");
  }
  if (!cfg.imagesEnabled) log.warn("NEWSDESK_IMAGES_ENABLED=false — the article-image pass is OFF.");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Obituary pass.
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

    // Birth pass (a no-op when birthSince is null — birthNoticeTick short-circuits to zeros).
    try {
      const br = await birthNoticeTick(db, {
        client,
        dryRun: cfg.dryRun,
        batchCap: cfg.batchCap,
        maxAttempts: cfg.maxAttempts,
        promptVersion: BIRTH_PROMPT_VERSION,
        model: cfg.model,
        now: new Date(),
        log,
        since: cfg.birthSince,
      });
      if (br.generated || br.failed) log.info(br, "birth notice tick");
    } catch (err) {
      log.error({ err }, "birth notice tick failed");
    }

    // Discord obituary notifier (a no-op when the webhook URL is empty).
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

    // Image pass (both kinds; a no-op when NEWSDESK_IMAGES_ENABLED=false).
    try {
      const ir = await imageTick(db, {
        client, imageClient,
        enabled: cfg.imagesEnabled, dryRun: cfg.dryRun,
        batchCap: cfg.batchCap, maxAttempts: cfg.maxAttempts,
        model: cfg.imageModel, flagshipModel: cfg.imageFlagshipModel,
        now: new Date(), log,
      });
      if (ir.generated || ir.failed) log.info(ir, "image tick");
    } catch (err) {
      log.error({ err }, "image tick failed");
    }

    await new Promise((r) => setTimeout(r, cfg.intervalSeconds * 1000));
  }
}

loop();
