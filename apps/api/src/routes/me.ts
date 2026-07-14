import type { FastifyInstance } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import type { Auth } from "@onelife/auth";
import { getSession } from "../auth-plugin.js";

export function registerMeRoute(app: FastifyInstance, auth: Auth): void {
  app.get("/me", async (request, reply) => {
    const session = await getSession(auth, request);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const accounts = await auth.api.listUserAccounts({
      headers: fromNodeHeaders(request.headers),
    });
    return { user: session.user, accounts };
  });
}
