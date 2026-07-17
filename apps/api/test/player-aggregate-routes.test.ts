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
  it("carries pagination fields and accepts ?page=", async () => {
    const res = await app.inject({ method: "GET", url: `/players/Twhizzle4life?page=2` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("pastLivesTotal");
    expect(body).toHaveProperty("pastLivesPage");
    expect(body).toHaveProperty("pastLivesPageSize");
    expect(body).not.toHaveProperty("heroCharacter");
  });
});

describe("GET /players/:gamertag/:map/lives/:n", () => {
  beforeAll(async () => {
    // A Livonia (enoch) server — its slug must resolve, not be rejected by a hardcoded map allow-list.
    const [liv] = await db.insert(servers).values({ nitradoServiceId: 302, name: "Livonia", map: "enoch", slug: "pa-livonia" }).returning();
    const [p] = await db.insert(players).values({ gamertag: "LivoniaLad" }).returning();
    await db.insert(lives).values({ serverId: liv!.id, playerId: p!.id, lifeNumber: 1, startedAt: new Date("2026-07-10T12:00:00Z"), playtimeSeconds: 600 });
  });
  it("resolves a life on a server whose slug is outside the original chernarus/sakhal set", async () => {
    const res = await app.inject({ method: "GET", url: "/players/LivoniaLad/pa-livonia/lives/1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().life.lifeNumber).toBe(1);
  });
  it("unknown server slug → 404, not a validation 400", async () => {
    const res = await app.inject({ method: "GET", url: "/players/LivoniaLad/no-such-map/lives/1" });
    expect(res.statusCode).toBe(404);
  });

  it("GET /players/:gamertag/:map/lives/:n returns timeline data with display fields", async () => {
    // uses this file's existing seeded gamertag/slug/life (LivoniaLad / pa-livonia / life 1)
    const res = await app.inject({ method: "GET", url: "/players/LivoniaLad/pa-livonia/lives/1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.gamertag).toBe("LivoniaLad");
    expect(body.map).toBeTruthy();
    expect(Array.isArray(body.kills)).toBe(true);
    expect(body).toHaveProperty("qualifiedAt");
    expect(Array.isArray(body.sessions)).toBe(true);
  });
});
