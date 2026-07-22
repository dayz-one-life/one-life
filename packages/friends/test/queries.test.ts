import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { user, gamertagLinks, friendships } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { eq } from "drizzle-orm";
import { request, accept, decline } from "../src/mutations.js";
import { listFriends, statusFor } from "../src/queries.js";

const { db, sql } = getTestDb();

async function seed() {
  await sql`truncate table friendships, notifications, gamertag_links, "user" restart identity cascade`;
  await db.insert(user).values([
    { id: "qa", name: "QA", email: "qa@x.com" },
    { id: "qb", name: "QB", email: "qb@x.com" },
    { id: "qc", name: "QC", email: "qc@x.com" },
    { id: "qd", name: "QD", email: "qd@x.com" },
  ]);
  await db.insert(gamertagLinks).values([
    { userId: "qa", gamertag: "Quebec Alpha", status: "verified" },
    { userId: "qb", gamertag: "QuebecBravo", status: "verified" },
    { userId: "qc", gamertag: "QuebecCharlie", status: "verified" },
    { userId: "qd", gamertag: "QuebecDelta", status: "verified" },
  ]);
}

beforeEach(seed);
afterAll(async () => { await sql.end(); });

describe("listFriends", () => {
  it("splits accepted, incoming and outgoing from the viewer's perspective", async () => {
    // qa ↔ qb accepted; qc → qa incoming; qa → qd outgoing.
    await request(db, { fromUserId: "qa", toUserId: "qb" });
    const [ab] = await db.select().from(friendships);
    await accept(db, { userId: "qb", friendshipId: ab!.id });
    await request(db, { fromUserId: "qc", toUserId: "qa" });
    await request(db, { fromUserId: "qa", toUserId: "qd" });

    const out = await listFriends(db, { userId: "qa" });
    expect(out.friends.map((f) => f.gamertag)).toEqual(["QuebecBravo"]);
    expect(out.incoming.map((f) => f.gamertag)).toEqual(["QuebecCharlie"]);
    expect(out.outgoing.map((f) => f.gamertag)).toEqual(["QuebecDelta"]);
    expect(out.total).toBe(1);
  });

  // ⚠️ The drop-out half of F1's released-link prerequisite, verified by inspection only
  // until now. A friend whose verified link is released is unnameable and unreachable, so
  // they must vanish from the roster rather than render as a blank row — while the
  // friendships row itself survives (F2 relies on that surviving row being harmless).
  it("drops a friend whose verified gamertag link was released, keeping the row", async () => {
    await request(db, { fromUserId: "qa", toUserId: "qb" });
    const [ab] = await db.select().from(friendships);
    await accept(db, { userId: "qb", friendshipId: ab!.id });
    expect((await listFriends(db, { userId: "qa" })).friends).toHaveLength(1);

    await db.delete(gamertagLinks).where(eq(gamertagLinks.userId, "qb"));

    const out = await listFriends(db, { userId: "qa" });
    expect(out.friends).toEqual([]);
    expect(out.total).toBe(0);
    // The row survives — it is unreachable, not deleted.
    expect(await db.select().from(friendships)).toHaveLength(1);
  });

  it("slugifies the gamertag for linking", async () => {
    await request(db, { fromUserId: "qb", toUserId: "qa" });
    const out = await listFriends(db, { userId: "qa" });
    expect(out.incoming[0]!.slug).toBe("quebecbravo");
  });

  it("does not leak a declined pair into any bucket", async () => {
    await request(db, { fromUserId: "qb", toUserId: "qa" });
    const [r] = await db.select().from(friendships);
    await decline(db, { userId: "qa", friendshipId: r!.id });
    const out = await listFriends(db, { userId: "qa" });
    expect(out.friends).toHaveLength(0);
    expect(out.incoming).toHaveLength(0);
    expect(out.outgoing).toHaveLength(0);
  });
});

describe("statusFor", () => {
  it("reports none for an unrelated player", async () => {
    expect(await statusFor(db, { userId: "qa", otherGamertag: "QuebecBravo" }))
      .toEqual({ status: "none", friendshipId: null, cooldownUntil: null });
  });

  it("matches the gamertag case-insensitively", async () => {
    await request(db, { fromUserId: "qa", toUserId: "qb" });
    const out = await statusFor(db, { userId: "qa", otherGamertag: "quebecbravo" });
    expect(out.status).toBe("outgoing");
  });

  it("reports incoming to the recipient and friends once accepted", async () => {
    await request(db, { fromUserId: "qa", toUserId: "qb" });
    expect((await statusFor(db, { userId: "qb", otherGamertag: "Quebec Alpha" })).status).toBe("incoming");
    const [r] = await db.select().from(friendships);
    await accept(db, { userId: "qb", friendshipId: r!.id });
    expect((await statusFor(db, { userId: "qa", otherGamertag: "QuebecBravo" })).status).toBe("friends");
  });

  it("reports cooldown with an expiry after a decline", async () => {
    await request(db, { fromUserId: "qa", toUserId: "qb" });
    const [r] = await db.select().from(friendships);
    await decline(db, { userId: "qb", friendshipId: r!.id, now: new Date("2026-07-01T00:00:00Z") });
    const out = await statusFor(db, {
      userId: "qa", otherGamertag: "QuebecBravo", now: new Date("2026-07-03T00:00:00Z"),
    });
    expect(out.status).toBe("cooldown");
    expect(out.cooldownUntil).toEqual(new Date("2026-07-08T00:00:00Z"));
  });

  it("reports none for a gamertag nobody has verified", async () => {
    expect((await statusFor(db, { userId: "qa", otherGamertag: "NoSuchPlayer" })).status).toBe("none");
  });
});
