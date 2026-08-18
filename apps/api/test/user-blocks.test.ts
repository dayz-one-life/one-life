import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";
import { avatars, blockedAvatarHashes, gamertagLinks, user, userBlocks } from "@onelife/db";
import {
  blockUser,
  unblockUser,
  isBlockedEitherWay,
  blockByGamertag,
  unblockByGamertag,
  listBlocks,
} from "../src/lib/moderation.js";
import { getAvatarByHash } from "../src/lib/avatar-store.js";

const { db, sql } = getTestDb();
const HASH = "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222";

async function seedUser(id: string) {
  await db.insert(user).values({
    id, name: `user-${id}`, email: `${id}@example.test`, emailVerified: true,
    createdAt: new Date(), updatedAt: new Date(),
  });
}

async function seedVerified(userId: string, gamertag: string) {
  await db.insert(gamertagLinks).values({
    userId, gamertag, status: "verified", verifiedAt: new Date(), createdAt: new Date(),
  });
}

beforeEach(async () => {
  await db.delete(userBlocks);
  await db.delete(blockedAvatarHashes);
  await db.delete(avatars);
  await db.delete(gamertagLinks);
  await db.delete(user);
});
afterAll(async () => {
  await db.delete(userBlocks);
  await db.delete(blockedAvatarHashes);
  await db.delete(avatars);
  await db.delete(gamertagLinks);
  await db.delete(user);
  await sql.end();
});

describe("user blocks", () => {
  it("records a block and lists it", async () => {
    await seedUser("alice"); await seedUser("bob");
    expect(await blockUser(db, "alice", "bob", "BobTag")).toEqual({ ok: true });
    expect(await listBlocks(db, "alice")).toEqual([{ gamertag: "BobTag", createdAt: expect.any(String) }]);
  });

  it("is idempotent", async () => {
    await seedUser("alice"); await seedUser("bob");
    await blockUser(db, "alice", "bob", "BobTag");
    await blockUser(db, "alice", "bob", "BobTag");
    expect(await listBlocks(db, "alice")).toHaveLength(1);
  });

  it("refuses to block yourself", async () => {
    await seedUser("alice");
    expect(await blockUser(db, "alice", "alice", "AliceTag")).toEqual({ error: "self" });
  });

  it("unblocks", async () => {
    await seedUser("alice"); await seedUser("bob");
    await blockUser(db, "alice", "bob", "BobTag");
    await unblockUser(db, "alice", "bob");
    expect(await listBlocks(db, "alice")).toEqual([]);
  });

  // Location shares are severed in BOTH directions from a one-way block.
  it("reports a block in either direction", async () => {
    await seedUser("alice"); await seedUser("bob");
    await blockUser(db, "alice", "bob", "BobTag");
    expect(await isBlockedEitherWay(db, "alice", "bob")).toBe(true);
    expect(await isBlockedEitherWay(db, "bob", "alice")).toBe(true);
  });

  it("does not report unrelated users as blocked", async () => {
    await seedUser("alice"); await seedUser("bob"); await seedUser("carol");
    await blockUser(db, "alice", "bob", "BobTag");
    expect(await isBlockedEitherWay(db, "alice", "carol")).toBe(false);
  });

  // ⚠️ THE dangerous confusion. Blocking is VIEWER-SCOPED; banning is global. If blocking ever
  // 404s an avatar for third parties, every user has a unilateral takedown button.
  it("blocking does NOT hide the blocked user's avatar from anyone else", async () => {
    await seedUser("alice"); await seedUser("bob");
    await db.insert(avatars).values({
      userId: "bob", image: Buffer.from([9, 9]), hash: HASH, source: "upload", updatedAt: new Date(),
    });

    await blockUser(db, "alice", "bob", "BobTag");

    // The bytes still serve globally — only alice's rendering filters them out, which is a
    // display-layer concern, not a serving-layer one.
    expect(await getAvatarByHash(db, HASH)).not.toBeNull();
    expect(await db.select().from(blockedAvatarHashes)).toHaveLength(0);
  });
});

describe("blocking by gamertag", () => {
  it("resolves a verified gamertag to its owner and blocks them", async () => {
    await seedUser("alice");
    await seedUser("bob"); await seedVerified("bob", "BobTag");
    expect(await blockByGamertag(db, "alice", "BobTag")).toEqual({ ok: true });
    // Resolved to bob's USER ID, not just recorded as a string: `isBlockedEitherWay` matches on
    // `blocked_user_id`, so it only answers true if the gamertag was resolved to the right owner.
    expect(await isBlockedEitherWay(db, "alice", "bob")).toBe(true);
    expect(await listBlocks(db, "alice")).toEqual([{ gamertag: "BobTag", createdAt: expect.any(String) }]);
  });

  it("matches case-insensitively, like every other gamertag lookup here, and snapshots the canonical casing", async () => {
    await seedUser("alice");
    await seedUser("bob"); await seedVerified("bob", "BobTag");
    expect(await blockByGamertag(db, "alice", "bobtag")).toEqual({ ok: true });
    // ⚠️ Must store the canonical casing on record, not whatever the caller typed — every other
    // surface (dossier, profile) displays "BobTag", so a stray "bobtag" here matches nothing.
    expect(await listBlocks(db, "alice")).toEqual([{ gamertag: "BobTag", createdAt: expect.any(String) }]);
  });

  it("refuses a gamertag nobody has verified", async () => {
    await seedUser("alice");
    expect(await blockByGamertag(db, "alice", "Ghost")).toEqual({ error: "unknown_gamertag" });
  });

  it("refuses your own gamertag", async () => {
    await seedUser("alice"); await seedVerified("alice", "AliceTag");
    expect(await blockByGamertag(db, "alice", "AliceTag")).toEqual({ error: "self" });
  });

  // ⚠️ The list must render, and must not leak internal ids.
  it("lists blocks by gamertag, never by user id", async () => {
    await seedUser("alice");
    await seedUser("bob"); await seedVerified("bob", "BobTag");
    await blockByGamertag(db, "alice", "BobTag");
    const list = await listBlocks(db, "alice");
    expect(list).toEqual([{ gamertag: "BobTag", createdAt: expect.any(String) }]);
    expect(JSON.stringify(list)).not.toContain("bob");
  });

  // ⚠️ The case the snapshot exists for: without it this row would render as null and could
  // never be removed, because unblock had nothing to address it by.
  it("still labels and removes a block whose owner later unlinked", async () => {
    await seedUser("alice");
    await seedUser("bob"); await seedVerified("bob", "BobTag");
    await blockByGamertag(db, "alice", "BobTag");
    await db.delete(gamertagLinks).where(eq(gamertagLinks.userId, "bob"));

    expect(await listBlocks(db, "alice")).toEqual([{ gamertag: "BobTag", createdAt: expect.any(String) }]);
    await unblockByGamertag(db, "alice", "BobTag");
    expect(await listBlocks(db, "alice")).toEqual([]);
  });
});
