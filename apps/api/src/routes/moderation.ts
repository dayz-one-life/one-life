import type { FastifyInstance } from "fastify";
import { desc, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@onelife/db";
import { avatarReports, blockedAvatarHashes } from "@onelife/db";
import type { Auth } from "@onelife/auth";
import { requireModerator } from "../auth-plugin.js";
import { unbanAvatarHash, confirmAvatarHashBan, getAvatarBytesForModeration } from "../lib/avatar-store.js";

const HASH_RE = /^[0-9a-f]{16,64}$/;

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
      // ⚠️ 'allowed' rows are a moderator's own restore decision, not a pending one. They live in
      // this table so a later report cannot silently re-hide the image; they must not read back
      // as queue entries.
      .where(ne(blockedAvatarHashes.state, "allowed"))
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

  /**
   * The image under review. Moderation is the ONE reader that must see banned bytes: the ban is
   * exactly what makes `GET /avatars/:hash.webp` 404, so without this the moderator would decide
   * Restore vs Confirm blind. Behind `requireModerator` like every other route here, and
   * `no-store` because this is moderation data that must never sit in a cache.
   */
  app.get("/moderation/hashes/:hash/image", async (request, reply) => {
    const mod = await requireModerator(auth, request, moderatorUserIds);
    if (!mod.ok) return reply.code(mod.status).send({ error: mod.error });

    const parsed = z.string().regex(HASH_RE).safeParse((request.params as { hash: string }).hash);
    if (!parsed.success) return reply.code(404).send({ error: "not_found" });

    // 404 rather than 500 once a confirm has NULLed the bytes — there is genuinely nothing left.
    const image = await getAvatarBytesForModeration(db, parsed.data);
    if (!image) return reply.code(404).send({ error: "not_found" });

    reply.header("content-type", "image/webp");
    reply.header("cache-control", "no-store");
    return reply.send(image);
  });

  app.post("/moderation/hashes/:hash/restore", async (request, reply) => {
    const mod = await requireModerator(auth, request, moderatorUserIds);
    if (!mod.ok) return reply.code(mod.status).send({ error: mod.error });
    const { hash } = request.params as { hash: string };
    await unbanAvatarHash(db, hash, mod.userId);
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
