import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, servers, players, lives, gamertagLinks } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { lifeQualifiedGenerator, survivalMilestoneGenerator } from "../src/generators/lives.js";

const { db, sql } = getTestDb();
const NOW = new Date("2026-07-19T12:00:00Z");
const deps = { db, now: NOW, since: new Date("2026-06-01T00:00:00Z"), lookbackHours: 48, siteUrl: "https://s" };

beforeAll(async () => {
  await db.insert(user).values({ id: "lf1", name: "LF1", email: "lf1@x.com" });
  const [s] = await db.insert(servers).values({ nitradoServiceId: 992001, name: "lifesrv", slug: "lifesrv" }).returning();
  const [p] = await db.insert(players).values({ gamertag: "LifeOne" }).returning();
  await db.insert(gamertagLinks).values({ userId: "lf1", gamertag: "LifeOne", status: "verified", verifiedAt: new Date("2026-06-02T00:00:00Z") });
  await db.insert(lives).values([
    // Started 8 days ago (-> 7d milestone) but qualified recently, inside the 48h
    // lookback window (-> life_qualified fires). Qualification can lag well behind
    // life start (e.g. playtime accrues slowly), so the two timestamps diverge here.
    { serverId: s!.id, playerId: p!.id, lifeNumber: 1, startedAt: new Date("2026-07-11T12:00:00Z"),
      playtimeSeconds: 4000, qualifiedAt: new Date("2026-07-19T10:00:00Z") },
    // Open but NOT qualified: qualified_at is null.
    { serverId: s!.id, playerId: p!.id, lifeNumber: 2, startedAt: new Date("2026-07-18T12:00:00Z"),
      playtimeSeconds: 60, qualifiedAt: null },
    // Open + qualified, but LONG ago -> excluded from life_qualified by the window,
    // still eligible for milestones.
    { serverId: s!.id, playerId: p!.id, lifeNumber: 3, startedAt: new Date("2026-06-05T12:00:00Z"),
      playtimeSeconds: 9000, qualifiedAt: new Date("2026-06-05T12:05:00Z") },
  ]);
});
afterAll(async () => { await sql.end(); });

describe("lifeQualifiedGenerator", () => {
  it("emits only for lives that qualified inside the window", async () => {
    const drafts = await lifeQualifiedGenerator(deps);
    // life 1 only: life 2 never qualified, life 3 qualified before the 48h window.
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.kind).toBe("life_qualified");
    expect(drafts[0]!.userId).toBe("lf1");
    expect(drafts[0]!.naturalKey).toMatch(/^life_qualified:\d+$/);
    expect(drafts[0]!.href).toMatch(/^\/players\/lifeone\/lifesrv\/lives\/1$/);
  });
});

describe("survivalMilestoneGenerator", () => {
  // windowStart = max(since, now - lookbackHours) = max(2026-06-01, 2026-07-17T12:00Z)
  // = 2026-07-17T12:00:00Z.
  it("emits only the 7d milestone for the 8-day-old life, whose crossing instant falls inside the window", async () => {
    const drafts = await survivalMilestoneGenerator(deps);
    const keys = drafts.map((d) => d.naturalKey).sort();
    // Life 1 started 2026-07-11T12:00Z: its 7d crossing is 2026-07-18T12:00Z, inside the
    // window, so it fires. Its 14d/30d crossings are in the future (days=8 < 14/30), so
    // they aren't reached at all yet — irrelevant to the window fix, just not due.
    expect(keys.filter((k) => k.includes(":7d:"))).toHaveLength(1);
    expect(keys.filter((k) => k.includes(":14d:"))).toHaveLength(0);
    expect(keys.filter((k) => k.includes(":30d:"))).toHaveLength(0);
  });

  it("does not emit any milestone for a life whose crossing instants are long outside the window", async () => {
    const drafts = await survivalMilestoneGenerator(deps);
    // Life 3 started 2026-06-05T12:00Z (44 days old at NOW): it has long since passed all
    // three thresholds (7d/14d/30d crossings are 2026-06-12, 2026-06-19, 2026-07-05), but
    // every one of those crossing instants is before windowStart (2026-07-17T12:00Z), so
    // none should be emitted. Before the fix, all three fired on every tick forever.
    expect(drafts.every((d) => !d.naturalKey.endsWith(":3"))).toBe(true);
  });

  it("never emits a milestone for the unqualified life", async () => {
    const drafts = await survivalMilestoneGenerator(deps);
    expect(drafts.every((d) => !d.body.includes("life 2"))).toBe(true);
  });

  it("emits exactly one draft in total across all fixture lives", async () => {
    const drafts = await survivalMilestoneGenerator(deps);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.naturalKey).toMatch(/^milestone:7d:\d+$/);
    expect(drafts[0]!.body).toContain("life 1");
  });
});
