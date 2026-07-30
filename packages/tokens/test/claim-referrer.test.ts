import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { user, referrals, gamertagLinks } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { claimReferrer } from "../src/claim-referrer.js";

const { db, sql } = getTestDb();

beforeAll(async () => {
  await db.insert(user).values([
    { id: "cr-ref", name: "Referrer", email: "cr-ref@x.com" },   // verified referrer
    { id: "cr-ref2", name: "Referrer2", email: "cr-ref2@x.com" }, // a second verified referrer
    { id: "cr-new", name: "Newcomer", email: "cr-new@x.com" },   // unverified referee
    { id: "cr-new2", name: "Newcomer2", email: "cr-new2@x.com" },
    { id: "cr-unv", name: "Unverified", email: "cr-unv@x.com" }, // unverified would-be referrer
  ]);
  await db.insert(gamertagLinks).values([
    { userId: "cr-ref", gamertag: "CRReferrer", status: "verified" },
    { userId: "cr-ref2", gamertag: "CRReferrer2", status: "verified" },
  ]);
});
afterAll(async () => {
  await sql.end();
});

describe("claimReferrer", () => {
  it("claims for a referee who has verified NOTHING yet", async () => {
    expect(await claimReferrer(db, { userId: "cr-new", referrerUserId: "cr-ref" })).toBe("claimed");
    const rows = await db.select().from(referrals).where(eq(referrals.userId, "cr-new"));
    expect(rows[0]?.referrerUserId).toBe("cr-ref");
  });

  it("is a silent no-op on a repeat claim and NEVER overwrites the existing referrer", async () => {
    // A DIFFERENT, also-verified referrer: the claim must not reassign an existing one.
    expect(await claimReferrer(db, { userId: "cr-new", referrerUserId: "cr-ref2" })).toBe("noop");
    const rows = await db.select().from(referrals).where(eq(referrals.userId, "cr-new"));
    expect(rows[0]?.referrerUserId).toBe("cr-ref"); // unchanged
  });

  it("rejects self-referral", async () => {
    await expect(claimReferrer(db, { userId: "cr-ref", referrerUserId: "cr-ref" })).rejects.toThrow(
      /self_referral/,
    );
  });

  it("rejects an unverified referrer", async () => {
    await expect(claimReferrer(db, { userId: "cr-new2", referrerUserId: "cr-unv" })).rejects.toThrow(
      /not_verified/,
    );
  });
});
