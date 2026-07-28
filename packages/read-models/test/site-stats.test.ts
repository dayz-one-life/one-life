import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, kills } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { getSiteStats } from "../src/site-stats.js";
import { getAliveSurvivors } from "../src/survivors.js";

const { db } = getTestDb();

const now = new Date("2026-07-28T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

const svc = Math.floor(Math.random() * 1e8) + 47e7;
let serverId: number;
const insertedGamertags = new Set<string>();

let baseline: { deaths: number; alive: number };

async function insertLife(opts: {
  gamertag: string;
  endedAt: Date | null;
  playtimeSeconds: number;
  startedAt: Date;
  deathCause?: string | null;
}) {
  let [p] = await db.select().from(players).where(eq(players.gamertag, opts.gamertag));
  if (!p) {
    [p] = await db
      .insert(players)
      .values({ gamertag: opts.gamertag, firstSeenAt: opts.startedAt, lastSeenAt: now })
      .returning();
  }
  insertedGamertags.add(opts.gamertag);
  const [life] = await db
    .insert(lives)
    .values({
      serverId,
      playerId: p!.id,
      lifeNumber: 1,
      startedAt: opts.startedAt,
      endedAt: opts.endedAt,
      playtimeSeconds: opts.playtimeSeconds,
      deathCause: opts.deathCause ?? (opts.endedAt ? "died" : null),
    })
    .returning();
  return { life: life!, player: p! };
}

describe("getSiteStats", () => {
  beforeAll(async () => {
    baseline = await getSiteStats(db, now);

    const [s] = await db
      .insert(servers)
      .values({
        nitradoServiceId: svc,
        name: "Stats",
        map: "chernarusplus",
        slug: `stats-${svc}`,
        active: true,
      })
      .returning();
    serverId = s!.id;

    // deaths: 2 qualified ended lives (one by playtime, one instant PvP death)
    await insertLife({ gamertag: `St-DeadLong-${svc}`, startedAt: hoursAgo(30), endedAt: hoursAgo(25), playtimeSeconds: 7200 });
    await insertLife({ gamertag: `St-DeadPvp-${svc}`, startedAt: hoursAgo(20), endedAt: hoursAgo(20), playtimeSeconds: 30, deathCause: "pvp" });
    // excluded from deaths: unqualified ended life (sub-5-minute, no pvp, no kills)
    await insertLife({ gamertag: `St-Blip-${svc}`, startedAt: hoursAgo(10), endedAt: hoursAgo(10), playtimeSeconds: 90 });
    // alive: 1 open qualified life; excluded from BOTH: 1 open provisional life
    await insertLife({ gamertag: `St-Alive-${svc}`, startedAt: hoursAgo(5), endedAt: null, playtimeSeconds: 7200 });
    await insertLife({ gamertag: `St-Fresh-${svc}`, startedAt: hoursAgo(1), endedAt: null, playtimeSeconds: 60 });
  });

  afterAll(async () => {
    const ps = await db.select().from(players).where(inArray(players.gamertag, [...insertedGamertags]));
    const ids = ps.map((p) => p.id);
    if (ids.length) {
      await db.delete(kills).where(inArray(kills.killerPlayerId, ids));
      await db.delete(lives).where(inArray(lives.playerId, ids));
      await db.delete(players).where(inArray(players.id, ids));
    }
    await db.delete(servers).where(eq(servers.id, serverId));
  });

  it("counts ended qualified lives as deaths — unqualified ended lives excluded", async () => {
    const stats = await getSiteStats(db, now);
    // MUTATION CHECK for qualified-only: drop the qualifiedLifeCondition clause and St-Blip
    // makes this baseline.deaths + 3.
    expect(stats.deaths).toBe(baseline.deaths + 2);
  });

  it("never counts an open life as a death, however qualified", async () => {
    const stats = await getSiteStats(db, now);
    // MUTATION CHECK for ended-only: drop the isNotNull(lives.endedAt) clause and St-Alive
    // (open, 2h playtime — passes the SQL condition) makes deaths baseline.deaths + 3.
    expect(stats.deaths).toBe(baseline.deaths + 2);
  });

  it("alive IS the survivors board's total — same well, cannot disagree", async () => {
    const stats = await getSiteStats(db, now);
    const board = await getAliveSurvivors(db, { page: 1, pageSize: 1 }, now);
    expect(stats.alive).toBe(board.total);
    expect(stats.alive).toBeGreaterThanOrEqual(1); // St-Alive is on it; St-Fresh (provisional) is not
  });
});
