import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import type { Auth } from "@onelife/auth";
import { z } from "zod";
import { getSharePresence, setSharePresence, getShareLocation, setShareLocation } from "@onelife/friends";
import { getSession } from "../auth-plugin.js";

const prefsBody = z.object({
  sharePresence: z.boolean().optional(),
  shareLocation: z.boolean().optional(),
});

export function registerPreferenceRoutes(app: FastifyInstance, db: Database, auth: Auth): void {
  app.get("/me/preferences", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    return {
      sharePresence: await getSharePresence(db, session.user.id),
      shareLocation: await getShareLocation(db, session.user.id),
    };
  });

  app.patch("/me/preferences", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const body = prefsBody.parse(req.body ?? {});
    if (body.sharePresence !== undefined) {
      await setSharePresence(db, { userId: session.user.id, sharePresence: body.sharePresence });
    }
    if (body.shareLocation !== undefined) {
      await setShareLocation(db, { userId: session.user.id, shareLocation: body.shareLocation });
    }
    return {
      sharePresence: await getSharePresence(db, session.user.id),
      shareLocation: await getShareLocation(db, session.user.id),
    };
  });
}
