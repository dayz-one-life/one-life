import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, kills } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { getAliveSurvivors } from "../src/survivors.js";

const { db, sql } = getTestDb();

const now = new Date("2026-07-14T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

const svcChern = Math.floor(Math.random() * 1e8) + 40e7;
const svcSakh = Math.floor(Math.random() * 1e8) + 41e7;

let chern: { id: number; slug: string };
let sakh: { id: number; slug: string };

// Insert helpers matching the shape of the task brief's illustrative `insertLife`/`insertKill`,
// adapted onto the real Drizzle schema + test harness. `players` are global (gamertag-unique),
// so we upsert-by-lookup rather than blind-insert.
const insertedGamertags = new Set<string>();

async function insertLife(opts: {
  serverId: number;
  gamertag: string;
  endedAt: Date | null;
  playtimeSeconds: number;
  startedAt: Date;
  deathCause?: string | null;
}) {
  let [p] = await db.select().from(players).where(eq(players.gamertag, opts.gamertag));
  if (!p) {
    [p] = await db.insert(players).values({ gamertag: opts.gamertag, firstSeenAt: opts.startedAt, lastSeenAt: now }).returning();
  }
  insertedGamertags.add(opts.gamertag);
  await db.insert(lives).values({
    serverId: opts.serverId,
    playerId: p!.id,
    lifeNumber: 1,
    startedAt: opts.startedAt,
    endedAt: opts.endedAt,
    playtimeSeconds: opts.playtimeSeconds,
    deathCause: opts.deathCause ?? null,
  });
}

async function insertKill(opts: {
  serverId: number;
  killerGamertag: string;
  victimGamertag: string;
  distance: number;
  occurredAt: Date;
}) {
  await db.insert(kills).values({
    serverId: opts.serverId,
    killerGamertag: opts.killerGamertag,
    victimGamertag: opts.victimGamertag,
    distance: opts.distance,
    occurredAt: opts.occurredAt,
  });
}

beforeAll(async () => {
  const [c] = await db.insert(servers).values({ nitradoServiceId: svcChern, name: "Survivors-Chernarus", map: "chernarusplus", slug: `survivors-chernarus-${svcChern}`, active: true }).returning();
  const [s] = await db.insert(servers).values({ nitradoServiceId: svcSakh, name: "Survivors-Sakhal", map: "sakhal", slug: `survivors-sakhal-${svcSakh}`, active: true }).returning();
  chern = { id: c!.id, slug: c!.slug! };
  sakh = { id: s!.id, slug: s!.slug! };
});

afterEach(async () => {
  await db.delete(kills).where(inArray(kills.serverId, [chern.id, sakh.id]));
  await db.delete(lives).where(inArray(lives.serverId, [chern.id, sakh.id]));
  if (insertedGamertags.size > 0) {
    await db.delete(players).where(inArray(players.gamertag, [...insertedGamertags]));
    insertedGamertags.clear();
  }
});

afterAll(async () => {
  await db.delete(servers).where(inArray(servers.id, [chern.id, sakh.id]));
  await sql.end();
});

describe("getAliveSurvivors", () => {
  it("returns only players with an open QUALIFIED life", async () => {
    await insertLife({ serverId: chern.id, gamertag: "Alive", endedAt: null, playtimeSeconds: 600, startedAt: hoursAgo(2) });
    await insertLife({ serverId: chern.id, gamertag: "Dead", endedAt: hoursAgo(1), playtimeSeconds: 900, startedAt: hoursAgo(3) });
    await insertLife({ serverId: chern.id, gamertag: "Fresh", endedAt: null, playtimeSeconds: 60, startedAt: minutesAgo(1) });

    const res = await getAliveSurvivors(db, { sort: "kills", page: 1 }, now);
    expect(res.rows.map((r) => r.gamertag)).toEqual(["Alive"]);
    expect(res.total).toBe(1);
    expect(res.pageSize).toBe(25);
  });

  it("qualifies an open sub-300s life that has a kill in-window", async () => {
    await insertLife({ serverId: chern.id, gamertag: "Sniper", endedAt: null, playtimeSeconds: 120, startedAt: minutesAgo(5) });
    await insertKill({ serverId: chern.id, killerGamertag: "Sniper", victimGamertag: "X", distance: 210, occurredAt: minutesAgo(2) });
    const res = await getAliveSurvivors(db, { sort: "kills", page: 1 }, now);
    expect(res.rows.map((r) => r.gamertag)).toContain("Sniper");
  });

  it("counts kills THIS LIFE and longest kill this life", async () => {
    await insertLife({ serverId: chern.id, gamertag: "Killer", endedAt: null, playtimeSeconds: 1800, startedAt: hoursAgo(1) });
    // in-life kills
    await insertKill({ serverId: chern.id, killerGamertag: "Killer", victimGamertag: "A", distance: 100, occurredAt: minutesAgo(30) });
    await insertKill({ serverId: chern.id, killerGamertag: "Killer", victimGamertag: "B", distance: 350, occurredAt: minutesAgo(10) });
    // BEFORE this life started — must be excluded
    await insertKill({ serverId: chern.id, killerGamertag: "Killer", victimGamertag: "C", distance: 999, occurredAt: hoursAgo(5) });
    const res = await getAliveSurvivors(db, { sort: "kills", page: 1 }, now);
    const row = res.rows.find((r) => r.gamertag === "Killer")!;
    expect(row.killsThisLife).toBe(2);
    expect(row.longestKillMeters).toBe(350);
  });

  it("returns null longestKill when the life has no ranged kills", async () => {
    await insertLife({ serverId: chern.id, gamertag: "Pacifist", endedAt: null, playtimeSeconds: 700, startedAt: hoursAgo(1) });
    const res = await getAliveSurvivors(db, { sort: "kills", page: 1 }, now);
    expect(res.rows.find((r) => r.gamertag === "Pacifist")!.longestKillMeters).toBeNull();
  });

  it("emits two rows for a player alive on both maps; slug filter narrows", async () => {
    await insertLife({ serverId: chern.id, gamertag: "Both", endedAt: null, playtimeSeconds: 700, startedAt: hoursAgo(1) });
    await insertLife({ serverId: sakh.id, gamertag: "Both", endedAt: null, playtimeSeconds: 700, startedAt: hoursAgo(1) });
    const all = await getAliveSurvivors(db, { sort: "kills", page: 1 }, now);
    expect(all.rows.filter((r) => r.gamertag === "Both").map((r) => r.slug).sort()).toEqual([chern.slug, sakh.slug].sort());
    const onlySakh = await getAliveSurvivors(db, { slug: sakh.slug, sort: "kills", page: 1 }, now);
    expect(onlySakh.rows.every((r) => r.slug === sakh.slug)).toBe(true);
    expect(onlySakh.rows.some((r) => r.gamertag === "Both")).toBe(true);
  });

  it("sorts by the chosen metric desc with deterministic tie-break", async () => {
    // two players with equal kills(0) — tie broken by timeAlive desc
    await insertLife({ serverId: chern.id, gamertag: "Longer", endedAt: null, playtimeSeconds: 3600, startedAt: hoursAgo(2) });
    await insertLife({ serverId: chern.id, gamertag: "Shorter", endedAt: null, playtimeSeconds: 600, startedAt: hoursAgo(1) });
    const byKills = await getAliveSurvivors(db, { sort: "kills", page: 1 }, now);
    expect(byKills.rows.map((r) => r.gamertag)).toEqual(["Longer", "Shorter"]);
    const byLongest = await getAliveSurvivors(db, { sort: "longest", page: 1 }, now);
    expect(byLongest.rows[0]?.gamertag).toBeDefined(); // longest-kill sort runs without error
  });

  it("paginates with a stable total", async () => {
    for (let i = 0; i < 30; i++) {
      await insertLife({ serverId: chern.id, gamertag: `P${String(i).padStart(2, "0")}`, endedAt: null, playtimeSeconds: 600 + i, startedAt: hoursAgo(2) });
    }
    const p1 = await getAliveSurvivors(db, { sort: "time", page: 1 }, now);
    const p2 = await getAliveSurvivors(db, { sort: "time", page: 2 }, now);
    expect(p1.total).toBe(30);
    expect(p1.rows).toHaveLength(25);
    expect(p2.rows).toHaveLength(5);
    // no overlap
    const s1 = new Set(p1.rows.map((r) => r.gamertag));
    expect(p2.rows.every((r) => !s1.has(r.gamertag))).toBe(true);
  });

  it("character is null in the core query (enriched in Task 2)", async () => {
    await insertLife({ serverId: chern.id, gamertag: "Anon", endedAt: null, playtimeSeconds: 700, startedAt: hoursAgo(1) });
    const res = await getAliveSurvivors(db, { sort: "kills", page: 1 }, now);
    expect(res.rows[0]?.character).toBeNull();
  });

  it("clamps page to >= 1 and returns empty rows with the real total for an out-of-range page", async () => {
    await insertLife({ serverId: chern.id, gamertag: "Solo", endedAt: null, playtimeSeconds: 700, startedAt: hoursAgo(1) });
    const clamped = await getAliveSurvivors(db, { sort: "kills", page: 0 }, now);
    expect(clamped.page).toBe(1);
    expect(clamped.rows.map((r) => r.gamertag)).toEqual(["Solo"]);

    const tooHigh = await getAliveSurvivors(db, { sort: "kills", page: 99 }, now);
    expect(tooHigh.rows).toEqual([]);
    expect(tooHigh.total).toBe(1);
  });
});
