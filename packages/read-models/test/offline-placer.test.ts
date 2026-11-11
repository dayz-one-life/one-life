import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { servers, players, lives, sessions, kills } from "@onelife/db";
import { getTestDb } from "@onelife/test-support";
import { getPlayerProfile, getPlayerLives } from "../src/queries.js";
import { getAliveSurvivors } from "../src/survivors.js";
import { getLeaderboard } from "../src/leaderboards.js";
import { lifeQualifiedAt } from "../src/qualified.js";
import { qualifiedLifeCondition } from "../src/qualified-lives.js";

/**
 * Death-verdict spec 2.4, "Open lives and offline placers": a trap fires while the player who set
 * it is offline, hours after their last heartbeat. The kill must still qualify their open life
 * everywhere that decides it. ⚠️ Invented player and server.
 *
 * An open life of 180 s (one closed session), last seen at three minutes, and a kill 19 hours later.
 */
const { db, sql } = getTestDb();
const START = new Date("2026-08-01T10:00:00Z");
const LAST_SEEN = new Date(START.getTime() + 180_000);
const KILL_AT = new Date(START.getTime() + 19 * 3600_000);
const NOW = new Date(START.getTime() + 20 * 3600_000);
const NAME = "Placer Eight";
const SLUG = `offline-${Math.floor(Math.random() * 1e8)}`;
let sid: number, pid: number, lid: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: Math.floor(Math.random() * 1e8) + 7e8, name: "Offline", map: "chernarusplus", slug: SLUG }).returning();
  sid = s!.id;
  const [p] = await db.insert(players).values({ gamertag: NAME, dayzId: "8".repeat(40), firstSeenAt: START, lastSeenAt: LAST_SEEN }).returning();
  pid = Number(p!.id);
  const [l] = await db.insert(lives).values({ serverId: sid, playerId: pid, lifeNumber: 1, startedAt: START, endedAt: null, playtimeSeconds: 180 }).returning();
  lid = Number(l!.id);
  await db.insert(sessions).values({ serverId: sid, playerId: pid, lifeId: lid, connectedAt: START, disconnectedAt: LAST_SEEN, durationSeconds: 180, closeReason: "disconnect" });
});
afterEach(async () => { await db.delete(kills).where(eq(kills.serverId, sid)); });
afterAll(async () => {
  await db.delete(sessions).where(eq(sessions.serverId, sid));
  await db.delete(lives).where(eq(lives.serverId, sid));
  await db.delete(players).where(eq(players.id, pid));
  await db.delete(servers).where(eq(servers.id, sid));
  await sql.end();
});

async function kill(basis: "kill_line" | "trap_placement") {
  await db.insert(kills).values({
    serverId: sid, killerGamertag: NAME, killerPlayerId: pid, victimGamertag: "Victim Nine", victimLifeId: 990000 + lid,
    weapon: basis === "trap_placement" ? "Tripwire" : "M4-A1", occurredAt: KILL_AT,
    basis, creditSource: basis === "trap_placement" ? "classifier" : null,
  });
}

describe.each(["kill_line", "trap_placement"] as const)("a %s kill 19 hours after the last heartbeat", (basis) => {
  it("qualifies the open life on the profile and the lives list", async () => {
    await kill(basis);
    const prof = (await getPlayerProfile(db, sid, NAME, NOW))!;
    expect(prof).toMatchObject({ lives: 1, alive: true });
    // the playtime still stops at the heartbeat
    expect(prof.currentLifeSeconds).toBe(180);
    expect((await getPlayerLives(db, sid, NAME))!.map((l) => l.id)).toEqual([lid]);
  });

  it("puts the life on the survivors board and alive-longest", async () => {
    await kill(basis);
    const page = await getAliveSurvivors(db, { slug: SLUG, page: 1 }, NOW);
    expect(page.rows.map((r) => r.gamertag)).toContain(NAME);
    const board = await getLeaderboard(db, sid, "alive-longest", NOW, 10);
    expect(board.map((r) => r.gamertag)).toContain(NAME);
  });

  it("lifeQualifiedAt and qualifiedLifeCondition agree", async () => {
    await kill(basis);
    expect(lifeQualifiedAt({
      startedAt: START, endedAt: null, deathCause: null, lastSeenAt: LAST_SEEN,
      sessions: [{ connectedAt: START, disconnectedAt: LAST_SEEN, durationSeconds: 180 }], playerKills: [{ occurredAt: KILL_AT, basis }],
    })).toEqual({ at: KILL_AT, by: "kill", killBasis: basis });
    const rows = await db.select({ id: lives.id }).from(lives).innerJoin(players, eq(players.id, lives.playerId))
      .where(and(inArray(lives.id, [lid]), qualifiedLifeCondition(db)));
    expect(rows.map((r) => Number(r.id))).toEqual([lid]);
  });
});

describe("with no kill", () => {
  it("the 180-second open life does not count anywhere", async () => {
    expect((await getPlayerProfile(db, sid, NAME, NOW))!.lives).toBe(0);
    expect(await getPlayerLives(db, sid, NAME)).toEqual([]);
    expect((await getAliveSurvivors(db, { slug: SLUG, page: 1 }, NOW)).rows.map((r) => r.gamertag)).not.toContain(NAME);
  });
});
