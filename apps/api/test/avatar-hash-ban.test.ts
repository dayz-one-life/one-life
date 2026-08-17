import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { avatars, blockedAvatarHashes, user } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getAvatarByHash, banAvatarHash, unbanAvatarHash, confirmAvatarHashBan } from "../src/lib/avatar-store.js";

const { db, sql } = getTestDb();

const HASH = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const BYTES = Buffer.from([0x52, 0x49, 0x46, 0x46]);

async function seedUser(id: string) {
  await db.insert(user).values({
    id, name: `user-${id}`, email: `${id}@example.test`, emailVerified: true,
    createdAt: new Date(), updatedAt: new Date(),
  });
}

async function seedAvatar(userId: string, hash: string) {
  await db.insert(avatars).values({
    userId, image: BYTES, hash, source: "upload", updatedAt: new Date(),
  });
}

beforeEach(async () => {
  await db.delete(blockedAvatarHashes);
  await db.delete(avatars);
  await db.delete(user);
});

afterAll(async () => { await sql.end(); });

describe("avatar hash bans", () => {
  // ⚠️ THE test. getAvatarByHash matches on hash across ALL users and returns the first row
  // with a non-null image, so a per-user "hidden" flag would leave these bytes serving at the
  // same URL via the other user's row. That is exactly the coordinated-abuse case: the same
  // image uploaded from two accounts. If this fails, takedown has a hole in it.
  it("stops serving bytes held by TWO users, not just the reported one", async () => {
    await seedUser("alice");
    await seedUser("bob");
    await seedAvatar("alice", HASH);
    await seedAvatar("bob", HASH);

    expect(await getAvatarByHash(db, HASH)).not.toBeNull();

    await banAvatarHash(db, HASH);

    expect(await getAvatarByHash(db, HASH)).toBeNull();
  });

  it("restores serving when the ban is lifted", async () => {
    await seedUser("alice");
    await seedAvatar("alice", HASH);
    await banAvatarHash(db, HASH);
    expect(await getAvatarByHash(db, HASH)).toBeNull();

    await unbanAvatarHash(db, HASH);

    expect(await getAvatarByHash(db, HASH)).not.toBeNull();
  });

  // Confirm is the destructive half: it NULLs the bytes for EVERY row holding the hash, using
  // the existing "removal tombstone" meaning of avatars.image.
  it("confirming destroys the bytes for every row sharing the hash", async () => {
    await seedUser("alice");
    await seedUser("bob");
    await seedAvatar("alice", HASH);
    await seedAvatar("bob", HASH);
    await banAvatarHash(db, HASH);

    await confirmAvatarHashBan(db, HASH, "moderator-1");

    const rows = await db.select({ image: avatars.image, hash: avatars.hash }).from(avatars);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.image).toBeNull();
      expect(r.hash).toBeNull();
    }
    const [ban] = await db.select().from(blockedAvatarHashes).where(eq(blockedAvatarHashes.hash, HASH));
    expect(ban?.state).toBe("confirmed");
    expect(ban?.blockedByUserId).toBe("moderator-1");
  });

  it("banning an already-banned hash is idempotent", async () => {
    await banAvatarHash(db, HASH);
    await banAvatarHash(db, HASH);
    const rows = await db.select().from(blockedAvatarHashes).where(eq(blockedAvatarHashes.hash, HASH));
    expect(rows).toHaveLength(1);
  });

  // A confirmed ban must not be silently downgraded to 'auto' by a later report.
  it("does not downgrade a confirmed ban back to auto", async () => {
    await banAvatarHash(db, HASH);
    await confirmAvatarHashBan(db, HASH, "moderator-1");
    await banAvatarHash(db, HASH);
    const [ban] = await db.select().from(blockedAvatarHashes).where(eq(blockedAvatarHashes.hash, HASH));
    expect(ban?.state).toBe("confirmed");
  });
});
