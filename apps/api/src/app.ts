import Fastify, { type FastifyInstance, type FastifyError } from "fastify";
import fastifyCors from "@fastify/cors";
import type { Database } from "@onelife/db";
import type { Auth, AuthConfig } from "@onelife/auth";
import { registerServerRoutes } from "./routes/servers.js";
import { registerPlayerRoutes } from "./routes/players.js";
import { registerBoardRoutes } from "./routes/boards.js";
import { registerAuthHandler } from "./auth-plugin.js";
import { registerMeRoute } from "./routes/me.js";
import { registerGamertagLinkRoutes } from "./routes/gamertag-links.js";
import { registerTokenRoutes } from "./routes/tokens.js";
import { registerPlayerAggregateRoutes } from "./routes/player-aggregate.js";
import { registerGlobalRoutes } from "./routes/global.js";
import { registerAuthMethodsRoute } from "./routes/auth-methods.js";
import { registerSurvivorsRoutes } from "./routes/survivors.js";
import { registerObituariesRoutes } from "./routes/obituaries.js";

export interface AuthOptions {
  auth: Auth;
  authConfig?: AuthConfig;
  corsOrigins: string[];
}

export function buildApp(db: Database, opts?: AuthOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  app.setErrorHandler<FastifyError>((err, _req, reply) => {
    if ((err as any).statusCode === 400 || err.validation) return reply.code(400).send({ error: "bad_request", message: err.message });
    reply.code(500).send({ error: "internal_error" });
  });
  if (opts) {
    app.register(fastifyCors, { origin: opts.corsOrigins, credentials: true });
    if (opts.authConfig) registerAuthMethodsRoute(app, opts.authConfig);
    registerAuthHandler(app, opts.auth);
    registerMeRoute(app, opts.auth);
    registerGamertagLinkRoutes(app, db, opts.auth);
    registerTokenRoutes(app, db, opts.auth);
  }
  registerServerRoutes(app, db);
  registerPlayerRoutes(app, db);
  registerBoardRoutes(app, db);
  registerPlayerAggregateRoutes(app, db);
  registerGlobalRoutes(app, db);
  registerSurvivorsRoutes(app, db);
  registerObituariesRoutes(app, db);
  return app;
}
