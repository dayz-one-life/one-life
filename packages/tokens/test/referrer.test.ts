import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, servers, gamertagLinks, referrals } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getTestDb } from "@onelife/test-support";
import { setReferrer } from "../src/referrer.js";

const { db, sql } = getTestDb();

beforeAll(async () => {
  await db.insert(user).values([
    { id: "rf1", name: "RF1", email: "rf1@x.com" },
    { id: "rf2", name: "RF2", email: "rf2@x.com" },
  ]);
  const [s] = await db.insert(servers).values({ nitradoServiceId: 774001, name: "rf" }).returning();
  await db.insert(gamertagLinks).values([
    { userId: "rf1", gamertag: "RFG1", status: "verified" },
    { userId: "rf2", gamertag: "RFG2", status: "verified" },
  ]);
});
afterAll(async () => { await sql.end(); });

describe("setReferrer", () => {
  it("sets a referrer once", async () => {
    await setReferrer(db, { userId: "rf1", referrerUserId: "rf2" });
    const [r] = await db.select().from(referrals).where(eq(referrals.userId, "rf1"));
    expect(r!.referrerUserId).toBe("rf2");
  });
  it("rejects a second referrer (already_set)", async () => {
    await expect(setReferrer(db, { userId: "rf1", referrerUserId: "rf2" })).rejects.toThrow(/already_set/);
  });
  it("rejects self-referral", async () => {
    await expect(setReferrer(db, { userId: "rf2", referrerUserId: "rf2" })).rejects.toThrow(/self_referral/);
  });
});
