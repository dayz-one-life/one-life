import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { user, avatars } from "@onelife/db";
import { eq } from "drizzle-orm";
import { createAuth, type Mailer } from "@onelife/auth";
import { buildApp } from "../src/app.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 8e8;
const email = `avatar${svc}@example.com`;
const noImageEmail = `avatarnoimg${svc}@example.com`;

let lastLink = "";
const captureMailer: Mailer = { async send(msg) { lastLink = msg.url; } };
const auth = createAuth(db, {
  secret: "s".repeat(32), baseURL: "http://localhost", trustedOrigins: ["http://localhost"],
  providers: {}, mailer: captureMailer,
});
const app = buildApp(db, {
  auth, corsOrigins: ["http://localhost"], vapidPublicKey: "TEST",
  // Test-only: lets fetchProviderImage reach the local http stub server below without TLS.
  // Never set in production — see avatar-store.ts's fetchProviderImage doc comment.
  avatarAllowTestFetchLoopback: true,
});

function cookieHeader(setCookie: string | string[] | undefined): string {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr.map((c) => c.split(";")[0]).join("; ");
}
async function signIn(addr: string): Promise<string> {
  await app.inject({
    method: "POST", url: "/api/auth/sign-in/magic-link",
    headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost" },
    payload: { email: addr },
  });
  const verify = await app.inject({
    method: "GET", url: lastLink.replace(/^https?:\/\/[^/]+/, ""), headers: { host: "localhost" },
  });
  return cookieHeader(verify.headers["set-cookie"] as string | string[] | undefined);
}

let cookie = "";
let noImageCookie = "";

// A tiny local HTTP stub, standing in for a provider's avatar URL. fetchProviderImage requires
// https for real provider hosts — this loopback (127.0.0.1) is the one carve-out, made only so
// this test can exercise the pipeline without standing up TLS.
let stubServer: http.Server;
let stubUrl: string;
let stub500Url: string;
let stub404Url: string;
let pngBuffer: Buffer;

beforeAll(async () => {
  pngBuffer = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 100, g: 150, b: 200 } },
  }).png().toBuffer();

  stubServer = http.createServer((req, res) => {
    if (req.url === "/fail") {
      res.writeHead(500);
      res.end("nope");
      return;
    }
    if (req.url === "/missing") {
      res.writeHead(404);
      res.end("gone");
      return;
    }
    res.writeHead(200, { "content-type": "image/png" });
    res.end(pngBuffer);
  });
  await new Promise<void>((resolve) => stubServer.listen(0, "127.0.0.1", resolve));
  const port = (stubServer.address() as AddressInfo).port;
  stubUrl = `http://127.0.0.1:${port}/avatar.png`;
  stub500Url = `http://127.0.0.1:${port}/fail`;
  stub404Url = `http://127.0.0.1:${port}/missing`;

  await app.ready();
  cookie = await signIn(email);
  noImageCookie = await signIn(noImageEmail);
});

afterAll(async () => {
  await app.close();
  await sql.end();
  await new Promise<void>((resolve) => stubServer.close(() => resolve()));
});

function buildMultipart(field: string, filename: string, contentType: string, data: Buffer): { body: Buffer; boundary: string } {
  const boundary = `----avatartest${Math.random().toString(16).slice(2)}`;
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  return { body: Buffer.concat([Buffer.from(head), data, Buffer.from(tail)]), boundary };
}

async function uploadPng(c: string, data: Buffer = pngBuffer) {
  const { body, boundary } = buildMultipart("file", "avatar.png", "image/png", data);
  return app.inject({
    method: "POST",
    url: "/me/avatar",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}`, cookie: c },
    payload: body,
  });
}

describe("avatar routes", () => {
  it("uploads, then serves the bytes back by hash with immutable caching", async () => {
    const res = await uploadPng(cookie);
    expect(res.statusCode).toBe(200);
    const { hash } = res.json();
    expect(hash).toMatch(/^[0-9a-f]{16}$/);

    const get = await app.inject({ method: "GET", url: `/avatars/${hash}.webp` });
    expect(get.statusCode).toBe(200);
    expect(get.headers["content-type"]).toBe("image/webp");
    expect(get.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("sync mirrors user.image through the pipeline", async () => {
    const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase()));
    await db.update(user).set({ image: stubUrl }).where(eq(user.id, u!.id));

    const res = await app.inject({ method: "POST", url: "/me/avatar/sync", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("sync 409s for a user with no provider image", async () => {
    const res = await app.inject({ method: "POST", url: "/me/avatar/sync", headers: { cookie: noImageCookie } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "no_provider_image" });
  });

  it("remove writes a tombstone and the old hash 404s only after the row changes", async () => {
    const upload = await uploadPng(cookie);
    const { hash } = upload.json();
    const before = await app.inject({ method: "GET", url: `/avatars/${hash}.webp` });
    expect(before.statusCode).toBe(200);

    const del = await app.inject({ method: "DELETE", url: "/me/avatar", headers: { cookie } });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ ok: true });

    const [row] = await db.select().from(avatars).where(eq(avatars.userId, (await db.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase())))[0]!.id));
    expect(row!.image).toBeNull();
    expect(row!.hash).toBeNull();

    const after = await app.inject({ method: "GET", url: `/avatars/${hash}.webp` });
    expect(after.statusCode).toBe(404);
  });

  it("explicit sync AFTER remove resurrects; getAvatarState flips to live", async () => {
    const del = await app.inject({ method: "DELETE", url: "/me/avatar", headers: { cookie } });
    expect(del.statusCode).toBe(200);

    const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase()));
    await db.update(user).set({ image: stubUrl }).where(eq(user.id, u!.id));

    const res = await app.inject({ method: "POST", url: "/me/avatar/sync", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const hash = res.json().hash;

    const [row] = await db.select().from(avatars).where(eq(avatars.userId, u!.id));
    expect(row!.image).not.toBeNull();
    expect(row!.hash).toBe(hash);

    const meRes = await app.inject({ method: "GET", url: "/me/avatar", headers: { cookie } });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().hash).toBe(hash);
  });

  // Upstream ANSWERED with a non-200 (Discord's avatar CDN URL rotated and the stored copy 404s,
  // or here a stubbed 500) — that's the account's state, not our infrastructure, so it's a 409
  // "provider_image_stale", not a 502. A failed sync leaves any existing row untouched.
  it("a failed sync (upstream non-200) leaves the existing avatar untouched", async () => {
    const upload = await uploadPng(cookie);
    const originalHash = upload.json().hash;

    const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase()));
    await db.update(user).set({ image: stub500Url }).where(eq(user.id, u!.id));

    const res = await app.inject({ method: "POST", url: "/me/avatar/sync", headers: { cookie } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "provider_image_stale" });

    const still = await app.inject({ method: "GET", url: `/avatars/${originalHash}.webp` });
    expect(still.statusCode).toBe(200);

    const [row] = await db.select().from(avatars).where(eq(avatars.userId, u!.id));
    expect(row!.hash).toBe(originalHash);
  });

  it("maps an upstream non-200 to 409 provider_image_stale, not a 502", async () => {
    const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase()));
    await db.update(user).set({ image: stub404Url }).where(eq(user.id, u!.id));

    const res = await app.inject({ method: "POST", url: "/me/avatar/sync", headers: { cookie } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "provider_image_stale" });
  });

  it("keeps 502 fetch_failed for a connection failure", async () => {
    const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase()));
    // Loopback, but nothing is listening — a real connection failure, not an upstream answer.
    await db.update(user).set({ image: "http://127.0.0.1:1/avatar.png" }).where(eq(user.id, u!.id));

    const res = await app.inject({ method: "POST", url: "/me/avatar/sync", headers: { cookie } });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: "fetch_failed" });
  });

  it("rejects an unsessioned caller on every /me route", async () => {
    expect((await app.inject({ method: "GET", url: "/me/avatar" })).statusCode).toBe(401);
    expect((await app.inject({ method: "DELETE", url: "/me/avatar" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/me/avatar/sync" })).statusCode).toBe(401);
    const { body, boundary } = buildMultipart("file", "avatar.png", "image/png", pngBuffer);
    const res = await app.inject({
      method: "POST", url: "/me/avatar",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it("400s a non-image upload", async () => {
    const res = await uploadPng(cookie, Buffer.from("not an image, definitely not"));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("not_an_image");
  });

  // The transport limit (@fastify/multipart's `limits.fileSize` in app.ts) is wired to the same
  // AVATAR_MAX_BYTES constant the pipeline enforces, so an oversized upload is rejected mid-stream
  // rather than fully buffered first. This exercises that transport path, not the pipeline's own
  // byteLength check (processAvatarImage never sees the body).
  it("400s an upload over the 5MB limit without buffering the whole body", async () => {
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1024, 1);
    const res = await uploadPng(cookie, oversized);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("too_large");
  });

  it("404s an unknown hash", async () => {
    const res = await app.inject({ method: "GET", url: "/avatars/0000000000000000.webp" });
    expect(res.statusCode).toBe(404);
  });

  it("404s a malformed hash param", async () => {
    const res = await app.inject({ method: "GET", url: "/avatars/not-a-hash.webp" });
    expect(res.statusCode).toBe(404);
  });
});
