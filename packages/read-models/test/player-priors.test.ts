import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, kills, deathVerdicts } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { getPlayerPriors } from "../src/player-priors.js";
import { seedVerdict } from "./support/verdicts.js";

const { db, sql } = getTestDb();
const now = new Date("2026-07-14T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);
const svcA = Math.floor(Math.random() * 1e8) + 47e7;
const svcB = Math.floor(Math.random() * 1e8) + 48e7;
const tag = `priors-${svcA}`;
const firstTag = `firstlifer-${svcA}`;
const currentLifeStart = hoursAgo(10); // beforeLifeStartedAt for the main player
let chern: number; let sakh: number;
const pids: number[] = [];

beforeAll(async () => {
  const [a] = await db.insert(servers).values({ nitradoServiceId: svcA, name: "pr-chern", map: "chernarusplus", slug: `pr-chern-${svcA}`, active: true }).returning();
  const [b] = await db.insert(servers).values({ nitradoServiceId: svcB, name: "pr-sakh", map: "sakhal", slug: `pr-sakh-${svcB}`, active: true }).returning();
  chern = a!.id; sakh = b!.id;

  const [p] = await db.insert(players).values({ gamertag: tag, firstSeenAt: hoursAgo(200), lastSeenAt: now }).returning();
  pids.push(p!.id);
  const [fp] = await db.insert(players).values({ gamertag: firstTag, firstSeenAt: hoursAgo(3), lastSeenAt: now }).returning();
  pids.push(fp!.id);

  const priorRows = await db.insert(lives).values([
    // prior life 1 (chern): 1h playtime, pvp
    { serverId: chern, playerId: p!.id, lifeNumber: 1, startedAt: hoursAgo(100), endedAt: hoursAgo(96), playtimeSeconds: 3600, deathCause: "pvp" },
    // prior life 2 (sakh): 10h playtime — LONGEST → bestLifeMap = sakhal, pvp
    { serverId: sakh, playerId: p!.id, lifeNumber: 1, startedAt: hoursAgo(90), endedAt: hoursAgo(80), playtimeSeconds: 36000, deathCause: "pvp" },
    // prior life 3 (chern): most-recent prior DEATH → lastDeathCause = starvation
    { serverId: chern, playerId: p!.id, lifeNumber: 2, startedAt: hoursAgo(70), endedAt: hoursAgo(60), playtimeSeconds: 1800, deathCause: "starvation" },
    // CURRENT life (chern): open, started at the boundary → EXCLUDED from priors
    { serverId: chern, playerId: p!.id, lifeNumber: 3, startedAt: currentLifeStart, endedAt: null, playtimeSeconds: 0 },
    // first-lifer: a single (only) life
    { serverId: chern, playerId: fp!.id, lifeNumber: 1, startedAt: hoursAgo(3), endedAt: null, playtimeSeconds: 0 },
  ]).returning();
  // Causes come from the stored verdicts (stage 4), not from lives.death_cause.
  await seedVerdict(db, { lifeId: Number(priorRows[0]!.id), cause: "pvp", confidence: "definitive", attrBasis: "kill_line" });
  await seedVerdict(db, { lifeId: Number(priorRows[1]!.id), cause: "pvp", confidence: "definitive", attrBasis: "kill_line" });
  await seedVerdict(db, { lifeId: Number(priorRows[2]!.id), cause: "starvation", confidence: "strong" });

  await db.insert(kills).values([
    { serverId: sakh, killerGamertag: tag, killerPlayerId: p!.id, victimGamertag: "V1", weapon: "M4", distance: 40, occurredAt: hoursAgo(85) },   // prior
    { serverId: chern, killerGamertag: tag, killerPlayerId: p!.id, victimGamertag: "V2", weapon: "AK", distance: 60, occurredAt: hoursAgo(65) },   // prior
    { serverId: chern, killerGamertag: tag, killerPlayerId: p!.id, victimGamertag: "V3", weapon: "SVD", distance: 300, occurredAt: hoursAgo(5) },  // current life → excluded
  ]);
});
afterAll(async () => {
  await db.delete(kills).where(inArray(kills.serverId, [chern, sakh]));
  await db.delete(deathVerdicts).where(inArray(deathVerdicts.lifeId, db.select({ id: lives.id }).from(lives).where(inArray(lives.serverId, [chern, sakh]))));
  await db.delete(lives).where(inArray(lives.serverId, [chern, sakh]));
  await db.delete(players).where(inArray(players.id, pids));
  await db.delete(servers).where(inArray(servers.id, [chern, sakh]));
  await sql.end();
});

describe("getPlayerPriors", () => {
  it("aggregates prior lives globally across servers, excluding the current life", async () => {
    const pr = await getPlayerPriors(db, tag, currentLifeStart);
    expect(pr.livesLived).toBe(3);              // 3 priors, not 4 (current life excluded)
    expect(pr.longestLifeSeconds).toBe(36000);  // the sakhal life
    expect(pr.bestLifeMap).toBe("sakhal");      // cross-server: longest lived elsewhere
    expect(pr.totalKills).toBe(2);              // kills before the boundary only
  });

  it("distinguishes the usual death cause from the last death cause, as lower-case tag nouns", async () => {
    const pr = await getPlayerPriors(db, tag, currentLifeStart);
    expect(pr.usualDeathCause).toBe("pvp");                 // 2 PvP vs 1 Hunger and Thirst
    expect(pr.lastDeathCause).toBe("hunger and thirst");    // most-recent prior death (life 3)
  });

  it("returns zeros/nulls for a first-lifer (no prior lives)", async () => {
    const pr = await getPlayerPriors(db, firstTag, hoursAgo(3));
    expect(pr).toEqual({
      livesLived: 0, longestLifeSeconds: 0, totalKills: 0,
      usualDeathCause: null, lastDeathCause: null, bestLifeMap: null,
    });
  });

  it("returns zeros/nulls for an unknown gamertag", async () => {
    const pr = await getPlayerPriors(db, "nobody-xyz-123", now);
    expect(pr.livesLived).toBe(0);
    expect(pr.bestLifeMap).toBeNull();
  });

  async function famPlayer(name: string, deaths: { cause: string; confidence: string; deathCause?: string; by?: string; attrBasis?: string; attrGamertag?: string }[]) {
    const [famP] = await db.insert(players).values({ gamertag: name, firstSeenAt: hoursAgo(50), lastSeenAt: now }).returning();
    pids.push(famP!.id);
    let n = 0;
    for (const d of deaths) {
      n++;
      const [l] = await db.insert(lives).values({
        serverId: chern, playerId: famP!.id, lifeNumber: n, startedAt: hoursAgo(48 - n * 2), endedAt: hoursAgo(47 - n * 2),
        playtimeSeconds: 600, deathCause: d.deathCause ?? "died", deathByGamertag: d.by ?? null,
      }).returning();
      await seedVerdict(db, { lifeId: Number(l!.id), cause: d.cause, confidence: d.confidence, attrBasis: d.attrBasis ?? null, attrGamertag: d.attrGamertag ?? null });
    }
    return name;
  }

  it("usualDeathCause groups on the tag, so wolf and bear count as one family and beat pvp", async () => {
    const name = await famPlayer(`familytest-${svcA}`, [
      { cause: "animal_wolf", confidence: "definitive" }, { cause: "animal_bear", confidence: "definitive" },
      { cause: "pvp", confidence: "definitive", deathCause: "pvp", by: "Someone", attrBasis: "kill_line" },
    ]);
    expect((await getPlayerPriors(db, name, now)).usualDeathCause).toBe("wildlife");
  });

  it("three kills by three different players count as one usual cause", async () => {
    const name = await famPlayer(`threekillers-${svcA}`, [
      { cause: "pvp", confidence: "definitive", deathCause: "pvp", by: "Killer A", attrBasis: "kill_line", attrGamertag: "Killer A" },
      { cause: "pvp", confidence: "definitive", deathCause: "pvp", by: "Killer B", attrBasis: "kill_line", attrGamertag: "Killer B" },
      { cause: "pvp", confidence: "definitive", deathCause: "pvp", by: "Killer C", attrBasis: "kill_line", attrGamertag: "Killer C" },
      { cause: "fall", confidence: "definitive" }, { cause: "fall", confidence: "definitive" },
    ]);
    expect((await getPlayerPriors(db, name, now)).usualDeathCause).toBe("pvp");
  });

  it("no gamertag appears in priors", async () => {
    const name = await famPlayer(`nonames-${svcA}`, [
      { cause: "pvp", confidence: "definitive", deathCause: "pvp", by: "Named Killer", attrBasis: "kill_line", attrGamertag: "Named Killer" },
    ]);
    const pr = await getPlayerPriors(db, name, now);
    expect(pr.lastDeathCause).toBe("pvp");
    expect(JSON.stringify(pr)).not.toContain("Named Killer");
  });

  it("only definitive and strong verdicts count; inferred and pending deaths are left out", async () => {
    const name = await famPlayer(`inferredonly-${svcA}`, [
      { cause: "fall", confidence: "definitive" },
      { cause: "starvation", confidence: "inferred" }, { cause: "starvation", confidence: "inferred" },
    ]);
    const pr = await getPlayerPriors(db, name, now);
    expect(pr.usualDeathCause).toBe("fall");
    expect(pr.lastDeathCause).toBe("fall");
  });
});
