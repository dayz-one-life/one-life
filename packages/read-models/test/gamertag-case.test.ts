import { describe, it, expect, afterAll } from "vitest";
import { user, gamertagLinks } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { inArray } from "drizzle-orm";

// The two REJECTION halves of migration 0024 are asserted in friend-positions.test.ts, where the
// state they used to construct lived. This file holds the third assertion, which has no home
// there: that the verified index is still PARTIAL.
const { db, sql } = getTestDb();
const tag = `Case${Math.floor(Math.random() * 1e8)}`;
const uidA = `u-case-a-${tag}`;
const uidB = `u-case-b-${tag}`;

afterAll(async () => {
  await db.delete(gamertagLinks).where(inArray(gamertagLinks.userId, [uidA, uidB]));
  await db.delete(user).where(inArray(user.id, [uidA, uidB]));
  await sql.end();
});

describe("gamertag uniqueness is case-insensitive", () => {
  it("but two PENDING links differing only in case are still allowed", async () => {
    // The verified index is PARTIAL (WHERE status = 'verified'). Two users may both hold a
    // pending claim on the same callsign in different casings — first-verify-wins resolves
    // it later. If this ever fails, the partial clause has been lost.
    await db.insert(user).values([
      { id: uidA, name: "a", email: `${uidA}@x.com` },
      { id: uidB, name: "b", email: `${uidB}@x.com` },
    ]);
    await db.insert(gamertagLinks).values({ userId: uidA, gamertag: tag, status: "pending" });
    await db.insert(gamertagLinks).values({ userId: uidB, gamertag: tag.toLowerCase(), status: "pending" });

    const rows = await db.select({ g: gamertagLinks.gamertag }).from(gamertagLinks)
      .where(inArray(gamertagLinks.userId, [uidA, uidB]));
    expect(rows.map((r) => r.g).sort()).toEqual([tag, tag.toLowerCase()].sort());
  });
});
