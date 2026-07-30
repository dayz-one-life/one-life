import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, referrals, gamertagLinks } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { countVerifiedReferees } from "../src/referral-count.js";

const { db, sql } = getTestDb();

beforeAll(async () => {
  await db.insert(user).values([
    { id: "rc-ref", name: "Ref", email: "rcref@x.com" },
    { id: "rc-a", name: "A", email: "rca@x.com" }, // verified referee
    { id: "rc-b", name: "B", email: "rcb@x.com" }, // pending referee — must NOT count
    { id: "rc-c", name: "C", email: "rcc@x.com" }, // no link at all — must NOT count
  ]);
  await db.insert(gamertagLinks).values([
    { userId: "rc-a", gamertag: "RCA", status: "verified" },
    { userId: "rc-b", gamertag: "RCB", status: "pending" },
  ]);
  await db.insert(referrals).values([
    { userId: "rc-a", referrerUserId: "rc-ref" },
    { userId: "rc-b", referrerUserId: "rc-ref" },
    { userId: "rc-c", referrerUserId: "rc-ref" },
  ]);
});
afterAll(async () => {
  await sql.end();
});

describe("countVerifiedReferees", () => {
  it("counts only referees holding a VERIFIED link", async () => {
    expect(await countVerifiedReferees(db, "rc-ref")).toBe(1);
  });

  it("returns 0 for a user who has referred nobody", async () => {
    expect(await countVerifiedReferees(db, "rc-a")).toBe(0);
  });
});
