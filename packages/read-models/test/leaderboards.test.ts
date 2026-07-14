import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, players, lives, kills, sessions } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getLeaderboard, getKillFeed } from "../src/index.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 12e7;
let serverId: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "lb-test" }).returning();
  serverId = s!.id;
  const mk = async (g: string) => (await db.insert(players).values({ serverId, gamertag: g, firstSeenAt: new Date(), lastSeenAt: new Date() }).returning())[0]!;
  const killer = await mk("Killer");
  const victim = await mk("Victim");
  const [kl] = await db.insert(lives).values({ serverId, playerId: killer.id, lifeNumber: 1, startedAt: new Date("2026-07-06T12:00:00Z"), playtimeSeconds: 3600 }).returning();
  const [vl] = await db.insert(lives).values({ serverId, playerId: victim.id, lifeNumber: 1, startedAt: new Date("2026-07-06T12:00:00Z"), endedAt: new Date("2026-07-06T12:30:00Z"), playtimeSeconds: 1800, deathCause: "pvp", deathByGamertag: "Killer" }).returning();
  await db.insert(kills).values({ serverId, killerGamertag: "Killer", killerPlayerId: killer.id, victimGamertag: "Victim", victimPlayerId: victim.id, victimLifeId: vl!.id, weapon: "M4A1", distance: 153.4, occurredAt: new Date("2026-07-06T12:30:00Z") });
  await db.insert(sessions).values({ serverId, playerId: killer.id, lifeId: kl!.id, connectedAt: new Date("2026-07-06T12:00:00Z") });
});
afterAll(async () => {
  await db.delete(kills).where(eq(kills.serverId, serverId));
  await db.delete(sessions).where(eq(sessions.serverId, serverId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(players).where(eq(players.serverId, serverId));
  await sql.end();
});

describe("leaderboards", () => {
  const now = new Date("2026-07-06T13:00:00Z");
  it("most-kills counts kills per killer", async () => {
    const rows = await getLeaderboard(db, serverId, "most-kills", now, 10);
    expect(rows[0]).toMatchObject({ gamertag: "Killer", value: 1 });
  });
  it("longest-kills ranks by distance", async () => {
    const rows = await getLeaderboard(db, serverId, "longest-kills", now, 10);
    expect(rows[0]).toMatchObject({ gamertag: "Killer", value: 153.4 });
  });
  it("alive-longest ranks open lives by live playtime", async () => {
    const rows = await getLeaderboard(db, serverId, "alive-longest", now, 10);
    expect(rows[0]!.gamertag).toBe("Killer");
  });
  it("longest-killstreak counts kills within the killer's life window", async () => {
    const rows = await getLeaderboard(db, serverId, "longest-killstreak", now, 10);
    expect(rows[0]).toMatchObject({ gamertag: "Killer", value: 1 });
  });
  it("alltime-longest ranks by max life playtime per player", async () => {
    const rows = await getLeaderboard(db, serverId, "alltime-longest", now, 10);
    expect(rows[0]).toMatchObject({ gamertag: "Killer", value: 3600 });
  });
  it("kill feed returns recent kills", async () => {
    const feed = await getKillFeed(db, serverId, 10, 0);
    expect(feed.length).toBe(1);
    expect(feed[0]).toMatchObject({ killerGamertag: "Killer", victimGamertag: "Victim" });
  });
});
