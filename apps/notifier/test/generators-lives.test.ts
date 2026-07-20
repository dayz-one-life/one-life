import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { user, servers, players, lives, sessions, gamertagLinks } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { lifeQualifiedGenerator, survivalMilestoneGenerator } from "../src/generators/lives.js";

const { db, sql } = getTestDb();
const NOW = new Date("2026-07-19T12:00:00Z");
const deps = { db, now: NOW, since: new Date("2026-06-01T00:00:00Z"), lookbackHours: 48, siteUrl: "https://s" };
// windowStart = max(since, now - 48h) = 2026-07-17T12:00:00Z.

beforeAll(async () => {
  await db.insert(user).values([
    { id: "lf1", name: "LF1", email: "lf1@x.com" },
    { id: "lf2", name: "LF2", email: "lf2@x.com" },
  ]);
  const [s] = await db.insert(servers).values({ nitradoServiceId: 992001, name: "lifesrv", slug: "lifesrv" }).returning();
  // lastSeenAt is the heartbeat that caps an OPEN session's contribution.
  const [p] = await db.insert(players).values({ gamertag: "LifeOne", lastSeenAt: NOW }).returning();
  // The privacy boundary's negative case: lf2 has CLAIMED LifeTwo but never completed the
  // emote challenge, so the link sits at 'pending'. Anyone can type a gamertag into the claim
  // box — without the verified predicate, claiming a stranger's tag would stream that
  // stranger's life events into your inbox.
  const [p2] = await db.insert(players).values({ gamertag: "LifeTwo", lastSeenAt: NOW }).returning();
  await db.insert(gamertagLinks).values([
    { userId: "lf1", gamertag: "LifeOne", status: "verified", verifiedAt: new Date("2026-06-02T00:00:00Z") },
    { userId: "lf2", gamertag: "LifeTwo", status: "pending" },
  ]);
  const inserted = await db.insert(lives).values([
    // 1. Started 8 days ago (-> 7d milestone). Its playtime only crosses 300s during a
    //    session that starts inside the window, so it qualifies inside the window.
    { serverId: s!.id, playerId: p!.id, lifeNumber: 1, startedAt: new Date("2026-07-11T12:00:00Z"), playtimeSeconds: 200 },
    // 2. Open, one short closed session, no kills -> never qualified.
    { serverId: s!.id, playerId: p!.id, lifeNumber: 2, startedAt: new Date("2026-07-18T12:00:00Z"), playtimeSeconds: 60 },
    // 3. Open + qualified LONG ago -> excluded from life_qualified by the window,
    //    and all its milestone crossings are outside the window too.
    { serverId: s!.id, playerId: p!.id, lifeNumber: 3, startedAt: new Date("2026-06-05T12:00:00Z"), playtimeSeconds: 9000 },
    // 4. THE MID-SESSION CASE the materialized column could not see: no closed session,
    //    so lives.playtime_seconds is still 0, but the OPEN session connected at 11:00
    //    and lastSeenAt is NOW (12:00) -> 3600s live playtime, crossing 300s at 11:05,
    //    inside the window. Must be emitted.
    { serverId: s!.id, playerId: p!.id, lifeNumber: 4, startedAt: new Date("2026-07-19T11:00:00Z"), playtimeSeconds: 0 },
    // 5. BOUNDARY: qualifies at exactly windowStart (2026-07-17T12:00:00Z). The window
    //    is inclusive, so it must be emitted. Too young for any milestone.
    { serverId: s!.id, playerId: p!.id, lifeNumber: 5, startedAt: new Date("2026-07-17T11:55:00Z"), playtimeSeconds: 600 },
    // 6. THE PENDING-LINK CASE, deliberately a carbon copy of life 1 (same age, same session
    //    shape): qualifies inside the window AND crosses its 7d milestone inside the window,
    //    so BOTH generators would emit for it if the verified predicate were dropped.
    { serverId: s!.id, playerId: p2!.id, lifeNumber: 1, startedAt: new Date("2026-07-11T12:00:00Z"), playtimeSeconds: 200 },
  ]).returning();
  const [l1, l2, l3, l4, l5, l6] = inserted;
  await db.insert(sessions).values([
    // life 1: 200s already banked (closed, pre-window), then a session inside the window
    // that carries it past 300s at 2026-07-18T12:01:40Z.
    { serverId: s!.id, playerId: p!.id, lifeId: l1!.id, connectedAt: new Date("2026-07-11T12:00:00Z"),
      disconnectedAt: new Date("2026-07-11T12:03:20Z"), durationSeconds: 200 },
    { serverId: s!.id, playerId: p!.id, lifeId: l1!.id, connectedAt: new Date("2026-07-18T12:00:00Z"),
      disconnectedAt: new Date("2026-07-18T12:10:00Z"), durationSeconds: 600 },
    // life 2: 60s only.
    { serverId: s!.id, playerId: p!.id, lifeId: l2!.id, connectedAt: new Date("2026-07-18T12:00:00Z"),
      disconnectedAt: new Date("2026-07-18T12:01:00Z"), durationSeconds: 60 },
    // life 3: crossed 300s at 2026-06-05T12:05:00Z, far before the window.
    { serverId: s!.id, playerId: p!.id, lifeId: l3!.id, connectedAt: new Date("2026-06-05T12:00:00Z"),
      disconnectedAt: new Date("2026-06-05T14:30:00Z"), durationSeconds: 9000 },
    // life 4: OPEN session, never closed -> zero stored playtime.
    { serverId: s!.id, playerId: p!.id, lifeId: l4!.id, connectedAt: new Date("2026-07-19T11:00:00Z"),
      disconnectedAt: null, durationSeconds: null },
    // life 5: connected 11:55, closed after 600s -> crosses 300s at exactly 12:00:00Z.
    { serverId: s!.id, playerId: p!.id, lifeId: l5!.id, connectedAt: new Date("2026-07-17T11:55:00Z"),
      disconnectedAt: new Date("2026-07-17T12:05:00Z"), durationSeconds: 600 },
    // life 6 (pending link): identical to life 1's shape, so nothing but the link status
    // can explain its absence from the drafts.
    { serverId: s!.id, playerId: p2!.id, lifeId: l6!.id, connectedAt: new Date("2026-07-11T12:00:00Z"),
      disconnectedAt: new Date("2026-07-11T12:03:20Z"), durationSeconds: 200 },
    { serverId: s!.id, playerId: p2!.id, lifeId: l6!.id, connectedAt: new Date("2026-07-18T12:00:00Z"),
      disconnectedAt: new Date("2026-07-18T12:10:00Z"), durationSeconds: 600 },
  ]);
});
afterAll(async () => { await sql.end(); });

describe("lifeQualifiedGenerator", () => {
  it("emits only for lives that qualified inside the window", async () => {
    const drafts = await lifeQualifiedGenerator(deps);
    const bodies = drafts.map((d) => d.body).sort();
    // lives 1, 4 and 5. life 2 never qualified; life 3 qualified 2026-06-05, before windowStart.
    expect(drafts).toHaveLength(3);
    expect(bodies.some((b) => b.includes("life 1"))).toBe(true);
    expect(bodies.some((b) => b.includes("life 4"))).toBe(true);
    expect(drafts[0]!.kind).toBe("life_qualified");
    expect(drafts[0]!.userId).toBe("lf1");
    expect(drafts[0]!.naturalKey).toMatch(/^life_qualified:\d+$/);
    expect(drafts.map((d) => d.href)).toContain("/players/lifeone/lifesrv/lives/1");
  });

  it("emits a life that crossed the threshold mid-session, with zero stored playtime", async () => {
    // Regression: the retired lives.qualified_at column was only written at session
    // close, so this life read as unqualified until the player disconnected.
    const drafts = await lifeQualifiedGenerator(deps);
    const l4 = drafts.find((d) => d.body.includes("life 4"));
    expect(l4).toBeDefined();
    expect(l4!.href).toBe("/players/lifeone/lifesrv/lives/4");
  });

  it("includes a life that qualified at exactly windowStart (inclusive lower bound)", async () => {
    const drafts = await lifeQualifiedGenerator(deps);
    expect(drafts.some((d) => d.body.includes("life 5"))).toBe(true);
  });

  // CLAUDE.md: every notification kind is scoped to the user's own VERIFIED links. Claiming a
  // gamertag is unauthenticated — the emote challenge is what proves ownership — so a merely
  // 'pending' link must yield nothing. Life 6 is otherwise identical to life 1, which does emit.
  it("never emits for a life whose gamertag link is only pending", async () => {
    const drafts = await lifeQualifiedGenerator(deps);
    expect(drafts.filter((d) => d.userId === "lf2")).toHaveLength(0);
    // Guards the fixture itself: if life 6 stopped qualifying, this test would pass while
    // asserting nothing. lf1's identically-shaped life 1 proves the shape still emits.
    expect(drafts.some((d) => d.userId === "lf1" && d.body.includes("life 1"))).toBe(true);
  });
});

describe("survivalMilestoneGenerator", () => {
  it("emits only the 7d milestone for the 8-day-old life, whose crossing instant falls inside the window", async () => {
    const drafts = await survivalMilestoneGenerator(deps);
    const keys = drafts.map((d) => d.naturalKey).sort();
    // Life 1 started 2026-07-11T12:00Z: its 7d crossing is 2026-07-18T12:00Z, inside the
    // window, so it fires. Its 14d/30d crossings are in the future (days=8 < 14/30).
    expect(keys.filter((k) => k.includes(":7d:"))).toHaveLength(1);
    expect(keys.filter((k) => k.includes(":14d:"))).toHaveLength(0);
    expect(keys.filter((k) => k.includes(":30d:"))).toHaveLength(0);
  });

  it("does not emit any milestone for a life whose crossing instants are long outside the window", async () => {
    const drafts = await survivalMilestoneGenerator(deps);
    // Life 3 started 2026-06-05T12:00Z (44 days old): all three crossings precede
    // windowStart. Before the window fix, all three fired on every tick forever.
    expect(drafts.every((d) => !d.body.includes("life 3"))).toBe(true);
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

  // Same boundary as lifeQualifiedGenerator — asserted separately because both generators
  // route through openQualifiedLives() and a future refactor could give them separate joins.
  it("never emits a milestone for a life whose gamertag link is only pending", async () => {
    const drafts = await survivalMilestoneGenerator(deps);
    expect(drafts.filter((d) => d.userId === "lf2")).toHaveLength(0);
    expect(drafts.some((d) => d.userId === "lf1")).toBe(true);
  });
});
