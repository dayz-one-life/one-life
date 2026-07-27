import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { user, avatars } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";
import { autoPopulateAvatar } from "../src/lib/avatar-autopopulate.js";

const { db, sql } = getTestDb();

// A tiny local HTTP stub, standing in for a provider's avatar URL — mirrors the pattern in
// avatar-routes.test.ts. fetchProviderImage requires https for real provider hosts; this
// loopback (127.0.0.1) is the one carve-out, made only so this test can avoid standing up TLS.
let stubServer: http.Server;
let stubUrl: string;
let stubFailUrl: string;
let pngBuffer: Buffer;

beforeAll(async () => {
  pngBuffer = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 10, g: 20, b: 30 } },
  }).png().toBuffer();

  stubServer = http.createServer((req, res) => {
    if (req.url === "/fail") {
      res.writeHead(500);
      res.end("nope");
      return;
    }
    res.writeHead(200, { "content-type": "image/png" });
    res.end(pngBuffer);
  });
  await new Promise<void>((resolve) => stubServer.listen(0, "127.0.0.1", resolve));
  const port = (stubServer.address() as AddressInfo).port;
  stubUrl = `http://127.0.0.1:${port}/avatar.png`;
  stubFailUrl = `http://127.0.0.1:${port}/fail`;
});

afterAll(async () => {
  await sql.end();
  await new Promise<void>((resolve) => stubServer.close(() => resolve()));
});

let seq = 0;
async function makeUser(image: string | null): Promise<string> {
  seq += 1;
  const id = `autopop-user-${Date.now()}-${seq}`;
  await db.insert(user).values({ id, name: "x", email: `${id}@example.com`, image });
  return id;
}

async function avatarRow(userId: string) {
  const [row] = await db.select().from(avatars).where(eq(avatars.userId, userId));
  return row;
}

describe("autoPopulateAvatar", () => {
  it("mirrors the provider image for a first-time user", async () => {
    const userId = await makeUser(stubUrl);

    await autoPopulateAvatar(db, userId, { allowTestHosts: true });

    const row = await avatarRow(userId);
    expect(row).toBeDefined();
    expect(row?.image).not.toBeNull();
    expect(row?.source).toBe("provider");
  });

  it("does nothing when user.image is null", async () => {
    const userId = await makeUser(null);

    await autoPopulateAvatar(db, userId, { allowTestHosts: true });

    const row = await avatarRow(userId);
    expect(row).toBeUndefined();
  });

  it("does nothing when a live avatar already exists (no overwrite)", async () => {
    const userId = await makeUser(stubUrl);
    await db.insert(avatars).values({
      userId,
      image: Buffer.from("existing"),
      hash: "existinghash",
      source: "upload",
      updatedAt: new Date(),
    });

    await autoPopulateAvatar(db, userId, { allowTestHosts: true });

    const row = await avatarRow(userId);
    expect(row?.image?.toString()).toBe("existing");
    expect(row?.source).toBe("upload");
  });

  it("NEVER resurrects a tombstone", async () => {
    const userId = await makeUser(stubUrl);
    // Tombstone: same row, nulled fields — mirrors avatar-store.ts's tombstoneAvatar shape.
    await db.insert(avatars).values({
      userId,
      image: null,
      hash: null,
      source: null,
      updatedAt: new Date(),
    });

    await autoPopulateAvatar(db, userId, { allowTestHosts: true });

    const row = await avatarRow(userId);
    expect(row?.image).toBeNull();
    expect(row?.hash).toBeNull();
  });

  it("swallows a fetch failure without throwing", async () => {
    const userId = await makeUser(stubFailUrl);

    await expect(autoPopulateAvatar(db, userId, { allowTestHosts: true })).resolves.toBeUndefined();

    const row = await avatarRow(userId);
    expect(row).toBeUndefined();
  });

  it("swallows an unknown-user id without throwing", async () => {
    await expect(autoPopulateAvatar(db, "no-such-user")).resolves.toBeUndefined();
  });
});
