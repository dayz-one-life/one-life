import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, players, lives, sessions } from "@onelife/db";
import { eq } from "drizzle-orm";
import { getRoster, getPlayerProfile, getPlayerLives, getLifeDetail } from "../src/index.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 11e7;
let serverId: number;

beforeAll(async () => {
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "rm-test" }).returning();
  serverId = s!.id;
  const [p] = await db.insert(players).values({ gamertag: "A", firstSeenAt: new Date("2026-07-06T12:00:00Z"), lastSeenAt: new Date("2026-07-06T12:30:00Z") }).returning();
  const [l] = await db.insert(lives).values({ serverId, playerId: p!.id, lifeNumber: 1, startedAt: new Date("2026-07-06T12:00:00Z"), playtimeSeconds: 600 }).returning();
  await db.insert(sessions).values({ serverId, playerId: p!.id, lifeId: l!.id, connectedAt: new Date("2026-07-06T12:20:00Z") }); // open
});
afterAll(async () => {
  await db.delete(sessions).where(eq(sessions.serverId, serverId));
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(players).where(eq(players.gamertag, "A"));
  await sql.end();
});

describe("read-model queries", () => {
  it("roster lists the online player with live session + life seconds", async () => {
    const now = new Date("2026-07-06T12:30:00Z");
    const roster = await getRoster(db, serverId, now);
    const me = roster.find((r) => r.gamertag === "A");
    expect(me).toBeTruthy();
    expect(me!.sessionSeconds).toBe(600);      // 12:20 → 12:30
    expect(me!.lifeSeconds).toBe(600 + 600);   // stored 600 + open 600
  });
  it("profile reports lives, alive flag, and current-life playtime", async () => {
    const now = new Date("2026-07-06T12:30:00Z");
    const prof = await getPlayerProfile(db, serverId, "A", now);
    expect(prof).toMatchObject({ gamertag: "A", lives: 1, deaths: 0, alive: true, totalPlaytimeSeconds: 1200 });
    expect(prof!.currentLifeSeconds).toBe(1200);
  });
  it("a retired server's open life reads as ended by retirement", async () => {
    const R = new Date("2026-07-06T12:25:00Z");
    await db.update(servers).set({ active: false, retiredAt: R }).where(eq(servers.id, serverId));
    try {
      const [l] = (await getPlayerLives(db, serverId, "A"))!;
      expect(l).toMatchObject({ endReason: "server_retired", playtimeSeconds: 600 + 300 });
      expect(l!.endedAt).toEqual(R);
      const d = await getLifeDetail(db, serverId, l!.id);
      expect(d!.life.endReason).toBe("server_retired");
      expect(d!.sessions.every((s) => s.disconnectedAt !== null)).toBe(true);
    } finally {
      await db.update(servers).set({ active: true, retiredAt: null }).where(eq(servers.id, serverId));
    }
  });
});
