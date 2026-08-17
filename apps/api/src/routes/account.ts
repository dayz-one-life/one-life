import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@onelife/db";
import { deleteAccount, type Auth } from "@onelife/auth";
import { getSession } from "../auth-plugin.js";

// ⚠️ An EXACT, case-sensitive match on the literal string. Not a boolean, not a
// case-insensitive compare: the whole point is that the user typed this word deliberately.
const bodySchema = z.object({ confirm: z.literal("DELETE") });

export function registerAccountRoutes(app: FastifyInstance, db: Database, auth: Auth): void {
  // Takes NO subject parameter — the session is the only input, so deleting someone else's
  // account is unexpressible rather than merely rejected (repo house rule for /me routes).
  app.delete("/me", async (request, reply) => {
    // ⚠️ Session first, body second. Reversing these lets an unauthenticated caller tell a
    // valid session from an invalid one by the status code they get back.
    const session = await getSession(auth, request);
    if (!session) return reply.code(401).send({ error: "unauthorized" });

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "confirmation_required" });

    const summary = await deleteAccount(db, session.user.id);
    return { ok: true, ...summary };
  });
}
