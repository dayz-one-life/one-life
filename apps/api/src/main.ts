import pino from "pino";
import { getDb } from "@onelife/db";
import { createAuth, loadAuthConfig } from "@onelife/auth";
import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { autoPopulateAvatar } from "./lib/avatar-autopopulate.js";

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

const app = buildApp(db, {
  auth, authConfig: authCfg, corsOrigins: cfg.corsOrigins,
  vapidPublicKey: cfg.vapidPublicKey,
});

app.listen({ port: cfg.port, host: "0.0.0.0" })
  .then((addr) => log.info({ addr }, "api listening"))
  .catch((err) => { log.fatal({ err }, "api failed to start"); process.exit(1); });
