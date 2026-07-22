import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { user, gamertagLinks, friendships, notifications } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { eq } from "drizzle-orm";
import { request, cancel, accept, decline, remove } from "../src/mutations.js";

const { db, sql } = getTestDb();

// Ids are chosen so ordering is obvious: "fa" < "fb" < "fc".
async function seed() {
  await sql`truncate table friendships, notifications, gamertag_links, "user" restart identity cascade`;
  await db.insert(user).values([
    { id: "fa", name: "FA", email: "fa@x.com" },
    { id: "fb", name: "FB", email: "fb@x.com" },
    { id: "fc", name: "FC", email: "fc@x.com" }, // unverified
  ]);
  await db.insert(gamertagLinks).values([
    { userId: "fa", gamertag: "AlphaOne", status: "verified" },
    { userId: "fb", gamertag: "BravoTwo", status: "verified" },
    { userId: "fc", gamertag: "CharlieX", status: "pending" },
  ]);
}

beforeEach(seed);
afterAll(async () => { await sql.end(); });

const rows = () => db.select().from(friendships);
const notes = () => db.select().from(notifications);

describe("request", () => {
  it("creates a pending row in canonical order regardless of direction", async () => {
    await request(db, { fromUserId: "fb", toUserId: "fa" });
    const [r] = await rows();
    expect(r!.userA).toBe("fa");
    expect(r!.userB).toBe("fb");
    expect(r!.status).toBe("pending");
    expect(r!.requestedBy).toBe("fb");
    expect(r!.requestSeq).toBe(1);
  });

  it("notifies the recipient, naming the sender's gamertag", async () => {
    await request(db, { fromUserId: "fa", toUserId: "fb" });
    const [n] = await notes();
    expect(n!.userId).toBe("fb");
    expect(n!.kind).toBe("friend_request_received");
    expect(n!.body).toBe("AlphaOne wants to be friends.");
    expect(n!.href).toBe("/friends");
  });

  it("rejects a request to yourself", async () => {
    await expect(request(db, { fromUserId: "fa", toUserId: "fa" })).rejects.toThrow(/self_request/);
  });

  it("rejects a request involving an unverified user", async () => {
    await expect(request(db, { fromUserId: "fa", toUserId: "fc" })).rejects.toThrow(/not_verified/);
    await expect(request(db, { fromUserId: "fc", toUserId: "fa" })).rejects.toThrow(/not_verified/);
  });

  it("rejects a duplicate pending request", async () => {
    await request(db, { fromUserId: "fa", toUserId: "fb" });
    await expect(request(db, { fromUserId: "fa", toUserId: "fb" })).rejects.toThrow(/already_pending/);
  });

  it("auto-accepts when the recipient requests back", async () => {
    await request(db, { fromUserId: "fa", toUserId: "fb" });
    const out = await request(db, { fromUserId: "fb", toUserId: "fa" });
    expect(out.status).toBe("accepted");
    const [r] = await rows();
    expect(r!.status).toBe("accepted");
    // The original sender is told.
    const accepted = (await notes()).filter((n) => n.kind === "friend_request_accepted");
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.userId).toBe("fa");
    expect(accepted[0]!.body).toBe("BravoTwo accepted your friend request.");
  });

  it("blocks a re-request inside the cooldown and permits it after", async () => {
    await request(db, { fromUserId: "fa", toUserId: "fb" });
    const [r] = await rows();
    await decline(db, { userId: "fb", friendshipId: r!.id, now: new Date("2026-07-01T00:00:00Z") });

    await expect(
      request(db, { fromUserId: "fa", toUserId: "fb", now: new Date("2026-07-05T00:00:00Z") }),
    ).rejects.toThrow(/cooldown_active/);

    await request(db, { fromUserId: "fa", toUserId: "fb", now: new Date("2026-07-09T00:00:00Z") });
    const [after] = await rows();
    expect(after!.status).toBe("pending");
    expect(after!.requestSeq).toBe(2);
    expect(after!.respondedAt).toBeNull();
  });

  // ⚠️ Regression guard for spec §4.2. Prove this fails first with a natural key that omits
  // the seq: notifications.natural_key is a plain GLOBAL unique index, so the second
  // request's row is swallowed by onConflictDoNothing and the recipient is never told.
  it("notifies again on a re-request after the cooldown", async () => {
    await request(db, { fromUserId: "fa", toUserId: "fb" });
    const [r] = await rows();
    await decline(db, { userId: "fb", friendshipId: r!.id, now: new Date("2026-07-01T00:00:00Z") });
    await request(db, { fromUserId: "fa", toUserId: "fb", now: new Date("2026-07-09T00:00:00Z") });

    const received = (await notes()).filter((n) => n.kind === "friend_request_received");
    expect(received).toHaveLength(2);
    expect(new Set(received.map((n) => n.naturalKey)).size).toBe(2);
  });

  it("rate-limits outgoing requests", async () => {
    // 20 successful requests to fresh users, then the 21st is refused.
    for (let i = 0; i < 20; i++) {
      const id = `r${i}`;
      await db.insert(user).values({ id, name: id, email: `${id}@x.com` });
      await db.insert(gamertagLinks).values({ userId: id, gamertag: `Rate${i}`, status: "verified" });
      await request(db, { fromUserId: "fa", toUserId: id });
    }
    await expect(request(db, { fromUserId: "fa", toUserId: "fb" })).rejects.toThrow(/rate_limited/);
  });
});

describe("accept / decline / cancel / remove", () => {
  async function pending() {
    await request(db, { fromUserId: "fa", toUserId: "fb" });
    const [r] = await rows();
    return r!.id;
  }

  it("accepts and notifies the original sender", async () => {
    const id = await pending();
    await accept(db, { userId: "fb", friendshipId: id });
    const [r] = await rows();
    expect(r!.status).toBe("accepted");
    expect(r!.respondedAt).not.toBeNull();
    const accepted = (await notes()).filter((n) => n.kind === "friend_request_accepted");
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.userId).toBe("fa");
  });

  it("refuses to let the sender accept their own request", async () => {
    const id = await pending();
    await expect(accept(db, { userId: "fa", friendshipId: id })).rejects.toThrow(/not_recipient/);
  });

  it("declines without notifying anyone", async () => {
    const id = await pending();
    const before = (await notes()).length;
    await decline(db, { userId: "fb", friendshipId: id });
    const [r] = await rows();
    expect(r!.status).toBe("declined");
    expect(r!.respondedAt).not.toBeNull();
    expect((await notes()).length).toBe(before);
  });

  it("lets the sender cancel a pending request, deleting the row", async () => {
    const id = await pending();
    await cancel(db, { userId: "fa", friendshipId: id });
    expect(await rows()).toHaveLength(0);
  });

  it("refuses to let the recipient cancel", async () => {
    const id = await pending();
    await expect(cancel(db, { userId: "fb", friendshipId: id })).rejects.toThrow(/not_found/);
  });

  it("removes an accepted friendship from either side, deleting the row", async () => {
    const id = await pending();
    await accept(db, { userId: "fb", friendshipId: id });
    await remove(db, { userId: "fa", friendshipId: id });
    expect(await rows()).toHaveLength(0);
  });

  it("rejects a mutation from someone who is not a party", async () => {
    const id = await pending();
    await expect(remove(db, { userId: "fc", friendshipId: id })).rejects.toThrow(/not_found/);
    await expect(accept(db, { userId: "fc", friendshipId: id })).rejects.toThrow(/not_recipient/);
  });
});
