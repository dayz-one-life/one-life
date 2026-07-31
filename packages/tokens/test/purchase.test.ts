import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { fulfillPurchase } from "../src/purchase.js";
import { getBalance } from "../src/balance.js";

const { db, sql } = getTestDb();

beforeAll(async () => {
  await db.insert(user).values([
    { id: "pu1", name: "PU1", email: "pu1@x.com" },
    { id: "pu2", name: "PU2", email: "pu2@x.com" },
  ]);
});
afterAll(async () => { await sql.end(); });

describe("fulfillPurchase", () => {
  it("grants quantity tokens for a paid session", async () => {
    const granted = await fulfillPurchase(db, { userId: "pu1", sessionId: "cs_a", quantity: 3 });
    expect(granted).toBe(3);
    expect(await getBalance(db, "pu1")).toBe(3);
  });
  it("is idempotent — refulfilling the same session grants nothing", async () => {
    const granted = await fulfillPurchase(db, { userId: "pu1", sessionId: "cs_a", quantity: 3 });
    expect(granted).toBe(0);
    expect(await getBalance(db, "pu1")).toBe(3);
  });
  it("distinct sessions accumulate", async () => {
    await fulfillPurchase(db, { userId: "pu2", sessionId: "cs_b", quantity: 1 });
    await fulfillPurchase(db, { userId: "pu2", sessionId: "cs_c", quantity: 2 });
    expect(await getBalance(db, "pu2")).toBe(3);
  });
  it("rejects a bad quantity", async () => {
    await expect(fulfillPurchase(db, { userId: "pu1", sessionId: "cs_d", quantity: 0 })).rejects.toThrow(/bad_quantity/);
    await expect(fulfillPurchase(db, { userId: "pu1", sessionId: "cs_d", quantity: 2.5 })).rejects.toThrow(/bad_quantity/);
    await expect(fulfillPurchase(db, { userId: "pu1", sessionId: "cs_d", quantity: 101 })).rejects.toThrow(/bad_quantity/);
  });
});
