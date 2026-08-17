import pino from "pino";
import { getDb } from "@onelife/db";
import { createAuth, loadAuthConfig } from "@onelife/auth";
import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { autoPopulateAvatar } from "./lib/avatar-autopopulate.js";
import { createStripeGateway } from "./lib/stripe-gateway.js";

const cfg = loadConfig(process.env);
const log = pino({ level: cfg.logLevel });
const { db } = getDb(cfg.databaseUrl);
const authCfg = loadAuthConfig(process.env);
const auth = createAuth(db, authCfg, {
  onSessionCreated: (userId) => {
    // Fire-and-forget: never awaited, and any rejection is already swallowed inside
    // autoPopulateAvatar — a login must not block or fail on avatar work.
    // allowTestHosts is always false here in production (cfg.avatarTestFetchAllowLoopback
    // defaults off) — the flag exists only so tests can exercise this path.
    void autoPopulateAvatar(db, userId, { allowTestHosts: cfg.avatarTestFetchAllowLoopback });
  },
});
// The onelife-api unit has its own EnvironmentFile (deploy/README.md), so this key going
// missing here while the notifier has it is a live deployment shape. Every downstream
// symptom is silent — GET /push/vapid-key serves "", pushManager.subscribe() throws, and
// the notifier logs a clean sweep because it finds no subscriptions to deliver to. This
// line is the only place the operator can find out.
if (!cfg.vapidPublicKey) {
  log.warn("VAPID_PUBLIC_KEY is unset — push notifications cannot be enabled by any user");
}

const stripeEnvCount = [process.env.STRIPE_SECRET_KEY, process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_TOKEN_PRICE_ID].filter(Boolean).length;
if (cfg.stripe === null && stripeEnvCount > 0) {
  log.warn("Stripe env is partially set — the token store is OFF (needs STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_TOKEN_PRICE_ID)");
}
// An active floor locks older app builds out of the product entirely, so say so at boot —
// and say so when a value was REJECTED, because config falls back to 0.0.0 silently rather
// than refusing to start, and a typo'd floor otherwise looks identical to an unset one.
for (const [platform, raw] of [["ios", process.env.IOS_MIN_APP_VERSION], ["android", process.env.ANDROID_MIN_APP_VERSION]] as const) {
  const floor = cfg.minAppVersion[platform];
  if (raw && floor === "0.0.0") {
    log.warn({ platform, value: raw }, "min app version is not a dotted numeric version — ignored, the update gate is OFF for this platform");
  } else if (floor !== "0.0.0") {
    log.info({ platform, minimumVersion: floor }, "update gate active — older app builds will be told to update");
  }
}

const stripe = cfg.stripe ? createStripeGateway(cfg.stripe) : undefined;

const app = buildApp(db, {
  auth, authConfig: authCfg, corsOrigins: cfg.corsOrigins,
  vapidPublicKey: cfg.vapidPublicKey,
  stripe,
}, cfg.minAppVersion);

app.listen({ port: cfg.port, host: "0.0.0.0" })
  .then((addr) => log.info({ addr }, "api listening"))
  .catch((err) => { log.fatal({ err }, "api failed to start"); process.exit(1); });
