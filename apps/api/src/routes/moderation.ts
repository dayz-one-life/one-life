import type { FastifyInstance } from "fastify";
import { desc, inArray } from "drizzle-orm";
import type { Database } from "@onelife/db";
import { avatarReports, blockedAvatarHashes } from "@onelife/db";
import type { Auth } from "@onelife/auth";
import { requireModerator } from "../auth-plugin.js";
import { unbanAvatarHash, confirmAvatarHashBan } from "../lib/avatar-store.js";

export function registerModerationRoutes(
  app: FastifyInstance,
  db: Database,
  auth: Auth,
  moderatorUserIds: string[],
): void {
  app.get("/moderation/queue", async (request, reply) => {
    const mod = await requireModerator(auth, request, moderatorUserIds);
    if (!mod.ok) return reply.code(mod.status).send({ error: mod.error });

    const bans = await db
      .select({ hash: blockedAvatarHashes.hash, state: blockedAvatarHashes.state, blockedAt: blockedAvatarHashes.blockedAt })
      .from(blockedAvatarHashes)
      .orderBy(desc(blockedAvatarHashes.blockedAt));
    if (bans.length === 0) return { entries: [] };

    const reports = await db
      .select({ hash: avatarReports.subjectHash, reason: avatarReports.reason })
      .from(avatarReports)
      .where(inArray(avatarReports.subjectHash, bans.map((b) => b.hash)));

    const byHash = new Map<string, string[]>();
    for (const r of reports) {
      const list = byHash.get(r.hash) ?? [];
      list.push(r.reason);
      byHash.set(r.hash, list);
    }

    return {
      entries: bans.map((b) => ({
        hash: b.hash,
        state: b.state,
        blockedAt: b.blockedAt.toISOString(),
        reportCount: byHash.get(b.hash)?.length ?? 0,
        reasons: Array.from(new Set(byHash.get(b.hash) ?? [])),
      })),
    };
  });

  app.post("/moderation/hashes/:hash/restore", async (request, reply) => {
    const mod = await requireModerator(auth, request, moderatorUserIds);
    if (!mod.ok) return reply.code(mod.status).send({ error: mod.error });
    const { hash } = request.params as { hash: string };
    await unbanAvatarHash(db, hash);
    return { ok: true };
  });

  app.post("/moderation/hashes/:hash/confirm", async (request, reply) => {
    const mod = await requireModerator(auth, request, moderatorUserIds);
    if (!mod.ok) return reply.code(mod.status).send({ error: mod.error });
    const { hash } = request.params as { hash: string };
    await confirmAvatarHashBan(db, hash, mod.userId);
    return { ok: true };
  });
}
