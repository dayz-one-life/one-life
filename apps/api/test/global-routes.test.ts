import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, players, lives, sessions, kills } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svcChern = Math.floor(Math.random() * 1e8) + 18e7;
const svcSakh = Math.floor(Math.random() * 1e8) + 19e7;
let chernId: number;
let sakhId: number;
const app = buildApp(db);

beforeAll(async () => {
  await app.ready();
  const [c] = await db.insert(servers).values({ nitradoServiceId: svcChern, name: "api-global-chernarus", map: "chernarusplus", slug: "gr-chern", active: true }).returning();
  const [s] = await db.insert(servers).values({ nitradoServiceId: svcSakh, name: "api-global-sakhal", map: "sakhal", slug: "gr-sakh", active: true }).returning();
  chernId = c!.id;
  sakhId = s!.id;

  const [roamer] = await db.insert(players).values({ gamertag: "RoamerR", firstSeenAt: new Date(), lastSeenAt: new Date() }).returning();
  const [roamerLife] = await db.insert(lives).values({ serverId: chernId, playerId: roamer!.id, lifeNumber: 1, startedAt: new Date("2026-07-06T12:00:00Z"), playtimeSeconds: 300 }).returning();
  await db.insert(sessions).values({ serverId: chernId, playerId: roamer!.id, lifeId: roamerLife!.id, connectedAt: new Date("2026-07-06T12:00:00Z") });

  const [killer] = await db.insert(players).values({ gamertag: "KillerR", firstSeenAt: new Date(), lastSeenAt: new Date() }).returning();
  await db.insert(kills).values({ serverId: sakhId, killerGamertag: "KillerR", killerPlayerId: killer!.id, victimGamertag: "V", victimPlayerId: null, victimLifeId: null, weapon: "M4A1", occurredAt: new Date("2026-07-06T12:30:00Z") });
});

afterAll(async () => {
  await db.delete(kills).where(eq(kills.serverId, sakhId));
  await db.delete(sessions).where(eq(sessions.serverId, chernId));
  await db.delete(lives).where(eq(lives.serverId, chernId));
  await db.delete(players).where(inArray(players.gamertag, ["RoamerR", "KillerR"]));
  await app.close(); await sql.end();
});

describe("GET /roster (global)", () => {
  it("returns 200 with an array merged across maps", async () => {
    const res = await app.inject({ method: "GET", url: "/roster" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.find((r: any) => r.gamertag === "RoamerR")).toMatchObject({ map: "chernarusplus", slug: "gr-chern" });
  });
});

describe("GET /leaderboards/:board (global)", () => {
  it("most-kills returns 200 with an array", async () => {
    const res = await app.inject({ method: "GET", url: "/leaderboards/most-kills" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.find((r: any) => r.gamertag === "KillerR")).toMatchObject({ value: 1, map: "sakhal", slug: "gr-sakh" });
  });
  it("unknown board name -> 400", async () => {
    const res = await app.inject({ method: "GET", url: "/leaderboards/bogus" });
    expect(res.statusCode).toBe(400);
  });
});
