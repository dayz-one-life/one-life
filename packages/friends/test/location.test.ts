import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { user, gamertagLinks, friendships, userPreferences } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { request, accept } from "../src/mutations.js";
import { listFriends } from "../src/queries.js";
import {
  shouldShareLocation, setLocationFlag, getShareLocation, setShareLocation,
} from "../src/location.js";

const { db, sql } = getTestDb();

const base = { status: "accepted", masterShare: true, pairShare: true };

describe("shouldShareLocation", () => {
  it("shares when accepted and both flags are on", () => {
    expect(shouldShareLocation(base)).toBe(true);
  });
  for (const off of ["masterShare", "pairShare"] as const) {
    it(`does not share when ${off} is off`, () => {
      expect(shouldShareLocation({ ...base, [off]: false })).toBe(false);
    });
  }
  it("does not share for a non-accepted pair", () => {
    for (const status of ["pending", "declined"]) {
      expect(shouldShareLocation({ ...base, status })).toBe(false);
    }
  });
});

async function seedPair() {
  await sql`truncate table user_preferences, friendships, notifications, gamertag_links, "user" restart identity cascade`;
  await db.insert(user).values([
    { id: "la", name: "LA", email: "la@x.com" },
    { id: "lb", name: "LB", email: "lb@x.com" },
    { id: "lc", name: "LC", email: "lc@x.com" },
  ]);
  await db.insert(gamertagLinks).values([
    { userId: "la", gamertag: "LocAlpha", status: "verified", verifiedAt: new Date() },
    { userId: "lb", gamertag: "LocBravo", status: "verified", verifiedAt: new Date() },
    { userId: "lc", gamertag: "LocCharlie", status: "verified", verifiedAt: new Date() },
  ]);
  await request(db, { fromUserId: "la", toUserId: "lb" });
  const [row] = await db.select().from(friendships);
  await accept(db, { userId: "lb", friendshipId: row!.id });
  return row!.id;
}

describe("location flags", () => {
  beforeEach(seedPair);
  afterAll(async () => { await sql.end(); });

  it("defaults to per-pair sharing on and the master switch off", async () => {
    const out = await listFriends(db, { userId: "la" });
    expect(out.friends[0]!.sharesLocation).toBe(true);
    expect(out.shareLocation).toBe(false);
  });

  it("reports reciprocity as effective sharing, undifferentiated", async () => {
    const id = (await listFriends(db, { userId: "la" })).friends[0]!.id;

    // Both master switches off => neither sees the other.
    expect((await listFriends(db, { userId: "la" })).friends[0]!.theyShareLocation).toBe(false);

    // lb turns their master on: la now sees lb sharing.
    await setShareLocation(db, { userId: "lb", shareLocation: true });
    expect((await listFriends(db, { userId: "la" })).friends[0]!.theyShareLocation).toBe(true);

    // lb hides from la specifically: same undifferentiated false as master-off.
    await setLocationFlag(db, { userId: "lb", friendshipId: id, share: false });
    expect((await listFriends(db, { userId: "la" })).friends[0]!.theyShareLocation).toBe(false);
  });

  it("writes each side's flag independently", async () => {
    const id = (await listFriends(db, { userId: "la" })).friends[0]!.id;
    await setLocationFlag(db, { userId: "la", friendshipId: id, share: false });
    expect((await listFriends(db, { userId: "la" })).friends[0]!.sharesLocation).toBe(false);
    expect((await listFriends(db, { userId: "lb" })).friends[0]!.sharesLocation).toBe(true);
  });

  it("rejects a caller who is not a party", async () => {
    const id = (await listFriends(db, { userId: "la" })).friends[0]!.id;
    await expect(setLocationFlag(db, { userId: "lc", friendshipId: id, share: false }))
      .rejects.toThrow(/not_found/);
  });

  it("treats an absent preferences row as sharing off, and upserts idempotently", async () => {
    expect(await getShareLocation(db, "la")).toBe(false);
    await setShareLocation(db, { userId: "la", shareLocation: true });
    expect(await getShareLocation(db, "la")).toBe(true);
    await setShareLocation(db, { userId: "la", shareLocation: false });
    expect(await getShareLocation(db, "la")).toBe(false);
    const rows = await db.select().from(userPreferences);
    expect(rows).toHaveLength(1);
  });
});
