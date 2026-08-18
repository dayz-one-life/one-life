import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@onelife/db";
import type { Auth } from "@onelife/auth";
import { getSession } from "../auth-plugin.js";
import { REPORT_REASONS, reportAvatar } from "../lib/moderation.js";

const bodySchema = z.object({
  // ⚠️ The bytes the caller actually saw. No owner id: the dossier does not publish user ids,
  // and the ban is on the image regardless of who holds it.
  subjectHash: z.string().min(1),
  reason: z.enum(REPORT_REASONS),
});

const STATUS: Record<string, number> = {
  not_verified: 403, unknown_hash: 404, already_reported: 409, rate_limited: 429, self: 400,
};

export function registerReportRoutes(app: FastifyInstance, db: Database, auth: Auth): void {
  app.post("/me/reports/avatar", async (request, reply) => {
    // ⚠️ Session first, body second — reversed, an unauthenticated caller could tell a valid
    // session from an invalid one by the status code.
    const session = await getSession(auth, request);
    if (!session) return reply.code(401).send({ error: "unauthorized" });

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });

    const result = await reportAvatar(db, session.user.id, parsed.data.subjectHash, parsed.data.reason);
    if ("error" in result) return reply.code(STATUS[result.error] ?? 400).send({ error: result.error });
    return reply.code(201).send({ ok: true });
  });
}
