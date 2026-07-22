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
import { registerBirthNoticesRoutes } from "./routes/birth-notices.js";
import { registerNewsRoutes } from "./routes/news.js";
import { registerFreshSpawnsRoutes } from "./routes/fresh-spawns.js";
import { registerMediaRoutes } from "./routes/media.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import { registerLifeTrackRoutes } from "./routes/life-track.js";

export interface AuthOptions {
  auth: Auth;
  authConfig?: AuthConfig;
  corsOrigins: string[];
  vapidPublicKey?: string;
}

// `newsPreviewToken` rides outside AuthOptions on purpose: news is a public route family that
// registers whether or not auth is configured, so its config must not be gated on `opts`.
export function buildApp(db: Database, opts?: AuthOptions, newsPreviewToken = ""): FastifyInstance {
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
    registerNotificationRoutes(app, db, opts.auth, opts.vapidPublicKey ?? "");
    registerLifeTrackRoutes(app, db, opts.auth);
  }
  registerServerRoutes(app, db);
  registerPlayerRoutes(app, db);
  registerBoardRoutes(app, db);
  registerPlayerAggregateRoutes(app, db);
  registerGlobalRoutes(app, db);
  registerSurvivorsRoutes(app, db);
  registerObituariesRoutes(app, db);
  registerBirthNoticesRoutes(app, db);
  registerNewsRoutes(app, db, newsPreviewToken);
  registerFreshSpawnsRoutes(app, db);
  registerMediaRoutes(app, db);
  return app;
}
