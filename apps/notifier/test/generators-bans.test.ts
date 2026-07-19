import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, servers, gamertagLinks, bans } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { banAppliedGenerator, banLiftedGenerator } from "../src/generators/bans.js";

const { db, sql } = getTestDb();
const NOW = new Date("2026-07-19T12:00:00Z");
const deps = { db, now: NOW, since: new Date("2026-07-01T00:00:00Z"), lookbackHours: 24, siteUrl: "https://s" };

beforeAll(async () => {
  await db.insert(user).values([
    { id: "bn1", name: "BN1", email: "bn1@x.com" },
    { id: "bn2", name: "BN2", email: "bn2@x.com" },
  ]);
  const [s] = await db.insert(servers).values({ nitradoServiceId: 991001, name: "bansrv", slug: "bansrv" }).returning();
  await db.insert(gamertagLinks).values([
    { userId: "bn1", gamertag: "BanOne", status: "verified", verifiedAt: new Date("2026-07-02T00:00:00Z") },
    { userId: "bn2", gamertag: "BanTwo", status: "pending" },
  ]);
  await db.insert(bans).values([
    { serverId: s!.id, gamertag: "banone", lifeStartedAt: new Date("2026-07-18T00:00:00Z"),
      reason: "qualified_death", bannedAt: new Date("2026-07-19T11:00:00Z"),
      expiresAt: new Date("2026-07-20T11:00:00Z"), status: "applied", dryRun: false,
      appliedAt: new Date("2026-07-19T11:01:00Z") },
    { serverId: s!.id, gamertag: "BanOne", lifeStartedAt: new Date("2026-07-16T00:00:00Z"),
      reason: "qualified_death", bannedAt: new Date("2026-07-17T00:00:00Z"),
      expiresAt: new Date("2026-07-19T11:30:00Z"), status: "expired", dryRun: false,
      liftedAt: new Date("2026-07-19T11:30:00Z") },
    { serverId: s!.id, gamertag: "BanTwo", lifeStartedAt: new Date("2026-07-18T00:00:00Z"),
      reason: "qualified_death", bannedAt: new Date("2026-07-19T11:00:00Z"),
      expiresAt: new Date("2026-07-20T11:00:00Z"), status: "applied", dryRun: false,
      appliedAt: new Date("2026-07-19T11:02:00Z") },
  ]);
});
afterAll(async () => { await sql.end(); });

describe("banAppliedGenerator", () => {
  it("notifies the verified owner and matches gamertag case-insensitively", async () => {
    const drafts = await banAppliedGenerator(deps);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.userId).toBe("bn1");
    expect(drafts[0]!.kind).toBe("ban_applied");
    expect(drafts[0]!.naturalKey).toMatch(/^ban_applied:\d+$/);
  });

  it("ignores a ban whose gamertag is only pending", async () => {
    const drafts = await banAppliedGenerator(deps);
    expect(drafts.some((d) => d.userId === "bn2")).toBe(false);
  });
});

describe("banLiftedGenerator", () => {
  it("emits one draft for an expired ban", async () => {
    const drafts = await banLiftedGenerator(deps);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.kind).toBe("ban_lifted");
    expect(drafts[0]!.naturalKey).toMatch(/^ban_lifted:\d+$/);
  });
});
