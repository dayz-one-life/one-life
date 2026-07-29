import type { FastifyInstance } from "fastify";
import type { Database } from "@onelife/db";
import type { Auth } from "@onelife/auth";
import { z } from "zod";
import { getSession } from "../auth-plugin.js";
import { AvatarImageError, processAvatarImage } from "../lib/avatar-image.js";
import {
  fetchProviderImage,
  getAvatarByHash,
  getAvatarHash,
  tombstoneAvatar,
  upsertAvatar,
} from "../lib/avatar-store.js";

const HASH_FILE_RE = /^[0-9a-f]{16}\.webp$/;

export function registerAvatarRoutes(
  app: FastifyInstance,
  db: Database,
  auth: Auth,
  opts?: { allowTestHosts?: boolean },
): void {
  // GET /me/avatar — no subject parameter; the session is the only input.
  app.get("/me/avatar", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    reply.header("cache-control", "no-store, private");
    return { hash: await getAvatarHash(db, session.user.id) };
  });

  app.post("/me/avatar", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });

    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "not_an_image" });

    let raw: Buffer;
    try {
      raw = await file.toBuffer();
    } catch (err) {
      // @fastify/multipart's own transport-level cap (registered with limits.fileSize ===
      // AVATAR_MAX_BYTES in app.ts, the same constant the pipeline enforces) throws
      // FST_REQ_FILE_TOO_LARGE mid-stream, before the whole oversized body is ever buffered.
      if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
        return reply.code(400).send({ error: "too_large" });
      }
      throw err;
    }

    try {
      const { image, hash } = await processAvatarImage(raw);
      await upsertAvatar(db, session.user.id, { image, hash, source: "upload" });
      return { hash };
    } catch (err) {
      if (err instanceof AvatarImageError) return reply.code(400).send({ error: err.code });
      throw err;
    }
  });

  app.post("/me/avatar/sync", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });

    const providerImage = session.user.image;
    if (!providerImage) return reply.code(409).send({ error: "no_provider_image" });

    let raw: Buffer;
    try {
      raw = await fetchProviderImage(providerImage, { allowTestHosts: opts?.allowTestHosts });
    } catch (err) {
      // A failed sync leaves any existing row untouched — nothing is written below this point.
      // Upstream answered with a 4xx (Discord rotates avatar CDN URLs, and the copy stored at
      // sign-in eventually 404s): that's the ACCOUNT's state, not our infrastructure — 409, like
      // no_provider_image. A 5xx is the PROVIDER's own transient failure, not the account's — the
      // "try again" advice on the 502 branch is only honest there, so a 5xx stays 502, same as a
      // network/timeout/allowlist failure.
      const statusMatch = err instanceof Error && err.message.match(/^fetch_failed_status_(\d+)$/);
      const status = statusMatch ? Number(statusMatch[1]) : null;
      if (status !== null && status >= 400 && status < 500) {
        return reply.code(409).send({ error: "provider_image_stale" });
      }
      return reply.code(502).send({ error: "fetch_failed" });
    }

    try {
      const { image, hash } = await processAvatarImage(raw);
      await upsertAvatar(db, session.user.id, { image, hash, source: "provider" });
      return { hash };
    } catch (err) {
      if (err instanceof AvatarImageError) return reply.code(400).send({ error: err.code });
      throw err;
    }
  });

  app.delete("/me/avatar", async (req, reply) => {
    const session = await getSession(auth, req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    await tombstoneAvatar(db, session.user.id);
    return { ok: true };
  });
}

/**
 * Public, hash-addressed, cached forever — a hash is content-derived, so a fixed URL never needs
 * revalidation once it exists. Split from registerAvatarRoutes (which needs a session-backed
 * Auth instance) so it can be registered unconditionally in app.ts, alongside the other public
 * routes, rather than inside the auth-only `if (opts)` block.
 */
export function registerPublicAvatarRoutes(app: FastifyInstance, db: Database): void {
  app.get("/avatars/:hashfile", async (req, reply) => {
    const parsed = z.string().regex(HASH_FILE_RE).safeParse((req.params as { hashfile: string }).hashfile);
    if (!parsed.success) return reply.code(404).send();
    const hash = parsed.data.replace(/\.webp$/, "");

    const image = await getAvatarByHash(db, hash);
    if (!image) return reply.code(404).send();

    reply.header("content-type", "image/webp");
    reply.header("cache-control", "public, max-age=31536000, immutable");
    return reply.send(image);
  });
}
