import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { servers, players, lives, articles, sessions, kills } from "@onelife/db";
import { eq } from "drizzle-orm";
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
    // Deliberately given real nested structure (a session row + a kill row) and an `endedAt`
    // so the death/verdict branch of getLifeTimeline is populated too — otherwise the
    // "no coordinate data" scan below only ever visits a flat object and proves nothing about
    // arrays that could one day carry per-session/per-kill coordinates.
    const [life] = await db.insert(lives).values({
      serverId: liv!.id, playerId: p!.id, lifeNumber: 1,
      startedAt: new Date("2026-07-10T12:00:00Z"), endedAt: new Date("2026-07-10T13:00:00Z"),
      playtimeSeconds: 3600,
    }).returning();
    await db.insert(sessions).values({
      serverId: liv!.id, playerId: p!.id, lifeId: life!.id,
      connectedAt: new Date("2026-07-10T12:00:00Z"), disconnectedAt: new Date("2026-07-10T13:00:00Z"),
      durationSeconds: 3600, closeReason: "death",
    });
    await db.insert(kills).values({
      serverId: liv!.id, killerGamertag: "LivoniaLad", victimGamertag: "LivoniaLadVictim",
      weapon: "AKM", distance: 42, occurredAt: new Date("2026-07-10T12:30:00Z"),
    });
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

describe("GET /players/:gamertag/articles", () => {
  beforeAll(async () => {
    const [p] = await db.insert(players).values({ gamertag: "InkStainedWretch" }).returning();
    // Every published `kind: "obituary"` row is visible to the shared GET /obituaries feed too
    // (obituaries.test.ts), which asserts a non-null map/lifeNumber/deathAt on every row it reads
    // (assertSubjectful) — so these fixtures must be well-formed obituaries, not just minimal rows.
    await db.insert(articles).values([
      {
        kind: "obituary", status: "published", slug: "ink-stained-wretch-dies",
        gamertag: p!.gamertag, mapSlug: "pa-chernarus", map: "chernarusplus", lifeNumber: 1,
        headline: "Ink Stained Wretch Dies", lede: "L", deathAt: new Date("2026-07-10T12:00:00Z"),
        createdAt: new Date("2026-07-10T12:00:00Z"),
      },
      {
        kind: "obituary", status: "published", slug: "ink-stained-wretch-dies-again",
        gamertag: p!.gamertag, mapSlug: "pa-chernarus", map: "chernarusplus", lifeNumber: 2,
        headline: "Ink Stained Wretch Dies Again", lede: "L", deathAt: new Date("2026-07-11T12:00:00Z"),
        createdAt: new Date("2026-07-11T12:00:00Z"),
      },
      // Unpublished — must never appear.
      {
        kind: "obituary", status: "failed", slug: "ink-stained-wretch-draft",
        gamertag: p!.gamertag, mapSlug: "pa-chernarus", map: "chernarusplus", lifeNumber: 3,
        headline: "Draft", lede: "L", deathAt: new Date("2026-07-12T12:00:00Z"),
        createdAt: new Date("2026-07-12T12:00:00Z"),
      },
    ]);

    // Seed a multi-word gamertag to test slug normalization (spaces → dashes)
    const [p2] = await db.insert(players).values({ gamertag: "Dead Eye Jim" }).returning();
    await db.insert(articles).values([
      {
        kind: "obituary", status: "published", slug: "dead-eye-jim-perishes",
        gamertag: p2!.gamertag, mapSlug: "pa-chernarus", map: "chernarusplus", lifeNumber: 1,
        headline: "Dead Eye Jim Perishes", lede: "L", deathAt: new Date("2026-07-13T12:00:00Z"),
        createdAt: new Date("2026-07-13T12:00:00Z"),
      },
    ]);
  });
  afterAll(async () => {
    await db.delete(articles).where(eq(articles.gamertag, "InkStainedWretch"));
    await db.delete(players).where(eq(players.gamertag, "InkStainedWretch"));
    await db.delete(articles).where(eq(articles.gamertag, "Dead Eye Jim"));
    await db.delete(players).where(eq(players.gamertag, "Dead Eye Jim"));
  });

  it("returns a known player's published articles", async () => {
    const res = await app.inject({ method: "GET", url: "/players/InkStainedWretch/articles" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.rows).toHaveLength(2);
    expect(body.rows[0].slug).toBe("ink-stained-wretch-dies-again");
    expect(body.rows[0].role).toBe("subject");
  });

  it("resolves a lowercase slug URL to the real stored casing' gamertag", async () => {
    const res = await app.inject({ method: "GET", url: "/players/inkstainedwretch/articles" });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(2);
  });

  it("honours ?page=", async () => {
    const res = await app.inject({ method: "GET", url: "/players/InkStainedWretch/articles?page=1&pageSize=1" });
    expect(res.statusCode).toBe(200);
    // pageSize isn't a supported param per the brief — this just exercises page=1 explicitly.
    const res2 = await app.inject({ method: "GET", url: "/players/InkStainedWretch/articles?page=2" });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().page).toBe(2);
  });

  it("garbage ?page= falls back to page 1 rather than erroring", async () => {
    const res = await app.inject({ method: "GET", url: "/players/InkStainedWretch/articles?page=abc" });
    expect(res.statusCode).toBe(200);
    expect(res.json().page).toBe(1);
  });

  it("unknown gamertag returns an empty feed, not a 404", async () => {
    const res = await app.inject({ method: "GET", url: "/players/nobody-writes-about-me/articles" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(0);
    expect(body.rows).toEqual([]);
  });

  it("resolves a slug with dashes (spaces normalized) to the real gamertag", async () => {
    // This tests actual slug normalization: "Dead Eye Jim" → "dead-eye-jim"
    const res = await app.inject({ method: "GET", url: "/players/dead-eye-jim/articles" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].slug).toBe("dead-eye-jim-perishes");
  });
});

describe("GET /players/:gamertag/:map/lives/:n — no coordinate data", () => {
  // A recursive key scan, not a shape-specific assertion — this survives the response
  // shape changing later, which is exactly when a "just add the map" regression would land.
  // Implicit fixture dependency: this relies on the "GET /players/:gamertag/:map/lives/:n"
  // describe block above having already seeded pa-livonia/LivoniaLad/life 1 in its own
  // beforeAll — there is no seeding here. This fails safe (404, not a false pass) if that
  // sibling block is ever reordered or run with `.only`, but a future maintainer reading only
  // this block would otherwise wonder where the fixture came from.
  const FORBIDDEN_KEYS = new Set(["x", "y", "positions", "segments", "track"]);
  function findForbiddenKeys(value: unknown, path = ""): string[] {
    if (value === null || typeof value !== "object") return [];
    const hits: string[] = [];
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      if (FORBIDDEN_KEYS.has(key)) hits.push(childPath);
      hits.push(...findForbiddenKeys(child, childPath));
    }
    return hits;
  }

  it("the public life route's response body contains no coordinate data at any depth", async () => {
    const res = await app.inject({ method: "GET", url: "/players/LivoniaLad/pa-livonia/lives/1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(findForbiddenKeys(body)).toEqual([]);
  });
});
