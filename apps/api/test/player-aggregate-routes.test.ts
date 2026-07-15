import { describe, it, expect, beforeAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives } from "@onelife/db";
import { buildApp } from "../src/app.js";

const { db } = getTestDb();
const app = buildApp(db);

describe("GET /players/:gamertag", () => {
  beforeAll(async () => {
    const [c] = await db.insert(servers).values({ nitradoServiceId: 301, name: "Chernarus", map: "chernarusplus", slug: "pa-chernarus" }).returning();
    const [p] = await db.insert(players).values({ gamertag: "Twhizzle4life" }).returning();
    // getPlayerProfile only reports a per-server profile once the player has an actual
    // life on that server (players are global; presence in `players` alone isn't enough).
    await db.insert(lives).values({ serverId: c!.id, playerId: p!.id, lifeNumber: 1, startedAt: new Date("2026-07-06T12:00:00Z"), playtimeSeconds: 300 });
  });
  it("returns the cross-server aggregate", async () => {
    const res = await app.inject({ method: "GET", url: "/players/Twhizzle4life" });
    expect(res.statusCode).toBe(200);
    expect(res.json().gamertag).toBe("Twhizzle4life");
  });
  it("resolves a lowercase slug URL to the real stored casing", async () => {
    const res = await app.inject({ method: "GET", url: "/players/twhizzle4life" });
    expect(res.statusCode).toBe(200);
    expect(res.json().gamertag).toBe("Twhizzle4life");
  });
  it("unknown gamertag → 404", async () => {
    const res = await app.inject({ method: "GET", url: "/players/nobody-here" });
    expect(res.statusCode).toBe(404);
  });
  it("returns the full player page payload", async () => {
    const res = await app.inject({ method: "GET", url: "/players/Twhizzle4life" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("standing");
    expect(body).toHaveProperty("pastLives");
    expect(body).toHaveProperty("totals");
    expect(body.gamertag).toBe("Twhizzle4life");
  });
});
