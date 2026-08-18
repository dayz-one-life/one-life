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

/**
 * Resolve the caller only if they are a configured moderator.
 *
 * ⚠️ An empty `moderatorUserIds` denies everyone. Authority comes from an env var rather than a
 * database role deliberately: there is no one to grant roles to and no UI to grant them with, so
 * a role column would be a migration plus hand-written SQL for the same result — with a
 * privilege-escalation path an env var does not have.
 *
 * ⚠️ 401 for signed-out, 403 for signed-in-but-not-a-moderator. Distinguishing them is
 * deliberate: a signed-in user needs to know they are signed in and simply not permitted, and
 * moderator membership is not a secret worth hiding behind a 404.
 *
 * Returns a discriminated result rather than writing to the reply, so each handler stays a
 * plain `return reply.code(...).send(...)` — Fastify's contract is that a handler returns its
 * payload, and a helper that half-writes the reply makes that ambiguous.
 */
export async function requireModerator(
  auth: Auth,
  request: FastifyRequest,
  moderatorUserIds: string[],
): Promise<{ ok: true; userId: string } | { ok: false; status: 401 | 403; error: string }> {
  const session = await getSession(auth, request);
  if (!session) return { ok: false, status: 401, error: "unauthorized" };
  if (!moderatorUserIds.includes(session.user.id)) return { ok: false, status: 403, error: "forbidden" };
  return { ok: true, userId: session.user.id };
}
