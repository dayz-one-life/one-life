import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, gamertagLinks, tokenTransactions } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { gamertagVerifiedGenerator, tokensGenerator } from "../src/generators/account.js";

const { db, sql } = getTestDb();
const NOW = new Date("2026-07-19T12:00:00Z");
const deps = { db, now: NOW, since: new Date("2026-07-01T00:00:00Z"), lookbackHours: 24, siteUrl: "https://s" };

beforeAll(async () => {
  await db.insert(user).values([
    { id: "ac1", name: "AC1", email: "ac1@x.com" },
    { id: "ac2", name: "AC2", email: "ac2@x.com" },
  ]);
  await db.insert(gamertagLinks).values([
    { userId: "ac1", gamertag: "AcOne", status: "verified", verifiedAt: new Date("2026-07-19T11:00:00Z") },
    { userId: "ac2", gamertag: "AcTwo", status: "pending" },
  ]);
  await db.insert(tokenTransactions).values([
    { userId: "ac1", delta: 1, kind: "monthly", idempotencyKey: "ntf-m-1", createdAt: new Date("2026-07-19T11:30:00Z") },
    { userId: "ac1", delta: 1, kind: "transfer_in", idempotencyKey: "ntf-t-1", createdAt: new Date("2026-07-19T11:40:00Z") },
    { userId: "ac1", delta: -1, kind: "redeem", idempotencyKey: "ntf-r-1", createdAt: new Date("2026-07-19T11:50:00Z") },
    { userId: "ac1", delta: 1, kind: "monthly", idempotencyKey: "ntf-m-old", createdAt: new Date("2026-06-01T00:00:00Z") },
  ]);
});
afterAll(async () => { await sql.end(); });

describe("gamertagVerifiedGenerator", () => {
  it("emits one draft for a verified link and ignores pending", async () => {
    const drafts = await gamertagVerifiedGenerator(deps);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.userId).toBe("ac1");
    expect(drafts[0]!.kind).toBe("gamertag_verified");
    expect(drafts[0]!.naturalKey).toMatch(/^gamertag_verified:\d+$/);
    expect(drafts[0]!.href).toBe("/players/acone");
  });
});

describe("tokensGenerator", () => {
  it("emits grants and transfers-in, never redeems or out-of-window rows", async () => {
    const drafts = await tokensGenerator(deps);
    const kinds = drafts.map((d) => d.kind).sort();
    expect(kinds).toEqual(["tokens_granted", "tokens_received"]);
    expect(drafts.every((d) => d.naturalKey.startsWith("tokens:"))).toBe(true);
  });
});
