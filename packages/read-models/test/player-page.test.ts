import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, sessions, kills, bans, gamertagLinks, user, avatars, playerGamertags } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { getPlayerPage } from "../src/player-page.js";

const { db, sql } = getTestDb();
const now = new Date("2026-07-14T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);
const svcA = Math.floor(Math.random() * 1e8) + 47e7;
const svcB = Math.floor(Math.random() * 1e8) + 48e7;
const svcC = Math.floor(Math.random() * 1e8) + 53e7;
const uid = `pp-${svcA}`;
let chern: number; let sakh: number; let idle: number;

beforeAll(async () => {
  const [a] = await db.insert(servers).values({ nitradoServiceId: svcA, name: "pp-chern", map: "chernarusplus", slug: `chern-${svcA}`, active: true }).returning();
  const [b] = await db.insert(servers).values({ nitradoServiceId: svcB, name: "pp-sakh", map: "sakhal", slug: `sakh-${svcB}`, active: true }).returning();
  chern = a!.id; sakh = b!.id;
  const [p] = await db.insert(players).values({ gamertag: "Legend", firstSeenAt: hoursAgo(100), lastSeenAt: now }).returning();
  // Alive qualified life on Chernarus (open session, 1 kill)
  const [alive] = await db.insert(lives).values({ serverId: chern, playerId: p!.id, lifeNumber: 2, startedAt: hoursAgo(6), endedAt: null, playtimeSeconds: 0 }).returning();
  await db.insert(sessions).values({ serverId: chern, playerId: p!.id, lifeId: alive!.id, connectedAt: hoursAgo(6) });
  await db.insert(kills).values({ serverId: chern, killerGamertag: "Legend", killerPlayerId: p!.id, victimGamertag: "BanditKing", weapon: "SVD", distance: 312, occurredAt: hoursAgo(2) });
  // Past qualified (PvP) life on Sakhal that ended + triggered a ban
  const [dead] = await db.insert(lives).values({ serverId: sakh, playerId: p!.id, lifeNumber: 1, startedAt: hoursAgo(30), endedAt: hoursAgo(6), playtimeSeconds: 14520, deathCause: "pvp", deathByGamertag: "NightOwl", deathWeapon: "KA-M", deathDistance: 120, energyAtDeath: 3200, waterAtDeath: 2800, bleedSourcesAtDeath: 2 }).returning();
  await db.insert(sessions).values({ serverId: sakh, playerId: p!.id, lifeId: dead!.id, connectedAt: hoursAgo(30), disconnectedAt: hoursAgo(6), durationSeconds: 14520 });
  await db.insert(bans).values({ serverId: sakh, gamertag: "Legend", lifeStartedAt: hoursAgo(30), reason: "qualified_death", qualifiedBy: "pvp-death", bannedAt: hoursAgo(6), expiresAt: hoursAgo(-18), status: "applied", dryRun: false });
  const [c] = await db.insert(servers).values({ nitradoServiceId: svcC, name: "pp-idle", map: "enoch", slug: `idle-${svcC}`, active: true }).returning();
  idle = c!.id;
  // Two ENDED lives, no ban, no open life → an idle standing. Inserted oldest-first so the test
  // proves the read model picks the most recent, not merely the first row it happens to see.
  await db.insert(lives).values({ serverId: idle, playerId: p!.id, lifeNumber: 1, startedAt: hoursAgo(90), endedAt: hoursAgo(80), playtimeSeconds: 36000 });
  await db.insert(lives).values({ serverId: idle, playerId: p!.id, lifeNumber: 2, startedAt: hoursAgo(70), endedAt: hoursAgo(60), playtimeSeconds: 36000 });
  await db.insert(user).values({ id: uid, name: "x", email: `${uid}@example.com` });
  await db.insert(gamertagLinks).values({ userId: uid, gamertag: "Legend", status: "verified", verifiedAt: hoursAgo(50) });
});
afterAll(async () => {
  await db.delete(kills).where(inArray(kills.serverId, [chern, sakh, idle]));
  await db.delete(sessions).where(inArray(sessions.serverId, [chern, sakh, idle]));
  await db.delete(bans).where(inArray(bans.serverId, [chern, sakh, idle]));
  await db.delete(lives).where(inArray(lives.serverId, [chern, sakh, idle]));
  await db.delete(gamertagLinks).where(eq(gamertagLinks.userId, uid));
  await db.delete(user).where(eq(user.id, uid));
  await db.delete(players).where(eq(players.gamertag, "Legend"));
  await db.delete(servers).where(inArray(servers.id, [chern, sakh, idle]));
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
    expect(pg.totals.lives).toBe(4);
    expect(pg.totals.deaths).toBe(3);
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
    expect(pg.pastLives.length).toBe(3);
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
  it("gives an idle standing the player's most recent life to link to", async () => {
    const pg = (await getPlayerPage(db, "Legend", now))!;
    const card = pg.standing.find((s) => s.serverId === idle)!;
    expect(card.state).toBe("idle");
    // `livesRows` is ordered newest-first, which is why the read model names `livesRows[0]`
    // `recent`. This pins that ordering: if it ever flips, the UI would silently link every idle
    // card to the player's FIRST life instead of their last.
    expect(card.lastLifeNumber).toBe(2);
  });
  it("carries the open life's number on an alive standing", async () => {
    const pg = (await getPlayerPage(db, "Legend", now))!;
    expect(pg.standing.find((s) => s.serverId === chern)!.lastLifeNumber).toBe(2);
  });
  it("carries the triggering life's number on a banned standing", async () => {
    const pg = (await getPlayerPage(db, "Legend", now))!;
    expect(pg.standing.find((s) => s.serverId === sakh)!.lastLifeNumber).toBe(1);
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

describe("getPlayerPage banned card with unidentified triggering life", () => {
  const svcU = Math.floor(Math.random() * 1e8) + 54e7;
  let unmatchedServer: number;
  beforeAll(async () => {
    const [s] = await db.insert(servers).values({ nitradoServiceId: svcU, name: "pp-unmatched", map: "chernarusplus", slug: `unmatched-${svcU}`, active: true }).returning();
    unmatchedServer = s!.id;
    const [pl] = await db.insert(players).values({ gamertag: "Ghost", firstSeenAt: hoursAgo(200), lastSeenAt: now }).returning();
    // One ended life on this server so the card isn't skipped entirely (livesRows.length !== 0),
    // but its startedAt does NOT match the ban's lifeStartedAt below — this is the case where
    // `trig` resolves null. Per the project owner's decision: an unidentified triggering life
    // must render NO link, never fall back to the player's most recent life.
    await db
      .insert(lives)
      .values({ serverId: unmatchedServer, playerId: pl!.id, lifeNumber: 1, startedAt: hoursAgo(40), endedAt: hoursAgo(20), playtimeSeconds: 600, deathCause: "pvp" });
    await db.insert(bans).values({ serverId: unmatchedServer, gamertag: "Ghost", lifeStartedAt: hoursAgo(999), reason: "qualified_death", qualifiedBy: "pvp-death", bannedAt: hoursAgo(20), expiresAt: hoursAgo(-4), status: "pending", dryRun: false });
  });
  afterAll(async () => {
    await db.delete(bans).where(eq(bans.serverId, unmatchedServer));
    await db.delete(lives).where(eq(lives.serverId, unmatchedServer));
    await db.delete(players).where(eq(players.gamertag, "Ghost"));
    await db.delete(servers).where(eq(servers.id, unmatchedServer));
  });

  it("is banned with lastLifeNumber null, not the most recent life", async () => {
    const pg = (await getPlayerPage(db, "Ghost", now))!;
    const card = pg.standing.find((s) => s.serverId === unmatchedServer)!;
    expect(card).toBeDefined();
    expect(card.state).toBe("banned");
    expect(card.ban!.triggeringLifeNumber).toBeNull();
    expect(card.lastLifeNumber).toBeNull();
  });
});

describe("getPlayerPage: active ban outranks a newer open qualified life (respawn race)", () => {
  const svcRace = Math.floor(Math.random() * 1e8) + 55e7;
  let raceServer: number;
  beforeAll(async () => {
    const [s] = await db.insert(servers).values({ nitradoServiceId: svcRace, name: "pp-race", map: "chernarusplus", slug: `race-${svcRace}`, active: true }).returning();
    raceServer = s!.id;
    const [pl] = await db.insert(players).values({ gamertag: "Racer", firstSeenAt: hoursAgo(200), lastSeenAt: now }).returning();
    // Life #1: qualified PvP death that triggered a REAL ban.
    const [dead] = await db
      .insert(lives)
      .values({ serverId: raceServer, playerId: pl!.id, lifeNumber: 1, startedAt: hoursAgo(30), endedAt: hoursAgo(2), playtimeSeconds: 14520, deathCause: "pvp" })
      .returning();
    await db.insert(bans).values({ serverId: raceServer, gamertag: "Racer", lifeStartedAt: dead!.startedAt, reason: "qualified_death", qualifiedBy: "pvp-death", bannedAt: hoursAgo(2), expiresAt: hoursAgo(-22), status: "applied", dryRun: false });
    // Life #2: respawned before the ban landed and played past qualification — an OPEN qualified
    // life (open session an hour long ⇒ livePlaytime ≥ 300s ⇒ profile.alive true).
    const [open] = await db
      .insert(lives)
      .values({ serverId: raceServer, playerId: pl!.id, lifeNumber: 2, startedAt: hoursAgo(1), endedAt: null, playtimeSeconds: 0 })
      .returning();
    await db.insert(sessions).values({ serverId: raceServer, playerId: pl!.id, lifeId: open!.id, connectedAt: hoursAgo(1) });
  });
  afterAll(async () => {
    await db.delete(sessions).where(eq(sessions.serverId, raceServer));
    await db.delete(bans).where(eq(bans.serverId, raceServer));
    await db.delete(lives).where(eq(lives.serverId, raceServer));
    await db.delete(players).where(eq(players.gamertag, "Racer"));
    await db.delete(servers).where(eq(servers.id, raceServer));
  });

  it("renders the server as banned so the self-unban control is reachable", async () => {
    const pg = (await getPlayerPage(db, "Racer", now))!;
    const card = pg.standing.find((s) => s.serverId === raceServer)!;
    expect(card).toBeDefined();
    expect(card.state).toBe("banned");
    expect(card.ban).not.toBeNull();
    expect(card.ban!.triggeringLifeNumber).toBe(1);
    // The banned branch must not also carry the alive payload.
    expect(card.alive).toBeNull();
    // The hidden open life must not leak back as an "alive anywhere" signal (the hero's
    // `Alive ×N` badge derives from this) — a banned player is not counted as alive.
    expect(pg.aliveAnywhere).toBe(false);
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

// ── alive.qualified ────────────────────────────────────────────────────────────────────────────
// THE GAP THIS CLOSES: `getPlayerLives` and `getPlayerProfile` both filter through
// `isLifeQualified`, so before this change an open life inside the five-minute grace period was
// INVISIBLE to the standing — the player's own home rendered that server as "idle" ("Spawn in any
// time. First 5 minutes are free.") while they were standing on it. An omission, not a false
// statement, but "idle" is still a positive claim that they have no life there.
describe("getPlayerPage: a provisional (unqualified) open life is visible but marked", () => {
  const svcQ = Math.floor(Math.random() * 1e8) + 61e7;
  let srv: number; let pid: number;
  const t = new Date("2026-07-14T12:00:00Z");
  const bornAt = new Date(t.getTime() - 120_000); // 2 minutes ago — inside the 300s grace window

  beforeAll(async () => {
    const [s] = await db.insert(servers).values({ nitradoServiceId: svcQ, name: "q-srv", map: "sakhal", slug: `q-${svcQ}`, active: true }).returning();
    srv = s!.id;
    const [p] = await db.insert(players).values({ gamertag: `Fresh${svcQ}`, firstSeenAt: bornAt, lastSeenAt: t }).returning();
    pid = p!.id;
    const [l] = await db.insert(lives).values({ serverId: srv, playerId: pid, lifeNumber: 1, startedAt: bornAt, endedAt: null, playtimeSeconds: 0 }).returning();
    await db.insert(sessions).values({ serverId: srv, playerId: pid, lifeId: l!.id, connectedAt: bornAt });
  });
  afterAll(async () => {
    await db.delete(kills).where(eq(kills.serverId, srv));
    await db.delete(sessions).where(eq(sessions.serverId, srv));
    await db.delete(lives).where(eq(lives.serverId, srv));
    await db.delete(players).where(eq(players.id, pid));
    await db.delete(servers).where(eq(servers.id, srv));
  });

  it("shows the server as ALIVE, not idle, during the grace window", async () => {
    const pg = await getPlayerPage(db, `Fresh${svcQ}`, t);
    const card = pg!.standing.find((s) => s.slug === `q-${svcQ}`)!;
    expect(card.state).toBe("alive");
  });

  it("marks that life as not yet qualified", async () => {
    const pg = await getPlayerPage(db, `Fresh${svcQ}`, t);
    const card = pg!.standing.find((s) => s.slug === `q-${svcQ}`)!;
    expect(card.alive!.qualified).toBe(false);
    expect(card.alive!.qualifiedAt).toBeNull();
  });

  it("still counts the provisional life in NEITHER totals nor aliveAnywhere", async () => {
    // `aliveAnywhere` feeds the public dossier's `Alive xN` badge and is leaderboard-facing; a
    // grace-period player is not yet part of that count. `totals` come from the qualified-lives
    // filter, which this change deliberately does not loosen.
    const pg = await getPlayerPage(db, `Fresh${svcQ}`, t);
    expect(pg!.aliveAnywhere).toBe(false);
    expect(pg!.totals.lives).toBe(0);
    expect(pg!.totals.deaths).toBe(0);
  });

  it("reports a live time-alive for the provisional life (profile.currentLifeSeconds is 0 here)", async () => {
    const pg = await getPlayerPage(db, `Fresh${svcQ}`, t);
    const card = pg!.standing.find((s) => s.slug === `q-${svcQ}`)!;
    expect(card.alive!.timeAliveSeconds).toBeGreaterThanOrEqual(115);
    expect(card.alive!.timeAliveSeconds).toBeLessThanOrEqual(125);
  });

  it("flips to qualified once the life crosses the playtime threshold", async () => {
    const later = new Date(bornAt.getTime() + 400_000); // > QUALIFY_SECONDS
    await db.update(players).set({ lastSeenAt: later }).where(eq(players.id, pid));
    const pg = await getPlayerPage(db, `Fresh${svcQ}`, later);
    const card = pg!.standing.find((s) => s.slug === `q-${svcQ}`)!;
    expect(card.alive!.qualified).toBe(true);
    expect(card.alive!.qualifiedAt).not.toBeNull();
    expect(pg!.aliveAnywhere).toBe(true);
    await db.update(players).set({ lastSeenAt: t }).where(eq(players.id, pid));
  });

  it("a kill qualifies the life immediately, before the time threshold", async () => {
    // `lifeQualifiedAt` is `pvp OR playtime>=300 OR a kill in the window`, so a punch at 0h 0m
    // qualifies. A UI countdown that assumed time alone would be wrong here.
    await db.insert(kills).values({ serverId: srv, killerGamertag: `Fresh${svcQ}`, killerPlayerId: pid, victimGamertag: "SomeVictim", occurredAt: new Date(bornAt.getTime() + 30_000) });
    const pg = await getPlayerPage(db, `Fresh${svcQ}`, t);
    const card = pg!.standing.find((s) => s.slug === `q-${svcQ}`)!;
    expect(card.alive!.qualified).toBe(true);
    expect(card.alive!.qualifiedAt!.by).toBe("kill");
  });
});

// ── avatarHash ─────────────────────────────────────────────────────────────────────────────────
// The dossier's avatar — the board's exact clause pair (avatar-account-pass spec §5): only a
// VERIFIED link with a LIVE (non-tombstoned) avatar contributes; a pending link or a removed
// avatar resolves to null exactly like no row at all.
describe("getPlayerPage: avatarHash", () => {
  const svcAv = Math.floor(Math.random() * 1e8) + 62e7;
  let avServer: number;
  const gamertagWithAvatar = `AvatarLive${svcAv}`;
  const gamertagPendingLink = `AvatarPending${svcAv}`;
  const gamertagTombstone = `AvatarTombstone${svcAv}`;
  const userLive = `pp-av-live-${svcAv}`;
  const userPending = `pp-av-pending-${svcAv}`;
  const userTombstone = `pp-av-tombstone-${svcAv}`;

  async function insertAvatarLink(opts: {
    gamertag: string;
    userId: string;
    status: "pending" | "verified";
    hash: string | null;
    imageNull?: boolean;
  }) {
    await db.insert(user).values({ id: opts.userId, name: opts.userId, email: `${opts.userId}@example.com` });
    await db.insert(gamertagLinks).values({
      userId: opts.userId,
      gamertag: opts.gamertag,
      status: opts.status,
      verifiedAt: opts.status === "verified" ? now : null,
    });
    await db.insert(avatars).values({
      userId: opts.userId,
      image: opts.imageNull ? null : Buffer.from("fake-avatar-bytes"),
      hash: opts.hash,
      source: opts.imageNull ? null : "upload",
      updatedAt: now,
    });
  }

  beforeAll(async () => {
    const [s] = await db.insert(servers).values({ nitradoServiceId: svcAv, name: "pp-avatar", map: "chernarusplus", slug: `avatar-${svcAv}`, active: true }).returning();
    avServer = s!.id;

    const [pLive] = await db.insert(players).values({ gamertag: gamertagWithAvatar, firstSeenAt: hoursAgo(10), lastSeenAt: now }).returning();
    await db.insert(lives).values({ serverId: avServer, playerId: pLive!.id, lifeNumber: 1, startedAt: hoursAgo(10), endedAt: hoursAgo(9), playtimeSeconds: 600 });
    await insertAvatarLink({ gamertag: gamertagWithAvatar, userId: userLive, status: "verified", hash: "abc123" });

    const [pPending] = await db.insert(players).values({ gamertag: gamertagPendingLink, firstSeenAt: hoursAgo(10), lastSeenAt: now }).returning();
    await db.insert(lives).values({ serverId: avServer, playerId: pPending!.id, lifeNumber: 1, startedAt: hoursAgo(10), endedAt: hoursAgo(9), playtimeSeconds: 600 });
    await insertAvatarLink({ gamertag: gamertagPendingLink, userId: userPending, status: "pending", hash: "pend456" });

    const [pTomb] = await db.insert(players).values({ gamertag: gamertagTombstone, firstSeenAt: hoursAgo(10), lastSeenAt: now }).returning();
    await db.insert(lives).values({ serverId: avServer, playerId: pTomb!.id, lifeNumber: 1, startedAt: hoursAgo(10), endedAt: hoursAgo(9), playtimeSeconds: 600 });
    await insertAvatarLink({ gamertag: gamertagTombstone, userId: userTombstone, status: "verified", hash: "dead99", imageNull: true });
  });

  afterAll(async () => {
    await db.delete(lives).where(eq(lives.serverId, avServer));
    await db.delete(avatars).where(inArray(avatars.userId, [userLive, userPending, userTombstone]));
    await db.delete(gamertagLinks).where(inArray(gamertagLinks.userId, [userLive, userPending, userTombstone]));
    await db.delete(user).where(inArray(user.id, [userLive, userPending, userTombstone]));
    await db.delete(players).where(inArray(players.gamertag, [gamertagWithAvatar, gamertagPendingLink, gamertagTombstone]));
    await db.delete(servers).where(eq(servers.id, avServer));
  });

  it("carries the verified owner's live avatar hash", async () => {
    const page = await getPlayerPage(db, gamertagWithAvatar, now);
    expect(page?.avatarHash).toBe("abc123");
  });

  it("a PENDING link contributes no hash", async () => {
    const page = await getPlayerPage(db, gamertagPendingLink, now);
    expect(page?.avatarHash).toBeNull();
  });

  it("a TOMBSTONED avatar (image NULL) contributes no hash", async () => {
    const page = await getPlayerPage(db, gamertagTombstone, now);
    expect(page?.avatarHash).toBeNull();
  });

  // Two DIFFERENT users can each hold a verified link matching `identityNames` (the page's
  // current gamertag plus its alias history): the current owner, and a former-name holder whose
  // stale verified link was never released. The current gamertag's link must win deterministically.
  it("prefers the CURRENT gamertag's verified link over a stale alias link", async () => {
    const gamertagCurrent = `AvatarCurrent${svcAv}`;
    const gamertagOldAlias = `AvatarOldAlias${svcAv}`;
    const userCurrent = `pp-av-current-${svcAv}`;
    const userAlias = `pp-av-alias-${svcAv}`;

    const [pRenamed] = await db.insert(players).values({ gamertag: gamertagCurrent, firstSeenAt: hoursAgo(10), lastSeenAt: now }).returning();
    await db.insert(lives).values({ serverId: avServer, playerId: pRenamed!.id, lifeNumber: 1, startedAt: hoursAgo(10), endedAt: hoursAgo(9), playtimeSeconds: 600 });
    await db.insert(playerGamertags).values({ playerId: pRenamed!.id, gamertag: gamertagOldAlias, firstSeenAt: hoursAgo(10), lastSeenAt: hoursAgo(9) });

    await insertAvatarLink({ gamertag: gamertagCurrent, userId: userCurrent, status: "verified", hash: "hashA" });
    await insertAvatarLink({ gamertag: gamertagOldAlias, userId: userAlias, status: "verified", hash: "hashB" });

    try {
      const page = await getPlayerPage(db, gamertagCurrent, now);
      expect(page?.avatarHash).toBe("hashA");
    } finally {
      await db.delete(lives).where(eq(lives.playerId, pRenamed!.id));
      await db.delete(avatars).where(inArray(avatars.userId, [userCurrent, userAlias]));
      await db.delete(gamertagLinks).where(inArray(gamertagLinks.userId, [userCurrent, userAlias]));
      await db.delete(user).where(inArray(user.id, [userCurrent, userAlias]));
      await db.delete(playerGamertags).where(eq(playerGamertags.playerId, pRenamed!.id));
      await db.delete(players).where(eq(players.id, pRenamed!.id));
    }
  });
});
