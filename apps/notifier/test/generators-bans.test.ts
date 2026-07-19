import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, servers, gamertagLinks, bans } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { banAppliedGenerator, banLiftedGenerator } from "../src/generators/bans.js";

const { db, sql } = getTestDb();
const NOW = new Date("2026-07-19T12:00:00Z");
// lookback 24h beats the go-live cutoff, so the window opens at 2026-07-18T12:00:00Z.
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
    // (A) IN window for ban_applied: the ban row was written a minute ago, but banned_at is the
    // DEATH time and the projector was three days behind. Windowing on banned_at drops this.
    { serverId: s!.id, gamertag: "banone", lifeStartedAt: new Date("2026-07-15T00:00:00Z"),
      reason: "qualified_death", bannedAt: new Date("2026-07-16T00:00:00Z"),
      expiresAt: new Date("2026-07-17T00:00:00Z"), status: "pending", dryRun: true,
      createdAt: new Date("2026-07-19T11:00:00Z") },
    // (B) IN window for ban_lifted: enforcer was down for a week and only marked it expired now.
    // expires_at is long outside the window; lifted_at is the instant the player came back in.
    { serverId: s!.id, gamertag: "BanOne", lifeStartedAt: new Date("2026-07-10T00:00:00Z"),
      reason: "qualified_death", bannedAt: new Date("2026-07-10T00:00:00Z"),
      expiresAt: new Date("2026-07-11T00:00:00Z"), status: "expired", dryRun: false,
      createdAt: new Date("2026-07-10T00:05:00Z"), appliedAt: new Date("2026-07-10T00:05:00Z"),
      liftedAt: new Date("2026-07-19T11:30:00Z") },
    // (C) OUT of window for ban_lifted: resolved three days ago, but expires_at still falls
    // inside the window. Windowing on expires_at emits a spurious "You're back in".
    { serverId: s!.id, gamertag: "BanOne", lifeStartedAt: new Date("2026-07-16T00:00:00Z"),
      reason: "qualified_death", bannedAt: new Date("2026-07-16T00:00:00Z"),
      expiresAt: new Date("2026-07-19T00:00:00Z"), status: "lifted", dryRun: false,
      createdAt: new Date("2026-07-16T00:05:00Z"), appliedAt: new Date("2026-07-16T00:05:00Z"),
      liftedAt: new Date("2026-07-16T06:00:00Z") },
    // (D) OUT of window for ban_applied: placed two days ago, already notified.
    { serverId: s!.id, gamertag: "BanOne", lifeStartedAt: new Date("2026-07-17T00:00:00Z"),
      reason: "qualified_death", bannedAt: new Date("2026-07-17T00:00:00Z"),
      expiresAt: new Date("2026-07-18T00:00:00Z"), status: "pending", dryRun: true,
      createdAt: new Date("2026-07-17T00:05:00Z") },
    // (E) IN window but the gamertag link is only pending — never notifies.
    { serverId: s!.id, gamertag: "BanTwo", lifeStartedAt: new Date("2026-07-18T00:00:00Z"),
      reason: "qualified_death", bannedAt: new Date("2026-07-19T11:00:00Z"),
      expiresAt: new Date("2026-07-20T11:00:00Z"), status: "pending", dryRun: true,
      createdAt: new Date("2026-07-19T11:02:00Z") },
    // (F) IN window for ban_lifted, via a spent token rather than expiry.
    { serverId: s!.id, gamertag: "BanOne", lifeStartedAt: new Date("2026-07-16T20:00:00Z"),
      reason: "qualified_death", bannedAt: new Date("2026-07-17T01:00:00Z"),
      expiresAt: new Date("2026-07-18T01:00:00Z"), status: "lifted", dryRun: false,
      createdAt: new Date("2026-07-17T01:05:00Z"), appliedAt: new Date("2026-07-17T01:05:00Z"),
      liftedAt: new Date("2026-07-19T11:45:00Z") },
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

  it("emits for a ban placed inside the window even when the death is older than it", async () => {
    // Fixture (A): banned_at 2026-07-16, created_at 2026-07-19. Windowing on banned_at loses it.
    const drafts = await banAppliedGenerator(deps);
    expect(drafts.map((d) => d.naturalKey)).toHaveLength(1);
  });

  it("does not emit for a ban placed before the window opened", async () => {
    // Fixture (D) must never appear; a second draft here means the window clause is gone.
    const narrow = await banAppliedGenerator({ ...deps, now: new Date("2026-07-19T13:00:00Z"), lookbackHours: 1 });
    expect(narrow).toHaveLength(0);
  });
});

describe("banLiftedGenerator", () => {
  it("emits for bans that ended inside the window, with wording per status", async () => {
    const drafts = await banLiftedGenerator(deps);
    expect(drafts).toHaveLength(2);
    expect(drafts.every((d) => d.kind === "ban_lifted")).toBe(true);
    expect(drafts.some((d) => d.body.includes("expired"))).toBe(true);   // (B)
    expect(drafts.some((d) => d.body.includes("token was spent"))).toBe(true); // (F)
    expect(drafts[0]!.naturalKey).toMatch(/^ban_lifted:\d+$/);
  });

  it("does not emit for a ban that ended before the window, even if expires_at is inside it", async () => {
    // Fixture (C): lifted_at 2026-07-16, expires_at 2026-07-19. Windowing on expires_at
    // would announce "You're back in" for a ban resolved three days earlier.
    const drafts = await banLiftedGenerator(deps);
    expect(drafts).toHaveLength(2);
    expect(drafts.filter((d) => d.body.includes("token was spent"))).toHaveLength(1);
  });

  it("does not emit for a ban that ended before a narrower window opened", async () => {
    const narrow = await banLiftedGenerator({ ...deps, now: new Date("2026-07-19T13:00:00Z"), lookbackHours: 1 });
    expect(narrow).toHaveLength(0);
  });
});
