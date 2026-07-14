import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { grant } from "../src/grant.js";
import { getBalance } from "../src/balance.js";

const { db, sql } = getTestDb();

beforeAll(async () => {
  await db.insert(user).values({ id: "bg1", name: "BG1", email: "bg1@x.com" });
});
afterAll(async () => { await sql.end(); });

describe("grant + balance", () => {
  it("grants +1 and is idempotent on the key", async () => {
    expect(await grant(db, { userId: "bg1", kind: "verification", idempotencyKey: "bg:verify:1" })).toBe(true);
    expect(await grant(db, { userId: "bg1", kind: "verification", idempotencyKey: "bg:verify:1" })).toBe(false);
    expect(await getBalance(db, "bg1")).toBe(1);
  });

  it("sums multiple grants", async () => {
    await grant(db, { userId: "bg1", kind: "monthly", idempotencyKey: "bg:monthly:2026-08" });
    expect(await getBalance(db, "bg1")).toBe(2);
  });

  it("returns 0 for a user with no ledger", async () => {
    expect(await getBalance(db, "nobody")).toBe(0);
  });
});
