import { describe, it, expect } from "vitest";
import { shouldNotifyPresence, FRIEND_ONLINE_COOLDOWN_HOURS, FRIEND_ONLINE_MAX_AGE_MINUTES } from "../src/presence.js";

const base = { status: "accepted", masterShare: true, pairShare: true, pairNotify: true };

describe("shouldNotifyPresence", () => {
  it("notifies when the pair is accepted and all three flags are on", () => {
    expect(shouldNotifyPresence(base)).toBe(true);
  });

  // Exhaustive over the three booleans: the four-way AND must not drift.
  const flags = ["masterShare", "pairShare", "pairNotify"] as const;
  for (const off of flags) {
    it(`does not notify when ${off} is off`, () => {
      expect(shouldNotifyPresence({ ...base, [off]: false })).toBe(false);
    });
  }

  it("does not notify for a non-accepted pair", () => {
    for (const status of ["pending", "declined"]) {
      expect(shouldNotifyPresence({ ...base, status })).toBe(false);
    }
  });

  it("pins the tuning constants", () => {
    expect(FRIEND_ONLINE_COOLDOWN_HOURS).toBe(4);
    expect(FRIEND_ONLINE_MAX_AGE_MINUTES).toBe(15);
  });
});

import { beforeEach, afterAll } from "vitest";
import { user, gamertagLinks, friendships, userPreferences } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { eq } from "drizzle-orm";
import { request, accept } from "../src/mutations.js";
import { listFriends } from "../src/queries.js";
import { setPresenceFlags, getSharePresence, setSharePresence } from "../src/presence.js";

const { db, sql } = getTestDb();

async function seedPair() {
  await sql`truncate table user_preferences, friendships, notifications, gamertag_links, "user" restart identity cascade`;
  await db.insert(user).values([
    { id: "pa", name: "PA", email: "pa@x.com" },
    { id: "pb", name: "PB", email: "pb@x.com" },
    { id: "pc", name: "PC", email: "pc@x.com" },
  ]);
  await db.insert(gamertagLinks).values([
    { userId: "pa", gamertag: "PresenceAlpha", status: "verified", verifiedAt: new Date() },
    { userId: "pb", gamertag: "PresenceBravo", status: "verified", verifiedAt: new Date() },
    { userId: "pc", gamertag: "PresenceCharlie", status: "verified", verifiedAt: new Date() },
  ]);
  await request(db, { fromUserId: "pa", toUserId: "pb" });
  const [row] = await db.select().from(friendships);
  await accept(db, { userId: "pb", friendshipId: row!.id });
  return row!.id;
}

describe("presence flags", () => {
  beforeEach(seedPair);
  afterAll(async () => { await sql.end(); });

  it("defaults to sharing on per pair, notifying on, and the master switch off", async () => {
    const out = await listFriends(db, { userId: "pa" });
    expect(out.friends[0]!.sharesPresence).toBe(true);
    expect(out.friends[0]!.notifyPresence).toBe(true);
    expect(out.sharePresence).toBe(false);
  });

  it("writes each side's flags independently", async () => {
    const id = (await listFriends(db, { userId: "pa" })).friends[0]!.id;
    await setPresenceFlags(db, { userId: "pa", friendshipId: id, share: false });
    await setPresenceFlags(db, { userId: "pb", friendshipId: id, notify: false });

    const a = (await listFriends(db, { userId: "pa" })).friends[0]!;
    const b = (await listFriends(db, { userId: "pb" })).friends[0]!;
    expect(a.sharesPresence).toBe(false);
    expect(a.notifyPresence).toBe(true);
    expect(b.sharesPresence).toBe(true);
    expect(b.notifyPresence).toBe(false);
  });

  it("leaves an omitted flag untouched", async () => {
    const id = (await listFriends(db, { userId: "pa" })).friends[0]!.id;
    await setPresenceFlags(db, { userId: "pa", friendshipId: id, notify: false });
    const a = (await listFriends(db, { userId: "pa" })).friends[0]!;
    expect(a.sharesPresence).toBe(true);
    expect(a.notifyPresence).toBe(false);
  });

  it("rejects a caller who is not a party", async () => {
    const id = (await listFriends(db, { userId: "pa" })).friends[0]!.id;
    await expect(setPresenceFlags(db, { userId: "pc", friendshipId: id, share: false }))
      .rejects.toThrow(/not_found/);
  });

  it("treats an absent preferences row as sharing off", async () => {
    expect(await getSharePresence(db, "pa")).toBe(false);
  });

  it("upserts the master switch idempotently", async () => {
    await setSharePresence(db, { userId: "pa", sharePresence: true });
    expect(await getSharePresence(db, "pa")).toBe(true);
    await setSharePresence(db, { userId: "pa", sharePresence: false });
    expect(await getSharePresence(db, "pa")).toBe(false);
    const rows = await db.select().from(userPreferences).where(eq(userPreferences.userId, "pa"));
    expect(rows).toHaveLength(1);
  });
});
