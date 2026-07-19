import pino from "pino";
import { getDb } from "@onelife/db";
import { loadConfig } from "./config.js";
import { generateTick } from "./generate.js";
import { pushTick } from "./push.js";
import { webPushSender } from "./sender.js";
import * as pushStore from "./push-store.js";
import { gamertagVerifiedGenerator, tokensGenerator } from "./generators/account.js";
import { banAppliedGenerator, banLiftedGenerator } from "./generators/bans.js";
import { lifeQualifiedGenerator, survivalMilestoneGenerator } from "./generators/lives.js";
import { articleGenerator } from "./generators/articles.js";

const cfg = loadConfig(process.env);
const log = pino({ level: cfg.logLevel });
const { db } = getDb(cfg.databaseUrl);

const generators = [
  gamertagVerifiedGenerator,
  tokensGenerator,
  banAppliedGenerator,
  banLiftedGenerator,
  lifeQualifiedGenerator,
  survivalMilestoneGenerator,
  articleGenerator,
];

const hasVapid = Boolean(cfg.vapidPublicKey && cfg.vapidPrivateKey && cfg.vapidSubject);
const send = hasVapid
  ? webPushSender({ publicKey: cfg.vapidPublicKey, privateKey: cfg.vapidPrivateKey, subject: cfg.vapidSubject })
  : null;

async function loop(): Promise<void> {
  log.info({ interval: cfg.intervalSeconds, dryRun: cfg.dryRun, since: cfg.since?.toISOString() ?? null }, "notifier starting");
  if (cfg.dryRun) log.warn("NOTIFIER_DRY_RUN is true — no notifications will be written");
  if (!cfg.since) log.warn("NOTIFIER_SINCE is unset — generation is OFF");
  if (cfg.pushEnabled && !send) log.warn("VAPID keys are not configured — push is OFF");

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const r = await generateTick(db, {
        generators, now: new Date(), since: cfg.since,
        lookbackHours: cfg.lookbackHours, siteUrl: cfg.siteUrl,
        dryRun: cfg.dryRun, log,
      });
      if (r.drafts || r.inserted) log.info(r, "notifications generated");
    } catch (err) {
      log.error({ err }, "notifier generate tick failed");
    }

    // Push is a separate try/catch so a broken push pipeline can never stop generation.
    try {
      const r = await pushTick(db, {
        now: new Date(), maxPerTick: cfg.pushMaxPerTick, maxAgeMinutes: cfg.pushMaxAgeMinutes,
        enabled: cfg.pushEnabled && send !== null, dryRun: cfg.dryRun, log,
        store: pushStore, send: send ?? (async () => ({ ok: false, gone: false, error: "no vapid" })),
      });
      if (r.sent || r.failed) log.info(r, "notifications pushed");
    } catch (err) {
      log.error({ err }, "notifier push tick failed");
    }

    await new Promise((r) => setTimeout(r, cfg.intervalSeconds * 1000));
  }
}

loop();
