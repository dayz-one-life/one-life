import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { avatars, blockedAvatarHashes, user, userBlocks } from "@onelife/db";
import { blockUser, unblockUser, listBlockedUserIds, isBlockedEitherWay } from "../src/lib/moderation.js";
import { getAvatarByHash } from "../src/lib/avatar-store.js";

const { db, sql } = getTestDb();
const HASH = "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222";

async function seedUser(id: string) {
  await db.insert(user).values({
    id, name: `user-${id}`, email: `${id}@example.test`, emailVerified: true,
    createdAt: new Date(), updatedAt: new Date(),
  });
}

beforeEach(async () => {
  await db.delete(userBlocks);
  await db.delete(blockedAvatarHashes);
  await db.delete(avatars);
  await db.delete(user);
});
afterAll(async () => {
  await db.delete(userBlocks);
  await db.delete(blockedAvatarHashes);
  await db.delete(avatars);
  await db.delete(user);
  await sql.end();
});

describe("user blocks", () => {
  it("records a block and lists it", async () => {
    await seedUser("alice"); await seedUser("bob");
    expect(await blockUser(db, "alice", "bob")).toEqual({ ok: true });
    expect(await listBlockedUserIds(db, "alice")).toEqual(["bob"]);
  });

  it("is idempotent", async () => {
    await seedUser("alice"); await seedUser("bob");
    await blockUser(db, "alice", "bob");
    await blockUser(db, "alice", "bob");
    expect(await listBlockedUserIds(db, "alice")).toEqual(["bob"]);
  });

  it("refuses to block yourself", async () => {
    await seedUser("alice");
    expect(await blockUser(db, "alice", "alice")).toEqual({ error: "self" });
  });

  it("unblocks", async () => {
    await seedUser("alice"); await seedUser("bob");
    await blockUser(db, "alice", "bob");
    await unblockUser(db, "alice", "bob");
    expect(await listBlockedUserIds(db, "alice")).toEqual([]);
  });

  // Location shares are severed in BOTH directions from a one-way block.
  it("reports a block in either direction", async () => {
    await seedUser("alice"); await seedUser("bob");
    await blockUser(db, "alice", "bob");
    expect(await isBlockedEitherWay(db, "alice", "bob")).toBe(true);
    expect(await isBlockedEitherWay(db, "bob", "alice")).toBe(true);
  });

  it("does not report unrelated users as blocked", async () => {
    await seedUser("alice"); await seedUser("bob"); await seedUser("carol");
    await blockUser(db, "alice", "bob");
    expect(await isBlockedEitherWay(db, "alice", "carol")).toBe(false);
  });

  // ⚠️ THE dangerous confusion. Blocking is VIEWER-SCOPED; banning is global. If blocking ever
  // 404s an avatar for third parties, every user has a unilateral takedown button.
  it("blocking does NOT hide the blocked user's avatar from anyone else", async () => {
    await seedUser("alice"); await seedUser("bob");
    await db.insert(avatars).values({
      userId: "bob", image: Buffer.from([9, 9]), hash: HASH, source: "upload", updatedAt: new Date(),
    });

    await blockUser(db, "alice", "bob");

    // The bytes still serve globally — only alice's rendering filters them out, which is a
    // display-layer concern, not a serving-layer one.
    expect(await getAvatarByHash(db, HASH)).not.toBeNull();
    expect(await db.select().from(blockedAvatarHashes)).toHaveLength(0);
  });
});
