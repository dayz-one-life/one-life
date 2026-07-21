import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, kills, bans, gamertagLinks, user } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { getPlayerPage } from "../src/player-page.js";

const { db, sql } = getTestDb();
const now = new Date("2026-07-14T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);
const svcA = Math.floor(Math.random() * 1e8) + 47e7;
const svcB = Math.floor(Math.random() * 1e8) + 48e7;
const uid = `pp-${svcA}`;
let chern: number; let sakh: number;

beforeAll(async () => {
  const [a] = await db.insert(servers).values({ nitradoServiceId: svcA, name: "pp-chern", map: "chernarusplus", slug: `chern-${svcA}`, active: true }).returning();
  const [b] = await db.insert(servers).values({ nitradoServiceId: svcB, name: "pp-sakh", map: "sakhal", slug: `sakh-${svcB}`, active: true }).returning();
  chern = a!.id; sakh = b!.id;
  const [p] = await db.insert(players).values({ gamertag: "Legend", firstSeenAt: hoursAgo(100), lastSeenAt: now }).returning();
  // Alive qualified life on Chernarus (open session, 1 kill)
  const [alive] = await db.insert(lives).values({ serverId: chern, playerId: p!.id, lifeNumber: 2, startedAt: hoursAgo(6), endedAt: null, playtimeSeconds: 0 }).returning();
  await db.insert(sessions).values({ serverId: chern, playerId: p!.id, lifeId: alive!.id, connectedAt: hoursAgo(6) });
  await db.insert(kills).values({ serverId: chern, killerGamertag: "Legend", victimGamertag: "BanditKing", weapon: "SVD", distance: 312, occurredAt: hoursAgo(2) });
  // Past qualified (PvP) life on Sakhal that ended + triggered a ban
  const [dead] = await db.insert(lives).values({ serverId: sakh, playerId: p!.id, lifeNumber: 1, startedAt: hoursAgo(30), endedAt: hoursAgo(6), playtimeSeconds: 14520, deathCause: "pvp", deathByGamertag: "NightOwl", deathWeapon: "KA-M", deathDistance: 120, energyAtDeath: 3200, waterAtDeath: 2800, bleedSourcesAtDeath: 2 }).returning();
  await db.insert(sessions).values({ serverId: sakh, playerId: p!.id, lifeId: dead!.id, connectedAt: hoursAgo(30), disconnectedAt: hoursAgo(6), durationSeconds: 14520 });
  await db.insert(bans).values({ serverId: sakh, gamertag: "Legend", lifeStartedAt: hoursAgo(30), reason: "qualified_death", qualifiedBy: "pvp-death", bannedAt: hoursAgo(6), expiresAt: hoursAgo(-18), status: "applied", dryRun: false });
  await db.insert(user).values({ id: uid, name: "x", email: `${uid}@example.com` });
  await db.insert(gamertagLinks).values({ userId: uid, gamertag: "Legend", status: "verified", verifiedAt: hoursAgo(50) });
});
afterAll(async () => {
  await db.delete(kills).where(inArray(kills.serverId, [chern, sakh]));
  await db.delete(sessions).where(inArray(sessions.serverId, [chern, sakh]));
  await db.delete(bans).where(inArray(bans.serverId, [chern, sakh]));
  await db.delete(lives).where(inArray(lives.serverId, [chern, sakh]));
  await db.delete(gamertagLinks).where(eq(gamertagLinks.userId, uid));
  await db.delete(user).where(eq(user.id, uid));
  await db.delete(players).where(eq(players.gamertag, "Legend"));
  await db.delete(servers).where(inArray(servers.id, [chern, sakh]));
  await sql.end();
});

describe("getPlayerPage", () => {
  it("returns null for an unknown gamertag", async () => {
    expect(await getPlayerPage(db, "nobody-xyz", now)).toBeNull();
  });
  it("marks verified and totals", async () => {
    const pg = (await getPlayerPage(db, "legend", now))!; // slug-normalized lookup
    expect(pg.gamertag).toBe("Legend");
    expect(pg.verified).toBe(true);
    expect(pg.aliveAnywhere).toBe(true);
    expect(pg.totals.lives).toBe(2);
    expect(pg.totals.deaths).toBe(1);
    expect(pg.totals.kills).toBe(1);
  });
  it("has an alive standing on Chernarus with the kill list", async () => {
    const pg = (await getPlayerPage(db, "Legend", now))!;
    const alive = pg.standing.find((s) => s.state === "alive")!;
    expect(alive.map).toBe("chernarusplus");
    expect(alive.alive!.kills).toBe(1);
    expect(alive.alive!.longestKillMeters).toBe(312);
    expect(alive.alive!.killList[0]!.victimGamertag).toBe("BanditKing");
    expect(alive.alive?.lifeNumber).toBeGreaterThanOrEqual(1);
  });
  it("has a banned standing on Sakhal with a lift time", async () => {
    const pg = (await getPlayerPage(db, "Legend", now))!;
    const banned = pg.standing.find((s) => s.state === "banned")!;
    expect(banned.ban!.expiresAt).not.toBeNull();
    expect(banned.ban!.liftPending).toBe(false);
    expect(banned.ban!.triggeringLifeNumber).toBe(1);
  });
  it("lists the past (ended) life with death + vitals", async () => {
    const pg = (await getPlayerPage(db, "Legend", now))!;
    expect(pg.pastLives.length).toBe(1);
    const life = pg.pastLives[0]!;
    expect(life.death).toMatchObject({ cause: "pvp", byGamertag: "NightOwl", weapon: "KA-M" });
    expect(life.vitals).toMatchObject({ energy: 3200, bleedSources: 2 });
    expect(life.sessions).toBe(1);
  });
  it("past lives on the visible slice carry a classified verdict", async () => {
    const page = (await getPlayerPage(db, "Legend", now))!;
    const past = page.pastLives[0]!;
    expect(past.death.verdict).not.toBeNull();
    expect(past.death.verdict!.confidence).toMatch(/^(high|low)$/);
    expect(past.death.verdict!.cause).toBe("pvp");
  });
});

describe("getPlayerPage phantom dry-run bans", () => {
  const svcD = Math.floor(Math.random() * 1e8) + 51e7;
  let dryServer: number;
  beforeAll(async () => {
    const [s] = await db.insert(servers).values({ nitradoServiceId: svcD, name: "pp-dry", map: "chernarusplus", slug: `dry-${svcD}`, active: true }).returning();
    dryServer = s!.id;
    const [pl] = await db.insert(players).values({ gamertag: "Phantom", firstSeenAt: hoursAgo(200), lastSeenAt: now }).returning();
    // One ended life on this server so the card isn't skipped entirely (livesRows.length !== 0).
    const [ended] = await db
      .insert(lives)
      .values({ serverId: dryServer, playerId: pl!.id, lifeNumber: 1, startedAt: hoursAgo(40), endedAt: hoursAgo(20), playtimeSeconds: 600, deathCause: "pvp" })
      .returning();
    // A dry-run ban never actually placed on Nitrado — must not render as "banned".
    await db.insert(bans).values({ serverId: dryServer, gamertag: "Phantom", lifeStartedAt: ended!.startedAt, reason: "qualified_death", qualifiedBy: "pvp-death", bannedAt: hoursAgo(20), expiresAt: hoursAgo(-4), status: "pending", dryRun: true });
  });
  afterAll(async () => {
    await db.delete(bans).where(eq(bans.serverId, dryServer));
    await db.delete(lives).where(eq(lives.serverId, dryServer));
    await db.delete(players).where(eq(players.gamertag, "Phantom"));
    await db.delete(servers).where(eq(servers.id, dryServer));
  });

  it("does not render a dry-run ban as banned — falls through to idle (no open life)", async () => {
    const pg = (await getPlayerPage(db, "Phantom", now))!;
    const card = pg.standing.find((s) => s.serverId === dryServer)!;
    expect(card).toBeDefined();
    expect(card.state).not.toBe("banned");
    expect(card.state).toBe("idle");
    expect(card.ban).toBeNull();
  });

  it("positive control: a dry_run=false pending ban STILL renders as banned", async () => {
    const svcR = Math.floor(Math.random() * 1e8) + 52e7;
    const [s] = await db.insert(servers).values({ nitradoServiceId: svcR, name: "pp-real", map: "chernarusplus", slug: `real-${svcR}` }).returning();
    const realServer = s!.id;
    try {
      const [pl] = await db.insert(players).values({ gamertag: "RealBan", firstSeenAt: hoursAgo(200), lastSeenAt: now }).returning();
      const [ended] = await db
        .insert(lives)
        .values({ serverId: realServer, playerId: pl!.id, lifeNumber: 1, startedAt: hoursAgo(40), endedAt: hoursAgo(20), playtimeSeconds: 600, deathCause: "pvp" })
        .returning();
      await db.insert(bans).values({ serverId: realServer, gamertag: "RealBan", lifeStartedAt: ended!.startedAt, reason: "qualified_death", qualifiedBy: "pvp-death", bannedAt: hoursAgo(20), expiresAt: hoursAgo(-4), status: "pending", dryRun: false });

      const pg = (await getPlayerPage(db, "RealBan", now))!;
      const card = pg.standing.find((s2) => s2.serverId === realServer)!;
      expect(card).toBeDefined();
      expect(card.state).toBe("banned");
      expect(card.ban).not.toBeNull();
    } finally {
      await db.delete(bans).where(eq(bans.serverId, realServer));
      await db.delete(lives).where(eq(lives.serverId, realServer));
      await db.delete(players).where(eq(players.gamertag, "RealBan"));
      await db.delete(servers).where(eq(servers.id, realServer));
    }
  });
});

describe("getPlayerPage pagination", () => {
  const svcP = Math.floor(Math.random() * 1e8) + 49e7;
  let srv: number;
  beforeAll(async () => {
    const [s] = await db.insert(servers).values({ nitradoServiceId: svcP, name: "pg-page", map: "chernarusplus", slug: `pgpage-${svcP}`, active: true }).returning();
    srv = s!.id;
    const [pl] = await db.insert(players).values({ gamertag: "Prolific", firstSeenAt: hoursAgo(1000), lastSeenAt: now }).returning();
    // 12 ended qualified lives, each ≥5min playtime so they qualify; newest first by endedAt
    for (let i = 0; i < 12; i++) {
      await db.insert(lives).values({
        serverId: srv, playerId: pl!.id, lifeNumber: i + 1,
        startedAt: hoursAgo(50 - i * 2), endedAt: hoursAgo(49 - i * 2),
        playtimeSeconds: 600, deathCause: "pvp", deathByGamertag: `killer${i}`,
      });
    }
  });
  afterAll(async () => {
    await db.delete(lives).where(eq(lives.serverId, srv));
    await db.delete(players).where(eq(players.gamertag, "Prolific"));
    await db.delete(servers).where(eq(servers.id, srv));
  });

  it("returns 10 newest on page 1 with the true total", async () => {
    const pg = (await getPlayerPage(db, "Prolific", now, { page: 1 }))!;
    expect(pg.pastLivesTotal).toBe(12);
    expect(pg.pastLivesPage).toBe(1);
    expect(pg.pastLivesPageSize).toBe(10);
    expect(pg.pastLives.length).toBe(10);
    // newest death first
    expect(pg.pastLives[0]!.endedAt.getTime()).toBeGreaterThan(pg.pastLives[1]!.endedAt.getTime());
    // totals reflect ALL lives, not the slice
    expect(pg.totals.deaths).toBe(12);
  });
  it("returns the remainder on page 2", async () => {
    const pg = (await getPlayerPage(db, "Prolific", now, { page: 2 }))!;
    expect(pg.pastLives.length).toBe(2);
    expect(pg.pastLivesPage).toBe(2);
  });
  it("clamps a too-large page to the last page", async () => {
    const pg = (await getPlayerPage(db, "Prolific", now, { page: 99 }))!;
    expect(pg.pastLivesPage).toBe(2);
    expect(pg.pastLives.length).toBe(2);
  });
});
