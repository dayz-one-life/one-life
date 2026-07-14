import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, servers, gamertagLinks, referrals } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { grantVerification, grantMonthly, grantReferral } from "../src/sweeps.js";
import { getBalance } from "../src/balance.js";

const { db, sql } = getTestDb();

beforeAll(async () => {
  // The grant sweeps operate globally, so isolate this file from other files' verified users
  // (the package shares one truncate-once test DB). Cascade wipes all derived rows.
  await sql.unsafe('truncate table "user", servers restart identity cascade');
  await db.insert(user).values([
    { id: "sw1", name: "SW1", email: "sw1@x.com" },
    { id: "sw2", name: "SW2", email: "sw2@x.com" },
    { id: "sw3", name: "SW3", email: "sw3@x.com" },
  ]);
  const [s] = await db.insert(servers).values({ nitradoServiceId: 771001, name: "sw" }).returning();
  await db.insert(gamertagLinks).values([
    { userId: "sw1", serverId: s!.id, gamertag: "SWG1", status: "verified" },
    { userId: "sw2", serverId: s!.id, gamertag: "SWG2", status: "verified" },
    { userId: "sw3", serverId: s!.id, gamertag: "SWG3", status: "pending" }, // not verified
  ]);
  await db.insert(referrals).values({ userId: "sw2", referrerUserId: "sw1" }); // sw2 referred by sw1
});
afterAll(async () => { await sql.end(); });

describe("grant sweeps", () => {
  it("grantVerification grants once per verified link, then 0", async () => {
    expect(await grantVerification(db)).toBe(2); // sw1, sw2 — not the pending sw3
    expect(await grantVerification(db)).toBe(0);
    expect(await getBalance(db, "sw1")).toBe(1);
    expect(await getBalance(db, "sw3")).toBe(0);
  });

  it("grantMonthly grants once per verified user per month", async () => {
    expect(await grantMonthly(db, "2026-08")).toBe(2);
    expect(await grantMonthly(db, "2026-08")).toBe(0);
    expect(await getBalance(db, "sw2")).toBe(2); // verification + monthly
  });

  it("grantReferral gives the referrer one per verified referee, idempotent per month", async () => {
    expect(await grantReferral(db, "2026-08")).toBe(1); // sw1 gets +1 for referring sw2
    expect(await grantReferral(db, "2026-08")).toBe(0);
    expect(await getBalance(db, "sw1")).toBe(3); // verification + monthly + referral
  });
});
