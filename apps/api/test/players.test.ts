import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servers, players, lives, gamertagLinks, user } from "@onelife/db";
import { eq, inArray } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { getTestDb } from "@onelife/test-support";

const { db, sql } = getTestDb();
const svc = Math.floor(Math.random() * 1e8) + 14e7;
const userId = `api-players-${svc}`;
let serverId: number; let lifeId: number;
const app = buildApp(db);

beforeAll(async () => {
  await app.ready();
  const [s] = await db.insert(servers).values({ nitradoServiceId: svc, name: "api-players" }).returning();
  serverId = s!.id;
  const [p] = await db.insert(players).values({ gamertag: "Hero", firstSeenAt: new Date(), lastSeenAt: new Date() }).returning();
  const [l] = await db.insert(lives).values({ serverId, playerId: p!.id, lifeNumber: 1, startedAt: new Date("2026-07-06T12:00:00Z"), endedAt: new Date("2026-07-06T12:30:00Z"), playtimeSeconds: 1800, deathCause: "pvp", deathByGamertag: "Villain" }).returning();
  lifeId = l!.id;
  await db.insert(user).values({ id: userId, name: "x", email: `${userId}@example.com` });
  await db.insert(players).values([
    { gamertag: "Alpha", firstSeenAt: new Date(), lastSeenAt: new Date() },
    { gamertag: "Alalpha", firstSeenAt: new Date(), lastSeenAt: new Date() },
  ]);
  await db.insert(gamertagLinks).values({ userId, gamertag: "Alpha", status: "verified", verifiedAt: new Date() });
});
afterAll(async () => {
  await db.delete(lives).where(eq(lives.serverId, serverId));
  await db.delete(gamertagLinks).where(eq(gamertagLinks.userId, userId));
  await db.delete(players).where(inArray(players.gamertag, ["Hero", "Alpha", "Alalpha"]));
  await db.delete(user).where(eq(user.id, userId));
  await db.delete(servers).where(eq(servers.id, serverId));
  await app.close(); await sql.end();
});

describe("player + life routes", () => {
  it("returns a profile", async () => {
    const res = await app.inject({ method: "GET", url: `/servers/${serverId}/players/Hero` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ gamertag: "Hero", lives: 1, deaths: 1, alive: false });
  });
  it("404 for unknown player", async () => {
    const res = await app.inject({ method: "GET", url: `/servers/${serverId}/players/Nobody` });
    expect(res.statusCode).toBe(404);
  });
  it("400 for a non-numeric serverId", async () => {
    const res = await app.inject({ method: "GET", url: `/servers/abc/players/Hero` });
    expect(res.statusCode).toBe(400);
  });
  it("returns life history", async () => {
    const res = await app.inject({ method: "GET", url: `/servers/${serverId}/players/Hero/lives` });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBe(1);
  });
  it("returns a single life detail", async () => {
    const res = await app.inject({ method: "GET", url: `/servers/${serverId}/lives/${lifeId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().life).toMatchObject({ deathCause: "pvp" });
  });
  it("returns claimable gamertags matching a prefix, excluding verified ones", async () => {
    const res = await app.inject({ method: "GET", url: "/players/search?q=Al" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(["Alalpha"]);
  });
  it("returns an empty array below the min query length", async () => {
    const res = await app.inject({ method: "GET", url: "/players/search?q=A" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
