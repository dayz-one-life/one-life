import type { FastifyInstance } from "fastify";
import { enabledAuthMethods, type AuthConfig } from "@onelife/auth";

/**
 * Exposes which sign-in methods are configured so the login UI can hide the rest.
 * Mounted as a static route; find-my-way matches it before the /api/auth/* Better
 * Auth catch-all. Public (no session) — it reveals only method names, no secrets.
 */
export function registerAuthMethodsRoute(app: FastifyInstance, cfg: AuthConfig): void {
  app.get("/api/auth/providers", async () => enabledAuthMethods(cfg));
}
