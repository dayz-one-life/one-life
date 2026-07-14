import type { FastifyInstance, FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import type { Auth } from "@onelife/auth";

/** Mounts the Better Auth handler at /api/auth/* (all methods). */
export function registerAuthHandler(app: FastifyInstance, auth: Auth): void {
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const req = new Request(url.toString(), {
        method: request.method,
        headers: fromNodeHeaders(request.headers),
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      const response = await auth.handler(req);
      reply.status(response.status);
      // Forward all headers, preserving multiple Set-Cookie entries (a single
      // comma-joined header would corrupt cookie parsing).
      const setCookies =
        (response.headers as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== "set-cookie") reply.header(key, value);
      });
      for (const cookie of setCookies) reply.header("set-cookie", cookie);
      return reply.send(response.body ? await response.text() : null);
    },
  });
}

/** Resolves the current session from cookie or bearer token, or null. */
export function getSession(auth: Auth, request: FastifyRequest) {
  return auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
}
