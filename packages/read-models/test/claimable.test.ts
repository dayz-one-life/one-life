import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { players, gamertagLinks, user } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { searchClaimableGamertags, searchVerifiedGamertags } from "../src/index.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const userId = `claimable-${Math.floor(Math.random() * 1e8)}`;

beforeAll(async () => {
  await db.insert(user).values({ id: userId, name: "x", email: `${userId}@example.com` });
  await db.insert(players).values([
    { gamertag: "Alpha", firstSeenAt: new Date(), lastSeenAt: new Date() },
    { gamertag: "Alalpha", firstSeenAt: new Date(), lastSeenAt: new Date() },
    { gamertag: "Beta", firstSeenAt: new Date(), lastSeenAt: new Date() },
  ]);
  await db.insert(gamertagLinks).values({ userId, gamertag: "Alpha", status: "verified", verifiedAt: new Date() });
});
afterAll(async () => {
  await db.delete(gamertagLinks).where(eq(gamertagLinks.userId, userId));
  await db.delete(players).where(inArray(players.gamertag, ["Alpha", "Alalpha", "Beta"]));
  await db.delete(user).where(eq(user.id, userId));
  await sql.end();
});

describe("searchClaimableGamertags", () => {
  it("prefix-matches unverified gamertags, case-insensitively, excluding verified ones", async () => {
    const rows = await searchClaimableGamertags(db, "Al", 10);
    expect(rows).toEqual(["Alalpha"]);
  });
});

describe("searchVerifiedGamertags", () => {
  it("prefix-matches only verified gamertags, case-insensitively", async () => {
    expect(await searchVerifiedGamertags(db, "al", 10)).toEqual(["Alpha"]);
  });
  it("returns nothing when no verified gamertag matches the prefix", async () => {
    expect(await searchVerifiedGamertags(db, "Bet", 10)).toEqual([]);
  });
});
