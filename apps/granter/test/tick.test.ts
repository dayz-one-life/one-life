import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, servers, gamertagLinks, referrals } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { granterTick, ym } from "../src/tick.js";
import { getBalance } from "@onelife/tokens";

const { db, sql } = getTestDb();

beforeAll(async () => {
  await db.insert(user).values([
    { id: "gr1", name: "GR1", email: "gr1@x.com" },
    { id: "gr2", name: "GR2", email: "gr2@x.com" },
  ]);
  const [s] = await db.insert(servers).values({ nitradoServiceId: 775001, name: "gr" }).returning();
  await db.insert(gamertagLinks).values([
    { userId: "gr1", serverId: s!.id, gamertag: "GRG1", status: "verified" },
    { userId: "gr2", serverId: s!.id, gamertag: "GRG2", status: "verified" },
  ]);
  await db.insert(referrals).values({ userId: "gr2", referrerUserId: "gr1" }); // gr2 referred by gr1
});
afterAll(async () => { await sql.end(); });

describe("granterTick", () => {
  it("ym formats a UTC month key", () => {
    expect(ym(new Date("2026-08-05T00:00:00Z"))).toBe("2026-08");
  });

  it("grants on the first sweep then is fully idempotent", async () => {
    const now = new Date("2026-08-15T00:00:00Z");
    const r1 = await granterTick(db, { now });
    expect(r1.verification).toBe(2); // gr1, gr2
    expect(r1.monthly).toBe(2);
    expect(r1.referral).toBe(1);     // gr1 gets a token for referring gr2
    // gr1: verification + monthly + referral = 3; gr2: verification + monthly = 2
    expect(await getBalance(db, "gr1")).toBe(3);
    expect(await getBalance(db, "gr2")).toBe(2);

    const r2 = await granterTick(db, { now });
    expect(r2).toEqual({ verification: 0, monthly: 0, referral: 0 });
    expect(await getBalance(db, "gr1")).toBe(3); // unchanged
  });
});
