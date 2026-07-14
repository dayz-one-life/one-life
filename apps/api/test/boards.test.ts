import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, players, kills } from "@onelife/db";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 15e7;
let serverId: number;
const app = buildApp(db);

beforeAll(async () => {
  await app.ready();
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "api-boards" }).returning();
  serverId = s!.id;
  const [k] = await db.insert(players).values({ serverId, gamertag: "Killer", firstSeenAt: new Date(), lastSeenAt: new Date() }).returning();
  await db.insert(kills).values({ serverId, killerGamertag: "Killer", killerPlayerId: k!.id, victimGamertag: "V", victimPlayerId: null, victimLifeId: null, weapon: "M4A1", distance: 100, occurredAt: new Date("2026-07-06T12:30:00Z") });
});
afterAll(async () => {
  await db.delete(kills).where(eq(kills.serverId, serverId));
  await db.delete(players).where(eq(players.serverId, serverId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await app.close(); await sql.end();
});

describe("board + feed routes", () => {
  it("most-kills board", async () => {
    const res = await app.inject({ method: "GET", url: `/servers/${serverId}/leaderboards/most-kills` });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0]).toMatchObject({ gamertag: "Killer", value: 1 });
  });
  it("400 for an unknown board name", async () => {
    const res = await app.inject({ method: "GET", url: `/servers/${serverId}/leaderboards/bogus` });
    expect(res.statusCode).toBe(400);
  });
  it("kill feed", async () => {
    const res = await app.inject({ method: "GET", url: `/servers/${serverId}/kills` });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBe(1);
  });
  it("build feed (empty ok)", async () => {
    const res = await app.inject({ method: "GET", url: `/servers/${serverId}/builds` });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});
