import pino from "pino";
import { getDb } from "@onelife/db";
import { createAuth, loadAuthConfig } from "@onelife/auth";
import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";

const cfg = loadConfig(process.env);
const log = pino({ level: cfg.logLevel });
const { db } = getDb(cfg.databaseUrl);
const authCfg = loadAuthConfig(process.env);
const auth = createAuth(db, authCfg);
const app = buildApp(db, { auth, authConfig: authCfg, corsOrigins: cfg.corsOrigins });

app.listen({ port: cfg.port, host: "0.0.0.0" })
  .then((addr) => log.info({ addr }, "api listening"))
  .catch((err) => { log.fatal({ err }, "api failed to start"); process.exit(1); });
