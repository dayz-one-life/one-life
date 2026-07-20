import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, servers, gamertagLinks, bans } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { banAppliedGenerator, banLiftedGenerator } from "../src/generators/bans.js";

const { db, sql } = getTestDb();
const NOW = new Date("2026-07-19T12:00:00Z");
// lookback 24h beats the go-live cutoff, so the window opens at 2026-07-18T12:00:00Z.
const deps = { db, now: NOW, since: new Date("2026-07-01T00:00:00Z"), lookbackHours: 24, siteUrl: "https://s" };

/** Ban row ids in fixture order: [A, B, C, D, E, F, G, H]. */
let banIds: number[] = [];

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
  // Captured in insert order so the dry-run assertions can name the exact row that must be
  // absent. The query windows have a lower bound only (gte createdAt), so "narrow the window
  // until only the dry-run row is in range" does not work — a later real ban still matches.
  banIds = (await db.insert(bans).values([
    // (A) IN window for ban_applied: the ban row was written a minute ago, but banned_at is the
    // DEATH time and the projector was three days behind. Windowing on banned_at drops this.
    { serverId: s!.id, gamertag: "banone", lifeStartedAt: new Date("2026-07-15T00:00:00Z"),
      reason: "qualified_death", bannedAt: new Date("2026-07-16T00:00:00Z"),
      expiresAt: new Date("2026-07-17T00:00:00Z"), status: "pending", dryRun: false,
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
    // dry_run=false so the ONLY reason it is excluded is the window — an over-determined
    // fixture would keep the window test green after the window clause was deleted.
    { serverId: s!.id, gamertag: "BanOne", lifeStartedAt: new Date("2026-07-17T00:00:00Z"),
      reason: "qualified_death", bannedAt: new Date("2026-07-17T00:00:00Z"),
      expiresAt: new Date("2026-07-18T00:00:00Z"), status: "pending", dryRun: false,
      createdAt: new Date("2026-07-17T00:05:00Z") },
    // (E) IN window and a real ban, but the gamertag link is only pending — never notifies.
    { serverId: s!.id, gamertag: "BanTwo", lifeStartedAt: new Date("2026-07-18T00:00:00Z"),
      reason: "qualified_death", bannedAt: new Date("2026-07-19T11:00:00Z"),
      expiresAt: new Date("2026-07-20T11:00:00Z"), status: "pending", dryRun: false,
      createdAt: new Date("2026-07-19T11:02:00Z") },
    // (F) IN window for ban_lifted, via a spent token rather than expiry.
    { serverId: s!.id, gamertag: "BanOne", lifeStartedAt: new Date("2026-07-16T20:00:00Z"),
      reason: "qualified_death", bannedAt: new Date("2026-07-17T01:00:00Z"),
      expiresAt: new Date("2026-07-18T01:00:00Z"), status: "lifted", dryRun: false,
      createdAt: new Date("2026-07-17T01:05:00Z"), appliedAt: new Date("2026-07-17T01:05:00Z"),
      liftedAt: new Date("2026-07-19T11:45:00Z") },
    // (G) DRY RUN, otherwise a perfect ban_applied hit: verified owner, created inside the
    // window. The enforcer wrote this row and then `continue`d — nothing reached Nitrado and
    // the player was never banned. Announcing it would invite them to spend a token (which
    // redeem really would burn) lifting a ban that does not exist.
    { serverId: s!.id, gamertag: "BanOne", lifeStartedAt: new Date("2026-07-18T06:00:00Z"),
      reason: "qualified_death", bannedAt: new Date("2026-07-19T10:00:00Z"),
      expiresAt: new Date("2026-07-20T10:00:00Z"), status: "pending", dryRun: true,
      createdAt: new Date("2026-07-19T10:05:00Z") },
    // (H) DRY RUN, otherwise a perfect ban_lifted hit: lifted_at sits inside the window.
    // A lift is only news because the ban it ends was real; "You're back in" for a ban that
    // never kept anyone out is the same false claim as (G), just cheerful.
    { serverId: s!.id, gamertag: "BanOne", lifeStartedAt: new Date("2026-07-18T07:00:00Z"),
      reason: "qualified_death", bannedAt: new Date("2026-07-18T08:00:00Z"),
      expiresAt: new Date("2026-07-19T08:00:00Z"), status: "lifted", dryRun: true,
      createdAt: new Date("2026-07-18T08:05:00Z"), liftedAt: new Date("2026-07-19T11:50:00Z") },
  ]).returning()).map((b) => b.id);
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

  // ENFORCER_DRY_RUN is the production default: the enforcer writes the ban row and then
  // `continue`s, so nothing reaches Nitrado and the player is not banned. Notifying anyway
  // announces a punishment that was never inflicted — and the body tells them to spend an
  // unban token, which packages/tokens/src/redeem.ts would genuinely consume against a
  // 'pending' dry-run row.
  it("never notifies for a dry-run ban, however perfectly it otherwise matches", async () => {
    const keys = (await banAppliedGenerator(deps)).map((d) => d.naturalKey);
    // (G) is a verified owner's ban created inside the window — it differs from the real
    // ban (A) in exactly one column. Naming the row directly, rather than counting drafts,
    // is what makes this fail when the dry_run filter is deleted.
    expect(keys).not.toContain(`ban_applied:${banIds[6]}`);
    expect(keys).toContain(`ban_applied:${banIds[0]}`);
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

  // Deliberately not a copy of the ban_applied case: the reasoning is that a lift is only
  // news because the ban it ends was real. A dry-run ban never kept the player out, so
  // there is nothing to be back from.
  it("never announces the lift of a dry-run ban", async () => {
    const keys = (await banLiftedGenerator(deps)).map((d) => d.naturalKey);
    // (H) was lifted at 11:50Z, inside the window, and differs from the real lifted bans
    // (B) and (F) in exactly one column.
    expect(keys).not.toContain(`ban_lifted:${banIds[7]}`);
    expect(keys).toEqual(
      expect.arrayContaining([`ban_lifted:${banIds[1]}`, `ban_lifted:${banIds[5]}`]),
    );
  });
});
