import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb } from "@onelife/test-support";
import { players } from "@onelife/db";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";

const { db } = getTestDb();
const app = buildApp(db);

describe("GET /sitemap", () => {
  beforeAll(async () => {
    await db.insert(players).values({ gamertag: "SitemapSubject" });
  });
  afterAll(async () => {
    await db.delete(players).where(eq(players.gamertag, "SitemapSubject"));
  });

  it("returns players and lives", async () => {
    const res = await app.inject({ method: "GET", url: "/sitemap" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.players)).toBe(true);
    expect(Array.isArray(body.lives)).toBe(true);
  });

  it("serves ISO timestamps for lastmod", async () => {
    const body = (await app.inject({ method: "GET", url: "/sitemap" })).json();
    for (const p of body.players) expect(p.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("needs no authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/sitemap" });
    expect(res.statusCode).not.toBe(401);
  });
});
