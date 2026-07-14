import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, servers, gamertagLinks } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { grant } from "../src/grant.js";
import { transfer } from "../src/transfer.js";
import { getBalance } from "../src/balance.js";

const { db, sql } = getTestDb();

beforeAll(async () => {
  await db.insert(user).values([
    { id: "tf1", name: "TF1", email: "tf1@x.com" },
    { id: "tf2", name: "TF2", email: "tf2@x.com" },
    { id: "tf3", name: "TF3", email: "tf3@x.com" }, // unverified
  ]);
  const [s] = await db.insert(servers).values({ nitradoServiceId: 773001, name: "tf" }).returning();
  await db.insert(gamertagLinks).values([
    { userId: "tf1", gamertag: "TFG1", status: "verified" },
    { userId: "tf2", gamertag: "TFG2", status: "verified" },
  ]);
  await grant(db, { userId: "tf1", kind: "verification", idempotencyKey: "verify:tf1" });
});
afterAll(async () => { await sql.end(); });

describe("transfer", () => {
  it("moves one token between two verified users", async () => {
    await transfer(db, { fromUserId: "tf1", toUserId: "tf2" });
    expect(await getBalance(db, "tf1")).toBe(0);
    expect(await getBalance(db, "tf2")).toBe(1);
  });
  it("throws insufficient_tokens when the sender is empty", async () => {
    await expect(transfer(db, { fromUserId: "tf1", toUserId: "tf2" })).rejects.toThrow(/insufficient_tokens/);
  });
  it("rejects self-transfer", async () => {
    await expect(transfer(db, { fromUserId: "tf2", toUserId: "tf2" })).rejects.toThrow(/self_transfer/);
  });
  it("rejects transfer to an unverified user", async () => {
    await expect(transfer(db, { fromUserId: "tf2", toUserId: "tf3" })).rejects.toThrow(/not_verified/);
  });
});
